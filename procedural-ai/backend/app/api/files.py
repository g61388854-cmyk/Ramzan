from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit, storage, tasks
from ..config import settings
from ..db import get_db
from ..deps import client_ip, current_user, load_case
from ..models import (
    Case,
    ChangeHistory,
    Discrepancy,
    ExtractedEntity,
    FactClaim,
    FactSource,
    SourceFile,
    SourceFragment,
    User,
)
from ..services import discrepancies as disc_service
from ..services import file_safety, processing
from ..services.extractor import DOC_KIND_LABELS, ENTITY_LABELS
from .common import iso, record_change, ser_discrepancy, ser_fact, ser_file, ser_task

router = APIRouter(tags=["Материалы, извлечение и факты"])

CATEGORIES = {
    "source": "Исходный файл", "protocol": "Протокол", "resolution": "Постановление", "expert_opinion": "Заключение эксперта",
    "certificate": "Справка / ответ на запрос", "digital": "Цифровой документ", "photo": "Фотография",
    "media": "Аудио- и видеоматериал", "annex": "Приложение / опись", "statement": "Заявление / объяснение",
    "report": "Рапорт", "other": "Иное",
}


@tasks.handler("process_file")
def _process_task(db: Session, task, progress):
    f = db.get(SourceFile, task.file_id)
    if f is None:
        raise RuntimeError("Файл не найден")
    f.status = "processing"
    db.commit()
    try:
        return processing.process_file(db, f, progress)
    except Exception as exc:
        db.rollback()
        f = db.get(SourceFile, task.file_id)
        f.status = "failed"
        f.error = str(exc)[:2000]
        db.commit()
        raise


def _next_source_code(db: Session, case_id: str) -> str:
    n = db.scalar(select(func.count()).select_from(SourceFile).where(SourceFile.case_id == case_id)) or 0
    return f"И-{n + 1:03d}"


@router.get("/files/categories", summary="Категории материалов")
def categories(_: User = Depends(current_user)):
    return {"categories": [{"code": k, "label": v} for k, v in CATEGORIES.items()],
            "allowed_extensions": sorted(file_safety.ALLOWED), "max_upload_mb": settings.max_upload_mb,
            "entity_labels": ENTITY_LABELS, "doc_kind_labels": DOC_KIND_LABELS}


@router.post("/cases/{case_id}/files", status_code=201, summary="Загрузка материала")
async def upload(case_id: str, request: Request, file: UploadFile = File(...), category: str = Form("other"),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = load_case(db, case_id, user, request, need="write")
    if category not in CATEGORIES:
        raise HTTPException(422, "Неизвестная категория материала")
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    try:
        checked = file_safety.check_upload(file.filename or "file", data, file.content_type)
    except file_safety.UnsafeFile as exc:
        audit.record(None, "file.rejected", user=user, case_id=c.id, category="security", success=False,
                     ip=client_ip(request), details={"name": file.filename, "reason": str(exc)})
        raise HTTPException(422, str(exc))
    digest = hashlib.sha256(data).hexdigest()
    duplicate = db.scalar(select(SourceFile).where(SourceFile.case_id == c.id, SourceFile.sha256 == digest,
                                                   SourceFile.is_archived.is_(False)))
    stored = storage.put(data)
    f = SourceFile(case_id=c.id, source_code=_next_source_code(db, c.id), original_name=checked.safe_name,
                   stored_name=stored, mime=checked.mime, ext=checked.ext, size=len(data), sha256=digest,
                   category=category, uploaded_by=user.id,
                   notes="; ".join(checked.warnings + ([f"Идентичный файл уже загружен ({duplicate.source_code})"] if duplicate else [])) or None)
    db.add(f)
    db.commit()
    del data
    task = tasks.submit(db, "process_file", user_id=user.id, case_id=c.id, file_id=f.id)
    audit.record(db, "file.upload", user=user, object_type="file", object_id=f.id, case_id=c.id, ip=client_ip(request),
                 details={"name": f.original_name, "sha256": digest, "size": f.size})
    db.refresh(f)
    return {"file": ser_file(f), "task": ser_task(task), "warnings": checked.warnings}


@router.get("/cases/{case_id}/files", summary="Реестр источников")
def list_files(case_id: str, request: Request, archived: bool = False, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    load_case(db, case_id, user, request)
    stmt = select(SourceFile).where(SourceFile.case_id == case_id)
    if not archived:
        stmt = stmt.where(SourceFile.is_archived.is_(False))
    return [ser_file(f) for f in db.scalars(stmt.order_by(SourceFile.uploaded_at))]


def _file_for(db: Session, file_id: str, user: User, request: Request, need: str = "read") -> SourceFile:
    f = db.get(SourceFile, file_id)
    if f is None:
        raise HTTPException(404, "Файл не найден")
    load_case(db, f.case_id, user, request, need=need)
    return f


@router.get("/files/{file_id}", summary="Сведения о материале")
def get_file(file_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = _file_for(db, file_id, user, request)
    return ser_file(f)


@router.get("/files/{file_id}/download", summary="Получение исходного файла")
def download(file_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = _file_for(db, file_id, user, request)
    data = storage.get(f.stored_name)
    audit.record(db, "file.download", user=user, object_type="file", object_id=f.id, case_id=f.case_id,
                 ip=client_ip(request))
    from urllib.parse import quote

    return Response(content=data, media_type=f.mime, headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(f.original_name)}",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/files/{file_id}/fragments", summary="Фрагменты (страницы, абзацы) материала")
def fragments(file_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = _file_for(db, file_id, user, request)
    frs = db.scalars(select(SourceFragment).where(SourceFragment.file_id == f.id).order_by(SourceFragment.seq))
    ents = list(db.scalars(select(ExtractedEntity).where(ExtractedEntity.file_id == f.id)))
    by_frag: dict[str, list] = {}
    for e in ents:
        by_frag.setdefault(e.fragment_id, []).append({"id": e.id, "type": e.entity_type, "start": e.char_start,
                                                     "end": e.char_end, "value": e.value, "normalized": e.normalized})
    return {"file": ser_file(f), "fragments": [
        {"id": x.id, "seq": x.seq, "page": x.page, "paragraph": x.paragraph, "text": x.text, "method": x.method,
         "ocr_confidence": x.ocr_confidence, "entities": by_frag.get(x.id, [])} for x in frs]}


@router.post("/files/{file_id}/reprocess", summary="Повторная обработка материала")
def reprocess(file_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = _file_for(db, file_id, user, request, need="write")
    task = tasks.submit(db, "process_file", user_id=user.id, case_id=f.case_id, file_id=f.id)
    audit.record(db, "file.reprocess", user=user, object_type="file", object_id=f.id, case_id=f.case_id,
                 ip=client_ip(request))
    return ser_task(task)


class FilePatch(BaseModel):
    category: str | None = None
    is_archived: bool | None = None
    notes: str | None = Field(default=None, max_length=4000)


@router.patch("/files/{file_id}", summary="Изменение категории / архивирование материала")
def update_file(file_id: str, body: FilePatch, request: Request, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    f = _file_for(db, file_id, user, request, need="write")
    before = ser_file(f)
    changes = body.model_dump(exclude_unset=True)
    if "category" in changes and changes["category"] not in CATEGORIES:
        raise HTTPException(422, "Неизвестная категория")
    for k, v in changes.items():
        setattr(f, k, v)
    record_change(db, "file", f.id, f.case_id, user, {k: before[k] for k in changes}, {k: getattr(f, k) for k in changes})
    if "is_archived" in changes:
        db.flush()
        disc_service.refresh(db, db.get(Case, f.case_id))
    db.commit()
    audit.record(db, "file.archive" if changes.get("is_archived") else "file.update", user=user, object_type="file",
                 object_id=f.id, case_id=f.case_id, ip=client_ip(request))
    return ser_file(f)


# --- извлечённые сущности, факты, расхождения ------------------------------------------

@router.get("/cases/{case_id}/entities", summary="Извлечённые сущности")
def entities(case_id: str, request: Request, entity_type: str | None = None, user: User = Depends(current_user),
             db: Session = Depends(get_db)):
    load_case(db, case_id, user, request)
    stmt = select(ExtractedEntity).where(ExtractedEntity.case_id == case_id)
    if entity_type:
        stmt = stmt.where(ExtractedEntity.entity_type == entity_type)
    files = {f.id: f for f in db.scalars(select(SourceFile).where(SourceFile.case_id == case_id))}
    return [{"id": e.id, "file_id": e.file_id, "source_code": files[e.file_id].source_code if e.file_id in files else None,
             "fragment_id": e.fragment_id, "type": e.entity_type, "label": ENTITY_LABELS.get(e.entity_type),
             "value": e.value, "normalized": e.normalized, "context": e.context, "extractor": e.extractor,
             "machine_generated": True, "created_at": iso(e.created_at)}
            for e in db.scalars(stmt.order_by(ExtractedEntity.created_at).limit(5000))]


@router.get("/cases/{case_id}/facts", summary="Карточки фактов")
def list_facts(case_id: str, request: Request, status: str | None = None, fact_type: str | None = None,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    load_case(db, case_id, user, request)
    stmt = select(FactClaim).where(FactClaim.case_id == case_id)
    if status:
        stmt = stmt.where(FactClaim.status == status)
    if fact_type:
        stmt = stmt.where(FactClaim.fact_type == fact_type)
    files = {f.id: f for f in db.scalars(select(SourceFile).where(SourceFile.case_id == case_id))}
    return [ser_fact(f, files) for f in db.scalars(stmt.order_by(FactClaim.fact_type, FactClaim.created_at).limit(5000))]


class FactIn(BaseModel):
    fact_type: str = Field(max_length=32)
    content: str = Field(min_length=1, max_length=5000)
    label: str | None = Field(default=None, max_length=255)
    normalized: str | None = Field(default=None, max_length=1000)
    file_id: str | None = None
    fragment_id: str | None = None
    quote: str | None = Field(default=None, max_length=5000)


@router.post("/cases/{case_id}/facts", status_code=201, summary="Ручное добавление факта")
def create_fact(case_id: str, body: FactIn, request: Request, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    c = load_case(db, case_id, user, request, need="write")
    fact = FactClaim(case_id=c.id, fact_type=body.fact_type, label=body.label or ENTITY_LABELS.get(body.fact_type),
                     content=body.content, normalized=body.normalized, origin="manual", status="unverified",
                     machine_generated=False)
    if body.file_id:
        f = db.get(SourceFile, body.file_id)
        if f is None or f.case_id != c.id:
            raise HTTPException(422, "Источник не принадлежит делу")
        frag = db.get(SourceFragment, body.fragment_id) if body.fragment_id else None
        if frag is not None and frag.file_id != f.id:
            raise HTTPException(422, "Фрагмент не принадлежит файлу")
        fact.sources.append(FactSource(file_id=f.id, fragment_id=frag.id if frag else None,
                                       page=frag.page if frag else None, quote=body.quote))
    db.add(fact)
    db.commit()
    audit.record(db, "fact.create", user=user, object_type="fact", object_id=fact.id, case_id=c.id, ip=client_ip(request))
    return ser_fact(fact, {f.id: f for f in db.scalars(select(SourceFile).where(SourceFile.case_id == c.id))})


@router.get("/facts/{fact_id}", summary="Карточка факта с источниками")
def get_fact(fact_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fact = db.get(FactClaim, fact_id)
    if fact is None:
        raise HTTPException(404, "Факт не найден")
    load_case(db, fact.case_id, user, request)
    files = {f.id: f for f in db.scalars(select(SourceFile).where(SourceFile.case_id == fact.case_id))}
    data = ser_fact(fact, files)
    for s in data["sources"]:
        fr = db.get(SourceFragment, s["fragment_id"]) if s["fragment_id"] else None
        s["fragment_text"] = fr.text if fr else None
        s["fragment_method"] = fr.method if fr else None
        s["paragraph"] = fr.paragraph if fr else None
    data["history"] = [{"changed_at": iso(h.changed_at), "before": h.before, "after": h.after}
                       for h in db.scalars(select(ChangeHistory).where(ChangeHistory.entity_type == "fact",
                                                                      ChangeHistory.entity_id == fact.id)
                                           .order_by(ChangeHistory.id))]
    return data


class FactPatch(BaseModel):
    content: str | None = Field(default=None, max_length=5000)
    normalized: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, pattern="^(unverified|confirmed|rejected)$")


@router.patch("/facts/{fact_id}", summary="Проверка (подтверждение, отклонение, правка) факта")
def update_fact(fact_id: str, body: FactPatch, request: Request, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    fact = db.get(FactClaim, fact_id)
    if fact is None:
        raise HTTPException(404, "Факт не найден")
    load_case(db, fact.case_id, user, request, need="write")
    before = {"content": fact.content, "normalized": fact.normalized, "status": fact.status}
    changes = body.model_dump(exclude_unset=True)
    if "content" in changes and changes["content"] != fact.content:
        if not fact.edited_manually:
            fact.original_content = fact.content
        fact.edited_manually = True
        fact.content = changes["content"]
    if "normalized" in changes:
        fact.normalized = changes["normalized"]
    if "status" in changes:
        fact.status = changes["status"]
        fact.verified_by = user.id if changes["status"] != "unverified" else None
        fact.verified_at = datetime.now(timezone.utc) if changes["status"] != "unverified" else None
    record_change(db, "fact", fact.id, fact.case_id, user, before,
                  {"content": fact.content, "normalized": fact.normalized, "status": fact.status})
    db.commit()
    audit.record(db, f"fact.{fact.status if 'status' in changes else 'edit'}", user=user, object_type="fact",
                 object_id=fact.id, case_id=fact.case_id, ip=client_ip(request))
    files = {f.id: f for f in db.scalars(select(SourceFile).where(SourceFile.case_id == fact.case_id))}
    return ser_fact(fact, files)


@router.get("/cases/{case_id}/discrepancies", summary="Потенциальные расхождения")
def list_discrepancies(case_id: str, request: Request, status: str | None = None, user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    load_case(db, case_id, user, request)
    stmt = select(Discrepancy).where(Discrepancy.case_id == case_id)
    if status:
        stmt = stmt.where(Discrepancy.status == status)
    return [ser_discrepancy(d) for d in db.scalars(stmt.order_by(Discrepancy.created_at))]


@router.post("/cases/{case_id}/discrepancies/refresh", summary="Повторный поиск расхождений")
def refresh_discrepancies(case_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = load_case(db, case_id, user, request, need="write")
    res = disc_service.refresh(db, c)
    db.commit()
    return res


class DiscrepancyPatch(BaseModel):
    status: str = Field(pattern="^(open|resolved|dismissed)$")
    resolution_note: str | None = Field(default=None, max_length=4000)


@router.patch("/discrepancies/{disc_id}", summary="Отметка о рассмотрении расхождения")
def update_discrepancy(disc_id: str, body: DiscrepancyPatch, request: Request, user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    d = db.get(Discrepancy, disc_id)
    if d is None:
        raise HTTPException(404, "Расхождение не найдено")
    load_case(db, d.case_id, user, request, need="write")
    before = {"status": d.status, "note": d.resolution_note}
    d.status = body.status
    d.resolution_note = body.resolution_note
    d.resolved_by = user.id if body.status != "open" else None
    record_change(db, "discrepancy", d.id, d.case_id, user, before, {"status": d.status, "note": d.resolution_note})
    db.commit()
    audit.record(db, "discrepancy.update", user=user, object_type="discrepancy", object_id=d.id, case_id=d.case_id,
                 ip=client_ip(request), details={"status": body.status})
    return ser_discrepancy(d)
