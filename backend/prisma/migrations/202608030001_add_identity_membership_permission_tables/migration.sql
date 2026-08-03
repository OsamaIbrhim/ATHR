-- WP-006 (MT-MIG-005's identity/permission half only): additive-only.
-- New tables layered on top of the existing, untouched Membership/Tenant
-- rows from WP-005 Phase B: Invitation, AccessScopeAssignment (explicit
-- Access Scope per BR-SCP-*), PermissionPolicySnapshot (versioned, global
-- system-role permission catalog per ADR-0005), SupportAccessGrant
-- (time-boxed, audited Platform Support Access per ADR-0006/BR-SUPA-*).
--
-- Zero changes to any existing table/column/constraint. `tenant_id` stays
-- nullable everywhere; no composite FKs or tenant-scoped uniqueness added;
-- the legacy `Role` enum, `branch_id`, and `Membership.role`/`status` are
-- untouched — all of that remains WP-007 (MT-MIG-006) territory.
--
-- NOTE: `prisma migrate dev --create-only` also emitted a large block of
-- DropForeignKey/AlterTable/AddForeignKey statements against
-- InventoryCostMovement/InventoryMovement/PurchaseInvoice/SupplierReturn/
-- SupplierReturnItem/TransferTransitMovement. That is the same pre-existing
-- `gen_random_uuid()` DB-default-vs-Prisma-app-default drift documented in
-- the WP-005 Phase B PR description (baked in since each table's original
-- 2026-07 migration) — unrelated to this WP and stripped from this file by
-- hand so this migration only ever touches the four new tables below.

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "AccessScopeType" AS ENUM ('tenant_wide', 'location', 'warehouse', 'terminal');

-- CreateEnum
CREATE TYPE "SupportAccessMode" AS ENUM ('metadata_only', 'read_only_diagnostic', 'assisted_operation', 'break_glass');

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "scope_type" "AccessScopeType" NOT NULL,
    "scope_ref_id" UUID,
    "token_hash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "invited_by_id" UUID,
    "purpose" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_membership_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessScopeAssignment" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "scope_type" "AccessScopeType" NOT NULL,
    "scope_ref_id" UUID,
    "grant_source" VARCHAR(64) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessScopeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionPolicySnapshot" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "grants" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionPolicySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAccessGrant" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "operator_identity_id" UUID NOT NULL,
    "mode" "SupportAccessMode" NOT NULL,
    "purpose" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "read_only" BOOLEAN NOT NULL DEFAULT true,
    "approved_by_identity_id" UUID,
    "consent_obtained" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_hash_key" ON "Invitation"("token_hash");

-- CreateIndex
CREATE INDEX "Invitation_tenant_id_idx" ON "Invitation"("tenant_id");

-- CreateIndex
CREATE INDEX "Invitation_tenant_id_email_idx" ON "Invitation"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "AccessScopeAssignment_membership_id_idx" ON "AccessScopeAssignment"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionPolicySnapshot_version_key" ON "PermissionPolicySnapshot"("version");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_tenant_id_idx" ON "SupportAccessGrant"("tenant_id");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_tenant_id_expires_at_idx" ON "SupportAccessGrant"("tenant_id", "expires_at");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessScopeAssignment" ADD CONSTRAINT "AccessScopeAssignment_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
