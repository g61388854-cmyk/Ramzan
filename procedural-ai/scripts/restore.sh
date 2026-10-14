#!/bin/sh
# Восстановление из резервной копии, созданной backup.sh.
#   PAI_BACKUP_PASSPHRASE_FILE=/secure/backup.pass ../scripts/restore.sh backups/pai-YYYYMMDD-HHMMSS.tar.enc
# ВНИМАНИЕ: текущие данные БД и файлового хранилища будут заменены.
set -eu
cd "$(dirname "$0")/../deploy"
ARCHIVE="${1:?укажите файл резервной копии}"
: "${PAI_BACKUP_PASSPHRASE_FILE:?укажите файл с парольной фразой}"
sha256sum -c "$ARCHIVE.sha256"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PAI_BACKUP_PASSPHRASE_FILE" -in "$ARCHIVE" | tar -C "$TMP" -xf -
DIR=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)
docker compose stop app
docker compose exec -T db dropdb -U pai --if-exists pai_restore_old || true
docker compose exec -T db psql -U pai -d postgres -c "ALTER DATABASE pai RENAME TO pai_restore_old;"
docker compose exec -T db createdb -U pai pai
docker compose exec -T db pg_restore -U pai -d pai --no-owner < "$DIR/db.dump"
docker compose run --rm --no-deps --entrypoint sh app -c "rm -rf /data/files /data/exports && tar -C /data -xf -" < "$DIR/data.tar"
docker compose start app
echo "Восстановление завершено. Прежняя БД сохранена как pai_restore_old (удалите после проверки)."
