-- L1: stock adjustments (draft -> approved -> posted, or cancelled).
--
-- The DDL is what `prisma migrate diff` produces from schema.prisma; the
-- sequence, CHECKs and triggers at the end are hand-written (Prisma cannot
-- model them).

-- CreateEnum
CREATE TYPE "StockAdjustmentStatus" AS ENUM ('draft', 'approved', 'posted', 'cancelled');

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "adjustment_number" VARCHAR(40) NOT NULL,
    "status" "StockAdjustmentStatus" NOT NULL DEFAULT 'draft',
    "note" VARCHAR(300),
    "idempotency_key" VARCHAR(191),
    "command_fingerprint" VARCHAR(64),
    "created_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "posted_by" UUID,
    "posted_at" TIMESTAMP(3),
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentItem" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "qty_delta" DECIMAL(14,3) NOT NULL,
    "reason_code" VARCHAR(32) NOT NULL,
    "note" VARCHAR(300),
    "qty_before" DECIMAL(14,3),
    "qty_after" DECIMAL(14,3),
    "unit_cost" DECIMAL(14,4),
    "value" DECIMAL(14,2),

    CONSTRAINT "StockAdjustmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockAdjustment_tenant_id_status_created_at_idx" ON "StockAdjustment"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "StockAdjustment_tenant_id_branch_id_created_at_idx" ON "StockAdjustment"("tenant_id", "branch_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_tenant_id_id_key" ON "StockAdjustment"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_tenant_id_adjustment_number_key" ON "StockAdjustment"("tenant_id", "adjustment_number");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_tenant_id_idempotency_key_key" ON "StockAdjustment"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "StockAdjustmentItem_tenant_id_variant_id_idx" ON "StockAdjustmentItem"("tenant_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustmentItem_tenant_id_adjustment_id_variant_id_key" ON "StockAdjustmentItem"("tenant_id", "adjustment_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustmentItem_tenant_id_id_key" ON "StockAdjustmentItem"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "Branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "Warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_tenant_id_adjustment_id_fkey" FOREIGN KEY ("tenant_id", "adjustment_id") REFERENCES "StockAdjustment"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ======================================================================
-- Invariants Prisma cannot express
-- ======================================================================

CREATE SEQUENCE "StockAdjustmentNumberSequence" AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;

ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_qty_delta_nonzero" CHECK ("qty_delta" <> 0);

-- A document only moves forward: draft -> approved -> posted, and draft or
-- approved -> cancelled. Posted and cancelled documents never change again and
-- only a draft may be deleted.

CREATE FUNCTION protect_stock_adjustment_lifecycle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'Only a draft stock adjustment can be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" IN ('posted', 'cancelled') THEN
    RAISE EXCEPTION 'A % stock adjustment is immutable', OLD."status" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'draft' AND NEW."status" IN ('approved', 'cancelled'))
    OR (OLD."status" = 'approved' AND NEW."status" IN ('posted', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'A stock adjustment cannot move from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'approved' AND (
       NEW."branch_id" <> OLD."branch_id" OR NEW."warehouse_id" <> OLD."warehouse_id"
    OR NEW."adjustment_number" <> OLD."adjustment_number"
  ) THEN
    RAISE EXCEPTION 'An approved stock adjustment cannot change its site' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "StockAdjustment_lifecycle_guard"
  BEFORE UPDATE OR DELETE ON "StockAdjustment"
  FOR EACH ROW EXECUTE FUNCTION protect_stock_adjustment_lifecycle();

-- Lines change only while the document is a draft. Posting stamps the
-- quantities and value it applied (while the document is approved, before it
-- flips to posted); nothing else of an approved line may change.

CREATE FUNCTION protect_stock_adjustment_items() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  parent_status "StockAdjustmentStatus";
BEGIN
  SELECT "status" INTO parent_status FROM "StockAdjustment"
   WHERE "tenant_id" = OLD."tenant_id" AND "id" = OLD."adjustment_id";
  IF parent_status IS NULL OR parent_status = 'draft' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF parent_status = 'approved' AND TG_OP = 'UPDATE'
     AND NEW."variant_id" = OLD."variant_id" AND NEW."qty_delta" = OLD."qty_delta"
     AND NEW."reason_code" = OLD."reason_code" AND NEW."note" IS NOT DISTINCT FROM OLD."note" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The lines of a % stock adjustment are immutable', parent_status USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "StockAdjustmentItem_immutable_guard"
  BEFORE UPDATE OR DELETE ON "StockAdjustmentItem"
  FOR EACH ROW EXECUTE FUNCTION protect_stock_adjustment_items();
