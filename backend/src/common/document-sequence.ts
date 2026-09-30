import type { Prisma } from '@prisma/client';

/**
 * Per-tenant document numbers. One statement takes the next number of a
 * (tenant, key) pair and locks only that row until the transaction ends, so two
 * concurrent documents of the same kind queue briefly and two tenants never
 * touch each other. A rolled-back transaction gives its number back (the update
 * rolls back with it), so a tenant's numbers have no gaps.
 */
export const DOCUMENT_NUMBER_FORMATS = {
  /** Customer returns: `R-000001`. */
  return: { prefix: 'R-', digits: 6 },
  /** Stock adjustments: `ADJ-000001`. */
  adjustment: { prefix: 'ADJ-', digits: 6 },
  /** Stock counts: `CNT-000001`. */
  count: { prefix: 'CNT-', digits: 6 },
  /** Invoices created on the server (online exchange); POS invoices carry their terminal's number. */
  invoice: { prefix: 'INV-', digits: 6 },
  /** POS terminal codes: `POS1`, `POS2`. Never reused, even after a terminal is retired. */
  terminal: { prefix: 'POS', digits: 1 },
} as const;

export type DocumentKey = keyof typeof DOCUMENT_NUMBER_FORMATS;

export function formatDocumentNumber(key: DocumentKey, value: bigint | number): string {
  const { prefix, digits } = DOCUMENT_NUMBER_FORMATS[key];
  return `${prefix}${String(value).padStart(digits, '0')}`;
}

/** Takes the next number of `key` for the tenant: 1 the first time. */
export async function nextDocumentValue(tx: Prisma.TransactionClient, tenantId: string, key: DocumentKey): Promise<bigint> {
  const [row] = await tx.$queryRaw<Array<{ last_value: bigint }>>`
    INSERT INTO "DocumentSequence" ("tenant_id", "key", "last_value")
    VALUES (${tenantId}::uuid, ${key}, 1)
    ON CONFLICT ("tenant_id", "key") DO UPDATE SET "last_value" = "DocumentSequence"."last_value" + 1
    RETURNING "last_value"
  `;
  return row!.last_value;
}

/** The next formatted number, e.g. `ADJ-000042`. */
export async function nextDocumentNumber(tx: Prisma.TransactionClient, tenantId: string, key: DocumentKey): Promise<string> {
  return formatDocumentNumber(key, await nextDocumentValue(tx, tenantId, key));
}
