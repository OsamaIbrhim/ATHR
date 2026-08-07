-- WP-008 Phase B (BR-PRB-1xx): tenant-owned, single-currency Price Book with
-- a draft -> submit -> approve -> schedule -> activate -> end lifecycle
-- (Permission Matrix §17). "scope"/"scope_ref_id" model which book applies;
-- only "tenant_default" scope selection is wired into "PricingService" this
-- phase (see the Phase B PR description).
CREATE TYPE "PriceBookScope" AS ENUM ('tenant_default', 'location', 'customer_group', 'contract', 'wholesale');
CREATE TYPE "PriceBookStatus" AS ENUM ('draft', 'submitted', 'approved', 'scheduled', 'active', 'ended', 'archived');

CREATE TABLE "PriceBook" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "scope" "PriceBookScope" NOT NULL DEFAULT 'tenant_default',
    "scope_ref_id" UUID,
    "status" "PriceBookStatus" NOT NULL DEFAULT 'draft',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "created_by" UUID,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "scheduled_by" UUID,
    "scheduled_at" TIMESTAMP(3),
    "activated_by" UUID,
    "activated_at" TIMESTAMP(3),
    "ended_by" UUID,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceBook_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PriceBook_tenant_id_id_key" ON "PriceBook"("tenant_id", "id");
CREATE INDEX "PriceBook_tenant_id_idx" ON "PriceBook"("tenant_id");
CREATE INDEX "PriceBook_tenant_id_status_idx" ON "PriceBook"("tenant_id", "status");

-- BR-PRB-104: one default book per (currency, scope, scope_ref_id). NULLs in
-- "scope_ref_id" are collapsed via COALESCE so multiple tenant-wide default
-- books (scope_ref_id IS NULL) can't coexist either -- Postgres otherwise
-- treats NULL <> NULL under a plain unique index.
CREATE UNIQUE INDEX "PriceBook_one_default_per_scope" ON "PriceBook"(
    "tenant_id",
    "currency",
    "scope",
    COALESCE("scope_ref_id", '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE "is_default" = true;
