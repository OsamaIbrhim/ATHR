import { randomUUID } from 'crypto';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { anInventoryStock } from '../identity/testing/fixture-builders';

/** WP-007 Phase A §A.3.6 — cross-tenant isolation for the `inventory` module. */

const VARIANT = randomUUID();
const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();
const WAREHOUSE_A = randomUUID();
const WAREHOUSE_B = randomUUID();

/** Pre-hydrated `warehouse` relation (the fake has no `include`). */
const warehouseOf = (branchId: string) => ({ branch_id: branchId, branch: { id: branchId } });

function setup() {
  const prisma = fakePrisma({
    inventoryStock: [
      { ...anInventoryStock({ tenant_id: TENANT_A, warehouse_id: WAREHOUSE_A, variant_id: VARIANT, qty_on_hand: 5 }), warehouse: warehouseOf(BRANCH_A) },
      { ...anInventoryStock({ tenant_id: TENANT_B, warehouse_id: WAREHOUSE_B, variant_id: VARIANT, qty_on_hand: 9 }), warehouse: warehouseOf(BRANCH_B) },
    ],
    inventoryMovement: [
      {
        id: randomUUID(),
        tenant_id: TENANT_A,
        warehouse_id: WAREHOUSE_A,
        warehouse: warehouseOf(BRANCH_A),
        variant_id: VARIANT,
        on_hand_delta: 5,
        occurred_at: new Date(),
        recorded_at: new Date(),
      },
      {
        id: randomUUID(),
        tenant_id: TENANT_B,
        warehouse_id: WAREHOUSE_B,
        warehouse: warehouseOf(BRANCH_B),
        variant_id: VARIANT,
        on_hand_delta: 9,
        occurred_at: new Date(),
        recorded_at: new Date(),
      },
    ],
  }, {
    inventoryStock: { warehouse: { table: 'warehouse', localKey: 'warehouse_id' } },
    inventoryMovement: { warehouse: { table: 'warehouse', localKey: 'warehouse_id' } },
  });
  const repository = new InventoryRepository(prisma);
  return { prisma, repository, service: new InventoryService(repository) };
}

describe('inventory — cross-tenant isolation', () => {
  /**
   * The same variant id exists in both tenants here, which is the realistic
   * shape once a second tenant carries its own catalogue — an unscoped
   * lookup would return both tenants' stock rows for one query.
   */
  it('returns only the calling tenant\'s stock for a shared variant id', async () => {
    const { service } = setup();
    const forA = await service.lookup(contextFor(TENANT_A), VARIANT);
    expect(forA).toHaveLength(1);
    expect(forA[0].qty_on_hand).toBe(5);
    expect(forA[0].branch_id).toBe(BRANCH_A);

    const forB = await service.lookup(contextFor(TENANT_B), VARIANT);
    expect(forB).toHaveLength(1);
    expect(forB[0].qty_on_hand).toBe(9);
  });

  it('returns only the calling tenant\'s movements', async () => {
    const { service } = setup();
    const forA = await service.movements(contextFor(TENANT_A), VARIANT);
    expect(forA).toHaveLength(1);
    expect(forA[0].tenant_id).toBe(TENANT_A);
  });

  it('does not return another tenant\'s stock when scoped to its branch', async () => {
    const { service } = setup();
    expect(await service.lookup(contextFor(TENANT_A), VARIANT, BRANCH_B)).toEqual([]);
  });

  /**
   * Blueprint §120 "Raw SQL guarded". The reconciliation query is raw SQL
   * over the whole ledger; this asserts the tenant predicate is bound on
   * both the stock side and the ledger CTE, so one tenant's stock is never
   * compared against another's movements and reported as a mismatch.
   */
  it('binds the tenant predicate on both sides of the reconciliation query', async () => {
    const { repository, prisma } = setup();
    const captured: any[] = [];
    prisma.$queryRaw = async (query: any) => {
      captured.push(query);
      return [];
    };

    await repository.reconciliationMismatches(contextFor(TENANT_A));

    expect(captured).toHaveLength(1);
    const sql: string = captured[0].strings ? captured[0].strings.join('?') : String(captured[0].sql ?? '');
    expect(sql).toMatch(/InventoryMovement[\s\S]*WHERE movement\."tenant_id"/);
    expect(sql).toMatch(/FROM "InventoryStock"[\s\S]*WHERE "tenant_id"/);
    // The tenant id travels as a bound parameter, never interpolated.
    expect(captured[0].values).toContain(TENANT_A);
  });
});
