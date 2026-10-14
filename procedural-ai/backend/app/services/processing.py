"""Конвейер обработки загруженного материала: текст → фрагменты →
сущности → карточки фактов → расхождения."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import storage
from ..models import Case, ExtractedEntity, FactClaim, FactSource, SourceFile, SourceFragment
from . import discrepancies, extractor, text_extract

# Типы, для которых одинаковые значения из разных источников объединяются в одну
# карточку факта с несколькими подтверждающими источниками.
GROUPED_TYPES = {"person", "case_number", "legal_ref", "phone", "address", "expertise", "birth_date"}
SKIP_FACT_TYPES = {"time"}


def process_file(db: Session, f: SourceFile, progress=lambda p, m: None) -> dict:
    progress(5, "Расшифровка файла")
    data = storage.get(f.stored_name)
    progress(15, "Извлечение текста")
    res = text_extract.extract(data, f.ext)
    del data

    progress(40, "Сохранение фрагментов")
    # Повторная обработка: удаляются непроверенные машинные факты этого файла;
    # подтверждённые и отклонённые пользователем карточки сохраняются.
    old_fact_ids = db.scalars(
        select(FactSource.fact_id).where(FactSource.file_id == f.id)
    ).all()
    for fact in db.scalars(select(FactClaim).where(FactClaim.id.in_(old_fact_ids))):
        if fact.status == "unverified" and fact.origin == "extraction" and not fact.edited_manually:
            remaining = [s for s in fact.sources if s.file_id != f.id]
            if remaining:
                fact.sources = remaining
            else:
                db.delete(fact)
    db.flush()
    db.execute(delete(ExtractedEntity).where(ExtractedEntity.file_id == f.id))
    db.execute(delete(SourceFragment).where(SourceFragment.file_id == f.id))
    db.flush()

    frags: list[SourceFragment] = []
    for seq, fr in enumerate(res.fragments, start=1):
        frag = SourceFragment(file_id=f.id, seq=seq, page=fr.page, paragraph=fr.paragraph, text=fr.text,
                              method=fr.method, ocr_confidence=fr.confidence)
        db.add(frag)
        frags.append(frag)
    db.flush()

    f.page_count = res.page_count
    f.text_method = res.method
    f.machine_generated = res.machine_generated
    f.detected_kind = extractor.detect_kind([x.text for x in frags[:5]])

    progress(60, "Извлечение сущностей")
    count = 0
    existing_facts: dict[tuple[str, str], FactClaim] = {}
    for fact in db.scalars(
        select(FactClaim).where(FactClaim.case_id == f.case_id, FactClaim.fact_type.in_(GROUPED_TYPES),
                                FactClaim.status != "rejected")
    ):
        if fact.normalized:
            existing_facts[(fact.fact_type, fact.normalized)] = fact
    for frag in frags:
        for ent in extractor.extract_entities(frag.text):
            e = ExtractedEntity(
                case_id=f.case_id, file_id=f.id, fragment_id=frag.id, entity_type=ent.entity_type,
                value=ent.value, normalized=ent.normalized, char_start=ent.start, char_end=ent.end,
                context=ent.context, extractor=extractor.EXTRACTOR_ID,
                confidence=None,
            )
            db.add(e)
            db.flush()
            count += 1
            if ent.entity_type in SKIP_FACT_TYPES:
                continue
            src = FactSource(file_id=f.id, fragment_id=frag.id, page=frag.page, char_start=ent.start,
                             char_end=ent.end, quote=ent.context)
            key = (ent.entity_type, ent.normalized or "")
            if ent.entity_type in GROUPED_TYPES and key in existing_facts:
                existing_facts[key].sources.append(src)
                continue
            fact = FactClaim(
                case_id=f.case_id, entity_id=e.id, fact_type=ent.entity_type,
                label=extractor.ENTITY_LABELS.get(ent.entity_type), content=ent.value, normalized=ent.normalized,
                origin="extraction", status="unverified", machine_generated=True,
                confidence=frag.ocr_confidence if frag.method != "digital" else None,
            )
            fact.sources.append(src)
            db.add(fact)
            if ent.entity_type in GROUPED_TYPES:
                existing_facts[key] = fact
    db.flush()

    progress(85, "Поиск расхождений")
    case = db.get(Case, f.case_id)
    disc = discrepancies.refresh(db, case)

    if not frags:
        f.status = "needs_ocr" if res.needs_ocr else "stored"
    elif res.needs_ocr:
        f.status = "partially_processed"
    else:
        f.status = "processed"
    f.notes = "; ".join(res.warnings) or None
    f.error = None
    f.processed_at = datetime.now(timezone.utc)
    db.commit()
    progress(100, "Готово")
    return {"fragments": len(frags), "entities": count, "warnings": res.warnings, "discrepancies": disc}
