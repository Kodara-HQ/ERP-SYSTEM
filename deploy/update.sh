#!/usr/bin/env bash
# BAJOGO ERP — install or update on the server.
# Run as the bajogo user from /srv/bajogo-erp:
#   sudo -u bajogo bash deploy/update.sh
set -euo pipefail

cd /srv/bajogo-erp

if [ ! -f .env ]; then
  echo "Missing /srv/bajogo-erp/.env. Copy deploy/env.production.example and fill it in." >&2
  exit 1
fi

echo "Fetching the latest code..."
git pull --ff-only

echo "Installing packages..."
npm ci

echo "Building..."
npm run build

echo "Backing up the database before migrating..."
mkdir -p backups
set -a; . ./.env; set +a
PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -Fc "$DB_NAME" \
  > "backups/bajogo_erp_$(date +%Y%m%d_%H%M%S).dump"

echo "Applying migrations..."
(cd backend && node dist/database/migrate.js)

echo "Restarting the API..."
sudo systemctl restart bajogo-erp-api

echo "Done."
