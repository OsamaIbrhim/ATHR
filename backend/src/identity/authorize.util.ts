import { AthrDomainError } from '../common/http/athr-exception.filter';
import { MembershipRepository } from './membership.repository';
import { PermissionPolicyService } from './permission-policy.service';
import { IdentityPermission } from './system-roles';
import { TenantContext } from './tenant-context.type';

/**
 * Proves the new allow-only permission policy (ADR-0003 item 5, ADR-0005)
 * end-to-end on a real feature, per WP-006 §2 item 3 — this is deliberately
 * a per-route, explicit application-layer check (not a NestJS global guard
 * registered via `APP_GUARD`, which stays WP-007's job).
 */
export async function assertIdentityPermission(
  context: TenantContext,
  membershipRepository: MembershipRepository,
  permissionPolicy: PermissionPolicyService,
  permission: IdentityPermission,
): Promise<void> {
  if (!context.membershipId) {
    throw new AthrDomainError('PERMISSION_DENIED', 'No Membership in this Tenant context.');
  }
  const membership = await membershipRepository.findById(context, context.membershipId);
  if (!membership) {
    throw new AthrDomainError('PERMISSION_DENIED', 'No Membership in this Tenant context.');
  }
  const allowed = await permissionPolicy.hasPermission(membership.role, permission);
  if (!allowed) {
    throw new AthrDomainError('PERMISSION_DENIED', `Role "${membership.role}" does not grant "${permission}".`);
  }
}
