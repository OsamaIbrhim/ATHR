import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { parseTenantId } from '@athr/domain-core';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { RequestWithTenantContext } from './tenant-context.guard';
import type { TenantContext, TenantScope } from './tenant-context.type';

/**
 * Injects the `TenantContext` that `TenantContextGuard` resolved for this
 * request. Throws rather than returning `undefined` if the guard did not run,
 * so a route that is accidentally left `@Public()` while still calling a
 * tenant-scoped service fails closed instead of querying every tenant.
 */
export const TenantCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest<RequestWithTenantContext>();
    if (!request.tenantContext) {
      throw new AthrDomainError(
        'TENANT_CONTEXT_UNRESOLVABLE',
        'No TenantContext on this request. The route is @Public() but calls a tenant-scoped service.',
      );
    }
    return request.tenantContext;
  },
);

/**
 * The device-authenticated POS path (`POST /pos/sale`, terminal heartbeat)
 * has no JWT session, so its tenant comes from the enrolled `PosTerminal`
 * row's own `tenant_id` — backfilled for every existing terminal by WP-005
 * Phase B. This reads that existing column; it does not change enrollment,
 * which is explicitly Phase C (§A.4).
 *
 * Fails closed if a terminal somehow has no tenant, rather than falling back
 * to an unscoped query.
 */
export function deviceTenantContext(
  terminal: { id: string; tenant_id: string | null },
  requestId = 'pos',
  correlationId = 'pos',
): TenantContext {
  if (!terminal.tenant_id) {
    throw new AthrDomainError(
      'TENANT_CONTEXT_UNRESOLVABLE',
      'Enrolled terminal has no Tenant binding.',
    );
  }
  return {
    tenantId: parseTenantId(terminal.tenant_id),
    membershipId: null,
    servicePrincipalId: terminal.id,
    authenticatedIdentityId: terminal.id,
    tenantAccessMode: 'active',
    entitlementSnapshotVersion: null,
    permissionPolicyVersion: 1,
    scopeSet: [{ scopeType: 'terminal', scopeRefId: terminal.id }],
    selectedLocationId: null,
    selectedWarehouseId: null,
    terminalId: terminal.id,
    supportGrantId: null,
    requestId,
    correlationId,
    actorType: 'service_principal',
  };
}

/** Narrowing helper for repositories that only need the tenant predicate. */
export function scopeOf(context: TenantContext): TenantScope {
  return { tenantId: context.tenantId };
}
