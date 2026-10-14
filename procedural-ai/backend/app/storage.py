"""Зашифрованное локальное файловое хранилище (AES-256-GCM).

Формат файла: b"PAI1" | nonce(12) | ciphertext+tag. Ключ берётся из
PAI_STORAGE_KEY (base64) либо из файла `storage.key` в каталоге данных.
"""
from __future__ import annotations

import base64
import os
import secrets
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import settings

MAGIC = b"PAI1"
_key_cache: bytes | None = None


def _load_key() -> bytes:
    global _key_cache
    if _key_cache is not None:
        return _key_cache
    if settings.storage_key:
        key = base64.b64decode(settings.storage_key)
    else:
        settings.ensure_dirs()
        key_file = settings.data_dir / "storage.key"
        if key_file.exists():
            key = base64.b64decode(key_file.read_text().strip())
        else:
            key = AESGCM.generate_key(bit_length=256)
            fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as fh:
                fh.write(base64.b64encode(key).decode())
    if len(key) != 32:
        raise RuntimeError("Ключ хранилища должен иметь длину 32 байта")
    _key_cache = key
    return key


def reset_key_cache() -> None:
    global _key_cache
    _key_cache = None


def _path(directory: Path, name: str) -> Path:
    if "/" in name or "\\" in name or name.startswith("."):
        raise ValueError("Недопустимое имя объекта хранилища")
    return directory / name


def encrypt_bytes(data: bytes, aad: bytes = b"") -> bytes:
    nonce = secrets.token_bytes(12)
    return MAGIC + nonce + AESGCM(_load_key()).encrypt(nonce, data, aad or None)


def decrypt_bytes(blob: bytes, aad: bytes = b"") -> bytes:
    if not blob.startswith(MAGIC):
        raise ValueError("Повреждённый объект хранилища")
    nonce, ct = blob[4:16], blob[16:]
    return AESGCM(_load_key()).decrypt(nonce, ct, aad or None)


def put(data: bytes, *, directory: Path | None = None) -> str:
    directory = directory or settings.files_dir
    directory.mkdir(parents=True, exist_ok=True)
    name = secrets.token_hex(16) + ".bin"
    path = _path(directory, name)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(encrypt_bytes(data, name.encode()))
    return name


def get(name: str, *, directory: Path | None = None) -> bytes:
    directory = directory or settings.files_dir
    return decrypt_bytes(_path(directory, name).read_bytes(), name.encode())


def secure_delete(path: Path) -> None:
    """Перезапись содержимого перед удалением (наилучшее усилие: на SSD и
    журналируемых ФС гарантия физического уничтожения отсутствует)."""
    try:
        size = path.stat().st_size
        with open(path, "r+b") as fh:
            fh.write(secrets.token_bytes(size))
            fh.flush()
            os.fsync(fh.fileno())
    except OSError:
        pass
    try:
        path.unlink()
    except FileNotFoundError:
        pass


class TempFile:
    """Временный файл в изолированном каталоге с гарантированным удалением."""

    def __init__(self, data: bytes, suffix: str = ""):
        settings.tmp_dir.mkdir(parents=True, exist_ok=True)
        self.path = settings.tmp_dir / (secrets.token_hex(12) + suffix)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)

    def __enter__(self) -> Path:
        return self.path

    def __exit__(self, *exc) -> None:
        secure_delete(self.path)


def cleanup_tmp() -> int:
    """Удаление временных файлов, оставшихся после сбоя."""
    count = 0
    if settings.tmp_dir.exists():
        for p in settings.tmp_dir.iterdir():
            if p.is_file():
                secure_delete(p)
                count += 1
    return count
