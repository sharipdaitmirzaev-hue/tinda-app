# Bavaria image completion — FINAL dry-run report

**Branch:** `cursor/bavaria-missing-images-ad60`  
**Date:** 2026-07-31T14:21:36.913808+00:00  
**Production DB modified:** **no**  
**Production apply:** **not executed** (awaiting explicit confirmation)

---

## Headline numbers

| Metric | Count |
|--------|------:|
| Final single-pack images produced | **56** |
| Confirmed image-only apply records | **56** |
| Products remaining without image | **2** |
| Manual positions (not in apply) | **5** |
| Excluded / disputed (not in apply) | **2** (+ CLASSIC site asset unused) |
| Fields changed by apply | **`image_url` only** |

---

## Apply confirmation

- Manifest: `image-update-manifest.json`
- Mode: `dry-run` / `image_update_only`
- `item_count`: **56**
- Every item: `fields_to_change = ["image_url"]`
- Forbidden: name, category, price, active, orderable, sales_status, sku
- **Do not run production apply without separate confirmation.**

---

## Status breakdown (58 missing SKUs)

| review_status | Count |
|---------------|------:|
| `confirmed_ready` | 56 |
| `excluded` | 2 |

---

## Remaining without confirmed image

- `BAVARIA-BAVARIYA-NORDISCH-NA-450-CAN`
- `BAVARIA-COLALE-COLA-LE-450-GLASS`

---

## Excluded / disputed

- **BAVARIA-COLALE-COLA-LE-450-GLASS** — Glass face reads CLASSIC on site 92 and PDF p.18 crop — LE correspondence not proven; excluded
- **BAVARIA-DOBRETSOV-BOCHKOVOY-1420-PET / site 2L-only** — Excluded 2L reuse; PDF p.13 distinct 1.42 used
- **Gallagher/Nordisch alcoholic site art (103_/140_)** — Never used; Gallagher NA from PDF p.11 0% stamp
- **BAVARIA-BAVARIYA-NORDISCH-NA-450-CAN** — PDF shows bottle; icon CAN-only — no unique can packshot; alcoholic site art forbidden

### Manual (keep_manual, not in apply)

- `BAVARIA-BAVARIYA-APELSIN-450-GLASS`
- `BAVARIA-BAVARIYA-KOLA-450-GLASS`
- `BAVARIA-BAVARIYA-NORDISCH-NA-450-GLASS`
- `BAVARIA-BAVARIYA-YABLOKO-450-GLASS`
- `BAVARIA-TBAU-SPORT-MANUAL`

---

## Sources used for final crops

- Official site downloads: `source-downloads/` (23 files)
- PDF renders pages: **11, 13, 14, 15, 18, 21, 24**
  - User-listed 11/14/15/18/21/24 plus **p.13** for distinct Dobretsov Бочковой 1,42

### Key decisions

1. **Cola LE glass**: site `92_…` and PDF p.18 glass both read **CLASSIC** → **excluded** until LE proven.
2. **Cola LE can 0,33**: cropped from PDF p.18 lineup → **included**.
3. **Бочковой 1,42**: site 2L art **not reused**; PDF p.13 distinct smaller PET **included**.
4. **Gallagher NA**: alcoholic site art **forbidden**; PDF p.11 under **0% Алк.** stamp **included**.
5. **Nordisch NA can**: **excluded** — no unique can packshot.
6. All **5 manuals** excluded from apply.

---

## Technical QA

- All apply files open as WEBP, canvas **1000×1000**
- Duplicate processed SHA-256 groups: **0**
- Crop errors: **0**
- Contact sheet: `contact-sheet.html`, `contact-sheet.jpg`

---

## Artifacts

| File | Purpose |
|------|---------|
| `processed/*.webp` | Final single-pack images |
| `image-update-manifest.json` | Image-only dry-run apply list |
| `missing-images-inventory.json` | Updated inventory |
| `crop-results.json` | Per-SKU crop metadata + QA |
| `contact-sheet.html` / `.jpg` | Visual review |
| `FINAL-DRY-RUN-REPORT.md` | This report |

---

## Next step

After human review of the contact sheet, explicitly confirm production **image-only** apply.
