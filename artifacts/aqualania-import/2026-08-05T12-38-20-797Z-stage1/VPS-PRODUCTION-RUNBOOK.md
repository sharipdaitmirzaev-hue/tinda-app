# VPS Production Runbook — AquAlania (draft)

**Do not run until operator explicitly confirms production apply.**

| | |
|--|--|
| Manifest | `artifacts/aqualania-import/2026-08-05T12-38-20-797Z-stage1/approved-import-manifest.json` |
| Approved SKUs | **25** |
| Working directory | `/opt/tinda/app` or dedicated worktree |

```bash
# backup
STAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP=/opt/tinda/app/backups/tinda-prod-aqualania-$STAMP.sql
pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP"
sha256sum "$BACKUP" | tee "$BACKUP.sha256"

npm run import:aqualania:apply -- \
  --i-understand-and-have-backup \
  --backup-path="$BACKUP" \
  --manifest="artifacts/aqualania-import/2026-08-05T12-38-20-797Z-stage1/approved-import-manifest.json"
```

Forbidden: `--merge`, editing existing products, auto-creating categories, importing manual/rejected.
