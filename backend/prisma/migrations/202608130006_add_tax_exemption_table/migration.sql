-- WP-008 Phase C (BR-TAX-205) -- "Tax exemption تحتاج Evidence":
-- "تحفظ Customer/status/reason/reference/expiry عند الحاجة".
--
-- All three evidence columns ("reason", "evidence_reference",
-- "evidence_issued_at") are NOT NULL by design. An exemption without the
-- certificate it rests on is not an exemption, it is an untaxed sale with a
-- note attached -- so the schema makes the evidence part of what the row IS,
-- rather than leaving it to a validator that a future caller could bypass.

-- CreateEnum
CREATE TYPE "TaxExemptionStatus" AS ENUM ('pending', 'approved', 'rejected', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "TaxExemption" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "tax_category_id" UUID,
    "status" "TaxExemptionStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "evidence_reference" TEXT NOT NULL,
    "evidence_issued_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "applied_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "revoked_by" UUID,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxExemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxExemption_tenant_id_idx" ON "TaxExemption"("tenant_id");

-- CreateIndex
CREATE INDEX "TaxExemption_tenant_id_customer_id_status_idx" ON "TaxExemption"("tenant_id", "customer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxExemption_tenant_id_id_key" ON "TaxExemption"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "TaxExemption" ADD CONSTRAINT "TaxExemption_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "Customer"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxExemption" ADD CONSTRAINT "TaxExemption_tenant_id_tax_category_id_fkey" FOREIGN KEY ("tenant_id", "tax_category_id") REFERENCES "TaxCategory"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BR-TAX-205: at most one live (pending or approved) exemption per
-- (tenant, customer, category). Without this, two overlapping approved
-- exemptions would make "which evidence justified this zero" ambiguous on the
-- document -- which defeats the point of requiring evidence at all.
-- COALESCE collapses the tenant-wide (NULL category) case so two of those
-- cannot coexist either, same idiom Phase B used for "scope_ref_id".
CREATE UNIQUE INDEX "TaxExemption_one_live_per_customer_category"
  ON "TaxExemption" ("tenant_id", "customer_id", (COALESCE("tax_category_id", '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE "status" IN ('pending', 'approved');
