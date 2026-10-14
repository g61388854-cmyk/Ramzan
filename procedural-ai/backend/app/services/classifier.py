"""Подбор вида документа по описанию задачи на естественном языке."""
from __future__ import annotations

import re

from . import ai_provider

STOP = {"и", "в", "о", "об", "по", "на", "с", "со", "к", "для", "из", "от", "что", "как", "это", "нужно", "надо",
        "необходимо", "подготовить", "составить", "сделать", "оформить", "документ", "прошу", "мне", "нам"}


def _stems(text: str) -> set[str]:
    words = re.findall(r"[а-яёa-z0-9]+", text.lower().replace("ё", "е"))
    return {w[:6] if len(w) > 6 else w for w in words if w not in STOP and len(w) > 2}


def suggest(task: str, templates: list[dict], stage: str | None = None, limit: int = 5) -> list[dict]:
    q = _stems(task)
    scored = []
    for t in templates:
        title_stems = _stems(t["title"])
        kw_stems = set()
        for k in t.get("keywords", []):
            kw_stems |= _stems(k)
        score = 2.0 * len(q & kw_stems) + 1.0 * len(q & title_stems)
        for k in t.get("keywords", []):
            if k.lower() in task.lower():
                score += 3
        if stage and t.get("stages") and stage in t["stages"]:
            score += 0.5
        if score > 0:
            scored.append((score, t))
    scored.sort(key=lambda x: (-x[0], x[1]["title"]))
    result = [{"code": t["code"], "title": t["title"], "score": round(s, 1), "method": "rules"} for s, t in scored[:limit]]
    model_order = ai_provider.classify_with_model(task, [{"code": r["code"], "title": r["title"]} for r in result])
    if model_order:
        rank = {c: i for i, c in enumerate(model_order)}
        result.sort(key=lambda r: rank.get(r["code"], 99))
        for r in result:
            r["method"] = "rules+model"
    return result
