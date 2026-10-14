"""Аутентификация, сессии и ролевая модель."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .config import settings

_hasher = PasswordHasher()

# Полномочия, не связанные с конкретным делом.
PERMISSIONS = {
    "users.manage": "Управление учётными записями",
    "legal.manage": "Импорт и верификация правовых источников",
    "templates.manage": "Управление каталогом шаблонов",
    "audit.read": "Просмотр журнала действий",
    "settings.manage": "Изменение настроек",
    "cases.create": "Создание уголовных дел",
    "cases.unit_access": "Доступ ко всем делам своего подразделения",
}

ROLES: dict[str, dict] = {
    "admin": {
        "title": "Администратор системы",
        "permissions": ["users.manage", "templates.manage", "audit.read", "settings.manage"],
    },
    "head": {
        "title": "Руководитель следственного органа",
        "permissions": ["cases.create", "cases.unit_access", "audit.read"],
    },
    "investigator": {"title": "Следователь", "permissions": ["cases.create"]},
    "legal_editor": {"title": "Ответственный за правовой справочник", "permissions": ["legal.manage"]},
    "viewer": {"title": "Наблюдатель (только чтение)", "permissions": []},
}

MIN_PASSWORD_LENGTH = 10


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_problems(password: str) -> list[str]:
    problems = []
    if len(password) < MIN_PASSWORD_LENGTH:
        problems.append(f"длина пароля менее {MIN_PASSWORD_LENGTH} символов")
    if password.lower() == password or password.upper() == password:
        problems.append("пароль должен содержать строчные и прописные буквы")
    if not any(c.isdigit() for c in password):
        problems.append("пароль должен содержать цифры")
    return problems


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def session_expiry(now: datetime | None = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return now + timedelta(hours=settings.session_absolute_hours)


def idle_limit() -> timedelta:
    return timedelta(minutes=settings.session_idle_minutes)
