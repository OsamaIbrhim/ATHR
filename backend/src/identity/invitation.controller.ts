import { Body, Controller, Get, Param, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { AthrExceptionFilter } from '../common/http/athr-exception.filter';
import { Envelope } from '../common/http/response-envelope.interceptor';
import { IdempotencyKeyGuard, RequiresIdempotencyKey } from '../common/http/idempotency-key.guard';
import { assertIdentityPermission } from './authorize.util';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationService } from './invitation.service';
import { MembershipRepository } from './membership.repository';
import { PermissionPolicyService } from './permission-policy.service';
import { RequestWithIdentity, resolveContextOrThrow } from './resolve-tenant-context.util';
import { TenantContextResolver } from './tenant-context.resolver';
import { unwrapOrThrow } from './unwrap-result.util';

/** New, additive endpoints per WP-006 §2 item 2, BR-INVIT-*. */
@Controller('tenants/:tenantId/invitations')
@UseFilters(AthrExceptionFilter)
export class InvitationController {
  constructor(
    private readonly invitations: InvitationService,
    private readonly membershipRepository: MembershipRepository,
    private readonly permissionPolicy: PermissionPolicyService,
    private readonly tenantContext: TenantContextResolver,
  ) {}

  @Get()
  @Envelope('list')
  async list(@Param('tenantId') tenantId: string, @Req() req: RequestWithIdentity) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    const items = await this.invitations.list(context);
    return { items, page: { limit: items.length, next_cursor: null, previous_cursor: null, has_more: false } };
  }

  @Get(':invitationId')
  @Envelope('query')
  async get(
    @Param('tenantId') tenantId: string,
    @Param('invitationId') invitationId: string,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    return this.invitations.findById(context, invitationId);
  }

  @Post()
  @Envelope('command')
  @RequiresIdempotencyKey()
  @UseGuards(IdempotencyKeyGuard)
  async create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateInvitationDto,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    await assertIdentityPermission(context, this.membershipRepository, this.permissionPolicy, 'membership.invite');
    const result = await this.invitations.create(context, {
      email: dto.email,
      role: dto.role,
      scopeType: dto.scope_type,
      scopeRefId: dto.scope_ref_id,
      purpose: dto.purpose,
      invitedById: context.membershipId ?? undefined,
    });
    return unwrapOrThrow(result);
  }

  /**
   * Not `resolveContextOrThrow`-gated: the accepting Identity has no
   * Membership in this Tenant yet (that is exactly what acceptance
   * creates), so there is no TenantContext to resolve beforehand. The
   * single-use token itself (never the route's `:tenantId`) is the trusted
   * source for which Tenant this grants access to, per Blueprint §17
   * ("Untrusted Inputs" — a URL segment is a hint only).
   */
  @Post('accept')
  @Envelope('command')
  @RequiresIdempotencyKey()
  @UseGuards(IdempotencyKeyGuard)
  async accept(@Body() dto: AcceptInvitationDto, @Req() req: RequestWithIdentity) {
    const result = await this.invitations.accept({ token: dto.token, acceptingIdentityId: req.user.sub });
    return unwrapOrThrow(result);
  }

  @Post(':invitationId/expire')
  @Envelope('command')
  @RequiresIdempotencyKey()
  @UseGuards(IdempotencyKeyGuard)
  async expire(
    @Param('tenantId') tenantId: string,
    @Param('invitationId') invitationId: string,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    await assertIdentityPermission(context, this.membershipRepository, this.permissionPolicy, 'membership.invite');
    return unwrapOrThrow(await this.invitations.expire(context, invitationId));
  }

  @Post(':invitationId/revoke')
  @Envelope('command')
  @RequiresIdempotencyKey()
  @UseGuards(IdempotencyKeyGuard)
  async revoke(
    @Param('tenantId') tenantId: string,
    @Param('invitationId') invitationId: string,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    await assertIdentityPermission(context, this.membershipRepository, this.permissionPolicy, 'membership.invite');
    return unwrapOrThrow(await this.invitations.revoke(context, invitationId));
  }
}
