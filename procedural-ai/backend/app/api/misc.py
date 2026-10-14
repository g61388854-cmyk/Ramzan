"""Фоновые задачи, журнал действий, глобальный поиск, главная панель, настройки."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from .. import audit
from ..catalog import sync as catalog_sync
from ..config import settings
from ..db import get_db, is_postgres
from ..deps import accessible_case_ids_query, client_ip, current_user, load_case, require_perm
from ..legal import service as legal
from ..models import (
    AuditEvent,
    Case,
    CaseParticipant,
    Deadline,
    Document,
    DocumentVersion,
    Setting,
    SourceFile,
    SourceFragment,
    Task,
    User,
)
from ..services import ai_provider, ocr
from .common import DOC_STATUS_LABELS, iso, ser_case, ser_deadline, ser_file, ser_task

router = APIRouter(tags=["Служебные функции"])


@router.get("/tasks/{task_id}", summary="Состояние фоновой задачи")
def get_task(task_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if t is None:
        raise HTTPException(404, "Задача не найдена")
    if t.case_id:
        load_case(db, t.case_id, user, request)
    elif t.created_by != user.id:
        raise HTTPException(404, "Задача не найдена")
    return ser_task(t)


@router.get("/tasks", summary="Фоновые задачи пользователя")
def list_tasks(case_id: str | None = None, request: Request = None, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    stmt = select(Task)
    if case_id:
        load_case(db, case_id, user, request)
        stmt = stmt.where(Task.case_id == case_id)
    else:
        stmt = stmt.where(Task.created_by == user.id)
    return [ser_task(t) for t in db.scalars(stmt.order_by(Task.created_at.desc()).limit(100))]


@router.get("/audit", summary="Журнал действий и событий безопасности")
def audit_log(category: str | None = None, action: str | None = None, case_id: str | None = None,
              user_id: str | None = None, success: bool | None = None, limit: int = 200,
              _: User = Depends(require_perm("audit.read")), db: Session = Depends(get_db)):
    stmt = select(AuditEvent)
    if category:
        stmt = stmt.where(AuditEvent.category == category)
    if action:
        stmt = stmt.where(AuditEvent.action.like(action + "%"))
    if case_id:
        stmt = stmt.where(AuditEvent.case_id == case_id)
    if user_id:
        stmt = stmt.where(AuditEvent.user_id == user_id)
    if success is not None:
        stmt = stmt.where(AuditEvent.success.is_(success))
    rows = db.scalars(stmt.order_by(AuditEvent.id.desc()).limit(min(limit, 2000)))
    return [{"id": r.id, "at": iso(r.at), "user_login": r.user_login, "action": r.action, "category": r.category,
             "object_type": r.object_type, "object_id": r.object_id, "case_id": r.case_id, "success": r.success,
             "ip": r.ip, "details": r.details} for r in rows]


@router.get("/cases/{case_id}/audit", summary="Действия по делу")
def case_audit(case_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    load_case(db, case_id, user, request)
    rows = db.scalars(select(AuditEvent).where(AuditEvent.case_id == case_id, AuditEvent.category == "action")
                      .order_by(AuditEvent.id.desc()).limit(300))
    return [{"at": iso(r.at), "user_login": r.user_login, "action": r.action, "object_type": r.object_type,
             "object_id": r.object_id, "details": r.details} for r in rows]


@router.get("/search", summary="Глобальный поиск")
def search(q: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = q.strip()
    if len(q) < 2:
        return {"cases": [], "participants": [], "documents": [], "fragments": []}
    ids = accessible_case_ids_query(db, user)
    like = f"%{q}%"
    cases = db.scalars(select(Case).where(Case.id.in_(ids), or_(Case.case_number.ilike(like), Case.reg_id.ilike(like),
                                                                 Case.fabula.ilike(like), Case.qualification.ilike(like)))
                        .order_by(Case.updated_at.desc()).limit(20))
    parts = db.scalars(select(CaseParticipant).where(CaseParticipant.case_id.in_(ids), or_(
        CaseParticipant.last_name.ilike(like), CaseParticipant.first_name.ilike(like), CaseParticipant.org_name.ilike(like),
        (CaseParticipant.last_name + " " + CaseParticipant.first_name).ilike(like))).limit(30))
    docs = db.scalars(select(Document).where(Document.case_id.in_(ids), Document.title.ilike(like)).limit(30))
    if is_postgres(db):
        frag_stmt = (select(SourceFragment, SourceFile).join(SourceFile, SourceFile.id == SourceFragment.file_id)
                     .where(SourceFile.case_id.in_(ids), SourceFile.is_archived.is_(False),
                            text("to_tsvector('russian', source_fragments.text) @@ plainto_tsquery('russian', :q)"))
                     .params(q=q).limit(50))
    else:
        frag_stmt = (select(SourceFragment, SourceFile).join(SourceFile, SourceFile.id == SourceFragment.file_id)
                     .where(SourceFile.case_id.in_(ids), SourceFile.is_archived.is_(False), SourceFragment.text.ilike(like))
                     .limit(50))
    frags = []
    for fr, f in db.execute(frag_stmt):
        pos = fr.text.lower().find(q.lower())
        start = max(0, pos - 80) if pos >= 0 else 0
        frags.append({"fragment_id": fr.id, "file_id": f.id, "case_id": f.case_id, "source_code": f.source_code,
                      "file_name": f.original_name, "page": fr.page, "snippet": fr.text[start:start + 240]})
    # Поиск по тексту документов (последние версии)
    doc_hits = []
    for d in db.scalars(select(Document).where(Document.case_id.in_(ids)).limit(2000)):
        v = db.scalar(select(DocumentVersion).where(DocumentVersion.document_id == d.id)
                      .order_by(DocumentVersion.number.desc()).limit(1))
        if v and q.lower() in v.content_html.lower():
            doc_hits.append(d)
        if len(doc_hits) >= 20:
            break
    doc_list = {d.id: d for d in list(docs) + doc_hits}
    return {
        "cases": [ser_case(c) for c in cases],
        "participants": [{"id": p.id, "case_id": p.case_id, "display_name": p.display_name, "role": p.role} for p in parts],
        "documents": [{"id": d.id, "case_id": d.case_id, "title": d.title, "status": d.status,
                       "status_label": DOC_STATUS_LABELS.get(d.status)} for d in doc_list.values()],
        "fragments": frags,
    }


@router.get("/dashboard", summary="Главная панель")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    ids = accessible_case_ids_query(db, user)
    now = datetime.now(timezone.utc)
    active = list(db.scalars(select(Case).where(Case.id.in_(ids), Case.is_archived.is_(False))
                             .order_by(Case.updated_at.desc()).limit(10)))
    total_active = db.scalar(select(func.count()).select_from(Case).where(Case.id.in_(ids), Case.is_archived.is_(False)))
    in_work = list(db.scalars(select(Document).where(Document.case_id.in_(ids),
                                                     Document.status.in_(("draft", "awaiting_input", "analyzing")))
                              .order_by(Document.updated_at.desc()).limit(10)))
    review = list(db.scalars(select(Document).where(Document.case_id.in_(ids), Document.status == "needs_review")
                             .order_by(Document.updated_at.desc()).limit(10)))
    deadlines = list(db.scalars(select(Deadline).where(Deadline.case_id.in_(ids), Deadline.status.in_(("unconfirmed", "confirmed")),
                                                       Deadline.due_at <= now + timedelta(days=14)).order_by(Deadline.due_at).limit(15)))
    uploads = list(db.scalars(select(SourceFile).where(SourceFile.case_id.in_(ids)).order_by(SourceFile.uploaded_at.desc()).limit(10)))
    history = list(db.scalars(select(AuditEvent).where(AuditEvent.user_id == user.id, AuditEvent.category == "action")
                              .order_by(AuditEvent.id.desc()).limit(15)))
    cases_by_id = {c.id: c for c in db.scalars(select(Case).where(Case.id.in_(ids)))}
    missing = []
    for c in active:
        gaps = [lbl for key, lbl in (("case_number", "номер дела"), ("qualification", "квалификация"),
                                     ("head_name", "руководитель"), ("city", "место"), ("investigator_position", "должность следователя"))
                if not getattr(c, key) and not (c.stage == "check" and key == "case_number")]
        if gaps:
            missing.append({"case_id": c.id, "reg_id": c.reg_id, "case_number": c.case_number, "missing": gaps})

    def doc_item(d):
        c = cases_by_id.get(d.case_id)
        return {"id": d.id, "title": d.title, "status": d.status, "status_label": DOC_STATUS_LABELS.get(d.status),
                "case_id": d.case_id, "case_number": c.case_number if c else None, "updated_at": iso(d.updated_at)}

    return {
        "counts": {"active_cases": total_active, "in_work": len(in_work), "needs_review": len(review),
                   "deadlines_14d": len(deadlines)},
        "recent_cases": [ser_case(c) for c in active],
        "documents_in_work": [doc_item(d) for d in in_work],
        "documents_review": [doc_item(d) for d in review],
        "deadlines": [ser_deadline(d) | {"case_number": cases_by_id[d.case_id].case_number if d.case_id in cases_by_id else None,
                                         "overdue": (d.due_at if d.due_at.tzinfo else d.due_at.replace(tzinfo=timezone.utc)) < now}
                      for d in deadlines],
        "missing_data": missing,
        "recent_uploads": [ser_file(f) | {"case_number": cases_by_id[f.case_id].case_number if f.case_id in cases_by_id else None}
                           for f in uploads],
        "history": [{"at": iso(h.at), "action": h.action, "object_type": h.object_type, "object_id": h.object_id,
                     "case_id": h.case_id} for h in history],
    }


@router.get("/system/status", summary="Состояние установленных модулей")
def system_status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = ai_provider.provider()
    return {
        "ai": {"provider": settings.ai_provider, "available": p.available(),
               "model": settings.ollama_model if settings.ai_provider == "ollama" else None},
        "ocr": {"engine": ocr.available_engine()},
        "legal_registry_updated_at": legal.registry_updated_at(db),
        "templates": catalog_sync.count(db),
        "max_upload_mb": settings.max_upload_mb,
        "antivirus": bool(settings.clamd_socket),
        "session_idle_minutes": settings.session_idle_minutes,
        "today": date.today().isoformat(),
    }


class SettingIn(BaseModel):
    value: dict | list | str | int | None


EDITABLE_SETTINGS = {"nonworking_days", "organization_name"}


@router.get("/settings", summary="Настройки")
def get_settings(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return {s.key: s.value for s in db.scalars(select(Setting))}


@router.put("/settings/{key}", summary="Изменение настройки")
def put_setting(key: str, body: SettingIn, request: Request, user: User = Depends(require_perm("settings.manage")),
                db: Session = Depends(get_db)):
    if key not in EDITABLE_SETTINGS:
        raise HTTPException(422, "Настройка не может быть изменена через интерфейс")
    if key == "nonworking_days":
        if not isinstance(body.value, list):
            raise HTTPException(422, "Ожидается список дат")
        try:
            body.value = sorted({date.fromisoformat(str(x)).isoformat() for x in body.value})
        except ValueError:
            raise HTTPException(422, "Даты указываются в формате ГГГГ-ММ-ДД")
    s = db.get(Setting, key)
    if s is None:
        db.add(Setting(key=key, value=body.value, updated_by=user.id))
    else:
        s.value = body.value
        s.updated_by = user.id
    db.commit()
    audit.record(db, "settings.update", user=user, object_type="setting", object_id=key, ip=client_ip(request))
    return {"key": key, "value": body.value}



