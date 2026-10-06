-- L1: stock counts (count session, lines with the expected quantity at count time, scan entries).
--
-- The DDL is what `prisma migrate diff` produces from schema.prisma; the
-- sequence, CHECKs and the one-open-count index at the end are hand-written
-- (Prisma cannot model them).

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('open', 'posted', 'cancelled');

-- CreateEnum
CREATE TYPE "StockCountScope" AS ENUM ('all', 'category', 'product_type');

-- CreateTable
CREATE TABLE "StockCount" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "count_number" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'open',
    "scope_type" "StockCountScope" NOT NULL DEFAULT 'all',
    "category_id" UUID,
    "product_type_id" UUID,
    "scope_key" VARCHAR(40) NOT NULL,
    "idempotency_key" VARCHAR(191),
    "uncounted_choice" VARCHAR(10),
    "started_by" UUID,
    "posted_by" UUID,
    "posted_at" TIMESTAMP(3),
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "expected_qty" DECIMAL(14,3) NOT NULL,
    "counted_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "zeroed" BOOLEAN NOT NULL DEFAULT false,
    "applied_delta" DECIMAL(14,3),
    "unit_cost" DECIMAL(14,4),
    "first_counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountEntry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "entry_key" VARCHAR(100) NOT NULL,
    "variant_id" UUID,
    "barcode" VARCHAR(64),
    "qty_delta" DECIMAL(14,3) NOT NULL,
    "counted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockCount_tenant_id_status_created_at_idx" ON "StockCount"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "StockCount_tenant_id_warehouse_id_status_idx" ON "StockCount"("tenant_id", "warehouse_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_tenant_id_id_key" ON "StockCount"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_tenant_id_count_number_key" ON "StockCount"("tenant_id", "count_number");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_tenant_id_idempotency_key_key" ON "StockCount"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "StockCountLine_tenant_id_variant_id_idx" ON "StockCountLine"("tenant_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_tenant_id_count_id_variant_id_key" ON "StockCountLine"("tenant_id", "count_id", "variant_id");

-- CreateIndex
CREATE INDEX "StockCountEntry_tenant_id_count_id_variant_id_idx" ON "StockCountEntry"("tenant_id", "count_id", "variant_id");

-- CreateIndex
CREATE INDEX "StockCountEntry_tenant_id_count_id_counted_by_created_at_idx" ON "StockCountEntry"("tenant_id", "count_id", "counted_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountEntry_tenant_id_count_id_entry_key_key" ON "StockCountEntry"("tenant_id", "count_id", "entry_key");

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "Branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "Warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "Category"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_tenant_id_product_type_id_fkey" FOREIGN KEY ("tenant_id", "product_type_id") REFERENCES "ProductType"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_tenant_id_count_id_fkey" FOREIGN KEY ("tenant_id", "count_id") REFERENCES "StockCount"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountEntry" ADD CONSTRAINT "StockCountEntry_tenant_id_count_id_fkey" FOREIGN KEY ("tenant_id", "count_id") REFERENCES "StockCount"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountEntry" ADD CONSTRAINT "StockCountEntry_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ======================================================================
-- Invariants Prisma cannot express
-- ======================================================================

CREATE SEQUENCE "StockCountNumberSequence" AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;

-- The scope columns agree with the scope type.

ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_scope_consistent" CHECK (
     ("scope_type" = 'all'          AND "category_id" IS NULL     AND "product_type_id" IS NULL     AND "scope_key" = 'all')
  OR ("scope_type" = 'category'     AND "category_id" IS NOT NULL AND "product_type_id" IS NULL     AND "scope_key" = "category_id"::text)
  OR ("scope_type" = 'product_type' AND "category_id" IS NULL     AND "product_type_id" IS NOT NULL AND "scope_key" = "product_type_id"::text)
);

-- One open count per warehouse and scope. (Partial index: not expressible in
-- schema.prisma, which is why it is only declared here. The service also
-- refuses overlapping scopes, e.g. "all" while a category count is open.)

CREATE UNIQUE INDEX "StockCount_one_open_per_scope"
  ON "StockCount" ("tenant_id", "warehouse_id", "scope_key")
  WHERE "status" = 'open';

ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_counted_nonnegative" CHECK ("counted_qty" >= 0);
