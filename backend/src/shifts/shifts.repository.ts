import { FIRST_PAGE, pageArgs, pageOf, type PageQuery } from '../common/pagination';
import { Injectable } from '@nestjs/common';
import type { Prisma, Shift } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantScope } from '../identity/tenant-context.type';

type Db = PrismaService | Prisma.TransactionClient;

/** WP-007 Phase A §A.3.2 — tenant-scoped repository for the `shifts` module. */
@Injectable()
export class ShiftsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string, db: Db = this.prisma): Promise<Shift | null> {
    return db.shift.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async findOpenForBranch(
    context: TenantScope,
    branchId: string,
    db: Db = this.prisma,
  ): Promise<Shift | null> {
    return db.shift.findFirst({
      where: { tenant_id: context.tenantId, branch_id: branchId, status: 'open' },
    });
  }

  async list(context: TenantScope, branchId?: string, paging: PageQuery = FIRST_PAGE) {
    const where = { tenant_id: context.tenantId, ...(branchId ? { branch_id: branchId } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.shift.findMany({ where, orderBy: [{ opened_at: 'desc' }, { id: 'desc' }], ...pageArgs(paging) }),
      this.prisma.shift.count({ where }),
    ]);
    return pageOf(items, total, paging);
  }

  async findActiveBranch(context: TenantScope, branchId: string, db: Db = this.prisma) {
    return db.branch.findFirst({
      where: { id: branchId, tenant_id: context.tenantId, is_active: true },
      select: { id: true },
    });
  }

  async save(
    context: TenantScope,
    data: Omit<Prisma.ShiftUncheckedCreateInput, 'tenant_id'>,
    db: Db = this.prisma,
  ): Promise<Shift> {
    return db.shift.create({ data: { ...data, tenant_id: context.tenantId } });
  }

  /** The conditional close is the real mutation, so it carries the predicate itself. */
  async closeIfOpen(
    context: TenantScope,
    id: string,
    data: Prisma.ShiftUncheckedUpdateInput,
  ): Promise<number> {
    const changed = await this.prisma.shift.updateMany({
      where: { id, tenant_id: context.tenantId, status: 'open' },
      data,
    });
    return changed.count;
  }

  async sumCashSales(context: TenantScope, shiftId: string) {
    return this.prisma.salesPayment.aggregate({
      where: {
        tenant_id: context.tenantId,
        method: 'cash',
        invoice: { tenant_id: context.tenantId, shift_id: shiftId, status: 'completed' },
      },
      _sum: { amount: true },
    });
  }

  /** Cash taken against customers' debts at this shift's till (ledger payments, stored negative). */
  async sumCashCollections(context: TenantScope, shiftId: string) {
    return this.prisma.customerLedgerEntry.aggregate({
      where: { tenant_id: context.tenantId, shift_id: shiftId, type: 'payment', method: 'cash' },
      _sum: { amount: true },
    });
  }

  async sumCashReturns(context: TenantScope, shiftId: string) {
    return this.prisma.return.aggregate({
      where: {
        tenant_id: context.tenantId,
        shift_id: shiftId,
        status: 'completed',
        refund_method: 'cash',
      },
      _sum: { refund_total: true },
    });
  }
}
