import { IdentityClaims } from './identity-claims';

/**
 * The request user: the global identity (`sub`) plus its Membership in the
 * session's tenant (role, effective permissions, access scope). Tenant-specific
 * data lives only on the Membership, never on the User.
 */
export interface AuthenticatedUser extends IdentityClaims {
  sub: string;
}
