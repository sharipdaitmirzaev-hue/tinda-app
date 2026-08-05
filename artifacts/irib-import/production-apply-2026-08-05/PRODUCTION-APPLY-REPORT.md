# IRIB production apply report

**When (UTC):** 2026-08-05T14:26–14:29  
**PR:** https://github.com/sharipdaitmirzaev-hue/tinda-app/pull/27  
**Branch / commit:** `cursor/import-irib-e6e4` @ `d17f096`  
**VPS worktree:** `/opt/tinda/irib-pr27-worktree`

## Backup

| | |
|--|--|
| Path | `/opt/tinda/app/backups/tinda-prod-irib-20260805-142608.sql` |
| Bytes | 402321 |
| SHA-256 | `a3add0037eec1292477ba277068cff75163954d6167b9e61145965bacc892203` |
| Readable | yes (PostgreSQL database dump header) |
| Separate from Bavaria / Daryal / AquAlania | yes (those backups left untouched) |

## Applied manifest

`artifacts/irib-import/2026-08-05T14-12-48-411Z-final/approved-import-manifest-final.json`

**Not applied:** `image-update-manifest-separate.json` (9 candidates untouched).

### Preflight

| Check | Result |
|-------|--------|
| approved SKUs in manifest | **38** unique |
| confirmed duplicates excluded | **11** |
| manual excluded | **51** |
| rejected excluded | **11** |
| image-update candidates excluded | **9** |
| all 38 absent from production before apply | yes |
| category IDs exist (10 slugs) | yes |
| category distribution matches expected | yes (no diff) |
| processed images present for create SKUs | 38/38 |
| `existing_edited` expected | false |
| `--merge` | not used |

Expected category distribution (create):

| Category slug | Count |
|---------------|------:|
| `limonady` | 10 |
| `nektar` | 10 |
| `sok` | 4 |
| `kholodnyy-chay` | 3 |
| `voda-negazirovannaya` | 3 |
| `gazirovannye-napitki` | 3 |
| `voda-pitevaya` | 2 |
| `kvas` | 1 |
| `voda-mineralnaya` | 1 |
| `energeticheskie-napitki` | 1 |

## Apply #1 (create-only)

| Metric | Value |
|--------|------:|
| created | **38** |
| skipped | **0** |
| errors | **0** |
| images uploaded | **38** |
| images missing | **0** |
| existing_products_edited | **false** |
| catalog total | **670 → 708** |
| merge used | **false** |

Command:

```bash
npm run import:irib:apply -- \
  --i-understand-and-have-backup \
  --backup-path=/opt/tinda/app/backups/tinda-prod-irib-20260805-142608.sql \
  --manifest=artifacts/irib-import/2026-08-05T14-12-48-411Z-final/approved-import-manifest-final.json
```

Note: first attempt on `1efb533` was blocked before any writes because `probable-review-final.csv` still lists 7 `new_product` audit rows. Fix `d17f096` allows those approved create SKUs; DB remained at 670 until the successful apply.

## Apply #2 (idempotent)

| Metric | Value |
|--------|------:|
| created | **0** |
| skipped | **38** |
| errors | **0** |
| existing_products_edited | **false** |
| catalog total | **708 → 708** |

## Created SKUs (38)

1. `IRIB-CHEGERI-NEGAZIROVANNAYA-500-PET`
2. `IRIB-GOLD-GRAND-ANANAS-600-PET`
3. `IRIB-GOLD-GRAND-MOHITO-NEGAZIROVANNYY-600-PET`
4. `IRIB-GOLD-GRAND-MULTIFRUKT-600-PET`
5. `IRIB-GOLD-GRAND-TARHUN-600-PET`
6. `IRIB-ICE-BAR-MANGO-KLUBNIKA-500-PET`
7. `IRIB-ICE-BAR-PERSIK-500-PET`
8. `IRIB-ICE-BAR-YAGODNYY-500-PET`
9. `IRIB-KVAS-YANTARNYY-1250-PET`
10. `IRIB-NEKTAR-ABRIKOSOVYY-3000-PET`
11. `IRIB-NEKTAR-ABRIKOSOVYY-500-GLASS`
12. `IRIB-NEKTAR-MANGOVYY-500-GLASS`
13. `IRIB-NEKTAR-PERSIKOVYY-500-GLASS`
14. `IRIB-NEKTAR-VISHNEVYY-500-GLASS`
15. `IRIB-NEKTAR-YABLOCHNO-ABRIKOSOVYY-3000-PET`
16. `IRIB-NEKTAR-YABLOCHNO-ABRIKOSOVYY-500-GLASS`
17. `IRIB-NEKTAR-YABLOCHNYY-3000-PET`
18. `IRIB-NEKTAR-YABLOCHNYY-500-GLASS`
19. `IRIB-NEKTAR-YABLOCHNYY-750-GLASS`
20. `IRIB-PROFI-SPORT-ENERGY-GUARANA-500-PET`
21. `IRIB-RODNICHOK-NEGAZIROVANNAYA-330-PET`
22. `IRIB-RODNIKOVAYA-SVEZHEST-NEGAZIROVANNAYA-19000-PET`
23. `IRIB-SELESTA-ANANAS-500-GLASS`
24. `IRIB-SELESTA-GRANAT-500-GLASS`
25. `IRIB-SELESTA-GRUSHA-500-GLASS`
26. `IRIB-SELESTA-MOHITO-500-GLASS`
27. `IRIB-SELESTA-MULTIFRUKT-750-GLASS`
28. `IRIB-SELESTA-SHIPOVNIK-500-GLASS`
29. `IRIB-SOK-ANANASOVYY-500-GLASS`
30. `IRIB-SOK-MULTIFRUKTOVYY-750-GLASS`
31. `IRIB-SOK-YABLOCHNYY-3000-PET`
32. `IRIB-SOK-YABLOCHNYY-500-GLASS`
33. `IRIB-TALIH-NEGAZIROVANNAYA-1500-PET`
34. `IRIB-TALIH-NEGAZIROVANNAYA-5000-PET`
35. `IRIB-TALIH-NEGAZIROVANNAYA-600-PET`
36. `IRIB-TALIH-SPORT-KLASSICHESKIY-600-PET`
37. `IRIB-TALIH-SPORT-KLUBNIKA-600-PET`
38. `IRIB-TALIH-SPORT-LIMON-600-PET`

## Category distribution (created)

| Category slug | Count |
|---------------|------:|
| `limonady` | 10 |
| `nektar` | 10 |
| `sok` | 4 |
| `kholodnyy-chay` | 3 |
| `voda-negazirovannaya` | 3 |
| `gazirovannye-napitki` | 3 |
| `voda-pitevaya` | 2 |
| `kvas` | 1 |
| `voda-mineralnaya` | 1 |
| `energeticheskie-napitki` | 1 |

No new categories created.

## Product flags (all 38)

| Field | Value |
|-------|-------|
| `is_active` | true |
| `sales_status` | showcase |
| `price_amount` | NULL |
| `availability` | on_order |
| `units_per_package` | 1 |
| `allow_piece_sale` | false |

Note: schema has no `orderable` column; non-orderable behaviour is enforced via `sales_status=showcase` + `availability=on_order` + `allow_piece_sale=false` (same pattern as Bavaria/Daryal/AquAlania).

## Images (created SKUs only)

| Check | Result |
|-------|--------|
| uploaded | 38/38 |
| HTTP | 200 for all |
| MIME | `image/webp` |
| owner | `1001:1001` |
| file mode | `644` |
| dir mode | `755` |
| exact | **18** |
| exact_low_res | **20** |
| shared | **0** |
| missing | **0** |

No upscaling. Image-update candidates for existing ZY-IRIB products were **not** applied.

## Existing products / other brands

| Check | Result |
|-------|--------|
| fingerprint diff (non-IRIB) | **0 changed** |
| Bavaria count | **164** (unchanged) |
| Daryal count | **22** (unchanged) |
| AquAlania count | **25** (unchanged) |
| ZY-IRIB confirmed duplicates | **11** (single instance each) |
| IRIB new SKUs in DB | **38** |
| manual / rejected imported | **none** |
| image-update candidates applied | **none** |

## Health / containers

| | |
|--|--|
| `app-app-1` | Up (healthy) |
| `app-db-1` | Up (healthy) |
| `GET /api/v1/health` | **200** `{"ok":true,"database":"ok"}` |

## Artifacts

- `APPLY-REPORT-1.json`
- `APPLY-REPORT-2-idempotent.json`
- `irib-apply-console.log`
- `irib-apply-idempotent.log`
- `tinda-prod-irib-20260805-142608.sql.sha256`
- `skus.txt`
- `skus-rows.txt`
