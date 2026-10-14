from __future__ import annotations

import difflib
import hashlib
import uuid
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit, storage
from ..catalog import registry
from ..catalog import sync as catalog_sync
from ..config import settings
from ..db import get_db
from ..deps import client_ip, current_user, load_case
from ..legal import service as legal
from ..models import (
    Case,
    CaseParticipant,
    Document,
    DocumentExport,
    DocumentLegalBasis,
    DocumentTemplate,
    DocumentVersion,
    FactClaim,
    LegalProvision,
    SourceFile,
    SourceFragment,
    User,
)
from ..services import ai_provider, classifier, exporter, generator, sanitize, validator
from ..services.formatting import to_date
from .common import DOC_STATUS_LABELS, iso, ser_document, ser_version

router = APIRouter(tags=["Документы"])

FIELD_SOURCE_TYPES = {"manual", "case", "participant", "fact", "system", "ai", "assist"}


class DocumentCreate(BaseModel):
    type_code: str | None = None
    title: str | None = Field(default=None, max_length=512)
    mode: str = Field(default="template", pattern="^(template|description|materials|kit|manual)$")
    values: dict = Field(default_factory=dict)
    sources: dict = Field(default_factory=dict)
    content_html: str | None = Field(default=None, max_length=2_000_000)


class VersionIn(BaseModel):
    values: dict = Field(default_factory=dict)
    sources: dict = Field(default_factory=dict)
    content_html: str | None = Field(default=None, max_length=2_000_000)
    edited: bool = False
    comment: str | None = Field(default=None, max_length=512)


class PreviewIn(BaseModel):
    values: dict = Field(default_factory=dict)
    sources: dict = Field(default_factory=dict)


class StatusIn(BaseModel):
    status: str
    confirm: bool = False


class AiDraftIn(BaseModel):
    field_key: str
    instructions: str | None = Field(default=None, max_length=2000)


class KitIn(BaseModel):
    kit_code: str


class SuggestIn(BaseModel):
    text: str = Field(min_length=3, max_length=4000)


# --- вспомогательные функции -------------------------------------------------

def _doc_for(db: Session, doc_id: str, user: User, request: Request, need: str = "read") -> Document:
    d = db.get(Document, doc_id)
    if d is None:
        raise HTTPException(404, "Документ не найден")
    load_case(db, d.case_id, user, request, need=need)
    return d


def _latest(db: Session, doc: Document) -> DocumentVersion | None:
    return db.scalar(select(DocumentVersion).where(DocumentVersion.document_id == doc.id)
                     .order_by(DocumentVersion.number.desc()).limit(1))


def _clean_values(template: DocumentTemplate | None, values: dict) -> dict:
    if template is None:
        return {}
    keys = {f.key: f for f in template.fields}
    out = {}
    for k, v in (values or {}).items():
        f = keys.get(k)
        if f is None:
            continue
        if f.field_type == "participants":
            out[k] = [str(x) for x in v] if isinstance(v, list) else []
        elif f.field_type == "list":
            out[k] = [str(x) for x in v if str(x).strip()] if isinstance(v, list) else [x for x in str(v).split("\n") if x.strip()]
        elif f.field_type == "bool":
            out[k] = bool(v) and v not in ("false", "0")
        elif f.field_type == "select" and v not in (None, "") and f.options and str(v) not in f.options:
            raise HTTPException(422, f"Недопустимое значение поля «{f.label}»")
        elif v is None:
            continue
        else:
            out[k] = v if isinstance(v, (int, float)) else str(v)[:20000]
    return out


def _clean_sources(db: Session, case_id: str, sources: dict, values: dict) -> dict:
    out = {}
    for k, src in (sources or {}).items():
        if k not in values or not isinstance(src, dict):
            continue
        t = src.get("type")
        if t not in FIELD_SOURCE_TYPES:
            continue
        item = {"type": t, "label": str(src.get("label") or "")[:200]}
        if t == "fact":
            fact = db.get(FactClaim, str(src.get("id")))
            if fact is None or fact.case_id != case_id:
                continue
            item["id"] = fact.id
        elif t == "participant" and src.get("id"):
            p = db.get(CaseParticipant, str(src.get("id")))
            if p is None or p.case_id != case_id:
                continue
            item["id"] = p.id
        elif t in ("ai", "assist"):
            item["confirmed"] = bool(src.get("confirmed"))
            item["engine"] = str(src.get("engine") or "")[:64]
            item["cited"] = [str(x) for x in (src.get("cited") or [])][:200]
        elif t == "case":
            item["field"] = str(src.get("field") or "")[:64]
        out[k] = item
    return out


def _render(db: Session, case: Case, template: DocumentTemplate, values: dict, sources: dict):
    parts = generator.collect_participants(db, case.id, values, template)
    snap = generator.case_snapshot(case)
    html, missing = generator.render(template, values, sources, parts, snap)
    return html, missing, {"case": snap, "participants": parts}


def _link_legal_bases(db: Session, doc: Document, version: DocumentVersion, template: DocumentTemplate,
                      values: dict) -> None:
    on = to_date(values.get("doc_date"))
    for lb in template.legal_bases or []:
        prov = db.scalar(select(LegalProvision).where(LegalProvision.key == lb["key"]))
        if prov is None:
            continue
        v = legal.applicable_version(prov, on)
        st = legal.provision_status(prov, on)
        db.add(DocumentLegalBasis(document_id=doc.id, version_id=version.id, provision_id=prov.id,
                                  legal_version_id=v.id if v else None, reason=lb.get("reason"),
                                  mandatory=lb.get("mandatory", True), verified_on_date=st["verified"]))


def _save_version(db: Session, doc: Document, template: DocumentTemplate | None, html: str, values: dict,
                  sources: dict, snapshot: dict, user: User, comment: str | None) -> DocumentVersion:
    number = (db.scalar(select(func.max(DocumentVersion.number)).where(DocumentVersion.document_id == doc.id)) or 0) + 1
    v = DocumentVersion(document_id=doc.id, number=number, content_html=html, field_values=values,
                        field_sources=sources, case_snapshot=snapshot,
                        template_version=template.version if template else None, created_by=user.id, comment=comment)
    db.add(v)
    db.flush()
    if template is not None:
        _link_legal_bases(db, doc, v, template, values)
    v.validation = validator.validate(db, doc, v)
    return v


def _status_after_edit(doc: Document, version: DocumentVersion) -> str:
    errors = (version.validation or {}).get("summary", {}).get("errors", 0)
    if doc.status == "archived":
        return "archived"
    return "awaiting_input" if errors else "needs_review"


def _create_document(db: Session, case: Case, user: User, body: DocumentCreate, kit_id: str | None = None,
                     kit_code: str | None = None) -> tuple[Document, DocumentVersion, dict]:
    if body.mode == "manual" or not body.type_code:
        if not body.title:
            raise HTTPException(422, "Для документа без шаблона необходимо указать наименование")
        doc = Document(case_id=case.id, template_id=None, type_code=None, title=body.title, status="draft",
                       generation_mode="manual", author_id=user.id)
        db.add(doc)
        db.flush()
        html = sanitize.clean(body.content_html or "<p></p>")
        v = _save_version(db, doc, None, html, {}, {}, {"case": generator.case_snapshot(case), "participants": {}},
                          user, "Создание документа вручную")
        return doc, v, {}
    template = catalog_sync.current(db, body.type_code)
    if template is None:
        raise HTTPException(404, "Вид документа не найден в каталоге")
    values, sources, suggestions = generator.prefill(db, case, template)
    provided = _clean_values(template, body.values)
    values.update(provided)
    provided_sources = _clean_sources(db, case.id, body.sources, provided)
    for k in provided:
        sources[k] = provided_sources.get(k, {"type": "manual"})
    html, missing, snap = _render(db, case, template, values, sources)
    doc = Document(case_id=case.id, template_id=template.id, type_code=template.type_code,
                   title=body.title or template.title, status="draft", generation_mode=body.mode,
                   author_id=user.id, kit_id=kit_id, kit_code=kit_code)
    db.add(doc)
    db.flush()
    v = _save_version(db, doc, template, html, values, sources, snap, user, "Формирование проекта")
    doc.status = _status_after_edit(doc, v)
    return doc, v, suggestions


# --- маршруты --------------------------------------------------------------------

@router.get("/cases/{case_id}/documents", summary="Документы дела")
def list_documents(case_id: str, request: Request, status: str | None = None, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    load_case(db, case_id, user, request)
    stmt = select(Document).where(Document.case_id == case_id)
    if status:
        stmt = stmt.where(Document.status == status)
    docs = list(db.scalars(stmt.order_by(Document.updated_at.desc())))
    out = []
    for d in docs:
        v = _latest(db, d)
        item = ser_document(d)
        item["latest_version"] = ser_version(v, with_content=False) if v else None
        out.append(item)
    return out


@router.post("/cases/{case_id}/documents", status_code=201, summary="Формирование проекта документа")
def create_document(case_id: str, body: DocumentCreate, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    case = load_case(db, case_id, user, request, need="write")
    doc, v, suggestions = _create_document(db, case, user, body)
    db.commit()
    audit.record(db, "document.create", user=user, object_type="document", object_id=doc.id, case_id=case.id,
                 ip=client_ip(request), details={"type": doc.type_code, "mode": doc.generation_mode})
    return ser_document(doc, v) | {"suggestions": suggestions}


@router.post("/cases/{case_id}/kits", status_code=201, summary="Формирование комплекта связанных документов")
def create_kit(case_id: str, body: KitIn, request: Request, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    case = load_case(db, case_id, user, request, need="write")
    kit = next((k for k in registry.kits() if k["code"] == body.kit_code), None)
    if kit is None:
        raise HTTPException(404, "Комплект не найден")
    kit_id = str(uuid.uuid4())
    created = []
    for code in kit["documents"]:
        doc, v, _ = _create_document(db, case, user, DocumentCreate(type_code=code, mode="kit"), kit_id, kit["code"])
        created.append(ser_document(doc) | {"latest_version": ser_version(v, with_content=False)})
    db.commit()
    audit.record(db, "document.kit_create", user=user, object_type="kit", object_id=kit_id, case_id=case.id,
                 ip=client_ip(request), details={"kit": kit["code"], "count": len(created)})
    return {"kit_id": kit_id, "kit": kit, "documents": created,
            "notice": "Каждый документ комплекта сформирован отдельно и требует самостоятельной проверки."}


@router.post("/cases/{case_id}/assistant/suggest", summary="Подбор вида документа по описанию задачи")
def suggest(case_id: str, body: SuggestIn, request: Request, user: User = Depends(current_user),
            db: Session = Depends(get_db)):
    case = load_case(db, case_id, user, request)
    rows = db.scalars(select(DocumentTemplate).where(DocumentTemplate.is_active.is_(True)))
    tlist = [{"code": t.type_code, "title": t.title, "keywords": t.keywords, "stages": t.stages} for t in rows]
    ranked = classifier.suggest(body.text, tlist, case.stage)
    for r in ranked[:3]:
        t = catalog_sync.current(db, r["code"])
        values, _, suggestions = generator.prefill(db, case, t)
        questions = []
        for f in t.fields:
            if f.required and generator.condition_holds(f.condition, values) and not values.get(f.key):
                q = {"key": f.key, "question": f"Укажите: {f.label}", "type": f.field_type, "options": f.options}
                if suggestions.get(f.key):
                    q["suggestions"] = suggestions[f.key]
                questions.append(q)
        r["clarifying_questions"] = questions
        r["stage_ok"] = not t.stages or case.stage in t.stages
        r["author_role"] = t.author_role
    audit.record(db, "assistant.suggest", user=user, case_id=case.id, ip=client_ip(request))
    return {"suggestions": ranked,
            "notice": "Подбор вида документа носит рекомендательный характер; выбор осуществляет пользователь."}


@router.get("/documents/{doc_id}", summary="Документ с текущей версией")
def get_document(doc_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request)
    v = _latest(db, doc)
    data = ser_document(doc, v)
    if doc.template is not None:
        case = db.get(Case, doc.case_id)
        _, _, suggestions = generator.prefill(db, case, doc.template)
        data["suggestions"] = suggestions
        from .templates import ser_template

        data["template_detail"] = ser_template(doc.template, full=True)
    return data


@router.post("/documents/{doc_id}/preview", summary="Предварительный просмотр без сохранения")
def preview(doc_id: str, body: PreviewIn, request: Request, user: User = Depends(current_user),
            db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request)
    if doc.template is None:
        raise HTTPException(422, "Документ создан без шаблона")
    case = db.get(Case, doc.case_id)
    values = _clean_values(doc.template, body.values)
    sources = _clean_sources(db, case.id, body.sources, values)
    html, missing, _ = _render(db, case, doc.template, values, sources)
    return {"content_html": html, "missing": missing}


@router.post("/documents/{doc_id}/versions", status_code=201, summary="Сохранение новой версии")
def save_version(doc_id: str, body: VersionIn, request: Request, user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request, need="write")
    if doc.status == "archived":
        raise HTTPException(409, "Документ архивирован")
    case = db.get(Case, doc.case_id)
    template = doc.template
    values = _clean_values(template, body.values)
    sources = _clean_sources(db, case.id, body.sources, values)
    if body.edited or template is None:
        if body.content_html is None:
            raise HTTPException(422, "Не передан текст документа")
        html = sanitize.clean(body.content_html)
        snapshot = {"case": generator.case_snapshot(case),
                    "participants": generator.collect_participants(db, case.id, values, template) if template else {}}
    else:
        html, _, snapshot = _render(db, case, template, values, sources)
    prev = _latest(db, doc)
    if prev is not None and prev.content_html == html and prev.field_values == values and prev.field_sources == sources:
        return ser_document(doc, prev) | {"unchanged": True}
    v = _save_version(db, doc, template, html, values, sources, snapshot, user,
                      body.comment or ("Редактирование текста" if body.edited else "Изменение данных формы"))
    was = doc.status
    doc.status = _status_after_edit(doc, v)
    if was in ("reviewed", "approved", "exported"):
        doc.reviewed_by = doc.reviewed_at = doc.approved_by = doc.approved_at = None
    db.commit()
    audit.record(db, "document.version", user=user, object_type="document", object_id=doc.id, case_id=doc.case_id,
                 ip=client_ip(request), details={"version": v.number, "edited": body.edited})
    return ser_document(doc, v)


@router.get("/documents/{doc_id}/versions", summary="Версии документа")
def versions(doc_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request)
    users = {u.id: u.full_name for u in db.scalars(select(User))}
    return [ser_version(v, with_content=False) | {"author": users.get(v.created_by)}
            for v in db.scalars(select(DocumentVersion).where(DocumentVersion.document_id == doc.id)
                                .order_by(DocumentVersion.number.desc()))]


@router.get("/documents/{doc_id}/versions/{number}", summary="Конкретная версия")
def version_detail(doc_id: str, number: int, request: Request, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request)
    v = db.scalar(select(DocumentVersion).where(DocumentVersion.document_id == doc.id, DocumentVersion.number == number))
    if v is None:
        raise HTTPException(404, "Версия не найдена")
    return ser_version(v)


@router.get("/documents/{doc_id}/diff", summary="Сравнение версий")
def diff(doc_id: str, request: Request, a: int = Query(...), b: int = Query(...), user: User = Depends(current_user),
         db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request)
    va = db.scalar(select(DocumentVersion).where(DocumentVersion.document_id == doc.id, DocumentVersion.number == a))
    vb = db.scalar(select(DocumentVersion).where(DocumentVersion.document_id == doc.id, DocumentVersion.number == b))
    if va is None or vb is None:
        raise HTTPException(404, "Версия не найдена")
    la = exporter.html_to_plain(va.content_html).split("\n")
    lb = exporter.html_to_plain(vb.content_html).split("\n")
    ops = []
    for line in difflib.ndiff(la, lb):
        tag = line[:2]
        if tag == "? ":
            continue
        ops.append({"op": {"  ": "same", "- ": "removed", "+ ": "added"}[tag], "text": line[2:]})
    field_changes = []
    for k in sorted(set(va.field_values) | set(vb.field_values)):
        if va.field_values.get(k) != vb.field_values.get(k):
            field_changes.append({"key": k, "before": va.field_values.get(k), "after": vb.field_values.get(k)})
    return {"a": a, "b": b, "lines": ops, "fields": field_changes}


@router.post("/documents/{doc_id}/validate", summary="Проверка структуры, реквизитов и правовых оснований")
def validate(doc_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request)
    v = _latest(db, doc)
    result = validator.validate(db, doc, v)
    v.validation = result
    db.commit()
    audit.record(db, "document.validate", user=user, object_type="document", object_id=doc.id, case_id=doc.case_id,
                 ip=client_ip(request), details=result["summary"])
    return result


ALLOWED_TRANSITIONS = {
    "draft": {"awaiting_input", "needs_review", "archived"},
    "awaiting_input": {"needs_review", "draft", "archived"},
    "analyzing": {"needs_review", "draft"},
    "needs_review": {"reviewed", "draft", "archived"},
    "reviewed": {"approved", "needs_review", "archived"},
    "approved": {"needs_review", "archived"},
    "exported": {"needs_review", "archived"},
    "archived": {"draft"},
}


@router.post("/documents/{doc_id}/status", summary="Изменение статуса документа")
def set_status(doc_id: str, body: StatusIn, request: Request, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request, need="write")
    if body.status not in DOC_STATUS_LABELS:
        raise HTTPException(422, "Неизвестный статус")
    if body.status not in ALLOWED_TRANSITIONS.get(doc.status, set()):
        raise HTTPException(409, f"Переход из статуса «{DOC_STATUS_LABELS[doc.status]}» в «{DOC_STATUS_LABELS[body.status]}» недопустим")
    now = datetime.now(timezone.utc)
    if body.status in ("reviewed", "approved"):
        if not body.confirm:
            raise HTTPException(422, "Требуется явное подтверждение пользователя")
        v = _latest(db, doc)
        result = validator.validate(db, doc, v)
        v.validation = result
        if result["summary"]["errors"]:
            db.commit()
            raise HTTPException(409, f"Документ содержит ошибки проверки ({result['summary']['errors']}); отметка невозможна")
    if body.status == "reviewed":
        doc.reviewed_by, doc.reviewed_at = user.id, now
    if body.status == "approved":
        doc.approved_by, doc.approved_at = user.id, now
    if body.status in ("needs_review", "draft"):
        doc.reviewed_by = doc.reviewed_at = doc.approved_by = doc.approved_at = None
    doc.status = body.status
    db.commit()
    audit.record(db, "document.status", user=user, object_type="document", object_id=doc.id, case_id=doc.case_id,
                 ip=client_ip(request), details={"status": body.status})
    return ser_document(doc, _latest(db, doc))


@router.post("/documents/{doc_id}/export", summary="Экспорт в DOCX или PDF")
def export(doc_id: str, request: Request, fmt: str = Query("docx", pattern="^(docx|pdf)$"),
           user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request)
    v = _latest(db, doc)
    draft = None
    if doc.status not in ("reviewed", "approved", "exported"):
        draft = "ПРОЕКТ ДОКУМЕНТА — не проверен пользователем"
    if fmt == "docx":
        data = exporter.to_docx(v.content_html, title=doc.title, draft_mark=draft)
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        data = exporter.to_pdf(v.content_html, title=doc.title, draft_mark=draft)
        mime = "application/pdf"
    stored = storage.put(data, directory=settings.exports_dir)
    exp = DocumentExport(document_id=doc.id, version_id=v.id, fmt=fmt, stored_name=stored,
                         sha256=hashlib.sha256(data).hexdigest(), created_by=user.id)
    db.add(exp)
    if doc.status in ("approved", "reviewed"):
        doc.status = "exported"
    db.commit()
    audit.record(db, "document.export", user=user, object_type="document", object_id=doc.id, case_id=doc.case_id,
                 ip=client_ip(request), details={"format": fmt, "version": v.number, "draft": bool(draft)})
    name = f"{doc.title[:80]} (в.{v.number}).{fmt}"
    return Response(content=data, media_type=mime, headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}", "Cache-Control": "no-store",
        "X-Export-Id": exp.id})


@router.get("/documents/{doc_id}/exports", summary="Журнал экспорта документа")
def exports(doc_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request)
    users = {u.id: u.full_name for u in db.scalars(select(User))}
    out = []
    for e in db.scalars(select(DocumentExport).where(DocumentExport.document_id == doc.id).order_by(DocumentExport.created_at.desc())):
        v = db.get(DocumentVersion, e.version_id)
        out.append({"id": e.id, "format": e.fmt, "version": v.number if v else None, "sha256": e.sha256,
                    "created_by": users.get(e.created_by), "created_at": iso(e.created_at)})
    return out


@router.get("/exports/{export_id}/download", summary="Повторная выдача экспортированного файла")
def export_download(export_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e = db.get(DocumentExport, export_id)
    if e is None:
        raise HTTPException(404, "Экспорт не найден")
    doc = _doc_for(db, e.document_id, user, request)
    data = storage.get(e.stored_name, directory=settings.exports_dir)
    audit.record(db, "document.export_download", user=user, object_type="export", object_id=e.id, case_id=doc.case_id,
                 ip=client_ip(request))
    mime = "application/pdf" if e.fmt == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return Response(content=data, media_type=mime, headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(doc.title[:80] + '.' + e.fmt)}",
        "Cache-Control": "no-store"})


@router.get("/documents/{doc_id}/legal", summary="Правовые основания документа")
def legal_bases(doc_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request)
    v = _latest(db, doc)
    res = validator.validate(db, doc, v)
    return {"legal": res["legal"], "registry_updated_at": legal.registry_updated_at(db)}


@router.post("/documents/{doc_id}/ai-draft", summary="Проект описательного фрагмента по подтверждённым фактам")
def ai_draft(doc_id: str, body: AiDraftIn, request: Request, user: User = Depends(current_user),
             db: Session = Depends(get_db)):
    doc = _doc_for(db, doc_id, user, request, need="write")
    t = doc.template
    field = next((f for f in (t.fields if t else []) if f.key == body.field_key), None)
    if field is None or not field.narrative:
        raise HTTPException(422, "Для данного поля формирование проекта не предусмотрено")
    facts = list(db.scalars(select(FactClaim).where(FactClaim.case_id == doc.case_id, FactClaim.status == "confirmed")
                            .limit(80)))
    files = {f.id: f for f in db.scalars(select(SourceFile).where(SourceFile.case_id == doc.case_id))}
    fact_items = []
    for f in facts:
        src = ", ".join(sorted({files[s.file_id].source_code for s in f.sources if s.file_id in files}))
        fact_items.append({"id": f.id, "type": f.label or f.fact_type, "content": f.content, "source": src})
    frag_ids = {s.fragment_id for f in facts for s in f.sources if s.fragment_id}
    materials = [{"id": fr.id, "text": fr.text} for fr in
                 db.scalars(select(SourceFragment).where(SourceFragment.id.in_(frag_ids)).limit(10))] if frag_ids else []
    task = f"Подготовить фрагмент «{field.label}» для документа «{t.title}»." + (
        f" Дополнительные указания пользователя: {body.instructions}" if body.instructions else "")
    try:
        res = ai_provider.draft_narrative(task, fact_items, materials)
    except ai_provider.AiUnavailable as exc:
        raise HTTPException(503, str(exc))
    audit.record(db, "ai.draft", user=user, object_type="document", object_id=doc.id, case_id=doc.case_id,
                 ip=client_ip(request), details={"field": field.key, "engine": res.engine, "facts": len(fact_items)})
    return {"field_key": field.key, "text": res.text, "engine": res.engine, "cited_fact_ids": res.cited_fact_ids,
            "warnings": res.warnings, "unsupported_sentences": res.unsupported_sentences,
            "source": {"type": "assist" if res.engine == "compile" else "ai", "confirmed": False, "engine": res.engine,
                       "cited": res.cited_fact_ids},
            "notice": "Проектная формулировка требует проверки и подтверждения пользователем."}
