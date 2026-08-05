# AquAlania FINAL pre-apply report

**When:** 2026-08-05T13:05:44Z  
**Output:** `artifacts/aqualania-import/2026-08-05T13-05-07-740Z-final`  
**Based on:** `artifacts/aqualania-import/2026-08-05T12-38-20-797Z-stage1`  
**Sources:** https://aqualania.ru/product, https://aqualania.ru/enproduct

## Decisions

### 1. «Игристое»
- **Verdict:** APPROVED (безалкогольный газированный напиток со вкусом «Игристое»)
- RU: «Напиток безалкогольный сильногазированный „Игристое“»
- EN: «Non alcoholic carbonated drink with … flavor» (Sparkling wine / Champagne = flavor wording)
- Этикетка стекла: «НАПИТОК БЕЗАЛКОГОЛЬНЫЙ СИЛЬНОГАЗИРОВАННЫЙ»
- Naming: `Напиток газированный AquAlania Игристое, …` — **без слова «вино»**
- SKUs: `AQUALANIA-CAN-IGRISTOE-330-CAN`, `AQUALANIA-PREMIUM-IGRISTOE-500-GLASS`

### 2. Feijoa
- **Verdict:** APPROVED, image **exact**
- Официальный файл `tarhun.png` по этикетке = **Фейхоа** (не Тархун)
- `taruhn.png` = отдельный SKU Тархун
- Неверная фотография не назначалась

### 3. Light low-res
- Оригиналы на product page: **224×200 JPEG**; srcset / CSS background / larger originals **не найдены**
- Home `jb_*` ~282×300 — не заменяют product SKU image (layout/caption)
- Без апскейла; статус `exact_low_res`; импорт разрешён (вкус/упаковка читаются)

| SKU | Flavor | Size | Bytes | Status |
|-----|--------|-----:|------:|--------|
| `AQUALANIA-LIGHT-ANANAS-330-PETCAN` | Ананас | 224×200 | 36999 | exact_low_res |
| `AQUALANIA-LIGHT-APELSIN-330-PETCAN` | Апельсин | 224×200 | 39216 | exact_low_res |
| `AQUALANIA-LIGHT-KLUBNIKA-330-PETCAN` | Клубника | 224×200 | 42514 | exact_low_res |
| `AQUALANIA-LIGHT-MANGO-MARAKUYYA-330-PETCAN` | Манго-Маракуйя | 224×200 | 37184 | exact_low_res |
| `AQUALANIA-LIGHT-MOHITO-330-PETCAN` | Мохито | 224×200 | 38440 | exact_low_res |
| `AQUALANIA-LIGHT-VISHNYA-330-PETCAN` | Вишня | 224×200 | 39196 | exact_low_res |
| `AQUALANIA-LIGHT-YABLOKO-330-PETCAN` | Яблоко | 224×200 | 36167 | exact_low_res |

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
| Production scanned | 643 |
| SKU collisions | 0 |
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

## Manifest
`artifacts/aqualania-import/2026-08-05T13-05-07-740Z-final/approved-import-manifest-final.json`

## Apply readiness
- create-only gated in `scripts/import-aqualania.ts`
- **production apply NOT run**
- requires `--i-understand-and-have-backup` + `--backup-path` + `--manifest`
- categories not auto-created; existing products not edited
