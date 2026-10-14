"""Правиловое извлечение сущностей и реквизитов из фрагментов материалов.

Извлечение детерминировано: повторная обработка одного и того же текста
даёт идентичный результат. Каждая сущность сохраняет позицию в исходном
фрагменте. Машинная оценка уверенности не вычисляется, поскольку правиловой
метод не даёт статистически обоснованной оценки.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, time

EXTRACTOR_ID = "rules:1.0"

MONTHS = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4, "мая": 5, "июня": 6,
    "июля": 7, "августа": 8, "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
}

ENTITY_LABELS = {
    "person": "Лицо (ФИО)",
    "date": "Дата",
    "birth_date": "Дата рождения",
    "incident_date": "Дата события",
    "time": "Время",
    "address": "Адрес",
    "phone": "Телефон",
    "case_number": "Номер дела / материала",
    "legal_ref": "Ссылка на норму",
    "money": "Сумма",
    "doc_ref": "Упоминание документа",
    "expertise": "Сведения об экспертизе",
    "decision": "Процессуальное решение",
    "testimony": "Показания / пояснения",
    "seized_item": "Изъятые предметы",
    "term": "Срок / интервал",
    "action_time_range": "Время начала и окончания действия",
}


@dataclass
class Entity:
    entity_type: str
    value: str
    normalized: str | None
    start: int
    end: int
    context: str


def _ctx(text: str, s: int, e: int, width: int = 90) -> str:
    a, b = max(0, s - width), min(len(text), e + width)
    return ("…" if a else "") + text[a:b].strip() + ("…" if b < len(text) else "")


def _safe_date(y: int, m: int, d: int) -> date | None:
    try:
        if y < 100:
            y += 2000 if y < 50 else 1900
        return date(y, m, d)
    except ValueError:
        return None


RE_DATE_NUM = re.compile(r"(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?![\d.]\d)")
RE_DATE_WORD = re.compile(
    r"(?<!\d)[«\"]?(\d{1,2})[»\"]?\s+(" + "|".join(MONTHS) + r")\s+(\d{4})", re.IGNORECASE
)
RE_TIME = re.compile(
    r"(?<![\d:])([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d:.]\d)(?=\s*(?:час|ч\.|мин|$|[^\d.]))"
    r"|(?<!\d)([01]?\d|2[0-3])\s*(?:час(?:ов|а)?|ч\.?)\s*([0-5]?\d)\s*(?:минут[аы]?|мин\.?)",
    re.IGNORECASE,
)
PATR = r"(?:ович|евич|ич|овна|евна|ична|инична)(?:а|у|ем|ем|е|ой|ы|ом|ой)?"
RE_FIO = re.compile(
    r"\b([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\s+([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+" + PATR + r")\b"
)
RE_FIO_INIT = re.compile(r"\b([А-ЯЁ][а-яё]{2,}(?:-[А-ЯЁ][а-яё]+)?)\s+([А-ЯЁ])\.\s?([А-ЯЁ])\.")
RE_INIT_FIO = re.compile(r"(?<![А-Яа-яЁё.])([А-ЯЁ])\.\s?([А-ЯЁ])\.\s?([А-ЯЁ][а-яё]{2,}(?:-[А-ЯЁ][а-яё]+)?)\b")
RE_PHONE = re.compile(r"(?<!\d)(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}(?!\d)")
RE_CASE = re.compile(
    r"(уголовно(?:е|го|му|м)\s+дел[оау]?|у/д|материал(?:а|е|у)?\s+проверки|КУСП)\s*(?:№|N|номер)\s*([0-9][0-9\-/]{2,30})",
    re.IGNORECASE,
)
RE_LEGAL = re.compile(
    r"(?:(п(?:\.|ункт[аеу]?)\s*[«\"]?([а-я0-9]{1,3})[»\"]?\s*)?)"
    r"(?:(ч(?:\.|аст[иью])\s*(\d{1,2})(?:\.\d)?\s*))?"
    r"ст(?:\.|ать[иеяю])\s*(\d{1,3}(?:\.\d{1,2})?)\s+"
    r"(УПК\s*РФ|УК\s*РФ|Уголовно-процессуального\s+кодекса(?:\s+Российской\s+Федерации)?|Уголовного\s+кодекса(?:\s+Российской\s+Федерации)?|КоАП\s*РФ|Конституции\s+(?:РФ|Российской\s+Федерации))",
    re.IGNORECASE,
)
RE_MONEY = re.compile(
    r"(?<![\d,])(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[,.](\d{1,2}))?\s*(?:\(\s*[а-яё\s\-]+\)\s*)?(руб(?:\.|л(?:ей|я|ь))?|₽)",
    re.IGNORECASE,
)
STREET = r"(?:ул\.|улица|пр-т|пр\.|проспект|пер\.|переулок|ш\.|шоссе|б-р|бульвар|наб\.|набережная|пл\.|площадь|мкр\.?|микрорайон|проезд)"
RE_ADDRESS = re.compile(
    r"((?:(?:г\.|город|пос\.|п\.|с\.|село|дер\.|д\.|пгт)\s*[А-ЯЁ][а-яё\-]+(?:\s[А-ЯЁ][а-яё\-]+)?,?\s*)?"
    + STREET
    + r"\s*[А-ЯЁ0-9][А-Яа-яЁё0-9\-\. ]{1,40}?,?\s*(?:д\.|дом)\s*\d+[А-Яа-я]?(?:/\d+)?"
    r"(?:\s*,?\s*(?:корп\.|к\.|стр\.|строение)\s*\d+)?(?:\s*,?\s*(?:кв\.|квартира|оф\.|офис)\s*\d+)?)"
)
DOC_WORDS = (
    r"(протокол\w*\s+(?:осмотра|допроса|обыска|выемки|очной\s+ставки|опознания|освидетельствования|проверки\s+показаний|задержания|принятия\s+устного\s+заявления)[\w\s]{0,40}?"
    r"|заключени\w+\s+эксперта|заключени\w+\s+специалиста|справк\w+\s+об\s+исследовании|справк\w+|рапорт\w*|постановлени\w+\s+о\s+[а-я]+\w*(?:\s+[а-я]+){0,3}?|объяснени\w+|заявлени\w+|акт\w*\s+[а-я]+\w*|ответ\w*\s+на\s+запрос)"
)
RE_DOCREF = re.compile(
    DOC_WORDS + r"\s*(?:№\s*([\w\-/]+))?\s*от\s*(\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}\s+(?:" + "|".join(MONTHS) + r")\s+\d{4})",
    re.IGNORECASE,
)
RE_EXPERTISE = re.compile(
    r"(заключени\w+\s+эксперта|экспертиз\w+)\s*№\s*([\w\-/]+)(?:\s*от\s*(\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}\s+(?:"
    + "|".join(MONTHS) + r")\s+\d{4}))?",
    re.IGNORECASE,
)
RE_DECISION = re.compile(
    r"(постановлени\w+|определени\w+)\s+(?:[а-я]+\s+)?о(?:б)?\s+((?:возбуждении|отказе|прекращении|приостановлении|возобновлении|"
    r"назначении|признании|привлечении|избрании|продлении|соединении|выделении|передаче|наложении|производстве)[а-яё\s\-]{0,120}?)(?=[,.;]|\s+от\s|$)",
    re.IGNORECASE,
)
RE_TESTIMONY = re.compile(
    r"((?:показал|пояснил|сообщил|заявил|указал)(?:а|и)?\s*(?:следующее)?\s*[,:]?\s*(?:что)?\s+(?:[^.]|(?<=\d)\.(?=\d)|(?<=\s[а-яё])\.){10,400}\.)",
    re.IGNORECASE,
)
NOT_SURNAMES = {
    "следователь", "свидетель", "потерпевший", "потерпевшая", "подозреваемый", "подозреваемая", "обвиняемый",
    "обвиняемая", "эксперт", "специалист", "защитник", "адвокат", "переводчик", "гражданин", "гражданка",
    "понятой", "понятая", "руководитель", "начальник", "дознаватель", "прокурор", "судья", "заявитель",
    "оперуполномоченный", "участковый", "старший", "майор", "капитан", "лейтенант", "подполковник", "полковник",
    "юстиции", "полиции", "ул", "улица", "город", "район", "дом", "согласно",
}
RE_SEIZED = re.compile(r"(изъят[аоы]?|обнаружен[аоы]?\s+и\s+изъят[аоы]?)\s*:?\s*([^.;]{3,200})", re.IGNORECASE)
RE_TERM = re.compile(
    r"(?:срок\w*|в\s+течение)\s+(?:[а-яё]+\s+){0,3}?(\d{1,3})\s*(час(?:а|ов)?|суток|сут\.|дн(?:я|ей)|месяц(?:а|ев)?|мес\.)",
    re.IGNORECASE,
)
RE_ACTION_RANGE = re.compile(
    r"(?:начат[оа]?|начало)\D{0,20}?(\d{1,2})\s*(?:ч(?:ас(?:ов|а)?)?\.?|:)\s*(\d{1,2})\s*(?:мин(?:ут[аы]?)?\.?)?"
    r".{0,200}?(?:окончен[оа]?|окончание|завершен[оа]?)\D{0,20}?(\d{1,2})\s*(?:ч(?:ас(?:ов|а)?)?\.?|:)\s*(\d{1,2})",
    re.IGNORECASE | re.DOTALL,
)
INCIDENT_HINT = re.compile(
    r"(совершил|совершила|совершено|произош|похитил|похищен|нанес|нанёс|проник|завладел|причинил|напал|"
    r"имело\s+место|в\s+период\s+времени|находясь)",
    re.IGNORECASE,
)
BIRTH_HINT = re.compile(r"(рожд|г\.\s*р\.|года\s+рождения|дата\s+рождения)", re.IGNORECASE)


# --- нормализация ----------------------------------------------------------

_SURNAME_ENDINGS = [
    (re.compile(r"(ов|ев|ёв|ин|ын)(а|у|ым|ом|е|ой|ых|ы)$"), r"\1"),
    (re.compile(r"(ск|цк)(ого|ому|им|ом|ая|ой|ую|ий|ой)$"), r"\1ий"),
]


def surname_stem(surname: str) -> str:
    s = surname.lower().replace("ё", "е")
    for rx, rep in _SURNAME_ENDINGS:
        new = rx.sub(rep, s)
        if new != s:
            return new
    # Несклоняемые и прочие фамилии: отбрасывается типовое падежное окончание
    if len(s) > 5 and s[-1] in "аеуюя":
        return s[:-1]
    if len(s) > 6 and s[-2:] in ("ем", "ом", "ой"):
        return s[:-2]
    return s


def person_key(surname: str, first_initial: str, patr_initial: str) -> str:
    return f"{surname_stem(surname)}|{first_initial.upper()}|{patr_initial.upper()}"


def parse_date_text(text: str) -> date | None:
    m = RE_DATE_NUM.search(text)
    if m:
        return _safe_date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    m = RE_DATE_WORD.search(text)
    if m:
        return _safe_date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
    return None


def _legal_norm(m: re.Match) -> tuple[str, str]:
    code_raw = m.group(6).lower()
    if "упк" in code_raw or "процессуальн" in code_raw:
        code = "upk"
    elif "коап" in code_raw:
        code = "koap"
    elif "конституц" in code_raw:
        code = "konst"
    else:
        code = "uk"
    parts = [code, m.group(5)]
    if m.group(4):
        parts.append(m.group(4))
    if m.group(2):
        if not m.group(4):
            parts.append("")
        parts.append(m.group(2).lower())
    return ":".join(parts), code


def extract_entities(text: str) -> list[Entity]:
    found: list[Entity] = []

    def add(t: str, s: int, e: int, norm: str | None, value: str | None = None):
        found.append(Entity(t, (value if value is not None else text[s:e]).strip(), norm, s, e, _ctx(text, s, e)))

    for m in RE_DATE_NUM.finditer(text):
        d = _safe_date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        if d:
            add(_date_kind(text, m.start(), m.end()), m.start(), m.end(), d.isoformat())
    for m in RE_DATE_WORD.finditer(text):
        d = _safe_date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
        if d:
            add(_date_kind(text, m.start(), m.end()), m.start(), m.end(), d.isoformat())
    for m in RE_TIME.finditer(text):
        h, mi = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        try:
            add("time", m.start(), m.end(), time(int(h), int(mi)).strftime("%H:%M"))
        except ValueError:
            pass
    taken: list[tuple[int, int]] = []
    for m in RE_FIO.finditer(text):
        sur, name, patr = m.group(1), m.group(2), m.group(3)
        add("person", m.start(), m.end(), person_key(sur, name[0], patr[0]))
        taken.append((m.start(), m.end()))
    for rx, order in ((RE_INIT_FIO, (2, 0, 1)), (RE_FIO_INIT, (0, 1, 2))):
        for m in rx.finditer(text):
            if any(a < m.end() and m.start() < b for a, b in taken):
                continue
            g = m.groups()
            sur, fi, pi = g[order[0]], g[order[1]], g[order[2]]
            if sur.lower() in NOT_SURNAMES:
                continue
            add("person", m.start(), m.end(), person_key(sur, fi, pi))
            taken.append((m.start(), m.end()))
    for m in RE_PHONE.finditer(text):
        digits = re.sub(r"\D", "", m.group(0))
        add("phone", m.start(), m.end(), "+7" + digits[-10:])
    for m in RE_CASE.finditer(text):
        kind = m.group(1).lower()
        prefix = "kusp" if "кусп" in kind else ("check" if "провер" in kind else "case")
        add("case_number", m.start(), m.end(), f"{prefix}:{m.group(2).strip('-/')}")
    for m in RE_LEGAL.finditer(text):
        norm, _ = _legal_norm(m)
        add("legal_ref", m.start(), m.end(), norm)
    for m in RE_MONEY.finditer(text):
        whole = re.sub(r"[  ]", "", m.group(1))
        frac = (m.group(2) or "00").ljust(2, "0")
        add("money", m.start(), m.end(), f"{int(whole)}.{frac}")
    for m in RE_ADDRESS.finditer(text):
        val = m.group(1).strip(" ,")
        add("address", m.start(1), m.start(1) + len(val), re.sub(r"\s+", " ", val.lower()))
    for m in RE_DOCREF.finditer(text):
        kind = re.sub(r"\s+", " ", m.group(1).strip().lower())
        num = m.group(2) or ""
        d = parse_date_text(m.group(3))
        add("doc_ref", m.start(), m.end(), f"{kind}|{num}|{d.isoformat() if d else ''}")
    for m in RE_EXPERTISE.finditer(text):
        d = parse_date_text(m.group(3) or "")
        add("expertise", m.start(), m.end(), f"{m.group(2)}|{d.isoformat() if d else ''}")
    for m in RE_DECISION.finditer(text):
        add("decision", m.start(), m.end(), re.sub(r"\s+", " ", m.group(0).lower()).strip())
    for m in RE_TESTIMONY.finditer(text):
        add("testimony", m.start(), m.end(), None)
    for m in RE_SEIZED.finditer(text):
        add("seized_item", m.start(), m.end(), re.sub(r"\s+", " ", m.group(2).strip().lower()))
    for m in RE_TERM.finditer(text):
        add("term", m.start(), m.end(), f"{m.group(1)} {m.group(2).lower()}")
    for m in RE_ACTION_RANGE.finditer(text):
        try:
            t1 = time(int(m.group(1)), int(m.group(2)))
            t2 = time(int(m.group(3)), int(m.group(4)))
        except ValueError:
            continue
        add("action_time_range", m.start(), m.end(), f"{t1:%H:%M}-{t2:%H:%M}")
    found.sort(key=lambda e: (e.start, e.entity_type))
    return found


BIRTH_BEFORE = re.compile(r"(дата\s+рождения|родил(?:ся|ась)|д\.\s?р\.)\s*[:\-–]?\s*$", re.IGNORECASE)
BIRTH_AFTER = re.compile(r"^\s*(г\.\s*р\.|года\s+рождения|г\.\s*рождения)", re.IGNORECASE)
DOC_DATE_BEFORE = re.compile(r"(\bот|№\s*\S+\s+от|выдан[аоы]?)\s*$", re.IGNORECASE)


RE_SENT_END = re.compile(r"(?<=[^\s.]{3})[.!?]\s+(?=[А-ЯЁA-Z«\"])|\n")


def _sentence(text: str, s: int, e: int) -> str:
    """Предложение, содержащее позицию; сокращения («г.», «ул.», «д.»), инициалы
    и точки внутри дат не считаются концом предложения."""
    left, right = 0, len(text)
    for m in RE_SENT_END.finditer(text):
        if m.end() <= s:
            left = m.end()
        elif m.start() >= e:
            right = m.start()
            break
    return text[left:right]


def _date_kind(text: str, s: int, e: int) -> str:
    before = text[max(0, s - 30) : s]
    after = text[e : e + 25]
    if BIRTH_AFTER.search(after) or BIRTH_BEFORE.search(before):
        return "birth_date"
    if DOC_DATE_BEFORE.search(before):
        return "date"
    if INCIDENT_HINT.search(_sentence(text, s, e)):
        return "incident_date"
    return "date"


DOC_KINDS = [
    ("rapport", re.compile(r"^\W*рапорт", re.I)),
    ("interrogation_protocol", re.compile(r"протокол\s+допроса", re.I)),
    ("inspection_protocol", re.compile(r"протокол\s+осмотра", re.I)),
    ("search_protocol", re.compile(r"протокол\s+(обыска|выемки)", re.I)),
    ("confrontation_protocol", re.compile(r"протокол\s+очной\s+ставки", re.I)),
    ("oral_statement_protocol", re.compile(r"протокол\s+принятия\s+устного\s+заявления", re.I)),
    ("explanation", re.compile(r"^\W*объяснение", re.I)),
    ("statement", re.compile(r"^\W*заявление", re.I)),
    ("expert_opinion", re.compile(r"заключение\s+эксперта", re.I)),
    ("specialist_opinion", re.compile(r"заключение\s+специалиста", re.I)),
    ("research_certificate", re.compile(r"справка\s+об\s+исследовании", re.I)),
    ("resolution", re.compile(r"^\W*постановление", re.I)),
    ("reply", re.compile(r"(ответ\s+на\s+(ваш\s+)?запрос|на\s+ваш\s+запрос)", re.I)),
    ("certificate", re.compile(r"^\W*справка", re.I)),
]

DOC_KIND_LABELS = {
    "rapport": "Рапорт",
    "interrogation_protocol": "Протокол допроса",
    "inspection_protocol": "Протокол осмотра",
    "search_protocol": "Протокол обыска (выемки)",
    "confrontation_protocol": "Протокол очной ставки",
    "oral_statement_protocol": "Протокол принятия устного заявления",
    "explanation": "Объяснение",
    "statement": "Заявление",
    "expert_opinion": "Заключение эксперта",
    "specialist_opinion": "Заключение специалиста",
    "research_certificate": "Справка об исследовании",
    "resolution": "Постановление",
    "reply": "Ответ на запрос",
    "certificate": "Справка",
}


def detect_kind(first_fragments: list[str]) -> str | None:
    head = "\n".join(first_fragments)[:1500]
    for code, rx in DOC_KINDS:
        if rx.search(head):
            return code
    return None
