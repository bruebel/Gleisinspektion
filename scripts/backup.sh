#!/usr/bin/env bash
# Tägliche Sicherung von Datenbank und Fotos. Einrichtung per cron, z. B.:
#   15 2 * * *  /opt/gleisinspektion/scripts/backup.sh >> /var/log/gleisinspektion-backup.log 2>&1
set -euo pipefail

ZIEL="${BACKUP_ZIEL:-/var/backups/gleisinspektion}"
TAGE="${BACKUP_TAGE:-14}"
STEMPEL="$(date +%Y-%m-%d_%H%M)"
COMPOSE="docker compose -f $(dirname "$0")/../deploy/app/docker-compose.yml"

mkdir -p "$ZIEL"
$COMPOSE exec -T db pg_dump -U gleisinspektion -Fc gleisinspektion > "$ZIEL/datenbank_$STEMPEL.dump"
docker run --rm -v gleisinspektion_fotos:/fotos:ro -v "$ZIEL":/ziel alpine \
  tar czf "/ziel/fotos_$STEMPEL.tar.gz" -C /fotos .

find "$ZIEL" -type f -mtime +"$TAGE" -delete
echo "$(date -Is) Sicherung abgeschlossen: $ZIEL"
