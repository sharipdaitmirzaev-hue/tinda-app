-- Public catalog pricing (approved clients only).
-- Adds product list prices and order money snapshots (Decimal).

ALTER TABLE "products"
  ADD COLUMN "price_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "price_currency" VARCHAR(3) NOT NULL DEFAULT 'RUB';

ALTER TABLE "order_items"
  ADD COLUMN "unit_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
  ADD COLUMN "line_total" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "orders"
  ADD COLUMN "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "delivery_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "total" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Seed wholesale prices for the 12 demo catalog SKUs (RUB per sale_unit).
UPDATE "products" SET "price_amount" = 240.00, "price_currency" = 'RUB' WHERE "sku" = 'W-001';
UPDATE "products" SET "price_amount" = 310.00, "price_currency" = 'RUB' WHERE "sku" = 'W-002';
UPDATE "products" SET "price_amount" = 360.00, "price_currency" = 'RUB' WHERE "sku" = 'W-003';
UPDATE "products" SET "price_amount" = 420.00, "price_currency" = 'RUB' WHERE "sku" = 'W-004';
UPDATE "products" SET "price_amount" = 780.00, "price_currency" = 'RUB' WHERE "sku" = 'J-001';
UPDATE "products" SET "price_amount" = 820.00, "price_currency" = 'RUB' WHERE "sku" = 'J-002';
UPDATE "products" SET "price_amount" = 540.00, "price_currency" = 'RUB' WHERE "sku" = 'J-003';
UPDATE "products" SET "price_amount" = 690.00, "price_currency" = 'RUB' WHERE "sku" = 'S-001';
UPDATE "products" SET "price_amount" = 560.00, "price_currency" = 'RUB' WHERE "sku" = 'S-002';
UPDATE "products" SET "price_amount" = 1450.00, "price_currency" = 'RUB' WHERE "sku" = 'E-001';
UPDATE "products" SET "price_amount" = 480.00, "price_currency" = 'RUB' WHERE "sku" = 'T-001';
UPDATE "products" SET "price_amount" = 390.00, "price_currency" = 'RUB' WHERE "sku" = 'K-001';
