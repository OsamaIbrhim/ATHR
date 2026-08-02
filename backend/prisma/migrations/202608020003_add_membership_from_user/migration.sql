-- WP-005 Phase B, MT-MIG-003 (expand-only): introduces Membership as a layer
-- above the existing "User" table (per ADR-0003 — User is repurposed as the
-- Platform Identity directly; this is the smaller, safer, purely-additive
-- change given the current User model, since it avoids copying every User
-- row into a brand-new identity table). "User", "Role", and "User.branch_id"
-- are read from only — none of them is altered, renamed, or dropped here.
--
-- Backfills exactly one Membership per existing User into the Initial ATHR
-- Demo Tenant, mapping the legacy Role enum to MembershipRole:
--   owner              -> tenant_owner
--   branch_manager     -> location_manager
--   cashier            -> cashier
--   warehouse_manager  -> warehouse_manager
--   seller             -> seller
-- and User.is_active to MembershipStatus (true -> active, false -> suspended
-- — a reversible, re-activatable state, not "deactivated", since a legacy
-- is_active=false user was never explicitly offboarded from the tenant).
--
-- Fails loudly if the Initial ATHR Demo Tenant has not been seeded yet.
DO $$
BEGIN
  IF (SELECT count(*) FROM "Tenant" WHERE name = 'Initial ATHR Demo Tenant') <> 1 THEN
    RAISE EXCEPTION 'MT-MIG-003 precondition failed: expected exactly one "Initial ATHR Demo Tenant" row in "Tenant", found %. Run backend/prisma/seed/initial-tenant-seed.ts first.',
      (SELECT count(*) FROM "Tenant" WHERE name = 'Initial ATHR Demo Tenant');
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('tenant_owner', 'location_manager', 'cashier', 'warehouse_manager', 'seller');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('invited', 'pending_verification', 'active', 'suspended', 'deactivated', 'expired');

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Membership_tenantId_idx" ON "Membership"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_identityId_tenantId_key" ON "Membership"("identityId", "tenantId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: exactly one Membership per existing User into the Initial Tenant.
INSERT INTO "Membership" ("id", "tenantId", "identityId", "role", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  t."id",
  u."id",
  CASE u."role"
    WHEN 'owner' THEN 'tenant_owner'
    WHEN 'branch_manager' THEN 'location_manager'
    WHEN 'cashier' THEN 'cashier'
    WHEN 'warehouse_manager' THEN 'warehouse_manager'
    WHEN 'seller' THEN 'seller'
  END::"MembershipRole",
  CASE WHEN u."is_active" THEN 'active' ELSE 'suspended' END::"MembershipStatus",
  u."created_at",
  now()
FROM "User" u
CROSS JOIN (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant') t;

-- Post-step invariant guard: every User must now have exactly one Membership
-- into the Initial Tenant. Mirrors
-- docs/runbooks/tenant-migration-backfill-rollback.md Step D.
DO $$
DECLARE
  missing_memberships INT;
  initial_tenant_id UUID;
BEGIN
  SELECT "id" INTO initial_tenant_id FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant';

  SELECT count(*) INTO missing_memberships
  FROM "User" u
  LEFT JOIN "Membership" m ON m."identityId" = u."id" AND m."tenantId" = initial_tenant_id
  WHERE m."id" IS NULL;

  IF missing_memberships <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-003 invariant failed: % User row(s) have no Membership into the Initial ATHR Demo Tenant.', missing_memberships;
  END IF;
END $$;
