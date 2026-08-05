#!/usr/bin/env bash
# Cloud Agent start phase for tinda-app.
# Per-boot reconciliation: make sure PostgreSQL is running and the dev .env
# exists after a fresh checkout. Returns once the database is ready.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Start PostgreSQL if it is not already running (idempotent).
sudo pg_ctlcluster 16 main start 2>/dev/null || true

# Recreate the dev .env if a fresh checkout removed it.
bash .cursor/write-dev-env.sh

# Wait for the database to accept connections before returning.
for _ in $(seq 1 30); do
  if pg_isready -h localhost -p 5432 -U tinda >/dev/null 2>&1; then
    echo "PostgreSQL is ready."
    exit 0
  fi
  sleep 1
done

echo "PostgreSQL did not become ready in time." >&2
exit 1
