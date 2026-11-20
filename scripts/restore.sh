#!/usr/bin/env sh
set -eu
if [ -z "${1:-}" ]; then echo "Uso: ./scripts/restore.sh backups/arquivo.dump"; exit 1; fi
echo "ATENÇÃO: a restauração substitui os dados atuais do banco."
docker compose exec -T db pg_restore -U allegra_app -d allegra --clean --if-exists < "$1"
