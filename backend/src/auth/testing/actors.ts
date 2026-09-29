import type { MembershipRole } from '@prisma/client';
import { AuthenticatedUser } from '../authenticated-user';
import { effectivePermissions } from '../../identity/permission-catalog';

export interface ActorOptions {
  readonly sub?: string;
  readonly tenantId?: string;
  /** A location (branch) scope. */
  readonly branchId?: string;
  /** A tenant-wide scope: sees every branch. */
  readonly tenantWide?: boolean;
  readonly granted?: readonly string[];
  readonly revoked?: readonly string[];
}

/** Builds the request user for tests: a Membership with role defaults, overrides and scope. */
export function actorFor(role: MembershipRole, options: ActorOptions = {}): AuthenticatedUser {
  const scope_set: Array<AuthenticatedUser['scope_set'][number]> = [];
  if (options.tenantWide) scope_set.push({ scope_type: 'tenant_wide', scope_ref_id: null });
  if (options.branchId) scope_set.push({ scope_type: 'location', scope_ref_id: options.branchId });
  return {
    sub: options.sub ?? 'user-1',
    tenant_id: options.tenantId ?? 'tenant-1',
    membership_id: 'membership-1',
    membership_role: role,
    permissions: effectivePermissions(role, options.granted, options.revoked),
    scope_set,
    permission_policy_version: 8,
  };
}
