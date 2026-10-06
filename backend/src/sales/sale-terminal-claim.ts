import { Prisma } from '@prisma/client';

export interface TerminalClaim {
  branch_id: string;
  branch_code: string | null;
  terminal_code: string;
  settings: Prisma.JsonValue;
  previous_sequence: bigint;
}

/**
 * One statement locks the terminal row, advances its sale sequence and reads
 * the branch code and tenant settings. Advancing up front is safe: it is
 * monotonic (a replay or an older sequence changes nothing) and a failed sale
 * rolls the whole transaction back. The CTE reads the row after the lock is
 * granted, so `previous_sequence` is what the last committed sale left.
 */
export async function claimTerminalSequence(
  tx: Prisma.TransactionClient,
  terminalId: string,
  tenantId: string,
  terminalSequence: bigint,
): Promise<TerminalClaim | undefined> {
  const [claimed] = await tx.$queryRaw<TerminalClaim[]>`
    WITH locked AS (
      SELECT "id", "last_sale_sequence" FROM "PosTerminal"
      WHERE "id" = ${terminalId}::uuid AND "tenant_id" = ${tenantId}::uuid
      FOR UPDATE
    )
    UPDATE "PosTerminal" t
    SET "last_sale_sequence" = GREATEST(t."last_sale_sequence", ${terminalSequence}), "updated_at" = now()
    FROM locked
    WHERE t."id" = locked."id"
    RETURNING t."branch_id", t."terminal_code",
      (SELECT te."settings" FROM "Tenant" te WHERE te."id" = t."tenant_id") AS "settings",
      (SELECT b."code" FROM "Branch" b WHERE b."id" = t."branch_id" AND b."tenant_id" = t."tenant_id") AS "branch_code",
      locked."last_sale_sequence" AS "previous_sequence"
  `;
  return claimed;
}
