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

  async list(context: TenantScope, branchId?: string): Promise<Shift[]> {
    return this.prisma.shift.findMany({
      where: { tenant_id: context.tenantId, ...(branchId ? { branch_id: branchId } : {}) },
      orderBy: { opened_at: 'desc' },
      take: 50,
    });
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
    return this.prisma.salesInvoice.aggregate({
      where: {
        tenant_id: context.tenantId,
        shift_id: shiftId,
        status: 'completed',
        payment_method: 'cash',
      },
      _sum: { total: true },
    });
  }

  async sumCashReturns(context: TenantScope, shiftId: string) {
    return this.prisma.return.aggregate({
      where: {
        tenant_id: context.tenantId,
        shift_id: shiftId,
        status: 'completed',
        original_invoice: { payment_method: 'cash', tenant_id: context.tenantId },
      },
      _sum: { refund_total: true },
    });
  }
}
