"""Схемы полей карточек участников по процессуальному положению.
Ни одно из дополнительных полей не является обязательным на уровне карточки:
обязательность определяется конкретным видом документа."""
from __future__ import annotations

PERSON_COMMON = [
    {"key": "birth_date", "label": "Дата рождения", "type": "date"},
    {"key": "birth_place", "label": "Место рождения", "type": "text"},
    {"key": "citizenship", "label": "Гражданство", "type": "text"},
    {"key": "identity_document", "label": "Документ, удостоверяющий личность", "type": "text"},
    {"key": "address_registration", "label": "Адрес регистрации", "type": "text"},
    {"key": "address_actual", "label": "Адрес фактического проживания", "type": "text"},
    {"key": "phone", "label": "Телефон", "type": "text"},
    {"key": "occupation", "label": "Место работы (учёбы), должность", "type": "text"},
    {"key": "education", "label": "Образование", "type": "text"},
    {"key": "language", "label": "Язык, которым владеет", "type": "text"},
]
ORG_COMMON = [
    {"key": "org_details", "label": "Реквизиты (ИНН, ОГРН)", "type": "text"},
    {"key": "address_registration", "label": "Юридический адрес", "type": "text"},
    {"key": "representative_name", "label": "Представитель организации", "type": "text"},
    {"key": "authority_document", "label": "Документ, подтверждающий полномочия представителя", "type": "text"},
    {"key": "phone", "label": "Телефон", "type": "text"},
]
ROLE_EXTRA = {
    "suspect": [
        {"key": "family_status", "label": "Семейное положение, наличие иждивенцев", "type": "text"},
        {"key": "military_status", "label": "Отношение к воинской обязанности", "type": "text"},
        {"key": "criminal_record", "label": "Сведения о судимости", "type": "textarea"},
        {"key": "detained_at", "label": "Дата и время фактического задержания", "type": "datetime"},
        {"key": "measure", "label": "Мера пресечения", "type": "text"},
    ],
    "victim": [
        {"key": "harm", "label": "Характер и размер вреда", "type": "textarea"},
        {"key": "recognized_at", "label": "Дата признания потерпевшим", "type": "date"},
    ],
    "defender": [
        {"key": "bar_formation", "label": "Адвокатское образование", "type": "text"},
        {"key": "registry_number", "label": "Регистрационный номер в реестре адвокатов", "type": "text"},
        {"key": "warrant", "label": "Ордер (номер, дата)", "type": "text"},
        {"key": "client_id", "label": "Подзащитный", "type": "participant"},
    ],
    "representative": [
        {"key": "represented_id", "label": "Представляемое лицо", "type": "participant"},
        {"key": "authority_document", "label": "Документ, подтверждающий полномочия", "type": "text"},
    ],
    "legal_representative": [
        {"key": "represented_id", "label": "Представляемое лицо", "type": "participant"},
        {"key": "relation", "label": "Основание представительства", "type": "text"},
    ],
    "witness": [{"key": "relation", "label": "Отношение к участникам", "type": "text"}],
    "expert": [
        {"key": "institution", "label": "Экспертное учреждение", "type": "text"},
        {"key": "specialty", "label": "Экспертная специальность", "type": "text"},
        {"key": "experience_years", "label": "Стаж экспертной работы (лет)", "type": "text"},
    ],
    "specialist": [
        {"key": "institution", "label": "Место работы", "type": "text"},
        {"key": "specialty", "label": "Специальность", "type": "text"},
    ],
    "interpreter": [{"key": "language", "label": "Язык перевода", "type": "text"}],
    "civil_plaintiff": [{"key": "claim", "label": "Сведения о гражданском иске", "type": "textarea"}],
    "civil_defendant": [{"key": "liability_basis", "label": "Основание ответственности", "type": "textarea"}],
}
ROLE_EXTRA["accused"] = ROLE_EXTRA["suspect"] + [{"key": "charged_at", "label": "Дата предъявления обвинения", "type": "date"}]


def schema_for(role: str, kind: str) -> list[dict]:
    base = ORG_COMMON if kind == "organization" else PERSON_COMMON
    keys = {f["key"] for f in base}
    return base + [f for f in ROLE_EXTRA.get(role, []) if f["key"] not in keys]


def allowed_keys(role: str, kind: str) -> set[str]:
    return {f["key"] for f in schema_for(role, kind)}
