import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import type { RequestWithTenantContext } from './tenant-context.guard';
import type { AthrPermission } from './permission-catalog';

export const REQUIRED_PERMISSIONS_KEY = 'athr:required-permissions';

/**
 * The one authorization decorator: declares the permission key(s) an endpoint
 * requires. Multiple keys are AND-ed (default deny). A handler-level decorator
 * overrides a class-level one.
 */
export const RequirePermission = (...permissions: AthrPermission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * The one authorization guard. The caller's effective permissions (Membership
 * role defaults + granted - revoked, loaded by `JwtStrategy`) must contain every
 * required key. Endpoints without `@RequirePermission()` are unaffected.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AthrPermission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const user = context.switchToHttp().getRequest<RequestWithTenantContext>().user;
    if (!user?.membership_role) {
      // Membership/status is evaluated before permission, and the message never
      // reveals whether the resource exists.
      throw new AthrDomainError('PERMISSION_DENIED', 'No active Membership in this Tenant.');
    }

    for (const permission of required) {
      if (!user.permissions?.has(permission)) {
        throw new AthrDomainError(
          'PERMISSION_DENIED',
          `Role "${user.membership_role}" does not grant "${permission}".`,
        );
      }
    }
    return true;
  }
}
