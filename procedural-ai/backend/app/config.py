"""Конфигурация приложения. Все параметры задаются переменными окружения."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    database_url: str = field(
        default_factory=lambda: os.environ.get(
            "PAI_DATABASE_URL", "sqlite:///" + str(Path(os.environ.get("PAI_DATA_DIR", "./data")) / "pai.sqlite3")
        )
    )
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("PAI_DATA_DIR", "./data")))
    # Ключ шифрования файлового хранилища (base64, 32 байта). Если не задан —
    # создаётся файл ключа в каталоге данных с правами 0600.
    storage_key: str | None = field(default_factory=lambda: os.environ.get("PAI_STORAGE_KEY"))
    max_upload_mb: int = field(default_factory=lambda: int(os.environ.get("PAI_MAX_UPLOAD_MB", "50")))
    session_idle_minutes: int = field(default_factory=lambda: int(os.environ.get("PAI_SESSION_IDLE_MINUTES", "30")))
    session_absolute_hours: int = field(default_factory=lambda: int(os.environ.get("PAI_SESSION_ABSOLUTE_HOURS", "12")))
    login_max_failures: int = field(default_factory=lambda: int(os.environ.get("PAI_LOGIN_MAX_FAILURES", "5")))
    login_lock_minutes: int = field(default_factory=lambda: int(os.environ.get("PAI_LOGIN_LOCK_MINUTES", "15")))
    # ИИ-контур: none | ollama
    ai_provider: str = field(default_factory=lambda: os.environ.get("PAI_AI_PROVIDER", "none"))
    ollama_url: str = field(default_factory=lambda: os.environ.get("PAI_OLLAMA_URL", "http://ollama:11434"))
    ollama_model: str = field(default_factory=lambda: os.environ.get("PAI_OLLAMA_MODEL", "qwen2.5:7b-instruct"))
    ai_timeout_seconds: int = field(default_factory=lambda: int(os.environ.get("PAI_AI_TIMEOUT", "120")))
    # OCR: auto | tesseract | paddle | none
    ocr_engine: str = field(default_factory=lambda: os.environ.get("PAI_OCR_ENGINE", "auto"))
    clamd_socket: str | None = field(default_factory=lambda: os.environ.get("PAI_CLAMD_SOCKET"))
    pdf_font_path: str | None = field(default_factory=lambda: os.environ.get("PAI_PDF_FONT"))
    task_workers: int = field(default_factory=lambda: int(os.environ.get("PAI_TASK_WORKERS", "2")))
    run_tasks_inline: bool = field(default_factory=lambda: _bool("PAI_TASKS_INLINE", False))
    cors_origins: list[str] = field(
        default_factory=lambda: [o for o in os.environ.get("PAI_CORS_ORIGINS", "").split(",") if o]
    )
    bootstrap_admin_login: str | None = field(default_factory=lambda: os.environ.get("PAI_ADMIN_LOGIN"))
    bootstrap_admin_password: str | None = field(default_factory=lambda: os.environ.get("PAI_ADMIN_PASSWORD"))
    serve_frontend_dir: str | None = field(default_factory=lambda: os.environ.get("PAI_FRONTEND_DIR"))

    timezone_name: str = field(default_factory=lambda: os.environ.get("PAI_TZ", "Europe/Moscow"))

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone_name)

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.files_dir, self.tmp_dir, self.exports_dir):
            d.mkdir(parents=True, exist_ok=True)
            try:
                os.chmod(d, 0o700)
            except OSError:
                pass


settings = Settings()
