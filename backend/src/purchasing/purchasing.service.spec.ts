import { actorFor } from '../auth/testing/actors';
import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchasingService } from './purchasing.service';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

// WP-007 Phase A: purchasing entry points take the resolved TenantContext first.
const ctx = contextFor(TENANT_A);

const VARIANT_ID = '44444444-4444-4444-8444-444444444444';
const WAREHOUSE_ID = '99999999-0000-4000-8000-000000000001';

/**
 * InventoryService double. The stock engine itself (locking, ledgers, moving
 * average, idempotency) is proven against real Postgres by
 * `scripts/verify-inventory-engine.cjs`; these specs pin what purchasing asks
 * of it.
 */
function inventoryDouble(averageCost = 80) {
  return {
    apply: jest.fn().mockResolvedValue([]),
    defaultWarehouseId: jest.fn().mockResolvedValue(WAREHOUSE_ID),
    averageCosts: jest
      .fn()
      .mockResolvedValue(new Map([[VARIANT_ID, new Prisma.Decimal(averageCost)]])),
  };
}

describe('PurchasingService accounting transaction', () => {
  const branchId = '22222222-2222-4222-8222-222222222222';
  const actor = actorFor('location_manager', { sub: '11111111-1111-4111-8111-111111111111', branchId });
  const dto = {
    command_id: '99999999-9999-4999-8999-999999999999',
    supplier_id: '33333333-3333-4333-8333-333333333333',
    branch_id: branchId,
    invoice_number: 'SUP-42',
    discount_amount: 20,
    items: [
      {
        variant_id: VARIANT_ID,
        qty: 2,
        unit_cost: 120,
      },
    ],
  };

  function setup(existing: any = null, variant: any = { id: VARIANT_ID, sku: 'SKU-1' }) {
    const itemId = '66666666-6666-4666-8666-666666666666';
    const invoiceId = '55555555-5555-4555-8555-555555555555';
    const inventory = inventoryDouble();
    const tx = {
      purchaseInvoice: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({
          id: invoiceId,
          branch_id: dto.branch_id,
          created_at: new Date(),
          items: [{
            id: itemId,
            variant_id: dto.items[0].variant_id,
            qty: 2,
          }],
        }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: invoiceId,
          items: [],
          cost_movements: [],
        }),
      },
      branch: {
        findFirst: jest.fn().mockResolvedValue({ id: dto.branch_id }),
      },
      supplier: {
        findFirst: jest.fn().mockResolvedValue({ id: dto.supplier_id }),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([variant]),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
      purchaseInvoice: {
        findFirst: jest.fn().mockResolvedValue(existing),
      },
    };
    return {
      service: new PurchasingService(prisma as any, inventory as any),
      prisma,
      tx,
      inventory,
      itemId,
      invoiceId,
    };
  }

  it('posts one inventory command with the discounted line cost and an audit entry atomically', async () => {
    const { service, prisma, tx, inventory, itemId, invoiceId } = setup();
    await service.receive(ctx, dto, actor);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(inventory.apply).toHaveBeenCalledTimes(1);
    const [, command] = inventory.apply.mock.calls[0];
    expect(command).toMatchObject({
      tenantId: ctx.tenantId,
      warehouseId: WAREHOUSE_ID,
      type: 'purchase_receipt',
      costType: 'purchase_receipt',
      reference: { type: 'PurchaseInvoice', id: invoiceId },
      idempotencyKey: `purchase-receipt:${invoiceId}`,
    });
    expect(command.lines).toHaveLength(1);
    expect(command.lines[0]).toMatchObject({
      variantId: VARIANT_ID,
      referenceLineId: itemId,
      links: { purchaseInvoiceId: invoiceId, purchaseInvoiceItemId: itemId },
    });
    // 2 x 120 = 240 less the 20 discount = 220 for 2 units.
    expect(command.lines[0].qtyDelta.toString()).toBe('2');
    expect(command.lines[0].value.toFixed(2)).toBe('220.00');
    expect(command.lines[0].unitCost.toFixed(4)).toBe('110.0000');
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('returns an identical replay without touching stock', async () => {
    const first = setup();
    const prepared = await first.service.receive(ctx, dto, actor);
    const fingerprint =
      first.tx.purchaseInvoice.create.mock.calls[0][0].data
        .command_fingerprint;
    const replay = {
      id: 'existing',
      command_fingerprint: fingerprint,
      items: [],
      cost_movements: [],
    };
    const second = setup(replay);
    const result = await second.service.receive(ctx, dto, actor);

    expect(result).toBe(replay);
    expect(second.tx.purchaseInvoice.create).not.toHaveBeenCalled();
    expect(second.inventory.apply).not.toHaveBeenCalled();
    expect(prepared).toBeDefined();
  });

  it('rejects an idempotency replay with different accounting data', async () => {
    const { service, inventory } = setup({
      id: 'existing',
      command_fingerprint: 'different',
      items: [],
      cost_movements: [],
    });

    await expect(service.receive(ctx, dto, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(inventory.apply).not.toHaveBeenCalled();
  });

  it('rejects ambiguous double discounts before opening a transaction', async () => {
    const { service, prisma } = setup();

    await expect(
      service.receive(
        ctx,
        {
          ...dto,
          discount_percent: 5,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts a kg quantity when the variant unit allows 3 decimals and rejects it for pieces', async () => {
    const kgItem = { ...dto.items[0], qty: 1.25 };
    const kg = setup(null, { id: VARIANT_ID, sku: 'KG-1', base_uom: { precision: 3 } });
    await kg.service.receive(ctx, { ...dto, discount_amount: 0, items: [kgItem] }, actor);
    const [, command] = kg.inventory.apply.mock.calls[0];
    expect(command.lines[0].qtyDelta.toString()).toBe('1.25');

    const piece = setup(null, { id: VARIANT_ID, sku: 'PC-1', base_uom: { precision: 0 } });
    await expect(
      piece.service.receive(ctx, { ...dto, discount_amount: 0, items: [kgItem] }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(piece.inventory.apply).not.toHaveBeenCalled();

    const noUnit = setup(null, { id: VARIANT_ID, sku: 'NU-1' });
    await expect(
      noUnit.service.receive(ctx, { ...dto, discount_amount: 0, items: [kgItem] }, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('posts a partial supplier return with exact credit and current-average inventory value', async () => {
    const purchaseLineId = '77777777-7777-4777-8777-777777777777';
    const supplierReturnId = '88888888-8888-4888-8888-888888888888';
    const supplierReturnItemId =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const inventory = inventoryDouble(80);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      supplierReturn: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: supplierReturnId,
            ...data,
            items: [{
              id: supplierReturnItemId,
              purchase_invoice_item_id: purchaseLineId,
              variant_id: VARIANT_ID,
              qty: new Prisma.Decimal(2),
            }],
          }),
        ),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: supplierReturnId,
          items: [],
          cost_movements: [],
        }),
      },
      purchaseInvoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'purchase-1',
          supplier_id: dto.supplier_id,
          branch_id: dto.branch_id,
          status: 'posted',
          accounting_version: 2,
          discount_amount: new Prisma.Decimal(20),
          items: [{
            id: purchaseLineId,
            variant_id: VARIANT_ID,
            qty: new Prisma.Decimal(10),
            unit_cost: new Prisma.Decimal(100),
            net_unit_cost: new Prisma.Decimal(90),
            net_line_total: new Prisma.Decimal(900),
          }],
        }),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([{
          id: VARIANT_ID,
          sku: 'SKU-1',
          cost_price: new Prisma.Decimal(80),
        }]),
      },
      supplierReturnItem: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
      supplierReturn: {
        findFirst: jest.fn(),
      },
    };
    const service = new PurchasingService(prisma as any, inventory as any);

    await service.returnToSupplier(
      ctx,
      'purchase-1',
      {
        command_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        reason: 'Damaged supplier stock',
        items: [{
          purchase_invoice_item_id: purchaseLineId,
          qty: 2,
        }],
      },
      actor,
    );

    expect(tx.supplierReturn.create).toHaveBeenCalledTimes(1);
    const created =
      tx.supplierReturn.create.mock.calls[0][0].data;
    expect(created.credit_total.toFixed(2)).toBe('180.00');
    expect(created.inventory_value_removed.toFixed(2)).toBe('160.00');
    expect(created.purchase_price_variance.toFixed(2)).toBe('20.00');

    expect(inventory.apply).toHaveBeenCalledTimes(1);
    const [, command] = inventory.apply.mock.calls[0];
    expect(command).toMatchObject({
      type: 'reversal',
      costType: 'supplier_return',
      allowNegative: false,
      reference: { type: 'SupplierReturn', id: supplierReturnId },
    });
    expect(command.lines[0].qtyDelta.toString()).toBe('-2');
    expect(command.lines[0].value.toFixed(2)).toBe('-160.00');
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });


  describe('tracked items', () => {
    const line = dto.items[0];
    const receipt = (item: Record<string, unknown>[] | Record<string, unknown>) => ({
      ...dto,
      discount_amount: 0,
      items: (Array.isArray(item) ? item : [item]).map((entry) => ({ ...line, ...entry })),
    });
    const serialVariant = { id: VARIANT_ID, sku: 'PHONE-1', tracking: 'serial' };
    const batchVariant = { id: VARIANT_ID, sku: 'MILK-1', tracking: 'batch' };

    it('hands the serials of a received line to the engine', async () => {
      const { service, inventory } = setup(null, serialVariant);
      await service.receive(ctx, receipt({ serials: ['A1', ' B2 '] }), actor);
      expect(inventory.apply.mock.calls[0][1].lines[0].lots).toEqual({ serials: ['A1', 'B2'] });
    });

    it('hands each batch of a variant received in several batches, with its expiry', async () => {
      const { service, inventory } = setup(null, batchVariant);
      await service.receive(
        ctx,
        receipt([
          { qty: 1, batch_no: 'L1', expiry_date: '2027-01-31' },
          { qty: 3, batch_no: 'L2' },
        ]),
        actor,
      );
      const command = inventory.apply.mock.calls[0][1];
      expect(command.lines).toHaveLength(1);
      expect(command.lines[0].qtyDelta.toString()).toBe('4');
      expect(command.lines[0].lots.batches.map((b: any) => [b.batchNo, b.expiryDate ?? null, b.qty.toString()])).toEqual([
        ['L1', '2027-01-31', '1'],
        ['L2', null, '3'],
      ]);
    });

    it('sends no lots for an untracked line', async () => {
      const { service, inventory } = setup();
      await service.receive(ctx, dto, actor);
      expect(inventory.apply.mock.calls[0][1].lines[0]).not.toHaveProperty('lots');
    });

    it('refuses tracking data the variant is not tracked by, before any stock moves', async () => {
      for (const [variant, item] of [
        [{ id: VARIANT_ID, sku: 'PLAIN' }, { serials: ['A', 'B'] }],
        [{ id: VARIANT_ID, sku: 'PLAIN' }, { batch_no: 'L1' }],
        [serialVariant, { batch_no: 'L1' }],
        [batchVariant, { serials: ['A', 'B'] }],
      ] as const) {
        const { service, inventory } = setup(null, variant);
        await expect(service.receive(ctx, receipt(item), actor)).rejects.toMatchObject({
          response: { code: 'TRACKING_DATA_NOT_EXPECTED' },
        });
        expect(inventory.apply).not.toHaveBeenCalled();
      }
    });

    it('refuses an expiry date without a batch, and a line naming both serials and a batch', async () => {
      const { service, inventory } = setup(null, batchVariant);
      await expect(service.receive(ctx, receipt({ expiry_date: '2027-01-01' }), actor)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.receive(ctx, receipt({ serials: ['A', 'B'], batch_no: 'L1' }), actor)).rejects.toBeInstanceOf(BadRequestException);
      expect(inventory.apply).not.toHaveBeenCalled();
    });

    it('treats a replay with different serials as a different command', async () => {
      const first = setup(null, serialVariant);
      await first.service.receive(ctx, receipt({ serials: ['A', 'B'] }), actor);
      const fingerprint = first.tx.purchaseInvoice.create.mock.calls[0][0].data.command_fingerprint;

      const replay = { id: 'existing', command_fingerprint: fingerprint, items: [], cost_movements: [] };
      await expect(setup(replay, serialVariant).service.receive(ctx, receipt({ serials: ['B', 'A'] }), actor)).resolves.toBeDefined();
      await expect(setup(replay, serialVariant).service.receive(ctx, receipt({ serials: ['A', 'C'] }), actor)).rejects.toBeInstanceOf(ConflictException);
    });

    describe('supplier return and reversal', () => {
      const purchaseLineId = '77777777-7777-4777-8777-777777777777';
      function returnSetup(variant: Record<string, unknown>) {
        const inventory = inventoryDouble(80);
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([]),
          supplierReturn: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(({ data }) =>
              Promise.resolve({ id: 'sr-1', ...data, items: [{ id: 'sri-1', purchase_invoice_item_id: purchaseLineId, variant_id: VARIANT_ID, qty: new Prisma.Decimal(2) }] }),
            ),
            findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'sr-1', items: [], cost_movements: [] }),
          },
          purchaseInvoice: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'purchase-1', supplier_id: dto.supplier_id, branch_id: dto.branch_id, status: 'posted', accounting_version: 2,
              items: [{ id: purchaseLineId, variant_id: VARIANT_ID, qty: new Prisma.Decimal(10), unit_cost: new Prisma.Decimal(100), net_unit_cost: new Prisma.Decimal(90), net_line_total: new Prisma.Decimal(900) }],
            }),
          },
          productVariant: { findMany: jest.fn().mockResolvedValue([{ id: VARIANT_ID, sku: 'SKU-1', cost_price: new Prisma.Decimal(80), ...variant }]) },
          supplierReturnItem: { groupBy: jest.fn().mockResolvedValue([]) },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        const prisma = { $transaction: jest.fn((callback) => callback(tx)), supplierReturn: { findFirst: jest.fn() } };
        return { service: new PurchasingService(prisma as any, inventory as any), inventory, tx };
      }
      const giveBack = (service: PurchasingService, item: Record<string, unknown>) =>
        service.returnToSupplier(
          ctx, 'purchase-1',
          { command_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', reason: 'Faulty', items: [{ purchase_invoice_item_id: purchaseLineId, qty: 2, ...item }] } as any,
          actor,
        );

      it('names the serials or the batch of the units returned', async () => {
        const serial = returnSetup({ tracking: 'serial' });
        await giveBack(serial.service, { serials: ['A', 'B'] });
        expect(serial.inventory.apply.mock.calls[0][1].lines[0].lots).toEqual({ serials: ['A', 'B'] });

        const batch = returnSetup({ tracking: 'batch' });
        await giveBack(batch.service, { batch_no: 'L9' });
        const [entry] = batch.inventory.apply.mock.calls[0][1].lines[0].lots.batches;
        expect([entry.batchNo, entry.qty.toString()]).toEqual(['L9', '2']);
      });

      it('refuses tracking data on an untracked line', async () => {
        const { service, inventory } = returnSetup({});
        await expect(giveBack(service, { serials: ['A', 'B'] })).rejects.toMatchObject({ response: { code: 'TRACKING_DATA_NOT_EXPECTED' } });
        expect(inventory.apply).not.toHaveBeenCalled();
      });

      it('does not reverse a receipt of tracked items', async () => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([]),
          purchaseInvoice: { findFirst: jest.fn().mockResolvedValue({ id: 'purchase-1', branch_id: dto.branch_id, status: 'posted', items: [{ id: 'l1', variant_id: VARIANT_ID, qty: new Prisma.Decimal(1) }] }) },
          inventoryCostMovement: { findMany: jest.fn().mockResolvedValue([]) },
          inventoryMovement: { findMany: jest.fn().mockResolvedValue([]) },
          productVariant: { findMany: jest.fn().mockResolvedValue([{ id: VARIANT_ID, item_type: 'stocked', tracking: 'batch' }]) },
        };
        const inventory = inventoryDouble();
        const service = new PurchasingService({ $transaction: jest.fn((callback) => callback(tx)) } as any, inventory as any);
        await expect(service.reverse(ctx, 'purchase-1', { reason: 'oops' }, actor)).rejects.toMatchObject({
          response: { code: 'TRACKED_PURCHASE_REVERSAL_NOT_SUPPORTED' },
        });
        expect(inventory.apply).not.toHaveBeenCalled();
      });
    });
  });

});
