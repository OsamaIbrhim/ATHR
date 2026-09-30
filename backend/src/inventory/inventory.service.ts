import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { InventoryRepository, type TrackingReconciliationRow } from './inventory.repository';
import { applyStock, readAverageCosts } from './inventory-writer';
import { readDrawnLots, readSerialRows } from './inventory-lot-sql';
import type { ApplyStockCommand, StockAfter } from './inventory.types';
import type { TenantContext } from '../identity/tenant-context.type';
import { quantityNumber } from '../common/quantity';

const WAREHOUSE_CACHE_MS = 60_000;

/**
 * The only writer of InventoryStock, InventoryMovement and InventoryCostMovement.
 * Sales, returns, purchasing, transfers and the seed all go through `apply`.
 */
@Injectable()
export class InventoryService {
  private readonly defaultWarehouses = new Map<string, { id: string; expiresAt: number }>();

  constructor(private readonly repository: InventoryRepository) {}

  /** Applies one command atomically inside the caller's transaction (see inventory-writer.ts). */
  apply(tx: Prisma.TransactionClient, command: ApplyStockCommand): Promise<StockAfter[]> {
    return applyStock(tx, command);
  }

  /** The serials / batches a document's lines took out of stock (a return finds what its sale line sold). */
  drawnLots(
    db: Pick<Prisma.TransactionClient, '$queryRaw'>,
    tenantId: string,
    reference: { type: string; id: string },
    lineIds: string[],
  ) {
    return readDrawnLots(db, tenantId, reference, lineIds);
  }

  /** The state of the named serials that exist (a return decides from it what to put back). */
  serialStates(
    tx: Prisma.TransactionClient,
    tenantId: string,
    pairs: Array<{ variantId: string; serial: string }>,
  ) {
    return readSerialRows(tx, tenantId, pairs);
  }

  /** Current moving-average cost per variant in a warehouse (rows that do not exist yet are absent). */
  averageCosts(
    db: Pick<Prisma.TransactionClient, '$queryRaw'>,
    tenantId: string,
    warehouseId: string,
    variantIds: string[],
  ) {
    return readAverageCosts(db, tenantId, warehouseId, variantIds);
  }

  /**
   * The warehouse a branch sells from. Cached briefly per process; pass the
   * transaction client when inside a transaction so a cache miss does not need
   * a second pooled connection.
   */
  async defaultWarehouseId(
    db: Pick<Prisma.TransactionClient, 'warehouse'>,
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const key = `${tenantId}:${branchId}`;
    const cached = this.defaultWarehouses.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.id;
    const id = await this.repository.findDefaultWarehouseId(db, tenantId, branchId);
    if (!id) {
      throw new ConflictException({
        code: 'BRANCH_HAS_NO_DEFAULT_WAREHOUSE',
        message: `Branch ${branchId} has no default warehouse`,
      });
    }
    this.defaultWarehouses.set(key, { id, expiresAt: Date.now() + WAREHOUSE_CACHE_MS });
    return id;
  }

  async lookup(context: TenantContext, variantId: string, branchId?: string) {
    return this.repository.findStock(context, variantId, branchId);
  }

  movements(context: TenantContext, variantId: string, branchId?: string, take = 100) {
    return this.repository.listMovements(context, variantId, branchId, take);
  }

  /**
   * Stock vs SUM(ledger) per warehouse and variant, plus the tracking
   * invariants (batches add up to on hand; in-stock serials cover on hand).
   * A maintenance check, never part of a hot path.
   *
   * `items` and `tracking_mismatches` are corruption. `needs_settlement` is
   * not: units sold without a known serial, and the unallocated batch row,
   * are accepted outcomes of the acceptance-first sale that staff settle later.
   */
  async reconcile(context: TenantContext, branchId?: string) {
    const rows = await this.repository.reconciliationMismatches(context, branchId);
    const tracking = splitTracking(await this.repository.trackingReconciliation(context, branchId));

    const items = rows.map((row) => {
      const stockOnHand = quantityNumber(row.stock_on_hand ?? 0);
      const stockReserved = quantityNumber(row.stock_reserved ?? 0);
      const ledgerOnHand = quantityNumber(row.ledger_on_hand ?? 0);
      const ledgerReserved = quantityNumber(row.ledger_reserved ?? 0);
      return {
        warehouse_id: row.warehouse_id,
        branch_id: row.branch_id,
        variant_id: row.variant_id,
        stock_on_hand: stockOnHand,
        stock_reserved: stockReserved,
        ledger_on_hand: ledgerOnHand,
        ledger_reserved: ledgerReserved,
        on_hand_difference: quantityNumber(stockOnHand - ledgerOnHand),
        reserved_difference: quantityNumber(stockReserved - ledgerReserved),
        last_movement_at: row.last_movement_at,
      };
    });

    return {
      is_consistent: items.length === 0 && tracking.mismatches.length === 0,
      mismatch_count: items.length + tracking.mismatches.length,
      branch_id: branchId || null,
      checked_at: new Date().toISOString(),
      items,
      tracking_mismatches: tracking.mismatches,
      needs_settlement: tracking.settlement,
    };
  }
}

/** Sorts tracking rows into corruption and "staff still has to settle this". */
function splitTracking(rows: TrackingReconciliationRow[]) {
  const where = (row: TrackingReconciliationRow) => ({
    warehouse_id: row.warehouse_id,
    branch_id: row.branch_id,
    variant_id: row.variant_id,
  });
  const mismatches: Array<ReturnType<typeof where> & { kind: string; on_hand: number; tracked_total: number; difference: number }> = [];
  const settlement: Array<ReturnType<typeof where> & { kind: string; quantity: number }> = [];
  for (const row of rows) {
    const onHand = quantityNumber(row.stock_on_hand);
    const tracked = quantityNumber(row.tracked_total);
    if (row.kind === 'batch_unallocated') {
      settlement.push({ ...where(row), kind: 'batch_unallocated', quantity: tracked });
    } else if (row.kind === 'serial_count' && tracked > onHand) {
      settlement.push({ ...where(row), kind: 'serial_uncaptured_sales', quantity: quantityNumber(tracked - onHand) });
    } else if (onHand !== tracked) {
      mismatches.push({ ...where(row), kind: row.kind, on_hand: onHand, tracked_total: tracked, difference: quantityNumber(tracked - onHand) });
    }
  }
  return { mismatches, settlement };
}
