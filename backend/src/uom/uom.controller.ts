import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UomService } from './uom.service';
import { RequireFeature } from '../entitlements/entitlement.decorators';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { CreateUomDto, UpdateUomDto } from './dto/unit-of-measure.dto';
import { CreateUomConversionDto, ListUomConversionsDto, SupersedeUomConversionDto } from './dto/uom-conversion.dto';

// Every plan can read units of measure (products reference them); managing them is the `uom` feature.
@Controller('uom')
export class UomController {
  constructor(private svc: UomService) {}

  @RequirePermission('catalog.uom.view')
  @Get()
  list(@TenantCtx() ctx: TenantContext, @Query('include_archived') includeArchived?: string) {
    return this.svc.findAll(ctx, includeArchived === 'true');
  }

  @RequirePermission('catalog.uom.view')
  @Get('conversions')
  listConversions(@TenantCtx() ctx: TenantContext, @Query() dto: ListUomConversionsDto) {
    return this.svc.listConversions(ctx, dto);
  }

  @RequirePermission('catalog.uom.view')
  @Get(':id')
  get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.findOne(ctx, id);
  }

  @RequireFeature('uom')
  @RequirePermission('catalog.uom.create')
  @Post()
  create(@TenantCtx() ctx: TenantContext, @Body() dto: CreateUomDto) {
    return this.svc.create(ctx, dto);
  }

  @RequireFeature('uom')
  @RequirePermission('catalog.uom.update')
  @Patch(':id')
  update(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() dto: UpdateUomDto) {
    return this.svc.update(ctx, id, dto);
  }

  @RequireFeature('uom')
  @RequirePermission('catalog.uom-conversion.publish')
  @Post('conversions')
  createConversion(@TenantCtx() ctx: TenantContext, @Body() dto: CreateUomConversionDto) {
    return this.svc.createConversion(ctx, dto);
  }

  @RequireFeature('uom')
  @RequirePermission('catalog.uom-conversion.publish')
  @Post('conversions/:id/supersede')
  supersedeConversion(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: SupersedeUomConversionDto,
  ) {
    return this.svc.supersedeConversion(ctx, id, dto);
  }
}
