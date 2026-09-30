import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithTenantContext } from '../identity/tenant-context.guard';
import { ANY_ACCESS_MODE_KEY, REQUIRED_FEATURE_KEY } from './entitlement.decorators';
import { featureNotInPlanError, restrictedError } from './entitlement.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * ADR-0005 "Entitlement", enforced in one place: the tenant's access mode and
 * the plan feature a route requires. `TenantContextGuard` has already resolved
 * the tenant's access onto the request, so this guard does no I/O. Permission
 * (`PermissionGuard`) runs after it; limits are checked at the creation points.
 *
 * Routes without a tenant context (`@Public()`, platform console) are skipped.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithTenantContext>();
    const access = request.entitlement;
    if (!request.tenantContext || !access) return true;

    const targets = [context.getHandler(), context.getClass()];
    const anyMode = this.reflector.getAllAndOverride<boolean>(ANY_ACCESS_MODE_KEY, targets);
    if (!anyMode) {
      if (access.mode === 'suspended') throw restrictedError('suspended');
      if (access.mode === 'read_only' && !SAFE_METHODS.has(request.method)) {
        throw restrictedError('read_only');
      }
    }

    const feature = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_FEATURE_KEY, targets);
    if (feature && !access.features.has(feature)) throw featureNotInPlanError(feature, access.planCode);
    return true;
  }
}
