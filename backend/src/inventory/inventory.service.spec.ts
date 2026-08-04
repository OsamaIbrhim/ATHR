import { InventoryService } from './inventory.service';
import { InventoryRepository } from './inventory.repository';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

// WP-007 Phase A: the service now delegates to a tenant-scoped repository and
// takes a TenantContext. Intent and assertions are unchanged, with the tenant
// predicate added to the expected where-clauses.
const ctx = contextFor(TENANT_A);

describe('InventoryService', () => {
  function setup() {
    const prisma = {
      inventoryStock: {
        findMany: jest.fn().mockResolvedValue([{ branch_id: 'branch-1' }]),
      },
      inventoryMovement: {
        findMany: jest.fn().mockResolvedValue([{ id: 'movement-1' }]),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          branch_id: 'branch-1',
          variant_id: 'variant-1',
          stock_on_hand: 9,
          stock_reserved: 1,
          ledger_on_hand: 8n,
          ledger_reserved: 0n,
          last_movement_at: new Date('2026-07-22T12:00:00.000Z'),
        },
      ]),
    };
    return { service: new InventoryService(new InventoryRepository(prisma as any)), prisma };
  }

  it('keeps inventory lookup scoped to the caller branch', async () => {
    const { service, prisma } = setup();
    await service.lookup(ctx, 'variant-1', 'branch-1');

    expect(prisma.inventoryStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          variant_id: 'variant-1',
          branch_id: 'branch-1',
        }),
      }),
    );
  });

  it('lists immutable movements in business occurrence order', async () => {
    const { service, prisma } = setup();
    await service.movements(ctx, 'variant-1', 'branch-1', 50);

    expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: ctx.tenantId, variant_id: 'variant-1', branch_id: 'branch-1' },
        orderBy: [
          { occurred_at: 'desc' },
          { recorded_at: 'desc' },
          { id: 'desc' },
        ],
        take: 50,
      }),
    );
  });

  it('reports stock and ledger differences without hiding either balance', async () => {
    const { service } = setup();
    const result = await service.reconcile(ctx, 'branch-1');

    expect(result).toMatchObject({
      is_consistent: false,
      mismatch_count: 1,
      branch_id: 'branch-1',
      items: [
        {
          branch_id: 'branch-1',
          variant_id: 'variant-1',
          stock_on_hand: 9,
          ledger_on_hand: 8,
          on_hand_difference: 1,
          stock_reserved: 1,
          ledger_reserved: 0,
          reserved_difference: 1,
        },
      ],
    });
  });
});
