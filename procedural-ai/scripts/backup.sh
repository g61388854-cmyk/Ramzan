#!/bin/sh
# Резервное копирование PROCEDURAL AI: дамп PostgreSQL + архив зашифрованного
# файлового хранилища. Результат дополнительно шифруется (AES-256, OpenSSL)
# ключом резервного копирования, хранящимся отдельно от копий.
#
# Использование (из каталога deploy):
#   PAI_BACKUP_PASSPHRASE_FILE=/secure/backup.pass ../scripts/backup.sh
set -eu
cd "$(dirname "$0")/../deploy"
: "${PAI_BACKUP_PASSPHRASE_FILE:?укажите файл с парольной фразой резервного копирования}"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="backups/pai-$STAMP"
mkdir -p "$OUT"
umask 077
docker compose exec -T db pg_dump -U pai -d pai --format=custom > "$OUT/db.dump"
docker compose exec -T app tar -C /data -cf - files exports storage.key 2>/dev/null > "$OUT/data.tar" || \
  docker compose exec -T app tar -C /data -cf - files exports > "$OUT/data.tar"
tar -C backups -cf - "pai-$STAMP" | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -pass "file:$PAI_BACKUP_PASSPHRASE_FILE" -out "backups/pai-$STAMP.tar.enc"
sha256sum "backups/pai-$STAMP.tar.enc" > "backups/pai-$STAMP.tar.enc.sha256"
rm -rf "$OUT"
echo "Резервная копия: deploy/backups/pai-$STAMP.tar.enc"
