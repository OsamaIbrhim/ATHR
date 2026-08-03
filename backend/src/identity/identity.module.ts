import { Module } from '@nestjs/common';
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
 * WP-006: Identity, Membership and Permission Model. New, additive module —
 * `TenantContextResolver` is a plain provider here, not wired as a global
 * guard (WP-007 does that global wiring per MT-MIG-005/006). Nothing in
 * this module is imported by, or changes the behavior of, any existing
 * sales/inventory/catalog/customer module.
 */
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
  exports: [TenantContextResolver, PermissionPolicyService, MembershipService, AccessScopeService],
})
export class IdentityModule {}
