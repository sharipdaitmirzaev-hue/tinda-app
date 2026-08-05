# VPS Production Runbook — IRIB (draft)

**Do not run until operator explicitly confirms production apply.**

| | |
|--|--|
| Manifest | `artifacts/irib-import/2026-08-05T13-53-00-881Z-stage1/approved-import-manifest.json` |
| Approved SKUs | **26** |

```bash
STAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP=/opt/tinda/app/backups/tinda-prod-irib-$STAMP.sql
pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP"
sha256sum "$BACKUP" | tee "$BACKUP.sha256"

npm run import:irib:apply -- \
  --i-understand-and-have-backup \
  --backup-path="$BACKUP" \
  --manifest="artifacts/irib-import/2026-08-05T13-53-00-881Z-stage1/approved-import-manifest.json"
```

Forbidden: `--merge`, editing existing products, auto-creating categories, importing manual/rejected.
