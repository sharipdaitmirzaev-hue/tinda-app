# AquAlania pre-apply / stage-1 dry-run report

**When:** 2026-08-05T12:39:00Z  
**Output:** `artifacts/aqualania-import/2026-08-05T12-38-20-797Z-stage1`  
**Sources:** https://aqualania.ru/product, https://aqualania.ru/enproduct (official only)

## Pages researched
- product, enproduct, home, sitemap.xml, robots.txt → **5**

## Counts
| Bucket | Count |
|--------|------:|
| Discovered | **25** |
| Approved | **25** |
| Manual | **0** |
| Rejected | **0** |
| Images exact | 18 |
| Images exact_low_res | 7 |
| Images missing | 0 |
| Production SKU collisions | 0 |
| Probable matches | 0 |

## Lines
- CAN: **5**
- LIGHT: **7**
- PREMIUM: **11**
- WATER: **2**

## Approved categories
- Газированная вода: **1**
- Газированные напитки: **12**
- Кола: **1**
- Лимонады: **10**
- Негазированная вода: **1**

## Disputed / notes
- `AQUALANIA-PREMIUM-FEYHOA-500-GLASS` — Feijoa uses asset filename tarhun.png on official site (DOM title confirms Feijoa).
- `AQUALANIA-CAN-IGRISTOE-330-CAN` —  Flavor label «Игристое» confirmed on RU/EN site (EN: Champagne).
- `AQUALANIA-LIGHT-ANANAS-330-PETCAN` — Official Light assets are small (~224px); kept as exact_low_res.
- `AQUALANIA-LIGHT-APELSIN-330-PETCAN` — Official Light assets are small (~224px); kept as exact_low_res.
- `AQUALANIA-LIGHT-KLUBNIKA-330-PETCAN` — Official Light assets are small (~224px); kept as exact_low_res.
- `AQUALANIA-LIGHT-MANGO-MARAKUYYA-330-PETCAN` — Official Light assets are small (~224px); kept as exact_low_res.
- `AQUALANIA-LIGHT-MOHITO-330-PETCAN` — Official Light assets are small (~224px); kept as exact_low_res.
- `AQUALANIA-LIGHT-VISHNYA-330-PETCAN` — Official Light assets are small (~224px); kept as exact_low_res.
- `AQUALANIA-LIGHT-YABLOKO-330-PETCAN` — Official Light assets are small (~224px); kept as exact_low_res.
- `AQUALANIA-PREMIUM-IGRISTOE-500-GLASS` —  Flavor label «Игристое» confirmed on RU/EN site (EN: Sparkling wine).

## Manifest
`artifacts/aqualania-import/2026-08-05T12-38-20-797Z-stage1/approved-import-manifest.json`

## Apply readiness
- create-only apply implemented in `scripts/import-aqualania.ts`
- **production apply NOT run**
- requires separate confirmation + backup flags
