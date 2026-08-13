import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { RequireCapabilities } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { TaxCodeService } from './tax-code.service';
import { TaxExemptionService } from './tax-exemption.service';
import {
  CreateTaxCategoryDto,
  CreateTaxCodeDto,
  ListTaxCategoriesDto,
  ListTaxCodesDto,
  ScheduleTaxCodeDto,
  SupersedeTaxCodeDto,
  UpdateTaxCodeDraftDto,
} from './dto/tax-code.dto';
import {
  CreateTaxExemptionDto,
  ListTaxExemptionsDto,
  RevokeTaxExemptionDto,
} from './dto/tax-exemption.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

/**
 * WP-008 Phase C (BR-TAX-2xx, Permission Matrix §18).
 *
 * Every route is gated on the §18 key the Matrix names for that operation.
 * `tax.calculation.override` and `tax.export` intentionally gate NO route here
 * — see the Phase C PR description, which lists them as declared-but-unwired
 * rather than leaving that to be discovered. `tax.calculation.override` is
 * additionally granted to no role by default (BR-TAX-206).
 */
@Controller('tax')
@RequireCapabilities('products.read')
export class TaxController {
  constructor(
    private readonly codes: TaxCodeService,
    private readonly exemptions: TaxExemptionService,
  ) {}

  // --- Categories ----------------------------------------------------------

  @RequirePermission('tax.code.view')
  @Get('categories')
  listCategories(@TenantCtx() ctx: TenantContext, @Query() dto: ListTaxCategoriesDto) {
    return this.codes.listCategories(ctx, dto);
  }

  @RequirePermission('tax.rule.create')
  @Post('categories')
  createCategory(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CreateTaxCategoryDto,
    @Req() req: AuthedRequest,
  ) {
    return this.codes.createCategory(ctx, req.user.sub, dto);
  }

  // --- Codes ---------------------------------------------------------------

  @RequirePermission('tax.code.view')
  @Get('codes')
  list(@TenantCtx() ctx: TenantContext, @Query() dto: ListTaxCodesDto) {
    return this.codes.list(ctx, dto);
  }

  @RequirePermission('tax.code.view')
  @Get('codes/:id')
  get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.codes.findOne(ctx, id);
  }

  @RequirePermission('tax.rule.create')
  @Post('codes')
  create(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CreateTaxCodeDto,
    @Req() req: AuthedRequest,
  ) {
    return this.codes.create(ctx, req.user.sub, dto);
  }

  @RequirePermission('tax.rule.update-draft')
  @Patch('codes/:id')
  updateDraft(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateTaxCodeDraftDto,
  ) {
    return this.codes.updateDraft(ctx, id, dto);
  }

  @RequirePermission('tax.rule.submit')
  @Post('codes/:id/submit')
  submit(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.codes.submit(ctx, req.user.sub, id);
  }

  @RequirePermission('tax.rule.approve')
  @Post('codes/:id/approve')
  approve(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.codes.approve(ctx, req.user.sub, id);
  }

  @RequirePermission('tax.rule.schedule')
  @Post('codes/:id/schedule')
  schedule(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: ScheduleTaxCodeDto,
    @Req() req: AuthedRequest,
  ) {
    return this.codes.schedule(ctx, req.user.sub, id, dto);
  }

  @RequirePermission('tax.rule.activate')
  @Post('codes/:id/activate')
  activate(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.codes.activate(ctx, req.user.sub, id);
  }

  @RequirePermission('tax.rule.supersede')
  @Post('codes/:id/supersede')
  supersede(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: SupersedeTaxCodeDto,
    @Req() req: AuthedRequest,
  ) {
    return this.codes.supersede(ctx, req.user.sub, id, dto);
  }

  // --- Exemptions (BR-TAX-205) ---------------------------------------------

  @RequirePermission('tax.code.view')
  @Get('exemptions')
  listExemptions(@TenantCtx() ctx: TenantContext, @Query() dto: ListTaxExemptionsDto) {
    return this.exemptions.list(ctx, dto);
  }

  @RequirePermission('tax.exemption.apply')
  @Post('exemptions')
  applyExemption(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CreateTaxExemptionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.exemptions.apply(ctx, req.user.sub, dto);
  }

  @RequirePermission('tax.exemption.approve')
  @Post('exemptions/:id/approve')
  approveExemption(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.exemptions.approve(ctx, req.user.sub, id);
  }

  @RequirePermission('tax.exemption.approve')
  @Post('exemptions/:id/revoke')
  revokeExemption(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: RevokeTaxExemptionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.exemptions.revoke(ctx, req.user.sub, id, dto);
  }
}
