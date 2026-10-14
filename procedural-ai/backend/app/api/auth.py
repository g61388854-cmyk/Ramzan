from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..db import get_db
from ..deps import client_ip, current_user, get_session_and_user
from ..models import User, UserSession
from ..security import (
    hash_password,
    new_token,
    password_problems,
    session_expiry,
    token_digest,
    verify_password,
)
from .common import ser_user

router = APIRouter(prefix="/auth", tags=["Аутентификация"])


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class LoginOut(BaseModel):
    token: str
    expires_at: datetime
    idle_minutes: int
    user: dict


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str = Field(min_length=1, max_length=256)


def _aware(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@router.post("/login", response_model=LoginOut, summary="Вход в систему")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.login == body.login))
    now = datetime.now(timezone.utc)
    ip = client_ip(request)
    if user is not None and user.locked_until and _aware(user.locked_until) > now:
        audit.record(None, "auth.login_locked", user=user, category="security", success=False, ip=ip)
        raise HTTPException(status.HTTP_423_LOCKED, "Учётная запись временно заблокирована после неудачных попыток входа")
    if user is None or not user.is_active or not verify_password(user.password_hash, body.password):
        if user is not None:
            user.failed_logins += 1
            if user.failed_logins >= settings.login_max_failures:
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
                user.failed_logins = 0
            db.commit()
        audit.record(None, "auth.login_failed", user=user, category="security", success=False, ip=ip,
                     details={"login": body.login})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    token = new_token()
    sess = UserSession(user_id=user.id, token_hash=token_digest(token), expires_at=session_expiry(now),
                       last_seen_at=now, ip=ip)
    db.add(sess)
    db.commit()
    audit.record(db, "auth.login", user=user, category="security", ip=ip, object_type="session", object_id=sess.id)
    return LoginOut(token=token, expires_at=sess.expires_at, idle_minutes=settings.session_idle_minutes,
                    user=ser_user(user))


@router.post("/logout", summary="Выход из системы")
def logout(request: Request, pair=Depends(get_session_and_user), db: Session = Depends(get_db)):
    sess, user = pair
    s = db.get(UserSession, sess.id)
    s.revoked = True
    db.commit()
    audit.record(db, "auth.logout", user=user, category="security", ip=client_ip(request))
    return {"ok": True}


@router.get("/me", summary="Текущий пользователь")
def me(user: User = Depends(current_user)):
    return ser_user(user) | {"idle_minutes": settings.session_idle_minutes}


@router.post("/change-password", summary="Смена пароля")
def change_password(body: ChangePasswordIn, request: Request, pair=Depends(get_session_and_user),
                    db: Session = Depends(get_db)):
    sess, user = pair
    user = db.get(User, user.id)
    if not verify_password(user.password_hash, body.old_password):
        audit.record(None, "auth.password_change_failed", user=user, category="security", success=False,
                     ip=client_ip(request))
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Текущий пароль указан неверно")
    problems = password_problems(body.new_password)
    if problems:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "; ".join(problems))
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    # Завершение всех остальных сессий пользователя
    for other in db.scalars(select(UserSession).where(UserSession.user_id == user.id, UserSession.id != sess.id)):
        other.revoked = True
    db.commit()
    audit.record(db, "auth.password_changed", user=user, category="security", ip=client_ip(request))
    return {"ok": True}
