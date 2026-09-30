-- W2b-1: serial / batch tracking (docs/design/W2b-tracking.md sections 1-2).
--
-- ProductVariant.tracking (default none) plus three tables:
--   InventoryBatch        stock of a batch-tracked variant per warehouse and batch;
--                         batch_no = '' is the "unallocated" row, the only one
--                         allowed to go negative
--   InventorySerial       one row per serial number and its status
--   InventoryLotMovement  append-only: which batch / serial each stock movement moved
-- The DDL below is what `prisma migrate diff` produces from schema.prisma; the
-- CHECK constraints and the append-only trigger at the end are hand-written
-- (Prisma cannot model them).

CREATE TYPE "TrackingMode" AS ENUM ('none', 'serial', 'batch');

CREATE TYPE "SerialStatus" AS ENUM ('in_stock', 'sold', 'in_transit', 'returned_to_supplier');

ALTER TABLE "ProductVariant" ADD COLUMN     "tracking" "TrackingMode" NOT NULL DEFAULT 'none';

CREATE TABLE "InventoryBatch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_no" VARCHAR(100) NOT NULL,
    "expiry_date" DATE,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventorySerial" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "serial" VARCHAR(191) NOT NULL,
    "warehouse_id" UUID,
    "status" "SerialStatus" NOT NULL DEFAULT 'in_stock',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventorySerial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryLotMovement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "movement_id" UUID NOT NULL,
    "batch_id" UUID,
    "serial_id" UUID,
    "qty_delta" DECIMAL(14,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLotMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryBatch_fefo_idx" ON "InventoryBatch"("tenant_id", "warehouse_id", "variant_id", "expiry_date");

CREATE UNIQUE INDEX "InventoryBatch_tenant_id_warehouse_id_variant_id_batch_no_key" ON "InventoryBatch"("tenant_id", "warehouse_id", "variant_id", "batch_no");

CREATE UNIQUE INDEX "InventoryBatch_tenant_id_id_key" ON "InventoryBatch"("tenant_id", "id");

CREATE INDEX "InventorySerial_stock_idx" ON "InventorySerial"("tenant_id", "warehouse_id", "variant_id", "status");

CREATE UNIQUE INDEX "InventorySerial_tenant_id_variant_id_serial_key" ON "InventorySerial"("tenant_id", "variant_id", "serial");

CREATE UNIQUE INDEX "InventorySerial_tenant_id_id_key" ON "InventorySerial"("tenant_id", "id");

CREATE INDEX "InventoryLotMovement_tenant_id_movement_id_idx" ON "InventoryLotMovement"("tenant_id", "movement_id");

CREATE INDEX "InventoryLotMovement_tenant_id_batch_id_idx" ON "InventoryLotMovement"("tenant_id", "batch_id");

CREATE INDEX "InventoryLotMovement_tenant_id_serial_id_idx" ON "InventoryLotMovement"("tenant_id", "serial_id");

ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "Warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventorySerial" ADD CONSTRAINT "InventorySerial_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventorySerial" ADD CONSTRAINT "InventorySerial_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "Warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryLotMovement" ADD CONSTRAINT "InventoryLotMovement_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryLotMovement" ADD CONSTRAINT "InventoryLotMovement_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "InventoryBatch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryLotMovement" ADD CONSTRAINT "InventoryLotMovement_tenant_id_serial_id_fkey" FOREIGN KEY ("tenant_id", "serial_id") REFERENCES "InventorySerial"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ======================================================================
-- Invariants Prisma cannot express
-- ======================================================================

-- Only the unallocated row may be negative: a sale that finds too few batches
-- to draw on is recorded there instead of being refused.

ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_qty_nonnegative_unless_unallocated"
  CHECK ("qty" >= 0 OR "batch_no" = '');

-- A serial is in a warehouse exactly while it is in stock.

ALTER TABLE "InventorySerial" ADD CONSTRAINT "InventorySerial_warehouse_iff_in_stock"
  CHECK (("status" = 'in_stock') = ("warehouse_id" IS NOT NULL));

-- A lot movement names exactly one batch or one serial; a serial moves one unit.

ALTER TABLE "InventoryLotMovement" ADD CONSTRAINT "InventoryLotMovement_one_lot"
  CHECK (("batch_id" IS NULL) <> ("serial_id" IS NULL));

ALTER TABLE "InventoryLotMovement" ADD CONSTRAINT "InventoryLotMovement_qty_delta_valid"
  CHECK ("qty_delta" <> 0 AND ("serial_id" IS NULL OR "qty_delta" IN (1, -1)));

-- Same protection as the stock ledger: corrections are new movements.

CREATE FUNCTION protect_inventory_lot_movement_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF current_setting('bold.inventory_ledger_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'InventoryLotMovement is append-only; create a reversal movement instead';
END
$$;

CREATE TRIGGER "InventoryLotMovement_append_only" BEFORE DELETE OR UPDATE ON "InventoryLotMovement"
  FOR EACH ROW EXECUTE FUNCTION protect_inventory_lot_movement_append_only();
