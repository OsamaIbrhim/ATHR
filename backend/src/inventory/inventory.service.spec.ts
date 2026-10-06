import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { InventoryRepository } from './inventory.repository';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

// The stock engine (apply) is proven against real Postgres by
// `scripts/verify-inventory-engine.cjs`. These cases cover the read side and the
// warehouse lookup, which need no database.
const ctx = contextFor(TENANT_A);

describe('InventoryService', () => {
  function setup() {
    const warehouse = { branch_id: 'branch-1', branch: { id: 'branch-1', name_ar: 'الفرع' } };
    const prisma = {
      inventoryStock: {
        findMany: jest.fn().mockResolvedValue([{ variant_id: 'variant-1', warehouse }]),
      },
      inventoryMovement: {
        findMany: jest.fn().mockResolvedValue([{ id: 'movement-1', warehouse }]),
      },
      warehouse: {
        findFirst: jest.fn().mockResolvedValue({ id: 'warehouse-1' }),
      },
      // reconcile: the ledger comparison first, then the tracking invariants.
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            warehouse_id: 'warehouse-1',
            branch_id: 'branch-1',
            variant_id: 'variant-1',
            stock_on_hand: new Prisma.Decimal(9),
            stock_reserved: new Prisma.Decimal(1),
            ledger_on_hand: new Prisma.Decimal('8.500'),
            ledger_reserved: new Prisma.Decimal(0),
            last_movement_at: new Date('2026-07-22T12:00:00.000Z'),
          },
        ])
        .mockResolvedValueOnce([]),
    };
    return { service: new InventoryService(new InventoryRepository(prisma as any)), prisma };
  }

  it('keeps inventory lookup scoped to the caller branch and still reports the branch per row', async () => {
    const { service, prisma } = setup();
    const rows = await service.lookup(ctx, 'variant-1', 'branch-1');

    expect(prisma.inventoryStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          variant_id: 'variant-1',
          warehouse: { branch_id: 'branch-1' },
        }),
      }),
    );
    expect(rows[0]).toMatchObject({ branch_id: 'branch-1', branch: { name_ar: 'الفرع' } });
  });

  it('never selects the warehouse average cost for a position lookup', async () => {
    const { service, prisma } = setup();
    await service.lookup(ctx, 'variant-1');

    const { select } = prisma.inventoryStock.findMany.mock.calls[0][0];
    expect(select).toMatchObject({ qty_on_hand: true, qty_reserved: true });
    expect(select).not.toHaveProperty('avg_cost');
  });

  it('lists immutable movements in business occurrence order', async () => {
    const { service, prisma } = setup();
    const rows = await service.movements(ctx, 'variant-1', 'branch-1', 50);

    expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: ctx.tenantId,
          variant_id: 'variant-1',
          warehouse: { branch_id: 'branch-1' },
        },
        orderBy: [
          { occurred_at: 'desc' },
          { recorded_at: 'desc' },
          { id: 'desc' },
        ],
        take: 50,
      }),
    );
    expect(rows[0]).toMatchObject({ branch_id: 'branch-1' });
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
          warehouse_id: 'warehouse-1',
          branch_id: 'branch-1',
          variant_id: 'variant-1',
          stock_on_hand: 9,
          ledger_on_hand: 8.5,
          on_hand_difference: 0.5,
          stock_reserved: 1,
          ledger_reserved: 0,
          reserved_difference: 1,
        },
      ],
    });
  });

  describe('reconciling tracked variants', () => {
    const trackingRow = (kind: string, onHand: number, tracked: number) => ({
      kind,
      warehouse_id: 'warehouse-1',
      branch_id: 'branch-1',
      variant_id: 'variant-1',
      stock_on_hand: new Prisma.Decimal(onHand),
      tracked_total: new Prisma.Decimal(tracked),
    });
    const reconcileWith = async (rows: unknown[]) => {
      const { service, prisma } = setup();
      prisma.$queryRaw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce(rows);
      return service.reconcile(ctx);
    };

    it('is consistent when no tracked variant drifted', async () => {
      const result = await reconcileWith([]);
      expect(result).toMatchObject({ is_consistent: true, mismatch_count: 0, tracking_mismatches: [], needs_settlement: [] });
    });

    it('reports batches that do not add up to on hand as corruption', async () => {
      const result = await reconcileWith([trackingRow('batch_total', 10, 8)]);
      expect(result.is_consistent).toBe(false);
      expect(result.tracking_mismatches).toEqual([
        expect.objectContaining({ kind: 'batch_total', on_hand: 10, tracked_total: 8, difference: -2 }),
      ]);
    });

    it('reports fewer in-stock serials than on hand as corruption', async () => {
      const result = await reconcileWith([trackingRow('serial_count', 5, 3)]);
      expect(result.tracking_mismatches).toEqual([
        expect.objectContaining({ kind: 'serial_count', difference: -2 }),
      ]);
    });

    it('reports units sold without a serial as needing settlement, not as corruption', async () => {
      const result = await reconcileWith([trackingRow('serial_count', 3, 5)]);
      expect(result.is_consistent).toBe(true);
      expect(result.needs_settlement).toEqual([
        expect.objectContaining({ kind: 'serial_uncaptured_sales', quantity: 2 }),
      ]);
    });

    it('lists an unallocated batch row as needing settlement', async () => {
      const result = await reconcileWith([trackingRow('batch_unallocated', 2, -3)]);
      expect(result.is_consistent).toBe(true);
      expect(result.needs_settlement).toEqual([
        expect.objectContaining({ kind: 'batch_unallocated', quantity: -3 }),
      ]);
    });
  });

  describe('default warehouse lookup', () => {
    it('resolves a branch\'s default warehouse once and serves repeats from the cache', async () => {
      const { service, prisma } = setup();

      expect(await service.defaultWarehouseId(prisma as any, 'tenant-1', 'branch-1')).toBe('warehouse-1');
      expect(await service.defaultWarehouseId(prisma as any, 'tenant-1', 'branch-1')).toBe('warehouse-1');

      expect(prisma.warehouse.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.warehouse.findFirst).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1', branch_id: 'branch-1', is_default: true },
        select: { id: true },
      });
    });

    it('does not share a cached warehouse between tenants', async () => {
      const { service, prisma } = setup();
      await service.defaultWarehouseId(prisma as any, 'tenant-1', 'branch-1');
      await service.defaultWarehouseId(prisma as any, 'tenant-2', 'branch-1');
      expect(prisma.warehouse.findFirst).toHaveBeenCalledTimes(2);
    });

    it('fails clearly for a branch without a default warehouse', async () => {
      const { service, prisma } = setup();
      prisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(
        service.defaultWarehouseId(prisma as any, 'tenant-1', 'branch-x'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
