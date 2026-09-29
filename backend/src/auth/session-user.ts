import type { MembershipRole } from '@prisma/client';
import { primaryBranchId } from './branch-access';
import { IdentityClaims } from './identity-claims';

/**
 * Role names the POS and admin clients already understand. Kept only on the
 * auth response (`role`) so those clients keep working unchanged; new code
 * uses `membership_role`.
 */
export const CLIENT_ROLE_NAME: Record<MembershipRole, string> = {
  tenant_owner: 'owner',
  location_manager: 'branch_manager',
  cashier: 'cashier',
  warehouse_manager: 'warehouse_manager',
  seller: 'seller',
};

/** The user object returned by /auth/login, /auth/refresh and /auth/me. */
export function toSessionUser(user: { id: string; name: string }, claims: IdentityClaims) {
  return {
    id: user.id,
    name: user.name,
    role: claims.membership_role ? CLIENT_ROLE_NAME[claims.membership_role] : null,
    membership_role: claims.membership_role,
    branch_id: primaryBranchId(claims),
    permissions: [...claims.permissions],
    tenant_id: claims.tenant_id,
    membership_id: claims.membership_id,
    scope_set: claims.scope_set,
    permission_policy_version: claims.permission_policy_version,
  };
}
