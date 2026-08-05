# IRIB (ИРИБ) pre-apply / stage-1 dry-run report

**When:** 2026-08-05T13:56:24Z  
**Output:** `artifacts/irib-import/2026-08-05T13-53-00-881Z-stage1`  
**Source:** https://irib.su (official only)  
**Manufacturer:** ООО «ИРИБ»

## Pages researched
- home, robots.txt, sitemap.xml, o-kompanii, catalog sections, all WP product pages, wp-json/wp/v2/product
- Evidence rows: **88**
- WP products: **68**

## Counts
| Bucket | Count |
|--------|------:|
| Discovered SKUs | **100** |
| Approved | **26** |
| Manual | **74** |
| Rejected | **0** |
| Images exact | 0 |
| Images exact_low_res | 47 |
| Images missing | 53 |
| Production SKU collisions | 0 |
| Exact matches | 12 |
| Probable matches | 13 |

## Lines
- BRO-LEMON: **14**
- CHEGERI: **1**
- GOLD-GRAND: **8**
- ICE-BAR: **6**
- KVAS: **3**
- LIMONAD-PET: **5**
- MINDARI: **5**
- NEKTAR: **17**
- PROFI-SPORT: **6**
- RODNICHOK: **1**
- RODNIKOVAYA-SVEZHEST: **1**
- SELESTA: **7**
- SOK: **18**
- TALIH: **3**
- TALIH-SPORT: **4**
- TARKI-TAU: **1**

## Approved categories
- Газированные напитки: **3**
- Квас: **1**
- Лимонады: **10**
- Минеральная вода: **1**
- Негазированная вода: **3**
- Нектар: **3**
- Питьевая вода: **2**
- Сок: **1**
- Холодный чай: **1**
- Энергетические напитки: **1**

## Review policy highlights
- Each flavor × volume × package is a separate SKU (`IRIB-{LINE}-{FLAVOR}-{VOLUME}-{PACKAGE}`).
- Multi-volume WP excerpts expand to multiple SKUs; image assigned only when filename/single-volume confirms the volume.
- Existing production Ириб / ZY-IRIB-* rows are never modified; collisions go to manual (`exact_match` / `probable_match`).
- No new categories created; sports BCAA/Isotonic/L-Carnitine → `category_manual`.

## Manifest
`artifacts/irib-import/2026-08-05T13-53-00-881Z-stage1/approved-import-manifest.json`

## Apply readiness
- create-only apply implemented in `scripts/import-irib.ts`
- **production apply NOT run**
- requires `--i-understand-and-have-backup` + `--backup-path` + `--manifest`
- `--merge` forbidden
