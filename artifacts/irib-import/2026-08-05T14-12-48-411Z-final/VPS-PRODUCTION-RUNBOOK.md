# VPS Production Runbook — IRIB final (create-only)

**Do not run until operator explicitly confirms production apply.**

| | |
|--|--|
| Create manifest | `artifacts/irib-import/2026-08-05T14-12-48-411Z-final/approved-import-manifest-final.json` |
| Approved NEW SKUs | **38** |
| Image-update manifest | `artifacts/irib-import/2026-08-05T14-12-48-411Z-final/image-update-manifest-separate.json` (**do not apply with create**) |

```bash
STAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP=/opt/tinda/app/backups/tinda-prod-irib-$STAMP.sql
pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP"
sha256sum "$BACKUP" | tee "$BACKUP.sha256"

npm run import:irib:apply -- \
  --i-understand-and-have-backup \
  --backup-path="$BACKUP" \
  --manifest="artifacts/irib-import/2026-08-05T14-12-48-411Z-final/approved-import-manifest-final.json"
```

Forbidden: `--merge`, editing existing products, applying image-update manifest via create apply, importing manual/duplicate/conflict rows.
