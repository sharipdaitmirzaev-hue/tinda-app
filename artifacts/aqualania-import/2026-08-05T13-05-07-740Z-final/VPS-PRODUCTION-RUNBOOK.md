# VPS Production Runbook — AquAlania FINAL

**Do not run until operator explicitly confirms production apply.**

| | |
|--|--|
| Manifest | `artifacts/aqualania-import/2026-08-05T13-05-07-740Z-final/approved-import-manifest-final.json` |
| Approved CSV | `artifacts/aqualania-import/2026-08-05T13-05-07-740Z-final/approved-products-final.csv` |
| Approved SKUs | **25** |
| Create-only | yes |
| Auto-create categories | no |

```bash
STAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP=/opt/tinda/app/backups/tinda-prod-aqualania-$STAMP.sql
pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP"
sha256sum "$BACKUP" | tee "$BACKUP.sha256"

# optional: copy worktree / pull branch cursor/import-aqualania-e6e4

npm run import:aqualania:apply -- \
  --i-understand-and-have-backup \
  --backup-path="$BACKUP" \
  --manifest="artifacts/aqualania-import/2026-08-05T13-05-07-740Z-final/approved-import-manifest-final.json"
```

Expected first apply: created=25, skipped=0, existing_products_edited=false.  
Expected second apply (idempotent): created=0, skipped=25.

Forbidden: `--merge`, editing existing products, importing manual/rejected, auto-creating categories.
