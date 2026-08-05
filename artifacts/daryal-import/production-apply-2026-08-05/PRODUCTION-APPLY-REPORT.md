# Production apply report — Дарьял (PR #25)

**Status: SUCCESS**  
Host: `134.0.116.84` (`tindamarket.ru`)  
Operator confirmation: explicit apply approval in chat  
Code: `/opt/tinda/daryal-pr25-worktree` @ `db4670c` (`cursor/daryal-stage2-verify-e6e4`)  
Manifest: `artifacts/daryal-import/latest-stage2/approved-import-manifest.json`

---

## Backup (pre-apply)

| Field | Value |
|-------|-------|
| Path | `/opt/tinda/app/backups/tinda-prod-daryal-20260805-120724.sql` |
| Size | 369 005 bytes |
| SHA-256 | `3f8cf723d7868f429be08d5b442da46c04c36aae66c38ce673baa710115b02e9` |
| Format | PostgreSQL plain SQL (`pg_dump --no-owner`) |
| Separate from Bavaria | **yes** (Bavaria dumps retained unchanged) |

Bavaria backups still present:

- `tinda-prod-bavaria-20260731-124107.sql`
- `tinda-prod-bavaria-images-20260731-143119.sql`

---

## Preflight

| Check | Result |
|-------|--------|
| Approved SKUs | **22** unique |
| Images WebP | **22 / 22** |
| Manual not in manifest | Фрутимикс ×2 |
| Rejected not in manifest | Грейпфрут / пиво / ФИЕСТА / сокосодержащие |
| Live SKU collisions before | **0** |
| Category `gazirovannye-napitki` | `a98cf12f-e064-4b67-93ef-0a9fdb47bb71` |
| Category `voda-mineralnaya` | `58ba9d27-1100-49af-9644-9bbfe6ea00a2` |
| Categories created | **none** |
| Public catalog before | **621** |
| DB products before | **623** |

---

## Apply #1 (create-only)

| Field | Value |
|-------|-------|
| Artifact | `production-apply-2026-08-05/apply-1/` (VPS: `2026-08-05T12-08-12-917Z-apply`) |
| Started / finished | `2026-08-05T12:08:12.917Z` → apply container done `12:08:15Z` |
| **Created** | **22** |
| **Skipped** | **0** |
| **Errors** | **0** |
| Images uploaded | **22** |
| Images missing | **0** |
| Existing products edited | **false** |
| Fingerprint mismatches | **[]** |
| Catalog DB after | **645** |
| DARYAL- SKUs | **22** |

### Category distribution (created)

| Category | Count |
|----------|------:|
| Газированные напитки | 16 |
| Минеральная вода | 6 |
| **Total** | **22** |

### Created SKUs

- `DARYAL-AKVA-DARYAL-GAZ-1500-PET`
- `DARYAL-AKVA-DARYAL-GAZ-500-GLASS`
- `DARYAL-AKVA-DARYAL-GAZ-500-PET`
- `DARYAL-AKVA-DARYAL-STILL-1500-PET`
- `DARYAL-AKVA-DARYAL-STILL-500-GLASS`
- `DARYAL-AKVA-DARYAL-STILL-500-PET`
- `DARYAL-DARYAL-APELSIN-1500-PET`
- `DARYAL-DARYAL-APELSIN-500-PET`
- `DARYAL-DARYAL-APELSIN-KORIANDR-500-GLASS`
- `DARYAL-DARYAL-FEYHOA-SHELKOVITSA-500-GLASS`
- `DARYAL-DARYAL-GRANAT-500-GLASS`
- `DARYAL-DARYAL-GRUSHA-1500-PET`
- `DARYAL-DARYAL-GRUSHA-500-GLASS`
- `DARYAL-DARYAL-GRUSHA-500-PET`
- `DARYAL-DARYAL-KOLA-APELSIN-1500-PET`
- `DARYAL-DARYAL-KOLA-APELSIN-500-GLASS`
- `DARYAL-DARYAL-KOLA-APELSIN-500-PET`
- `DARYAL-DARYAL-MOHITO-500-GLASS`
- `DARYAL-DARYAL-MOHITO-500-PET`
- `DARYAL-DARYAL-TARHUN-1500-PET`
- `DARYAL-DARYAL-TARHUN-500-GLASS`
- `DARYAL-DARYAL-TARHUN-500-PET`

Product policy applied:

- `is_active=true`
- `sales_status=showcase`
- `price_amount=NULL`
- `availability=on_order`
- `orderable=false` (via showcase)
- `units_per_package=1`
- local `image_url` under `/uploads/products/...`

---

## Apply #2 (idempotency)

| Field | Value |
|-------|-------|
| Artifact | `production-apply-2026-08-05/apply-2/` (VPS: `2026-08-05T12-09-11-741Z-apply`) |
| **Created** | **0** |
| **Skipped** | **22** |
| **Errors** | **0** |
| Existing products edited | **false** |
| Catalog DB after | **645** (unchanged) |

**Verdict: import is idempotent.**

---

## Post-apply verification

| Check | Result |
|-------|--------|
| DARYAL- in DB | **22** |
| Soda / water | **16 / 6** |
| Showcase | **22** |
| With price | **0** |
| Orderable | **0** |
| Images in DB | **22 / 22** |
| Image HTTP | **22 / 22 → 200** (webp) |
| Uploads owner/mode | **1001:1001**, files **644** |
| Manual/rejected leak | **0** |
| Bavaria SKUs | **164** (unchanged) |
| DB total | **645** |
| Public catalog total | **643** |
| Public `q=DARYAL` | **22** |
| Health | `{"ok":true,"database":"ok"}` |
| Containers | `app-app-1` healthy, `app-db-1` healthy |

---

## What was not changed

- Existing products (fingerprint check: no edits)
- Prices / categories of existing SKUs
- Orders / clients
- Bavaria catalog
- Manual (Фрутимикс) / rejected (пиво, ФИЕСТА, Грейпфрут, прочие соки)
- No new categories created
- No `--merge`

---

## Commands used

```bash
# backup
pg_dump "$PGURL" --no-owner --format=plain \
  > /opt/tinda/app/backups/tinda-prod-daryal-20260805-120724.sql

# apply #1 / #2
npm run import:daryal:apply -- \
  --i-understand-and-have-backup \
  --backup-path=/backups/tinda-prod-daryal-20260805-120724.sql \
  --manifest=artifacts/daryal-import/latest-stage2/approved-import-manifest.json
```
