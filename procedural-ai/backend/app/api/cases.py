from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..deps import accessible_case_ids_query, case_access_level, client_ip, current_user, has_perm, load_case
from ..models import (
    Case,
    CaseEvent,
    CaseMember,
    CaseParticipant,
    ChangeHistory,
    Deadline,
    Discrepancy,
    Document,
    ExtractedEntity,
    FactClaim,
    SourceFile,
    User,
)
from ..services import participants_schema
from ..services.generator import PARTICIPANT_ROLES, STAGE_LABELS
from .common import (
    case_state,
    iso,
    participant_state,
    record_change,
    ser_case,
    ser_event,
    ser_participant,
)

router = APIRouter(tags=["Уголовные дела"])

STAGES = list(STAGE_LABELS)


class CaseIn(BaseModel):
    case_number: str | None = Field(default=None, max_length=64)
    opened_at: date | None = None
    investigative_body: str | None = Field(default=None, max_length=512)
    unit: str | None = Field(default=None, max_length=255)
    investigator_id: str | None = None
    investigator_position: str | None = Field(default=None, max_length=255)
    head_name: str | None = Field(default=None, max_length=255)
    head_position: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=255)
    qualification: str | None = Field(default=None, max_length=512)
    fabula: str | None = Field(default=None, max_length=20000)
    stage: str = "check"
    key_dates: dict[str, str] = Field(default_factory=dict)


class CasePatch(BaseModel):
    case_number: str | None = Field(default=None, max_length=64)
    opened_at: date | None = None
    investigative_body: str | None = Field(default=None, max_length=512)
    unit: str | None = Field(default=None, max_length=255)
    investigator_id: str | None = None
    investigator_position: str | None = Field(default=None, max_length=255)
    head_name: str | None = Field(default=None, max_length=255)
    head_position: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=255)
    qualification: str | None = Field(default=None, max_length=512)
    fabula: str | None = Field(default=None, max_length=20000)
    stage: str | None = None
    key_dates: dict[str, str] | None = None
    is_archived: bool | None = None


class MemberIn(BaseModel):
    user_id: str
    access: str = Field(default="write", pattern="^(read|write)$")


class ParticipantIn(BaseModel):
    role: str
    kind: str = Field(default="person", pattern="^(person|organization)$")
    last_name: str | None = Field(default=None, max_length=128)
    first_name: str | None = Field(default=None, max_length=128)
    patronymic: str | None = Field(default=None, max_length=128)
    org_name: str | None = Field(default=None, max_length=512)
    data: dict = Field(default_factory=dict)


class ParticipantPatch(BaseModel):
    role: str | None = None
    last_name: str | None = Field(default=None, max_length=128)
    first_name: str | None = Field(default=None, max_length=128)
    patronymic: str | None = Field(default=None, max_length=128)
    org_name: str | None = Field(default=None, max_length=512)
    data: dict | None = None
    is_archived: bool | None = None


class EventIn(BaseModel):
    occurred_at: datetime
    event_type: str = Field(max_length=32)
    title: str = Field(min_length=1, max_length=512)
    description: str | None = Field(default=None, max_length=10000)
    document_id: str | None = None
    file_id: str | None = None


EVENT_TYPES = {
    "decision": "Процессуальное решение", "action": "Следственное действие", "expertise": "Экспертиза",
    "request": "Запрос / поручение", "reply": "Поступивший ответ", "movement": "Движение дела", "other": "Иное",
}


def _next_reg_id(db: Session) -> str:
    year = date.today().year
    prefix = f"PAI-{year}-"
    n = db.scalar(select(func.count()).select_from(Case).where(Case.reg_id.like(prefix + "%"))) or 0
    return f"{prefix}{n + 1:06d}"


@router.get("/cases", summary="Список доступных дел")
def list_cases(
    q: str | None = None,
    stage: str | None = None,
    archived: bool = False,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Case).where(Case.id.in_(accessible_case_ids_query(db, user)), Case.is_archived.is_(archived))
    if stage:
        stmt = stmt.where(Case.stage == stage)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Case.case_number.ilike(like), Case.reg_id.ilike(like), Case.fabula.ilike(like),
                              Case.qualification.ilike(like)))
    cases = list(db.scalars(stmt.order_by(Case.updated_at.desc()).limit(500)))
    return [ser_case(c, case_access_level(db, user, c)) for c in cases]


@router.post("/cases", status_code=201, summary="Создание карточки уголовного дела")
def create_case(body: CaseIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not has_perm(user, "cases.create"):
        audit.record(None, "access.denied", user=user, category="security", success=False, ip=client_ip(request),
                     details={"permission": "cases.create"})
        raise HTTPException(403, "Недостаточно полномочий для создания дела")
    if body.stage not in STAGES:
        raise HTTPException(422, "Неизвестная стадия")
    data = body.model_dump()
    if not data.get("investigator_id"):
        data["investigator_id"] = user.id
    if not data.get("unit"):
        data["unit"] = user.unit
    if not data.get("investigator_position") and user.position:
        data["investigator_position"] = user.position
    for attempt in range(3):
        c = Case(reg_id=_next_reg_id(db), created_by=user.id, **data)
        db.add(c)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if attempt == 2:
                raise
    if c.investigator_id != user.id:
        db.add(CaseMember(case_id=c.id, user_id=c.investigator_id, access="write"))
        db.commit()
    record_change(db, "case", c.id, c.id, user, None, case_state(c), "Создание карточки")
    db.commit()
    audit.record(db, "case.create", user=user, object_type="case", object_id=c.id, case_id=c.id, ip=client_ip(request))
    db.refresh(c)
    return ser_case(c, "write")


@router.get("/cases/{case_id}", summary="Карточка дела")
def get_case(case_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = load_case(db, case_id, user, request)
    counts = {
        "participants": db.scalar(select(func.count()).select_from(CaseParticipant).where(CaseParticipant.case_id == c.id, CaseParticipant.is_archived.is_(False))),
        "files": db.scalar(select(func.count()).select_from(SourceFile).where(SourceFile.case_id == c.id, SourceFile.is_archived.is_(False))),
        "documents": db.scalar(select(func.count()).select_from(Document).where(Document.case_id == c.id, Document.status != "archived")),
        "facts_unverified": db.scalar(select(func.count()).select_from(FactClaim).where(FactClaim.case_id == c.id, FactClaim.status == "unverified")),
        "discrepancies_open": db.scalar(select(func.count()).select_from(Discrepancy).where(Discrepancy.case_id == c.id, Discrepancy.status == "open")),
        "deadlines_active": db.scalar(select(func.count()).select_from(Deadline).where(Deadline.case_id == c.id, Deadline.status.in_(("unconfirmed", "confirmed")))),
    }
    missing = [label for key, label in (("case_number", "номер дела"), ("opened_at", "дата возбуждения"),
                                        ("investigative_body", "орган расследования"), ("qualification", "квалификация"),
                                        ("head_name", "руководитель следственного органа"), ("city", "место (населённый пункт)"),
                                        ("investigator_position", "должность следователя"))
               if not getattr(c, key)]
    if c.stage == "check":
        missing = [m for m in missing if m not in ("номер дела", "дата возбуждения")]
    members = [{"user_id": m.user_id, "access": m.access,
                "full_name": (db.get(User, m.user_id).full_name if db.get(User, m.user_id) else None)}
               for m in db.scalars(select(CaseMember).where(CaseMember.case_id == c.id))]
    return ser_case(c, case_access_level(db, user, c)) | {"counts": counts, "missing_fields": missing, "members": members}


@router.patch("/cases/{case_id}", summary="Изменение карточки дела")
def update_case(case_id: str, body: CasePatch, request: Request, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    c = load_case(db, case_id, user, request, need="write")
    before = case_state(c)
    changes = body.model_dump(exclude_unset=True)
    if "stage" in changes and changes["stage"] not in STAGES:
        raise HTTPException(422, "Неизвестная стадия")
    for k, v in changes.items():
        setattr(c, k, v)
    record_change(db, "case", c.id, c.id, user, before, case_state(c))
    db.commit()
    audit.record(db, "case.archive" if changes.get("is_archived") else "case.update", user=user, object_type="case",
                 object_id=c.id, case_id=c.id, ip=client_ip(request), details={"fields": sorted(changes)})
    return ser_case(c, case_access_level(db, user, c))


@router.get("/cases/{case_id}/history", summary="История изменений по делу")
def case_history(case_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    load_case(db, case_id, user, request)
    rows = db.scalars(select(ChangeHistory).where(ChangeHistory.case_id == case_id).order_by(ChangeHistory.id.desc()).limit(500))
    users = {u.id: u.full_name for u in db.scalars(select(User))}
    return [{"id": r.id, "entity_type": r.entity_type, "entity_id": r.entity_id, "changed_by": users.get(r.changed_by),
             "changed_at": iso(r.changed_at), "before": r.before, "after": r.after, "note": r.note} for r in rows]


@router.post("/cases/{case_id}/members", summary="Предоставление доступа к делу")
def add_member(case_id: str, body: MemberIn, request: Request, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    c = load_case(db, case_id, user, request, need="write")
    if not (c.investigator_id == user.id or c.created_by == user.id or has_perm(user, "cases.unit_access")):
        raise HTTPException(403, "Доступ к делу предоставляет следователь, в производстве которого находится дело, либо руководитель")
    target = db.get(User, body.user_id)
    if target is None:
        raise HTTPException(404, "Пользователь не найден")
    m = db.get(CaseMember, (c.id, target.id))
    if m is None:
        db.add(CaseMember(case_id=c.id, user_id=target.id, access=body.access))
    else:
        m.access = body.access
    db.commit()
    audit.record(db, "case.member_add", user=user, object_type="case", object_id=c.id, case_id=c.id,
                 ip=client_ip(request), details={"member": target.login, "access": body.access})
    return {"ok": True}


@router.delete("/cases/{case_id}/members/{user_id}", summary="Отзыв доступа к делу")
def remove_member(case_id: str, user_id: str, request: Request, user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    c = load_case(db, case_id, user, request, need="write")
    if not (c.investigator_id == user.id or c.created_by == user.id or has_perm(user, "cases.unit_access")):
        raise HTTPException(403, "Недостаточно полномочий")
    m = db.get(CaseMember, (c.id, user_id))
    if m:
        db.delete(m)
        db.commit()
    audit.record(db, "case.member_remove", user=user, object_type="case", object_id=c.id, case_id=c.id,
                 ip=client_ip(request), details={"member_id": user_id})
    return {"ok": True}


# --- участники ------------------------------------------------------------------

@router.get("/participants/schema", summary="Схемы полей участников по ролям")
def participant_schema(_: User = Depends(current_user)):
    return {
        "roles": [{"code": k, "label": v} for k, v in PARTICIPANT_ROLES.items()],
        "schemas": {role: {"person": participants_schema.schema_for(role, "person"),
                           "organization": participants_schema.schema_for(role, "organization")}
                    for role in PARTICIPANT_ROLES},
    }


def _clean_data(role: str, kind: str, data: dict) -> dict:
    allowed = participants_schema.allowed_keys(role, kind)
    return {k: (v.strip() if isinstance(v, str) else v) for k, v in (data or {}).items()
            if k in allowed and v not in (None, "")}


@router.get("/cases/{case_id}/participants", summary="Участники дела")
def list_participants(case_id: str, request: Request, archived: bool = False, user: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    load_case(db, case_id, user, request)
    stmt = select(CaseParticipant).where(CaseParticipant.case_id == case_id)
    if not archived:
        stmt = stmt.where(CaseParticipant.is_archived.is_(False))
    return [ser_participant(p) for p in db.scalars(stmt.order_by(CaseParticipant.role, CaseParticipant.last_name))]


@router.post("/cases/{case_id}/participants", status_code=201, summary="Добавление участника")
def create_participant(case_id: str, body: ParticipantIn, request: Request, user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    c = load_case(db, case_id, user, request, need="write")
    if body.role not in PARTICIPANT_ROLES:
        raise HTTPException(422, "Неизвестное процессуальное положение")
    if body.kind == "person" and not body.last_name:
        raise HTTPException(422, "Для физического лица необходимо указать фамилию")
    if body.kind == "organization" and not body.org_name:
        raise HTTPException(422, "Для организации необходимо указать наименование")
    p = CaseParticipant(case_id=c.id, role=body.role, kind=body.kind, last_name=body.last_name,
                        first_name=body.first_name, patronymic=body.patronymic, org_name=body.org_name,
                        data=_clean_data(body.role, body.kind, body.data))
    db.add(p)
    db.flush()
    record_change(db, "participant", p.id, c.id, user, None, participant_state(p), "Добавление участника")
    db.commit()
    audit.record(db, "participant.create", user=user, object_type="participant", object_id=p.id, case_id=c.id,
                 ip=client_ip(request))
    return ser_participant(p)


@router.patch("/participants/{pid}", summary="Изменение карточки участника")
def update_participant(pid: str, body: ParticipantPatch, request: Request, user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    p = db.get(CaseParticipant, pid)
    if p is None:
        raise HTTPException(404, "Участник не найден")
    load_case(db, p.case_id, user, request, need="write")
    before = participant_state(p)
    changes = body.model_dump(exclude_unset=True)
    if "role" in changes and changes["role"] not in PARTICIPANT_ROLES:
        raise HTTPException(422, "Неизвестное процессуальное положение")
    for k, v in changes.items():
        if k == "data":
            continue
        setattr(p, k, v)
    if "data" in changes:
        p.data = _clean_data(p.role, p.kind, changes["data"])
    record_change(db, "participant", p.id, p.case_id, user, before, participant_state(p))
    db.commit()
    audit.record(db, "participant.archive" if changes.get("is_archived") else "participant.update", user=user,
                 object_type="participant", object_id=p.id, case_id=p.case_id, ip=client_ip(request))
    return ser_participant(p)


# --- процессуальная история -------------------------------------------------------

@router.get("/cases/{case_id}/events", summary="Процессуальная история")
def list_events(case_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    load_case(db, case_id, user, request)
    return [ser_event(e) for e in db.scalars(select(CaseEvent).where(CaseEvent.case_id == case_id, CaseEvent.is_archived.is_(False))
                                              .order_by(CaseEvent.occurred_at))]


@router.post("/cases/{case_id}/events", status_code=201, summary="Регистрация события")
def create_event(case_id: str, body: EventIn, request: Request, user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    c = load_case(db, case_id, user, request, need="write")
    if body.event_type not in EVENT_TYPES:
        raise HTTPException(422, "Неизвестный тип события")
    e = CaseEvent(case_id=c.id, created_by=user.id, **body.model_dump())
    db.add(e)
    db.commit()
    audit.record(db, "event.create", user=user, object_type="event", object_id=e.id, case_id=c.id, ip=client_ip(request))
    return ser_event(e)


@router.patch("/events/{event_id}", summary="Изменение (архивирование) события")
def update_event(event_id: str, body: dict, request: Request, user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    e = db.get(CaseEvent, event_id)
    if e is None:
        raise HTTPException(404, "Событие не найдено")
    load_case(db, e.case_id, user, request, need="write")
    before = ser_event(e)
    for k in ("title", "description", "event_type", "is_archived"):
        if k in body:
            setattr(e, k, body[k])
    if "occurred_at" in body:
        e.occurred_at = datetime.fromisoformat(body["occurred_at"])
    record_change(db, "event", e.id, e.case_id, user, before, ser_event(e))
    db.commit()
    return ser_event(e)


@router.get("/cases/{case_id}/timeline", summary="Хронология (события дела и даты из материалов)")
def timeline(case_id: str, request: Request, include_extracted: bool = Query(True), user: User = Depends(current_user),
             db: Session = Depends(get_db)):
    load_case(db, case_id, user, request)
    items = [{"date": iso(e.occurred_at), "kind": "event", "event_type": e.event_type, "title": e.title,
              "description": e.description, "machine": False, "id": e.id}
             for e in db.scalars(select(CaseEvent).where(CaseEvent.case_id == case_id, CaseEvent.is_archived.is_(False)))]
    if include_extracted:
        files = {f.id: f for f in db.scalars(select(SourceFile).where(SourceFile.case_id == case_id))}
        for ent in db.scalars(select(ExtractedEntity).where(ExtractedEntity.case_id == case_id,
                                                            ExtractedEntity.entity_type.in_(("incident_date", "date")))):
            f = files.get(ent.file_id)
            if f is None or f.is_archived:
                continue
            items.append({"date": ent.normalized, "kind": "extracted", "event_type": ent.entity_type,
                          "title": f"Упоминание даты ({f.source_code})", "description": ent.context, "machine": True,
                          "file_id": ent.file_id, "fragment_id": ent.fragment_id, "id": ent.id})
    items.sort(key=lambda x: (x["date"] or ""))
    return items


@router.get("/meta/stages", summary="Справочник стадий и типов событий")
def stages(_: User = Depends(current_user)):
    return {"stages": [{"code": k, "label": v} for k, v in STAGE_LABELS.items()],
            "event_types": [{"code": k, "label": v} for k, v in EVENT_TYPES.items()],
            "now": datetime.now(timezone.utc).isoformat()}
