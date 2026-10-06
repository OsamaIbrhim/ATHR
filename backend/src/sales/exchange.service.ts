import { ConflictException, Injectable } from '@nestjs/common';
import type { PosTerminal } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { TenantContext } from '../identity/tenant-context.type';
import { PrismaService } from '../prisma/prisma.service';
import type { ExchangeDto } from './dto/exchange.dto';
import { ReturnsService } from './returns.service';
import { getSaleTransactionOptions } from './sale-transaction';
import { SalesService } from './sales.service';

/**
 * Exchange = a return and a new sale in ONE transaction, linked by
 * `Return.new_invoice_id`. Both are booked exactly as they are on their own: the
 * sale is a normal POS sale (its own invoice number, payments, discounts), the
 * return refunds what was paid for the returned units the way `refund_method`
 * says. Money settles through those two documents: a customer who takes goods
 * worth more pays the new sale and is refunded the return (the drawer nets to
 * the difference); one who takes less can have the refund put on their account
 * (`refund_method: credit`), against a new sale paid with `credit`.
 *
 * Online only: the return needs the server (W4 brings offline exchange).
 */
@Injectable()
export class ExchangeService {
  constructor(
    private prisma: PrismaService,
    private sales: SalesService,
    private returns: ReturnsService,
  ) {}

  async exchange(
    context: TenantContext,
    dto: ExchangeDto,
    actor: AuthenticatedUser,
    terminal: Pick<PosTerminal, 'id' | 'branch_id' | 'tenant_id'>,
  ) {
    const { sale: saleCommand, ...returnCommand } = dto;
    const done = await this.prisma.$transaction(async (tx) => {
      const invoice = await this.sales.bookSaleIn(tx, saleCommand, terminal);

      // A replay of the same sale command finds its return already linked.
      const existing = await tx.return.findFirst({
        where: { tenant_id: context.tenantId, new_invoice_id: invoice.id },
        include: { items: true },
      });
      if (existing) {
        if (existing.original_invoice_id !== dto.original_invoice_id) {
          throw new ConflictException({
            code: 'SALE_IDEMPOTENCY_CONTEXT_CONFLICT',
            message: 'This sale already belongs to an exchange of another invoice',
          });
        }
        return { invoice, record: existing };
      }
      const record = await this.returns.bookReturn(tx, context, returnCommand, actor, { newInvoiceId: invoice.id });
      return { invoice, record };
    }, getSaleTransactionOptions());

    return {
      sale: { ...done.invoice, items: done.invoice.items.map(({ unit_cost: _unitCost, ...item }) => item) },
      return: await this.returns.forActor(done.record, actor),
    };
  }
}
