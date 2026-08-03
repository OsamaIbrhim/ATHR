import type { AccessScopeType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';

/**
 * WP-006 §2 item 6 (MT-MIG-005's session/token half): additive claims
 * carried alongside every pre-existing session/token field, never
 * replacing them. `null`/`[]` here just means "no active Membership yet"
 * — a completely ordinary, pre-WP-006-shaped account — so an old-shape
 * consumer that never reads these fields sees no behavior change at all.
 */
export interface IdentityClaims {
  readonly tenant_id: string | null;
  readonly membership_id: string | null;
  readonly scope_set: ReadonlyArray<{ scope_type: AccessScopeType; scope_ref_id: string | null }>;
  readonly permission_policy_version: number | null;
}

const EMPTY_CLAIMS: IdentityClaims = {
  tenant_id: null,
  membership_id: null,
  scope_set: [],
  permission_policy_version: null,
};

export async function resolveIdentityClaims(
  prisma: PrismaService,
  permissionPolicy: PermissionPolicyService,
  identityId: string,
): Promise<IdentityClaims> {
  const membership = await prisma.membership.findFirst({
    where: { identityId, status: 'active' },
    include: { access_scope_assignments: true },
  });
  if (!membership) return EMPTY_CLAIMS;

  const now = new Date();
  const scope_set = membership.access_scope_assignments
    .filter((assignment) => assignment.effective_from <= now && (!assignment.effective_to || assignment.effective_to > now))
    .map((assignment) => ({ scope_type: assignment.scope_type, scope_ref_id: assignment.scope_ref_id }));

  const permission_policy_version = await permissionPolicy.getCurrentVersion();

  return {
    tenant_id: membership.tenantId,
    membership_id: membership.id,
    scope_set,
    permission_policy_version,
  };
}
