import { Role } from '@prisma/client';
import { Capability } from './permissions';
import { IdentityClaims } from './identity-claims';

/**
 * WP-006 §2 item 6: `tenant_id`/`membership_id`/`scope_set`/
 * `permission_policy_version` are additive — every field present before
 * this WP is unchanged, and existing consumers that don't read the new
 * ones see no behavior change.
 */
export interface AuthenticatedUser extends Partial<IdentityClaims> {
  sub: string;
  role: Role;
  branch_id: string | null;
  capabilities?: Capability[];
}
