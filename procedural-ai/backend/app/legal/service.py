"""Правовой справочник: начальное наполнение, импорт официальных редакций,
верификация, определение применимой редакции на дату."""
from __future__ import annotations

import json
import re
import secrets
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import LegalAct, LegalProvision, LegalVersion, Setting
from .seed_data import ACTS, OFFICIAL_PORTAL, PROVISIONS

ACT_ALIASES = {
    "упк": "upk", "уголовно-процессуального": "upk", "ук": "uk", "уголовного": "uk",
    "конституции": "konst", "коап": "koap",
}

RE_REF = re.compile(
    r"(?:(?:п(?:\.|ункт[аеу]?)\s*[«\"]?([а-я0-9]{1,3})[»\"]?\s*)?)"
    r"(?:(?:ч(?:\.|аст[иью])\s*(\d{1,2}(?:\.\d)?)\s*(?:и\s*\d{1,2}\s*)?))?"
    r"(?:ст(?:\.|ать(?:и|ей|ям|ями|ях|ья|ю))\s*((?:\d{1,3}(?:\.\d{1,2})?(?:\s*[–—-]\s*\d{1,3})?(?:\s*,\s*|\s+и\s+)?)+))\s*"
    r"(УПК\s*РФ|УК\s*РФ|Уголовно-процессуального\s+кодекса|Уголовного\s+кодекса|Конституции\s+(?:РФ|Российской\s+Федерации)|КоАП\s*РФ)",
    re.IGNORECASE,
)


def provision_key(act_code: str, article: str) -> str:
    return f"{act_code}:{article}"


def seed(db: Session) -> dict:
    created_acts = created_prov = 0
    acts: dict[str, LegalAct] = {a.code: a for a in db.scalars(select(LegalAct))}
    for a in ACTS:
        if a["code"] in acts:
            continue
        act = LegalAct(
            code=a["code"], kind=a["kind"], title=a["title"], short_title=a["short_title"], number=a["number"],
            adopted_at=date.fromisoformat(a["adopted_at"]) if a["adopted_at"] else None,
            official_source=OFFICIAL_PORTAL,
            changes_note="Текст и редакция подлежат импорту из официального источника и проверке.",
        )
        db.add(act)
        acts[a["code"]] = act
        created_acts += 1
    db.flush()
    existing = set(db.scalars(select(LegalProvision.key)))
    for act_code, article, heading in PROVISIONS:
        key = provision_key(act_code, article)
        if key in existing:
            continue
        prov = LegalProvision(act_id=acts[act_code].id, key=key, article=article, heading=heading)
        prov.versions.append(LegalVersion(
            text=None, valid_from=None, valid_to=None,
            source="Текст не загружен. Требуется импорт из официального источника.",
            verified=False, import_batch="initial-seed",
        ))
        db.add(prov)
        created_prov += 1
    db.flush()
    return {"acts": created_acts, "provisions": created_prov}


def applicable_version(prov: LegalProvision, on: date | None) -> LegalVersion | None:
    """Редакция, действовавшая на дату. Редакция без даты начала (не загружена)
    возвращается только при отсутствии иных редакций."""
    on = on or date.today()
    dated = [v for v in prov.versions if v.valid_from]
    for v in sorted(dated, key=lambda x: x.valid_from, reverse=True):
        if v.valid_from <= on and (v.valid_to is None or v.valid_to >= on):
            return v
    undated = [v for v in prov.versions if not v.valid_from]
    return undated[-1] if undated and not dated else None


def provision_status(prov: LegalProvision | None, on: date | None) -> dict:
    if prov is None:
        return {"status": "missing", "verified": False,
                "message": "Норма отсутствует в правовом справочнике; ссылка не проверена"}
    v = applicable_version(prov, on)
    if v is None:
        return {"status": "no_version", "verified": False,
                "message": f"Отсутствует редакция {prov.act.short_title}, ст. {prov.article}, действовавшая на {on:%d.%m.%Y}" if on else "Редакция не определена"}
    if not v.text:
        return {"status": "text_missing", "verified": False, "version_id": v.id,
                "message": f"Текст ст. {prov.article} {prov.act.short_title} не загружен из официального источника; актуальность не подтверждена"}
    if not v.verified:
        return {"status": "unverified", "verified": False, "version_id": v.id,
                "message": f"Редакция ст. {prov.article} {prov.act.short_title} не верифицирована ответственным лицом"}
    return {"status": "verified", "verified": True, "version_id": v.id,
            "message": f"Редакция от {v.valid_from:%d.%m.%Y} проверена {v.verified_at:%d.%m.%Y}" if v.verified_at and v.valid_from else "Редакция проверена"}


def find_references(text: str) -> list[dict]:
    """Поиск ссылок на статьи нормативных актов в тексте документа."""
    out = []
    for m in RE_REF.finditer(text):
        raw_code = m.group(4).lower()
        if "упк" in raw_code or "процессуальн" in raw_code:
            code = "upk"
        elif "коап" in raw_code:
            code = "koap"
        elif "конституц" in raw_code:
            code = "konst"
        else:
            code = "uk"
        arts_raw = m.group(3)
        arts: list[str] = []
        for part in re.split(r"\s*,\s*|\s+и\s+", arts_raw.strip()):
            part = part.strip()
            if not part:
                continue
            rng = re.match(r"(\d{1,3})\s*[–—-]\s*(\d{1,3})$", part)
            if rng and int(rng.group(2)) - int(rng.group(1)) < 30:
                arts.extend(str(i) for i in range(int(rng.group(1)), int(rng.group(2)) + 1))
            else:
                arts.append(part)
        for a in arts:
            out.append({"text": m.group(0), "act": code, "article": a, "key": provision_key(code, a),
                        "start": m.start(), "end": m.end()})
    return out


RE_ARTICLE_HEAD = re.compile(r"^\s*Статья\s+(\d{1,3}(?:\.\d{1,2})?)\.\s*(.*)$")


def parse_code_text(text: str) -> list[dict]:
    """Разбор официального текста кодекса (TXT) на статьи."""
    items: list[dict] = []
    cur: dict | None = None
    for line in text.replace("\r\n", "\n").split("\n"):
        m = RE_ARTICLE_HEAD.match(line)
        if m:
            if cur:
                items.append(cur)
            cur = {"article": m.group(1), "heading": m.group(2).strip() or None, "lines": []}
        elif cur is not None:
            cur["lines"].append(line)
    if cur:
        items.append(cur)
    for it in items:
        it["text"] = "\n".join(it.pop("lines")).strip()
    return items


def import_versions(
    db: Session,
    act_code: str,
    items: list[dict],
    *,
    valid_from: date,
    source: str,
    user_id: str | None,
    mark_verified: bool,
    create_missing: bool = True,
) -> dict:
    act = db.scalar(select(LegalAct).where(LegalAct.code == act_code))
    if act is None:
        raise ValueError(f"Нормативный акт «{act_code}» отсутствует в справочнике")
    batch = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + secrets.token_hex(3)
    stats = {"updated": 0, "created": 0, "unchanged": 0, "batch": batch}
    now = datetime.now(timezone.utc)
    for it in items:
        article = str(it["article"]).strip()
        text = (it.get("text") or "").strip()
        if not text:
            continue
        key = provision_key(act_code, article)
        prov = db.scalar(select(LegalProvision).where(LegalProvision.key == key))
        if prov is None:
            if not create_missing:
                continue
            prov = LegalProvision(act_id=act.id, key=key, article=article, heading=it.get("heading"))
            db.add(prov)
            db.flush()
            stats["created"] += 1
        elif it.get("heading") and prov.heading != it["heading"]:
            prov.heading = it["heading"]
        current = applicable_version(prov, valid_from)
        if current and current.text == text and current.valid_from:
            stats["unchanged"] += 1
            continue
        # Закрытие предыдущей редакции и удаление заглушки без текста.
        for v in list(prov.versions):
            if not v.text and not v.valid_from:
                prov.versions.remove(v)
            elif v.valid_from and v.valid_from < valid_from and (v.valid_to is None or v.valid_to >= valid_from):
                v.valid_to = valid_from - timedelta(days=1)
        prov.versions.append(LegalVersion(
            text=text, valid_from=valid_from, source=source, verified=mark_verified,
            verified_by=user_id if mark_verified else None, verified_at=now if mark_verified else None,
            import_batch=batch,
        ))
        stats["updated"] += 1
    act.last_checked_at = now
    act.official_source = source or act.official_source
    _set_registry_updated(db, user_id)
    db.flush()
    return stats


def _set_registry_updated(db: Session, user_id: str | None) -> None:
    s = db.get(Setting, "legal_registry_updated_at")
    val = datetime.now(timezone.utc).isoformat()
    if s is None:
        db.add(Setting(key="legal_registry_updated_at", value=val, updated_by=user_id))
    else:
        s.value = val
        s.updated_by = user_id


def import_json(db: Session, payload: str | bytes, *, user_id: str | None, mark_verified: bool) -> dict:
    """Формат: {"act": "upk", "valid_from": "YYYY-MM-DD", "source": "...",
    "articles": [{"article": "146", "heading": "...", "text": "..."}]}"""
    data = json.loads(payload)
    return import_versions(
        db, data["act"], data["articles"], valid_from=date.fromisoformat(data["valid_from"]),
        source=data.get("source") or "", user_id=user_id, mark_verified=mark_verified,
    )


def registry_updated_at(db: Session) -> str | None:
    s = db.get(Setting, "legal_registry_updated_at")
    return s.value if s else None
