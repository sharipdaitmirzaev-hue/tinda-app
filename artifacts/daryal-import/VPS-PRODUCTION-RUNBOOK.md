# VPS Production Runbook — Daryal import (PR #25)

**Execute only after explicit operator confirmation** (received for PR #25).

| | |
|--|--|
| PR | https://github.com/sharipdaitmirzaev-hue/tinda-app/pull/25 |
| Branch | `cursor/daryal-stage2-verify-e6e4` |
| Manifest | `artifacts/daryal-import/latest-stage2/approved-import-manifest.json` |
| Approved SKUs | **22** (manual/rejected **не** импортировать) |
| Working directory | `/opt/tinda/app` (or dedicated worktree) |

## Expected buckets

| Bucket | Count |
|--------|------:|
| approved | **22** |
| manual (Фрутимикс) | **2** |
| rejected | **4** |
| images | **22** |
| production collisions | **0** |

## Categories (existing only — never create)

| Products | Category | Slug | Production ID |
|----------|----------|------|---------------|
| 16 soda «Дарьял» | Газированные напитки | `gazirovannye-napitki` | `a98cf12f-e064-4b67-93ef-0a9fdb47bb71` |
| 6 «Аква Дарьял» | Минеральная вода | `voda-mineralnaya` | `58ba9d27-1100-49af-9644-9bbfe6ea00a2` |

If either category is missing → apply stops with `required_categories_missing`.

## Backup → apply → idempotent re-apply

```bash
export APP_DIR=/opt/tinda/app
export WORKTREE=/opt/tinda/daryal-pr25-worktree
cd "$WORKTREE"  # or APP_DIR after checkout

git fetch origin cursor/daryal-stage2-verify-e6e4
git checkout cursor/daryal-stage2-verify-e6e4
git pull --ff-only origin cursor/daryal-stage2-verify-e6e4
npm ci && npx prisma generate

set -a && source "$APP_DIR/.env" && set +a
test -n "${DATABASE_URL:-}" && echo "DATABASE_URL=SET (len=${#DATABASE_URL})" || exit 2

mkdir -p "$APP_DIR/backups"
STAMP=$(date -u +%Y%m%d-%H%M%S)
export BACKUP_PATH="$APP_DIR/backups/tinda-prod-daryal-${STAMP}.sql"
PGURL=$(python3 - <<'PY'
import os
from urllib.parse import urlparse, urlunparse
u = urlparse(os.environ["DATABASE_URL"])
print(urlunparse((u.scheme, u.netloc, u.path, "", "", "")))
PY
)
pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP_PATH"
test -s "$BACKUP_PATH"
head -n 3 "$BACKUP_PATH" | grep -Eiq 'PostgreSQL|pg_dump|--' || exit 2
sha256sum "$BACKUP_PATH" | tee "${BACKUP_PATH}.sha256"

MANIFEST="artifacts/daryal-import/latest-stage2/approved-import-manifest.json"

# Recommended: run as uid 1001 with uploads volume mounted
docker run --rm --user 1001:1001 \
  --network app_default \
  --env-file "$APP_DIR/.env" \
  -v "$WORKTREE:/workspace" \
  -v "$APP_DIR/backups:/backups:ro" \
  -v app_tinda_uploads:/workspace/public/uploads \
  -w /workspace \
  node:20-bookworm \
  bash -lc 'npm ci && npx prisma generate && npm run import:daryal:apply -- \
    --i-understand-and-have-backup \
    --backup-path=/backups/'"$(basename "$BACKUP_PATH")"' \
    --manifest='"$MANIFEST"

# Idempotent re-apply (same backup or new)
npm run import:daryal:apply -- \
  --i-understand-and-have-backup \
  --backup-path="$BACKUP_PATH" \
  --manifest="$MANIFEST"
```

## Post-check

- created=22, skipped=0, errors=0 (first run)
- second run: created=0, skipped=22, errors=0
- existing_edited=false
- DARYAL- SKUs = 22
- 16 soda / 6 water
- all showcase, price null, orderable=false
- images 22/22 HTTP 200 image/webp
- health `{"ok":true,"database":"ok"}`
- no Frutimix / ФИЕСТА / Грейпфрут / beer SKUs

## Forbidden

- `--merge`
- creating categories
- importing manual/rejected
- editing existing products / Bavaria / orders / clients
