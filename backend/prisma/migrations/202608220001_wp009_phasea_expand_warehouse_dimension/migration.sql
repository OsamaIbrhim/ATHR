-- WP-009 Phase A, PR1 (expand-only): adds the warehouse dimension to the
-- inventory storage layer without changing any identity/primary key and
-- without any application-code change. `InventoryStock`/`InventoryMovement`/
-- `InventoryCostMovement` all gain a NULLABLE `warehouse_id`, backfilled by
-- the next two migrations in this PR. `branch_id` is untouched on every
-- table -- it stays the primary key of `InventoryStock` and a required,
-- stored column everywhere else. See the WP-009 Phase A design report
-- (docs/wp/WP-009-inventory-and-stock.md) for why: every existing read path
-- keeps working unmodified through this PR, and the constrain step (dropping
-- the old `InventoryStock` primary key in favour of `(warehouse_id,
-- variant_id)`) ships in a later PR atomically with the application-code
-- cutover, because Prisma generates the compound-key `where` shape directly
-- from `@@id`/`@@unique` and the two cannot be split further.

-- `Warehouse` needs a `(tenant_id, id)` composite unique constraint to
-- support the same composite-FK pattern already used on `Branch` and
-- `ProductVariant`.
CREATE UNIQUE INDEX "Warehouse_tenant_id_id_key" ON "Warehouse"("tenant_id", "id");

-- AlterTable
ALTER TABLE "InventoryStock" ADD COLUMN "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "InventoryCostMovement" ADD COLUMN "warehouse_id" UUID;

-- AddForeignKey
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_tenant_id_warehouse_id_fkey"
  FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "Warehouse"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_tenant_id_warehouse_id_fkey"
  FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "Warehouse"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCostMovement" ADD CONSTRAINT "InventoryCostMovement_tenant_id_warehouse_id_fkey"
  FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "Warehouse"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- `InventoryStock`'s only index touching `branch_id` today comes from it
-- being the leading column of the primary key. That index is not going away
-- in this PR (the PK is untouched), but a later PR that drops it needs this
-- one already in place first -- `sync.service.ts`, `inventory.repository.ts`
-- and `reports.service.ts` all filter `InventoryStock` by `branch_id`
-- directly and must keep an index to filter against.
CREATE INDEX "InventoryStock_tenant_id_branch_id_idx" ON "InventoryStock"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "InventoryStock_tenant_id_warehouse_id_idx" ON "InventoryStock"("tenant_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "InventoryMovement_warehouse_id_variant_id_occurred_at_idx" ON "InventoryMovement"("warehouse_id", "variant_id", "occurred_at");
