import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

/**
 * These cases cover sale/return mechanics, not cost visibility. The gate is
 * wired fail-closed so they exercise the projection an actor without
 * `sales.sale.view-cost-margin` receives; `sales.cost-visibility.spec.ts` pins
 * the gate's own behaviour on both sides.
 */
const costVisibilityAnswering = (allowed: boolean) =>
  new CostVisibilityService({
    hasPermission: async () => allowed,
  } as unknown as PermissionPolicyService);
const maskedCostVisibility = () => costVisibilityAnswering(false);

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
const actor = {
  sub: cashierId,
  role: 'cashier' as const,
  branch_id: branchId,
};

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
        size_snapshot: 'M',
        color_snapshot: 'Blue',
      },
    ],
    payment_method: 'cash',
    language: 'ar',
    local_total: 342,
    ...overrides,
  } as any;
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
  /** Only the POS-response cost case needs this — see that test for why. */
  hasCostMargin?: boolean;
} = {}) {
  let rawCall = 0;
  const tx = {
    $queryRaw: jest.fn().mockImplementation(() => {
      rawCall += 1;
      if (rawCall === 1) {
        return Promise.resolve([
          {
            id: terminal.id,
            branch_id: branchId,
            last_sale_sequence: options.lastSequence ?? 0n,
          },
        ]);
      }
      return Promise.resolve([]);
    }),
    branch: {
      findFirst: jest.fn().mockResolvedValue({
        id: branchId,
        code: 'BOLD-01',
      }),
    },
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
    user: {
      findFirst: jest.fn().mockImplementation(({ where }) => {
        if (where.id === sellerId) {
          return Promise.resolve(
            options.missingSeller
              ? null
              : {
                  id: sellerId,
                  name: 'Seller One',
                  role: 'seller',
                  branch_id: branchId,
                },
          );
        }
        return Promise.resolve(
          options.missingCashier
            ? null
            : {
                id: cashierId,
                name: 'Cashier One',
                role: 'cashier',
                branch_id: branchId,
              },
        );
      }),
    },
    posTerminal: {
      update: jest.fn().mockResolvedValue({}),
    },
    salesInvoice: {
      // Both the sync-id replay lookup and the terminal-sequence owner check
      // are tenant-scoped findFirst calls now; discriminate on the filter.
      findFirst: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(where?.sync_id ? (options.existing ?? null) : null),
      ),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'sale-1',
          ...data,
          items: data.items.create.map((item: any, index: number) => ({
            id: `sale-item-${index + 1}`,
            sales_invoice_id: 'sale-1',
            ...item,
          })),
        }),
      ),
    },
    productVariant: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: variantId,
          product_id: 'product-1',
          cost_price: 100,
          is_active: true,
          product: {
            is_active: true,
            category_id: null,
            brand: null,
          },
        },
      ]),
    },
    inventoryStock: {
      upsert: jest.fn().mockResolvedValue({
        qty_on_hand: options.stockAfter ?? 8,
        qty_reserved: options.stockReserved ?? 0,
      }),
    },
    customer: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
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
          },
        ],
      ]),
    ),
  };
  return {
    service: new SalesService(
      prisma as any,
      pricing as any,
      costVisibilityAnswering(options.hasCostMargin ?? false),
    ),
    prisma,
    pricing,
    tx,
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

function setupReturn(alreadyReturned = 0, hasCostMargin = false) {
  const soldItem = {
    id: 'sale-item-1',
    variant_id: variantId,
    qty: 3,
    unit_price: 150,
    unit_cost: 100,
    unit_tax: 21,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
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
      aggregate: jest.fn().mockResolvedValue({
        _sum: { qty: alreadyReturned },
      }),
    },
    return: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'return-1',
          ...data,
          items: data.items.create,
        }),
      ),
    },
    inventoryStock: { upsert: jest.fn().mockResolvedValue({}) },
    productVariant: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    customer: { findUnique: jest.fn(), update: jest.fn() },
  };
  const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
  return {
    service: new SalesService(prisma as any, {} as any, costVisibilityAnswering(hasCostMargin)),
    tx,
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

  it('persists immutable snapshots and one inventory ledger movement', async () => {
    const { service, tx } = setupSale();
    const result = await service.createSale(saleDto(), terminal);

    expect(tx.salesInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_version: 2,
          warning_codes: [],
          cashier_name_snapshot: 'Cashier One',
          seller_name_snapshot: 'Seller One',
          terminal_sequence: 1n,
          items: {
            create: [
              expect.objectContaining({
                sku_snapshot: 'SKU-1',
                name_ar_snapshot: 'قميص',
                unit_price: expect.anything(),
              }),
            ],
          },
        }),
      }),
    );
    expect(result.items.every((item: any) => !('unit_cost' in item))).toBe(true);
    expect(tx.inventoryStock.upsert).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
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

  it('accepts a sequence gap and advances the terminal high-water mark', async () => {
    const { service, tx } = setupSale({ lastSequence: 1n });
    const result = await service.createSale(
      saleDto({ terminal_sequence: '3' }),
      terminal,
    );

    expect(result.warning_codes).toContain('SEQUENCE_GAP');
    expect(tx.posTerminal.update).toHaveBeenCalledWith({
      where: { id: terminal.id },
      data: { last_sale_sequence: 3n },
    });
  });

  it('accepts an older delayed sequence without moving the high-water mark back', async () => {
    const { service, tx } = setupSale({ lastSequence: 5n });
    const result = await service.createSale(
      saleDto({ terminal_sequence: '3' }),
      terminal,
    );

    expect(result.warning_codes).toContain('OUT_OF_ORDER_SEQUENCE');
    expect(tx.posTerminal.update).not.toHaveBeenCalled();
  });

  /**
   * Unconditional, unlike every other cost mask in this codebase: `POST
   * /pos/sale` is authenticated by device token, so there is no membership for
   * the gate to resolve. `hasCostMargin: true` is the point of the case — even
   * an answering gate must not put cost on the wire here.
   */
  it('never returns unit_cost on the POS sale response, whatever the gate answers', async () => {
    const { service, tx } = setupSale({ hasCostMargin: true });
    const result: any = await service.createSale(saleDto(), terminal);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('unit_cost');
    // The persisted line still carries it — the ledger and the margin reports
    // are built from this row, not from the response.
    const written = tx.salesInvoice.create.mock.calls[0][0].data.items.create[0];
    expect(written.unit_cost).toBeDefined();
  });

  it('returns the existing invoice for an identical replay', async () => {
    const { service, tx } = setupSale();
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
    tx.salesInvoice.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.sync_id ? existing : null),
    );

    // `toEqual`, not `toBe`: the replay returns the same invoice through the
    // same cost projection as a first-time post, which is a copy rather than
    // the stored row. Identity was never what this case was pinning — that the
    // replay neither re-posts inventory nor writes a second invoice is.
    await expect(service.createSale(dto, terminal)).resolves.toEqual(existing);
    expect(tx.inventoryStock.upsert).not.toHaveBeenCalled();
    expect(tx.salesInvoice.create).not.toHaveBeenCalled();
  });

  it('quarantines a reused sync id carrying different financial content', async () => {
    const { service, tx } = setupSale();
    const original = saleDto();
    tx.salesInvoice.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where?.sync_id
          ? {
              id: 'sale-1',
              branch_id: branchId,
              terminal_id: terminal.id,
              shift_id: shiftId,
              offline_session_id: sessionId,
              terminal_sequence: 1n,
              command_fingerprint: fingerprint(service, original),
              items: [],
            }
          : null,
      ),
    );

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
    const { service } = setupReturn(0, true);
    const result: any = await service.createReturn(
      ctx,
      {
        original_invoice_id: 'sale-1',
        items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
        reason: 'Wrong size',
      },
      // `membership_role` is what the gate resolves the grant against; the
      // module's other cases omit it, which is why they mask regardless.
      { ...actor, membership_role: 'location_manager' } as any,
    );

    expect(Number(result.items[0].unit_cost)).toBe(100);
  });

  it('masks the return response when the actor carries no membership_role, gate permissive', async () => {
    // Fail-closed: no membership means no resolvable grant, so the answer is
    // "no" even against a gate that would otherwise allow it.
    const { service } = setupReturn(0, true);
    const result: any = await service.createReturn(
      ctx,
      {
        original_invoice_id: 'sale-1',
        items: [{ sales_invoice_item_id: 'sale-item-1', qty: 2 }],
        reason: 'Wrong size',
      },
      actor,
    );

    expect(result.items[0]).not.toHaveProperty('unit_cost');
  });
});
