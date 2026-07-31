# APPLY PRODUCTION — BLOCKED (ожидает DATABASE_URL)

Дата: 2026-07-31  
PR: https://github.com/sharipdaitmirzaev-hue/tinda-app/pull/18  
Manifest: `artifacts/bavaria-import/latest-pdf-reviewed/approved-import-manifest.json`

## Этап 1 — финальная проверка manifest

**PASSED** (`npm run import:bavaria:preflight` → issues: [])

| Проверка | Результат |
|----------|-----------|
| Approved = 164, уникальные SKU | OK |
| Название / бренд / категория / объём / тара / source URL | OK |
| Изображение или `shared-line-image` | OK (часть URL обогащена из dry-run) |
| Нет Nordisch стекло / Апельсин·Кола·Яблоко стекло 0,45 / TBAU Sport | OK |
| Нет rejected / wholesale kegs | OK |
| Безалкогольное пиво = 7 | OK |
| Добрецовъ mid PET = 1,42 л | OK |
| SWIPE 33 л отсутствует | OK |
| SKU collisions | 0 |
| CSV ↔ manifest SKU set идемпотентен | OK |
| PDF 40 стр, SHA-256 `e93756ed…436da93` | OK |

## Этап 2–4 — backup / apply / post-check

**BLOCKED:** в среде cloud-агента `DATABASE_URL` **не задан**.

- Production API `https://tindamarket.ru/api/v1/health` → `{"ok":true,"database":"ok"}` (457 товаров).
- Поиск `q=BAVARIA` → 0 SKU (импорт ещё не выполнялся).
- `pg_dump` / Prisma apply из этой среды невозможны без connection string.
- Apply-гейты проверены: без `DATABASE_URL` команда завершается `APPLY BLOCKED`.

### Команда для VPS / среды с DATABASE_URL

```bash
mkdir -p backups
STAMP=$(date -u +%Y%m%d-%H%M%S)
pg_dump "$DATABASE_URL" --no-owner --format=plain > "backups/tinda-${STAMP}.sql"
# проверить size>0 и читаемость, затем:
sha256sum "backups/tinda-${STAMP}.sql"

npm run import:bavaria:preflight
npm run import:bavaria:apply -- \
  --i-understand-and-have-backup \
  --backup-path="backups/tinda-${STAMP}.sql" \
  --manifest="artifacts/bavaria-import/latest-pdf-reviewed/approved-import-manifest.json"
```

Не использовать `--merge`.

Apply создаёт только новые SKU:

- `sales_status=showcase`
- `price_amount=null`
- `availability=on_order` (остаток не утверждается)
- `is_active=true`
- заказ недоступен без `orderable` + цены
- локальная загрузка изображений в `/uploads/products/...` при наличии URL/файла
- fingerprint существующих товаров до/после (редактирование запрещено)

## Этап 5 — проверки проекта

См. финальный отчёт после прогона lint/typecheck/test/build в этом же коммите.

## Что нужно от оператора

Передать cloud-агенту секрет **`DATABASE_URL`** production (или выполнить backup+apply на VPS по команде выше) и повторить запрос на apply.
