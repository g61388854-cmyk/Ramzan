"""Тесты качества извлечения на синтетическом размеченном наборе (раздел 14.2 ТЗ)."""
import json
from collections import Counter
from pathlib import Path

from app.services import extractor

DATA = Path(__file__).parent / "data"
SET = json.loads((DATA / "quality_set.json").read_text(encoding="utf-8"))["samples"]
TH = json.loads((DATA / "quality_thresholds.json").read_text(encoding="utf-8"))


def _norm_type(t):
    # Дата события и дата рождения являются уточнениями типа «дата»
    return t


def test_recall_per_type():
    expected = Counter()
    found = Counter()
    for s in SET:
        ents = extractor.extract_entities(s["text"])
        got = {(e.entity_type, e.normalized) for e in ents}
        got_types = {e.entity_type for e in ents}
        for t, norm in s["expected"]:
            expected[t] += 1
            if (norm is None and t in got_types) or (t, norm) in got:
                found[t] += 1
            else:
                print("не найдено:", s["id"], t, norm, sorted(got))
    for t, n in expected.items():
        recall = found[t] / n
        assert recall >= TH["recall"].get(t, 0.9), (t, recall)


def test_overall_precision():
    tp = fp = 0
    for s in SET:
        exp = {(t, n) for t, n in s["expected"]}
        exp_types = {t for t, n in s["expected"] if n is None}
        for e in extractor.extract_entities(s["text"]):
            if (e.entity_type, e.normalized) in exp or e.entity_type in exp_types:
                tp += 1
            else:
                fp += 1
                print("лишнее:", s["id"], e.entity_type, e.normalized)
    assert tp / (tp + fp) >= TH["precision_min_overall"], tp / (tp + fp)


def test_no_invented_values():
    """Каждое извлечённое значение присутствует в исходном тексте в указанной позиции."""
    for s in SET:
        for e in extractor.extract_entities(s["text"]):
            assert s["text"][e.start:e.end].strip().startswith(e.value[:10]), (s["id"], e)


def test_doc_type_detection():
    ok = sum(1 for s in SET if extractor.detect_kind([s["text"]]) == s["doc_type"])
    assert ok / len(SET) >= TH["doc_type_accuracy"], ok


def test_reproducible():
    for s in SET:
        a = [(e.entity_type, e.normalized, e.start, e.end) for e in extractor.extract_entities(s["text"])]
        b = [(e.entity_type, e.normalized, e.start, e.end) for e in extractor.extract_entities(s["text"])]
        assert a == b
