from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..deps import client_ip, current_user, require_perm
from ..legal import service as legal
from ..models import LegalAct, LegalProvision, LegalVersion, User
from ..services.file_safety import decode_text
from .common import iso

router = APIRouter(prefix="/legal", tags=["Правовой справочник"])


def ser_act(a: LegalAct, counts: dict | None = None) -> dict:
    return {"id": a.id, "code": a.code, "kind": a.kind, "title": a.title, "short_title": a.short_title,
            "number": a.number, "adopted_at": iso(a.adopted_at), "official_source": a.official_source,
            "last_checked_at": iso(a.last_checked_at), "changes_note": a.changes_note, **(counts or {})}


def ser_version(v: LegalVersion, users: dict | None = None) -> dict:
    return {"id": v.id, "text": v.text, "valid_from": iso(v.valid_from), "valid_to": iso(v.valid_to),
            "source": v.source, "verified": v.verified, "verified_by": (users or {}).get(v.verified_by, v.verified_by),
            "verified_at": iso(v.verified_at), "import_batch": v.import_batch, "created_at": iso(v.created_at)}


def ser_provision(p: LegalProvision, on: date | None = None, with_versions: bool = False, users=None) -> dict:
    d = {"id": p.id, "key": p.key, "act_code": p.act.code, "act": p.act.short_title, "article": p.article,
         "part": p.part, "item": p.item, "heading": p.heading, "status": legal.provision_status(p, on)}
    if with_versions:
        d["versions"] = [ser_version(v, users) for v in p.versions]
    return d


@router.get("/status", summary="Состояние справочника")
def status(_: User = Depends(current_user), db: Session = Depends(get_db)):
    total = db.scalar(select(func.count()).select_from(LegalProvision)) or 0
    verified = db.scalar(select(func.count(func.distinct(LegalVersion.provision_id))).where(LegalVersion.verified.is_(True))) or 0
    with_text = db.scalar(select(func.count(func.distinct(LegalVersion.provision_id))).where(LegalVersion.text.is_not(None))) or 0
    return {"updated_at": legal.registry_updated_at(db), "provisions": total, "with_text": with_text, "verified": verified,
            "mode": "local",
            "notice": "Справочник хранится локально. Актуальность изменений законодательства, принятых после даты последнего обновления, не проверена."}


@router.get("/acts", summary="Нормативные акты")
def acts(_: User = Depends(current_user), db: Session = Depends(get_db)):
    out = []
    for a in db.scalars(select(LegalAct).order_by(LegalAct.kind, LegalAct.short_title)):
        n = db.scalar(select(func.count()).select_from(LegalProvision).where(LegalProvision.act_id == a.id))
        out.append(ser_act(a, {"provisions": n}))
    return out


@router.get("/acts/{code}/provisions", summary="Статьи акта")
def act_provisions(code: str, on: date | None = None, _: User = Depends(current_user), db: Session = Depends(get_db)):
    a = db.scalar(select(LegalAct).where(LegalAct.code == code))
    if a is None:
        raise HTTPException(404, "Акт не найден")
    provs = list(db.scalars(select(LegalProvision).where(LegalProvision.act_id == a.id)))
    provs.sort(key=lambda p: [int(x) for x in p.article.split(".") if x.isdigit()])
    return {"act": ser_act(a), "provisions": [ser_provision(p, on) for p in provs]}


@router.get("/provisions/{key}", summary="Норма и её редакции")
def provision(key: str, on: date | None = None, _: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.scalar(select(LegalProvision).where(LegalProvision.key == key))
    if p is None:
        raise HTTPException(404, "Норма отсутствует в справочнике")
    users = {u.id: u.full_name for u in db.scalars(select(User))}
    return ser_provision(p, on, with_versions=True, users=users)


@router.get("/search", summary="Поиск по справочнику")
def search(q: str, on: date | None = None, _: User = Depends(current_user), db: Session = Depends(get_db)):
    q = q.strip()
    refs = legal.find_references(q)
    if refs:
        keys = [r["key"] for r in refs]
        provs = list(db.scalars(select(LegalProvision).where(LegalProvision.key.in_(keys))))
        found = {p.key for p in provs}
        return {"results": [ser_provision(p, on) for p in provs],
                "not_found": [k for k in keys if k not in found]}
    like = f"%{q}%"
    stmt = (select(LegalProvision).join(LegalVersion, LegalVersion.provision_id == LegalProvision.id, isouter=True)
            .where(or_(LegalProvision.heading.ilike(like), LegalProvision.article == q, LegalVersion.text.ilike(like)))
            .distinct().limit(50))
    return {"results": [ser_provision(p, on) for p in db.scalars(stmt)], "not_found": []}


@router.get("/check", summary="Проверка ссылки на норму на дату")
def check(key: str, on: date | None = None, _: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.scalar(select(LegalProvision).where(LegalProvision.key == key))
    return {"key": key, "on": iso(on or date.today()), **legal.provision_status(p, on or date.today())}


@router.post("/import", summary="Импорт официальной редакции (TXT кодекса или JSON)")
async def import_text(request: Request, act: str = Form(...), valid_from: date = Form(...), source: str = Form(...),
                      mark_verified: bool = Form(False), file: UploadFile = File(...),
                      user: User = Depends(require_perm("legal.manage")), db: Session = Depends(get_db)):
    raw = await file.read(30 * 1024 * 1024 + 1)
    if len(raw) > 30 * 1024 * 1024:
        raise HTTPException(413, "Файл слишком большой")
    name = (file.filename or "").lower()
    try:
        if name.endswith(".json"):
            import json

            data = json.loads(raw.decode("utf-8"))
            items = data["articles"] if isinstance(data, dict) else data
        else:
            items = legal.parse_code_text(decode_text(raw))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Не удалось разобрать файл: {exc}")
    if not items:
        raise HTTPException(422, "В файле не найдено статей (ожидаются заголовки вида «Статья 146. ...»)")
    try:
        stats = legal.import_versions(db, act, items, valid_from=valid_from, source=source, user_id=user.id,
                                      mark_verified=mark_verified)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    db.commit()
    audit.record(db, "legal.import", user=user, object_type="legal_act", object_id=act, ip=client_ip(request),
                 details=stats | {"valid_from": valid_from.isoformat(), "verified": mark_verified, "source": source})
    return stats


@router.post("/versions/{version_id}/verify", summary="Верификация редакции ответственным лицом")
def verify(version_id: str, request: Request, verified: bool = True, user: User = Depends(require_perm("legal.manage")),
           db: Session = Depends(get_db)):
    v = db.get(LegalVersion, version_id)
    if v is None:
        raise HTTPException(404, "Редакция не найдена")
    if verified and not v.text:
        raise HTTPException(409, "Нельзя верифицировать редакцию без загруженного текста")
    v.verified = verified
    v.verified_by = user.id if verified else None
    v.verified_at = datetime.now(timezone.utc) if verified else None
    db.commit()
    audit.record(db, "legal.verify" if verified else "legal.unverify", user=user, object_type="legal_version",
                 object_id=v.id, ip=client_ip(request))
    return ser_version(v)
