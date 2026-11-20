#!/usr/bin/env sh
set -eu
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
docker compose exec -T db pg_dump -U allegra_app -d allegra -Fc > "backups/allegra-${STAMP}.dump"
echo "Backup criado em backups/allegra-${STAMP}.dump"
