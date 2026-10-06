import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

export interface SaleCustomer {
  customerId: string;
  balanceAfter: Prisma.Decimal;
  creditLimitExceeded: boolean;
}

/**
 * Find-or-create the customer and book this sale on it in one statement (the
 * part paid on credit raises the balance in the same row update). The
 * (tenant_id, phone) unique key makes concurrent first sales safe.
 */
export async function bookCustomerSale(
  tx: Prisma.TransactionClient,
  tenantId: string,
  phone: string,
  total: Prisma.Decimal,
  credit: Prisma.Decimal,
): Promise<SaleCustomer> {
  const [customer] = await tx.$queryRaw<Array<{ id: string; balance: Prisma.Decimal; credit_limit: Prisma.Decimal | null }>>`
    INSERT INTO "Customer" ("id", "tenant_id", "phone", "whatsapp", "total_invoices", "total_spent", "balance")
    VALUES (${randomUUID()}::uuid, ${tenantId}::uuid, ${phone}, ${phone}, 1, ${total}, ${credit})
    ON CONFLICT ("tenant_id", "phone") DO UPDATE SET
      "total_invoices" = "Customer"."total_invoices" + 1,
      "total_spent" = "Customer"."total_spent" + EXCLUDED."total_spent",
      "balance" = "Customer"."balance" + EXCLUDED."balance"
    RETURNING "id", "balance", "credit_limit"
  `;
  const balanceAfter = new Prisma.Decimal(customer.balance);
  return {
    customerId: customer.id,
    balanceAfter,
    creditLimitExceeded:
      credit.greaterThan(0) && customer.credit_limit !== null && balanceAfter.greaterThan(customer.credit_limit),
  };
}
