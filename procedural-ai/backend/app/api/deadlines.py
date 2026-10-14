from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..deps import accessible_case_ids_query, client_ip, current_user, load_case
from ..models import Case, Deadline, Setting, User
from ..services import deadlines_calc
from .common import iso, record_change, ser_deadline

router = APIRouter(tags=["Процессуальные сроки"])


class DeadlineIn(BaseModel):
    rule_code: str
    title: str | None = Field(default=None, max_length=512)
    start_at: datetime
    participant_id: str | None = None
    params: dict = Field(default_factory=dict)
    adjustments: list = Field(default_factory=list)
    source_note: str | None = Field(default=None, max_length=4000)
    notify_days_before: int = Field(default=3, ge=0, le=60)


class DeadlinePatch(BaseModel):
    title: str | None = Field(default=None, max_length=512)
    start_at: datetime | None = None
    params: dict | None = None
    adjustments: list | None = None
    source_note: str | None = Field(default=None, max_length=4000)
    status: str | None = Field(default=None, pattern="^(unconfirmed|confirmed|closed|cancelled)$")
    notify_days_before: int | None = Field(default=None, ge=0, le=60)


def _holidays(db: Session) -> list[str]:
    s = db.get(Setting, "nonworking_days")
    return list(s.value) if s and isinstance(s.value, list) else []


def _compute(db: Session, d: Deadline) -> None:
    res = deadlines_calc.compute(d.rule_code, d.start_at, d.params, d.adjustments, _holidays(db))
    d.due_at = datetime.fromisoformat(res["due_at"]) if res["due_at"] else None
    d.calculation = res
    d.legal_basis_key = res["basis_key"] or d.legal_basis_key


@router.get("/deadlines/rules", summary="Правила расчёта сроков")
def rules(_: User = Depends(current_user)):
    return [{"code": r.code, "title": r.title, "basis": r.basis_text, "basis_key": r.basis_key, "unit": r.unit,
             "amount": r.amount, "include_start_day": r.include_start_day, "shift_nonworking": r.shift_nonworking,
             "note": r.note} for r in deadlines_calc.RULES.values()]


@router.get("/cases/{case_id}/deadlines", summary="Сроки по делу")
def list_deadlines(case_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    load_case(db, case_id, user, request)
    return [ser_deadline(d) for d in db.scalars(select(Deadline).where(Deadline.case_id == case_id).order_by(Deadline.due_at))]


@router.post("/cases/{case_id}/deadlines", status_code=201, summary="Регистрация контрольного события и расчёт срока")
def create_deadline(case_id: str, body: DeadlineIn, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    c = load_case(db, case_id, user, request, need="write")
    rule = deadlines_calc.RULES.get(body.rule_code)
    if rule is None:
        raise HTTPException(422, "Неизвестное правило расчёта")
    if body.rule_code == "custom" and not body.params.get("amount"):
        raise HTTPException(422, "Для иного срока укажите величину и единицу измерения")
    d = Deadline(case_id=c.id, rule_code=body.rule_code, title=body.title or rule.title, start_at=body.start_at,
                 participant_id=body.participant_id, params=body.params, adjustments=body.adjustments,
                 source_note=body.source_note, notify_days_before=body.notify_days_before, created_by=user.id,
                 status="unconfirmed")
    _compute(db, d)
    db.add(d)
    db.flush()
    record_change(db, "deadline", d.id, c.id, user, None, ser_deadline(d), "Регистрация срока")
    db.commit()
    audit.record(db, "deadline.create", user=user, object_type="deadline", object_id=d.id, case_id=c.id, ip=client_ip(request))
    return ser_deadline(d)


@router.post("/deadlines/preview", summary="Расчёт без сохранения")
def preview(body: DeadlineIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.rule_code not in deadlines_calc.RULES:
        raise HTTPException(422, "Неизвестное правило расчёта")
    return deadlines_calc.compute(body.rule_code, body.start_at, body.params, body.adjustments, _holidays(db))


@router.patch("/deadlines/{deadline_id}", summary="Корректировка, подтверждение или закрытие срока")
def update_deadline(deadline_id: str, body: DeadlinePatch, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    d = db.get(Deadline, deadline_id)
    if d is None:
        raise HTTPException(404, "Срок не найден")
    load_case(db, d.case_id, user, request, need="write")
    before = ser_deadline(d)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(d, k, v)
    if any(k in changes for k in ("start_at", "params", "adjustments")):
        _compute(db, d)
        if d.status == "confirmed" and "status" not in changes:
            d.status = "unconfirmed"
            d.confirmed_by = d.confirmed_at = None
    if changes.get("status") == "confirmed":
        d.confirmed_by, d.confirmed_at = user.id, datetime.now(timezone.utc)
    record_change(db, "deadline", d.id, d.case_id, user, before, ser_deadline(d))
    db.commit()
    audit.record(db, "deadline.update", user=user, object_type="deadline", object_id=d.id, case_id=d.case_id,
                 ip=client_ip(request), details={"fields": sorted(changes)})
    return ser_deadline(d)


@router.get("/deadlines/{deadline_id}/history", summary="Журнал изменения срока")
def deadline_history(deadline_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from ..models import ChangeHistory

    d = db.get(Deadline, deadline_id)
    if d is None:
        raise HTTPException(404, "Срок не найден")
    load_case(db, d.case_id, user, request)
    users = {u.id: u.full_name for u in db.scalars(select(User))}
    return [{"changed_at": iso(h.changed_at), "changed_by": users.get(h.changed_by), "before": h.before, "after": h.after,
             "note": h.note}
            for h in db.scalars(select(ChangeHistory).where(ChangeHistory.entity_type == "deadline",
                                                            ChangeHistory.entity_id == d.id).order_by(ChangeHistory.id))]


@router.get("/deadlines", summary="Календарь сроков по доступным делам")
def calendar(days: int = 60, include_overdue: bool = True, user: User = Depends(current_user),
             db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    stmt = select(Deadline, Case).join(Case, Case.id == Deadline.case_id).where(
        Deadline.case_id.in_(accessible_case_ids_query(db, user)),
        Deadline.status.in_(("unconfirmed", "confirmed")),
        Deadline.due_at <= now + timedelta(days=days),
    )
    if not include_overdue:
        stmt = stmt.where(Deadline.due_at >= now)
    out = []
    for d, c in db.execute(stmt.order_by(Deadline.due_at)):
        due = d.due_at if d.due_at.tzinfo else d.due_at.replace(tzinfo=timezone.utc)
        left = (due - now).total_seconds() / 86400
        out.append(ser_deadline(d) | {"case_number": c.case_number, "case_reg_id": c.reg_id,
                                      "overdue": left < 0, "notify": 0 <= left <= d.notify_days_before})
    return out
