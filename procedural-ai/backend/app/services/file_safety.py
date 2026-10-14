"""Проверка загружаемых файлов: расширение, сигнатура, размер, активное содержимое."""
from __future__ import annotations

import io
import re
import socket
import struct
import unicodedata
import zipfile
from dataclasses import dataclass

from ..config import settings

TEXT_EXTS = {"txt", "csv"}
ALLOWED = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "txt": "text/plain",
    "csv": "text/csv",
    "rtf": "application/rtf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "m4a": "audio/mp4",
    "mp4": "video/mp4",
    "webm": "video/webm",
}
MEDIA_EXTS = {"mp3", "wav", "ogg", "m4a", "mp4", "webm"}
IMAGE_EXTS = {"png", "jpg", "jpeg"}

MAX_ZIP_UNCOMPRESSED = 300 * 1024 * 1024
MAX_ZIP_RATIO = 150
MAX_ZIP_ENTRIES = 5000


class UnsafeFile(ValueError):
    pass


@dataclass
class CheckedFile:
    ext: str
    mime: str
    safe_name: str
    warnings: list[str]


def sanitize_filename(name: str) -> str:
    name = unicodedata.normalize("NFC", name or "file")
    name = name.replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f<>:\"|?*]", "_", name).strip(" .")
    return (name or "file")[:200]


def _check_zip(data: bytes, ext: str) -> None:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise UnsafeFile("Файл повреждён или не является документом Office Open XML") from exc
    infos = zf.infolist()
    if len(infos) > MAX_ZIP_ENTRIES:
        raise UnsafeFile("Слишком большое количество элементов в архиве документа")
    total = sum(i.file_size for i in infos)
    packed = max(1, sum(i.compress_size for i in infos))
    if total > MAX_ZIP_UNCOMPRESSED or total / packed > MAX_ZIP_RATIO:
        raise UnsafeFile("Подозрение на архивную бомбу: недопустимый коэффициент сжатия")
    names = {i.filename for i in infos}
    if any(n.lower().endswith("vbaproject.bin") for n in names):
        raise UnsafeFile("Документы с макросами не принимаются")
    if any(n.startswith("/") or ".." in n.split("/") for n in names):
        raise UnsafeFile("Недопустимые пути внутри архива документа")
    required = "word/document.xml" if ext == "docx" else "xl/workbook.xml"
    if required not in names:
        raise UnsafeFile("Содержимое файла не соответствует расширению")


def _decode_text(data: bytes) -> str:
    if b"\x00" in data[:4096] and not data.startswith((b"\xff\xfe", b"\xfe\xff")):
        raise UnsafeFile("Текстовый файл содержит двоичные данные")
    for enc in ("utf-8-sig", "utf-16", "cp1251"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise UnsafeFile("Не удалось определить кодировку текстового файла")


def _signature_ok(ext: str, data: bytes) -> bool:
    head = data[:16]
    if ext == "pdf":
        return b"%PDF-" in data[:1024]
    if ext in ("docx", "xlsx"):
        return head.startswith(b"PK\x03\x04")
    if ext == "png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in ("jpg", "jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == "rtf":
        return data.lstrip()[:5] == b"{\\rtf"
    if ext == "mp3":
        return head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)
    if ext == "wav":
        return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    if ext == "ogg":
        return head.startswith(b"OggS")
    if ext in ("mp4", "m4a"):
        return head[4:8] == b"ftyp"
    if ext == "webm":
        return head.startswith(b"\x1a\x45\xdf\xa3")
    if ext in TEXT_EXTS:
        return True
    return False


def clamd_scan(data: bytes) -> str | None:
    """Проверка антивирусом ClamAV (если настроен сокет clamd). Возвращает
    наименование угрозы либо None."""
    if not settings.clamd_socket:
        return None
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(60)
        s.connect(settings.clamd_socket)
        s.sendall(b"zINSTREAM\0")
        for i in range(0, len(data), 1 << 16):
            chunk = data[i : i + (1 << 16)]
            s.sendall(struct.pack("!L", len(chunk)) + chunk)
        s.sendall(struct.pack("!L", 0))
        reply = s.recv(4096).decode(errors="replace").strip("\0 \n")
    if reply.endswith("FOUND"):
        return reply.split(":", 1)[-1].replace("FOUND", "").strip()
    return None


def check_upload(filename: str, data: bytes, declared_mime: str | None = None) -> CheckedFile:
    safe = sanitize_filename(filename)
    ext = safe.rsplit(".", 1)[-1].lower() if "." in safe else ""
    if ext not in ALLOWED:
        raise UnsafeFile(f"Тип файла «.{ext}» не поддерживается политикой импорта")
    limit = settings.max_upload_mb * 1024 * 1024
    if len(data) == 0:
        raise UnsafeFile("Пустой файл")
    if len(data) > limit:
        raise UnsafeFile(f"Размер файла превышает {settings.max_upload_mb} МБ")
    if not _signature_ok(ext, data):
        raise UnsafeFile("Сигнатура файла не соответствует расширению")
    warnings: list[str] = []
    if ext in ("docx", "xlsx"):
        _check_zip(data, ext)
    if ext in TEXT_EXTS:
        _decode_text(data)
    if ext == "pdf":
        sample = data if len(data) < 20_000_000 else data[:20_000_000]
        if re.search(rb"/(JavaScript|JS|Launch|EmbeddedFile)\b", sample):
            raise UnsafeFile("PDF содержит активное содержимое (JavaScript, запуск или вложенные файлы)")
    if declared_mime and declared_mime not in (ALLOWED[ext], "application/octet-stream") and not (
        ext in TEXT_EXTS and declared_mime.startswith("text/")
    ):
        warnings.append(f"Заявленный MIME-тип «{declared_mime}» отличается от ожидаемого; использован {ALLOWED[ext]}")
    threat = clamd_scan(data)
    if threat:
        raise UnsafeFile(f"Антивирусная проверка: обнаружена угроза {threat}")
    if not settings.clamd_socket:
        warnings.append("Антивирусная проверка не настроена (PAI_CLAMD_SOCKET)")
    return CheckedFile(ext=ext, mime=ALLOWED[ext], safe_name=safe, warnings=warnings)


def decode_text(data: bytes) -> str:
    return _decode_text(data)
