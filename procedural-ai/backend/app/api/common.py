"""Общие функции API: сериализация сущностей и история изменений."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from ..models import (
    Case,
    CaseEvent,
    CaseParticipant,
    ChangeHistory,
    Deadline,
    Discrepancy,
    Document,
    DocumentVersion,
    FactClaim,
    SourceFile,
    Task,
    User,
)
from ..services.generator import PARTICIPANT_ROLES, STAGE_LABELS

DOC_STATUS_LABELS = {
    "draft": "Черновик",
    "awaiting_input": "Ожидает заполнения",
    "analyzing": "Анализируется",
    "needs_review": "Требует проверки",
    "reviewed": "Проверен пользователем",
    "approved": "Утверждён пользователем",
    "exported": "Экспортирован",
    "archived": "Архивирован",
}


def iso(v: Any) -> Any:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def record_change(db: Session, entity_type: str, entity_id: str, case_id: str | None, user: User | None,
                  before: dict | None, after: dict | None, note: str | None = None) -> None:
    if before == after:
        return
    db.add(ChangeHistory(entity_type=entity_type, entity_id=entity_id, case_id=case_id,
                         changed_by=user.id if user else None, before=before, after=after, note=note))


def ser_user(u: User | None) -> dict | None:
    if u is None:
        return None
    return {"id": u.id, "login": u.login, "full_name": u.full_name, "position": u.position, "unit": u.unit,
            "role": u.role.code, "role_title": u.role.title, "permissions": u.role.permissions,
            "is_active": u.is_active, "must_change_password": u.must_change_password,
            "last_login_at": iso(u.last_login_at)}


def case_state(c: Case) -> dict:
    return {
        "case_number": c.case_number, "opened_at": iso(c.opened_at), "investigative_body": c.investigative_body,
        "unit": c.unit, "investigator_id": c.investigator_id, "head_name": c.head_name, "head_position": c.head_position,
        "investigator_position": c.investigator_position, "city": c.city, "qualification": c.qualification,
        "fabula": c.fabula, "stage": c.stage, "key_dates": c.key_dates or {}, "is_archived": c.is_archived,
    }


def ser_case(c: Case, access: str | None = None) -> dict:
    d = {"id": c.id, "reg_id": c.reg_id, **case_state(c), "stage_label": STAGE_LABELS.get(c.stage, c.stage),
         "investigator": ser_user(c.investigator) if c.investigator else None,
         "created_at": iso(c.created_at), "updated_at": iso(c.updated_at)}
    if access:
        d["access"] = access
    return d


def participant_state(p: CaseParticipant) -> dict:
    return {"role": p.role, "kind": p.kind, "last_name": p.last_name, "first_name": p.first_name,
            "patronymic": p.patronymic, "org_name": p.org_name, "data": p.data or {}, "is_archived": p.is_archived}


def ser_participant(p: CaseParticipant) -> dict:
    return {"id": p.id, "case_id": p.case_id, **participant_state(p), "display_name": p.display_name,
            "role_label": PARTICIPANT_ROLES.get(p.role, p.role), "created_at": iso(p.created_at),
            "updated_at": iso(p.updated_at)}


def ser_event(e: CaseEvent) -> dict:
    return {"id": e.id, "case_id": e.case_id, "occurred_at": iso(e.occurred_at), "event_type": e.event_type,
            "title": e.title, "description": e.description, "document_id": e.document_id, "file_id": e.file_id,
            "is_archived": e.is_archived, "created_at": iso(e.created_at)}


def ser_file(f: SourceFile) -> dict:
    return {"id": f.id, "case_id": f.case_id, "source_code": f.source_code, "original_name": f.original_name,
            "mime": f.mime, "ext": f.ext, "size": f.size, "sha256": f.sha256, "category": f.category,
            "detected_kind": f.detected_kind, "status": f.status, "text_method": f.text_method,
            "machine_generated": f.machine_generated, "page_count": f.page_count, "error": f.error,
            "notes": f.notes, "is_archived": f.is_archived, "uploaded_at": iso(f.uploaded_at),
            "processed_at": iso(f.processed_at)}


def ser_fact(f: FactClaim, files: dict[str, SourceFile] | None = None) -> dict:
    files = files or {}
    return {
        "id": f.id, "case_id": f.case_id, "fact_type": f.fact_type, "label": f.label, "content": f.content,
        "normalized": f.normalized, "origin": f.origin, "status": f.status, "edited_manually": f.edited_manually,
        "original_content": f.original_content, "machine_generated": f.machine_generated,
        "confidence": f.confidence, "verified_by": f.verified_by, "verified_at": iso(f.verified_at),
        "created_at": iso(f.created_at),
        "sources": [{"file_id": s.file_id, "source_code": files[s.file_id].source_code if s.file_id in files else None,
                     "file_name": files[s.file_id].original_name if s.file_id in files else None,
                     "fragment_id": s.fragment_id, "page": s.page, "char_start": s.char_start,
                     "char_end": s.char_end, "quote": s.quote} for s in f.sources],
    }


def ser_discrepancy(d: Discrepancy) -> dict:
    return {"id": d.id, "case_id": d.case_id, "kind": d.kind, "description": d.description, "items": d.items,
            "status": d.status, "resolution_note": d.resolution_note, "created_at": iso(d.created_at)}


def ser_document(d: Document, current: DocumentVersion | None = None) -> dict:
    t = d.template
    return {
        "id": d.id, "case_id": d.case_id, "type_code": d.type_code, "title": d.title, "status": d.status,
        "status_label": DOC_STATUS_LABELS.get(d.status, d.status), "generation_mode": d.generation_mode,
        "kit_id": d.kit_id, "kit_code": d.kit_code, "author_id": d.author_id,
        "reviewed_by": d.reviewed_by, "reviewed_at": iso(d.reviewed_at), "approved_by": d.approved_by,
        "approved_at": iso(d.approved_at), "created_at": iso(d.created_at), "updated_at": iso(d.updated_at),
        "template": {"id": t.id, "type_code": t.type_code, "version": t.version, "title": t.title,
                     "procedural_kind": t.procedural_kind, "author_role": t.author_role, "addressee": t.addressee,
                     "requires_court": t.requires_court, "requires_head_consent": t.requires_head_consent} if t else None,
        "current_version": ser_version(current) if current else None,
    }


def ser_version(v: DocumentVersion, with_content: bool = True) -> dict:
    d = {"id": v.id, "document_id": v.document_id, "number": v.number, "template_version": v.template_version,
         "comment": v.comment, "created_by": v.created_by, "created_at": iso(v.created_at),
         "validation_summary": (v.validation or {}).get("summary")}
    if with_content:
        d.update({"content_html": v.content_html, "field_values": v.field_values, "field_sources": v.field_sources,
                  "validation": v.validation})
    return d


def ser_deadline(d: Deadline) -> dict:
    return {"id": d.id, "case_id": d.case_id, "rule_code": d.rule_code, "title": d.title,
            "participant_id": d.participant_id, "start_at": iso(d.start_at), "params": d.params,
            "adjustments": d.adjustments, "due_at": iso(d.due_at), "calculation": d.calculation,
            "legal_basis_key": d.legal_basis_key, "source_note": d.source_note, "status": d.status,
            "notify_days_before": d.notify_days_before, "confirmed_by": d.confirmed_by,
            "confirmed_at": iso(d.confirmed_at), "created_at": iso(d.created_at)}


def ser_task(t: Task) -> dict:
    return {"id": t.id, "kind": t.kind, "status": t.status, "progress": t.progress, "message": t.message,
            "case_id": t.case_id, "file_id": t.file_id, "document_id": t.document_id, "result": t.result,
            "error": t.error, "created_at": iso(t.created_at), "started_at": iso(t.started_at),
            "finished_at": iso(t.finished_at)}
