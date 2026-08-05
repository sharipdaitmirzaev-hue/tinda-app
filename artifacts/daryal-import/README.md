# Импорт производителя «Дарьял»

Отдельный pipeline (как Bavaria), **не** универсальный импортёр.

## Scope (зафиксировано)

См. `SCOPE-DECISIONS.md`:

1. Только безалкогольное (пиво / алкоголь / неясный статус — out)
2. Источник: только https://darialgroup.ru (PDF/прайс/фотосъёмки нет)
3. Холодный чай / сокосодержащие — только full SKU на сайте, иначе gaps
4. Фрутимикс — manual; объём/тару не додумывать; не в approved

## Stage 1

1. Source scout → `SOURCE-SCOUT-REPORT.md`
2. `npm run import:daryal:discover` → `latest-discover/`
3. `npm run import:daryal:dry-run` → `latest-dry-run/` (22 ready / 2 manual)

## Stage 2 (этот PR)

```bash
npm run import:daryal:stage2
```

Результат: `latest-stage2/`

| Bucket | Count |
|--------|------:|
| approved | **22** |
| manual (Фрутимикс) | **2** |
| rejected | 4 |
| single-pack images | **22** |
| SKUs without image | **0** |

Категории approved: `Газированные напитки`, `Минеральная вода`.

Apply policy (в manifest, **не выполнялся**):

- `sales_status=showcase`
- `price_amount=null` (эквивалент «price=0 / не для заказа» в схеме каталога)
- `orderable=false`
- create-only; существующие товары не менять

## Commands

```bash
npm run import:daryal:discover
npm run import:daryal:dry-run
npm run import:daryal:stage2
npm run import:daryal:apply   # blocked until explicit confirmation
```

## Artifacts

- `latest-discover/` — live HTML extract
- `latest-dry-run/` — stage 1 proposed
- `latest-stage2/` — approved-import-manifest, processed images, contact sheet, gaps, collision check
- production collision: live `q=SKU` probes against tindamarket.ru catalog (0 hits) + offline soft-overlap universe

## Production apply (2026-08-05)

See `production-apply-2026-08-05/PRODUCTION-APPLY-REPORT.md` — **22 created**, idempotent re-apply OK.
