from __future__ import annotations

import yaml
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..catalog import registry
from ..catalog import sync as catalog_sync
from ..db import get_db
from ..deps import client_ip, current_user, require_perm
from ..models import DocumentTemplate, User
from ..services import generator

router = APIRouter(prefix="/templates", tags=["Каталог документов"])


def ser_template(t: DocumentTemplate, full: bool = False) -> dict:
    d = {"id": t.id, "code": t.type_code, "version": t.version, "title": t.title, "section": t.section,
         "section_label": registry.SECTIONS.get(t.section, t.section), "procedural_kind": t.procedural_kind,
         "procedural_kind_label": registry.PROCEDURAL_KINDS.get(t.procedural_kind, t.procedural_kind),
         "author_role": t.author_role, "addressee": t.addressee, "requires_court": t.requires_court,
         "requires_head_consent": t.requires_head_consent, "requires_prosecutor_consent": t.requires_prosecutor_consent,
         "stages": t.stages, "keywords": t.keywords, "specializations": t.specializations, "origin": t.origin,
         "legal_bases": t.legal_bases, "warnings": t.warnings}
    if full:
        d["fields"] = [{"key": f.key, "label": f.label, "type": f.field_type, "required": f.required,
                        "condition": f.condition, "binding": f.binding, "participant_role": f.participant_role,
                        "options": f.options, "help": f.help, "group": f.group, "narrative": f.narrative}
                       for f in t.fields]
        spec = [s for s in registry.specializations() if t.type_code in s.get("applies_to", [])]
        d["specialization_profiles"] = spec
    return d


@router.get("", summary="Каталог видов документов")
def catalog(_: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(DocumentTemplate).where(DocumentTemplate.is_active.is_(True))
                      .order_by(DocumentTemplate.section, DocumentTemplate.title))
    return {"sections": [{"code": k, "label": v} for k, v in registry.SECTIONS.items()],
            "kinds": registry.PROCEDURAL_KINDS, "templates": [ser_template(t) for t in rows]}


@router.get("/kits", summary="Комплекты связанных документов")
def kits(_: User = Depends(current_user)):
    return registry.kits()


@router.get("/specializations", summary="Специализированные профили")
def specializations(_: User = Depends(current_user)):
    return registry.specializations()


@router.get("/{code}", summary="Шаблон: схема полей и правовые основания")
def template_detail(code: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    t = catalog_sync.current(db, code)
    if t is None:
        raise HTTPException(404, "Вид документа не найден")
    versions = [{"version": v.version, "created_at": v.created_at.isoformat(), "origin": v.origin}
                for v in db.scalars(select(DocumentTemplate).where(DocumentTemplate.type_code == code)
                                    .order_by(DocumentTemplate.version))]
    return ser_template(t, full=True) | {"versions": versions, "body": t.body}


@router.post("/import", summary="Добавление (обновление) вида документа из YAML-описания")
async def import_template(request: Request, file: UploadFile = File(...),
                          user: User = Depends(require_perm("templates.manage")), db: Session = Depends(get_db)):
    raw = await file.read(512 * 1024 + 1)
    if len(raw) > 512 * 1024:
        raise HTTPException(413, "Слишком большой файл описания")
    try:
        data = yaml.safe_load(raw.decode("utf-8"))
    except (yaml.YAMLError, UnicodeDecodeError) as exc:
        raise HTTPException(422, f"Ошибка разбора YAML: {exc}")
    docs = data.get("documents") if isinstance(data, dict) else None
    if not docs:
        raise HTTPException(422, "Описание должно содержать список documents")
    results = []
    for defn in docs:
        defn = dict(defn)
        try:
            defn["fields_expanded"] = registry.expand_fields(defn)
        except KeyError as exc:
            raise HTTPException(422, f"Неизвестный набор полей: {exc}")
        errors = registry.validate_definition(defn)
        if errors:
            raise HTTPException(422, "; ".join(errors))
        latest = db.scalar(select(DocumentTemplate).where(DocumentTemplate.type_code == defn["code"])
                           .order_by(DocumentTemplate.version.desc()).limit(1))
        tpl = catalog_sync.build_template(defn, (latest.version + 1) if latest else 1, origin="custom")
        # Пробный рендеринг для проверки шаблона
        try:
            sample = generator.sample_values(tpl)
            parts = {"p-sample": {"id": "p-sample", "display_name": "Проверка", "short_name": "Проверка", "role_label": "Участник"}}
            generator.render(tpl, sample, {}, parts, {})
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(422, f"Ошибка шаблона «{defn['code']}»: {exc}")
        if latest:
            for old in db.scalars(select(DocumentTemplate).where(DocumentTemplate.type_code == defn["code"])):
                old.is_active = False
        db.add(tpl)
        results.append({"code": defn["code"], "version": tpl.version})
    db.commit()
    audit.record(db, "template.import", user=user, object_type="template", ip=client_ip(request), details={"items": results})
    return {"imported": results}
