# Миграция: витрина каталога (sales_status + nullable price)

Файл SQL: `prisma/migrations/20260727120000_catalog_showcase_sales_status/migration.sql`

## Что меняет

1. `products.price_amount` → **nullable** (отсутствие цены = `NULL`, не `0`)
2. `products.sales_status`: `showcase` | `on_request` | `orderable`
3. Таблица `product_interest_requests` для заявок «Интересует» / «Запросить цену»

## План заполнения существующих данных

| Условие | Действие |
|---|---|
| У товара `price_amount > 0` (текущие 12 seed/prod с ценой) | `sales_status = orderable` |
| `price_amount <= 0` (legacy) | `price_amount = NULL`, `sales_status = showcase` |
| Новые товары METRO без цены | `sales_status = showcase`, `price_amount = NULL`, `is_active = true`, `availability = on_order` |

Миграция сама:

- обнуляет legacy `<= 0` в `NULL`;
- ставит `orderable` всем с ценой `> 0`;
- новым строкам по умолчанию колонки — `showcase`.

## Откат (rollback)

**Не удалять** строки из `_prisma_migrations` вручную.

Варианты:

1. **Backup restore** (предпочтительно на production): восстановить dump, сделанный до `migrate deploy`.
2. **Обратная миграция** (отдельный SQL, только после согласования):

```sql
-- WARNING: destructive / lossy for interest requests
DROP TABLE IF EXISTS "product_interest_requests";

UPDATE "products" SET "price_amount" = 0 WHERE "price_amount" IS NULL;
ALTER TABLE "products" ALTER COLUMN "price_amount" SET DEFAULT 0;
ALTER TABLE "products" ALTER COLUMN "price_amount" SET NOT NULL;

ALTER TABLE "products" DROP COLUMN IF EXISTS "sales_status";
```

Затем зарегистрировать reverse migration отдельно — не править уже применённую.

## Production

**Не применять** без явного согласования:

```bash
# только после OK
npx prisma migrate deploy
```

Перед deploy: полный backup PostgreSQL и проверка, что файл не пустой.
