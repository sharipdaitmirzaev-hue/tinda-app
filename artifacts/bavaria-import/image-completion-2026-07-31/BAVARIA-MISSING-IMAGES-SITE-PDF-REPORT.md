# Bavaria missing images inventory (read-only)

**Date:** 2026-07-31  
**Sources:** `/tmp/bavaria-prod-all.tsv`, `approved-products.csv`, `manual-review.csv`, `bavaria-group.ru` (HTTP-verified), PDF ingest `2026-07-31T11-47-10-496Z-pdf-ingest`  
**Constraint:** No production DB writes.

---

## Summary counts

| Metric | Count |
| --- | ---: |
| Prod Bavaria SKUs total | 163 (+ headerless TSV rows) |
| **Missing `image_url` on prod** | **58** |
| Missing also empty in approved manifest `image_url` | 58 / 58 |
| Manual-review SKUs (not in prod) | 5 |
| Missing with **verified official site candidate(s)** | ~42 |
| Missing needing **PDF crop** as primary unique pack | ~16 |
| High-confidence site pack matches (flavor-unique or clear crop target) | ~30 |
| Medium / shared-line / needs crop | ~20 |
| Low / disputed / do-not-use site alcoholic art | ~8 |

### Missing by line

| Line | Missing SKUs |
| --- | ---: |
| Dreamix (soda + tonic) | 16 |
| Rocket Ride | 10 |
| Bavariya (NA beer + regular soda + Premium) | 15 |
| Mountea | 6 |
| Dobretsov | 5 |
| Cola LE | 4 |
| Limnada Барбарис | 2 |

### PDF page map (renders + OCR present)

| Topic | PDF page | Render | OCR | Notes |
| --- | ---: | :---: | :---: | --- |
| NA beer: Elf / Gallagher / Nordisch / Светлое | **11** | yes | weak | 0% Алк. stamp; Nordisch photo=bottle, icon=CAN only |
| Gallagher / Nordisch (alcoholic catalog spread) | **12** | yes | weak | Alcoholic line — not for NA SKUs |
| Dobretsov kvass | **13** | yes | weak | Consumer packs |
| Premium flavors | **14** | yes | yes | Includes **Виноград** (absent from site assort text/photos) |
| Regular soda | **15** | yes | yes | Glass 0,45 shown for Мохито/Питахайя/Тархун/Груша; Яблоко PET 1,5 shown |
| Cola Limited Edition | **18** | yes | weak | Site-primary for packs |
| Dreamix soda | **20** | yes | yes | 4 flavors × CAN/PET |
| Dreamix Toniс | **21** | yes | yes | Bitter Lemon / Indian Tonic × PET/GL/CAN |
| Mountea | **24** | yes | yes | 3 flavors incl. **Лайм-мята** (not on site) |
| Rocket Ride | **29** | yes | yes | 5 flavors × CAN 0,45 / PET 0,5 |

---

## Verified official image URL catalog

All URLs below returned **HTTP 200** with image content-type (fetched 2026-07-31).

### Per-flavor / strong candidates

| Asset | URL | What it shows |
| --- | --- | --- |
| Elf NA glass | `https://www.bavaria-group.ru/files/beer_items/55_1740991309.jpg` | Green glass Elf **безалкогольное** |
| Rocket Classic | `https://www.bavaria-group.ru/files/beer_items/105_1757076183.png` | CAN + PET Classic |
| Rocket Mango-Apricot | `https://www.bavaria-group.ru/files/beer_items/106_1757076512.png` | CAN + PET |
| Rocket Киви-Яблоко | `https://www.bavaria-group.ru/files/beer_items/107_1757076818.png` | CAN + PET |
| Rocket Дикие Ягоды | `https://www.bavaria-group.ru/files/beer_items/108_1757077083.png` | CAN + PET |
| Rocket Лайм-Лемонграс | `https://www.bavaria-group.ru/files/beer_items/109_1757077306.png` | CAN + PET |
| Dreamix Клюква-Апельсин | `https://www.bavaria-group.ru/files/beer_items/98_1743082462.jpg` | PET1.5 + PET0.5 + CAN0.33 |
| Dreamix Кола-Цитрус | `https://www.bavaria-group.ru/files/beer_items/100_1743082523.jpg` | same trio |
| Dreamix Тайга | `https://www.bavaria-group.ru/files/beer_items/101_1743082539.jpg` | same trio |
| Dreamix Мохито | `https://www.bavaria-group.ru/files/beer_items/102_1743082553.jpg` | same trio |
| Dreamix Indian Tonic | `https://www.bavaria-group.ru/files/beer_items/127_1775207748.png` | Glass 0,33 + PET 1L (no can) |
| Dreamix Bitter Lemon | `https://www.bavaria-group.ru/files/beer_items/128_1775214996.png` | Glass 0,33 + PET 1L (no can) |
| Mountea PET group | `https://www.bavaria-group.ru/files/beer_items/28_1758711718.png` | Лесные ягоды + Персик, 1.5 + 0.5 |
| Mountea CAN group | `https://www.bavaria-group.ru/files/beer_items/67_1758711780.png` | Лесные ягоды + Персик cans |
| Cola LE PET | `https://www.bavaria-group.ru/files/beer_items/91_1726224649.png` | 1,5 + 0,5 **LIMITED EDITION** |
| Cola “glass” on LE page | `https://www.bavaria-group.ru/files/beer_items/92_1726224683.png` | Glass 0,45 — label reads **Cola CLASSIC** (disputed for LE) |
| Limnada 1.5 group | `https://www.bavaria-group.ru/files/beer_items/58_1718608488.jpg` | Дюшес / Крем-Сода / **Барбарис** / Ананас |
| Limnada 0.5 group | `https://www.bavaria-group.ru/files/beer_items/68_1718376439.jpg` | Дюшес / Крем-Сода / **Барбарис** |
| Regular soda 1.5 | `https://www.bavaria-group.ru/files/beer_items/95_1730364037.jpg` | Груша/Апельсин/Тархун/Питахайя/Мохито/Кола (no Яблоко) |
| Regular soda 0.5 | `https://www.bavaria-group.ru/files/beer_items/97_1730364236.jpg` | Груша/Тархун/**Кола** |
| Premium glass 0.5 | `https://www.bavaria-group.ru/files/beer_items/22_1730373939.jpg` | 6 flavors, **no Виноград** |
| Premium PET 1.2 | `https://www.bavaria-group.ru/files/beer_items/126_1772458839.png` | 5 flavors incl. **Вишня**, **no Виноград** |
| Dobretsov Хлебный group | `https://www.bavaria-group.ru/files/beer_items/76_1783510510.jpg` | PET large + mid + CAN (Хлебный) |
| Dobretsov Бочковой | `https://www.bavaria-group.ru/files/beer_items/139_1783501193.png` | PET (site: **ПЭТ 2 л**) |

### Site pages that look related but **must not** be used for NA beer SKUs

| Asset | URL | Problem |
| --- | --- | --- |
| Gallagher lager | `https://www.bavaria-group.ru/files/beer_items/103_1757317744.png` | **4,0% ALC/VOL** alcoholic lager |
| Nordisch Bier | `https://www.bavaria-group.ru/files/beer_items/140_1784905434.jpeg` | **ALC 5.0%** alcoholic lineup |
| Category thumbs | `/files/beers/53_…png`, `/files/beers/63_…jpeg` | Same alcoholic products |

Correct product URLs discovered:

- Gallagher (alcoholic): `https://www.bavaria-group.ru/beer-product/svetlyj-lager-gallagher`
- Nordisch (alcoholic): `https://www.bavaria-group.ru/beer-product/nordisch-bier`
- Dobretsov: `https://www.bavaria-group.ru/beer-product/kvas-dobrecov` (**not** `…/kvas-dobretsov` → 404)
- Dobretsov Бочковой: `https://www.bavaria-group.ru/beer-product/kvas-dobrecov-bockovoj`

---

## Missing SKUs (58)

Format: `sku | name | category | pdf_page | source_url | candidate_image_url(s) | confidence | notes`

### A. Безалкогольное пиво

- `BAVARIA-BAVARIYA-ELF-450-CAN` | Пиво безалкогольное Бавария Elf, 0,45 л, банка | Безалкогольное пиво | **11** | https://www.bavaria-group.ru/beer-product/elf-bezalkogolnoe | `…/55_1740991309.jpg` (glass only); PDF p.11 can crop | **med** | Site card is glass; sibling GLASS already imaged on prod. Prefer PDF p.11 can crop for unique pack; glass reuse only as interim.

- `BAVARIA-BAVARIYA-GALLAGHER-NA-450-CAN` | Пиво безалкогольное Бавария Gallagher, 0,45 л, банка | Безалкогольное пиво | **11** | https://www.bavaria-group.ru (no NA card) | **none yet** (reject `…/103_1757317744.png`) | **low** | Site Gallagher is **4% lager**. Use PDF p.11 NA can under 0% stamp.

- `BAVARIA-BAVARIYA-GALLAGHER-NA-450-GLASS` | Пиво безалкогольное Бавария Gallagher, 0,45 л, стекло | Безалкогольное пиво | **11** | https://www.bavaria-group.ru | **none yet** (reject alcoholic) | **low** | Same; crop NA bottle from PDF p.11.

- `BAVARIA-BAVARIYA-NORDISCH-NA-450-CAN` | Пиво безалкогольное Бавария Nordisch Bier, 0,45 л, банка | Безалкогольное пиво | **11** | https://www.bavaria-group.ru | **none yet** (reject `…/140_1784905434.jpeg`) | **low** | Site Nordisch is **5%**. PDF p.11 shows bottle photo + CAN 0,45 icon only — can packshot may need supplier/PDF can art; do not use alcoholic site can.

### B. Bavariya regular soda

- `BAVARIA-BAVARIYA-GRUSHA-450-GLASS` | … Груша, 0,45 л, стекло | Газированные | **15** | …/sladkie-gazirovannye-napitki | **none yet** (site has PET only) | **med** | Unique glass pack on PDF p.15 (Груша glass). Crop from render.

- `BAVARIA-BAVARIYA-MOHITO-450-GLASS` | … Мохито, 0,45 л, стекло | Газированные | **15** | …/sladkie-gazirovannye-napitki | **none yet** | **med** | PDF p.15 glass Мохито.

- `BAVARIA-BAVARIYA-PITAHAYYA-450-GLASS` | … Питахайя, 0,45 л, стекло | Газированные | **15** | …/sladkie-gazirovannye-napitki | **none yet** | **med** | PDF p.15 glass Питахайя.

- `BAVARIA-BAVARIYA-TARHUN-450-GLASS` | … Тархун, 0,45 л, стекло | Газированные | **15** | …/sladkie-gazirovannye-napitki | **none yet** | **med** | PDF p.15 glass Тархун.

- `BAVARIA-BAVARIYA-KOLA-500-PET` | … Кола, 0,5 л, ПЭТ | Газированные | **15** | …/sladkie-gazirovannye-napitki | `…/97_1730364236.jpg` (group; crop Кола) | **high** | Site 0,5 lineup includes Кола; PDF confirms.

- `BAVARIA-BAVARIYA-KOLA-1500-PET` | … Кола, 1,5 л, ПЭТ | Газированные | **15** | …/sladkie-gazirovannye-napitki | `…/95_1730364037.jpg` (group; crop Кола) | **high** | In site 1,5 lineup.

- `BAVARIA-BAVARIYA-YABLOKO-1500-PET` | … Яблоко, 1,5 л, ПЭТ | Газированные | **15** | …/sladkie-gazirovannye-napitki | **none yet** (not in site photo/text) | **med** | PDF p.15 bottom row shows Яблоко PET — crop from PDF.

### C. Bavariya Premium (missing flavors only)

- `BAVARIA-BAVARIYA-PREMIUM-VISHNYA-500-GLASS` | … Premium Вишня, 0,5 л, стекло | Газированные | **14** | …/sladkie-gazirovannye-napitki-premium | `…/22_1730373939.jpg` (crop Вишня) | **high** | Present in site glass group.

- `BAVARIA-BAVARIYA-PREMIUM-VISHNYA-1200-PET` | … Premium Вишня, 1,2 л, ПЭТ | Газированные | **14** | …/premium | `…/126_1772458839.png` (crop Вишня) | **high** | Present in site PET 1,2 group.

- `BAVARIA-BAVARIYA-PREMIUM-VINOGRAD-500-GLASS` | … Premium Виноград, 0,5 л, стекло | Газированные | **14** | …/premium | **none yet** | **med** | **Not** on site glass photo/assortment text. PDF p.14 shows Виноград glass — crop.

- `BAVARIA-BAVARIYA-PREMIUM-VINOGRAD-1200-PET` | … Premium Виноград, 1,2 л, ПЭТ | Газированные | **14** | …/premium | **none yet** | **med** | Absent from site PET 1,2 photo. PDF p.14 PET Виноград — crop.

### D. Cola Limited Edition

- `BAVARIA-COLALE-COLA-LE-1500-PET` | Cola Limited Edition, 1,5 л, ПЭТ | Газированные | 18 (OCR) | …/cola-limited-edition | `…/91_1726224649.png` (crop 1,5) | **high** | Label explicitly LIMITED EDITION + 1,5 л.

- `BAVARIA-COLALE-COLA-LE-500-PET` | Cola Limited Edition, 0,5 л, ПЭТ | Газированные | 18 | …/cola-limited-edition | `…/91_1726224649.png` (crop 0,5) | **high** | Same group shot.

- `BAVARIA-COLALE-COLA-LE-450-GLASS` | Cola Limited Edition, 0,45 л, стекло | Газированные | 18 | …/cola-limited-edition | `…/92_1726224683.png` **disputed** | **low–med** | On LE page under “Стекло 0,45”, but pack face reads **Cola CLASSIC**. Prefer PDF p.18 crop if LE glass is distinct; else human confirm.

- `BAVARIA-COLALE-COLA-LE-330-CAN` | Cola Limited Edition, 0,33 л, банка | Газированные | 18? | …/cola-limited-edition | **none yet** | **low** | LE product page has no can. Do not confuse with `kola-limited-edition` / Premium LE can (`65_…jpg`). Crop from PDF p.18 if can shown.

### E. Dobretsov

- `BAVARIA-DOBRETSOV-HLEBNYY-2000-PET` | Квас Добрецовъ Хлебный, 2 л, ПЭТ | Квас | **13** | https://www.bavaria-group.ru/beer-product/kvas-dobrecov | `…/76_1783510510.jpg` (crop large PET) | **high** | Site: ПЭТ 2 л \| 1,4 л \| А/Б 0,45; label Хлебный.

- `BAVARIA-DOBRETSOV-HLEBNYY-1420-PET` | … Хлебный, 1,42 л, ПЭТ | Квас | **13** | …/kvas-dobrecov | `…/76_1783510510.jpg` (crop mid pack) | **med** | Mid pack in group; confirm 1,42 vs glass misread — site text says PET 1,4.

- `BAVARIA-DOBRETSOV-HLEBNYY-450-CAN` | … Хлебный, 0,45 л, банка | Квас | **13** | …/kvas-dobrecov | `…/76_1783510510.jpg` (crop can) | **high** | Can clearly in group.

- `BAVARIA-DOBRETSOV-BOCHKOVOY-2000-PET` | … Бочковой, 2 л, ПЭТ | Квас | **13** | https://www.bavaria-group.ru/beer-product/kvas-dobrecov-bockovoj | `…/139_1783501193.png` | **high** | Site states ПЭТ 2 л; unique Бочковой artwork.

- `BAVARIA-DOBRETSOV-BOCHKOVOY-1420-PET` | … Бочковой, 1,42 л, ПЭТ | Квас | **13** | …/bockovoj | **none yet** (only 2L shown on site) | **med** | PDF p.13 / crop if mid PET exists; else reuse 2L art with low uniqueness.

### F. Dreamix soda (p.20 + site)

All four flavors have verified trio images — use same URL for PET1.5 / PET0.5 / CAN of that flavor (crop preferred).

- `BAVARIA-DREAMIX-KLYUKVA-APELSIN-{1500-PET,500-PET,330-CAN}` | Клюква-Апельсин | Газированные | **20** | …/bezalkogolnyj-silnogazirovannyj-napitok-dreamix | `…/98_1743082462.jpg` | **high** | Flavor-unique trio.

- `BAVARIA-DREAMIX-KOLA-TSITRUS-{1500-PET,500-PET,330-CAN}` | Кола-Цитрус | Газированные | **20** | same | `…/100_1743082523.jpg` | **high** |

- `BAVARIA-DREAMIX-TAYGA-{1500-PET,500-PET,330-CAN}` | Тайга | Газированные | **20** | same | `…/101_1743082539.jpg` | **high** |

- `BAVARIA-DREAMIX-MOHITO-{1500-PET,500-PET,330-CAN}` | Мохито | Газированные | **20** | same | `…/102_1743082553.jpg` | **high** |

### G. Dreamix Toniс (p.21 + site)

- `BAVARIA-DREAMIX-INDIAN-TONIK-1000-PET` | Indian Tonic, 1 л, ПЭТ | Тоники | **21** | …/dreamix | `…/127_1775207748.png` (crop PET) | **high** | Also local dry-run `bavaria-dreamix-indian-tonik-1-l-pet.png`.

- `BAVARIA-DREAMIX-INDIAN-TONIK-330-GLASS` | Indian Tonic, 0,33 л, стекло | Тоники | **21** | …/dreamix | `…/127_1775207748.png` (crop glass) | **high** |

- `BAVARIA-DREAMIX-INDIAN-TONIK-330-CAN` | Indian Tonic, 0,33 л, банка | Тоники | **21** | …/dreamix | **none yet** on site | **med** | Site text omits can; PDF p.21 shows yellow Indian Tonic can — crop.

- `BAVARIA-DREAMIX-BITTER-LEMON-330-CAN` | Bitter Lemon, 0,33 л, банка | Тоники | **21** | …/dreamix | **none yet** on site (`128` is glass+PET only; siblings already use it) | **med** | PDF p.21 blue Bitter Lemon can — crop. Do not assign PET/glass shared shot as unique can if avoidable.

### H. Limnada Барбарис

- `BAVARIA-LIMNADA-BARBARIS-1500-PET` | Лимнада Барбарис, 1,5 л, ПЭТ | Газированные | (site) | …/silnogazirovannyj-napitok-limnada | `…/58_1718608488.jpg` (crop Барбарис) | **high** | Pink bottle in 4-pack; site assort lists Барбарис for 1,5.

- `BAVARIA-LIMNADA-BARBARIS-500-PET` | Лимнада Барбарис, 0,5 л, ПЭТ | Газированные | (site) | same | `…/68_1718376439.jpg` (crop Барбарис) | **high** | Right bottle in 0,5 trio.

### I. Mountea

- `BAVARIA-MOUNTEA-LESNYE-YAGODY-1500-PET` | … Лесные ягоды, 1,5 л, ПЭТ | Холодный чай | **24** | …/holodnyj-caj-mountea | `…/28_1758711718.png` (crop large purple) | **high** |

- `BAVARIA-MOUNTEA-LESNYE-YAGODY-500-PET` | … Лесные ягоды, 0,5 л, ПЭТ | Холодный чай | **24** | same | `…/28_1758711718.png` (crop small purple) | **high** | Sibling CAN already imaged.

- `BAVARIA-MOUNTEA-PERSIK-330-CAN` | … Персик, 0,33 л, банка | Холодный чай | **24** | same | `…/67_1758711780.png` (crop peach can) | **high** |

- `BAVARIA-MOUNTEA-LAYM-MYATA-1500-PET` | … Лайм-мята, 1,5 л, ПЭТ | Холодный чай | **24** | same | **none yet** | **med** | Not on site assort/photos. PDF p.24 green Лайм-мята — crop.

- `BAVARIA-MOUNTEA-LAYM-MYATA-500-PET` | … Лайм-мята, 0,5 л, ПЭТ | Холодный чай | **24** | same | **none yet** | **med** | PDF p.24 crop.

- `BAVARIA-MOUNTEA-LAYM-MYATA-330-CAN` | … Лайм-мята, 0,33 л, банка | Холодный чай | **24** | same | **none yet** | **med** | PDF p.24 crop.

### J. Rocket Ride (all 10)

Page: https://www.bavaria-group.ru/beer-product/vitaminnyj-napitok-rocket-ride · PDF **29**

| SKU | Taste | Candidate | Conf |
| --- | --- | --- | --- |
| `…-CLASSIC-450-CAN` / `…-CLASSIC-500-PET` | Classical | `…/105_1757076183.png` | **high** |
| `…-MANGO-APRICOT-450-CAN` / `…-MANGO-APRICOT-500-PET` | Манго Абрикос | `…/106_1757076512.png` | **high** |
| `…-KIVI-YABLOKO-450-CAN` / `…-KIVI-YABLOKO-500-PET` | Киви Яблоко | `…/107_1757076818.png` | **high** |
| `…-DIKIE-YAGODY-450-CAN` / `…-DIKIE-YAGODY-500-PET` | Дикие Ягоды | `…/108_1757077083.png` | **high** |
| `…-LAYM-LEMONGRAS-450-CAN` / `…-LAYM-LEMONGRAS-500-PET` | Лайм Лемонграсс | `…/109_1757077306.png` | **high** |

Each asset is CAN+PET pair — crop or use as-is per package.

---

## Manual review (5 SKUs — not in production)

| SKU | Evidence | Unique pack confirmed? | Recommendation |
| --- | --- | --- | --- |
| `BAVARIA-BAVARIYA-NORDISCH-NA-450-GLASS` | PDF p.11 bottle photo under 0% page; pack icon only CAN; site Nordisch is **alcoholic 5%** | **No** for retail glass NA (icon conflict) | **keep-manual** |
| `BAVARIA-BAVARIYA-APELSIN-450-GLASS` | PDF p.15 line icon GL 0,45; glass photos show Мохито/Питахайя/Тархун/Груша only — **no Апельсин glass** | **No** | **keep-manual** |
| `BAVARIA-BAVARIYA-KOLA-450-GLASS` | Same; no Кола glass photo on p.15 | **No** | **keep-manual** |
| `BAVARIA-BAVARIYA-YABLOKO-450-GLASS` | Same; Яблоко only as PET 1,5 on p.15 | **No** | **keep-manual** |
| `BAVARIA-TBAU-SPORT-MANUAL` | Site TBAU page lists «ТБАУ Sport» in assortment text only; no volume/pack matrix; PDF TBAU pages lack Sport matrix | **No** | **keep-manual** |

None of the five should be promoted to approved import without new unique pack evidence.

---

## Disputed / uncertain cases

1. **Gallagher NA vs site Gallagher lager (4%)** — same branding family; site pack is alcoholic. Do not attach site `103_…png` to NA SKUs.
2. **Nordisch NA vs site Nordisch (5%) / “Nordisch Bier Gallagher” lineup** — site `140_…jpeg` wrong ABV/line.
3. **Cola LE glass `92_…png`** — served from LE page but face text **CLASSIC**, not LIMITED EDITION.
4. **Cola LE 330 CAN** — no official LE can on product page; risk of mixing with Premium LE (`kola-limited-edition` / `65_…jpg`).
5. **Premium Виноград** — in PDF p.14, absent from current site Premium photos/text.
6. **Regular soda Яблоко 1,5** — PDF only; not in site 1,5 group shot.
7. **Mountea Лайм-мята** — PDF p.24 only; site still Персик / Лесные ягоды.
8. **Dreamix Toniс cans** — PDF p.21 only; site tonic page lists PET+glass only.
9. **Dobretsov Бочковой 1,42** — site bochkovoy page only advertises 2L.
10. **Elf CAN** — site has glass only; PDF has can art on p.11.
11. **Manifest `source_url` `…/kvas-dobretsov`** — **404**; correct slug `kvas-dobrecov`.

---

## Suggested next crop / download steps

### Priority A — download site assets & crop (fastest, high confidence)

1. **Rocket Ride** — download `105`–`109`; split CAN vs PET per SKU (10 SKUs).
2. **Dreamix soda** — download `98`,`100`,`101`,`102`; split three packs × four flavors (12 SKUs).
3. **Dreamix Indian** — download `127`; assign PET + glass; leave can for PDF.
4. **Mountea** — from `28` crop Лесные ягоды 1.5/0.5; from `67` crop Персик can.
5. **Cola LE PET** — from `91` crop 1.5 and 0.5.
6. **Limnada Барбарис** — crop pink bottle from `58` and `68`.
7. **Dobretsov Хлебный** — crop three packs from `76`; **Бочковой 2L** use `139`.
8. **Premium Вишня** — crop from `22` (glass) and `126` (PET).
9. **Regular Кола** — crop from `97` (0.5) and `95` (1.5).
10. **Elf CAN** — interim: reuse glass `55` **or** better crop can from PDF p.11.

### Priority B — PDF render crops (unique packs missing on site)

Use renders under  
`/workspace/artifacts/bavaria-import/2026-07-31T11-47-10-496Z-pdf-ingest/renders/`  
(or `renders-small/` for draft):

| Page | Crop targets |
| ---: | --- |
| **11** | Gallagher NA glass + can; Nordisch NA (bottle); Elf can; verify 0% stamp context |
| **13** | Any clearer Dobretsov 1,42 / Бочковой mid PET if distinct |
| **14** | Premium **Виноград** glass 0,5 + PET 1,2 |
| **15** | Glass Груша / Мохито / Питахайя / Тархун; PET **Яблоко** 1,5 |
| **18** | Cola LE glass (if LE-branded) + can 0,33 if present |
| **21** | Indian Tonic can; Bitter Lemon can |
| **24** | Лайм-мята × 1.5 / 0.5 / 0.33 |
| **29** | Fallback if any Rocket site PNG is incomplete |

### Priority C — do not automate without human OK

- Attach alcoholic Gallagher/Nordisch site images to NA SKUs  
- Cola CLASSIC glass → Cola LE  
- Promote any of the 5 manual SKUs  
- TBAU Sport without pack matrix  

### Local dry-run note

`/workspace/artifacts/bavaria-import/2026-07-31T10-52-18-371Z/images/` already has some related files (Elf glass, Dreamix Bitter/Indian, Mountea Персик/Лесные ягоды can, Dobretsov, Limnada groups, Premium Груша proxies) but **none of the 58 missing SKUs have non-empty `image_url` in the approved CSV** — site/PDF crops still need to be wired per SKU.

---

## Quick win estimate

| Action | SKUs closable |
| --- | ---: |
| Site download + crop (Rocket, Dreamix soda, Indian PET/GL, Mountea non-lime, Cola LE PET, Limnada, Dobretsov core, Premium Вишня, Кола PET) | **~40** |
| PDF crops (Premium Виноград, soda glass 4, Яблоко, Лайм-мята×3, Toniс cans×2, Elf can, Gallagher NA×2, Nordisch can, Cola LE glass/can, Bochkovoy 1.42) | **~18** |
| Remain blocked / manual | **5 manual + disputed edge cases** |
