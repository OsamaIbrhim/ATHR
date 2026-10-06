import { Prisma, type CustomerLedgerType, type PaymentMethod } from '@prisma/client';

export interface LedgerPosting {
  readonly tenantId: string;
  readonly customerId: string;
  readonly type: CustomerLedgerType;
  /** Signed: + the customer owes more, - owes less. */
  readonly amount: Prisma.Decimal;
  readonly method?: PaymentMethod | null;
  readonly salesInvoiceId?: string | null;
  readonly returnId?: string | null;
  readonly shiftId?: string | null;
  readonly idempotencyKey?: string | null;
  readonly note?: string | null;
  readonly createdBy?: string | null;
}

export interface PostedEntry {
  readonly id: string;
  readonly balance_after: Prisma.Decimal;
}

/**
 * Moves a customer's balance by `amount` and appends the entry that explains it
 * in ONE statement, so the balance can never disagree with the ledger. The
 * UPDATE takes the customer row's lock; concurrent postings queue on it and each
 * entry records the balance it produced. Returns null when the customer does not
 * exist in this tenant.
 */
export async function postLedgerEntry(tx: Prisma.TransactionClient, posting: LedgerPosting): Promise<PostedEntry | null> {
  const [entry] = await tx.$queryRaw<PostedEntry[]>`
    WITH moved AS (
      UPDATE "Customer" SET "balance" = "balance" + ${posting.amount}
      WHERE "id" = ${posting.customerId}::uuid AND "tenant_id" = ${posting.tenantId}::uuid
      RETURNING "balance"
    )
    INSERT INTO "CustomerLedgerEntry" (
      "id", "tenant_id", "customer_id", "type", "amount", "balance_after", "method",
      "sales_invoice_id", "return_id", "shift_id", "idempotency_key", "note", "created_by"
    )
    SELECT gen_random_uuid(), ${posting.tenantId}::uuid, ${posting.customerId}::uuid,
      ${posting.type}::"CustomerLedgerType", ${posting.amount}, moved."balance", ${posting.method ?? null}::"PaymentMethod",
      ${posting.salesInvoiceId ?? null}::uuid, ${posting.returnId ?? null}::uuid, ${posting.shiftId ?? null}::uuid,
      ${posting.idempotencyKey ?? null}, ${posting.note ?? null}, ${posting.createdBy ?? null}::uuid
    FROM moved
    RETURNING "id", "balance_after"
  `;
  return entry ?? null;
}
