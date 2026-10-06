import { Prisma } from '@prisma/client';

interface LateSale {
  tenantId: string;
  actorId: string | null;
  invoiceId: string;
  syncId: string;
  terminalSequence: string;
  cash: Prisma.Decimal;
}

/**
 * A sale may legitimately arrive after its shift was closed because the till
 * was offline. Keep the immutable close count, but reconcile the stored
 * expected cash and variance so the closed shift stays financially correct
 * instead of silently omitting the late command.
 */
export async function reconcileLateShiftSale(
  tx: Prisma.TransactionClient,
  shift: { id: string; status: string; expected_cash: unknown; difference: unknown } | null,
  sale: LateSale,
): Promise<void> {
  if (shift?.status !== 'closed' || !sale.cash.greaterThan(0) || shift.expected_cash === null || shift.difference === null) return;
  // Atomic Decimal updates prevent two late tills from overwriting each
  // other's shift reconciliation when they reconnect concurrently.
  await tx.shift.update({
    where: { id: shift.id },
    data: { expected_cash: { increment: sale.cash }, difference: { decrement: sale.cash } },
  });
  await tx.auditLog.create({
    data: {
      tenant_id: sale.tenantId,
      user_id: sale.actorId,
      action: 'shift.late_offline_sale.reconciled',
      entity: 'Shift',
      entity_id: shift.id,
      meta: {
        invoice_id: sale.invoiceId,
        sync_id: sale.syncId,
        terminal_sequence: sale.terminalSequence,
        expected_cash_increment: sale.cash,
        difference_decrement: sale.cash,
      },
    },
  });
}
