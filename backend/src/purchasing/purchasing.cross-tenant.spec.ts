import { randomUUID } from 'crypto';
import { PurchasingService } from './purchasing.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-007 Phase A §A.3.6 — cross-tenant isolation for the `purchasing` module. */

const INVOICE_A = randomUUID();
const INVOICE_B = randomUUID();
const SUPPLIER_A = randomUUID();
const SUPPLIER_B = randomUUID();
const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();
const VARIANT_A = randomUUID();

function setup() {
  const prisma = fakePrisma({
    purchaseInvoice: [
      {
        id: INVOICE_A,
        tenant_id: TENANT_A,
        supplier_id: SUPPLIER_A,
        branch_id: BRANCH_A,
        status: 'posted',
        received_at: new Date(),
        items: [],
      },
      {
        id: INVOICE_B,
        tenant_id: TENANT_B,
        supplier_id: SUPPLIER_B,
        branch_id: BRANCH_B,
        status: 'posted',
        received_at: new Date(),
        items: [],
      },
    ],
    supplier: [
      { id: SUPPLIER_A, tenant_id: TENANT_A, name: 'A supplier' },
      { id: SUPPLIER_B, tenant_id: TENANT_B, name: 'B supplier' },
    ],
    branch: [
      { id: BRANCH_A, tenant_id: TENANT_A, is_active: true },
      { id: BRANCH_B, tenant_id: TENANT_B, is_active: true },
    ],
    productVariant: [{ id: VARIANT_A, tenant_id: TENANT_A, is_active: true }],
    supplierReturn: [
      { id: randomUUID(), tenant_id: TENANT_A, branch_id: BRANCH_A, occurred_at: new Date() },
      { id: randomUUID(), tenant_id: TENANT_B, branch_id: BRANCH_B, occurred_at: new Date() },
    ],
    inventoryCostMovement: [
      { id: randomUUID(), tenant_id: TENANT_A, branch_id: BRANCH_A, variant_id: VARIANT_A, recorded_at: new Date() },
      { id: randomUUID(), tenant_id: TENANT_B, branch_id: BRANCH_B, variant_id: VARIANT_A, recorded_at: new Date() },
    ],
    inventoryStock: [],
    transferItem: [],
    product: [],
    auditLog: [],
  });
  const captured: string[] = [];
  prisma.$queryRaw = async (query: any) => {
    captured.push(Array.isArray(query) ? query.join('?') : String(query?.sql ?? query));
    return [];
  };
  prisma.$executeRaw = async () => 1;
  prisma.$transaction = async (fn: any) => fn(prisma);
  return { prisma, captured, service: new PurchasingService(prisma) };
}

const actor = { sub: randomUUID(), role: 'warehouse_manager', branch_id: BRANCH_A, capabilities: [] } as any;

describe('purchasing — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s purchase invoices', async () => {
    const { service } = setup();
    expect((await service.list(contextFor(TENANT_A))).map((i: any) => i.id)).toEqual([INVOICE_A]);
    expect((await service.list(contextFor(TENANT_B))).map((i: any) => i.id)).toEqual([INVOICE_B]);
  });

  it('does not return another tenant\'s invoice by id', async () => {
    const { service } = setup();
    expect(await service.get(contextFor(TENANT_B), INVOICE_A)).toBeNull();
    expect(await service.get(contextFor(TENANT_A), INVOICE_A)).not.toBeNull();
  });

  /**
   * The supplier lookup was a bare `findUnique`, so a receipt could be booked
   * against another tenant's supplier account — the purchase would post, and
   * the liability would land on the wrong tenant's books.
   */
  it('refuses to receive stock against another tenant\'s supplier', async () => {
    const { service } = setup();
    await expect(
      service.receive(
        contextFor(TENANT_A),
        {
          branch_id: BRANCH_A,
          supplier_id: SUPPLIER_B,
          command_id: randomUUID(),
          items: [{ variant_id: VARIANT_A, qty: 1, unit_cost: 10 }],
        } as any,
        actor,
      ),
    ).rejects.toThrow('Supplier not found');
  });

  it('refuses to receive stock into another tenant\'s branch', async () => {
    const { service } = setup();
    await expect(
      service.receive(
        contextFor(TENANT_A),
        {
          branch_id: BRANCH_B,
          supplier_id: SUPPLIER_A,
          command_id: randomUUID(),
          items: [{ variant_id: VARIANT_A, qty: 1, unit_cost: 10 }],
        } as any,
        actor,
      ),
    ).rejects.toThrow('Active branch not found');
  });

  it('lists only the calling tenant\'s supplier returns and cost movements', async () => {
    const { service } = setup();
    const returnsA: any = await service.listSupplierReturns(contextFor(TENANT_A));
    expect(returnsA).toHaveLength(1);
    expect(returnsA[0].tenant_id).toBe(TENANT_A);

    const movementsA: any = await service.listCostMovements(contextFor(TENANT_A));
    expect(movementsA).toHaveLength(1);
    expect(movementsA[0].tenant_id).toBe(TENANT_A);
  });

  it('does not reverse another tenant\'s invoice', async () => {
    const { service } = setup();
    await expect(
      service.reverse(contextFor(TENANT_B), INVOICE_A, { reason: 'wrong tenant' } as any, actor),
    ).rejects.toThrow('Purchase invoice not found');
  });

  /**
   * Blueprint §120. The cost reconciliation aggregates the cost ledger, stock
   * and in-transit quantities; unscoped it compares one tenant's materialized
   * variant cost against every tenant's ledger and reports the difference as
   * an accounting integrity failure.
   */
  it('scopes every CTE of the cost reconciliation to the calling tenant', async () => {
    const { service, captured } = setup();
    await service.costReconciliation(contextFor(TENANT_A));

    const sql = captured.find((text) => text.includes('InventoryCostMovement'))!;
    expect(sql).toMatch(/FROM "InventoryCostMovement" movement[\s\S]*WHERE movement\."tenant_id"/);
    expect(sql).toMatch(/FROM "InventoryStock" record[\s\S]*WHERE record\."tenant_id"/);
    expect(sql).toMatch(/FROM "TransferItem" item[\s\S]*WHERE item\."tenant_id"/);
    expect(sql).toMatch(/FROM "ProductVariant" variant[\s\S]*WHERE variant\."tenant_id"/);
  });
});
