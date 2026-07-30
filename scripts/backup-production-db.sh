#!/usr/bin/env bash
# Backup production PostgreSQL for TINDA (run on VPS as root).
# Does not modify application data; creates a timestamped dump only.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tinda/app}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/tinda}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_ROOT}/catalog-normalize-${STAMP}"

mkdir -p "${OUT_DIR}"
cd "${APP_DIR}"

echo "Creating backup in ${OUT_DIR}"
docker compose -f docker-compose.production.yml exec -T db \
  pg_dump -U tinda -d tinda --format=custom --file=/tmp/tinda.dump

docker compose -f docker-compose.production.yml cp \
  db:/tmp/tinda.dump "${OUT_DIR}/tinda.dump"

docker compose -f docker-compose.production.yml exec -T db \
  psql -U tinda -d tinda -c "COPY (
    SELECT id, sku, name, brand, volume_text, package_type, units_per_package,
           availability, sales_status, is_active, price_amount::text, image_url
    FROM products ORDER BY sku
  ) TO STDOUT WITH CSV HEADER" > "${OUT_DIR}/products-before.csv"

sha256sum "${OUT_DIR}/tinda.dump" > "${OUT_DIR}/tinda.dump.sha256"
ls -lah "${OUT_DIR}"
echo "Backup OK: ${OUT_DIR}"
