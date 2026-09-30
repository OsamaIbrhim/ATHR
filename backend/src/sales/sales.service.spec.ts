import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { actorFor } from '../auth/testing/actors';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';
import { SalesTaxSnapshotService } from '../tax/sales-tax-snapshot.service';
import { Prisma } from '@prisma/client';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateSaleItemDto } from './dto/create-sale.dto';

const TAX_CODE_ID = '00000000-0000-0000-0000-0000000c0de1';

/**
 * These cases cover sale/return mechanics, not cost visibility. The gate is
 * wired fail-closed so they exercise the projection an actor without
 * `sales.sale.view-cost-margin` receives; `sales.cost-visibility.spec.ts` pins
 * the gate's own behaviour on both sides.
 */

// WP-007 Phase A: sales entry points take the resolved TenantContext first.
const ctx = contextFor(TENANT_A);


const branchId = '11111111-1111-4111-8111-111111111111';
// WP-007 Phase A: the device-authenticated POS sale path derives its
// TenantContext from the enrolled terminal's own tenant_id, so terminal
// doubles carry one.
const tenantId = '44444444-4444-4444-8444-444444444444';
const terminal = {
  id: '22222222-2222-4222-8222-222222222222',
  branch_id: branchId,
  tenant_id: tenantId,
};
const shiftId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const variantId = '55555555-5555-4555-8555-555555555555';
const syncId = '66666666-6666-4666-8666-666666666666';
const sellerId = '77777777-7777-4777-8777-777777777777';
const cashierId = '88888888-8888-4888-8888-888888888888';
const occurredAt = '2026-07-22T10:00:00.000Z';
const actor = actorFor('cashier', { sub: cashierId, branchId });

function saleDto(overrides: Record<string, unknown> = {}) {
  return {
    event_version: 2,
    sync_id: syncId,
    branch_id: branchId,
    shift_id: shiftId,
    origin_cashier_id: cashierId,
    cashier_name_snapshot: 'Cashier One',
    seller_id: sellerId,
    seller_name_snapshot: 'Seller One',
    offline_session_id: sessionId,
    terminal_sequence: '1',
    occurred_at: occurredAt,
    items: [
      {
        variant_id: variantId,
        qty: 2,
        unit_price: 150,
        unit_tax: 21,
        sku_snapshot: 'SKU-1',
        name_ar_snapshot: 'قميص',
        name_en_snapshot: 'Shirt',
        variant_label_snapshot: 'M · Blue',
      },
    ],
    payment_method: 'cash',
    language: 'ar',
    local_total: 342,
    ...overrides,
  } as any;
}

const warehouseId = '99999999-0000-4000-8000-000000000001';

/**
 * InventoryService double: the stock engine is proven against Postgres by
 * `scripts/verify-inventory-engine.cjs`; these specs pin what sales asks of it.
 * `apply` reports the quantity after the command per line.
 */
function inventoryDouble(qtyAfter = 8, reserved = 0, avgCost = 100) {
  return {
    defaultWarehouseId: jest.fn().mockResolvedValue(warehouseId),
    drawnLots: jest.fn().mockResolvedValue([]),
    serialStates: jest.fn().mockResolvedValue([]),
    apply: jest.fn().mockImplementation((_tx: unknown, command: any) =>
      Promise.resolve(
        command.lines.map((line: any) => ({
          variantId: line.variantId,
          qtyBefore: new Prisma.Decimal(qtyAfter).minus(line.qtyDelta),
          qtyAfter: new Prisma.Decimal(qtyAfter),
          reserved: new Prisma.Decimal(reserved),
          avgCostBefore: new Prisma.Decimal(avgCost),
          avgCost: new Prisma.Decimal(avgCost),
        })),
      ),
    ),
  };
}

function setupSale(options: {
  currentPrice?: number;
  currentTax?: number;
  lastSequence?: bigint;
  stockAfter?: number;
  stockReserved?: number;
  existing?: any;
  closedShift?: boolean;
  missingCashier?: boolean;
  missingSeller?: boolean;
  itemType?: string;
  uomPrecision?: number;
} = {}) {
  const tx = {
    // The terminal claim (lock + advance + branch code); the customer upsert is
    // the only other raw statement a sale issues.
    $queryRaw: jest.fn().mockImplementation(() =>
      Promise.resolve([
        {
          branch_id: branchId,
          branch_code: 'BOLD-01',
          previous_sequence: options.lastSequence ?? 0n,
        },
      ]),
    ),
    shift: {
      // Both the by-id lookup (sale) and the open-shift lookup (return) are
      // now tenant-scoped `findFirst` calls, so one double serves both and
      // discriminates on the filter it was given.
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
          where?.status === 'open'
            ? { id: shiftId }
            : {
                id: shiftId,
                branch_id: branchId,
                status: options.closedShift ? 'closed' : 'open',
                opening_cash: 50,
                closing_cash: options.closedShift ? 400 : null,
                expected_cash: options.closedShift ? 400 : null,
                difference: options.closedShift ? 0 : null,
                opened_at: new Date('2026-07-22T08:00:00.000Z'),
                closed_at: options.closedShift
                  ? new Date('2026-07-22T12:00:00.000Z')
                  : null,
              },
        ),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    // Staff are looked up through their Membership (role + branch scope).
    membership: {
      findMany: jest.fn().mockImplementation(() => {
        const scope = [
          { scope_type: 'location', scope_ref_id: branchId, effective_from: new Date('2020-01-01'), effective_to: null },
        ];
        return Promise.resolve([
          ...(options.missingCashier ? [] : [{ user_id: cashierId, role: 'cashier', access_scope_assignments: scope }]),
          ...(options.missingSeller ? [] : [{ user_id: sellerId, role: 'seller', access_scope_assignments: scope }]),
        ]);
      }),
    },
    salesInvoice: {
      // One lookup finds both the sync-id replay and the terminal-sequence owner.
      findMany: jest.fn().mockImplementation(() =>
        Promise.resolve(options.existing ? [{ sync_id: syncId, ...options.existing }] : []),
      ),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'sale-1', ...data })),
    },
    salesInvoiceItem: {
      createManyAndReturn: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(data.map((item: any) => ({ ...item }))),
      ),
    },
    productVariant: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: variantId,
          product_id: 'product-1',
          cost_price: 100,
          item_type: options.itemType ?? 'stocked',
          base_uom: options.uomPrecision === undefined ? null : { precision: options.uomPrecision },
          is_active: true,
          product: {
            is_active: true,
            category_id: null,
            brand: null,
          },
        },
      ]),
    },
    customer: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    salesTaxSnapshot: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    $transaction: jest.fn((callback) => callback(tx)),
  };
  const pricing = {
    calculateMany: jest.fn().mockResolvedValue(
      new Map([
        [
          variantId,
          {
            net_price: options.currentPrice ?? 150,
            tax_amount: options.currentTax ?? 21,
            // WP-008 Phase C (BR-TAX-202): `calculateMany` now resolves the
            // snapshot alongside the price, and `SalesService` writes it
            // inside the sale transaction. Note the snapshot's amounts are the
            // SERVER-resolved ones, so they stay consistent with
            // `rate_snapshot` even in the tests below that deliberately make
            // the till submit a different price (PRICE_VARIANCE).
            tax: {
              tax_code_id: TAX_CODE_ID,
              code_snapshot: 'STANDARD',
              rate_snapshot: new Prisma.Decimal('14.0000'),
              base_amount: new Prisma.Decimal(options.currentPrice ?? 150),
              tax_amount: new Prisma.Decimal(options.currentTax ?? 21),
              mode_snapshot: 'exclusive',
              version_snapshot: 1,
              rounding_policy_snapshot: 'line',
              exemption_id: null,
              net_amount: new Prisma.Decimal(options.currentPrice ?? 150),
              gross_amount: new Prisma.Decimal(
                (options.currentPrice ?? 150) + (options.currentTax ?? 21),
              ),
            },
          },
        ],
      ]),
    ),
  };
  const inventory = inventoryDouble(options.stockAfter ?? 8, options.stockReserved ?? 0);
  return {
    service: new SalesService(
      prisma as any,
      pricing as any,
      new CostVisibilityService(),
      new SalesTaxSnapshotService(),
      inventory as any,
    ),
    prisma,
    pricing,
    tx,
    inventory,
  };
}

function fingerprint(service: SalesService, dto: any) {
  return (service as any).saleCommandFingerprint(
    dto,
    terminal.id,
    new Date(occurredAt),
    (service as any).normalizeLines(dto.items),
  );
}

function setupReturn(alreadyReturned = 0, itemType = 'stocked', tracking = 'none') {
  const soldItem = {
    id: 'sale-item-1',
    variant_id: variantId,
    qty: new Prisma.Decimal(3),
    unit_price: 150,
    unit_cost: 100,
    unit_tax: 21,
    variant: { item_type: itemType, tracking, base_uom: null },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    shift: { findFirst: jest.fn().mockResolvedValue({ id: shiftId }) },
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
    service: new SalesService(
      prisma as any,
      {} as any,
      new CostVisibilityService(),
      new SalesTaxSnapshotService(),
      inventory as any,
    ),
    tx,
    inventory,
  };
}

describe('SalesService acceptance-first sale synchronization', () => {
  it('rejects a terminal assigned to another branch before mutation', async () => {
    const { service, prisma } = setupSale();
    await expect(
      service.createSale(saleDto(), {
        ...terminal,
        branch_id: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('persists immutable snapshots and posts one inventory command for the whole sale', async () => {
    const { service, tx, inventory } = setupSale();
    const result = await service.createSale(saleDto(), terminal);

    expect(tx.salesInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_version: 2,
          warning_codes: [],
          cashier_name_snapshot: 'Cashier One',
          seller_name_snapshot: 'Seller One',
          terminal_sequence: 1n,
        }),
      }),
    );
    expect(tx.salesInvoiceItem.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sku_snapshot: 'SKU-1',
          name_ar_snapshot: 'قميص',
          unit_price: expect.anything(),
        }),
      ],
    });
    expect(result.items.every((item: any) => !('unit_cost' in item))).toBe(true);
    // One statement of its own (the terminal lock); stock goes through the engine.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(inventory.apply).toHaveBeenCalledTimes(1);
    const [, command] = inventory.apply.mock.calls[0];
    expect(command).toMatchObject({
      tenantId,
      warehouseId,
      type: 'sale',
      allowNegative: true,
      idempotencyKey: `sale:${syncId}`,
      reference: { type: 'SalesInvoice' },
    });
    expect(command.lines).toHaveLength(1);
    expect(command.lines[0].qtyDelta.toString()).toBe('-2');
    // The sale line is stamped with the warehouse average cost at the sale.
    const line = tx.salesInvoiceItem.createManyAndReturn.mock.calls[0][0].data[0];
    expect(line.unit_cost.toFixed(4)).toBe('100.0000');
    expect(line.id).toBe(command.lines[0].referenceLineId);
    expect(String(result.total)).toBe('342');
  });

  it('accepts the locally paid price after cloud pricing changes', async () => {
    const { service, tx } = setupSale({
      currentPrice: 175,
      currentTax: 24.5,
    });

    const result = await service.createSale(saleDto(), terminal);

    expect(result.warning_codes).toContain('PRICE_VARIANCE');
    expect(tx.salesInvoice.create.mock.calls[0][0].data.total.toFixed(2)).toBe(
      '342.00',
    );
  });

  it('accepts a sale that makes cloud stock negative and records a warning', async () => {
    const { service } = setupSale({ stockAfter: -2 });
    const result = await service.createSale(saleDto(), terminal);
    expect(result.warning_codes).toContain('NEGATIVE_STOCK');
  });

  it('never sends a service or non-stock item to the inventory engine', async () => {
    const { service, inventory } = setupSale({ itemType: 'service' });
    const result = await service.createSale(saleDto(), terminal);

    expect(result.warning_codes).not.toContain('NEGATIVE_STOCK');
    expect(inventory.apply).toHaveBeenCalledTimes(1);
    expect(inventory.apply.mock.calls[0][1].lines).toEqual([]);
  });

  it('accepts a fractional quantity for a unit that allows it and rejects it for pieces', async () => {
    const kgDto = saleDto({
      items: [{ ...saleDto().items[0], qty: 1.25, unit_price: 100, unit_tax: 14 }],
      local_total: 142.5,
    });
    const kg = setupSale({ uomPrecision: 3, currentPrice: 100, currentTax: 14 });
    // The mocked quote is per unit; 1.25 kg x (100 + 14) = 142.50.
    await kg.service.createSale(kgDto, terminal);
    expect(kg.inventory.apply.mock.calls[0][1].lines[0].qtyDelta.toString()).toBe('-1.25');

    const piece = setupSale({ uomPrecision: 0, currentPrice: 100, currentTax: 14 });
    await expect(piece.service.createSale(kgDto, terminal)).rejects.toMatchObject({
      response: { code: 'QUANTITY_PRECISION_EXCEEDED' },
    });
    // No unit at all behaves like pieces: integers only.
    const noUnit = setupSale({ currentPrice: 100, currentTax: 14 });
    await expect(noUnit.service.createSale(kgDto, terminal)).rejects.toMatchObject({
      response: { code: 'QUANTITY_PRECISION_EXCEEDED' },
    });
    expect(piece.inventory.apply).not.toHaveBeenCalled();
  });

  it('accepts a sequence gap and advances the terminal high-water mark', async () => {
    const { service } = setupSale({ lastSequence: 1n });
    const result = await service.createSale(
      saleDto({ terminal_sequence: '3' }),
      terminal,
    );

    // The high-water mark itself moves in the claim statement (GREATEST in SQL),
    // which verify-inventory-engine.cjs runs against Postgres.
    expect(result.warning_codes).toContain('SEQUENCE_GAP');
  });

  it('accepts an older delayed sequence without moving the high-water mark back', async () => {
    const { service } = setupSale({ lastSequence: 5n });
    const result = await service.createSale(
      saleDto({ terminal_sequence: '3' }),
      terminal,
    );

    expect(result.warning_codes).toContain('OUT_OF_ORDER_SEQUENCE');
  });

  /**
   * Unconditional, unlike every other cost mask in this codebase: `POST
   * /pos/sale` is authenticated by device token, so there is no membership for
   * the gate to resolve, so cost never goes on the wire here.
   */
  it('never returns unit_cost on the POS sale response', async () => {
    const { service, tx } = setupSale();
    const result: any = await service.createSale(saleDto(), terminal);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('unit_cost');
    // The persisted line still carries it — the ledger and the margin reports
    // are built from this row, not from the response.
    const written = tx.salesInvoiceItem.createManyAndReturn.mock.calls[0][0].data[0];
    expect(written.unit_cost).toBeDefined();
  });

  it('returns the existing invoice for an identical replay', async () => {
    const { service, tx, inventory } = setupSale();
    const dto = saleDto();
    const existing = {
      id: 'sale-1',
      branch_id: branchId,
      terminal_id: terminal.id,
      shift_id: shiftId,
      offline_session_id: sessionId,
      terminal_sequence: 1n,
      command_fingerprint: fingerprint(service, dto),
      warning_codes: [],
      items: [],
    };
    tx.salesInvoice.findMany.mockResolvedValue([{ ...existing, sync_id: syncId }]);

    // `toEqual`, not `toBe`: the replay returns the same invoice through the
    // same cost projection as a first-time post, which is a copy rather than
    // the stored row. Identity was never what this case was pinning — that the
    // replay neither re-posts inventory nor writes a second invoice is.
    await expect(service.createSale(dto, terminal)).resolves.toEqual({ ...existing, sync_id: syncId });
    expect(inventory.apply).not.toHaveBeenCalled();
    expect(tx.salesInvoice.create).not.toHaveBeenCalled();
  });

  it('quarantines a reused sync id carrying different financial content', async () => {
    const { service, tx } = setupSale();
    const original = saleDto();
    tx.salesInvoice.findMany.mockResolvedValue([
      {
        id: 'sale-1',
        sync_id: syncId,
        branch_id: branchId,
        terminal_id: terminal.id,
        shift_id: shiftId,
        offline_session_id: sessionId,
        terminal_sequence: 1n,
        command_fingerprint: fingerprint(service, original),
        items: [],
      },
    ]);

    await expect(
      service.createSale(saleDto({ payment_method: 'card' }), terminal),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps a completed offline sale attributable when users were later removed', async () => {
    const { service } = setupSale({
      missingCashier: true,
      missingSeller: true,
    });
    const result = await service.createSale(saleDto(), terminal);

    expect(result.cashier_id).toBeNull();
    expect(result.seller_id).toBeNull();
    expect(result.cashier_name_snapshot).toBe('Cashier One');
    expect(result.warning_codes).toEqual(
      expect.arrayContaining([
        'CASHIER_REFERENCE_MISSING',
        'SELLER_REFERENCE_MISSING',
      ]),
    );
  });

  it('accepts a late cash sale and reconciles a closed shift', async () => {
    const { service, tx } = setupSale({ closedShift: true });
    const result = await service.createSale(saleDto(), terminal);

    expect(result.warning_codes).toContain('LATE_SYNC');
    expect(tx.shift.update).toHaveBeenCalledWith({
      where: { id: shiftId },
      data: {
        expected_cash: { increment: expect.anything() },
        difference: { decrement: expect.anything() },
      },
    });
  });

  it('rejects only an internally inconsistent immutable local total', async () => {
    const { service, tx } = setupSale();
    await expect(
      service.createSale(saleDto({ local_total: 999 }), terminal),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.salesInvoice.create).not.toHaveBeenCalled();
  });
});

describe('SalesService returns', () => {
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

describe('SalesService tracked items', () => {
  const withLots = (item: Record<string, unknown>) => saleDto({ items: [{ ...saleDto().items[0], ...item }] });

  it('hands the serials and the picked batch of a line to the engine', async () => {
    const serial = setupSale();
    await serial.service.createSale(withLots({ serials: ['S1', 'S2'] }), terminal);
    expect(serial.inventory.apply.mock.calls[0][1].lines[0].lots).toEqual({ serials: ['S1', 'S2'] });

    const batch = setupSale();
    await batch.service.createSale(withLots({ batch_no: 'LOT-7' }), terminal);
    const [entry] = batch.inventory.apply.mock.calls[0][1].lines[0].lots.batches;
    expect(entry.batchNo).toBe('LOT-7');
    expect(entry.qty.toString()).toBe('2');
  });

  it('sends no lots at all for a line that names none (a POS without tracking)', async () => {
    const { service, inventory } = setupSale();
    await service.createSale(saleDto(), terminal);
    expect(inventory.apply.mock.calls[0][1].lines[0]).not.toHaveProperty('lots');
  });

  it('merges the serials and batches of duplicate lines of one variant', async () => {
    const line = saleDto().items[0];
    const { service, inventory } = setupSale();
    await service.createSale(
      saleDto({
        items: [
          { ...line, qty: 1, serials: ['A'], batch_no: 'X' },
          { ...line, qty: 1, serials: ['B', 'A'], batch_no: 'Y' },
        ],
      }),
      terminal,
    );
    const lots = inventory.apply.mock.calls[0][1].lines[0].lots;
    expect(lots.serials).toEqual(['A', 'B']);
    expect(lots.batches.map((batch: any) => [batch.batchNo, batch.qty.toString()])).toEqual([['X', '1'], ['Y', '1']]);
  });

  it('records what the engine caveats about serials and batches as warning codes, never as a refusal', async () => {
    const { service, inventory } = setupSale();
    inventory.apply.mockImplementation(async (_tx: unknown, command: any) =>
      command.lines.map((line: any) => ({
        variantId: line.variantId,
        qtyBefore: new Prisma.Decimal(5),
        qtyAfter: new Prisma.Decimal(3),
        reserved: new Prisma.Decimal(0),
        avgCostBefore: new Prisma.Decimal(100),
        avgCost: new Prisma.Decimal(100),
        warnings: ['SERIAL_NOT_CAPTURED', 'SERIAL_NOT_IN_STOCK', 'BATCH_UNALLOCATED'],
      })),
    );
    const result = await service.createSale(saleDto(), terminal);
    expect(result.warning_codes).toEqual(['BATCH_UNALLOCATED', 'SERIAL_NOT_CAPTURED', 'SERIAL_NOT_IN_STOCK']);
  });

  it('cleans serials instead of validating them: garbage never blocks an upload', () => {
    const dto = (serials: unknown, batch_no?: unknown) =>
      plainToInstance(CreateSaleItemDto, { ...saleDto().items[0], serials, batch_no });
    expect(dto([' A ', '', 'A', 7, null, {}, 'x'.repeat(192)]).serials).toEqual(['A', '7']);
    expect(dto('not-an-array').serials).toBeUndefined();
    expect(dto([]).serials).toBeUndefined();
    expect(dto(undefined, '  ').batch_no).toBeUndefined();
    expect(dto(undefined, ' L1 ').batch_no).toBe('L1');
    expect(validateSync(dto(['A', ''], 42), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

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
