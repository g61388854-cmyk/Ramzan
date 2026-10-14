"""Расширяемый модуль распознавания речи для аудио- и видеоматериалов.

По умолчанию модуль отключён. При установке пакета faster-whisper и
указании модели (PAI_ASR_MODEL) выполняется локальное распознавание.
Результат маркируется как машинно сформированные данные."""
from __future__ import annotations

import os

from ..storage import TempFile


class AsrUnavailable(RuntimeError):
    pass


def transcribe(data: bytes, ext: str) -> list[tuple[str, float | None, float]]:
    model_name = os.environ.get("PAI_ASR_MODEL")
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as exc:
        raise AsrUnavailable("Модуль распознавания речи не установлен") from exc
    if not model_name:
        raise AsrUnavailable("Не задана модель распознавания речи (PAI_ASR_MODEL)")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    with TempFile(data, "." + ext) as path:
        segments, _ = model.transcribe(str(path), language="ru")
        return [(s.text.strip(), None, s.start) for s in segments]
