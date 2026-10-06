import { Body, Controller, Get, Put } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementService, featureNotInPlanError } from '../entitlements/entitlement.service';
import { applySalesSettingsUpdate, parseScaleBarcodeConfig, readTenantSettings } from './tenant-settings';

@Controller('tenant-settings')
export class TenantSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  /** Every tenant setting (the POS gets the same object when it syncs). */
  @RequirePermission('catalog.product.view')
  @Get()
  async get(@TenantCtx() ctx: TenantContext) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { settings: true, name: true, default_currency: true },
    });
    return { ...readTenantSettings(tenant.settings, tenant), currency: tenant.default_currency };
  }

  /** The sale and receipt settings, for the admin settings screen. */
  @RequirePermission('catalog.product.view')
  @Get('sales')
  async getSales(@TenantCtx() ctx: TenantContext) {
    return this.salesView(ctx.tenantId);
  }

  /**
   * Changes the sale and receipt settings. Send only what changes:
   * `{ sales?: { payment_methods?, return_window_days?, max_discount_percent? },
   *    receipt?: { store_name?, footer?, show_tax_breakdown? } }`.
   */
  @RequirePermission('tenant.settings.manage')
  @Put('sales')
  async setSales(@TenantCtx() ctx: TenantContext, @Body() body: Record<string, unknown>) {
    const hiding = (body?.receipt as { show_branding?: unknown } | undefined)?.show_branding === false;
    if (hiding) {
      const access = await this.entitlements.resolve(ctx.tenantId);
      if (!access.features.has('receipt.remove_branding')) throw featureNotInPlanError('receipt.remove_branding', access.planCode);
    }
    await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
      const { sales, receipt } = applySalesSettingsUpdate(tenant.settings, body);
      const settings = { ...(tenant.settings as object), sales, receipt };
      await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: settings as unknown as Prisma.InputJsonValue } });
    });
    return this.salesView(ctx.tenantId);
  }

  @RequirePermission('tenant.settings.manage')
  @Put('scale-barcode')
  async setScaleBarcode(@TenantCtx() ctx: TenantContext, @Body() body: Record<string, unknown>) {
    const scale_barcode = parseScaleBarcodeConfig(body);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { settings: true, name: true },
    });
    const settings = { ...(tenant.settings as object), scale_barcode };
    await this.prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: { settings: settings as unknown as Prisma.InputJsonValue },
    });
    return readTenantSettings(settings as unknown as Prisma.JsonValue, tenant);
  }

  private async salesView(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { settings: true, name: true, default_currency: true },
    });
    const { sales, receipt } = readTenantSettings(tenant.settings, tenant);
    return { sales, receipt, currency: tenant.default_currency };
  }
}
