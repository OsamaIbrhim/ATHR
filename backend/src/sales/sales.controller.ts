import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { SalesService } from './sales.service'
import { SalesReadService } from './sales-read.service'
import { InvoicePdfService } from './invoice-pdf.service'
import { RequireCapabilities, Roles } from '../auth/roles.guard'
import { CreateSaleDto } from './dto/create-sale.dto'
import { AuthenticatedUser } from '../auth/authenticated-user'
import { CreateReturnDto } from './dto/create-return.dto'
import { ListSalesDto } from './dto/list-sales.dto'
import { resolveBranchScope } from '../auth/branch-access'
import { TerminalsService } from '../terminals/terminals.service'
import { ListReturnsDto } from './dto/list-returns.dto'
import { PosProtocolGuard } from '../updates/pos-protocol.guard'
import { RequirePermission } from '../identity/permission.guard'
import { TenantCtx } from '../identity/tenant-context.decorator'
import type { TenantContext } from '../identity/tenant-context.type'
import { Public } from '../auth/public.decorator'

@Controller()
export class SalesController {
  constructor(
    private svc: SalesService,
    private reads: SalesReadService,
    private pdfService: InvoicePdfService,
    private terminals: TerminalsService,
  ) {}

  @Roles('owner', 'branch_manager', 'cashier')
  @RequireCapabilities('sales.read')
  @RequirePermission('sales.sale.view')
  @Get('sales')
  listSales(
    @TenantCtx() ctx: TenantContext,
    @Query() dto: ListSalesDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const branchId = resolveBranchScope(
      req.user,
      dto.branch_id,
      ['owner'],
    )

    return this.reads.listSales(ctx, dto, branchId)
  }

  @Roles('owner', 'branch_manager', 'cashier')
  @RequireCapabilities('sales.read')
  @RequirePermission('sales.sale.view')
  @Get('sales/:id')
  getSale(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.getInvoice(ctx, id, req.user)
  }

  @Public()
  @UseGuards(new PosProtocolGuard())
  @Post('pos/sale')
  async sale(
    @Body() dto: CreateSaleDto,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
  ) {
    const terminal = await this.terminals.authenticateDevice(
      deviceId,
      deviceToken,
    )

    const result = await this.svc.createSale(dto, terminal)
    this.reads.invalidateCounts()
    return result
  }

  @Roles('owner', 'branch_manager', 'cashier')
  @RequireCapabilities('returns.create')
  @UseGuards(new PosProtocolGuard())
  @RequirePermission('returns.return.request')
  @Post('pos/return')
  async ret(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CreateReturnDto,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    if (req.user.role !== 'owner') {
      await this.terminals.authenticate(
        deviceId,
        deviceToken,
        req.user,
      )
    }

    return this.svc.createReturn(ctx, dto, req.user)
  }

  @Roles('owner', 'branch_manager', 'cashier')
  @RequireCapabilities('returns.create')
  @UseGuards(new PosProtocolGuard())
  @RequirePermission('returns.return.view')
  @Get('pos/invoices/lookup')
  async lookupInvoice(
    @TenantCtx() ctx: TenantContext,
    @Query('reference') reference: string,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    if (!reference?.trim()) {
      throw new BadRequestException('reference is required')
    }

    if (req.user.role !== 'owner') {
      await this.terminals.authenticate(
        deviceId,
        deviceToken,
        req.user,
      )
    }

    return this.svc.findReturnableInvoice(
      ctx,
      reference.trim(),
      req.user,
    )
  }

  @Get('sales/:id/pdf')
  @Roles('owner', 'branch_manager', 'cashier')
  @RequireCapabilities('sales.read')
  @Header('Content-Type', 'application/pdf')
  async getPdf(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Query('lang') lang: 'ar' | 'en' = 'ar',
    @Req() req: Request & { user: AuthenticatedUser },
    @Res() res: Response,
  ) {
    const invoice = await this.svc.getInvoice(ctx, id, req.user)
    const buf = await this.pdfService.render(
      { ...invoice, created_at: invoice.occurred_at },
      lang,
    )

    res.set({
      'Content-Disposition':
        `inline; filename="athr-${invoice.invoice_number}-${lang}.pdf"`,
    })

    res.send(buf)
  }

  @Roles('owner', 'branch_manager', 'cashier')
  @RequireCapabilities('sales.read')
  @RequirePermission('returns.return.view')
  @Get('returns')
  listReturns(
    @TenantCtx() ctx: TenantContext,
    @Query() dto: ListReturnsDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const branchId = resolveBranchScope(
      req.user,
      dto.branch_id,
      ['owner'],
    )

    return this.svc.listReturns(ctx, dto, branchId)
  }
}
