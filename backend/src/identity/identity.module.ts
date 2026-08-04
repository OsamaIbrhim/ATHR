import { Global, Module } from '@nestjs/common';
import { AccessScopeRepository } from './access-scope.repository';
import { AccessScopeService } from './access-scope.service';
import { InvitationController } from './invitation.controller';
import { InvitationRepository } from './invitation.repository';
import { InvitationService } from './invitation.service';
import { MembershipController } from './membership.controller';
import { MembershipRepository } from './membership.repository';
import { MembershipService } from './membership.service';
import { PermissionPolicyService } from './permission-policy.service';
import { SupportAccessGrantController } from './support-access-grant.controller';
import { SupportAccessGrantRepository } from './support-access-grant.repository';
import { SupportAccessGrantService } from './support-access-grant.service';
import { TenantContextResolver } from './tenant-context.resolver';

/**
 * WP-006: Identity, Membership and Permission Model.
 *
 * WP-007 Phase A makes this module `@Global()`: the global `TenantContextGuard`
 * and `PermissionGuard` registered in `app.module.ts` need `PermissionPolicyService`,
 * and every retrofitted module's repositories are tenant-scoped against the
 * context those guards resolve. Marking it global avoids adding an
 * `imports: [IdentityModule]` line to all 18 retrofitted modules for what is
 * genuinely cross-cutting infrastructure.
 */
@Global()
@Module({
  controllers: [MembershipController, InvitationController, SupportAccessGrantController],
  providers: [
    TenantContextResolver,
    PermissionPolicyService,
    AccessScopeRepository,
    AccessScopeService,
    MembershipRepository,
    MembershipService,
    InvitationRepository,
    InvitationService,
    SupportAccessGrantRepository,
    SupportAccessGrantService,
  ],
  exports: [
    TenantContextResolver,
    PermissionPolicyService,
    MembershipRepository,
    MembershipService,
    AccessScopeService,
  ],
})
export class IdentityModule {}
