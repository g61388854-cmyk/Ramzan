# Модель данных

СУБД — PostgreSQL 16; схема создаётся миграциями Alembic (`backend/alembic/versions`). Основные сущности имеют устойчивые идентификаторы UUID.

| Таблица | Назначение | Ключевые связи и ограничения |
|---|---|---|
| `roles` | Роли и полномочия | `code` уникален |
| `users` | Учётные записи | FK `role_id` (RESTRICT); `login` уникален |
| `user_sessions` | Сессии (хеш токена) | FK `user_id` (CASCADE); `token_hash` уникален |
| `cases` | Уголовные дела | FK `investigator_id`, `created_by` (SET NULL); CHECK `stage`; `reg_id` уникален |
| `case_members` | Доступ пользователей к делу | PK (`case_id`, `user_id`); CHECK `access` |
| `case_participants` | Участники и их роли | FK `case_id` (RESTRICT); CHECK `kind`; сведения по роли — JSON `data` |
| `change_history` | История изменений карточек | Значения «до» и «после» |
| `case_events` | Хронология событий | FK `case_id` (RESTRICT), `document_id`, `file_id` |
| `source_files` | Загруженные материалы | FK `case_id` (RESTRICT); уникальны `stored_name`, (`case_id`, `source_code`); SHA-256 |
| `source_fragments` | Страницы и фрагменты | FK `file_id` (CASCADE); уникален (`file_id`, `seq`); полнотекстовый индекс GIN |
| `extracted_entities` | Извлечённые сущности | Позиция в фрагменте, извлекатель, оценка (если достоверно определима) |
| `fact_claims` | Карточки фактов | CHECK `status`, `origin`; исходное значение при ручной правке |
| `fact_sources` | Подтверждающие источники факта | FK `fact_id` (CASCADE), `file_id`, `fragment_id`; цитата |
| `discrepancies` | Потенциальные расхождения | уникальна (`case_id`, `signature`) |
| `document_templates` | Версии шаблонов | уникальна (`type_code`, `version`) |
| `document_fields` | Схемы полей шаблонов | уникальна (`template_id`, `key`) |
| `documents` | Документы | FK `case_id` (RESTRICT), `template_id` (RESTRICT); CHECK `status` |
| `document_versions` | Неизменяемые версии | уникальна (`document_id`, `number`); снимок данных дела и участников |
| `document_exports` | Экспортированные файлы | FK версии; SHA-256 файла |
| `legal_acts` | Нормативные акты | `code` уникален |
| `legal_provisions` | Статьи (части, пункты) | `key` уникален (например, `upk:146`) |
| `legal_versions` | Редакции норм | Даты действия, источник, верификация |
| `document_legal_bases` | Связь документов с основаниями | FK версии нормы; признак проверки на дату |
| `deadlines` | Процессуальные сроки | CHECK `status`; параметры, корректировки, описание расчёта |
| `tasks` | Фоновые задачи | Состояние, прогресс, ошибка |
| `audit_events` | Журнал действий | Индексы по времени, пользователю, действию, делу |
| `settings` | Настройки | Календарь нерабочих дней и др. |

Удаление дел, участников, материалов и документов не предусмотрено интерфейсом — используется архивирование; ограничения `RESTRICT` предотвращают удаление дела со связанными записями. Изменение карточки дела не изменяет сохранённые версии документов: каждая версия хранит HTML-текст, значения полей, их источники и снимок сведений дела.
