#!/usr/bin/env bash
# BAJOGO ERP — nightly database backup. Keeps 14 days.
# Add to the bajogo user's crontab (sudo -u bajogo crontab -e):
#   30 2 * * * /srv/bajogo-erp/deploy/backup.sh >> /srv/bajogo-erp/backups/backup.log 2>&1
# Also copy the backups folder off this server (another disk, or cloud storage).
set -euo pipefail

cd /srv/bajogo-erp
mkdir -p backups
set -a; . ./.env; set +a

PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -Fc "$DB_NAME" \
  > "backups/bajogo_erp_$(date +%Y%m%d_%H%M%S).dump"

find backups -name 'bajogo_erp_*.dump' -mtime +14 -delete
echo "$(date -Is) backup ok"
