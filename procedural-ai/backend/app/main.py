"""PROCEDURAL AI — серверное приложение."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import bootstrap
from .api import auth, cases, deadlines, documents, files, legal, misc, templates, users
from .config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("pai")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # В контейнере инициализация выполняется один раз до запуска рабочих процессов (entrypoint.sh)
    if os.environ.get("PAI_SKIP_BOOTSTRAP") != "1":
        log.info("Инициализация: %s", bootstrap.run())
    yield


app = FastAPI(
    title="PROCEDURAL AI API",
    version="1.0.0",
    description="Интеллектуальная система подготовки процессуальных документов следователя. "
                "Все проекты документов требуют проверки уполномоченным пользователем.",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/v1/openapi.json",
)

if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                       allow_methods=["*"], allow_headers=["Authorization", "Content-Type"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/docs"):
        response.headers.setdefault("Cache-Control", "no-store")
    else:
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "script-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'",
        )
    return response


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):  # pragma: no cover - защитный обработчик
    log.exception("Необработанная ошибка: %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Внутренняя ошибка сервера. Событие зафиксировано в журнале."})


API = "/api/v1"
for r in (auth.router, users.router, cases.router, files.router, templates.router, documents.router, legal.router,
          deadlines.router, misc.router):
    app.include_router(r, prefix=API)


@app.get(API + "/health", tags=["Служебные функции"], summary="Проверка работоспособности")
def health():
    return {"status": "ok"}


# Раздача собранного интерфейса (режим единого контейнера)
if settings.serve_frontend_dir and Path(settings.serve_frontend_dir).is_dir():
    root = Path(settings.serve_frontend_dir)
    app.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = (root / path).resolve()
        if path and target.is_file() and root.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(root / "index.html")
