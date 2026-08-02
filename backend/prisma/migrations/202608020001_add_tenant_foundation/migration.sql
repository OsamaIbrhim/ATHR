-- WP-005 Phase B, MT-MIG-001 (expand-only): adds the Tenant/OrganizationProfile/
-- LegalEntity foundation tables. No existing table is touched.
--
-- Seeds exactly one Tenant row ("Initial ATHR Demo Tenant", Multi-tenancy
-- Blueprint §115) plus its OrganizationProfile and primary LegalEntity, using
-- fixed well-known IDs, directly in this migration (not only in the
-- standalone backend/prisma/seed/initial-tenant-seed.ts script) so that a
-- single unattended `prisma migrate deploy` run applying migrations 1-4 back
-- to back succeeds without a manual step in between — MT-MIG-002/003/004
-- below all require the Initial Tenant to already exist. The insert is
-- idempotent (guarded by WHERE NOT EXISTS) per BR-TPR-100; the standalone
-- seed script remains available as a no-op-if-already-seeded operational
-- tool and for test fixtures.
-- CreateEnum
CREATE TYPE "TenantAccessMode" AS ENUM ('provisioning', 'internal_demo', 'trial', 'active', 'payment_grace', 'read_only', 'restricted', 'suspended', 'closure_requested', 'closed', 'deletion_pending');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "access_mode" "TenantAccessMode" NOT NULL DEFAULT 'active',
    "default_locale" TEXT NOT NULL DEFAULT 'ar',
    "default_timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
    "default_currency" TEXT NOT NULL DEFAULT 'EGP',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationProfile" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationProfile_tenant_id_key" ON "OrganizationProfile"("tenant_id");

-- CreateIndex
CREATE INDEX "LegalEntity_tenant_id_idx" ON "LegalEntity"("tenant_id");

-- AddForeignKey
ALTER TABLE "OrganizationProfile" ADD CONSTRAINT "OrganizationProfile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: exactly one Tenant ("Initial ATHR Demo Tenant") with fixed, well-known
-- IDs, plus its OrganizationProfile and primary LegalEntity. Idempotent.
INSERT INTO "Tenant" ("id", "name", "updated_at")
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 'Initial ATHR Demo Tenant', now()
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant');

INSERT INTO "OrganizationProfile" ("id", "tenant_id", "display_name", "updated_at")
SELECT '00000000-0000-0000-0000-000000000002'::uuid, t."id", t."name", now()
FROM "Tenant" t
WHERE t."name" = 'Initial ATHR Demo Tenant'
  AND NOT EXISTS (SELECT 1 FROM "OrganizationProfile" op WHERE op."tenant_id" = t."id");

INSERT INTO "LegalEntity" ("id", "tenant_id", "legal_name", "is_primary", "updated_at")
SELECT '00000000-0000-0000-0000-000000000003'::uuid, t."id", t."name", true, now()
FROM "Tenant" t
WHERE t."name" = 'Initial ATHR Demo Tenant'
  AND NOT EXISTS (SELECT 1 FROM "LegalEntity" le WHERE le."tenant_id" = t."id");

