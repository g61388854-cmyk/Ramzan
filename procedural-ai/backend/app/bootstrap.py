"""Начальная инициализация: роли, каталог шаблонов, правовой справочник,
учётная запись администратора, восстановление после сбоя."""
from __future__ import annotations

import logging

from sqlalchemy import select, text

from . import storage, tasks
from .catalog import sync as catalog_sync
from .config import settings
from .db import SessionLocal
from .legal import service as legal
from .models import Role, User
from .security import ROLES, hash_password, password_problems

log = logging.getLogger("pai.bootstrap")


def seed_roles(db) -> None:
    existing = {r.code: r for r in db.scalars(select(Role))}
    for code, meta in ROLES.items():
        r = existing.get(code)
        if r is None:
            db.add(Role(code=code, title=meta["title"], permissions=meta["permissions"]))
        else:
            r.title, r.permissions = meta["title"], meta["permissions"]
    db.flush()


def ensure_admin(db) -> None:
    login, password = settings.bootstrap_admin_login, settings.bootstrap_admin_password
    if not login or not password:
        return
    if db.scalar(select(User).where(User.login == login)):
        return
    problems = password_problems(password)
    if problems:
        raise RuntimeError("Пароль администратора не соответствует требованиям: " + "; ".join(problems))
    role = db.scalar(select(Role).where(Role.code == "admin"))
    db.add(User(login=login, full_name="Администратор системы", role_id=role.id, password_hash=hash_password(password),
                must_change_password=True))
    log.info("Создана учётная запись администратора %s", login)


BOOTSTRAP_LOCK_ID = 7241001


def run() -> dict:
    settings.ensure_dirs()
    db = SessionLocal()
    try:
        if db.get_bind().dialect.name == "postgresql":
            # Исключение параллельной инициализации несколькими процессами
            db.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": BOOTSTRAP_LOCK_ID})
        seed_roles(db)
        cat = catalog_sync.sync(db)
        leg = legal.seed(db)
        ensure_admin(db)
        db.commit()
    finally:
        db.close()
    interrupted = tasks.recover_interrupted()
    cleaned = storage.cleanup_tmp()
    return {"catalog": cat, "legal": leg, "interrupted_tasks": interrupted, "tmp_cleaned": cleaned}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log.info("Инициализация: %s", run())
