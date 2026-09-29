import { AthrDomainError } from '../common/http/athr-exception.filter';
import { MembershipRepository } from './membership.repository';
import { effectivePermissions } from './permission-catalog';
import { IdentityPermission } from './system-roles';
import { TenantContext } from './tenant-context.type';

/**
 * Explicit per-route check for the tenant-path identity endpoints
 * (`/tenants/:tenantId/...`), where the tenant comes from the URL rather than
 * the session. Evaluates the caller's Membership in that tenant.
 */
export async function assertIdentityPermission(
  context: TenantContext,
  membershipRepository: MembershipRepository,
  permission: IdentityPermission,
): Promise<void> {
  if (!context.membershipId) {
    throw new AthrDomainError('PERMISSION_DENIED', 'No Membership in this Tenant context.');
  }
  const membership = await membershipRepository.findById(context, context.membershipId);
  if (!membership) {
    throw new AthrDomainError('PERMISSION_DENIED', 'No Membership in this Tenant context.');
  }
  const permissions = effectivePermissions(
    membership.role,
    membership.granted_permissions,
    membership.revoked_permissions,
  );
  if (!permissions.has(permission)) {
    throw new AthrDomainError('PERMISSION_DENIED', `Role "${membership.role}" does not grant "${permission}".`);
  }
}
