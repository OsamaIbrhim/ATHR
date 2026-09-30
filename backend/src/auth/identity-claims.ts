import { UnauthorizedException } from '@nestjs/common';
import type { AccessScopeType, MembershipRole } from '@prisma/client';
import { toScopeSet } from './branch-access';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { AthrPermission, effectivePermissions } from '../identity/permission-catalog';

/**
 * Everything the request needs to know about the caller's Membership.
 * `null`/empty means the identity has no active Membership yet.
 */
export interface IdentityClaims {
  readonly tenant_id: string | null;
  readonly membership_id: string | null;
  readonly membership_role: MembershipRole | null;
  /** role defaults + granted - revoked, see `effectivePermissions`. */
  readonly permissions: ReadonlySet<AthrPermission>;
  readonly scope_set: ReadonlyArray<{ scope_type: AccessScopeType; scope_ref_id: string | null }>;
  readonly permission_policy_version: number | null;
}

const EMPTY_CLAIMS: IdentityClaims = {
  tenant_id: null,
  membership_id: null,
  membership_role: null,
  permissions: new Set(),
  scope_set: [],
  permission_policy_version: null,
};

export async function resolveIdentityClaims(
  prisma: PrismaService,
  permissionPolicy: PermissionPolicyService,
  userId: string,
  requestedTenantId?: string | null,
): Promise<IdentityClaims> {
  // An explicit tenant is only honoured if it is an active membership of this
  // user; otherwise the oldest active membership is used (deterministic).
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId, status: 'active', ...(requestedTenantId ? { tenant_id: requestedTenantId } : {}) },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    include: { access_scope_assignments: true },
  });
  if (!membership) {
    if (requestedTenantId) throw new UnauthorizedException('No active membership in the requested tenant');
    return EMPTY_CLAIMS;
  }

  return {
    tenant_id: membership.tenant_id,
    membership_id: membership.id,
    membership_role: membership.role,
    permissions: effectivePermissions(membership.role, membership.granted_permissions, membership.revoked_permissions),
    scope_set: toScopeSet(membership.access_scope_assignments),
    permission_policy_version: await permissionPolicy.getCurrentVersion(),
  };
}
