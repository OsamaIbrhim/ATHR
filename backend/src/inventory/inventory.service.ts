import { Injectable } from '@nestjs/common';
import { InventoryRepository } from './inventory.repository';
import type { TenantContext } from '../identity/tenant-context.type';

@Injectable()
export class InventoryService {
  constructor(private readonly repository: InventoryRepository) {}

  async lookup(context: TenantContext, variantId: string, branchId?: string) {
    return this.repository.findStock(context, variantId, branchId);
  }

  movements(context: TenantContext, variantId: string, branchId?: string, take = 100) {
    return this.repository.listMovements(context, variantId, branchId, take);
  }

  async reconcile(context: TenantContext, branchId?: string) {
    const rows = await this.repository.reconciliationMismatches(context, branchId);

    const items = rows.map((row) => ({
      branch_id: row.branch_id,
      variant_id: row.variant_id,
      stock_on_hand: Number(row.stock_on_hand ?? 0),
      stock_reserved: Number(row.stock_reserved ?? 0),
      ledger_on_hand: Number(row.ledger_on_hand ?? 0),
      ledger_reserved: Number(row.ledger_reserved ?? 0),
      on_hand_difference:
        Number(row.stock_on_hand ?? 0) - Number(row.ledger_on_hand ?? 0),
      reserved_difference:
        Number(row.stock_reserved ?? 0) - Number(row.ledger_reserved ?? 0),
      last_movement_at: row.last_movement_at,
    }));

    return {
      is_consistent: items.length === 0,
      mismatch_count: items.length,
      branch_id: branchId || null,
      checked_at: new Date().toISOString(),
      items,
    };
  }
}
