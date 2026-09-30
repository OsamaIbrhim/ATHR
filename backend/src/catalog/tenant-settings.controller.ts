import { Body, Controller, Get, Put } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { PrismaService } from '../prisma/prisma.service';
import { parseScaleBarcodeConfig, readTenantSettings } from './tenant-settings';

@Controller('tenant-settings')
export class TenantSettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermission('catalog.product.view')
  @Get()
  async get(@TenantCtx() ctx: TenantContext) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });
    return readTenantSettings(tenant.settings);
  }

  @RequirePermission('tenant.settings.manage')
  @Put('scale-barcode')
  async setScaleBarcode(@TenantCtx() ctx: TenantContext, @Body() body: Record<string, unknown>) {
    const scale_barcode = parseScaleBarcodeConfig(body);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });
    const settings = { ...(tenant.settings as object), scale_barcode };
    await this.prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: { settings: settings as unknown as Prisma.InputJsonValue },
    });
    return readTenantSettings(settings as unknown as Prisma.JsonValue);
  }
}
