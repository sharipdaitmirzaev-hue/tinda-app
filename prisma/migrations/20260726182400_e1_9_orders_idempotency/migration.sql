-- CreateTable
CREATE TABLE "order_number_counters" (
    "date_key" VARCHAR(8) NOT NULL,
    "last_seq" INTEGER NOT NULL,

    CONSTRAINT "order_number_counters_pkey" PRIMARY KEY ("date_key")
);

-- CreateTable
CREATE TABLE "order_idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "order_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_idempotency_keys_order_id_idx" ON "order_idempotency_keys"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_idempotency_keys_user_id_key_key" ON "order_idempotency_keys"("user_id", "key");

-- AddForeignKey
ALTER TABLE "order_idempotency_keys" ADD CONSTRAINT "order_idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_idempotency_keys" ADD CONSTRAINT "order_idempotency_keys_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
