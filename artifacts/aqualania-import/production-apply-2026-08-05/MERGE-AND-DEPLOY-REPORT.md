# AquAlania PR #26 — merge & deploy completion

**When (UTC):** 2026-08-05T13:18–13:22

## 1. Production report committed

`artifacts/aqualania-import/production-apply-2026-08-05/PRODUCTION-APPLY-REPORT.md`  
Present on branch `cursor/import-aqualania-e6e4` (commit `43c77f1`) and included in the merge to `main`.

## 2. CI

PR #26 CI run `31009168412`:

| Job | Result |
|-----|--------|
| quality | ✅ SUCCESS |
| e2e | ✅ SUCCESS |

## 3. Merge

| | |
|--|--|
| PR | https://github.com/sharipdaitmirzaev-hue/tinda-app/pull/26 |
| State | **MERGED** |
| Merge commit | `a1148dde0f5dbf74d3a2c1d1b7b1f19a30ea2d49` |
| Merged at | 2026-08-05T13:18:15Z |
| Message | `Merge pull request #26 from sharipdaitmirzaev-hue/cursor/import-aqualania-e6e4` |

No DB migrations in PR.

## 4. VPS deploy

| | |
|--|--|
| App path | `/opt/tinda/app` |
| Deploy branch | `cursor/domain-tindamarket-f733` |
| Action | `git fetch origin main` + `git merge origin/main` + rebuild **app only** |
| Deployed commit | `593e447ca975e814e92202265b6aeef52dc3e355` |
| Deployed tip | `593e447 Merge remote-tracking branch 'origin/main' into cursor/domain-tindamarket-f733` |
| Contains merge `a1148dd` | **yes** |
| `.env` preserved | yes (`APP_URL` / `SITE_URL` / `NEXT_PUBLIC_APP_URL` = `https://tindamarket.ru`) |
| `RUN_MIGRATIONS_ON_START` | **false** |
| DB migrations run | **no** |
| AquAlania/Daryal/Bavaria apply re-run | **no** |
| Backup kept | `/opt/tinda/app/backups/tinda-prod-aqualania-20260805-131023.sql`  
SHA-256 `7b7043bedf0cba75ee064f0243c979a78b988b8f0372c098e2e70f2183b20861` |

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
| https://tindamarket.ru/ | 307 → `/catalog` → **200** (follow redirects) |
| `/api/v1/health` | **200** `{"ok":true,"database":"ok"}` |
| catalog total | **670** |
| AquAlania | **25** (all showcase, null price, on_order, active) |
| Daryal | **22** |
| Bavaria | **164** |
| AquAlania images | **25/25** HTTP 200 `image/webp` |
| product fingerprint (all 670) | **unchanged** vs pre-deploy snapshot |
| DB writes during deploy | **none** |

## 7. Confirmed not re-run

- `npm run import:aqualania:apply` — not run during merge/deploy
- `npm run import:daryal:apply` — not run
- `npm run import:bavaria:apply` — not run
- DB migrations — not run (`RUN_MIGRATIONS_ON_START=false`, no migrations in PR)
