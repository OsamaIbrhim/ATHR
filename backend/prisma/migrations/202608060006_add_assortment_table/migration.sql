-- WP-008 Phase A (BR-AST-1xx): per-Branch sellability/purchasability/
-- displayability, distinct from "Product"."is_active" (tenant-wide). Keyed
-- on "Branch" -- the operational root "InventoryStock"/"InventoryMovement"
-- already use -- not the not-yet-operationally-wired "Location" model.
CREATE TABLE "Assortment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "is_sellable" BOOLEAN NOT NULL DEFAULT true,
    "is_purchasable" BOOLEAN NOT NULL DEFAULT true,
    "is_displayable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assortment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Assortment_tenant_id_id_key" ON "Assortment"("tenant_id", "id");
CREATE UNIQUE INDEX "Assortment_tenant_id_branch_id_variant_id_key" ON "Assortment"("tenant_id", "branch_id", "variant_id");
CREATE INDEX "Assortment_tenant_id_idx" ON "Assortment"("tenant_id");
CREATE INDEX "Assortment_branch_id_idx" ON "Assortment"("branch_id");
CREATE INDEX "Assortment_variant_id_idx" ON "Assortment"("variant_id");

ALTER TABLE "Assortment" ADD CONSTRAINT "Assortment_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "Branch"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assortment" ADD CONSTRAINT "Assortment_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
