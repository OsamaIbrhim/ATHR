import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { actorFor } from '../auth/testing/actors';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';
import { ReturnsService } from './returns.service';
import { inventoryDouble, warehouseId } from './testing/inventory-double';

// The per-tenant counter is one real statement (scripts/verify-sales-w3.cjs D1-D6); these specs only need a number.
jest.mock('../common/document-sequence', () => ({
  ...jest.requireActual('../common/document-sequence'),
  nextDocumentNumber: jest.fn().mockResolvedValue('R-000001'),
}));

const ctx = contextFor(TENANT_A);
const branchId = '11111111-1111-4111-8111-111111111111';
const shiftId = '33333333-3333-4333-8333-333333333333';
const variantId = '55555555-5555-4555-8555-555555555555';
const cashierId = '88888888-8888-4888-8888-888888888888';
const actor = actorFor('cashier', { sub: cashierId, branchId });

function setupReturn(alreadyReturned = 0, itemType = 'stocked', tracking = 'none') {
  const soldItem = {
    id: 'sale-item-1',
    variant_id: variantId,
    qty: new Prisma.Decimal(3),
    unit_price: 150,
    unit_cost: 100,
    unit_tax: 21,
    discount_amount: new Prisma.Decimal(0),
    tax_amount: new Prisma.Decimal(63),
    variant: { item_type: itemType, tracking, base_uom: null },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    shift: { findFirst: jest.fn().mockResolvedValue({ id: shiftId }) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) },
    salesInvoice: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'sale-1',
        branch_id: branchId,
        customer_id: null,
        occurred_at: new Date(),
        created_at: new Date(),
        subtotal: 450,
        tax_amount: 63,
        items: [soldItem],
      }),
    },
    returnItem: {
      groupBy: jest.fn().mockResolvedValue(
        alreadyReturned
          ? [{ sales_invoice_item_id: 'sale-item-1', _sum: { qty: new Prisma.Decimal(alreadyReturned) } }]
          : [],
      ),
    },
    return: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'return-1',
          created_at: new Date(),
          ...data,
          items: data.items.create.map((item: any, index: number) => ({ id: `return-item-${index + 1}`, ...item })),
        }),
      ),
    },
    customer: { findUnique: jest.fn(), update: jest.fn() },
  };
  const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
  const inventory = inventoryDouble();
  return {
    service: new ReturnsService(prisma as any, new CostVisibilityService(), inventory as any),
    tx,
    inventory,
  };
}

describe('ReturnsService returns', () => {
  it('rejects an item that was not sold on the original invoice', async () => {
    const { service } = setupReturn();
    await expect(
      service.createReturn(
      ctx,
        {
          original_invoice_id: 'sale-1',
          items: [{ sales_invoice_item_id: 'not-on-sale', qty: 1 }],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects quantities greater than the returnable quantity', async () => {
    const { service } = setupReturn(2);
    await expect(
      service.createReturn(
      ctx,
        {
          original_invoice_id: 'sale-1',
          items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns the goods to the branch warehouse at the cost they were sold at', async () => {
    const { service, inventory } = setupReturn();
    await service.createReturn(
      ctx,
      {
        original_invoice_id: 'sale-1',
        items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
      },
      actor,
    );

    expect(inventory.apply).toHaveBeenCalledTimes(1);
    const [, command] = inventory.apply.mock.calls[0];
    expect(command).toMatchObject({
      warehouseId,
      type: 'return',
      costType: 'customer_return',
      idempotencyKey: 'return:return-1',
      reference: { type: 'Return', id: 'return-1' },
    });
    expect(command.lines).toHaveLength(1);
    expect(command.lines[0].qtyDelta.toString()).toBe('2');
    expect(command.lines[0].unitCost.toFixed(4)).toBe('100.0000');
    expect(command.lines[0].value.toFixed(2)).toBe('200.00');
  });

  it('does not restock a service item', async () => {
    const { service, inventory } = setupReturn(0, 'service');
    await service.createReturn(
      ctx,
      {
        original_invoice_id: 'sale-1',
        items: [{ sales_invoice_item_id: 'sale-item-1', qty: 1 }],
      },
      actor,
    );
    expect(inventory.apply.mock.calls[0][1].lines).toEqual([]);
  });

  it('links a POS return to the currently open shift', async () => {
    const { service, tx } = setupReturn();
    const result = await service.createReturn(
      ctx,
      {
        original_invoice_id: 'sale-1',
        items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
        reason: 'Wrong size',
      },
      actor,
    );

    expect(tx.return.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          branch_id: branchId,
          shift_id: shiftId,
          created_by: cashierId,
        }),
      }),
    );
    expect(String(result.refund_total)).toBe('342');
  });

  /**
   * BR-CST-101 / Matrix §17 §51. `ReturnItem.unit_cost` is the sale line's cost
   * carried onto the return, so the return response is the same disclosure as
   * `GET /sales/:id` under a different table — see `sales.cost-visibility.spec.ts`
   * for the read-path half.
   */
  it('strips unit_cost from the return response for an actor without cost/margin visibility', async () => {
    const { service, tx } = setupReturn();
    const result: any = await service.createReturn(
      ctx,
      {
        original_invoice_id: 'sale-1',
        items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
        reason: 'Wrong size',
      },
      actor,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('unit_cost');
    // Only the response is projected — the written row keeps the true cost.
    const written = tx.return.create.mock.calls[0][0].data.items.create[0];
    expect(Number(written.unit_cost)).toBe(100);
  });

  it('returns unit_cost on a return to an actor holding cost/margin visibility', async () => {
    const { service } = setupReturn();
    const result: any = await service.createReturn(
      ctx,
      {
        original_invoice_id: 'sale-1',
        items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
        reason: 'Wrong size',
      },
      // A location manager holds `sales.sale.view-cost-margin`; the cashier
      // the module's other cases use does not, which is why they mask.
      actorFor('location_manager', { sub: cashierId, branchId }),
    );

    expect(Number(result.items[0].unit_cost)).toBe(100);
  });

  it('masks the return response when the key was revoked from the actor', async () => {
    const { service } = setupReturn();
    const result: any = await service.createReturn(
      ctx,
      {
        original_invoice_id: 'sale-1',
        items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
        reason: 'Wrong size',
      },
      actorFor('location_manager', { sub: cashierId, branchId, revoked: ['sales.sale.view-cost-margin'] }),
    );

    expect(result.items[0]).not.toHaveProperty('unit_cost');
  });
});


describe('ReturnsService refunds', () => {
  const dto = (extra: Record<string, unknown> = {}) => ({
    original_invoice_id: 'sale-1',
    items: [{ sales_invoice_item_id: 'sale-item-1', qty: 1 }],
    ...extra,
  });

  it('stores the refunded net and tax per line, from the stored line amounts, and the method', async () => {
    const { service, tx } = setupReturn();
    const result: any = await service.createReturn(ctx, dto({ refund_method: 'card' }) as any, actor);
    const data = tx.return.create.mock.calls[0][0].data;
    expect([data.refund_subtotal.toString(), data.refund_tax.toString(), data.refund_total.toString(), data.refund_method]).toEqual(['150', '21', '171', 'card']);
    expect(result.items[0].net_amount.toString()).toBe('150');
  });

  it('refunds in cash unless told otherwise', async () => {
    const { service, tx } = setupReturn();
    await service.createReturn(ctx, dto() as any, actor);
    expect(tx.return.create.mock.calls[0][0].data.refund_method).toBe('cash');
  });

  it('refuses a refund to the customer account when the invoice has no customer', async () => {
    const { service } = setupReturn();
    await expect(service.createReturn(ctx, dto({ refund_method: 'credit' }) as any, actor)).rejects.toMatchObject({
      response: { code: 'REFUND_TO_CREDIT_NEEDS_CUSTOMER' },
    });
  });

  it('applies the tenant return window', async () => {
    const closed = setupReturn();
    closed.tx.tenant.findUnique.mockResolvedValue({ settings: { sales: { return_window_days: 0 } } });
    await expect(closed.service.createReturn(ctx, dto() as any, actor)).rejects.toMatchObject({ response: { code: 'RETURNS_NOT_ACCEPTED' } });
  });
});

describe('ReturnsService tracked customer returns', () => {
  describe('customer returns', () => {
    const returnOf = (qty: number, serials?: string[]) => ({
      original_invoice_id: 'sale-1',
      items: [{ sales_invoice_item_id: 'sale-item-1', qty, ...(serials ? { serials } : {}) }],
    });
    // A serial the sale line took out; `latest` = nothing touched it since (not returned, not resold).
    const drawnSerial = (serial: string, status = 'sold', latest = status === 'sold') => ({
      line_id: 'sale-item-1', serial, serial_status: status, serial_latest: latest,
      batch_no: null, expiry_date: null, batch_created_at: null, qty: new Prisma.Decimal(1),
    });
    const drawnBatch = (batchNo: string, qty: number) => ({
      line_id: 'sale-item-1', serial: null, serial_status: null, serial_latest: null, batch_no: batchNo, expiry_date: null,
      batch_created_at: new Date('2026-01-01'), qty: new Prisma.Decimal(qty),
    });
    const serialState = (serial: string, status: string, warehouse: string | null = warehouseId) => ({
      variant_id: variantId, serial, status, warehouse_id: status === 'in_stock' ? warehouse : null,
    });
    // The sold line has qty 3 (setupReturn).
    const serialReturn = (drawn: unknown[], states: unknown[] = []) => {
      const setup = setupReturn(0, 'stocked', 'serial');
      setup.inventory.drawnLots.mockResolvedValue(drawn);
      setup.inventory.serialStates.mockResolvedValue(states);
      return setup;
    };
    const suppliedLots = (setup: ReturnType<typeof setupReturn>) => setup.inventory.apply.mock.calls[0][1].lines[0].lots;

    it('does not look up lots for an untracked variant', async () => {
      const { service, inventory } = setupReturn();
      await service.createReturn(ctx, returnOf(1), actor);
      expect(inventory.drawnLots).not.toHaveBeenCalled();
      expect(inventory.apply.mock.calls[0][1].lines[0]).not.toHaveProperty('lots');
    });

    it('puts back the serials that were sold on the line', async () => {
      const setup = serialReturn([drawnSerial('S1'), drawnSerial('S2'), drawnSerial('S3')]);
      await setup.service.createReturn(ctx, returnOf(2, ['S1', 'S3']), actor);
      expect(setup.inventory.drawnLots).toHaveBeenCalledWith(expect.anything(), ctx.tenantId, { type: 'SalesInvoice', id: 'sale-1' }, ['sale-item-1']);
      expect(suppliedLots(setup)).toEqual({ serials: ['S1', 'S3'] });
    });

    it('refuses a serial that is already back, and one that was resold since (its sale would be orphaned)', async () => {
      const back = serialReturn([drawnSerial('S1'), drawnSerial('S2', 'in_stock'), drawnSerial('S3')]);
      await expect(back.service.createReturn(ctx, returnOf(1, ['S2']), actor)).rejects.toMatchObject({
        response: { code: 'RETURN_SERIAL_NOT_SOLD_ON_LINE', serials: ['S2'] },
      });
      // S1 shows 'sold' but a later invoice sold it again: this line no longer owns it.
      const resold = serialReturn([drawnSerial('S1', 'sold', false), drawnSerial('S2'), drawnSerial('S3')]);
      await expect(resold.service.createReturn(ctx, returnOf(1, ['S1']), actor)).rejects.toMatchObject({
        response: { code: 'RETURN_SERIAL_NOT_SOLD_ON_LINE', serials: ['S1'] },
      });
      expect(back.inventory.apply).not.toHaveBeenCalled();
      expect(resold.inventory.apply).not.toHaveBeenCalled();
    });

    it('needs the serial of every unit whose serial is on record', async () => {
      const setup = serialReturn([drawnSerial('S1'), drawnSerial('S2'), drawnSerial('S3')]);
      await expect(setup.service.createReturn(ctx, returnOf(1), actor)).rejects.toMatchObject({
        response: { code: 'TRACKING_SERIALS_REQUIRED' },
      });
      await expect(setup.service.createReturn(ctx, returnOf(2, ['S1']), actor)).rejects.toMatchObject({
        response: { code: 'TRACKING_SERIALS_REQUIRED' },
      });
    });

    describe('units that were sold without a serial on record (a POS without serial scanning)', () => {
      // Sold 3, only S1 was recorded: two units have no serial on record.
      it('come back with their own new serials', async () => {
        const setup = serialReturn([drawnSerial('S1')]);
        await setup.service.createReturn(ctx, returnOf(2, ['NEW-1', 'NEW-2']), actor);
        expect(suppliedLots(setup)).toEqual({ serials: ['NEW-1', 'NEW-2'] });
      });

      it('come back with no serial at all, up to that many units', async () => {
        const setup = serialReturn([drawnSerial('S1')]);
        await setup.service.createReturn(ctx, returnOf(2), actor);
        expect(suppliedLots(setup)).toEqual({ serials: [] });

        const tooMany = serialReturn([drawnSerial('S1')]);
        await expect(tooMany.service.createReturn(ctx, returnOf(3), actor)).rejects.toMatchObject({
          response: { code: 'TRACKING_SERIALS_REQUIRED' },
        });
      });

      it('never exceed the units without a record', async () => {
        const setup = serialReturn([drawnSerial('S1')]);
        await expect(setup.service.createReturn(ctx, returnOf(3, ['N1', 'N2', 'N3']), actor)).rejects.toMatchObject({
          response: { code: 'RETURN_SERIAL_NOT_SOLD_ON_LINE', serials: ['N3'] },
        });
      });

      it('settle the count when the serial was never scanned out and is still in stock', async () => {
        const setup = serialReturn([drawnSerial('S1')], [serialState('P2', 'in_stock')]);
        await setup.service.createReturn(ctx, returnOf(1, ['P2']), actor);
        // Nothing to put back: the serial is already in stock, only on hand moves.
        expect(suppliedLots(setup)).toEqual({ serials: [] });
        expect(setup.inventory.serialStates).toHaveBeenCalledWith(expect.anything(), ctx.tenantId, [{ variantId, serial: 'P2' }]);
      });

      it('never take a serial that is sold on another line, sent to a supplier or in transit', async () => {
        for (const status of ['sold', 'returned_to_supplier', 'in_transit']) {
          const setup = serialReturn([drawnSerial('S1')], [serialState('X', status)]);
          await expect(setup.service.createReturn(ctx, returnOf(1, ['X']), actor)).rejects.toMatchObject({
            response: { code: 'RETURN_SERIAL_NOT_SOLD_ON_LINE', serials: ['X'] },
          });
        }
        const elsewhere = serialReturn([drawnSerial('S1')], [serialState('X', 'in_stock', 'another-warehouse')]);
        await expect(elsewhere.service.createReturn(ctx, returnOf(1, ['X']), actor)).rejects.toMatchObject({
          response: { code: 'RETURN_SERIAL_NOT_SOLD_ON_LINE' },
        });
      });

      it('leave less to take back once earlier returns used the allowance', async () => {
        // 3 sold, S1 recorded, 1 unrecorded unit already returned: one unrecorded unit left.
        const { service, inventory } = setupReturn(1, 'stocked', 'serial');
        inventory.drawnLots.mockResolvedValue([drawnSerial('S1')]);
        inventory.serialStates.mockResolvedValue([]);
        await service.createReturn(ctx, returnOf(1, ['NEW-A']), actor);
        const again = setupReturn(2, 'stocked', 'serial');
        again.inventory.drawnLots.mockResolvedValue([drawnSerial('S1')]);
        again.inventory.serialStates.mockResolvedValue([]);
        await expect(again.service.createReturn(ctx, returnOf(1, ['NEW-B']), actor)).rejects.toMatchObject({
          response: { code: 'RETURN_SERIAL_NOT_SOLD_ON_LINE' },
        });
      });
    });

    it('sends batch goods back to the batches the line drew, newest draw first, skipping earlier returns', async () => {
      // The sale drew 2 from A (soonest) and 1 from B; 1 unit was already returned (it went back to B).
      const { service, inventory } = setupReturn(1, 'stocked', 'batch');
      inventory.drawnLots.mockResolvedValue([drawnBatch('A', 2), drawnBatch('B', 1)]);
      await service.createReturn(ctx, returnOf(2), actor);
      const { batches } = inventory.apply.mock.calls[0][1].lines[0].lots;
      expect(batches.map((batch: any) => [batch.batchNo, batch.qty.toString()])).toEqual([['A', '2']]);
    });

    it('sends batch units the line has no record of to the unallocated row', async () => {
      const { service, inventory } = setupReturn(0, 'stocked', 'batch');
      inventory.drawnLots.mockResolvedValue([drawnBatch('A', 1)]);
      await service.createReturn(ctx, returnOf(2), actor);
      const { batches } = inventory.apply.mock.calls[0][1].lines[0].lots;
      expect(batches.map((batch: any) => [batch.batchNo, batch.qty.toString()])).toEqual([['A', '1'], ['', '1']]);
    });
  });
});
