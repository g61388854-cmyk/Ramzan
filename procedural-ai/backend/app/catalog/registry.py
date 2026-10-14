"""Каталог видов процессуальных документов.

Каждый вид документа описывается декларативно (YAML): метаданные, автор,
адресат, процессуальный характер, схема полей, правила условности,
правовые основания (ключи правового справочника) и шаблон текста (Jinja2).
Новый вид документа добавляется файлом описания без изменения кода.
"""
from __future__ import annotations

import copy
import hashlib
import json
from functools import lru_cache
from pathlib import Path

import yaml

TYPES_DIR = Path(__file__).parent / "types"

SECTIONS = {
    "check": "Проверка сообщения о преступлении",
    "organization": "Организация производства по уголовному делу",
    "protocols": "Протоколы следственных действий",
    "participants": "Решения в отношении участников",
    "coercion": "Меры процессуального принуждения",
    "court": "Судебный контроль",
    "requests": "Ходатайства, запросы и поручения",
    "expertise": "Экспертизы и специалисты",
    "evidence": "Вещественные доказательства и имущество",
    "completion": "Окончание предварительного расследования",
}

PROCEDURAL_KINDS = {
    "resolution": "Постановление следователя",
    "head_resolution": "Постановление руководителя следственного органа",
    "protocol": "Протокол",
    "court_petition": "Ходатайство перед судом (постановление о возбуждении ходатайства)",
    "petition": "Ходатайство",
    "notice": "Уведомление / сообщение",
    "request": "Запрос",
    "order": "Поручение",
    "letter": "Сопроводительное письмо",
    "form": "Документ, составляемый участником (бланк)",
    "inventory": "Опись / перечень",
    "indictment": "Обвинительное заключение и приложения",
    "report": "Рапорт",
}

FIELD_TYPES = {"text", "textarea", "date", "time", "datetime", "number", "select", "bool", "participant",
               "participants", "list"}

STAGES = {"check", "investigation", "suspended", "completed", "sent_to_prosecutor", "terminated"}


def _load_yaml(name: str) -> dict:
    with open(TYPES_DIR / name, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


@lru_cache(maxsize=1)
def presets() -> dict[str, list[dict]]:
    return _load_yaml("_presets.yaml").get("presets", {})


@lru_cache(maxsize=1)
def macros_source() -> str:
    return (TYPES_DIR / "_macros.html").read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def kits() -> list[dict]:
    return _load_yaml("_kits.yaml").get("kits", [])


@lru_cache(maxsize=1)
def specializations() -> list[dict]:
    return _load_yaml("_specializations.yaml").get("specializations", [])


def expand_fields(defn: dict) -> list[dict]:
    fields: list[dict] = []
    seen: set[str] = set()
    for item in defn.get("fields", []):
        if "use" in item:
            for f in presets()[item["use"]]:
                f = copy.deepcopy(f)
                if f["key"] in seen:
                    continue
                fields.append(f)
                seen.add(f["key"])
            continue
        if item["key"] in seen:
            # Уточнение поля из набора: переопределение атрибутов.
            for f in fields:
                if f["key"] == item["key"]:
                    f.update(item)
            continue
        fields.append(copy.deepcopy(item))
        seen.add(item["key"])
    return fields


def validate_definition(defn: dict) -> list[str]:
    errors = []
    for key in ("code", "title", "section", "kind", "author", "body"):
        if not defn.get(key):
            errors.append(f"{defn.get('code', '?')}: отсутствует обязательный атрибут «{key}»")
    if defn.get("section") not in SECTIONS:
        errors.append(f"{defn.get('code')}: неизвестный раздел {defn.get('section')}")
    if defn.get("kind") not in PROCEDURAL_KINDS:
        errors.append(f"{defn.get('code')}: неизвестный процессуальный вид {defn.get('kind')}")
    for st in defn.get("stages", []):
        if st not in STAGES:
            errors.append(f"{defn.get('code')}: неизвестная стадия {st}")
    for f in expand_fields(defn):
        if f.get("type") not in FIELD_TYPES:
            errors.append(f"{defn.get('code')}.{f.get('key')}: неизвестный тип поля {f.get('type')}")
        if f.get("type") == "select" and not f.get("options"):
            errors.append(f"{defn.get('code')}.{f.get('key')}: для списка не заданы варианты")
    return errors


@lru_cache(maxsize=1)
def load_all() -> list[dict]:
    out = []
    for path in sorted(TYPES_DIR.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        data = _load_yaml(path.name)
        for defn in data.get("documents", []):
            defn = dict(defn)
            defn["fields_expanded"] = expand_fields(defn)
            defn["source_file"] = path.name
            out.append(defn)
    codes = [d["code"] for d in out]
    dup = {c for c in codes if codes.count(c) > 1}
    if dup:
        raise ValueError(f"Повторяющиеся коды видов документов: {sorted(dup)}")
    return out


def checksum(defn: dict) -> str:
    material = {k: v for k, v in defn.items() if k not in ("source_file",)}
    return hashlib.sha256(json.dumps(material, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


def reset_cache() -> None:
    for fn in (presets, macros_source, kits, specializations, load_all):
        fn.cache_clear()
