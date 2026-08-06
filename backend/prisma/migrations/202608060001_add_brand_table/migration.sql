-- WP-008 Phase A (BR-CLS-103): Brand becomes an independent, archivable
-- entity instead of a free-text field on Product.
CREATE TABLE "Brand" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Brand_tenant_id_id_key" ON "Brand"("tenant_id", "id");
CREATE UNIQUE INDEX "Brand_tenant_id_name_key" ON "Brand"("tenant_id", "name");
CREATE INDEX "Brand_tenant_id_idx" ON "Brand"("tenant_id");
