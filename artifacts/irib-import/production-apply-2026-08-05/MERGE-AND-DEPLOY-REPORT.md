# IRIB PR #27 — merge & deploy completion

**When (UTC):** 2026-08-05T14:36–14:39

## 1. Production artifacts committed

Present on branch `cursor/import-irib-e6e4` and included in the merge to `main`:

| Artifact | Path / commit |
|----------|----------------|
| Production apply report | `artifacts/irib-import/production-apply-2026-08-05/PRODUCTION-APPLY-REPORT.md` (`384e075`) |
| Apply gate fix | `d17f096` — probable `new_product` audit rows allowed in create apply |
| Final runbook | `artifacts/irib-import/2026-08-05T14-12-48-411Z-final/VPS-PRODUCTION-RUNBOOK.md` |
| Final create manifest | `artifacts/irib-import/2026-08-05T14-12-48-411Z-final/approved-import-manifest-final.json` |

No DB migrations in PR.

## 2. CI

PR #27 CI run `31015487279`:

| Job | Result |
|-----|--------|
| quality (lint / typecheck / tests / build) | ✅ SUCCESS |
| e2e | ✅ SUCCESS |

## 3. Merge

| | |
|--|--|
| PR | https://github.com/sharipdaitmirzaev-hue/tinda-app/pull/27 |
| State | **MERGED** |
| Merge commit | `d1021f5222786c0240bed3028ba158bf4252c636` |
| Merged at | 2026-08-05T14:36:20Z |
| Message | `Merge pull request #27 from sharipdaitmirzaev-hue/cursor/import-irib-e6e4` |

## 4. VPS deploy

| | |
|--|--|
| App path | `/opt/tinda/app` |
| Deploy branch | `cursor/domain-tindamarket-f733` |
| Action | `git fetch origin main` + `git merge origin/main` + rebuild **app only** |
| Deployed commit | `4ac8bb1a750f4fe9eae3132ca550a65a40e7d9e1` |
| Deployed tip | `4ac8bb1 Merge remote-tracking branch 'origin/main' into cursor/domain-tindamarket-f733` |
| Contains merge `d1021f5` | **yes** |
| `.env` preserved | yes (`APP_URL` / `SITE_URL` / `NEXT_PUBLIC_APP_URL` = `https://tindamarket.ru`) |
| `RUN_MIGRATIONS_ON_START` | **false** |
| DB migrations run | **no** |
| IRIB / AquAlania / Daryal / Bavaria apply re-run | **no** |
| Image-update manifest applied | **no** |
| Backup kept | `/opt/tinda/app/backups/tinda-prod-irib-20260805-142608.sql`  
SHA-256 `a3add0037eec1292477ba277068cff75163954d6167b9e61145965bacc892203` |

## 5. Compose state (after deploy)

```
NAME        IMAGE                STATUS
app-app-1   app-app              Up (healthy)   0.0.0.0:3000->3000/tcp
app-db-1    postgres:16-alpine   Up (healthy)   5432/tcp
```

## 6. Smoke-check

| Check | Result |
|-------|--------|
| app healthy | ✅ |
| db healthy | ✅ |
| https://tindamarket.ru/ | follow redirects → **200** |
| `/api/v1/health` | **200** `{"ok":true,"database":"ok"}` |
| catalog total | **708** |
| IRIB new | **38** (all showcase, null price, on_order, active) |
| ZY-IRIB | **11** |
| AquAlania | **25** |
| Daryal | **22** |
| Bavaria | **164** |
| IRIB images | **38/38** HTTP 200 `image/webp` |
| product fingerprint (all 708) | **unchanged** vs pre-deploy snapshot |
| image-update candidates | still **not** applied (9) |
| DB writes during deploy | **none** |

## 7. Confirmed not re-run

- `npm run import:irib:apply` — not run during merge/deploy
- image-update manifest — not applied
- `npm run import:aqualania:apply` — not run
- `npm run import:daryal:apply` — not run
- `npm run import:bavaria:apply` — not run
- DB migrations — not run (`RUN_MIGRATIONS_ON_START=false`, no migrations in PR)
