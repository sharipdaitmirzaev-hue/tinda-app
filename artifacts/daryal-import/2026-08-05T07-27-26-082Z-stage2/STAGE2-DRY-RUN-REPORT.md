# Daryal stage 2 dry-run report

**When:** 2026-08-05T07:27:40Z  
**Output:** `artifacts/daryal-import/2026-08-05T07-27-26-082Z-stage2`  
**Source:** https://darialgroup.ru only (no PDF / no third-party)

## Scope decisions (applied)
- Non-alcoholic only; beer / alcohol / unclear alcohol → rejected
- Official site only
- Cold tea / juice lines → import only with full SKU; else gaps
- Frutimix → manual, not in approved; volume/package not invented

## Dry-run summary

| Bucket | Count |
|--------|------:|
| **approved** | **22** |
| **manual** | **2** |
| **rejected** | **4** |
| Images prepared | **22** |
| SKUs without image | **0** |

### approved
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

### manual
- Фрутимикс Мультифрукт — missing_volume_or_package
- Фрутимикс Красный апельсин — missing_volume_or_package

### rejected
- Грейпфрут-малина — unclear_or_unconfirmed_sku
- Живое пиво /beer/ (все позиции) — alcoholic_excluded
- Холодный чай «ФИЕСТА» (малина) — insufficient_sku_data
- Сокосодержащие (кроме Фрутимикс manual) — insufficient_sku_data

## Categories
- Газированные напитки (`gazirovannye-napitki`)
- Минеральная вода (`voda-mineralnaya`)

Distribution: {'Газированные напитки': 16, 'Минеральная вода': 6}

## Gaps (missing lines + Frutimix)
- **cold_tea_fiesta** [gap_not_imported]: ФИЕСТА малина — только meta/описание, нет SKU (название+вкус+объём+тара+image) на официальном сайте
- **juice_other** [gap_not_imported]: Отдельных confirmed SKU нет; меню-ссылка закомментирована
- **frutimix_multifrukt** [manual]: Мультифрукт — вкус confirmed, объём/тара отсутствуют; не в approved
- **frutimix_krasnyy_apelsin** [manual]: Красный апельсин — вкус confirmed на сайте, объём/тара отсутствуют; не в approved
- **grapefruit_raspberry_comment** [rejected]: Грейпфрут-малина только в HTML comment
- **beer_all** [rejected]: Алкоголь — вне scope
- **no_pdf_price_photoshoot** [gap_source]: PDF/прайс/официальная фотосъёмка отсутствуют — использован только darialgroup.ru

## Apply policy (NOT executed)
- `sales_status=showcase`
- `price_amount=null` (schema-equivalent of «price=0 / not for sale»)
- `orderable=false`
- create-only; existing products not modified
- **production apply blocked** until explicit confirmation

## Production collision check
- Live API: **unreachable** from this agent (`tindamarket.ru TLS/TCP reset from this cloud agent`)
- Fallback: `offline_snapshot+bavaria_approved` (snapshot=176, universe=176)
- SKU collisions: **0**
- Soft same-flavor other-brand overlaps: 11 (informational only)

## Artifacts
- `approved-import-manifest.json`
- `approved-products.csv` / `.json`
- `manual-review.csv` / `rejected-products.csv` / `gaps-report.csv`
- `processed/*.webp` (22 files)
- `contact-sheet.jpg` / `contact-sheet.html`
- `production-collision-check.json`
- `verification-live.json`
