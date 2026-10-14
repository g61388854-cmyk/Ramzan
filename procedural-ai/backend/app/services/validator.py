"""Проверка проекта документа: структура, обязательные реквизиты, согласованность
сведений, правовые основания. Результат проверки не является подтверждением
юридической корректности документа и требует оценки уполномоченным лицом."""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from html import unescape

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..legal import service as legal
from ..models import (
    Case,
    CaseParticipant,
    Document,
    DocumentTemplate,
    DocumentVersion,
    FactClaim,
    LegalProvision,
)
from .formatting import to_date
from .generator import condition_holds

RE_GAP = re.compile(r'<span class="gap" data-field="([^"]*)" data-required="([01])">')
RE_AI = re.compile(r'<span class="fv ai"[^>]*data-field="([^"]*)"')
RE_TAGS = re.compile(r"<[^>]+>")


def html_to_text(html: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", html)
    text = re.sub(r"</(p|h1|h2|h3|tr|li|div)>", "\n", text)
    return unescape(RE_TAGS.sub("", text))


def _item(level: str, code: str, message: str, **extra) -> dict:
    return {"level": level, "code": code, "message": message, **extra}


def validate(db: Session, doc: Document, version: DocumentVersion) -> dict:
    items: list[dict] = []
    legal_items: list[dict] = []
    template: DocumentTemplate | None = doc.template
    case: Case = db.get(Case, doc.case_id)
    values = version.field_values or {}
    sources = version.field_sources or {}
    html = version.content_html or ""
    doc_date = to_date(values.get("doc_date")) or date.today()

    if template is not None:
        # 1. Обязательные и условные поля
        for f in template.fields:
            active = condition_holds(f.condition, values)
            val = values.get(f.key)
            empty = val is None or (isinstance(val, (list, str)) and len(val) == 0) or (isinstance(val, str) and not val.strip())
            if active and f.required and empty:
                items.append(_item("error", "required_field", f"Не заполнено обязательное поле «{f.label}»", field=f.key))
        # 3. Применимость к стадии
        if template.stages and case.stage not in template.stages:
            items.append(_item("warning", "stage", "Вид документа не предусмотрен для текущей стадии производства по карточке дела ("
                               + case.stage + "). Проверьте процессуальную допустимость."))
        if template.procedural_kind == "head_resolution":
            items.append(_item("info", "author", f"Документ выносится и подписывается: {template.author_role}."))
        if template.requires_court:
            items.append(_item("info", "court", "Для производства действия (применения меры) требуется судебное решение."))
        if template.requires_head_consent:
            items.append(_item("info", "consent", "Требуется согласие руководителя следственного органа."))
        if template.requires_prosecutor_consent:
            items.append(_item("info", "consent", "Требуется согласие прокурора."))
        for w in template.warnings or []:
            items.append(_item("info", "template_warning", w))
        # 4. Значения полей с особым порядком (value_warnings / value_errors в описании шаблона)
        from ..catalog import registry

        defn = next((d for d in registry.load_all() if d["code"] == template.type_code), None)
        if defn:
            for fkey, mapping in (defn.get("value_warnings") or {}).items():
                msg = mapping.get(str(values.get(fkey)))
                if msg:
                    items.append(_item("warning", "special_procedure", msg, field=fkey))
            for fkey, mapping in (defn.get("value_errors") or {}).items():
                msg = mapping.get(str(values.get(fkey)))
                if msg:
                    items.append(_item("error", "special_procedure", msg, field=fkey))
        # Наличие более новой версии шаблона
        newer = db.scalar(select(DocumentTemplate).where(DocumentTemplate.type_code == template.type_code,
                                                         DocumentTemplate.version > template.version))
        if newer is not None:
            items.append(_item("info", "template_version", f"Доступна новая версия шаблона ({newer.version}); документ сформирован по версии {template.version}."))

    # 5. Пропуски и проектные формулировки в тексте
    for m in RE_GAP.finditer(html):
        level = "error" if m.group(2) == "1" else "warning"
        items.append(_item(level, "gap", f"В тексте остался незаполненный фрагмент: {m.group(1)}", field=m.group(1)))
    for m in RE_AI.finditer(html):
        items.append(_item("error", "ai_unconfirmed",
                           "Фрагмент, сформированный ИИ, не подтверждён пользователем (проектная формулировка)", field=m.group(1)))
    for key, src in sources.items():
        if src.get("type") in ("ai", "assist") and not src.get("confirmed"):
            if not any(i["code"] == "ai_unconfirmed" and i.get("field") == key for i in items):
                items.append(_item("error", "ai_unconfirmed", "Значение поля сформировано ИИ и не подтверждено пользователем", field=key))

    # 6. Источники фактов
    for key, src in sources.items():
        if src.get("type") == "fact" and src.get("id"):
            fact = db.get(FactClaim, src["id"])
            if fact is None or fact.case_id != doc.case_id:
                items.append(_item("error", "fact_missing", "Источник факта не найден в досье", field=key))
            elif fact.status == "rejected":
                items.append(_item("error", "fact_rejected", "Использован факт, отклонённый при проверке", field=key))
            elif fact.status != "confirmed":
                items.append(_item("warning", "fact_unverified", "Использован факт, не подтверждённый пользователем", field=key))
        if src.get("type") == "system":
            items.append(_item("warning", "system_value", f"Значение подставлено автоматически ({src.get('label')}) и требует проверки", field=key))

    # 7. Участники
    if template is not None:
        for f in template.fields:
            val = values.get(f.key)
            ids = [val] if f.field_type == "participant" and isinstance(val, str) and val else (val if f.field_type == "participants" and isinstance(val, list) else [])
            for pid in ids:
                p = db.get(CaseParticipant, pid)
                if p is None or p.case_id != doc.case_id:
                    items.append(_item("error", "participant_missing", f"Участник в поле «{f.label}» не найден в деле", field=f.key))
                    continue
                if p.is_archived:
                    items.append(_item("warning", "participant_archived", f"Участник «{p.display_name}» архивирован", field=f.key))
                if f.participant_role and p.role not in f.participant_role.split("|"):
                    items.append(_item("warning", "participant_role", f"Процессуальное положение «{p.display_name}» не соответствует полю «{f.label}»", field=f.key))
                snap = (version.case_snapshot or {}).get("participants", {}).get(pid)
                if snap and snap.get("display_name") != p.display_name:
                    items.append(_item("warning", "participant_changed", f"Сведения об участнике «{p.display_name}» изменились после формирования версии", field=f.key))

    # 8. Даты и время
    if doc_date > date.today():
        items.append(_item("warning", "future_date", "Дата документа позднее текущей даты"))
    if case.opened_at and template is not None and "check" not in (template.stages or []) and doc_date < case.opened_at:
        items.append(_item("error", "before_opening", "Дата документа предшествует дате возбуждения уголовного дела"))
    ts, te = values.get("time_start"), values.get("time_end")
    if ts and te and str(te) <= str(ts):
        items.append(_item("warning", "time_order", "Время окончания не позднее времени начала (проверьте, не переходит ли действие на следующие сутки)"))
    # 9. Номер дела
    if values.get("case_number") and case.case_number and str(values["case_number"]).strip() != case.case_number.strip():
        items.append(_item("warning", "case_number", f"Номер дела в документе ({values['case_number']}) не совпадает с карточкой ({case.case_number})"))

    # 10. Правовые основания шаблона
    if template is not None:
        for lb in template.legal_bases or []:
            prov = db.scalar(select(LegalProvision).where(LegalProvision.key == lb["key"]))
            st = legal.provision_status(prov, doc_date)
            legal_items.append({"key": lb["key"], "source": "template", "reason": lb.get("reason"),
                                "mandatory": lb.get("mandatory", True), **st,
                                "label": _label(prov, lb["key"])})
    # 11. Ссылки на нормы в тексте
    text = html_to_text(html)
    seen = {li["key"] for li in legal_items}
    for ref in legal.find_references(text):
        if ref["key"] in seen:
            continue
        seen.add(ref["key"])
        prov = db.scalar(select(LegalProvision).where(LegalProvision.key == ref["key"]))
        st = legal.provision_status(prov, doc_date)
        legal_items.append({"key": ref["key"], "source": "text", "reason": f"Ссылка в тексте: «{ref['text']}»",
                            "mandatory": False, **st, "label": _label(prov, ref["key"])})
    unverified = [li for li in legal_items if not li["verified"]]
    missing = [li for li in legal_items if li["status"] == "missing"]
    for li in missing:
        items.append(_item("warning", "legal_missing", f"Ссылка на {li['label']} отсутствует в правовом справочнике и не проверена"))
    if unverified:
        items.append(_item("warning", "legal_unverified",
                           f"Актуальность {len(unverified)} правовых ссылок не подтверждена (редакция не загружена или не верифицирована)"))
    updated = legal.registry_updated_at(db)
    items.append(_item("info", "registry_date", "Дата последнего обновления правового справочника: "
                       + (updated[:10] if updated else "обновление не выполнялось")
                       + ". Изменения законодательства после этой даты не проверены."))

    errors = sum(1 for i in items if i["level"] == "error")
    warnings = sum(1 for i in items if i["level"] == "warning")
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "version_id": version.id,
        "summary": {"errors": errors, "warnings": warnings, "legal_total": len(legal_items),
                    "legal_verified": len(legal_items) - len(unverified)},
        "items": items,
        "legal": legal_items,
        "disclaimer": "Автоматическая проверка не подтверждает юридическую корректность документа. Требуется проверка уполномоченным лицом.",
    }


def _label(prov: LegalProvision | None, key: str) -> str:
    if prov is not None:
        return f"ст. {prov.article} {prov.act.short_title}"
    code, art = (key.split(":") + [""])[:2]
    names = {"upk": "УПК РФ", "uk": "УК РФ", "konst": "Конституции РФ", "koap": "КоАП РФ"}
    return f"ст. {art} {names.get(code, code)}"
