# PROCEDURAL AI

Интеллектуальная система подготовки процессуальных документов следователя: электронное досье уголовного дела, загрузка и анализ материалов, карточки фактов с прослеживаемостью до источника, выявление потенциальных расхождений, каталог процессуальных документов, генератор и редактор документов, проверка правовых оснований по локальному справочнику, контроль процессуальных сроков, экспорт в DOCX/PDF. Развёртывается локально; обязательная передача материалов во внешние облачные сервисы отсутствует.

> Система формирует **проекты** документов. Каждый проект подлежит проверке уполномоченным пользователем. Правовые ссылки считаются проверенными только после загрузки официальной редакции нормы и её верификации ответственным лицом.

## Состав

```
procedural-ai/
  backend/            FastAPI, SQLAlchemy, Alembic, сервисы обработки, каталог шаблонов, справочник, автотесты
    app/api/          REST API (/api/v1, OpenAPI)
    app/services/     извлечение текста, OCR, извлечение сущностей, расхождения, генератор, проверка,
                      экспорт DOCX/PDF, расчёт сроков, ИИ-контур
    app/catalog/      каталог видов документов (YAML + Jinja2), наборы полей, комплекты, профили
    app/legal/        правовой справочник: начальное наполнение, импорт, редакции, проверка ссылок
    alembic/          миграции схемы PostgreSQL
    tests/            pytest (функциональные тесты, тесты качества извлечения на синтетическом наборе)
  frontend/           React + TypeScript (Vite), сквозные тесты Playwright (e2e/)
  deploy/             Dockerfile, docker-compose.yml, Caddyfile, .env.example
  scripts/            backup.sh, restore.sh, seed_demo.py (синтетические данные)
  docs/               эксплуатационная документация
```

## Демонстрационная версия

Бессерверная демо-версия интерфейса (синтетические данные хранятся в браузере): https://g61388854-cmyk.github.io/Ramzan/ — логин `demo`, пароль `Demo-Pass-2026`. Сборка: `cd frontend && npm run build:demo` (данные формируются скриптом `scripts/export_demo_data.py` из настоящего каталога шаблонов и конвейера обработки). В демо-версии недоступны обработка DOCX/PDF/сканов, языковая модель, импорт норм, серверный экспорт DOCX/PDF (вместо него — документ Word в формате HTML и печать в PDF).

## Быстрый запуск

```bash
cd deploy && cp .env.example .env   # заполнить секреты
docker compose build && docker compose up -d
# https://<PAI_HOSTNAME>/  — вход администратором, затем смена пароля
python3 ../scripts/seed_demo.py --url https://<host> --password '<пароль администратора>'   # демонстрационные данные (необязательно)
```

Разработка без контейнеров:
```bash
cd backend && pip install -r requirements-dev.txt
PAI_ADMIN_LOGIN=admin PAI_ADMIN_PASSWORD='Admin-Pass-2026' uvicorn app.main:app --reload   # SQLite в ./data
cd frontend && npm install && npm run dev                                                   # http://localhost:5173
```

## Проверка

```bash
cd backend && python3 -m pytest -q                                        # SQLite
PAI_TEST_DATABASE_URL=postgresql+psycopg2://pai:***@localhost/pai_test python3 -m pytest -q   # PostgreSQL
cd frontend && npm run typecheck && npm run build
PAI_E2E_URL=http://127.0.0.1:8000 npx playwright test                     # требуется сервер с демо-данными
```

## Документация

| Документ | Содержание |
|---|---|
| [docs/01-installation.md](docs/01-installation.md) | Установка, параметры, подключение модели, обновление |
| [docs/02-backup-restore.md](docs/02-backup-restore.md) | Резервное копирование и восстановление |
| [docs/03-security-roles.md](docs/03-security-roles.md) | Ролевая модель и меры защиты, работа с ИИ |
| [docs/04-catalog-extension.md](docs/04-catalog-extension.md) | Расширение каталога документов |
| [docs/05-api.md](docs/05-api.md) | Документация API |
| [docs/06-limitations-acceptance.md](docs/06-limitations-acceptance.md) | Известные ограничения и результаты приёмочных испытаний |
| [docs/07-user-guide.md](docs/07-user-guide.md) | Руководство пользователя |
| [docs/08-data-model.md](docs/08-data-model.md) | Модель данных |

Тестовые данные (`backend/tests/data`, `scripts/seed_demo.py`) полностью синтетические и не содержат реальных персональных данных.
