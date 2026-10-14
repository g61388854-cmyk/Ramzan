"""Подключаемые локальные OCR-движки. Результат всегда маркируется как
машинно сформированные данные; оценка уверенности движка не является
доказательством достоверности текста."""
from __future__ import annotations

import csv
import io
import shutil
import subprocess
from dataclasses import dataclass

from ..config import settings
from ..storage import TempFile


@dataclass
class OcrLine:
    text: str
    confidence: float | None


class OcrUnavailable(RuntimeError):
    pass


def _tesseract(image: bytes) -> list[OcrLine]:
    exe = shutil.which("tesseract")
    if not exe:
        raise OcrUnavailable("tesseract не установлен")
    with TempFile(image, ".png") as path:
        # Аргументы передаются списком, без оболочки; путь формируется приложением.
        proc = subprocess.run(
            [exe, str(path), "stdout", "-l", "rus+eng", "tsv"],
            capture_output=True,
            timeout=300,
            check=False,
        )
    if proc.returncode != 0:
        raise RuntimeError("Ошибка tesseract: " + proc.stderr.decode(errors="replace")[:500])
    rows = list(csv.DictReader(io.StringIO(proc.stdout.decode("utf-8", errors="replace")), delimiter="\t",
                               quoting=csv.QUOTE_NONE))
    lines: dict[tuple, list[tuple[str, float]]] = {}
    for r in rows:
        word = (r.get("text") or "").strip()
        if not word:
            continue
        key = (r.get("block_num"), r.get("par_num"), r.get("line_num"))
        try:
            conf = float(r.get("conf") or -1)
        except ValueError:
            conf = -1
        lines.setdefault(key, []).append((word, conf))
    out = []
    for words in lines.values():
        confs = [c for _, c in words if c >= 0]
        out.append(OcrLine(" ".join(w for w, _ in words), (sum(confs) / len(confs) / 100) if confs else None))
    return out


_paddle = None


def _paddle_ocr(image: bytes) -> list[OcrLine]:
    global _paddle
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except ImportError as exc:
        raise OcrUnavailable("PaddleOCR не установлен") from exc
    if _paddle is None:
        _paddle = PaddleOCR(lang="ru", use_angle_cls=True, show_log=False)
    with TempFile(image, ".png") as path:
        result = _paddle.ocr(str(path), cls=True) or []
    out = []
    for page in result:
        for item in page or []:
            text, conf = item[1]
            out.append(OcrLine(text, float(conf)))
    return out


def available_engine() -> str | None:
    engine = settings.ocr_engine
    if engine == "none":
        return None
    if engine in ("auto", "paddle"):
        try:
            import paddleocr  # type: ignore  # noqa: F401

            return "paddle"
        except ImportError:
            if engine == "paddle":
                return None
    if engine in ("auto", "tesseract") and shutil.which("tesseract"):
        return "tesseract"
    return None


def recognize(image: bytes) -> tuple[str, list[OcrLine]]:
    engine = available_engine()
    if engine is None:
        raise OcrUnavailable("Локальный OCR-движок не установлен")
    lines = _paddle_ocr(image) if engine == "paddle" else _tesseract(image)
    return engine, lines
