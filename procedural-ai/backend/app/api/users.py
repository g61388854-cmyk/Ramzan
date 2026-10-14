from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..deps import client_ip, current_user, require_perm
from ..models import Role, User, UserSession
from ..security import ROLES, hash_password, password_problems
from .common import ser_user

router = APIRouter(prefix="/users", tags=["Пользователи и роли"])


class UserIn(BaseModel):
    login: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.\-]+$")
    full_name: str = Field(min_length=3, max_length=255)
    position: str | None = Field(default=None, max_length=255)
    unit: str | None = Field(default=None, max_length=255)
    role: str
    password: str = Field(min_length=1, max_length=256)


class UserPatch(BaseModel):
    full_name: str | None = Field(default=None, max_length=255)
    position: str | None = Field(default=None, max_length=255)
    unit: str | None = Field(default=None, max_length=255)
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, max_length=256)


@router.get("/roles", summary="Ролевая модель")
def roles(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return [{"code": r.code, "title": r.title, "permissions": r.permissions} for r in db.scalars(select(Role))]


@router.get("/directory", summary="Справочник сотрудников (для назначения на дело)")
def directory(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return [{"id": u.id, "full_name": u.full_name, "position": u.position, "unit": u.unit, "role": u.role.code}
            for u in db.scalars(select(User).where(User.is_active.is_(True)).order_by(User.full_name))]


@router.get("", summary="Список учётных записей")
def list_users(_: User = Depends(require_perm("users.manage")), db: Session = Depends(get_db)):
    return [ser_user(u) for u in db.scalars(select(User).order_by(User.login))]


@router.post("", status_code=201, summary="Создание учётной записи")
def create_user(body: UserIn, request: Request, admin: User = Depends(require_perm("users.manage")),
                db: Session = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(422, "Неизвестная роль")
    problems = password_problems(body.password)
    if problems:
        raise HTTPException(422, "; ".join(problems))
    role = db.scalar(select(Role).where(Role.code == body.role))
    u = User(login=body.login, full_name=body.full_name, position=body.position, unit=body.unit, role_id=role.id,
             password_hash=hash_password(body.password), must_change_password=True)
    db.add(u)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Логин уже используется")
    audit.record(db, "user.create", user=admin, object_type="user", object_id=u.id, ip=client_ip(request),
                 details={"login": u.login, "role": body.role})
    return ser_user(u)


@router.patch("/{user_id}", summary="Изменение учётной записи")
def update_user(user_id: str, body: UserPatch, request: Request, admin: User = Depends(require_perm("users.manage")),
                db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "Пользователь не найден")
    changes = body.model_dump(exclude_unset=True)
    if "role" in changes:
        role = db.scalar(select(Role).where(Role.code == changes.pop("role")))
        if role is None:
            raise HTTPException(422, "Неизвестная роль")
        if u.id == admin.id and role.code != "admin":
            raise HTTPException(status.HTTP_409_CONFLICT, "Нельзя снять с себя роль администратора")
        u.role_id = role.id
    if "password" in changes:
        pw = changes.pop("password")
        if pw:
            problems = password_problems(pw)
            if problems:
                raise HTTPException(422, "; ".join(problems))
            u.password_hash = hash_password(pw)
            u.must_change_password = True
            for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id)):
                s.revoked = True
    if changes.get("is_active") is False:
        if u.id == admin.id:
            raise HTTPException(409, "Нельзя заблокировать собственную учётную запись")
        for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id)):
            s.revoked = True
    for k, v in changes.items():
        setattr(u, k, v)
    db.commit()
    db.refresh(u)
    audit.record(db, "user.update", user=admin, object_type="user", object_id=u.id, ip=client_ip(request),
                 details={k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "password"})
    return ser_user(u)
