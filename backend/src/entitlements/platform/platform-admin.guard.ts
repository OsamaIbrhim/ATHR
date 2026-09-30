import { CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { AthrDomainError } from '../../common/http/athr-exception.filter';
import type { RequestWithTenantContext } from '../../identity/tenant-context.guard';
import { PLATFORM_ROUTE_KEY } from '../entitlement.decorators';

/**
 * Only an identity flagged `is_platform_admin` may call the platform console.
 * The flag grants nothing inside any tenant (ADR-0006): platform routes have no
 * tenant context, and a platform admin without a Membership cannot call tenant
 * routes.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<RequestWithTenantContext>().user;
    if (!user?.is_platform_admin) {
      throw new AthrDomainError('PERMISSION_DENIED', 'Platform administrator access is required.');
    }
    return true;
  }
}

/** Marks a controller/route as platform console: no tenant context, platform admins only. */
export const PlatformRoute = () =>
  applyDecorators(SetMetadata(PLATFORM_ROUTE_KEY, true), UseGuards(PlatformAdminGuard));
