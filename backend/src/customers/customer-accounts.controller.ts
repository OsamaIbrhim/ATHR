import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { PageQueryDto } from '../common/page-query.dto';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { CustomerAccountsService } from './customer-accounts.service';
import { CollectPaymentDto, SetCreditLimitDto } from './dto/customer-account.dto';

/**
 * Credit accounts of customers. Declared before CustomersController in the
 * module so `GET /customers/debtors` is not read as `GET /customers/:id`.
 */
@Controller('customers')
export class CustomerAccountsController {
  constructor(private readonly accounts: CustomerAccountsService) {}

  @RequirePermission('customer.account.view')
  @Get('debtors')
  debtors(@TenantCtx() ctx: TenantContext, @Query() paging: PageQueryDto, @Query('q') q?: string) {
    return this.accounts.debtors(ctx, paging, q);
  }

  @RequirePermission('customer.account.view')
  @Get(':id/statement')
  statement(@TenantCtx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Query() paging: PageQueryDto) {
    return this.accounts.statement(ctx, id, paging);
  }

  @RequirePermission('customer.account.collect')
  @Post(':id/payments')
  collect(
    @TenantCtx() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectPaymentDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.accounts.collectPayment(ctx, id, dto, req.user);
  }

  @RequirePermission('customer.credit.manage')
  @Put(':id/credit-limit')
  setCreditLimit(@TenantCtx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCreditLimitDto) {
    return this.accounts.setCreditLimit(ctx, id, dto.credit_limit);
  }
}
