#!/usr/bin/env bash
# Cloud Agent install phase for tinda-app.
# Idempotent, non-interactive setup of a full local dev environment:
# PostgreSQL 16 + local dev .env + Node dependencies + Prisma migrations + seed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 1. System dependency: PostgreSQL 16 (Ubuntu 24.04 default) + openssl for Prisma.
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    postgresql postgresql-contrib openssl ca-certificates
fi

# 2. Start the cluster (idempotent: succeeds whether or not it is already up).
sudo pg_ctlcluster 16 main start 2>/dev/null || true

# 3. Ensure the application role and databases exist.
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='tinda'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE tinda LOGIN PASSWORD 'tinda';"
fi
for db in tinda tinda_e2e; do
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    sudo -u postgres createdb -O tinda "$db"
  fi
done

# 4. Local development .env (dev-only, non-secret values). Never used in production.
bash .cursor/write-dev-env.sh

# 5. Node dependencies (postinstall runs `prisma generate`).
npm ci

# 6. Apply migrations and seed the development database.
npm run db:deploy
npm run db:seed

echo "tinda-app install phase complete."
