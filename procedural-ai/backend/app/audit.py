"""Журнал значимых действий и событий безопасности."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import AuditEvent, User


def record(
    db: Session | None,
    action: str,
    *,
    user: User | None = None,
    object_type: str | None = None,
    object_id: str | None = None,
    case_id: str | None = None,
    success: bool = True,
    category: str = "action",
    ip: str | None = None,
    details: dict[str, Any] | None = None,
    commit: bool = True,
) -> None:
    """Записывает событие. События безопасности пишутся в отдельной сессии,
    чтобы откат основной транзакции не уничтожал запись об отказе."""
    own = db is None or category == "security"
    session = SessionLocal() if own else db
    try:
        session.add(
            AuditEvent(
                user_id=user.id if user else None,
                user_login=user.login if user else (details or {}).get("login"),
                action=action,
                category=category,
                object_type=object_type,
                object_id=object_id,
                case_id=case_id,
                success=success,
                ip=ip,
                details=details,
            )
        )
        if own or commit:
            session.commit()
    finally:
        if own:
            session.close()
