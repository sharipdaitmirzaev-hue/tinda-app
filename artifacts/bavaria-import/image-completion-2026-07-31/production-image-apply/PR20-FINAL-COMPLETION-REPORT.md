# PR #20 final completion report

**Date:** 2026-07-31  
**PR:** https://github.com/sharipdaitmirzaev-hue/tinda-app/pull/20  
**Status:** MERGED + DEPLOYED

---

## Merge

| Field | Value |
|-------|-------|
| PR state | **MERGED** |
| Merge commit (`main`) | `18738f064ce48e83c077d639a4d076588db52683` |
| Merged at | `2026-07-31T14:41:19Z` |
| CI before merge | **quality pass**, **e2e pass** |
| Production report in PR | `PRODUCTION-IMAGE-APPLY-REPORT.md` @ `38b24bf` |
| Prisma migrations in PR | **none** (migrate not run) |

---

## Deploy (VPS)

| Field | Value |
|-------|-------|
| Host | `134.0.116.84` / `tindamarket.ru` |
| App path | `/opt/tinda/app` |
| Branch kept | **`cursor/domain-tindamarket-f733`** |
| Deployed commit | `ba2154a5bc1a4f585b7eb0bce837550feffa71fe` |
| Deploy method | `git merge origin/main` into domain branch → `docker compose build app` → `up -d app` |
| Domain / `.env` | preserved (`APP_URL` / `SITE_URL` → tindamarket.ru) |
| Main Bavaria apply | **not re-run** |
| Image-only apply | **not re-run** |
| DB migrations | **not run** |
| DB data changes | **none** |

### Compose (after deploy)

| Service | Image | Status |
|---------|-------|--------|
| `app-app-1` | `app-app` | **Up (healthy)** |
| `app-db-1` | `postgres:16-alpine` | **Up (healthy)** |

---

## Smoke checks (post-deploy)

| Check | Result |
|-------|--------|
| App healthy | **yes** |
| DB healthy | **yes** |
| `https://tindamarket.ru/` | **HTTP 200** |
| `/api/v1/health` | `{"ok":true,"database":"ok"}` |
| DB catalog total | **623** |
| Public catalog total | **621** |
| Bavaria (`q=BAVARIA`) | **164** |
| `non-alcoholic-beer` | **14** |
| Bavaria without image | **2** |
| Remaining without image | `BAVARIA-COLALE-COLA-LE-450-GLASS`, `BAVARIA-BAVARIYA-NORDISCH-NA-450-CAN` |
| New images HTTP 200 `image/webp` | **56 / 56** |
| Manual SKUs in DB | **0** |

---

## Backups (retained)

| File | SHA-256 |
|------|---------|
| `/opt/tinda/app/backups/tinda-prod-bavaria-20260731-124107.sql` | `fc7227bf3cb42deae7d60333ec50e5cb11fb4ab8ddb44dbb02f38bbcb0d9594f` |
| `/opt/tinda/app/backups/tinda-prod-bavaria-images-20260731-143119.sql` | `48b3ac268452697f81e65efe22ce187f48c7eed958c94937df77d2958823d52e` |

---

## Confirmation

- Production image-only apply was **not** executed again during merge/deploy.
- Main Bavaria import apply was **not** executed again.
- Database schema/data were **not** modified during deploy.
- Only code/image rebuild of the app container was performed on the domain branch.
