"""Зависимости FastAPI: текущий пользователь, проверка полномочий и доступа к делу."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit
from .db import get_db
from .models import Case, CaseMember, User, UserSession
from .security import idle_limit, token_digest

bearer = HTTPBearer(auto_error=False)


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def get_session_and_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> tuple[UserSession, User]:
    token = creds.credentials if creds else None
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется аутентификация")
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == token_digest(token)))
    now = datetime.now(timezone.utc)
    if sess is None or sess.revoked:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия недействительна")
    if _aware(sess.expires_at) < now or now - _aware(sess.last_seen_at) > idle_limit():
        sess.revoked = True
        db.commit()
        audit.record(None, "session.expired", object_type="session", object_id=sess.id, category="security",
                     details={"user_id": sess.user_id})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия завершена по истечении времени бездействия")
    user = db.get(User, sess.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Учётная запись заблокирована")
    sess.last_seen_at = now
    db.commit()
    request.state.user = user
    return sess, user


def current_user(pair: tuple[UserSession, User] = Depends(get_session_and_user)) -> User:
    return pair[1]


def has_perm(user: User, perm: str) -> bool:
    return perm in (user.role.permissions or [])


def require_perm(perm: str):
    def checker(request: Request, user: User = Depends(current_user)) -> User:
        if not has_perm(user, perm):
            audit.record(None, "access.denied", user=user, category="security", success=False,
                         ip=client_ip(request), details={"permission": perm, "path": request.url.path})
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно полномочий")
        return user

    return checker


def case_access_level(db: Session, user: User, case: Case) -> str | None:
    """Возвращает уровень доступа к делу: 'write', 'read' или None."""
    if case.investigator_id == user.id or case.created_by == user.id:
        return "write" if user.role.code != "viewer" else "read"
    member = db.get(CaseMember, (case.id, user.id))
    if member:
        return "read" if user.role.code == "viewer" else member.access
    if has_perm(user, "cases.unit_access") and case.unit and case.unit == user.unit:
        return "write"
    return None


def load_case(db: Session, case_id: str, user: User, request: Request, need: str = "read") -> Case:
    case = db.get(Case, case_id)
    level = case_access_level(db, user, case) if case else None
    if case is None or level is None or (need == "write" and level != "write"):
        audit.record(
            None,
            "case.access_denied",
            user=user,
            object_type="case",
            object_id=case_id,
            case_id=case_id,
            category="security",
            success=False,
            ip=client_ip(request),
            details={"need": need, "path": request.url.path},
        )
        # Для чужого дела не раскрывается сам факт его существования.
        if case is None or level is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Дело не найдено или доступ запрещён")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Доступ только для чтения")
    return case


def accessible_case_ids_query(db: Session, user: User):
    """Подзапрос идентификаторов дел, доступных пользователю."""
    from sqlalchemy import or_

    conds = [Case.investigator_id == user.id, Case.created_by == user.id,
             Case.id.in_(select(CaseMember.case_id).where(CaseMember.user_id == user.id))]
    if has_perm(user, "cases.unit_access") and user.unit:
        conds.append(Case.unit == user.unit)
    return select(Case.id).where(or_(*conds))
