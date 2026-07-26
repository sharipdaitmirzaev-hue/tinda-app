#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS_ON_START:-false}" = "true" ]; then
  echo "Applying migrations..."
  npx prisma migrate deploy
fi

exec "$@"
