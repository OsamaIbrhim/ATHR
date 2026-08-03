import { Body, Controller, Get, Param, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { AthrExceptionFilter } from '../common/http/athr-exception.filter';
import { Envelope } from '../common/http/response-envelope.interceptor';
import { IdempotencyKeyGuard, RequiresIdempotencyKey } from '../common/http/idempotency-key.guard';
import { assertIdentityPermission } from './authorize.util';
import { CreateSupportAccessGrantDto } from './dto/create-support-access-grant.dto';
import { MembershipRepository } from './membership.repository';
import { PermissionPolicyService } from './permission-policy.service';
import { RequestWithIdentity, resolveContextOrThrow } from './resolve-tenant-context.util';
import { SupportAccessGrantService } from './support-access-grant.service';
import { TenantContextResolver } from './tenant-context.resolver';
import { unwrapOrThrow } from './unwrap-result.util';

/**
 * ADR-0006 / BR-SUPA-*: minimal grant model — data model and service only,
 * per WP-006 §2 item 7 (the Platform Operator support-tooling UI/auth is a
 * later WP). Creation here is gated behind the same Tenant permission model
 * as everything else in this module (`support_access.grant`, the most
 * sensitive operation in the BR-ADM-100 catalog) as a stand-in for that
 * later Platform Operator workflow — it records real consent-tracking
 * fields (`consent_obtained`, `approved_by_identity_id`) rather than
 * skipping them.
 */
@Controller('tenants/:tenantId/support-access-grants')
@UseFilters(AthrExceptionFilter)
export class SupportAccessGrantController {
  constructor(
    private readonly grants: SupportAccessGrantService,
    private readonly membershipRepository: MembershipRepository,
    private readonly permissionPolicy: PermissionPolicyService,
    private readonly tenantContext: TenantContextResolver,
  ) {}

  @Get()
  @Envelope('list')
  async list(@Param('tenantId') tenantId: string, @Req() req: RequestWithIdentity) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    await assertIdentityPermission(context, this.membershipRepository, this.permissionPolicy, 'support_access.grant');
    const items = await this.grants.list(context);
    return { items, page: { limit: items.length, next_cursor: null, previous_cursor: null, has_more: false } };
  }

  @Get(':grantId')
  @Envelope('query')
  async get(
    @Param('tenantId') tenantId: string,
    @Param('grantId') grantId: string,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    await assertIdentityPermission(context, this.membershipRepository, this.permissionPolicy, 'support_access.grant');
    return this.grants.findById(context, grantId);
  }

  @Post()
  @Envelope('command')
  @RequiresIdempotencyKey()
  @UseGuards(IdempotencyKeyGuard)
  async create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateSupportAccessGrantDto,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    await assertIdentityPermission(context, this.membershipRepository, this.permissionPolicy, 'support_access.grant');
    const result = await this.grants.create(context, {
      operatorIdentityId: dto.operator_identity_id,
      mode: dto.mode,
      purpose: dto.purpose,
      scopes: dto.scopes,
      reason: dto.reason,
      expiresAt: new Date(dto.expires_at),
      readOnly: dto.read_only,
      approvedByIdentityId: dto.approved_by_identity_id ?? req.user.sub,
      consentObtained: dto.consent_obtained,
    });
    return unwrapOrThrow(result);
  }

  @Post(':grantId/revoke')
  @Envelope('command')
  @RequiresIdempotencyKey()
  @UseGuards(IdempotencyKeyGuard)
  async revoke(
    @Param('tenantId') tenantId: string,
    @Param('grantId') grantId: string,
    @Req() req: RequestWithIdentity,
  ) {
    const context = await resolveContextOrThrow(this.tenantContext, req, tenantId);
    await assertIdentityPermission(context, this.membershipRepository, this.permissionPolicy, 'support_access.grant');
    return this.grants.revoke(context, grantId);
  }
}
