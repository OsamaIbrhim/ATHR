-- WP-008 Phase C (BR §17, BR-TAX-200/201): the versioned tax model.
--
-- "TaxCategory" is what a Product carries (BR-TAX-201: "Product تحمل Tax
-- category لا معدلًا أبديًا"). "TaxCode" is the versioned rate that resolves
-- for a category at a point in time. Splitting them is what makes BR-TAX-203
-- ("تغير المعدل لا يغير الماضي") structurally possible: activating a new
-- version inserts a row, it never rewrites the row a document snapshotted.
--
-- Additive only -- no existing table is touched by this migration.

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('inclusive', 'exclusive');

-- CreateEnum
CREATE TYPE "TaxCalculationMethod" AS ENUM ('percentage');

-- CreateEnum
CREATE TYPE "TaxRoundingPolicy" AS ENUM ('line', 'document');

-- CreateEnum
CREATE TYPE "TaxCodeStatus" AS ENUM ('draft', 'submitted', 'approved', 'scheduled', 'active', 'superseded', 'archived');

-- CreateTable
CREATE TABLE "TaxCategory" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCode" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tax_category_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT 'EG',
    "calculation_method" "TaxCalculationMethod" NOT NULL DEFAULT 'percentage',
    "rate" DECIMAL(7,4) NOT NULL,
    "tax_mode" "TaxMode" NOT NULL,
    "rounding_policy" "TaxRoundingPolicy" NOT NULL DEFAULT 'line',
    "exemption_allowed" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "TaxCodeStatus" NOT NULL DEFAULT 'draft',
    "supersedes_id" UUID,
    "superseded_at" TIMESTAMP(3),
    "superseded_by_id" UUID,
    "created_by" UUID,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "scheduled_by" UUID,
    "scheduled_at" TIMESTAMP(3),
    "activated_by" UUID,
    "activated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxCategory_tenant_id_idx" ON "TaxCategory"("tenant_id");

-- CreateIndex
CREATE INDEX "TaxCategory_tenant_id_is_active_idx" ON "TaxCategory"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCategory_tenant_id_id_key" ON "TaxCategory"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCategory_tenant_id_code_key" ON "TaxCategory"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "TaxCode_tenant_id_idx" ON "TaxCode"("tenant_id");

-- CreateIndex
CREATE INDEX "TaxCode_tenant_id_status_idx" ON "TaxCode"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "TaxCode_tenant_id_tax_category_id_status_idx" ON "TaxCode"("tenant_id", "tax_category_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCode_tenant_id_id_key" ON "TaxCode"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCode_tenant_id_code_version_key" ON "TaxCode"("tenant_id", "code", "version");

-- AddForeignKey
ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_tenant_id_tax_category_id_fkey" FOREIGN KEY ("tenant_id", "tax_category_id") REFERENCES "TaxCategory"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "TaxCode"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BR-TAX-201/203: at most ONE active TaxCode per (tenant, tax category). This
-- is the invariant the whole phase rests on -- if two were active at once,
-- "which rate applies" would be a coin flip and the snapshot would record an
-- arbitrary winner.
--
-- Partial (WHERE status = 'active') for the same reason
-- "PriceBookEntry_one_active_per_scope_qty" is: a replacement version must be
-- draftable, approvable and schedulable *alongside* the version it will
-- replace. Only the activation is exclusive.
--
-- Expressed here rather than in schema.prisma because Prisma cannot model a
-- partial unique index (same as Phase B). "prisma migrate diff --exit-code"
-- in CI compares migrations-applied against migrations-applied, so a
-- migration-only index does not read as drift.
--
-- NOTE FOR ANY FUTURE CALLER: this index is NOT deferrable, so PostgreSQL
-- checks it per statement, not at COMMIT. "TaxCodeRepository.activate"
-- therefore demotes the incumbent BEFORE inserting/activating the successor.
-- Reversing those two statements raises P2002 even inside one transaction --
-- Phase B paid for this lesson once already.
CREATE UNIQUE INDEX "TaxCode_one_active_per_category"
  ON "TaxCode" ("tenant_id", "tax_category_id")
  WHERE "status" = 'active';
