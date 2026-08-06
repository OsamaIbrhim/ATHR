-- WP-008 Phase A (BR-UOM-102): versioned, immutable-once-created UOM
-- conversions. No UPDATE path is ever exposed at the application layer --
-- only INSERT (first version) and a superseding INSERT (new version, plus
-- marking the previous row "superseded"). "factor" is enforced positive here
-- as a DB-level guard in addition to the application-level check.
CREATE TYPE "UomConversionStatus" AS ENUM ('active', 'superseded');

CREATE TABLE "UomConversion" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_uom_id" UUID NOT NULL,
    "to_uom_id" UUID NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "UomConversionStatus" NOT NULL DEFAULT 'active',
    "superseded_by_id" UUID,
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UomConversion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UomConversion_factor_positive" CHECK ("factor" > 0)
);

CREATE UNIQUE INDEX "UomConversion_tenant_id_id_key" ON "UomConversion"("tenant_id", "id");
CREATE UNIQUE INDEX "UomConversion_tenant_id_from_uom_id_to_uom_id_version_key" ON "UomConversion"("tenant_id", "from_uom_id", "to_uom_id", "version");
CREATE INDEX "UomConversion_tenant_id_idx" ON "UomConversion"("tenant_id");
CREATE INDEX "UomConversion_from_uom_id_idx" ON "UomConversion"("from_uom_id");
CREATE INDEX "UomConversion_to_uom_id_idx" ON "UomConversion"("to_uom_id");

ALTER TABLE "UomConversion" ADD CONSTRAINT "UomConversion_tenant_id_from_uom_id_fkey" FOREIGN KEY ("tenant_id", "from_uom_id") REFERENCES "UnitOfMeasure"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UomConversion" ADD CONSTRAINT "UomConversion_tenant_id_to_uom_id_fkey" FOREIGN KEY ("tenant_id", "to_uom_id") REFERENCES "UnitOfMeasure"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
