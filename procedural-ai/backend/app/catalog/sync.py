"""Синхронизация декларативного каталога с таблицами шаблонов.

При изменении описания вида документа создаётся новая версия шаблона;
ранее созданные версии сохраняются, поскольку на них ссылаются документы."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import DocumentField, DocumentTemplate
from . import registry


def build_template(defn: dict, version: int, origin: str = "builtin") -> DocumentTemplate:
    tpl = DocumentTemplate(
        type_code=defn["code"],
        version=version,
        title=defn["title"],
        section=defn["section"],
        procedural_kind=defn["kind"],
        author_role=defn["author"],
        addressee=defn.get("addressee"),
        requires_court=bool(defn.get("requires_court")),
        requires_head_consent=bool(defn.get("requires_head_consent")),
        requires_prosecutor_consent=bool(defn.get("requires_prosecutor_consent")),
        stages=defn.get("stages", []),
        legal_bases=defn.get("legal_bases", []),
        specializations=defn.get("specializations", []),
        keywords=defn.get("keywords", []),
        warnings=defn.get("warnings", []),
        description=defn.get("description"),
        body=defn["body"],
        origin=origin,
        checksum=registry.checksum({k: v for k, v in defn.items() if k != "fields_expanded"}),
    )
    for order, f in enumerate(defn["fields_expanded"]):
        tpl.fields.append(DocumentField(
            key=f["key"], label=f["label"], field_type=f["type"], required=bool(f.get("required")),
            condition=f.get("condition"), binding=f.get("binding"), participant_role=f.get("participant_role"),
            options=f.get("options"), help=f.get("help"), group=f.get("group"), narrative=bool(f.get("narrative")),
            order=order,
        ))
    return tpl


def sync(db: Session) -> dict:
    stats = {"created": 0, "updated": 0, "unchanged": 0}
    for defn in registry.load_all():
        latest = db.scalar(
            select(DocumentTemplate).where(DocumentTemplate.type_code == defn["code"])
            .order_by(DocumentTemplate.version.desc()).limit(1)
        )
        checksum = registry.checksum({k: v for k, v in defn.items() if k != "fields_expanded"})
        if latest is not None and (latest.checksum == checksum or latest.origin == "custom"):
            # Пользовательская версия, загруженная администратором, имеет приоритет над встроенной.
            stats["unchanged"] += 1
            continue
        version = (latest.version + 1) if latest else 1
        if latest is not None:
            for old in db.scalars(select(DocumentTemplate).where(DocumentTemplate.type_code == defn["code"])):
                old.is_active = False
        db.add(build_template(defn, version))
        stats["updated" if latest else "created"] += 1
    db.flush()
    return stats


def current(db: Session, type_code: str) -> DocumentTemplate | None:
    return db.scalar(
        select(DocumentTemplate).where(DocumentTemplate.type_code == type_code, DocumentTemplate.is_active.is_(True))
        .order_by(DocumentTemplate.version.desc()).limit(1)
    )


def count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(DocumentTemplate).where(DocumentTemplate.is_active.is_(True))) or 0
