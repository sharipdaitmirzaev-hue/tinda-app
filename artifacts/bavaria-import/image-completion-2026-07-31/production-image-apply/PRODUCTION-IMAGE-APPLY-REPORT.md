# Production image-only apply report — Bavaria (PR #20)

**Status: SUCCESS**  
Host: `134.0.116.84` (`tindamarket.ru`)  
Operator confirmation: explicit image-only apply approval in chat  
Code: `/opt/tinda/bavaria-pr20-worktree` @ `83d77b8` (`cursor/bavaria-missing-images-ad60`)  
Script: `scripts/bavaria-image-only-apply.ts`  
Manifest: `artifacts/bavaria-import/image-completion-2026-07-31/image-update-manifest.json`

**Main Bavaria product import was NOT run.**  
Categories, prices, active, orderable, names, SKUs were not modified.

---

## Pre-flight guards

| Check | Result |
|-------|--------|
| PR #20 CI (`quality`, `e2e`) | **pass** |
| Manifest `item_count` | **56** |
| `fields_to_change` | **`["image_url"]` only** for all 56 |
| Excluded SKUs in manifest | **none** (`COLA-LE-450-GLASS`, `NORDISCH-NA-450-CAN`) |
| Manual SKUs in manifest | **none** (5 keep_manual) |
| Processed webp files present | **56 / 56** |

---

## Backups (kept)

| Backup | Path | Size | SHA-256 |
|--------|------|-----:|---------|
| Previous Bavaria create (PR #18) | `/opt/tinda/app/backups/tinda-prod-bavaria-20260731-124107.sql` | 228 867 | `fc7227bf3cb42deae7d60333ec50e5cb11fb4ab8ddb44dbb02f38bbcb0d9594f` |
| **New image-only (this run)** | `/opt/tinda/app/backups/tinda-prod-bavaria-images-20260731-143119.sql` | 363 745 | `48b3ac268452697f81e65efe22ce187f48c7eed958c94937df77d2958823d52e` |

Both backups remain on disk (not deleted).

---

## Pre-apply counts

| Metric | Value |
|--------|------:|
| DB products total | **623** |
| Bavaria SKUs | **164** |
| Bavaria with image | **106** |
| Bavaria without image | **58** |
| Manifest SKUs without image | **56** |
| NA beer category | **14** |
| Public catalog total | **621** |
| Public `q=BAVARIA` | **164** |
| Manual leak | **0** |
| Excluded SKUs image | **NULL / NULL** |
| App / DB | healthy / healthy |

---

## Apply #1 (image-only)

| Field | Value |
|-------|-------|
| Artifact | `production-image-apply/apply-1/apply-result.json` |
| VPS artifact | `2026-07-31T14-33-22-928Z-image-only-apply` |
| Started / finished | `2026-07-31T14:33:22.929Z` → `2026-07-31T14:33:27.867Z` |
| **Updated** | **56** |
| **Skipped** | **0** |
| **Errors** | **0** |
| Field changes per SKU | **`image_url` only** (56/56) |

Ops after upload:

```bash
chown -R 1001:1001 /var/lib/docker/volumes/app_tinda_uploads/_data
cd /opt/tinda/app && docker compose -f docker-compose.production.yml restart app
```

---

## Apply #2 (idempotency)

| Field | Value |
|-------|-------|
| Artifact | `production-image-apply/apply-2/apply-result.json` |
| VPS artifact | `2026-07-31T14-34-36-565Z-image-only-apply` |
| **Updated** | **0** |
| **Skipped** | **56** (`image_url_already_set`) |
| **Errors** | **0** |

**Verdict: image-only apply is idempotent.**

---

## Post-apply verification

| Check | Result |
|-------|--------|
| Updated | **56** |
| Skipped / errors (apply #1) | **0 / 0** |
| Bavaria without image | **2** |
| Remaining without image | `BAVARIA-COLALE-COLA-LE-450-GLASS`, `BAVARIA-BAVARIYA-NORDISCH-NA-450-CAN` |
| Field changes | only `image_url` for all 56 |
| Catalog DB total | **623** |
| Public catalog total | **621** |
| Public `q=BAVARIA` | **164** |
| NA beer (`category_id=8e8d04e4-…`) | **14** |
| Excluded SKUs still without image | **yes** |
| Manual SKUs in catalog | **0** |
| New image URLs HTTP | **56 / 56 → 200** |
| MIME / magic | **image/webp** + RIFF/WEBP |
| App / DB healthy | **yes** |
| `tindamarket.ru` | **200** (home), health **200** |

---

## What was not done

- Full Bavaria product import (`import:bavaria:apply`) — not run  
- No category / price / active / orderable / name / SKU changes  
- Excluded CLASSIC Cola LE glass and Nordisch NA can — not imaged  
- Manual positions — not imported  

---

## Artifacts in this folder

| File | Purpose |
|------|---------|
| `apply-1/apply-result.json` | First image-only apply (56 updated) |
| `apply-2/apply-result.json` | Idempotent re-apply (0/56) |
| `bavaria-image-apply-console.log` | VPS console (last run) |
| `PRODUCTION-IMAGE-APPLY-REPORT.md` | This report |
