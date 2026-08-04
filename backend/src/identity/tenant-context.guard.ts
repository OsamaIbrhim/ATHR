import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { parseMembershipId, parseTenantId } from '@athr/domain-core';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import type { ScopeGrant, TenantContext } from './tenant-context.type';

export interface RequestWithTenantContext extends Request {
  tenantContext?: TenantContext;
  requestId?: string;
  correlationId?: string;
  user?: {
    sub: string;
    tenant_id?: string | null;
    membership_id?: string | null;
    scope_set?: ReadonlyArray<{ scope_type: string; scope_ref_id: string | null }>;
    permission_policy_version?: number | null;
  };
}

/**
 * WP-007 Phase A (MT-MIG-005) §A.3.1: the global wiring WP-006 deliberately
 * left undone. Every non-`@Public()` route resolves a `TenantContext` before
 * its handler runs, so no controller can forget to.
 *
 * The tenant is taken **only** from the authenticated session claims that
 * `JwtStrategy` already loaded from the database — never from a request body,
 * query string, or header. That is ADR-0002 Decision item 6 / MT-DEC-003
 * ("no Tenant context from untrusted input") enforced structurally rather
 * than by convention.
 *
 * Fails closed with `TENANT_CONTEXT_UNRESOLVABLE` when the session carries no
 * active Membership (Blueprint §18, `BR-TERR-105`). For today's single-tenant
 * production reality this never fires: migration `202608020003_add_membership_from_user`
 * ends with a hard invariant proving every `User` row has a Membership into
 * the Initial ATHR Demo Tenant, and `UsersService.create` now creates one
 * alongside every new User. Nothing here is hardcoded to that tenant's id —
 * the value is whatever the caller's own Membership resolves to (§A.3.4).
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // `@Public()` routes are device-authenticated (POS) or unauthenticated
    // (login/health). The POS sale path derives its context from the enrolled
    // Terminal's own tenant instead — see `deviceTenantContext()`.
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithTenantContext>();
    request.tenantContext = buildTenantContextFromSession(request);
    return true;
  }
}

/** Shared by the guard and by the device-authenticated POS path's tests. */
export function buildTenantContextFromSession(request: RequestWithTenantContext): TenantContext {
  const user = request.user;
  if (!user?.sub) {
    throw new AthrDomainError('AUTHENTICATION_REQUIRED', 'No authenticated identity on this request.');
  }
  if (!user.tenant_id) {
    throw new AthrDomainError(
      'TENANT_CONTEXT_UNRESOLVABLE',
      'No active Membership for this Identity in any Tenant.',
    );
  }

  const scopeSet: ScopeGrant[] = (user.scope_set ?? []).map((grant) => ({
    scopeType: grant.scope_type as ScopeGrant['scopeType'],
    scopeRefId: grant.scope_ref_id,
  }));

  return {
    tenantId: parseTenantId(user.tenant_id),
    membershipId: user.membership_id ? parseMembershipId(user.membership_id) : null,
    servicePrincipalId: null,
    authenticatedIdentityId: user.sub,
    // Access-mode gating (`TenantAccessModeAllows` in the Permission Matrix
    // §2 ALLOW equation) is not enforced here: WP-007 Phase A is isolation,
    // and no endpoint today reads it. The field is carried honestly rather
    // than fabricated.
    tenantAccessMode: 'active',
    entitlementSnapshotVersion: null,
    permissionPolicyVersion: user.permission_policy_version ?? 1,
    scopeSet,
    selectedLocationId: null,
    selectedWarehouseId: null,
    terminalId: null,
    supportGrantId: null,
    requestId: request.requestId ?? 'unknown',
    correlationId: request.correlationId ?? 'unknown',
    actorType: 'human',
  };
}
