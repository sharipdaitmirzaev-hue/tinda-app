# Bavaria image completion — dry-run report

**Branch:** `cursor/bavaria-missing-images-ad60`  
**Date:** 2026-07-31  
**Production DB modified:** **no**  
**Production apply:** **not executed** (awaiting explicit confirmation)

---

## Scope

| Item | Count |
|------|------:|
| Bavaria SKUs on production | 164 |
| With image | 106 |
| **Without image (target)** | **58** |
| Apply-time missing (historical) | 61 |
| Now have image (F-line mango/multifrukt/sliva) | 3 |
| Manual positions (not imported) | 5 |

---

## Results (this dry-run)

| Metric | Count |
|--------|------:|
| Official site source URLs found & downloaded | **23** (0 errors) |
| SKUs with confirmed official source (ready / needs crop) | **40** |
| — of which ready without crop | **1** (`DOBRETSOV-BOCHKOVOY-2000-PET`) |
| — of which confirmed but **needs crop** | **39** |
| Pending PDF crop (no unique site packshot) | **16** |
| Disputed (do not auto-apply) | **2** |
| Manual kept (not promoted) | **5 / 5** |
| Manual uniquely confirmed → import | **0** |

### Status breakdown (58 missing)

| `review_status` | Count |
|-----------------|------:|
| `confirmed_needs_crop` | 39 |
| `pending_pdf_crop` | 16 |
| `disputed` | 2 |
| `confirmed` | 1 |

### Confidence (58)

| Confidence | Count |
|------------|------:|
| high | 38 |
| medium | 15 |
| low | 5 |

---

## Image-update manifest

File: `image-update-manifest.json`

- **Mode:** `dry-run`
- **Kind:** `image_update_only`
- **Items:** **40** candidates
- Allowed field change: `image_url` only
- Forbidden: category, price, sales_status, is_active, name, sku

**Not production-ready until crops are finished** for the 39 `confirmed_needs_crop` items (group shots must be split into single-pack images; no shelf photos / watermarks / wrong ABV).

---

## Manual positions (all keep-manual)

| SKU | Unique pack confirmed? | Recommendation |
|-----|------------------------|----------------|
| Nordisch NA 0,45 glass | No (PDF bottle vs CAN-only icon; site Nordisch = 5% alc) | **keep_manual** |
| Апельсин 0,45 glass | No (no glass packshot on PDF p.15) | **keep_manual** |
| Кола 0,45 glass | No | **keep_manual** |
| Яблоко 0,45 glass | No (Яблоко only as PET 1.5) | **keep_manual** |
| TBAU Sport | No (no pack/volume matrix) | **keep_manual** |

---

## Disputed / blocked auto-apply

1. **Cola LE glass** (`92_…png`) — LE page asset, face text **CLASSIC**
2. **Dobretsov Бочковой 1,42** — site shows **2L** only
3. **Gallagher / Nordisch NA** — must not use alcoholic site art (4% / 5%)
4. Do not reuse Premium LE can for Cola LE can

Full research notes: `BAVARIA-MISSING-IMAGES-SITE-PDF-REPORT.md`

---

## Next steps (before any production apply)

1. Crop single-pack images for 39 `confirmed_needs_crop` SKUs from `source-downloads/` (official site).
2. Crop PDF pages 11/14/15/18/21/24 for 16 `pending_pdf_crop` SKUs (`…/pdf-ingest/renders/`).
3. Human confirm disputed cases.
4. Fill `local_processed_path` in manifest.
5. Only then request production **image-only** apply confirmation.

### How to re-download sources

```bash
python3 scripts/bavaria-image-completion-inventory.py
# writes/updates artifacts/bavaria-import/image-completion-2026-07-31/
```

`source-downloads/` is gitignored (binaries); regenerate locally with the script above.

---

## Artifacts in this folder

| File | Purpose |
|------|---------|
| `missing-images-inventory.csv` / `.json` | Full inventory of 58 SKUs |
| `manual-positions-inventory.csv` / `.json` | 5 manual decisions |
| `image-update-manifest.json` | Dry-run image-only update list (40) |
| `source-download-report.json` | Download checksums/status |
| `BAVARIA-MISSING-IMAGES-SITE-PDF-REPORT.md` | Site/PDF research |
| `DRY-RUN-REPORT.md` | This report |
| `inventory-meta.json` | Counts / flags |
