# AquAlania production apply report

**When (UTC):** 2026-08-05T13:10–13:12  
**PR:** https://github.com/sharipdaitmirzaev-hue/tinda-app/pull/26  
**Branch / commit:** `cursor/import-aqualania-e6e4` @ `caa92ca`  
**VPS worktree:** `/opt/tinda/aqualania-pr26-worktree`

## Backup

| | |
|--|--|
| Path | `/opt/tinda/app/backups/tinda-prod-aqualania-20260805-131023.sql` |
| Bytes | 383958 |
| SHA-256 | `7b7043bedf0cba75ee064f0243c979a78b988b8f0372c098e2e70f2183b20861` |
| Readable | yes (PostgreSQL dump header) |
| Separate from Bavaria/Daryal | yes (those backups left untouched) |

## Applied manifest

`artifacts/aqualania-import/2026-08-05T13-05-07-740Z-final/approved-import-manifest-final.json`

Preflight confirmed:

- approved SKUs = **25** unique;
- manual = 0, rejected = 0;
- all 25 absent from production before apply;
- category IDs exist (`limonady`, `kola`, `voda-gazirovannaya`, `voda-negazirovannaya`, `gazirovannye-napitki`);
- all processed images present;
- Light = `exact_low_res` native **224×200** (no upscale);
- «Игристое» = non-alcoholic (RU/EN + label);
- Feijoa uses official `tarhun.png` (label = Фейхоа).

## Apply #1 (create-only)

| Metric | Value |
|--------|------:|
| created | **25** |
| skipped | **0** |
| errors | **0** |
| images uploaded | **25** |
| images missing | **0** |
| existing_products_edited | **false** |
| catalog total | **645 → 670** |
| merge used | **false** |

Command:

```bash
npm run import:aqualania:apply -- \
  --i-understand-and-have-backup \
  --backup-path=/opt/tinda/app/backups/tinda-prod-aqualania-20260805-131023.sql \
  --manifest=artifacts/aqualania-import/2026-08-05T13-05-07-740Z-final/approved-import-manifest-final.json
```

## Apply #2 (idempotent)

| Metric | Value |
|--------|------:|
| created | **0** |
| skipped | **25** |
| errors | **0** |
| existing_products_edited | **false** |
| catalog total | **670 → 670** |

## Created SKUs (25)

1. `AQUALANIA-CAN-DYNYA-MYATA-330-CAN`
2. `AQUALANIA-CAN-IGRISTOE-330-CAN`
3. `AQUALANIA-CAN-MANGO-VINOGRAD-330-CAN`
4. `AQUALANIA-CAN-MOHITO-CLASSIC-330-CAN`
5. `AQUALANIA-CAN-MOHITO-KLUBNICHNYY-330-CAN`
6. `AQUALANIA-LIGHT-ANANAS-330-PETCAN`
7. `AQUALANIA-LIGHT-APELSIN-330-PETCAN`
8. `AQUALANIA-LIGHT-KLUBNIKA-330-PETCAN`
9. `AQUALANIA-LIGHT-MANGO-MARAKUYYA-330-PETCAN`
10. `AQUALANIA-LIGHT-MOHITO-330-PETCAN`
11. `AQUALANIA-LIGHT-VISHNYA-330-PETCAN`
12. `AQUALANIA-LIGHT-YABLOKO-330-PETCAN`
13. `AQUALANIA-PREMIUM-BARBARIS-500-GLASS`
14. `AQUALANIA-PREMIUM-DYNYA-MYATA-500-GLASS`
15. `AQUALANIA-PREMIUM-FEYHOA-500-GLASS`
16. `AQUALANIA-PREMIUM-GRUSHA-500-GLASS`
17. `AQUALANIA-PREMIUM-IGRISTOE-500-GLASS`
18. `AQUALANIA-PREMIUM-KOLA-500-GLASS`
19. `AQUALANIA-PREMIUM-LIMONAD-500-GLASS`
20. `AQUALANIA-PREMIUM-MANGO-VINOGRAD-500-GLASS`
21. `AQUALANIA-PREMIUM-SAPERAVI-500-GLASS`
22. `AQUALANIA-PREMIUM-SLIVA-500-GLASS`
23. `AQUALANIA-PREMIUM-TARHUN-500-GLASS`
24. `AQUALANIA-WATER-SPARKLING-500-PET`
25. `AQUALANIA-WATER-STILL-500-PET`

## Category distribution (created)

| Category slug | Count |
|---------------|------:|
| `limonady` | 10 |
| `kola` | 1 |
| `voda-gazirovannaya` | 1 |
| `voda-negazirovannaya` | 1 |
| `gazirovannye-napitki` | 12 |

No new categories created.

## Product flags (all 25)

| Field | Value |
|-------|-------|
| `is_active` | true |
| `sales_status` | showcase |
| `price_amount` | NULL |
| `availability` | on_order |
| `units_per_package` | 1 |
| `allow_piece_sale` | false |
| brand | AquAlania |

Note: schema has no `orderable` column; non-orderable behaviour is enforced via `sales_status=showcase` + `availability=on_order` + `allow_piece_sale=false` (same pattern as Bavaria/Daryal).

## Images

| Check | Result |
|-------|--------|
| uploaded | 25/25 |
| HTTP | 200 for all |
| MIME | `image/webp` |
| owner | `1001:1001` |
| file mode | `644` |
| exact | 18 |
| exact_low_res (Light) | 7 @ **224×200** (not upscaled) |

## Existing products / other brands

| Check | Result |
|-------|--------|
| fingerprint diff (non-AquAlania) | **0 changed** |
| Bavaria count | **164** (unchanged) |
| Daryal count | **22** (unchanged) |
| AquAlania in DB | **25** |
| manual/rejected imported | **none** |

## Health / containers

| | |
|--|--|
| `app-app-1` | Up (healthy) |
| `app-db-1` | Up (healthy) |
| `GET /api/v1/health` | **200** `{"ok":true,"database":"ok"}` |

## Artifacts

- `APPLY-REPORT-1.json`
- `APPLY-REPORT-2-idempotent.json`
- `aqualania-apply-console.log`
- `aqualania-apply-idempotent.log`
- `tinda-prod-aqualania-20260805-131023.sql.sha256`
- `skus.txt`
