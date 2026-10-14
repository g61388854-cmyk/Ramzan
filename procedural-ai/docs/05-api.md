# Документация API

Полная спецификация OpenAPI 3 формируется автоматически: `GET /api/v1/openapi.json`, интерактивная документация — `/api/docs`. Все маршруты (кроме `/auth/login` и `/health`) требуют заголовка `Authorization: Bearer <токен>`.

## Основные группы маршрутов

| Группа | Маршруты |
|---|---|
| Аутентификация | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` |
| Пользователи | `GET/POST /users`, `PATCH /users/{id}`, `GET /users/roles`, `GET /users/directory` |
| Дела | `GET/POST /cases`, `GET/PATCH /cases/{id}`, `GET /cases/{id}/history`, `POST/DELETE /cases/{id}/members`, `GET /cases/{id}/timeline` |
| Участники | `GET /participants/schema`, `GET/POST /cases/{id}/participants`, `PATCH /participants/{id}` |
| События | `GET/POST /cases/{id}/events`, `PATCH /events/{id}` |
| Материалы | `GET /files/categories`, `POST /cases/{id}/files` (multipart), `GET /cases/{id}/files`, `GET/PATCH /files/{id}`, `GET /files/{id}/download`, `GET /files/{id}/fragments`, `POST /files/{id}/reprocess` |
| Извлечение и факты | `GET /cases/{id}/entities`, `GET/POST /cases/{id}/facts`, `GET/PATCH /facts/{id}` |
| Расхождения | `GET /cases/{id}/discrepancies`, `POST /cases/{id}/discrepancies/refresh`, `PATCH /discrepancies/{id}` |
| Каталог | `GET /templates`, `GET /templates/{code}`, `GET /templates/kits`, `GET /templates/specializations`, `POST /templates/import` |
| Документы | `GET/POST /cases/{id}/documents`, `POST /cases/{id}/kits`, `POST /cases/{id}/assistant/suggest`, `GET /documents/{id}`, `POST /documents/{id}/preview`, `GET/POST /documents/{id}/versions`, `GET /documents/{id}/versions/{n}`, `GET /documents/{id}/diff?a=&b=`, `POST /documents/{id}/validate`, `POST /documents/{id}/status`, `POST /documents/{id}/export?fmt=docx\|pdf`, `GET /documents/{id}/exports`, `GET /exports/{id}/download`, `GET /documents/{id}/legal`, `POST /documents/{id}/ai-draft` |
| Правовой справочник | `GET /legal/status`, `GET /legal/acts`, `GET /legal/acts/{code}/provisions?on=`, `GET /legal/provisions/{key}?on=`, `GET /legal/search?q=`, `GET /legal/check?key=&on=`, `POST /legal/import`, `POST /legal/versions/{id}/verify` |
| Сроки | `GET /deadlines/rules`, `POST /deadlines/preview`, `GET/POST /cases/{id}/deadlines`, `PATCH /deadlines/{id}`, `GET /deadlines/{id}/history`, `GET /deadlines?days=` |
| Служебные | `GET /tasks/{id}`, `GET /tasks`, `GET /audit`, `GET /cases/{id}/audit`, `GET /search?q=`, `GET /dashboard`, `GET /system/status`, `GET /settings`, `PUT /settings/{key}`, `GET /health` |

Префикс всех маршрутов — `/api/v1`.

## Асинхронная обработка
Загрузка материала возвращает объект задачи (`task.id`). Состояние — `GET /tasks/{id}`: `queued` → `running` → `done` | `failed` | `interrupted`, поля `progress`, `message`, `result`, `error`.

## Пример: формирование документа
```bash
TOKEN=$(curl -s -X POST https://host/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"login":"inv","password":"***"}' | jq -r .token)
curl -s -X POST https://host/api/v1/cases/$CASE/documents -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"type_code":"victim_recognition","mode":"template"}'
```
Ответ содержит документ, первую версию (`content_html`, `field_values`, `field_sources`), результаты проверки (`validation`) и подсказки (`suggestions`).

## Источники значений полей (`field_sources`)
`manual` — ручной ввод; `case` — карточка дела; `participant` — карточка участника; `fact` — подтверждённый факт (`id`); `system` — автоматически (например, текущая дата); `ai` — проект языковой модели; `assist` — сводка фактов без модели. Для `ai`/`assist` поле `confirmed` отражает подтверждение пользователем.

## Коды ответов
`401` — нет или истекла сессия; `403` — недостаточно полномочий или доступ только для чтения; `404` — объект не найден либо доступ к делу запрещён; `409` — недопустимый переход статуса или конфликт; `422` — ошибка валидации; `423` — учётная запись временно заблокирована.
