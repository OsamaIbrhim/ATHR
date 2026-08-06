-- WP-008 Phase A (BR-TYP-1xx): item-type classification on ProductVariant.
-- Defaults every existing row to 'stocked' -- today's only real type -- so
-- this is a zero-behavior-change backfill, not a data migration requiring
-- a validation query.
CREATE TYPE "ItemType" AS ENUM ('stocked', 'non_stock', 'service', 'bundle_kit_placeholder');

ALTER TABLE "ProductVariant" ADD COLUMN "item_type" "ItemType" NOT NULL DEFAULT 'stocked';
ALTER TABLE "ProductVariant" ADD COLUMN "base_uom_id" UUID;

CREATE INDEX "ProductVariant_base_uom_id_idx" ON "ProductVariant"("base_uom_id");

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_tenant_id_base_uom_id_fkey" FOREIGN KEY ("tenant_id", "base_uom_id") REFERENCES "UnitOfMeasure"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
