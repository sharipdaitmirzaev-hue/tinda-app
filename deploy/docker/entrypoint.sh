#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS_ON_START:-false}" = "true" ]; then
  echo "Applying migrations..."
  if [ -x ./node_modules/.bin/prisma ]; then
    ./node_modules/.bin/prisma migrate deploy
  else
    node ./node_modules/prisma/build/index.js migrate deploy
  fi
fi

exec "$@"
