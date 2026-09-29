import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from './authenticated-user';

type ScopedUser = Pick<AuthenticatedUser, 'scope_set'>;

/** Access-scope rows of a Membership that are in effect at `now`, as a scope set. */
export function toScopeSet(
  assignments: ReadonlyArray<{
    scope_type: AuthenticatedUser['scope_set'][number]['scope_type'];
    scope_ref_id: string | null;
    effective_from: Date;
    effective_to: Date | null;
  }>,
  now = new Date(),
): AuthenticatedUser['scope_set'] {
  return assignments
    .filter((scope) => scope.effective_from <= now && (!scope.effective_to || scope.effective_to > now))
    .map(({ scope_type, scope_ref_id }) => ({ scope_type, scope_ref_id }));
}

/** A tenant-wide access scope sees every branch. */
export function canAccessAllBranches(user: ScopedUser): boolean {
  return user.scope_set.some((scope) => scope.scope_type === 'tenant_wide');
}

/** Branches the membership is explicitly scoped to (location scopes). */
export function scopedBranchIds(user: ScopedUser): string[] {
  return user.scope_set
    .filter((scope) => scope.scope_type === 'location' && scope.scope_ref_id)
    .map((scope) => scope.scope_ref_id as string);
}

/** The user's own branch for branch-bound operations (first location scope). */
export function primaryBranchId(user: ScopedUser): string | null {
  return scopedBranchIds(user)[0] ?? null;
}

export function hasBranchAccess(user: ScopedUser, branchId: string): boolean {
  return canAccessAllBranches(user) || scopedBranchIds(user).includes(branchId);
}

export function assertBranchAccess(user: ScopedUser, branchId: string) {
  if (!hasBranchAccess(user, branchId)) {
    throw new ForbiddenException('You cannot access another branch');
  }
}

/**
 * The branch a list/report should be limited to: the requested one when the
 * user may see it, the user's own branch when none is requested, or
 * `undefined` (all branches) for a tenant-wide scope with no request.
 */
export function resolveBranchScope(user: ScopedUser, requestedBranchId?: string) {
  if (canAccessAllBranches(user)) return requestedBranchId;
  const own = primaryBranchId(user);
  if (!own || (requestedBranchId && !scopedBranchIds(user).includes(requestedBranchId))) {
    throw new ForbiddenException('You cannot access another branch');
  }
  return requestedBranchId ?? own;
}
