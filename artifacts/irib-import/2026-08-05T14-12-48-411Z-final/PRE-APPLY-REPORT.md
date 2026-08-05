# IRIB final pre-apply report

**When:** 2026-08-05T14:14:30Z  
**Output:** `artifacts/irib-import/2026-08-05T14-12-48-411Z-final`  
**Stage1:** `artifacts/irib-import/2026-08-05T13-53-00-881Z-stage1`  
**Source:** https://irib.su only  
**Manufacturer:** ООО «ИРИБ»

## Production exact matches (confirmed duplicates)

Count: **11** — excluded from create manifest.

See `confirmed-duplicates.csv`.

## Probable matches (final decisions)

Rows: **15**  
Decisions: {'keep_manual': 8, 'new_product': 7}

See `probable-review-final.csv`.

## Manual groups

| Reason group | Count |
|--------------|------:|
| несколько вариантов фасовки | 34 |
| нет объёма | 12 |
| неясная категория | 4 |
| конфликт с production / данные карточки | 1 |

## Final buckets

| Bucket | Count |
|--------|------:|
| Approved NEW (create manifest) | **38** |
| Confirmed duplicates | **11** |
| Manual | **51** |
| Rejected | **11** |
| Images exact | 22 |
| Images exact_low_res | 43 |
| Images shared | 0 |
| Images missing | 35 |
| Image-update candidates (separate) | **9** |

## Approved-new categories

- Газированные напитки: **3**
- Квас: **1**
- Лимонады: **10**
- Минеральная вода: **1**
- Негазированная вода: **3**
- Нектар: **10**
- Питьевая вода: **2**
- Сок: **4**
- Холодный чай: **3**
- Энергетические напитки: **1**

## ZY-IRIB juices/nectars

Production ZY-IRIB SKUs present: **11**.  
Same flavor+volume+glass+type → confirmed duplicate (no create).  
Different volume with attachment-confirmed official photo → eligible as new SKU only when image/category complete.

## Тарки-Тау

Rows: 1  
- `IRIB-TARKI-TAU-TARKI-TAU-500-GLASS` → confirmed_duplicate / rejected (confirmed_duplicate)

## Manifests

- Create-only: `artifacts/irib-import/2026-08-05T14-12-48-411Z-final/approved-import-manifest-final.json`
- Image-update (NOT applied, NOT mixed): `artifacts/irib-import/2026-08-05T14-12-48-411Z-final/image-update-manifest-separate.json`

## Apply readiness

- create-only, backup + confirmation required, `--merge` forbidden
- existing products never edited by create apply
- **production apply NOT run**
- **image-update NOT run**


## Full test suite (local non-production DB)

- Local PostgreSQL test DB `tinda_test` on 127.0.0.1 (not production)
- npm run lint — pass
- npm run typecheck — pass
- npm test — **209/209 passed** (19 files)
- npm run build — pass
- Test DB dropped after verification

## Apply guards confirmed

- create-only
- merge forbidden
- backup + confirmation required
- create manifest contains only approved_skus
- image-update manifest separate and not applied
- no category creation
