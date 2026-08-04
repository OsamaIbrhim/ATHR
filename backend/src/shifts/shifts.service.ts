import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PosTerminal, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';
import { randomUUID } from 'crypto';
import { requireResourceId } from '../common/resource-id';
import { ShiftsRepository } from './shifts.repository';
import type { TenantContext } from '../identity/tenant-context.type';

@Injectable()
export class ShiftsService {
  constructor(
    private prisma: PrismaService,
    private readonly repository: ShiftsRepository,
  ) {}

  async open(
    context: TenantContext,
    branch_id: string,
    actor: AuthenticatedUser,
    opening_cash = 0,
  ) {
    assertBranchAccess(actor, branch_id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${branch_id}))`;
      const branch = await this.repository.findActiveBranch(context, branch_id, tx);
      if (!branch) throw new NotFoundException('Active branch not found');
      const existing = await this.repository.findOpenForBranch(context, branch_id, tx);
      if (existing) return existing;
      return this.repository.save(
        context,
        {
          branch_id,
          opened_by: actor.sub,
          opening_cash,
          status: 'open',
        },
        tx,
      );
    });
  }

  async issueOfflineContext(
    context: TenantContext,
    id: string,
    actor: AuthenticatedUser,
    terminal: Pick<PosTerminal, 'id' | 'branch_id' | 'last_sale_sequence'>,
  ) {
    const shiftId = requireResourceId(id, 'shift_id');
    if (actor.role !== 'cashier' && actor.role !== 'branch_manager') {
      throw new ForbiddenException('Only POS cashiers and branch managers can receive an offline accounting context');
    }
    const shift = await this.repository.findById(context, shiftId);
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.status !== 'open' || shift.closed_at) {
      throw new ConflictException('Offline accounting context requires an open shift');
    }
    if (
      actor.branch_id !== shift.branch_id ||
      terminal.branch_id !== shift.branch_id
    ) {
      throw new ForbiddenException('The cashier, terminal and shift must belong to the same branch');
    }

    const now = Date.now();
    const configuredTtl = Number(
      process.env.POS_OFFLINE_CONTEXT_TTL_MS || 24 * 60 * 60 * 1000,
    );
    const ttlMs =
      Number.isInteger(configuredTtl) && configuredTtl >= 15 * 60 * 1000
        ? configuredTtl
        : 24 * 60 * 60 * 1000;
    return {
      context_version: 2,
      session_id: randomUUID(),
      user_id: actor.sub,
      role: actor.role,
      branch_id: shift.branch_id,
      terminal_id: terminal.id,
      shift_id: shift.id,
      issued_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttlMs).toISOString(),
      server_last_sale_sequence: terminal.last_sale_sequence.toString(),
    };
  }

  async close(
    context: TenantContext,
    id: string,
    actor: AuthenticatedUser,
    closing_cash: number,
  ) {
    const shiftId = requireResourceId(id, 'shift_id');
    const shift = await this.repository.findById(context, shiftId);
    if (!shift) throw new NotFoundException('Shift not found');

    assertBranchAccess(actor, shift.branch_id);
    if (shift.status !== 'open') {
      throw new ConflictException('Shift is not open');
    }

    const closedAt = new Date();
    // Both cash aggregates are tenant-scoped: an unscoped sum would fold
    // another tenant's cash sales into this shift's expected drawer total and
    // report the difference as a till discrepancy.
    const [cashSales, cashReturns] = await Promise.all([
      this.repository.sumCashSales(context, shift.id),
      this.repository.sumCashReturns(context, shift.id),
    ]);

    const expectedCash = new Prisma.Decimal(shift.opening_cash)
      .plus(cashSales._sum.total ?? 0)
      .minus(cashReturns._sum.refund_total ?? 0)
      .toDecimalPlaces(2);
    const difference = new Prisma.Decimal(closing_cash)
      .minus(expectedCash)
      .toDecimalPlaces(2);

    const changed = await this.repository.closeIfOpen(context, shiftId, {
      closed_by: actor.sub,
      closing_cash,
      expected_cash: expectedCash,
      difference,
      closed_at: closedAt,
      status: 'closed',
    });
    if (changed !== 1) {
      throw new ConflictException('Shift was already closed');
    }
    return this.repository.findById(context, shiftId);
  }

  list(context: TenantContext, branch_id?: string) {
    return this.repository.list(context, branch_id);
  }

  current(context: TenantContext, branch_id: string) {
    return this.repository.findOpenForBranch(context, branch_id);
  }
}
