-- Showcase catalog: optional price + sales_status + product interest requests
-- Rollback plan: see docs/migrations/20260727120000_catalog_showcase_sales_status.md

-- 1) sales_status on products (default showcase for safety; backfill orderable below)
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "sales_status" VARCHAR(20) NOT NULL DEFAULT 'showcase';

-- 2) price_amount becomes nullable; 0 is not used as "no price"
ALTER TABLE "products"
  ALTER COLUMN "price_amount" DROP DEFAULT;

ALTER TABLE "products"
  ALTER COLUMN "price_amount" DROP NOT NULL;

-- Convert legacy zero prices to NULL (absence of price)
UPDATE "products"
SET "price_amount" = NULL
WHERE "price_amount" IS NOT NULL AND "price_amount" <= 0;

-- Existing priced products become orderable
UPDATE "products"
SET "sales_status" = 'orderable'
WHERE "price_amount" IS NOT NULL AND "price_amount" > 0;

CREATE INDEX IF NOT EXISTS "products_sales_status_idx" ON "products"("sales_status");
CREATE INDEX IF NOT EXISTS "products_is_active_sales_status_idx" ON "products"("is_active", "sales_status");

-- 3) Client interest / price request queue
CREATE TABLE IF NOT EXISTS "product_interest_requests" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "requested_qty" INTEGER,
  "request_type" VARCHAR(30) NOT NULL,
  "comment" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'new',
  "assigned_manager_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "product_interest_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_interest_requests_status_created_at_idx"
  ON "product_interest_requests"("status", "created_at");

CREATE INDEX IF NOT EXISTS "product_interest_requests_product_id_idx"
  ON "product_interest_requests"("product_id");

CREATE INDEX IF NOT EXISTS "product_interest_requests_client_id_idx"
  ON "product_interest_requests"("client_id");

CREATE INDEX IF NOT EXISTS "product_interest_requests_assigned_manager_id_idx"
  ON "product_interest_requests"("assigned_manager_id");

-- One open request per client+product+type (status new|contacted)
CREATE UNIQUE INDEX IF NOT EXISTS "product_interest_requests_open_uniq"
  ON "product_interest_requests"("client_id", "product_id", "request_type")
  WHERE "status" IN ('new', 'contacted');

ALTER TABLE "product_interest_requests"
  ADD CONSTRAINT "product_interest_requests_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_interest_requests"
  ADD CONSTRAINT "product_interest_requests_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_interest_requests"
  ADD CONSTRAINT "product_interest_requests_assigned_manager_id_fkey"
  FOREIGN KEY ("assigned_manager_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
