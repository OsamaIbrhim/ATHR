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
import { inventoryDouble, warehouseId } from './testing/inventory-double';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateSaleItemDto } from './dto/create-sale.dto';

// The per-tenant counter is one real statement (covered against Postgres by
// scripts/verify-document-sequence.cjs); these specs only need a number back.
jest.mock('../common/document-sequence', () => ({
  ...jest.requireActual('../common/document-sequence'),
  nextDocumentValue: jest.fn().mockResolvedValue(1n),
  nextDocumentNumber: jest.fn().mockImplementation((_tx: unknown, _tenant: string, key: string) =>
    Promise.resolve(key === 'terminal' ? 'POS1' : 'R-000001')),
}));

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
    invoice_number: 'POS1-000001',
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
    payments: [{ method: 'cash', amount: 342 }],
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
          terminal_code: 'POS1',
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
    salesPayment: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    customerLedgerEntry: { create: jest.fn().mockResolvedValue({}) },
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
      service.createSale(saleDto({ payments: [{ method: 'card', amount: 342 }] }), terminal),
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

  it('reconciles a closed shift by the cash tendered only, not by the whole total', async () => {
    const { service, tx } = setupSale({ closedShift: true });
    await service.createSale(saleDto({ payments: [{ method: 'cash', amount: 100 }, { method: 'card', amount: 242 }] }), terminal);
    expect(tx.shift.update.mock.calls[0][0].data.expected_cash.increment.toString()).toBe('100');

    const cardOnly = setupSale({ closedShift: true });
    await cardOnly.service.createSale(saleDto({ payments: [{ method: 'card', amount: 342 }] }), terminal);
    expect(cardOnly.tx.shift.update).not.toHaveBeenCalled();
  });

  it('accepts a total that does not match its lines: the till total is stored, with a warning', async () => {
    const { service, tx } = setupSale();
    const result = await service.createSale(saleDto({ local_total: 999 }), terminal);
    expect(result.warning_codes).toContain('LOCAL_TOTAL_MISMATCH');
    expect(tx.salesInvoice.create.mock.calls[0][0].data.total.toString()).toBe('999');
    expect(tx.salesInvoice.create.mock.calls[0][0].data.subtotal.toString()).toBe('300');
  });

  it('stores one row per tender, in order, with the cash handed over', async () => {
    const { service, tx } = setupSale();
    const result = await service.createSale(
      saleDto({ payments: [{ method: 'cash', amount: 300, tendered: 500 }, { method: 'card', amount: 42, reference: 'R1' }] }),
      terminal,
    );
    const rows = tx.salesPayment.createMany.mock.calls[0][0].data;
    expect(rows.map((row: any) => [row.sequence, row.method, row.amount.toString(), row.tendered?.toString() ?? null])).toEqual([
      [1, 'cash', '300', '500'],
      [2, 'card', '42', null],
    ]);
    expect(rows.every((row: any) => row.sales_invoice_id === result.id && row.tenant_id === tenantId)).toBe(true);
    expect(result.warning_codes).not.toContain('PAYMENT_TOTAL_MISMATCH');
  });

  it('accepts payments that do not add up, and a method the tenant disabled, with warnings', async () => {
    const { service, tx } = setupSale();
    const result = await service.createSale(saleDto({ payments: [{ method: 'bank_transfer', amount: 100 }] }), terminal);
    expect(result.warning_codes).toEqual(expect.arrayContaining(['PAYMENT_TOTAL_MISMATCH', 'PAYMENT_METHOD_DISABLED']));
    expect(tx.salesPayment.createMany).toHaveBeenCalled();
  });

  describe('sales on credit', () => {
    const creditSale = (extra: Record<string, unknown> = {}) =>
      saleDto({ customer_phone: '01012345678', payments: [{ method: 'cash', amount: 142 }, { method: 'credit', amount: 200 }], ...extra });
    /** The claim statement answers first, the customer upsert second. */
    const withCustomer = (setup: ReturnType<typeof setupSale>, customer: { balance: number; credit_limit: number | null }) => {
      const claim = {
        branch_id: branchId, branch_code: 'BOLD-01', terminal_code: 'POS1', settings: {}, previous_sequence: 0n,
      };
      setup.tx.$queryRaw.mockReset();
      setup.tx.$queryRaw.mockResolvedValueOnce([claim]).mockResolvedValueOnce([{ id: 'customer-1', ...customer }]);
    };

    it('books the credit part on the customer and writes one ledger entry with the balance it produced', async () => {
      const setup = setupSale();
      withCustomer(setup, { balance: 200, credit_limit: null });
      const result = await setup.service.createSale(creditSale(), terminal);
      const upsert = setup.tx.$queryRaw.mock.calls[1];
      expect(upsert[0].join('?')).toContain('"balance" = "Customer"."balance" + EXCLUDED."balance"');
      expect(upsert.slice(1).map((value: unknown) => String(value))).toContain('200');
      expect(setup.tx.customerLedgerEntry.create).toHaveBeenCalledTimes(1);
      const entry = setup.tx.customerLedgerEntry.create.mock.calls[0][0].data;
      expect([entry.type, entry.amount.toString(), entry.balance_after.toString(), entry.customer_id, entry.sales_invoice_id]).toEqual([
        'sale_credit', '200', '200', 'customer-1', result.id,
      ]);
      expect(result.warning_codes).not.toContain('CUSTOMER_CREDIT_LIMIT_EXCEEDED');
    });

    it('accepts a credit sale beyond the credit limit, with a warning', async () => {
      const setup = setupSale();
      withCustomer(setup, { balance: 600, credit_limit: 500 });
      const result = await setup.service.createSale(creditSale(), terminal);
      expect(result.warning_codes).toContain('CUSTOMER_CREDIT_LIMIT_EXCEEDED');
      expect(setup.tx.customerLedgerEntry.create).toHaveBeenCalled();
    });

    it('accepts credit without a customer, with a warning and no ledger entry', async () => {
      const { service, tx } = setupSale();
      const result = await service.createSale(creditSale({ customer_phone: undefined }), terminal);
      expect(result.warning_codes).toContain('CREDIT_WITHOUT_CUSTOMER');
      expect(tx.customerLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('writes no ledger entry for a sale without credit', async () => {
      const setup = setupSale();
      withCustomer(setup, { balance: 0, credit_limit: 10 });
      const result = await setup.service.createSale(saleDto({ customer_phone: '01012345678' }), terminal);
      expect(setup.tx.customerLedgerEntry.create).not.toHaveBeenCalled();
      expect(result.warning_codes).not.toContain('CUSTOMER_CREDIT_LIMIT_EXCEEDED');
    });
  });

  describe('discounts', () => {
    const lineWith = (discount?: unknown) => [{ ...saleDto().items[0], discount }];
    const tenPercent = () =>
      saleDto({ items: lineWith({ type: 'percent', value: 10 }), payments: [{ method: 'cash', amount: 307.8 }], local_total: 307.8 });
    const halfOff = () =>
      saleDto({ items: lineWith({ type: 'percent', value: 50 }), payments: [{ method: 'cash', amount: 171 }], local_total: 171 });

    it('stores the discount and the tax after it on the line, and the discount total on the invoice', async () => {
      const { service, tx } = setupSale();
      const result = await service.createSale(tenPercent(), terminal);
      const line = tx.salesInvoiceItem.createManyAndReturn.mock.calls[0][0].data[0];
      expect([line.unit_price.toString(), line.unit_tax.toString(), line.discount_amount.toString(), line.tax_amount.toString()]).toEqual(['150', '21', '30', '37.8']);
      const invoice = tx.salesInvoice.create.mock.calls[0][0].data;
      expect([invoice.subtotal.toString(), invoice.discount_amount.toString(), invoice.tax_amount.toString(), invoice.total.toString()]).toEqual(['300', '30', '37.8', '307.8']);
      expect(result.warning_codes).not.toContain('LOCAL_TOTAL_MISMATCH');
      expect(result.warning_codes).not.toContain('DISCOUNT_ABOVE_LIMIT');
    });

    it('records the tax snapshot over the discounted base', async () => {
      const { service, tx } = setupSale();
      await service.createSale(tenPercent(), terminal);
      const snapshot = tx.salesTaxSnapshot.createMany.mock.calls[0][0].data[0];
      expect([snapshot.base_amount.toString(), snapshot.tax_amount.toString()]).toEqual(['270', '37.8']);
    });

    it('accepts a discount above the cashier limit, flagged', async () => {
      const { service } = setupSale();
      expect((await service.createSale(halfOff(), terminal)).warning_codes).toContain('DISCOUNT_ABOVE_LIMIT');
    });

    it('lets a manager (override) discount beyond the limit without a flag', async () => {
      const { service, tx } = setupSale();
      tx.membership.findMany.mockImplementation(() =>
        Promise.resolve([
          {
            user_id: cashierId,
            role: 'location_manager',
            granted_permissions: [],
            revoked_permissions: [],
            access_scope_assignments: [{ scope_type: 'location', scope_ref_id: branchId, effective_from: new Date('2020-01-01'), effective_to: null }],
          },
        ]),
      );
      expect((await service.createSale(halfOff(), terminal)).warning_codes).not.toContain('DISCOUNT_ABOVE_LIMIT');
    });

    it('merges two lines of one variant that carry different discounts instead of refusing the sale', async () => {
      const { service, tx } = setupSale();
      const base = saleDto().items[0];
      await service.createSale(
        saleDto({
          items: [{ ...base, qty: 1, discount: { type: 'amount', value: 10 } }, { ...base, qty: 1 }],
          payments: [{ method: 'cash', amount: 330.6 }],
          local_total: 330.6,
        }),
        terminal,
      );
      const rows = tx.salesInvoiceItem.createManyAndReturn.mock.calls[0][0].data;
      expect(rows).toHaveLength(1);
      expect([rows[0].qty.toString(), rows[0].discount_amount.toString()]).toEqual(['2', '10']);
    });

    it('fingerprints the discounts, and leaves a sale without any untouched', () => {
      const { service } = setupSale();
      const plain = fingerprint(service, saleDto());
      expect(fingerprint(service, saleDto({ items: lineWith({ type: 'amount', value: 5 }) }))).not.toBe(plain);
      expect(fingerprint(service, saleDto({ discount: { type: 'percent', value: 5 } }))).not.toBe(plain);
      expect(fingerprint(service, saleDto({ items: lineWith(undefined) }))).toBe(plain);
    });
  });

  it('stores the printed invoice number verbatim', async () => {
    const { service } = setupSale();
    const result = await service.createSale(saleDto(), terminal);
    expect(result.invoice_number).toBe('POS1-000001');
    expect(result.warning_codes).not.toContain('INVOICE_NUMBER_REASSIGNED');
  });

  it('prints {terminal_code}-{sequence} when the till sent no usable number', async () => {
    const { service } = setupSale();
    const result = await service.createSale(saleDto({ invoice_number: undefined, terminal_sequence: '7' }), terminal);
    expect(result.invoice_number).toBe('POS1-000007');
    expect(result.warning_codes).toContain('INVOICE_NUMBER_REASSIGNED');
  });

  it('stores a sale whose number is already taken under a suffix and warns, never refuses', async () => {
    const { service, tx } = setupSale();
    tx.salesInvoice.findMany.mockResolvedValue([
      { sync_id: 'another-sync', invoice_number: 'POS1-000001' },
      { sync_id: 'third-sync', invoice_number: 'POS1-000001-2' },
    ]);
    const result = await service.createSale(saleDto(), terminal);
    expect(result.invoice_number).toBe('POS1-000001-3');
    expect(result.warning_codes).toContain('INVOICE_NUMBER_REASSIGNED');
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

});
