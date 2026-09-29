-- W1b: one site model (Branch + Warehouse), the InventoryService stock engine,
-- decimal quantities (14,3), unified money (14,2) and unit-cost (14,4) scales.
--
-- There is no production data (docs/ATHR_MASTER_PLAN.md D1). Where a change
-- cannot be mapped faithfully the old rows are reset: the cost ledger moves
-- from a global per-variant average to a per-warehouse average, so its rows
-- are truncated; InventoryStock.avg_cost is seeded from ProductVariant.cost_price.

-- ======================================================================
-- 1. Remove trigger-driven ledger writes and the PL/pgSQL ledger functions.
--    The TypeScript InventoryService is the only writer of stock and ledgers.
--    Append-only / immutability guard triggers stay.
-- ======================================================================
DROP TRIGGER "ReturnItem_cost_movement" ON "ReturnItem";
DROP TRIGGER "ReturnItem_inventory_movement" ON "ReturnItem";
DROP TRIGGER "TransferItem_inventory_and_transit_movements" ON "TransferItem";
DROP TRIGGER bold_inventory_sync_change ON "InventoryStock";
-- Postgres cannot change the type of a column named in a trigger definition.
DROP TRIGGER "ProductVariant_cost_ledger_guard" ON "ProductVariant";

DROP FUNCTION record_customer_return_cost_movements();
DROP FUNCTION record_return_inventory_movement();
DROP FUNCTION record_transfer_item_movements();
DROP FUNCTION record_inventory_movement;
DROP FUNCTION record_inventory_cost_movement;
DROP FUNCTION bold_emit_inventory_sync_change();

-- ======================================================================
-- 2. Site model: Warehouse belongs to Branch; Location is removed.
-- ======================================================================
ALTER TABLE "Warehouse" ADD COLUMN "branch_id" uuid;

-- Location.id == Branch.id by convention, so location_id already names the branch.
UPDATE "Warehouse" w
SET "branch_id" = w."location_id"
FROM "Branch" b
WHERE b."id" = w."location_id" AND b."tenant_id" = w."tenant_id";

-- At most one default warehouse per branch (keep the oldest).
UPDATE "Warehouse" w
SET "is_default" = false
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "branch_id" ORDER BY "created_at", "id") AS rn
  FROM "Warehouse"
  WHERE "is_default" AND "branch_id" IS NOT NULL
) ranked
WHERE ranked."id" = w."id" AND ranked.rn > 1;

-- Every branch gets a default warehouse.
INSERT INTO "Warehouse" ("id", "tenant_id", "branch_id", "name", "is_default", "created_at", "updated_at")
SELECT gen_random_uuid(), b."tenant_id", b."id", b."name_ar" || ' — Default Warehouse', true,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Branch" b
WHERE NOT EXISTS (
  SELECT 1 FROM "Warehouse" w WHERE w."branch_id" = b."id" AND w."is_default"
);

ALTER TABLE "Warehouse"
  DROP CONSTRAINT "Warehouse_location_id_fkey",
  DROP COLUMN "location_id",
  DROP COLUMN "is_centralized";

DROP TABLE "Location";

ALTER TABLE "Warehouse"
  ADD CONSTRAINT "Warehouse_tenant_id_branch_id_fkey"
  FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "Branch"("tenant_id", "id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX "Warehouse_branch_id_idx" ON "Warehouse" ("branch_id");

-- Exactly one default warehouse per branch. (Partial index: not expressible in
-- schema.prisma, which is why it is only declared here.)
CREATE UNIQUE INDEX "Warehouse_one_default_per_branch"
  ON "Warehouse" ("branch_id")
  WHERE "is_default" AND "branch_id" IS NOT NULL;

-- ======================================================================
-- 3. InventoryStock: key (warehouse_id, variant_id), decimal quantities,
--    moving weighted-average cost.
-- ======================================================================
UPDATE "InventoryStock" s
SET "warehouse_id" = w."id"
FROM "Warehouse" w
WHERE s."warehouse_id" IS NULL AND w."branch_id" = s."branch_id" AND w."is_default";

ALTER TABLE "InventoryStock"
  DROP CONSTRAINT "InventoryStock_pkey",
  DROP CONSTRAINT "InventoryStock_tenant_id_branch_id_fkey",
  ALTER COLUMN "warehouse_id" SET NOT NULL,
  DROP COLUMN "branch_id";

ALTER TABLE "InventoryStock"
  ADD CONSTRAINT "InventoryStock_pkey" PRIMARY KEY ("warehouse_id", "variant_id"),
  ALTER COLUMN "qty_on_hand" TYPE numeric(14,3),
  ALTER COLUMN "qty_reserved" TYPE numeric(14,3),
  ADD COLUMN "avg_cost" numeric(14,4) NOT NULL DEFAULT 0;

UPDATE "InventoryStock" s
SET "avg_cost" = v."cost_price"
FROM "ProductVariant" v
WHERE v."id" = s."variant_id";

DROP INDEX "InventoryStock_variant_id_idx";
DROP INDEX "InventoryStock_tenant_id_warehouse_id_idx";
CREATE INDEX "InventoryStock_tenant_id_variant_id_idx" ON "InventoryStock" ("tenant_id", "variant_id");

-- ======================================================================
-- 4. InventoryMovement: warehouse-only, decimal quantities, tenant-scoped
--    command idempotency (one command key, one row per variant).
-- ======================================================================
ALTER TABLE "InventoryMovement" DISABLE TRIGGER "InventoryMovement_append_only";
UPDATE "InventoryMovement" m
SET "warehouse_id" = w."id"
FROM "Warehouse" w
WHERE m."warehouse_id" IS NULL AND w."branch_id" = m."branch_id" AND w."is_default";
ALTER TABLE "InventoryMovement" ENABLE TRIGGER "InventoryMovement_append_only";

ALTER TABLE "InventoryMovement"
  DROP CONSTRAINT "InventoryMovement_tenant_id_branch_id_fkey",
  DROP CONSTRAINT "InventoryMovement_idempotency_key_key",
  ALTER COLUMN "warehouse_id" SET NOT NULL,
  DROP COLUMN "branch_id",
  ALTER COLUMN "on_hand_delta" TYPE numeric(14,3),
  ALTER COLUMN "reserved_delta" TYPE numeric(14,3),
  ALTER COLUMN "on_hand_after" TYPE numeric(14,3),
  ALTER COLUMN "reserved_after" TYPE numeric(14,3);

CREATE UNIQUE INDEX "InventoryMovement_tenant_id_idempotency_key_variant_id_key"
  ON "InventoryMovement" ("tenant_id", "idempotency_key", "variant_id");

-- ======================================================================
-- 5. InventoryCostMovement: per-warehouse average-cost audit log.
--    Old rows carry a global (all-branch) quantity and cannot be mapped.
-- ======================================================================
TRUNCATE TABLE "InventoryCostMovement";

ALTER TABLE "InventoryCostMovement"
  DROP CONSTRAINT "InventoryCostMovement_tenant_id_branch_id_fkey",
  DROP CONSTRAINT "InventoryCostMovement_quantity_consistency",
  DROP CONSTRAINT "InventoryCostMovement_type_direction",
  ALTER COLUMN "warehouse_id" SET NOT NULL,
  DROP COLUMN "branch_id",
  ALTER COLUMN "quantity_delta" TYPE numeric(14,3),
  ALTER COLUMN "global_quantity_before" TYPE numeric(14,3),
  ALTER COLUMN "global_quantity_after" TYPE numeric(14,3);

ALTER TABLE "InventoryCostMovement" RENAME COLUMN "global_quantity_before" TO "quantity_before";
ALTER TABLE "InventoryCostMovement" RENAME COLUMN "global_quantity_after" TO "quantity_after";

ALTER TABLE "InventoryCostMovement"
  ADD CONSTRAINT "InventoryCostMovement_quantity_consistency"
    CHECK (quantity_delta <> 0 AND quantity_before + quantity_delta = quantity_after),
  ADD CONSTRAINT "InventoryCostMovement_type_direction" CHECK (
    (movement_type IN ('opening_balance', 'purchase_receipt', 'customer_return')
       AND quantity_delta > 0 AND movement_value >= 0)
    OR (movement_type IN ('purchase_reversal', 'supplier_return')
       AND quantity_delta < 0 AND movement_value <= 0)
    OR movement_type = 'adjustment'
  );

DROP INDEX "InventoryCostMovement_idempotency_key_key";
CREATE UNIQUE INDEX "InventoryCostMovement_tenant_id_idempotency_key_variant_id_key"
  ON "InventoryCostMovement" ("tenant_id", "idempotency_key", "variant_id");
CREATE INDEX "InventoryCostMovement_warehouse_occurred_at_idx"
  ON "InventoryCostMovement" ("warehouse_id", "occurred_at");

-- ======================================================================
-- 6. Decimal quantities on documents and transit.
-- ======================================================================
ALTER TABLE "SalesInvoiceItem" ALTER COLUMN "qty" TYPE numeric(14,3);
ALTER TABLE "ReturnItem" ALTER COLUMN "qty" TYPE numeric(14,3);
ALTER TABLE "PurchaseInvoiceItem" ALTER COLUMN "qty" TYPE numeric(14,3);
ALTER TABLE "SupplierReturnItem" ALTER COLUMN "qty" TYPE numeric(14,3);

ALTER TABLE "TransferItem"
  ALTER COLUMN "qty" TYPE numeric(14,3),
  ALTER COLUMN "shipped_qty" TYPE numeric(14,3),
  ALTER COLUMN "received_qty" TYPE numeric(14,3),
  ALTER COLUMN "damaged_qty" TYPE numeric(14,3),
  ALTER COLUMN "missing_qty" TYPE numeric(14,3),
  ADD COLUMN "unit_cost" numeric(14,4);

ALTER TABLE "TransferTransitMovement"
  ALTER COLUMN "quantity_delta" TYPE numeric(14,3),
  ALTER COLUMN "in_transit_after" TYPE numeric(14,3);

-- Cost snapshots now live on InventoryCostMovement (per purchase line).
ALTER TABLE "PurchaseInvoiceItem"
  DROP CONSTRAINT "PurchaseInvoiceItem_cost_snapshot",
  DROP CONSTRAINT "PurchaseInvoiceItem_nonnegative_costs",
  DROP COLUMN "global_qty_before",
  DROP COLUMN "global_qty_after",
  DROP COLUMN "cost_before",
  DROP COLUMN "cost_after",
  ADD CONSTRAINT "PurchaseInvoiceItem_nonnegative_costs" CHECK (
    unit_cost >= 0
    AND (line_subtotal IS NULL OR line_subtotal >= 0)
    AND (allocated_discount IS NULL OR allocated_discount >= 0)
    AND (net_line_total IS NULL OR net_line_total >= 0)
    AND (net_unit_cost IS NULL OR net_unit_cost >= 0)
  );

-- ======================================================================
-- 7. Money (14,2) and unit-cost (14,4) scales.
-- ======================================================================
ALTER TABLE "CouponRedemption"
  ALTER COLUMN "amount_applied" TYPE numeric(14,2);

ALTER TABLE "Customer"
  ALTER COLUMN "total_spent" TYPE numeric(14,2);

ALTER TABLE "Discount"
  ALTER COLUMN "amount" TYPE numeric(14,2),
  ALTER COLUMN "base_price" TYPE numeric(14,2),
  ALTER COLUMN "final_price" TYPE numeric(14,2);

ALTER TABLE "InventoryCostMovement"
  ALTER COLUMN "unit_cost" TYPE numeric(14,4),
  ALTER COLUMN "cost_before" TYPE numeric(14,4),
  ALTER COLUMN "cost_after" TYPE numeric(14,4),
  ALTER COLUMN "inventory_value_before" TYPE numeric(14,2),
  ALTER COLUMN "movement_value" TYPE numeric(14,2),
  ALTER COLUMN "inventory_value_after" TYPE numeric(14,2),
  ALTER COLUMN "rounding_adjustment" TYPE numeric(14,2);

ALTER TABLE "OfferSuggestion"
  ALTER COLUMN "current_price" TYPE numeric(14,2),
  ALTER COLUMN "suggested_price" TYPE numeric(14,2),
  ALTER COLUMN "min_allowed_price" TYPE numeric(14,2);

ALTER TABLE "PriceBookEntry"
  ALTER COLUMN "unit_price" TYPE numeric(14,2),
  ALTER COLUMN "floor_price" TYPE numeric(14,2);

ALTER TABLE "PriceOverride"
  ALTER COLUMN "base_price" TYPE numeric(14,2),
  ALTER COLUMN "override_price" TYPE numeric(14,2),
  ALTER COLUMN "floor_price" TYPE numeric(14,2);

ALTER TABLE "PriceOverridePolicy"
  ALTER COLUMN "max_discount_amount" TYPE numeric(14,2);

ALTER TABLE "ProductVariant"
  ALTER COLUMN "cost_price" TYPE numeric(14,4);

ALTER TABLE "Promotion"
  ALTER COLUMN "max_discount_amount" TYPE numeric(14,2),
  ALTER COLUMN "min_spend" TYPE numeric(14,2);

ALTER TABLE "PurchaseInvoice"
  ALTER COLUMN "subtotal" TYPE numeric(14,2),
  ALTER COLUMN "discount_amount" TYPE numeric(14,2),
  ALTER COLUMN "total" TYPE numeric(14,2);

ALTER TABLE "PurchaseInvoiceItem"
  ALTER COLUMN "unit_cost" TYPE numeric(14,4),
  ALTER COLUMN "line_subtotal" TYPE numeric(14,2),
  ALTER COLUMN "allocated_discount" TYPE numeric(14,2),
  ALTER COLUMN "net_line_total" TYPE numeric(14,2),
  ALTER COLUMN "net_unit_cost" TYPE numeric(14,4);

ALTER TABLE "Return"
  ALTER COLUMN "refund_subtotal" TYPE numeric(14,2),
  ALTER COLUMN "refund_tax" TYPE numeric(14,2),
  ALTER COLUMN "refund_total" TYPE numeric(14,2);

ALTER TABLE "ReturnItem"
  ALTER COLUMN "unit_price" TYPE numeric(14,2),
  ALTER COLUMN "unit_cost" TYPE numeric(14,4),
  ALTER COLUMN "unit_tax" TYPE numeric(14,2);

ALTER TABLE "SalesInvoice"
  ALTER COLUMN "subtotal" TYPE numeric(14,2),
  ALTER COLUMN "discount_amount" TYPE numeric(14,2),
  ALTER COLUMN "tax_amount" TYPE numeric(14,2),
  ALTER COLUMN "total" TYPE numeric(14,2);

ALTER TABLE "SalesInvoiceItem"
  ALTER COLUMN "unit_price" TYPE numeric(14,2),
  ALTER COLUMN "unit_cost" TYPE numeric(14,4),
  ALTER COLUMN "unit_tax" TYPE numeric(14,2);

ALTER TABLE "SalesTaxSnapshot"
  ALTER COLUMN "base_amount" TYPE numeric(14,2),
  ALTER COLUMN "tax_amount" TYPE numeric(14,2);

ALTER TABLE "SellerCommissionOverride"
  ALTER COLUMN "target" TYPE numeric(14,2),
  ALTER COLUMN "bonus" TYPE numeric(14,2);

ALTER TABLE "SellerCommissionPeriod"
  ALTER COLUMN "default_target" TYPE numeric(14,2),
  ALTER COLUMN "default_bonus" TYPE numeric(14,2);

ALTER TABLE "SellerCommissionPeriodRow"
  ALTER COLUMN "gross_sales_before_tax" TYPE numeric(14,2),
  ALTER COLUMN "returns_before_tax" TYPE numeric(14,2),
  ALTER COLUMN "net_sales_before_tax" TYPE numeric(14,2),
  ALTER COLUMN "percentage_commission" TYPE numeric(14,2),
  ALTER COLUMN "target" TYPE numeric(14,2),
  ALTER COLUMN "target_bonus" TYPE numeric(14,2),
  ALTER COLUMN "estimated_total" TYPE numeric(14,2);

ALTER TABLE "SellerCommissionSettings"
  ALTER COLUMN "default_target" TYPE numeric(14,2),
  ALTER COLUMN "default_bonus" TYPE numeric(14,2);

ALTER TABLE "Shift"
  ALTER COLUMN "opening_cash" TYPE numeric(14,2),
  ALTER COLUMN "closing_cash" TYPE numeric(14,2),
  ALTER COLUMN "expected_cash" TYPE numeric(14,2),
  ALTER COLUMN "difference" TYPE numeric(14,2);

ALTER TABLE "SupplierReturn"
  ALTER COLUMN "credit_total" TYPE numeric(14,2),
  ALTER COLUMN "inventory_value_removed" TYPE numeric(14,2),
  ALTER COLUMN "purchase_price_variance" TYPE numeric(14,2);

ALTER TABLE "SupplierReturnItem"
  ALTER COLUMN "credit_unit_cost" TYPE numeric(14,4),
  ALTER COLUMN "credit_total" TYPE numeric(14,2),
  ALTER COLUMN "inventory_unit_cost" TYPE numeric(14,4),
  ALTER COLUMN "inventory_value_removed" TYPE numeric(14,2),
  ALTER COLUMN "purchase_price_variance" TYPE numeric(14,2);


CREATE TRIGGER "ProductVariant_cost_ledger_guard"
  BEFORE UPDATE OF cost_price ON "ProductVariant"
  FOR EACH ROW EXECUTE FUNCTION protect_product_variant_cost();

-- ======================================================================
-- 8. Idempotency keys are tenant-scoped.
-- ======================================================================
DROP INDEX "PurchaseInvoice_idempotency_key_key";
DROP INDEX "PurchaseInvoice_reversal_idempotency_key_key";
DROP INDEX "SupplierReturn_idempotency_key_key";
ALTER TABLE "TransferCommand" DROP CONSTRAINT "TransferCommand_idempotency_key_key";
ALTER TABLE "TransferTransitMovement" DROP CONSTRAINT "TransferTransitMovement_idempotency_key_key";

CREATE UNIQUE INDEX "PurchaseInvoice_tenant_id_idempotency_key_key"
  ON "PurchaseInvoice" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "PurchaseInvoice_tenant_id_reversal_idempotency_key_key"
  ON "PurchaseInvoice" ("tenant_id", "reversal_idempotency_key");
CREATE UNIQUE INDEX "SupplierReturn_tenant_id_idempotency_key_key"
  ON "SupplierReturn" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "TransferCommand_tenant_id_idempotency_key_key"
  ON "TransferCommand" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "TransferTransitMovement_tenant_id_idempotency_key_key"
  ON "TransferTransitMovement" ("tenant_id", "idempotency_key");

-- ======================================================================
-- 9. Seller commission settings: one row per tenant (was a global id = 1).
-- ======================================================================
ALTER TABLE "SellerCommissionSettings"
  DROP CONSTRAINT "SellerCommissionSettings_singleton_check",
  DROP CONSTRAINT "SellerCommissionSettings_pkey";
DROP INDEX "SellerCommissionSettings_tenant_id_idx";
ALTER TABLE "SellerCommissionSettings" DROP COLUMN "id";
ALTER TABLE "SellerCommissionSettings"
  ADD CONSTRAINT "SellerCommissionSettings_pkey" PRIMARY KEY ("tenant_id");

-- ======================================================================
-- 10. POS sync: stock changes are announced to the branch whose default
--     warehouse changed. Statement-level (one SyncChange insert per statement
--     however many rows change) and only when a quantity actually changed.
-- ======================================================================
CREATE FUNCTION bold_emit_inventory_sync_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
    SELECT 'inventory', w."branch_id", n."variant_id"::text, CURRENT_TIMESTAMP, n."tenant_id"
    FROM new_rows n
    JOIN "Warehouse" w ON w."id" = n."warehouse_id"
    WHERE w."is_default" AND w."branch_id" IS NOT NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
    SELECT 'inventory', w."branch_id", n."variant_id"::text, CURRENT_TIMESTAMP, n."tenant_id"
    FROM new_rows n
    JOIN old_rows o ON o."warehouse_id" = n."warehouse_id" AND o."variant_id" = n."variant_id"
    JOIN "Warehouse" w ON w."id" = n."warehouse_id"
    WHERE w."is_default" AND w."branch_id" IS NOT NULL
      AND (n."qty_on_hand" IS DISTINCT FROM o."qty_on_hand"
        OR n."qty_reserved" IS DISTINCT FROM o."qty_reserved");
  ELSE
    INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
    SELECT 'inventory', w."branch_id", o."variant_id"::text, CURRENT_TIMESTAMP, o."tenant_id"
    FROM old_rows o
    JOIN "Warehouse" w ON w."id" = o."warehouse_id"
    WHERE w."is_default" AND w."branch_id" IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER bold_inventory_sync_insert AFTER INSERT ON "InventoryStock"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION bold_emit_inventory_sync_change();
CREATE TRIGGER bold_inventory_sync_update AFTER UPDATE ON "InventoryStock"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION bold_emit_inventory_sync_change();
CREATE TRIGGER bold_inventory_sync_delete AFTER DELETE ON "InventoryStock"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION bold_emit_inventory_sync_change();
