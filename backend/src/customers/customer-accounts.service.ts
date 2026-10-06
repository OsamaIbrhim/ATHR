import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PaymentMethod } from '@prisma/client';
import { assertBranchAccess } from '../auth/branch-access';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { FIRST_PAGE, pageArgs, pageOf, type PageQuery } from '../common/pagination';
import { money } from '../common/money';
import type { TenantContext } from '../identity/tenant-context.type';
import { PrismaService } from '../prisma/prisma.service';
import { postLedgerEntry } from './customer-ledger';
import type { CollectPaymentDto } from './dto/customer-account.dto';

export interface CollectionResult {
  id: string;
  customer_id: string;
  amount: string;
  method: string | null;
  balance_after: string;
  shift_id: string | null;
  replayed: boolean;
}

/** What owing, paying and the account statement look like for a customer. */
@Injectable()
export class CustomerAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Takes a payment against a customer's debt. Idempotent on `idempotency_key`:
   * the same key with the same content returns the first result, with other
   * content it is a conflict. Cash taken in an open shift enters that shift's
   * expected cash (see ShiftsRepository.sumCashCollections).
   */
  async collectPayment(
    context: TenantContext,
    customerId: string,
    dto: CollectPaymentDto,
    actor: AuthenticatedUser,
  ): Promise<CollectionResult> {
    const amount = money(dto.amount);
    return this.prisma.$transaction(async (tx) => {
      // Locks the customer so a replay and a concurrent collection queue behind each other.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Customer"
        WHERE "id" = ${customerId}::uuid AND "tenant_id" = ${context.tenantId}::uuid
        FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException('Customer not found');

      const existing = await tx.customerLedgerEntry.findFirst({
        where: { tenant_id: context.tenantId, idempotency_key: dto.idempotency_key },
      });
      if (existing) {
        const same =
          existing.customer_id === customerId &&
          existing.type === 'payment' &&
          existing.amount.negated().equals(amount) &&
          existing.method === dto.method;
        if (!same) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message_ar: 'مفتاح التكرار مستخدم لعملية تحصيل مختلفة.',
            message: 'idempotency_key already belongs to a different collection',
          });
        }
        return {
          id: existing.id,
          customer_id: customerId,
          amount: amount.toString(),
          method: existing.method,
          balance_after: existing.balance_after.toString(),
          shift_id: existing.shift_id,
          replayed: true,
        };
      }

      if (dto.shift_id) {
        const shift = await tx.shift.findFirst({
          where: { id: dto.shift_id, tenant_id: context.tenantId, status: 'open' },
          select: { branch_id: true },
        });
        if (!shift) throw new ConflictException({ code: 'SHIFT_NOT_OPEN', message: 'The shift is not open' });
        assertBranchAccess(actor, shift.branch_id);
      }

      const posted = (await postLedgerEntry(tx, {
        tenantId: context.tenantId,
        customerId,
        type: 'payment',
        amount: amount.negated(),
        method: dto.method as PaymentMethod,
        shiftId: dto.shift_id ?? null,
        idempotencyKey: dto.idempotency_key,
        note: dto.note?.trim() || null,
        createdBy: actor.sub,
      }))!;
      await tx.auditLog.create({
        data: {
          tenant_id: context.tenantId,
          user_id: actor.sub,
          action: 'customer.payment.collected',
          entity: 'Customer',
          entity_id: customerId,
          meta: { amount: amount.toString(), method: dto.method, shift_id: dto.shift_id ?? null, entry_id: posted.id },
        },
      });
      return {
        id: posted.id,
        customer_id: customerId,
        amount: amount.toString(),
        method: dto.method,
        balance_after: posted.balance_after.toString(),
        shift_id: dto.shift_id ?? null,
        replayed: false,
      };
    });
  }

  /** Customers who owe, biggest debt first, with what they owe in total. */
  async debtors(context: TenantContext, paging: PageQuery = FIRST_PAGE, q?: string) {
    const where: Prisma.CustomerWhereInput = {
      tenant_id: context.tenantId,
      balance: { gt: 0 },
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {}),
    };
    const [total, owed, items] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.aggregate({ where, _sum: { balance: true } }),
      this.prisma.customer.findMany({
        where,
        select: { id: true, name: true, phone: true, balance: true, credit_limit: true, total_invoices: true },
        orderBy: [{ balance: 'desc' }, { id: 'asc' }],
        ...pageArgs(paging),
      }),
    ]);
    return { ...pageOf(items, total, paging), total_owed: owed._sum.balance ?? new Prisma.Decimal(0) };
  }

  /** The customer's account: balance, limit and the ledger, newest first. */
  async statement(context: TenantContext, customerId: string, paging: PageQuery = FIRST_PAGE) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenant_id: context.tenantId },
      select: { id: true, name: true, phone: true, balance: true, credit_limit: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const where = { tenant_id: context.tenantId, customer_id: customerId };
    const [total, entries] = await Promise.all([
      this.prisma.customerLedgerEntry.count({ where }),
      this.prisma.customerLedgerEntry.findMany({
        where,
        select: {
          id: true,
          type: true,
          amount: true,
          balance_after: true,
          method: true,
          note: true,
          occurred_at: true,
          sales_invoice: { select: { id: true, invoice_number: true } },
          return_record: { select: { id: true, return_invoice_number: true } },
        },
        orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
        ...pageArgs(paging),
      }),
    ]);
    return { customer, ...pageOf(entries, total, paging) };
  }

  async setCreditLimit(context: TenantContext, customerId: string, creditLimit: number | null) {
    const changed = await this.prisma.customer.updateMany({
      where: { id: customerId, tenant_id: context.tenantId },
      data: { credit_limit: creditLimit === null ? null : money(creditLimit) },
    });
    if (!changed.count) throw new NotFoundException('Customer not found');
    return { id: customerId, credit_limit: creditLimit };
  }
}
