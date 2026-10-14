"""Выявление потенциальных расхождений между материалами и карточкой дела.

Результат — перечень потенциальных расхождений с указанием источников.
Система не устанавливает, какой из вариантов является достоверным.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Case, CaseParticipant, Discrepancy, ExtractedEntity, SourceFile, SourceFragment
from .extractor import person_key, surname_stem


def _lev(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _item(ent: ExtractedEntity, files: dict[str, SourceFile], frags: dict[str, SourceFragment]) -> dict:
    f = files.get(ent.file_id)
    fr = frags.get(ent.fragment_id)
    return {
        "entity_id": ent.id,
        "file_id": ent.file_id,
        "source_code": f.source_code if f else None,
        "file_name": f.original_name if f else None,
        "fragment_id": ent.fragment_id,
        "page": fr.page if fr else None,
        "value": ent.value,
        "normalized": ent.normalized,
        "context": ent.context,
    }


def _sig(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:40]


def detect(db: Session, case: Case) -> list[dict]:
    ents = list(
        db.scalars(
            select(ExtractedEntity)
            .join(SourceFile, SourceFile.id == ExtractedEntity.file_id)
            .where(ExtractedEntity.case_id == case.id, SourceFile.is_archived.is_(False))
        )
    )
    files = {f.id: f for f in db.scalars(select(SourceFile).where(SourceFile.case_id == case.id))}
    frag_ids = {e.fragment_id for e in ents}
    frags = {f.id: f for f in db.scalars(select(SourceFragment).where(SourceFragment.id.in_(frag_ids)))} if frag_ids else {}
    by_type: dict[str, list[ExtractedEntity]] = defaultdict(list)
    for e in ents:
        by_type[e.entity_type].append(e)
    out: list[dict] = []

    # 1. Номер уголовного дела в материалах и в карточке
    case_nums = [e for e in by_type["case_number"] if (e.normalized or "").startswith("case:")]
    distinct = sorted({e.normalized.split(":", 1)[1] for e in case_nums})
    if case.case_number and case_nums:
        card = case.case_number.strip()
        mism = [e for e in case_nums if e.normalized.split(":", 1)[1] != card]
        if mism:
            out.append({
                "kind": "case_number_card",
                "signature": _sig("cn_card", card, *sorted({e.normalized for e in mism})),
                "description": f"Номер уголовного дела в карточке ({card}) не совпадает с номером, указанным в материалах",
                "items": [{"source_code": "Карточка дела", "value": card, "card": True}]
                + [_item(e, files, frags) for e in mism],
            })
    elif len(distinct) > 1:
        out.append({
            "kind": "case_number",
            "signature": _sig("cn", *distinct),
            "description": "В материалах указаны различные номера уголовного дела",
            "items": [_item(e, files, frags) for e in case_nums],
        })

    # 2. Несовпадающие ФИО (близкие варианты написания фамилии при совпадении инициалов)
    persons: dict[str, list[ExtractedEntity]] = defaultdict(list)
    for e in by_type["person"]:
        persons[e.normalized].append(e)
    keys = sorted(persons)
    for i, k1 in enumerate(keys):
        s1, i1, p1 = k1.split("|")
        for k2 in keys[i + 1 :]:
            s2, i2, p2 = k2.split("|")
            if (i1, p1) != (i2, p2) or min(len(s1), len(s2)) < 4:
                continue
            d = _lev(s1, s2)
            if 0 < d <= 2:
                out.append({
                    "kind": "person_name",
                    "signature": _sig("pn", k1, k2),
                    "description": f"Возможное расхождение в написании фамилии: «{persons[k1][0].value}» и «{persons[k2][0].value}»",
                    "items": [_item(e, files, frags) for e in persons[k1][:5] + persons[k2][:5]],
                })

    # 3. Даты рождения одного лица (ближайшее упоминание лица в том же фрагменте)
    frag_persons: dict[str, list[ExtractedEntity]] = defaultdict(list)
    for e in by_type["person"]:
        frag_persons[e.fragment_id].append(e)
    births: dict[str, list[ExtractedEntity]] = defaultdict(list)
    birth_person: dict[str, ExtractedEntity] = {}
    for b in by_type["birth_date"]:
        cands = [p for p in frag_persons.get(b.fragment_id, []) if p.char_end <= b.char_start and b.char_start - p.char_end < 80]
        if cands:
            p = max(cands, key=lambda x: x.char_end)
            births[p.normalized].append(b)
            birth_person[b.id] = p
    participants = list(db.scalars(select(CaseParticipant).where(CaseParticipant.case_id == case.id,
                                                                  CaseParticipant.is_archived.is_(False))))
    card_births: dict[str, tuple[str, CaseParticipant]] = {}
    for p in participants:
        if p.kind == "person" and p.last_name and p.first_name and p.patronymic and (p.data or {}).get("birth_date"):
            card_births[person_key(p.last_name, p.first_name[0], p.patronymic[0])] = (p.data["birth_date"], p)
    for key, bl in births.items():
        values = sorted({b.normalized for b in bl})
        name = birth_person[bl[0].id].value
        if len(values) > 1:
            out.append({
                "kind": "birth_date",
                "signature": _sig("bd", key, *values),
                "description": f"Для лица «{name}» в материалах указаны различные даты рождения",
                "items": [_item(b, files, frags) for b in bl],
            })
        if key in card_births and any(v != card_births[key][0] for v in values):
            out.append({
                "kind": "birth_date_card",
                "signature": _sig("bdc", key, card_births[key][0], *values),
                "description": f"Дата рождения лица «{card_births[key][1].display_name}» в карточке участника не совпадает с материалами",
                "items": [{"source_code": "Карточка участника", "value": card_births[key][0], "card": True}]
                + [_item(b, files, frags) for b in bl if b.normalized != card_births[key][0]],
            })

    # 4. Различные даты события (по признакам описания события в контексте)
    incident = by_type["incident_date"]
    inc_values = sorted({e.normalized for e in incident})
    inc_files = {e.file_id for e in incident}
    if len(inc_values) > 1 and len(inc_files) > 1:
        out.append({
            "kind": "incident_date",
            "signature": _sig("inc", *inc_values),
            "description": "В материалах указаны различные даты описываемого события: "
            + ", ".join(".".join(reversed(v.split("-"))) for v in inc_values),
            "items": [_item(e, files, frags) for e in incident],
        })

    # 5. Расхождения в суммах ущерба
    dmg = [e for e in by_type["money"] if "ущерб" in (e.context or "").lower()]
    dmg_values = sorted({e.normalized for e in dmg})
    if len(dmg_values) > 1 and len({e.file_id for e in dmg}) > 1:
        out.append({
            "kind": "money",
            "signature": _sig("dmg", *dmg_values),
            "description": "В материалах указаны различные суммы ущерба",
            "items": [_item(e, files, frags) for e in dmg],
        })

    # 6. Различные номера одного документа (экспертное заключение с одной датой и разными номерами)
    by_date: dict[str, list[ExtractedEntity]] = defaultdict(list)
    for e in by_type["expertise"]:
        num, d = (e.normalized or "|").split("|", 1)
        if d:
            by_date[d].append(e)
    for d, el in by_date.items():
        nums = sorted({(e.normalized or "").split("|")[0] for e in el})
        if len(nums) > 1 and len({e.file_id for e in el}) > 1:
            out.append({
                "kind": "document_number",
                "signature": _sig("docnum", d, *nums),
                "description": f"Заключение эксперта от {'.'.join(reversed(d.split('-')))} упоминается с различными номерами: {', '.join(nums)}",
                "items": [_item(e, files, frags) for e in el],
            })

    # 7. Несогласованная временная последовательность (окончание раньше начала)
    for e in by_type["action_time_range"]:
        start, end = (e.normalized or "-").split("-")
        if end < start:
            out.append({
                "kind": "time_sequence",
                "signature": _sig("tseq", e.file_id, e.fragment_id, e.normalized),
                "description": f"Время окончания действия ({end}) указано ранее времени начала ({start})",
                "items": [_item(e, files, frags)],
            })

    # 8. Упоминания документов, отсутствующих в загруженном комплекте
    headers: dict[str, str] = {}
    for f in files.values():
        if f.is_archived:
            continue
        first = db.scalars(
            select(SourceFragment.text).where(SourceFragment.file_id == f.id).order_by(SourceFragment.seq).limit(6)
        ).all()
        headers[f.id] = (" ".join(first) + " " + f.original_name).lower()
    for e in by_type["doc_ref"]:
        kind, num, d = (e.normalized or "||").split("|")
        if not num and not d:
            continue
        date_txt = ".".join(reversed(d.split("-"))) if d else ""
        found = False
        for fid, head in headers.items():
            if fid == e.file_id:
                continue
            if num and (f"№ {num}" in head or f"№{num}" in head):
                found = True
                break
            if date_txt and date_txt in head and kind.split()[0][:6] in head:
                found = True
                break
        if not found:
            out.append({
                "kind": "missing_document",
                "signature": _sig("miss", kind, num, d),
                "description": f"Упоминается документ «{e.value}», отсутствующий в загруженном комплекте материалов",
                "items": [_item(e, files, frags)],
            })
    return out


def refresh(db: Session, case: Case) -> dict:
    found = detect(db, case)
    existing = {d.signature: d for d in db.scalars(select(Discrepancy).where(Discrepancy.case_id == case.id))}
    seen = set()
    created = 0
    for item in found:
        if item["signature"] in seen:
            continue
        seen.add(item["signature"])
        d = existing.get(item["signature"])
        if d is None:
            db.add(Discrepancy(case_id=case.id, **item))
            created += 1
        else:
            d.items = item["items"]
            d.description = item["description"]
            if d.status == "stale":
                d.status = "open"
    stale = 0
    for sig, d in existing.items():
        if sig not in seen and d.status == "open":
            d.status = "stale"
            stale += 1
    db.flush()
    return {"detected": len(seen), "created": created, "stale": stale}


__all__ = ["detect", "refresh", "surname_stem"]
