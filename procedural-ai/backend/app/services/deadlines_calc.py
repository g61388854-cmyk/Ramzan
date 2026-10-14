"""Расчёт процессуальных сроков.

Каждый автоматический расчёт сопровождается описанием: исходная дата,
применённая норма, параметры и итоговая дата. Все рассчитанные сроки
получают статус «требует подтверждения» и подтверждаются пользователем.
Календарь нерабочих праздничных дней ведётся администратором (настройка
`nonworking_days`); без него учитываются только суббота и воскресенье.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from ..config import settings


@dataclass(frozen=True)
class Rule:
    code: str
    title: str
    basis_key: str
    basis_text: str
    unit: str  # hours | days | months
    amount: int
    include_start_day: bool = False
    shift_nonworking: bool = True
    note: str = ""


RULES: dict[str, Rule] = {r.code: r for r in [
    Rule("report_check", "Срок проверки сообщения о преступлении", "upk:144", "ч. 1 ст. 144 УПК РФ", "days", 3,
         note="Продление до 10 и до 30 суток вносится корректировкой с указанием решения руководителя (ч. 3 ст. 144 УПК РФ)."),
    Rule("preliminary_investigation", "Срок предварительного следствия", "upk:162", "ч. 1, 2 ст. 162 УПК РФ", "months", 2,
         include_start_day=True,
         note="Срок исчисляется со дня возбуждения уголовного дела (ч. 2 ст. 162 УПК РФ); время приостановления не включается. Порядок включения начального дня подлежит проверке пользователем."),
    Rule("term_extension_petition", "Представление ходатайства о продлении срока следствия (не позднее 5 суток до истечения)",
         "upk:162", "ч. 7 ст. 162 УПК РФ", "days", -5, shift_nonworking=False,
         note="Исходная дата — дата истечения срока предварительного следствия."),
    Rule("detention_48h", "Срок задержания подозреваемого до судебного решения", "upk:94", "ст. 94 УПК РФ; ч. 2 ст. 22 Конституции РФ", "hours", 48,
         shift_nonworking=False, note="Исчисляется с момента фактического задержания."),
    Rule("detention_protocol_3h", "Составление протокола задержания после доставления", "upk:92", "ч. 1 ст. 92 УПК РФ", "hours", 3,
         shift_nonworking=False, note="Исходное время — момент доставления к следователю."),
    Rule("detention_prosecutor_12h", "Письменное сообщение прокурору о задержании", "upk:92", "ч. 3 ст. 92 УПК РФ", "hours", 12,
         shift_nonworking=False),
    Rule("detention_relatives_12h", "Уведомление родственников о задержании", "upk:96", "ст. 96 УПК РФ", "hours", 12,
         shift_nonworking=False),
    Rule("custody_initial", "Срок содержания под стражей", "upk:109", "ч. 1 ст. 109 УПК РФ", "months", 2,
         include_start_day=True, shift_nonworking=False,
         note="Исходная дата — день заключения под стражу (с учётом времени задержания). Перенос на рабочий день не производится (ч. 2 ст. 128 УПК РФ)."),
    Rule("custody_extension_petition", "Представление в суд ходатайства о продлении срока содержания под стражей",
         "upk:109", "ч. 8 ст. 109 УПК РФ", "days", -7, shift_nonworking=False,
         note="Исходная дата — дата истечения срока содержания под стражей. Проверьте срок в действующей редакции нормы."),
    Rule("charge_after_resolution", "Предъявление обвинения после вынесения постановления", "upk:172", "ч. 1 ст. 172 УПК РФ", "days", 3),
    Rule("charge_after_measure", "Предъявление обвинения подозреваемому, к которому применена мера пресечения", "upk:100",
         "ч. 1 ст. 100 УПК РФ", "days", 10, shift_nonworking=False,
         note="Для отдельных категорий преступлений закон устанавливает иной срок (ч. 2 ст. 100 УПК РФ)."),
    Rule("petition_review", "Рассмотрение ходатайства", "upk:121", "ст. 121 УПК РФ", "days", 3),
    Rule("refusal_copy_24h", "Направление копии постановления об отказе в возбуждении дела заявителю и прокурору",
         "upk:148", "ч. 4 ст. 148 УПК РФ", "hours", 24, shift_nonworking=False),
    Rule("order_execution", "Исполнение поручения о производстве следственных действий", "upk:152", "ч. 1 ст. 152 УПК РФ", "days", 10),
    Rule("additional_investigation", "Срок дополнительного следствия при возобновлении", "upk:162", "ч. 6 ст. 162 УПК РФ", "months", 1,
         include_start_day=True, note="Исходная дата — день поступления дела к следователю."),
    Rule("custom", "Иной срок (параметры задаются пользователем)", "", "указывается пользователем", "days", 0),
]}


def add_months(d: date, n: int) -> date:
    """При исчислении сроков месяцами срок истекает в соответствующее число
    последнего месяца; при отсутствии такого числа — в последние сутки месяца."""
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


def _is_nonworking(d: date, holidays: set[str]) -> bool:
    return d.weekday() >= 5 or d.isoformat() in holidays


def compute(rule_code: str, start: datetime, params: dict | None = None, adjustments: list | None = None,
            holidays: list[str] | None = None) -> dict:
    params = dict(params or {})
    adjustments = list(adjustments or [])
    hol = set(holidays or [])
    rule = RULES[rule_code]
    unit = params.get("unit") or rule.unit
    amount = int(params.get("amount", rule.amount))
    include_start = bool(params.get("include_start_day", rule.include_start_day))
    shift = bool(params.get("shift_nonworking", rule.shift_nonworking))
    if start.tzinfo is None:
        start = start.replace(tzinfo=settings.tz)
    else:
        start = start.astimezone(settings.tz)
    steps = [f"Исходная дата и время: {start:%d.%m.%Y %H:%M}"]

    if unit == "hours":
        due = start + timedelta(hours=amount)
        steps.append(f"Срок в часах: {amount} ч от исходного момента")
    else:
        base = start.date()
        if unit == "days":
            if amount >= 0:
                end_day = base + timedelta(days=amount - (1 if include_start else 0))
                steps.append(f"Срок в сутках: {amount}; сутки начала течения срока {'учитываются' if include_start else 'не учитываются (ч. 1 ст. 128 УПК РФ)'}")
            else:
                end_day = base + timedelta(days=amount)
                steps.append(f"Не позднее {abs(amount)} суток до исходной даты")
        else:
            end_day = add_months(base, amount)
            if include_start:
                end_day -= timedelta(days=1)
            steps.append(f"Срок в месяцах: {amount}; начальный день {'включается' if include_start else 'не включается'}")
        due = datetime.combine(end_day, time(23, 59), tzinfo=start.tzinfo)

    # Корректировки: продление и приостановление
    for adj in adjustments:
        kind = adj.get("type")
        if kind == "extension":
            if adj.get("new_due"):
                new_due = datetime.fromisoformat(adj["new_due"])
                if new_due.tzinfo is None:
                    new_due = new_due.replace(hour=23, minute=59, tzinfo=start.tzinfo) if len(adj["new_due"]) <= 10 else new_due.replace(tzinfo=start.tzinfo)
                due = new_due
                steps.append(f"Продление до {due:%d.%m.%Y} ({adj.get('basis') or 'основание не указано'})")
            elif adj.get("months"):
                end_day = add_months(start.date(), int(adj["months"])) - (timedelta(days=1) if include_start else timedelta(0))
                due = datetime.combine(end_day, time(23, 59), tzinfo=start.tzinfo)
                steps.append(f"Продление: общий срок {adj['months']} мес. ({adj.get('basis') or 'основание не указано'})")
            elif adj.get("days"):
                due = due + timedelta(days=int(adj["days"]))
                steps.append(f"Продление на {adj['days']} сут. ({adj.get('basis') or 'основание не указано'})")
    for adj in adjustments:
        if adj.get("type") == "suspension" and adj.get("from"):
            f = date.fromisoformat(adj["from"][:10])
            t = date.fromisoformat(adj["to"][:10]) if adj.get("to") else None
            if t is None:
                steps.append(f"Производство приостановлено с {f:%d.%m.%Y}; течение срока прервано, итоговая дата будет пересчитана после возобновления")
                return {"due_at": None, "steps": steps, "suspended": True, "rule": rule.code,
                        "basis": rule.basis_text, "basis_key": rule.basis_key, "note": rule.note}
            days = (t - f).days
            due = due + timedelta(days=days)
            steps.append(f"Время приостановления {f:%d.%m.%Y}–{t:%d.%m.%Y} ({days} сут.) не включается в срок")

    if shift and unit != "hours":
        shifted = 0
        d = due.date()
        while _is_nonworking(d, hol):
            d += timedelta(days=1)
            shifted += 1
        if shifted:
            due = datetime.combine(d, due.timetz())
            steps.append(f"Окончание срока приходится на нерабочий день — перенос на {d:%d.%m.%Y} (ч. 2 ст. 128 УПК РФ)")
        if not hol:
            steps.append("Календарь праздничных нерабочих дней не заполнен: учтены только суббота и воскресенье")
    steps.append(f"Итоговая дата: {due:%d.%m.%Y %H:%M}")
    return {"due_at": due.isoformat(), "steps": steps, "suspended": False, "rule": rule.code,
            "basis": rule.basis_text, "basis_key": rule.basis_key, "note": rule.note,
            "params": {"unit": unit, "amount": amount, "include_start_day": include_start, "shift_nonworking": shift}}
