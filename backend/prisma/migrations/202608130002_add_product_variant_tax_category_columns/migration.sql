-- WP-008 Phase C -- EXPAND step (CLAUDE.md §6: expand -> backfill -> validate
-- -> constrain).
--
-- OD-CAT-014: "Default tax category على Product مع Override مصرح على Variant".
--
--   "Product"."tax_category_id"        -> the default. Ends up NOT NULL, but
--                                         is added nullable here so existing
--                                         rows survive; "202608130003"
--                                         backfills it and "202608130004"
--                                         applies the constraint.
--   "ProductVariant"."tax_category_id" -> the override. Stays nullable
--                                         permanently: NULL means "inherit
--                                         the Product's category", which is
--                                         the only way to tell an override
--                                         from a restatement of the default.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "tax_category_id" UUID;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "tax_category_id" UUID;

-- CreateIndex
CREATE INDEX "Product_tenant_id_tax_category_id_idx" ON "Product"("tenant_id", "tax_category_id");

-- CreateIndex
CREATE INDEX "ProductVariant_tenant_id_tax_category_id_idx" ON "ProductVariant"("tenant_id", "tax_category_id");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenant_id_tax_category_id_fkey" FOREIGN KEY ("tenant_id", "tax_category_id") REFERENCES "TaxCategory"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_tenant_id_tax_category_id_fkey" FOREIGN KEY ("tenant_id", "tax_category_id") REFERENCES "TaxCategory"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
