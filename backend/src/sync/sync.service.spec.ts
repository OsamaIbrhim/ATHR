import { SyncService, SNAPSHOT_PAGE_SIZE, PRODUCT_BATCH_SIZE } from './sync.service';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

const ctx = contextFor(TENANT_A);
const BRANCH = 'branch-1';
const quote = { net_price: 150, tax_amount: 21 };

function variantRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, product_id: `p-${id}`, sku: `SKU-${id}`, label: 'M · Blue', attributes: { size: 'M', color: 'Blue' },
    base_uom_id: null, is_active: true, tracking: 'none', ...extra,
  };
}

/** A prisma mock where each read is observable; `changes` feeds the raw change-stream query. */
function setup(options: { variants?: any[]; changes?: any[]; floor?: string; sellers?: any[] } = {}) {
  const variants = options.variants ?? [variantRow('v1')];
  const prisma: any = {
    tenant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        settings: {},
        sync_floor: options.floor ?? '0:0',
      }),
    },
    // Both the head cursor and the change read are raw queries; the change read has the LIMIT.
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
      strings.join('?').includes('ORDER BY "txid", "sequence"') ? options.changes ?? [] : [{ txid: '10', sequence: 7n }],
    ),
    productVariant: { findMany: jest.fn().mockResolvedValue(variants) },
    product: {
      findMany: jest.fn(async ({ where }: any) =>
        where.id.in.map((id: string) => ({ id, is_active: true, name_en: 'Shirt', name_ar: 'قميص', brand_id: null, category_id: null })),
      ),
    },
    productBarcode: {
      findMany: jest.fn().mockResolvedValue([{ code: '6220001', variant_id: variants[0]?.id, pack_qty: 6, kind: 'standard' }]),
    },
    unitOfMeasure: { findMany: jest.fn().mockResolvedValue([]) },
    inventoryStock: {
      findMany: jest.fn().mockResolvedValue([{ variant_id: 'v1', qty_on_hand: 1.25, qty_reserved: 0, last_sold_at: null }]),
    },
    membership: {
      findMany: jest.fn().mockResolvedValue(options.sellers ?? []),
    },
    posTerminal: { updateMany: jest.fn() },
  };
  const pricing: any = {
    loadActiveRules: jest.fn().mockResolvedValue([]),
    quoteMany: jest.fn((list: any[]) => new Map(list.map((v) => [v.id, quote]))),
  };
  const tax: any = { loadActiveCodeIndex: jest.fn().mockResolvedValue(new Map()) };
  const inventory: any = { defaultWarehouseId: jest.fn().mockResolvedValue('warehouse-1') };
  return { prisma, pricing, service: new SyncService(prisma, pricing, tax, inventory) };
}

describe('SyncService snapshot (first-time, paged)', () => {
  it('returns a versioned page with barcodes, unit info and the start cursor', async () => {
    const { service, prisma } = setup();
    const result: any = await service.pull(ctx, BRANCH);

    expect(result).toMatchObject({
      mode: 'snapshot', catalog_version: 3, cursor: '10:7', has_more: false, snapshot_after: null,
      reset_products: true, reset_stock: true, reset_sellers: true,
    });
    expect(result.settings.scale_barcode).toMatchObject({ enabled: false });
    expect(result.products[0]).toMatchObject({
      id: 'v1', catalog_version: 3, label: 'M · Blue', selling_price: 150, unit_tax: 21, uom_precision: 0,
      barcodes: [{ code: '6220001', pack_qty: 6, kind: 'standard' }],
    });
    expect(result.stock).toEqual([{ branch_id: BRANCH, variant_id: 'v1', qty_on_hand: 1.25, qty_reserved: 0, last_sold_at: null }]);
    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { id: 'asc' }, take: SNAPSHOT_PAGE_SIZE + 1 }));
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('tells the POS how each item is tracked (additive field, default none)', async () => {
    const { service } = setup({ variants: [variantRow('v1'), variantRow('v2', { tracking: 'serial' }), variantRow('v3', { tracking: 'batch' })] });
    const result: any = await service.pull(ctx, BRANCH);
    expect(result.products.map((product: any) => [product.id, product.tracking])).toEqual([
      ['v1', 'none'], ['v2', 'serial'], ['v3', 'batch'],
    ]);
  });

  it('pages by variant id and resumes from snapshot_after with the same cursor', async () => {
    const rows = Array.from({ length: SNAPSHOT_PAGE_SIZE + 1 }, (_, i) => variantRow(`v${String(i).padStart(4, '0')}`));
    const { service, prisma } = setup({ variants: rows });
    const first: any = await service.pull(ctx, BRANCH);
    expect(first.has_more).toBe(true);
    expect(first.products).toHaveLength(SNAPSHOT_PAGE_SIZE);
    expect(first.snapshot_after).toBe(rows[SNAPSHOT_PAGE_SIZE - 1].id);

    prisma.productVariant.findMany.mockResolvedValue([variantRow('v9999')]);
    const next: any = await service.pull(ctx, BRANCH, { snapshot_after: first.snapshot_after, snapshot_cursor: first.cursor });
    expect(next).toMatchObject({ mode: 'snapshot', cursor: first.cursor, has_more: false, reset_products: false });
    expect(next.sellers).toBeUndefined();
    expect(prisma.productVariant.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { gt: first.snapshot_after } }) }),
    );
  });

  it('leaves out a variant that has no resolvable price', async () => {
    const { service, pricing } = setup({ variants: [variantRow('v1'), variantRow('v2')] });
    pricing.quoteMany.mockReturnValue(new Map([['v1', quote]]));
    const result: any = await service.pull(ctx, BRANCH);
    expect(result.products.map((p: any) => p.id)).toEqual(['v1']);
  });
});

describe('SyncService delta (by entity)', () => {
  it('re-reads only the changed variant and stock rows, and only sends sellers/settings when they changed', async () => {
    const { service, prisma } = setup({
      changes: [
        { txid: '20', sequence: 1n, kind: 'variant', entity_key: 'v1' },
        { txid: '20', sequence: 2n, kind: 'inventory', entity_key: 'v2' },
      ],
    });
    const result: any = await service.pull(ctx, BRANCH, { cursor: '10:7' });

    expect(result).toMatchObject({ mode: 'delta', cursor: '20:2', has_more: false, reset_products: false });
    expect(result.products.map((p: any) => p.id)).toEqual(['v1']);
    expect(prisma.productVariant.findMany).toHaveBeenCalledWith({
      where: { tenant_id: ctx.tenantId, OR: [{ id: { in: ['v1'] } }] },
    });
    expect(prisma.inventoryStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ variant_id: { in: ['v2', 'v1'] } }) }),
    );
    expect(result).not.toHaveProperty('sellers');
    expect(result).not.toHaveProperty('settings');
    expect(prisma.membership.findMany).not.toHaveBeenCalled();
  });

  it('turns a changed product into its variants and reports variants that vanished as deleted', async () => {
    const { service, prisma } = setup({
      variants: [variantRow('v1'), variantRow('v2', { is_active: false })],
      changes: [
        { txid: '20', sequence: 1n, kind: 'product', entity_key: 'p-v1' },
        { txid: '20', sequence: 2n, kind: 'variant', entity_key: 'gone' },
      ],
    });
    const result: any = await service.pull(ctx, BRANCH, { cursor: '10:7' });

    expect(prisma.productVariant.findMany).toHaveBeenCalledWith({
      where: { tenant_id: ctx.tenantId, OR: [{ id: { in: ['gone'] } }, { product_id: { in: ['p-v1'] } }] },
    });
    expect(result.products.map((p: any) => p.id)).toEqual(['v1']);
    expect(result.deleted_variant_ids.sort()).toEqual(['gone', 'v2']);
  });

  it('sends sellers and settings when their changes are in the stream', async () => {
    const { service } = setup({
      sellers: [{ user: { id: 'u1', name: 'بائع' } }],
      changes: [
        { txid: '20', sequence: 1n, kind: 'sellers', entity_key: null },
        { txid: '20', sequence: 2n, kind: 'settings', entity_key: 't' },
      ],
    });
    const result: any = await service.pull(ctx, BRANCH, { cursor: '10:7' });
    expect(result.sellers).toEqual([{ id: 'u1', name: 'بائع' }]);
    expect(result.reset_sellers).toBe(true);
    expect(result.settings.scale_barcode).toBeDefined();
  });

  it('answers "nothing changed" with the same cursor and no reads', async () => {
    const { service, prisma } = setup({ changes: [] });
    const result: any = await service.pull(ctx, BRANCH, { cursor: '10:7' });
    expect(result).toMatchObject({ mode: 'delta', cursor: '10:7', products: [], stock: [], has_more: false });
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
  });

  it('starts a fresh snapshot when a catalog-wide (pricing) change arrives', async () => {
    const { service } = setup({ changes: [{ txid: '30', sequence: 5n, kind: 'pricing', entity_key: 'r1' }] });
    const result: any = await service.pull(ctx, BRANCH, { cursor: '10:7' });
    expect(result).toMatchObject({ mode: 'snapshot', reset_products: true, cursor: '30:5' });
  });

  it('starts a fresh snapshot for a cursor older than the compaction floor', async () => {
    const { service } = setup({ floor: '50:9', changes: [{ txid: '60', sequence: 1n, kind: 'variant', entity_key: 'v1' }] });
    const result: any = await service.pull(ctx, BRANCH, { cursor: '10:7' });
    expect(result).toMatchObject({ mode: 'snapshot', reset_products: true });
  });

  it('records the cursor a terminal has applied (so compaction knows what is safe to remove)', async () => {
    const { service, prisma } = setup({ changes: [] });
    await service.pull(ctx, BRANCH, { cursor: '10:7' }, { id: 'term-1', sync_cursor: '5:1' });
    expect(prisma.posTerminal.updateMany).toHaveBeenCalledWith({
      where: { id: 'term-1', tenant_id: ctx.tenantId }, data: { sync_cursor: '10:7' },
    });
    prisma.posTerminal.updateMany.mockClear();
    await service.pull(ctx, BRANCH, { cursor: '10:7' }, { id: 'term-1', sync_cursor: '10:7' });
    expect(prisma.posTerminal.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed cursor', async () => {
    const { service } = setup();
    await expect(service.pull(ctx, BRANCH, { cursor: 'abc' })).rejects.toThrow(/cursor/);
  });
});

describe('SyncService product batching', () => {
  it('loads parent products in flat chunks of PRODUCT_BATCH_SIZE', async () => {
    const rows = Array.from({ length: PRODUCT_BATCH_SIZE + 1 }, (_, i) => variantRow(`v${i}`));
    const { service, prisma } = setup({ variants: rows.slice(0, 5) });
    prisma.productVariant.findMany.mockResolvedValue(rows);
    // Not through pull (page size); exercise the private loader directly.
    await (service as any).loadProducts(ctx, rows);
    expect(prisma.product.findMany).toHaveBeenCalledTimes(2);
  });
});
