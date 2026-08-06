-- WP-008 Phase A (BR-UOM-1xx): tenant-owned Unit of Measure reference data.
CREATE TYPE "UomKind" AS ENUM ('base', 'derived');

CREATE TABLE "UnitOfMeasure" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "kind" "UomKind" NOT NULL DEFAULT 'base',
    "precision" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnitOfMeasure_tenant_id_id_key" ON "UnitOfMeasure"("tenant_id", "id");
CREATE UNIQUE INDEX "UnitOfMeasure_tenant_id_code_key" ON "UnitOfMeasure"("tenant_id", "code");
CREATE INDEX "UnitOfMeasure_tenant_id_idx" ON "UnitOfMeasure"("tenant_id");
