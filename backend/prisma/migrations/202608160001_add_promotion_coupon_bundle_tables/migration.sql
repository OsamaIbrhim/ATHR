-- WP-008 Phase D (BR §20-25, OD-CAT-007/008/009 -- BR doc §35 numbering; the
-- WP document and Task brief cite these as OD-CAT-008/009/010, see the Phase
-- D PR description for the off-by-one discrepancy).
--
-- Additive only -- no existing table is touched by this migration.
--
-- DELIBERATE GAP, closed by the next migration
-- (202608160002_add_promotion_coupon_uniqueness_constraints): the two
-- BR-CPN-201/BR-CPN-204 uniqueness invariants below
-- ("Coupon_tenant_id_code_normalized_idx", "CouponRedemption_..._idempotency_
-- key_idx") are created here as ordinary, non-unique indexes on purpose, then
-- promoted to UNIQUE in the follow-up migration. This lets
-- "verify-promotion-behaviour.cjs" be observed genuinely failing (RED)
-- against the schema state this migration alone produces, then genuinely
-- passing (GREEN) once the follow-up migration lands -- see that script and
-- the Phase D PR description for both CI run SHAs. Both migrations are
-- forward-only; neither edits the other.

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('draft', 'scheduled', 'active', 'paused', 'ended', 'cancelled', 'archived');

-- CreateEnum
CREATE TYPE "PromotionBenefitType" AS ENUM ('percentage', 'fixed_amount', 'fixed_price', 'bogo');

-- CreateEnum
CREATE TYPE "PromotionStackability" AS ENUM ('exclusive', 'stackable_group', 'stackable_manual');

-- CreateEnum
CREATE TYPE "PromotionScopeType" AS ENUM ('variant', 'product', 'brand', 'category', 'all');

-- CreateEnum
CREATE TYPE "PromotionMinSpendBasis" AS ENUM ('before_tax', 'after_tax');

-- CreateEnum
CREATE TYPE "PromotionReturnPolicy" AS ENUM ('line_prorated', 'whole_promotion_only');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('public', 'single_use', 'customer_bound');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "BundleStatus" AS ENUM ('draft', 'active', 'ended');

-- CreateEnum
CREATE TYPE "BundleAllocationMethod" AS ENUM ('proportional_price');

-- CreateEnum
CREATE TYPE "BundleReturnPolicy" AS ENUM ('whole_bundle_only', 'component_prorated');

-- CreateTable
CREATE TABLE "Promotion" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'draft',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "stackability" "PromotionStackability" NOT NULL DEFAULT 'exclusive',
    "stack_group" TEXT,
    "benefit_type" "PromotionBenefitType" NOT NULL,
    "benefit_value" DECIMAL(12,4),
    "bogo_buy_qty" INTEGER,
    "bogo_get_qty" INTEGER,
    "bogo_get_discount_percent" DECIMAL(5,2),
    "max_discount_amount" DECIMAL(12,2),
    "max_units_per_order" INTEGER,
    "max_uses_per_customer" INTEGER,
    "scope_type" "PromotionScopeType" NOT NULL DEFAULT 'all',
    "scope_id" UUID,
    "min_qty" DECIMAL(12,3),
    "min_spend" DECIMAL(12,2),
    "min_spend_basis" "PromotionMinSpendBasis",
    "branch_id" UUID,
    "customer_id" UUID,
    "requires_coupon" BOOLEAN NOT NULL DEFAULT false,
    "return_policy" "PromotionReturnPolicy",
    "created_by" UUID,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "scheduled_by" UUID,
    "scheduled_at" TIMESTAMP(3),
    "activated_by" UUID,
    "activated_at" TIMESTAMP(3),
    "paused_by" UUID,
    "paused_at" TIMESTAMP(3),
    "resumed_by" UUID,
    "resumed_at" TIMESTAMP(3),
    "ended_by" UUID,
    "ended_at" TIMESTAMP(3),
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "code_normalized" TEXT NOT NULL,
    "code_display" TEXT NOT NULL,
    "type" "CouponType" NOT NULL DEFAULT 'public',
    "status" "CouponStatus" NOT NULL DEFAULT 'active',
    "customer_id" UUID,
    "max_total_uses" INTEGER,
    "max_uses_per_customer" INTEGER,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "customer_id" UUID,
    "amount_applied" DECIMAL(12,2),
    "redeemed_by" UUID,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bundle" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BundleStatus" NOT NULL DEFAULT 'draft',
    "allocation_method" "BundleAllocationMethod" NOT NULL DEFAULT 'proportional_price',
    "return_policy" "BundleReturnPolicy",
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "superseded_at" TIMESTAMP(3),
    "superseded_by_id" UUID,
    "created_by" UUID,
    "activated_by" UUID,
    "activated_at" TIMESTAMP(3),
    "ended_by" UUID,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleComponent" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bundle_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_tenant_id_idx" ON "Promotion"("tenant_id");

-- CreateIndex
CREATE INDEX "Promotion_tenant_id_status_idx" ON "Promotion"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "Promotion_tenant_id_status_priority_idx" ON "Promotion"("tenant_id", "status", "priority");

-- CreateIndex
CREATE INDEX "Promotion_tenant_id_scope_type_scope_id_idx" ON "Promotion"("tenant_id", "scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_tenant_id_id_key" ON "Promotion"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "Coupon_tenant_id_idx" ON "Coupon"("tenant_id");

-- CreateIndex
CREATE INDEX "Coupon_tenant_id_promotion_id_idx" ON "Coupon"("tenant_id", "promotion_id");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_tenant_id_id_key" ON "Coupon"("tenant_id", "id");

-- BR-CPN-201: NOT unique yet -- see the file header. Promoted to UNIQUE by
-- 202608160002_add_promotion_coupon_uniqueness_constraints.
CREATE INDEX "Coupon_tenant_id_code_normalized_idx" ON "Coupon"("tenant_id", "code_normalized");

-- CreateIndex
CREATE INDEX "CouponRedemption_tenant_id_idx" ON "CouponRedemption"("tenant_id");

-- CreateIndex
CREATE INDEX "CouponRedemption_tenant_id_coupon_id_idx" ON "CouponRedemption"("tenant_id", "coupon_id");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_tenant_id_id_key" ON "CouponRedemption"("tenant_id", "id");

-- BR-CPN-204: NOT unique yet -- see the file header. Promoted to UNIQUE by
-- 202608160002_add_promotion_coupon_uniqueness_constraints.
CREATE INDEX "CouponRedemption_tenant_id_coupon_id_idempotency_key_idx" ON "CouponRedemption"("tenant_id", "coupon_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "Bundle_tenant_id_idx" ON "Bundle"("tenant_id");

-- CreateIndex
CREATE INDEX "Bundle_tenant_id_status_idx" ON "Bundle"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Bundle_tenant_id_id_key" ON "Bundle"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "BundleComponent_tenant_id_idx" ON "BundleComponent"("tenant_id");

-- CreateIndex
CREATE INDEX "BundleComponent_tenant_id_bundle_id_idx" ON "BundleComponent"("tenant_id", "bundle_id");

-- CreateIndex
CREATE UNIQUE INDEX "BundleComponent_tenant_id_id_key" ON "BundleComponent"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_tenant_id_promotion_id_fkey" FOREIGN KEY ("tenant_id", "promotion_id") REFERENCES "Promotion"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_tenant_id_coupon_id_fkey" FOREIGN KEY ("tenant_id", "coupon_id") REFERENCES "Coupon"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bundle" ADD CONSTRAINT "Bundle_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "Bundle"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleComponent" ADD CONSTRAINT "BundleComponent_tenant_id_bundle_id_fkey" FOREIGN KEY ("tenant_id", "bundle_id") REFERENCES "Bundle"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleComponent" ADD CONSTRAINT "BundleComponent_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
