#!/bin/sh
set -eu
# Применение миграций схемы БД перед запуском
alembic upgrade head
# Начальная инициализация и восстановление после сбоя — один раз, до запуска рабочих процессов
python -m app.bootstrap
export PAI_SKIP_BOOTSTRAP=1
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "${PAI_WORKERS:-2}" --proxy-headers --forwarded-allow-ips="${PAI_TRUSTED_PROXY:-127.0.0.1}"
