"""Локальный механизм фоновых задач с сохранением состояния в БД.

Задачи выполняются пулом потоков процесса приложения; состояние (очередь,
прогресс, результат, ошибка) хранится в таблице tasks. После перезапуска
незавершённые задачи помечаются как прерванные и могут быть запущены повторно.
"""
from __future__ import annotations

import logging
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable

from sqlalchemy import select, update

from .config import settings
from .db import SessionLocal
from .models import Task

log = logging.getLogger("pai.tasks")
_executor: ThreadPoolExecutor | None = None
HANDLERS: dict[str, Callable] = {}


def handler(kind: str):
    def deco(fn):
        HANDLERS[kind] = fn
        return fn

    return deco


def _pool() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=settings.task_workers, thread_name_prefix="pai-task")
    return _executor


def _run(task_id: str) -> None:
    db = SessionLocal()
    try:
        task = db.get(Task, task_id)
        if task is None:
            return
        task.status = "running"
        task.started_at = datetime.now(timezone.utc)
        db.commit()

        def progress(pct: int, msg: str) -> None:
            # Прогресс фиксируется отдельной транзакцией, чтобы быть видимым до завершения задачи.
            # SQLite не допускает параллельной записи, поэтому в этом режиме прогресс не публикуется.
            if db.get_bind().dialect.name == "sqlite":
                return
            s2 = SessionLocal()
            try:
                s2.execute(update(Task).where(Task.id == task_id).values(progress=pct, message=msg))
                s2.commit()
            except Exception:  # noqa: BLE001 - прогресс носит информационный характер
                s2.rollback()
            finally:
                s2.close()

        try:
            result = HANDLERS[task.kind](db, task, progress)
            task = db.get(Task, task_id)
            task.status = "done"
            task.progress = 100
            task.result = result
        except Exception as exc:  # noqa: BLE001 - ошибка фиксируется в задаче
            db.rollback()
            log.error("task %s failed: %s", task_id, traceback.format_exc())
            task = db.get(Task, task_id)
            task.status = "failed"
            task.error = str(exc)[:2000]
        task.finished_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


def submit(db, kind: str, *, user_id=None, case_id=None, file_id=None, document_id=None, payload=None) -> Task:
    task = Task(kind=kind, created_by=user_id, case_id=case_id, file_id=file_id, document_id=document_id,
                payload=payload or {})
    db.add(task)
    db.commit()
    if settings.run_tasks_inline:
        _run(task.id)
        db.refresh(task)
    else:
        _pool().submit(_run, task.id)
    return task


def recover_interrupted() -> int:
    db = SessionLocal()
    try:
        tasks = db.scalars(select(Task).where(Task.status.in_(("queued", "running")))).all()
        for t in tasks:
            t.status = "interrupted"
            t.error = "Задача прервана перезапуском сервера; требуется повторный запуск"
            t.finished_at = datetime.now(timezone.utc)
        db.commit()
        return len(tasks)
    finally:
        db.close()
