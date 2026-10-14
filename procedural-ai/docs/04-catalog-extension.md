# Расширение каталога процессуальных документов

Вид документа описывается декларативно в YAML и не требует изменения программного кода. Встроенные описания находятся в `backend/app/catalog/types/s*.yaml`; дополнительные виды загружаются администратором через «Каталог документов» → «Добавить вид документа (YAML)» (эндпоинт `POST /api/v1/templates/import`).

## Структура описания

```yaml
documents:
  - code: custom_notice                 # уникальный код (латиница)
    title: "Уведомление о ..."          # наименование
    section: requests                   # раздел каталога: check | organization | protocols | participants |
                                        #   coercion | court | requests | expertise | evidence | completion
    kind: notice                        # resolution | head_resolution | protocol | court_petition | petition |
                                        #   notice | request | order | letter | form | inventory | indictment | report
    author: "Следователь"               # автор документа (отображается и учитывается при проверке)
    addressee: "Прокурор"               # адресат (необязательно)
    stages: [investigation]             # допустимые стадии: check, investigation, suspended, completed,
                                        #   sent_to_prosecutor, terminated
    requires_court: false               # требуется судебное решение
    requires_head_consent: false        # требуется согласие руководителя следственного органа
    keywords: [уведомление]             # ключевые слова для подбора по описанию задачи
    legal_bases:                        # правовые основания — ТОЛЬКО ключи справочника
      - {key: "upk:123", reason: "Право обжалования", mandatory: true}
    warnings: ["Текст предупреждения пользователю"]
    value_warnings:                     # предупреждения при выборе значения поля
      field_key: {"значение": "текст предупреждения"}
    value_errors:                       # блокирующие ошибки при выборе значения
      field_key: {"значение": "текст ошибки"}
    fields:
      - use: header                     # подключение набора общих полей (см. _presets.yaml)
      - {key: text, label: "Текст", type: textarea, required: true, narrative: true}
    body: |
      {{ m.title("УВЕДОМЛЕНИЕ") }}
      {{ m.place_date() }}
      <p>{{ v.text }}</p>
      {{ m.investigator_sign() }}
```

### Типы полей
`text`, `textarea`, `date`, `time`, `datetime`, `number`, `select` (с `options`), `bool`, `participant` (с `participant_role`, например `"suspect|accused"`), `participants`, `list`.

### Атрибуты поля
- `required` — обязательность; `condition` — условие активности поля: `key`, `!key`, `key == 'значение'`, `key != 'значение'`, `key in ['a','b']`, соединение через `&&`.
- `binding` — источник предзаполнения: `today`, `case.<поле карточки>` (`case_number`, `opened_at`, `qualification`, `city`, `investigator_name`, `investigator_position`, `head_name`, `head_position`, `investigative_body`, `fabula`), `fact:<тип факта>` (подставляется единственный подтверждённый факт данного типа).
- `narrative: true` — описательное поле, для которого доступна функция «Проект по фактам».
- `group`, `help` — группировка и подсказка в форме.

### Шаблон текста
Jinja2 в песочнице с автоэкранированием. Доступны:
- `v.<key>` — значение поля с указанием источника либо видимая отметка «[не заполнено: …]»; `vc.<key>` — то же с прописной буквы; `vl.<key>` — даты в формате ««12» марта 2026 г.»; `has.<key>` — признак заполненности; `raw.<key>` — исходное значение.
- `pv('поле', 'атрибут')` — атрибут участника (`display_name`, `short_name`, `birth_date`, `birth_place`, `address_actual`, `role_label` и др.) с отметкой о пропуске; `pval(...)` — значение без разметки; `plist('поле')` — список участников.
- Макросы `m.*` из `_macros.html`: `title`, `place_date`, `protocol_head`, `protocol_participants_block`, `protocol_end_block`, `participant_details`, `participant_card`, `sign`, `investigator_sign`, `head_consent`, `head_approve`, `letter_head`, `addressee_block`.

### Правила
1. Правовые основания указываются ключами справочника (`upk:146`, `uk:158`). Если норма отсутствует в справочнике, её необходимо предварительно добавить импортом официальной редакции.
2. Шаблон не должен содержать фактических обстоятельств, дат и реквизитов, кроме подставляемых из полей.
3. Специализированные профили (`_specializations.yaml`) дополняют существующие виды документов подсказками и не создают новых процессуальных полномочий.
4. Комплекты (`_kits.yaml`) объединяют существующие виды документов; каждый документ комплекта формируется и проверяется отдельно.

## Проверка
При загрузке выполняются: проверка схемы, раскрытие наборов полей, пробное формирование документа с тестовыми значениями. Ошибка в шаблоне (например, обращение к несуществующему полю) отклоняет загрузку. Для встроенного каталога те же проверки выполняет автотест `tests/test_catalog.py`.

## Версионирование
Изменённое описание сохраняется как новая версия шаблона. Документы, сформированные ранее, сохраняют ссылку на свою версию; в результатах проверки отображается наличие более новой версии.
