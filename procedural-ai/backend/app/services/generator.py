"""Формирование проекта документа по шаблону на основании подтверждённых данных.

Каждое подставленное значение сохраняет источник (ручной ввод, карточка дела,
карточка участника, подтверждённый факт, проектная формулировка ИИ). Отсутствующие
сведения не домысливаются: в текст вставляется видимая отметка о пропуске.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from jinja2 import DictLoader, StrictUndefined
from jinja2.sandbox import SandboxedEnvironment
from markupsafe import Markup, escape
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..catalog import registry
from ..models import Case, CaseParticipant, DocumentField, DocumentTemplate, FactClaim
from .formatting import fmt_date, fmt_date_long, fmt_date_text, fmt_time, short_name

PARTICIPANT_ROLES = {
    "victim": "Потерпевший",
    "suspect": "Подозреваемый",
    "accused": "Обвиняемый",
    "defender": "Защитник",
    "representative": "Представитель",
    "legal_representative": "Законный представитель",
    "witness": "Свидетель",
    "expert": "Эксперт",
    "specialist": "Специалист",
    "interpreter": "Переводчик",
    "civil_plaintiff": "Гражданский истец",
    "civil_defendant": "Гражданский ответчик",
    "applicant": "Заявитель",
    "other": "Иной участник",
}

STAGE_LABELS = {
    "check": "Проверка сообщения о преступлении",
    "investigation": "Предварительное следствие",
    "suspended": "Предварительное следствие приостановлено",
    "completed": "Следственные действия окончены",
    "sent_to_prosecutor": "Дело направлено прокурору",
    "terminated": "Производство прекращено",
}


# --- условия полей ------------------------------------------------------------

_COND = re.compile(r"^\s*(!)?\s*([a-z_][a-z0-9_]*)\s*(?:(==|!=|in)\s*(.+))?\s*$")


def condition_holds(condition: str | None, values: dict[str, Any]) -> bool:
    if not condition:
        return True
    for clause in condition.split("&&"):
        m = _COND.match(clause)
        if not m:
            return True
        neg, key, op, rhs = m.groups()
        val = values.get(key)
        if op is None:
            ok = bool(val) and val not in ("false", "нет")
            ok = not ok if neg else ok
        else:
            rhs = rhs.strip()
            if op == "in":
                opts = [o.strip().strip("'\"") for o in rhs.strip("[]").split(",")]
                ok = str(val) in opts
            else:
                target = rhs.strip("'\"")
                ok = (str(val) == target) if op == "==" else (str(val) != target)
        if not ok:
            return False
    return True


# --- снимки данных ------------------------------------------------------------

def participant_snapshot(p: CaseParticipant) -> dict:
    data = dict(p.data or {})
    snap = {
        "id": p.id,
        "role": p.role,
        "role_label": PARTICIPANT_ROLES.get(p.role, p.role),
        "kind": p.kind,
        "display_name": p.display_name,
        "short_name": short_name(p.display_name) if p.kind == "person" else p.display_name,
        "last_name": p.last_name,
        "first_name": p.first_name,
        "patronymic": p.patronymic,
        "org_name": p.org_name,
    }
    for k, v in data.items():
        snap[k] = fmt_date(v) if k.endswith("_date") else v
    return snap


def case_snapshot(case: Case) -> dict:
    inv = case.investigator
    return {
        "id": case.id,
        "reg_id": case.reg_id,
        "case_number": case.case_number,
        "opened_at": case.opened_at.isoformat() if case.opened_at else None,
        "investigative_body": case.investigative_body,
        "unit": case.unit,
        "investigator_name": short_name(inv.full_name) if inv else None,
        "investigator_full_name": inv.full_name if inv else None,
        "investigator_position": case.investigator_position or (inv.position if inv else None),
        "head_name": case.head_name,
        "head_position": case.head_position,
        "city": case.city,
        "qualification": case.qualification,
        "fabula": case.fabula,
        "stage": case.stage,
    }


# --- предзаполнение ----------------------------------------------------------

def prefill(db: Session, case: Case, template: DocumentTemplate) -> tuple[dict, dict, dict]:
    """Возвращает (значения, источники, подсказки) для полей шаблона."""
    snap = case_snapshot(case)
    values: dict[str, Any] = {}
    sources: dict[str, dict] = {}
    suggestions: dict[str, list] = {}
    participants = list(
        db.scalars(select(CaseParticipant).where(CaseParticipant.case_id == case.id,
                                                 CaseParticipant.is_archived.is_(False)))
    )
    for f in template.fields:
        b = f.binding or ""
        if b == "today":
            values[f.key] = date.today().isoformat()
            sources[f.key] = {"type": "system", "label": "Текущая дата (проверьте)"}
        elif b.startswith("case."):
            attr = b.split(".", 1)[1]
            if snap.get(attr):
                values[f.key] = snap[attr]
                sources[f.key] = {"type": "case", "field": attr, "label": "Карточка дела"}
        elif b.startswith("fact:"):
            ftype = b.split(":", 1)[1]
            facts = list(db.scalars(select(FactClaim).where(FactClaim.case_id == case.id, FactClaim.fact_type == ftype,
                                                            FactClaim.status == "confirmed")))
            suggestions[f.key] = [{"fact_id": x.id, "value": x.normalized or x.content, "label": x.content} for x in facts]
            if len(facts) == 1:
                fx = facts[0]
                values[f.key] = fx.normalized if f.field_type == "date" and fx.normalized else fx.content
                sources[f.key] = {"type": "fact", "id": fx.id, "label": "Подтверждённый факт"}
        if f.field_type in ("participant", "participants") and f.participant_role:
            roles = f.participant_role.split("|")
            cands = [p for p in participants if p.role in roles]
            suggestions[f.key] = [{"participant_id": p.id, "label": f"{p.display_name} ({PARTICIPANT_ROLES.get(p.role, p.role)})"} for p in cands]
            if f.field_type == "participant" and len(cands) == 1:
                values[f.key] = cands[0].id
                sources[f.key] = {"type": "participant", "id": cands[0].id, "label": "Карточка участника"}
            elif f.field_type == "participants" and cands:
                values[f.key] = [p.id for p in cands]
                sources[f.key] = {"type": "participant", "ids": [p.id for p in cands], "label": "Карточки участников"}
    return values, sources, suggestions


# --- рендеринг ---------------------------------------------------------------

def _span(key: str, text: str, source: dict | None) -> Markup:
    src = source or {"type": "manual"}
    cls = "fv ai" if src.get("type") in ("ai", "assist") and not src.get("confirmed") else "fv"
    attrs = f' data-field="{escape(key)}" data-src-type="{escape(src.get("type", "manual"))}"'
    if src.get("id"):
        attrs += f' data-src-id="{escape(src["id"])}"'
    body = escape(text).replace("\n", Markup("<br>"))
    return Markup(f'<span class="{cls}"{attrs}>{body}</span>')


def _gap(key: str, label: str, required: bool) -> Markup:
    return Markup(
        f'<span class="gap" data-field="{escape(key)}" data-required="{1 if required else 0}">[не заполнено: {escape(label)}]</span>'
    )


def _display(field: DocumentField, value: Any, participants: dict[str, dict], long_date: bool = False) -> str:
    t = field.field_type
    if t == "date":
        return fmt_date_long(value) if long_date else fmt_date(value)
    if t == "time":
        return fmt_time(value)
    if t == "datetime":
        s = str(value)
        return f"{fmt_date(s[:10])} {fmt_time(s[11:16])}" if len(s) >= 16 else s
    if t == "bool":
        return "да" if value in (True, "true", "1", 1) else "нет"
    if t == "participant":
        p = participants.get(value)
        return p["display_name"] if p else ""
    if t == "participants":
        return ", ".join(participants[i]["display_name"] for i in value or [] if i in participants)
    if t == "list":
        items = value if isinstance(value, list) else str(value).split("\n")
        return "\n".join(f"{n}) {x}" for n, x in enumerate([i for i in items if str(i).strip()], start=1))
    return str(value)


def _filled(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return str(value).strip() != ""


def _env(template: DocumentTemplate) -> SandboxedEnvironment:
    env = SandboxedEnvironment(
        loader=DictLoader({"_macros": registry.macros_source(),
                           "doc": '{% import "_macros" as m with context %}\n' + template.body}),
        autoescape=True,
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["ddmmyyyy"] = fmt_date
    env.filters["date_long"] = fmt_date_long
    env.filters["date_text"] = fmt_date_text
    return env


def render(
    template: DocumentTemplate,
    values: dict[str, Any],
    sources: dict[str, dict],
    participants: dict[str, dict],
    case_snap: dict,
) -> tuple[str, list[str]]:
    """Рендеринг HTML проекта. Возвращает (html, перечень незаполненных обязательных полей)."""
    v: dict[str, Markup] = {}
    vc: dict[str, Markup] = {}  # значение с прописной буквы (начало предложения)
    vl: dict[str, Markup] = {}
    has: dict[str, bool] = {}
    raw: dict[str, Any] = {}
    missing: list[str] = []
    fields_by_key = {f.key: f for f in template.fields}
    for f in template.fields:
        val = values.get(f.key)
        active = condition_holds(f.condition, values)
        raw[f.key] = val
        if active and _filled(val):
            shown = _display(f, val, participants)
            v[f.key] = _span(f.key, shown, sources.get(f.key))
            vc[f.key] = _span(f.key, shown[:1].upper() + shown[1:], sources.get(f.key))
            vl[f.key] = _span(f.key, _display(f, val, participants, long_date=True), sources.get(f.key))
            has[f.key] = True
        else:
            required = bool(f.required and active)
            if required:
                missing.append(f.key)
            v[f.key] = _gap(f.key, f.label, required) if active else Markup("")
            vl[f.key] = vc[f.key] = v[f.key]
            has[f.key] = False

    def pval(key: str, attr: str):
        pid = raw.get(key)
        p = participants.get(pid) if isinstance(pid, str) else None
        return (p or {}).get(attr)

    def pv(key: str, attr: str, required: bool = False):
        pid = raw.get(key)
        p = participants.get(pid) if isinstance(pid, str) else None
        if p and _filled(p.get(attr)):
            return _span(f"{key}.{attr}", str(p[attr]), {"type": "participant", "id": p["id"]})
        label = (fields_by_key[key].label if key in fields_by_key else key) + " — " + PARTICIPANT_ATTR_LABELS.get(attr, attr)
        return _gap(f"{key}.{attr}", label, required)

    def plist(key: str) -> list[dict]:
        ids = raw.get(key) or []
        return [participants[i] for i in ids if i in participants]

    env = _env(template)
    tpl = env.get_template("doc")
    html = tpl.render(v=v, vc=vc, vl=vl, has=has, raw=raw, pv=pv, pval=pval, plist=plist, case=case_snap,
                      fmt_date=fmt_date, fmt_date_long=fmt_date_long, fmt_date_text=fmt_date_text,
                      e=escape)
    html = re.sub(r"\n\s*\n+", "\n", html).strip()
    return html, missing


PARTICIPANT_ATTR_LABELS = {
    "display_name": "ФИО / наименование",
    "short_name": "фамилия и инициалы",
    "birth_date": "дата рождения",
    "birth_place": "место рождения",
    "citizenship": "гражданство",
    "address_registration": "адрес регистрации",
    "address_actual": "адрес проживания",
    "identity_document": "документ, удостоверяющий личность",
    "occupation": "место работы (учёбы), должность",
    "phone": "телефон",
    "education": "образование",
    "family_status": "семейное положение",
    "criminal_record": "сведения о судимости",
    "bar_formation": "адвокатское образование",
    "registry_number": "регистрационный номер в реестре адвокатов",
    "warrant": "ордер",
    "institution": "экспертное учреждение",
    "specialty": "специальность",
    "experience_years": "стаж работы",
    "language": "язык",
    "authority_document": "документ, подтверждающий полномочия",
    "org_details": "реквизиты организации",
    "relation": "отношение к лицу",
}


def collect_participants(db: Session, case_id: str, values: dict, template: DocumentTemplate) -> dict[str, dict]:
    ids: set[str] = set()
    for f in template.fields:
        val = values.get(f.key)
        if f.field_type == "participant" and isinstance(val, str) and val:
            ids.add(val)
        elif f.field_type == "participants" and isinstance(val, list):
            ids.update(i for i in val if isinstance(i, str))
    if not ids:
        return {}
    rows = db.scalars(select(CaseParticipant).where(CaseParticipant.id.in_(ids), CaseParticipant.case_id == case_id))
    return {p.id: participant_snapshot(p) for p in rows}


def sample_values(template: DocumentTemplate) -> dict[str, Any]:
    """Тестовые значения для проверки шаблона (используются в автотестах каталога)."""
    out: dict[str, Any] = {}
    for f in template.fields:
        t = f.field_type
        if t == "date":
            out[f.key] = "2026-01-15"
        elif t == "time":
            out[f.key] = "10:00" if "start" in f.key else "11:30"
        elif t == "datetime":
            out[f.key] = "2026-01-15T10:00"
        elif t == "select":
            out[f.key] = (f.options or [""])[0]
        elif t == "bool":
            out[f.key] = True
        elif t == "number":
            out[f.key] = 2
        elif t == "participant":
            out[f.key] = "p-sample"
        elif t == "participants":
            out[f.key] = ["p-sample"]
        elif t == "list":
            out[f.key] = ["Первый пункт", "Второй пункт"]
        else:
            out[f.key] = f"Тестовое значение поля «{f.label}»"
    return out
