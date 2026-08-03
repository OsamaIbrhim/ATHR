import { Body, Controller, Get, Param, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { AthrExceptionFilter } from '../common/http/athr-exception.filter';
import { Envelope } from '../common/http/response-envelope.interceptor';
import { IdempotencyKeyGuard, RequiresIdempotencyKey } from '../common/http/idempotency-key.guard';
import { assertIdentityPermission } from './authorize.util';
import { ChangeMembershipRoleDto } from './dto/change-membership-role.dto';
import { MembershipRepository } from './membership.repository';
import { MembershipService } from './membership.service';
import { PermissionPolicyService } from './permission-policy.service';
import { RequestWithIdentity, resolveContextOrThrow } from './resolve-tenant-context.util';
import { TenantContextResolver } from './tenant-context.resolver';
import { unwrapOrThrow } from './unwrap-result.util';

/**
 * New, additive endpoints per WP-006 §2 item 2 — uses the WP-003 response
 * envelope/error envelope/Idempotency-Key conventions on every mutating
 * route. `TenantContextResolver` is invoked explicitly per method (a
 * provider, not a global guard — WP-007 does the global wiring).
 */
@Controller('tenants/:tenantId/memberships')
@UseFilters(AthrExceptionFilter)
export class MembershipController {
  constructor(
    private readonly memberships: MembershipService,
    private readonly membershipRepository: MembershipRepository,
    private readonly permissionPolicy: PermissionPolicyService,
    private readonly tenantContext: TenantContextResolver,
  ) {}

  @Get()
  @Envelope('list')
  async list(@Param('tenantId') tenantId: string, @Req() req: RequestWithIdentity) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    const items = await this.memberships.list(context);
    return { items, page: { limit: items.length, next_cursor: null, previous_cursor: null, has_more: false } };
  }

  @Get(':membershipId')
  @Envelope('query')
  async get(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    return this.memberships.findById(context, membershipId);
  }

  @Post(':membershipId/suspend')
  @Envelope('command')
  @RequiresIdempotencyKey()
  @UseGuards(IdempotencyKeyGuard)
  async suspend(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    await assertIdentityPermission(context, this.membershipRepository, this.permissionPolicy, 'membership.status.change');
    return unwrapOrThrow(await this.memberships.suspend(context, membershipId));
  }

  @Post(':membershipId/reinstate')
  @Envelope('command')
  @RequiresIdempotencyKey()
  @UseGuards(IdempotencyKeyGuard)
  async reinstate(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    await assertIdentityPermission(context, this.membershipRepository, this.permissionPolicy, 'membership.status.change');
    return unwrapOrThrow(await this.memberships.reinstate(context, membershipId));
  }

  @Post(':membershipId/deactivate')
  @Envelope('command')
  @RequiresIdempotencyKey()
  @UseGuards(IdempotencyKeyGuard)
  async deactivate(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    await assertIdentityPermission(context, this.membershipRepository, this.permissionPolicy, 'membership.status.change');
    return unwrapOrThrow(await this.memberships.deactivate(context, membershipId));
  }

  @Post(':membershipId/role')
  @Envelope('command')
  @RequiresIdempotencyKey()
  @UseGuards(IdempotencyKeyGuard)
  async changeRole(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: ChangeMembershipRoleDto,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    await assertIdentityPermission(context, this.membershipRepository, this.permissionPolicy, 'membership.role.assign');
    return unwrapOrThrow(await this.memberships.changeRole(context, membershipId, dto.role));
  }
}
