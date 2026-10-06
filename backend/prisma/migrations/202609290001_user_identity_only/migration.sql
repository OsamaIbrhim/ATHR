-- W1a: User becomes a global identity only. Role, branch and per-user
-- permission overrides live on Membership (tenant-specific); a refresh token
-- remembers the tenant it was issued for. Development data only, so the
-- legacy User columns are dropped directly.

-- Membership: snake_case columns + permission overrides.
ALTER TABLE "Membership" RENAME COLUMN "tenantId" TO tenant_id;
ALTER TABLE "Membership" RENAME COLUMN "identityId" TO user_id;
ALTER INDEX "Membership_identityId_tenantId_key" RENAME TO "Membership_user_id_tenant_id_key";
ALTER INDEX "Membership_tenantId_idx" RENAME TO "Membership_tenant_id_idx";
ALTER TABLE "Membership" RENAME CONSTRAINT "Membership_identityId_fkey" TO "Membership_user_id_fkey";
ALTER TABLE "Membership" RENAME CONSTRAINT "Membership_tenantId_fkey" TO "Membership_tenant_id_fkey";
ALTER TABLE "Membership"
    ADD COLUMN granted_permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN revoked_permissions text[] NOT NULL DEFAULT ARRAY[]::text[];

-- User: drop tenant-specific data.
ALTER TABLE "User"
    DROP COLUMN role,
    DROP COLUMN branch_id,
    DROP COLUMN granted_capabilities,
    DROP COLUMN revoked_capabilities;
DROP TYPE "Role";

-- RefreshToken: keep the tenant the session was issued for.
ALTER TABLE "RefreshToken" ADD COLUMN tenant_id uuid;
ALTER TABLE "RefreshToken"
    ADD CONSTRAINT "RefreshToken_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;
