# Production apply blocked — Daryal (PR #25)

**Status: BLOCKED — missing production credentials**  
Operator confirmation: **received** (explicit apply approval in chat)  
Code ready: `cursor/daryal-stage2-verify-e6e4` @ gated `npm run import:daryal:apply`

## Preflight completed (no DB write)

| Check | Result |
|-------|--------|
| Manifest approved SKUs | **22** unique |
| Approved CSV rows | **22** |
| Images present + RIFF/WEBP | **22 / 22** |
| Manual excluded | Фрутимикс Мультифрукт, Фрутимикс Красный апельсин |
| Rejected excluded | Грейпфрут-малина, Живое пиво, ФИЕСТА, Сокосодержащие |
| Live exact SKU collisions | **0** |
| Live Daryal brand hits | **0** |
| Category `gazirovannye-napitki` | exists (`a98cf12f-e064-4b67-93ef-0a9fdb47bb71`) |
| Category `voda-mineralnaya` | exists (`58ba9d27-1100-49af-9644-9bbfe6ea00a2`) |
| Public catalog total | **621** |
| Health | `{"ok":true,"database":"ok"}` |
| Expected distribution | 16 soda + 6 mineral water |

## Blocker

Cloud agent cannot reach VPS:

- `ssh root@134.0.116.84` / `tinda@…` / `ubuntu@…` → **Permission denied (publickey)**
- `DATABASE_URL` **not set** in this environment
- Cannot create `/opt/tinda/app/backups/tinda-prod-daryal-*.sql`
- Cannot mount `app_tinda_uploads` for local image upload

Secrets requested via environment setup:

- `SSH_PRIVATE_KEY` (required)
- `SSH_HOST` / `SSH_USER` (optional; default `134.0.116.84`)
- `DATABASE_URL` (required for apply container)

## Ready when credentials arrive

1. Backup → validate size/SQL/SHA-256  
2. `npm run import:daryal:apply -- --i-understand-and-have-backup --backup-path=… --manifest=artifacts/daryal-import/latest-stage2/approved-import-manifest.json`  
3. Post-check + idempotent re-apply  
4. Write `PRODUCTION-APPLY-REPORT.md` and update PR #25  

See `artifacts/daryal-import/VPS-PRODUCTION-RUNBOOK.md`.

## Not done (correctly)

- No production DB writes
- No existing product edits
- No category creates
- No merge
- Manual/rejected not imported
