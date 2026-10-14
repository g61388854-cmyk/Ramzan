# Инструкция по установке и обновлению

## 1. Состав поставки

| Компонент | Расположение | Назначение |
|---|---|---|
| Серверное приложение (FastAPI) | `backend/` | REST API, бизнес-логика, генерация и проверка документов |
| Веб-интерфейс (React + TypeScript) | `frontend/` | Рабочие места пользователей |
| Миграции схемы БД (Alembic) | `backend/alembic/` | Создание и обновление структуры PostgreSQL |
| Каталог шаблонов и схем полей | `backend/app/catalog/types/` | Виды процессуальных документов (YAML) |
| Правовой справочник (начальное наполнение) | `backend/app/legal/seed_data.py` | Реквизиты актов и перечень статей |
| Конфигурация развёртывания | `deploy/` | Docker Compose, Dockerfile, Caddy |
| Служебные скрипты | `scripts/` | Резервное копирование, восстановление, демонстрационные данные |

## 2. Требования к оборудованию

| Режим | ЦП | ОЗУ | Диск | Примечание |
|---|---|---|---|---|
| А. Автономный компьютер без языковой модели | 4 ядра | 8 ГБ | 50 ГБ SSD | OCR Tesseract, правиловое извлечение |
| А. Автономный компьютер с локальной моделью 7–8 млрд параметров | 8 ядер | 32 ГБ (или GPU 8–12 ГБ) | 100 ГБ SSD | Время ответа модели на ЦП — до нескольких минут |
| Б. Сервер подразделения (до 50 пользователей) | 8–16 ядер | 32–64 ГБ | 500 ГБ SSD + резервное хранилище | GPU — при использовании языковой модели |

Операционная система: Linux (x86_64) с Docker Engine 24+ и плагином Docker Compose v2. Для установки без контейнеров — Python 3.12, PostgreSQL 16, Node.js 22 (только для сборки интерфейса), Tesseract 5 с языковым пакетом `rus`.

## 3. Установка (Docker Compose)

1. Скопировать каталог поставки на сервер (без доступа к сети материалы дел не покидают сервер).
2. Подготовить переменные окружения:
   ```bash
   cd deploy
   cp .env.example .env
   chmod 600 .env
   python3 -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"   # ключ PAI_STORAGE_KEY
   ```
   Заполнить `PAI_DB_PASSWORD`, `PAI_STORAGE_KEY`, `PAI_ADMIN_PASSWORD` (не менее 10 символов, строчные и прописные буквы, цифры), `PAI_HOSTNAME`.
3. Собрать и запустить:
   ```bash
   docker compose build
   docker compose up -d
   docker compose ps          # все сервисы в состоянии healthy/running
   ```
   При первом запуске контейнер `app` применяет миграции (`alembic upgrade head`), создаёт роли, загружает каталог документов и начальное наполнение правового справочника, создаёт учётную запись администратора.
4. Открыть `https://<PAI_HOSTNAME>/` и выполнить вход администратором. Система потребует сменить первоначальный пароль.
5. Создать учётные записи пользователей (раздел «Администрирование») и учётную запись ответственного за правовой справочник (роль «Ответственный за правовой справочник»).
6. Загрузить официальные редакции нормативных актов (раздел «Правовой справочник» → «Импорт официальной редакции») и верифицировать их. До этого все правовые ссылки отображаются как непроверенные.
7. Заполнить календарь нерабочих праздничных дней («Администрирование» → «Настройки»).

### TLS-сертификат
По умолчанию Caddy использует внутренний удостоверяющий центр (`tls internal`). Корневой сертификат находится в томе `caddydata` (`/data/caddy/pki/authorities/local/root.crt`) и распространяется на рабочие места. Для использования сертификата организации заменить директиву `tls internal` на `tls /path/cert.pem /path/key.pem` и смонтировать файлы.

### Сетевая изоляция
Сервисы `db`, `app` и `ollama` подключены только к внутренней сети Docker (`internal: true`) и не имеют маршрута во внешние сети. Подключения рабочих мест принимает только обратный прокси (`edge`).

## 4. Подключение локальной языковой модели (необязательно)

```bash
# в .env: PAI_AI_PROVIDER=ollama, PAI_OLLAMA_MODEL=<модель>
docker compose --profile ai up -d ollama
# загрузка модели требует временного доступа к сети либо переноса файлов модели:
docker network connect procedural-ai_edge procedural-ai-ollama-1
docker compose exec ollama ollama pull qwen2.5:7b-instruct
docker network disconnect procedural-ai_edge procedural-ai-ollama-1
docker compose up -d app
```
Для автономной установки модель загружается на компьютере с доступом к сети (`ollama pull`), каталог `/root/.ollama/models` переносится в том `ollama` на целевой машине. Без языковой модели система полностью работоспособна: проекты описательных фрагментов формируются как сводка подтверждённых фактов.

## 5. Установка без контейнеров (режим А, автономный компьютер)

```bash
sudo apt install postgresql-16 tesseract-ocr tesseract-ocr-rus fonts-liberation python3.12-venv
sudo -u postgres createuser -P pai && sudo -u postgres createdb -O pai pai
cd backend && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export PAI_DATABASE_URL=postgresql+psycopg2://pai:<пароль>@localhost/pai PAI_DATA_DIR=/var/lib/pai \
       PAI_STORAGE_KEY=<ключ> PAI_ADMIN_LOGIN=admin PAI_ADMIN_PASSWORD=<пароль> PAI_FRONTEND_DIR=$PWD/../frontend/dist
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Интерфейс собирается один раз: `cd frontend && npm ci && npm run build`. Сервер раздаёт собранный интерфейс из `PAI_FRONTEND_DIR`. Для доступа по сети необходимо разместить перед приложением обратный прокси с TLS (Caddy или Nginx).

## 6. Параметры конфигурации

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PAI_DATABASE_URL` | SQLite в каталоге данных | Строка подключения к БД (в эксплуатации — PostgreSQL) |
| `PAI_DATA_DIR` | `./data` | Каталог зашифрованного хранилища файлов и экспортов |
| `PAI_STORAGE_KEY` | создаётся файл `storage.key` | Ключ AES-256-GCM для файлов (base64, 32 байта) |
| `PAI_MAX_UPLOAD_MB` | 50 | Ограничение размера загружаемого файла |
| `PAI_SESSION_IDLE_MINUTES` | 30 | Блокировка сессии при бездействии |
| `PAI_SESSION_ABSOLUTE_HOURS` | 12 | Максимальная длительность сессии |
| `PAI_LOGIN_MAX_FAILURES` / `PAI_LOGIN_LOCK_MINUTES` | 5 / 15 | Блокировка после неудачных попыток входа |
| `PAI_AI_PROVIDER` | `none` | `none` или `ollama` |
| `PAI_OLLAMA_URL`, `PAI_OLLAMA_MODEL` | — | Подключение локальной модели |
| `PAI_OCR_ENGINE` | `auto` | `auto`, `tesseract`, `paddle`, `none` |
| `PAI_ASR_MODEL` | — | Модель распознавания речи (при установленном faster-whisper) |
| `PAI_CLAMD_SOCKET` | — | Сокет антивируса ClamAV для проверки загружаемых файлов |
| `PAI_TZ` | `Europe/Moscow` | Часовой пояс расчёта сроков |
| `PAI_TASK_WORKERS` | 2 | Число потоков фоновой обработки |

## 7. Обновление

1. Выполнить резервное копирование (см. `02-backup-restore.md`).
2. Заменить файлы поставки, сохранив `deploy/.env` и тома Docker.
3. `docker compose build && docker compose up -d` — миграции схемы применяются автоматически.
4. Каталог шаблонов синхронизируется при запуске: изменённые виды документов получают новую версию шаблона; ранее сформированные документы сохраняют ссылку на прежнюю версию и не изменяются.
5. Проверить `GET /api/v1/health` и раздел «Главная панель».

Откат: восстановить резервную копию и запустить предыдущую версию образа (`image: procedural-ai:<версия>`).
