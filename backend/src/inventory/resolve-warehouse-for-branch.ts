import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * WP-009 Phase A PR2: every stock-mutating write keys on
 * `(warehouse_id, variant_id)`, not `(branch_id, variant_id)`. Every write
 * path resolves the acting branch's default Warehouse through this one
 * function, so the resolution rule lives in exactly one place.
 *
 * Resolve-only, deliberately never create-on-miss: by the time application
 * code runs, every Branch is guaranteed -- by migrations 202608220002/3 and
 * the InventoryStock/InventoryMovement NOT NULL constraint they precede --
 * to already have exactly one default Warehouse. A miss here means that
 * invariant broke somewhere else; inventing a Warehouse mid-transaction to
 * paper over it would hide the real defect instead of surfacing it
 * (CLAUDE.md §6 "fail loud on ambiguous data").
 */
export async function resolveWarehouseIdForBranch(
  tx: Prisma.TransactionClient,
  tenantId: string,
  branchId: string,
): Promise<string> {
  const warehouse = await tx.warehouse.findFirst({
    where: { tenant_id: tenantId, location_id: branchId, is_default: true },
    select: { id: true },
  });
  if (!warehouse) {
    throw new NotFoundException(
      `Branch ${branchId} has no default Warehouse; cannot record an inventory movement`,
    );
  }
  return warehouse.id;
}
