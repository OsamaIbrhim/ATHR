import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PurchasingService } from './purchasing.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import {
  assertBranchAccess,
  resolveBranchScope,
} from '../auth/branch-access';
import {
  CreateSupplierReturnDto,
  OcrImportDto,
  ReceivePurchaseDto,
  ReversePurchaseDto,
} from './dto/receive-purchase.dto';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';

@Controller('purchasing')
@Roles('owner', 'branch_manager', 'warehouse_manager')
@RequireCapabilities('purchasing.read')
export class PurchasingController {
  constructor(private svc: PurchasingService) {}

  @RequirePermission('purchasing.purchase-order.view')
  @Get('invoices')
  list(
    @TenantCtx() ctx: TenantContext,
    @Query('branch_id') branch_id: string | undefined,
    @Query('take') take: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.list(
      ctx,
      resolveBranchScope(
        req.user,
        branch_id,
        ['owner', 'warehouse_manager'],
      ),
      Number(take) || 50,
    );
  }

  @RequirePermission('purchasing.purchase-order.view')
  @Get('invoices/:id')
  async get(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const invoice = await this.svc.get(ctx, id);
    if (!invoice) {
      throw new NotFoundException('Purchase invoice not found');
    }
    assertBranchAccess(
      req.user,
      invoice.branch_id,
      ['owner', 'warehouse_manager'],
    );
    return invoice;
  }

  @RequireCapabilities('purchasing.manage')
  @RequirePermission('purchasing.goods-receipt.post')
  @Post('receive')
  receive(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: ReceivePurchaseDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    assertBranchAccess(
      req.user,
      dto.branch_id,
      ['owner', 'warehouse_manager'],
    );
    return this.svc.receive(ctx, dto, req.user);
  }


  @RequireCapabilities('purchasing.manage')
  @RequirePermission('purchasing.supplier-return.post')
  @Post('invoices/:id/supplier-returns')
  async returnToSupplier(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: CreateSupplierReturnDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const invoice = await this.svc.get(ctx, id);
    if (!invoice) {
      throw new NotFoundException('Purchase invoice not found');
    }
    assertBranchAccess(
      req.user,
      invoice.branch_id,
      ['owner', 'warehouse_manager'],
    );
    return this.svc.returnToSupplier(ctx, id, dto, req.user);
  }

  @RequirePermission('purchasing.purchase-order.view')
  @Get('supplier-returns')
  listSupplierReturns(
    @TenantCtx() ctx: TenantContext,
    @Query('branch_id') branch_id: string | undefined,
    @Query('take') take: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const branch = resolveBranchScope(
      req.user,
      branch_id,
      ['owner', 'warehouse_manager'],
    );
    return this.svc.listSupplierReturns(
      ctx,
      branch,
      Number(take) || 100,
    );
  }

  @RequireCapabilities('purchasing.manage')
  @RequirePermission('purchasing.purchase-order.cancel')
  @Post('invoices/:id/reverse')
  async reverse(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: ReversePurchaseDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const invoice = await this.svc.get(ctx, id);
    if (!invoice) {
      throw new NotFoundException('Purchase invoice not found');
    }
    assertBranchAccess(
      req.user,
      invoice.branch_id,
      ['owner', 'warehouse_manager'],
    );
    return this.svc.reverse(ctx, id, dto, req.user);
  }

  @RequirePermission('purchasing.purchase-order.view')
  @Get('cost-movements')
  listCostMovements(
    @TenantCtx() ctx: TenantContext,
    @Query('branch_id') branch_id: string | undefined,
    @Query('variant_id') variant_id: string | undefined,
    @Query('take') take: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const branch = resolveBranchScope(
      req.user,
      branch_id,
      ['owner', 'warehouse_manager'],
    );
    return this.svc.listCostMovements(
      ctx,
      branch,
      variant_id,
      Number(take) || 100,
    );
  }

  @Roles('owner', 'warehouse_manager')
  @RequirePermission('purchasing.export')
  @Get('cost-reconciliation')
  costReconciliation(
    @TenantCtx() ctx: TenantContext,
    @Query('variant_id') variant_id: string | undefined,
  ) {
    return this.svc.costReconciliation(ctx, variant_id);
  }

  @RequireCapabilities('purchasing.manage')
  @Post('ocr-import')
  ocr(@Body() dto: OcrImportDto) {
    return this.svc.ocrImport(dto.fileUrl);
  }
}
