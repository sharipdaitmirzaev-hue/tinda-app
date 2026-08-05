# Импорт производителя AquAlania

Источник: только https://aqualania.ru/product (+ /enproduct).  
Производитель: ООО «Константа-7».

## Stage 1
```bash
npm run import:aqualania:stage1
```
Latest stage1: `latest-stage1/`

## Final (stage 2)
```bash
python3 scripts/aqualania-stage2-final.py
# or
npm run import:aqualania:final
```
Latest final: `latest-final/` → `2026-08-05T13-05-07-740Z-final`

Manifest: `artifacts/aqualania-import/2026-08-05T13-05-07-740Z-final/approved-import-manifest-final.json`

Apply (gated; not run until confirmed):
```bash
npm run import:aqualania:apply -- \
  --i-understand-and-have-backup \
  --backup-path="<path>" \
  --manifest="artifacts/aqualania-import/2026-08-05T13-05-07-740Z-final/approved-import-manifest-final.json"
```

## Production apply (2026-08-05)

See `production-apply-2026-08-05/PRODUCTION-APPLY-REPORT.md`.
Created 25 / skipped 0 / errors 0; idempotent second apply skipped 25.
