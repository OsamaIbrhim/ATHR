import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MembershipRole } from '@prisma/client';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import type { RequestWithTenantContext } from './tenant-context.guard';
import { PermissionPolicyService } from './permission-policy.service';
import type { AthrPermission } from './permission-catalog';

export const REQUIRED_PERMISSIONS_KEY = 'athr:required-permissions';

/**
 * Declares the Permission Matrix key(s) an endpoint requires. Multiple keys
 * are AND-ed — the Matrix has no OR semantics (§2: every clause of the ALLOW
 * equation must hold; §3 rule 1: default deny).
 */
export const RequirePermission = (...permissions: AthrPermission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * WP-007 Phase A §A.3.5 — wires WP-006's permission evaluator (system roles +
 * allow-only policy) onto the retrofitted endpoints.
 *
 * Runs *alongside* the legacy `RolesGuard`, not instead of it: both must pass,
 * so this can only ever be at least as strict as today. That is deliberate
 * belt-and-braces for §A.6 ("zero behavior change") — the grants in
 * `permission-catalog.ts` are derived to match today's capability matrix, and
 * if that derivation is wrong anywhere the legacy guard still holds the line.
 * Removing the legacy `Role`/capability layer is Phase D, not this phase.
 *
 * Endpoints without `@RequirePermission()` are unaffected.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionPolicy: PermissionPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    const request = context.switchToHttp().getRequest<RequestWithTenantContext>();
    const role = (request.user as { membership_role?: MembershipRole | null } | undefined)
      ?.membership_role;

    if (!role) {
      // Matrix §74 denial precedence: membership/status is evaluated before
      // permission, and the message never reveals whether the resource exists.
      throw new AthrDomainError('PERMISSION_DENIED', 'No active Membership in this Tenant.');
    }

    for (const permission of required) {
      const allowed = await this.permissionPolicy.hasPermission(role, permission);
      if (!allowed) {
        throw new AthrDomainError(
          'PERMISSION_DENIED',
          `Role "${role}" does not grant "${permission}".`,
        );
      }
    }
    return true;
  }
}
