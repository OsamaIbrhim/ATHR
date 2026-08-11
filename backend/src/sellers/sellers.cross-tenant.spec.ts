import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { SellersRepository } from './sellers.repository';
import { SellersService } from './sellers.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aSalesInvoice } from '../identity/testing/fixture-builders';

/** WP-007 Phase A §A.3.6 — cross-tenant isolation for the `sellers` module. */

const SELLER_A = randomUUID();
const SELLER_B = randomUUID();
const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();

function setup() {
  const prisma = fakePrisma({
    user: [
      {
        id: SELLER_A,
        name: 'Seller A',
        role: 'seller',
        branch_id: BRANCH_A,
        is_active: true,
        memberships: [{ tenantId: TENANT_A }],
        branch: { id: BRANCH_A, code: 'A', name_ar: 'A' },
        seller_commission_override: null,
      },
      {
        id: SELLER_B,
        name: 'Seller B',
        role: 'seller',
        branch_id: BRANCH_B,
        is_active: true,
        memberships: [{ tenantId: TENANT_B }],
        branch: { id: BRANCH_B, code: 'B', name_ar: 'B' },
        seller_commission_override: null,
      },
    ],
    salesInvoice: [
      aSalesInvoice({
        tenant_id: TENANT_A,
        branch_id: BRANCH_A,
        seller_id: SELLER_A,
        occurred_at: new Date('2026-03-15T10:00:00.000Z'),
        subtotal: new Prisma.Decimal(100),
      }),
      aSalesInvoice({
        tenant_id: TENANT_B,
        branch_id: BRANCH_B,
        seller_id: SELLER_B,
        occurred_at: new Date('2026-03-15T10:00:00.000Z'),
        subtotal: new Prisma.Decimal(9999),
      }),
    ],
    return: [],
    // Legacy singleton: id=1 belongs to whichever tenant existed first.
    sellerCommissionSettings: [
      {
        id: 1,
        tenant_id: TENANT_A,
        default_rate: 10,
        default_target: null,
        default_bonus: 0,
        period_length_days: 30,
        period_anchor: new Date(),
      },
    ],
    sellerCommissionOverride: [],
    sellerCommissionPeriod: [],
    sellerCommissionPeriodRow: [],
  });

  // `memberships: { some: { tenantId } }` is a to-many filter.
  prisma.user.findMany = async ({ where }: any) =>
    prisma.user.rows.filter((row: any) => {
      const tenantId = where?.memberships?.some?.tenantId;
      if (tenantId && !row.memberships.some((m: any) => m.tenantId === tenantId)) return false;
      if (where?.role && row.role !== where.role) return false;
      if (where?.branch_id && row.branch_id !== where.branch_id) return false;
      if (where?.id && row.id !== where.id) return false;
      return true;
    });
  prisma.user.findFirst = async ({ where }: any) =>
    (await prisma.user.findMany({ where }))[0] ?? null;

  const repository = new SellersRepository(prisma);
  return { prisma, repository, service: new SellersService(repository) };
}

const owner = { sub: randomUUID(), role: 'owner', branch_id: null, capabilities: [] } as any;

describe('sellers — cross-tenant isolation', () => {
  it('reports only the calling tenant\'s sellers and their sales', async () => {
    const { service } = setup();
    const forA: any = await service.report(contextFor(TENANT_A), '2026-03-01', '2026-03-31');

    expect(forA.rows).toHaveLength(1);
    expect(forA.rows[0].seller.id).toBe(SELLER_A);
    // 100, not 10099 — tenant B's attributed sales must not inflate commission.
    expect(forA.rows[0].gross_sales_before_tax).toBe(100);
  });

  /**
   * `SellerCommissionSettings.id` is `Int @id @default(1)` — a singleton in
   * the single-tenant schema. Without per-tenant keying, every tenant shares
   * one commission-rate row, so changing a rate in one tenant silently
   * repays every seller in every other tenant.
   */
  it('gives each tenant its own commission settings row, not the shared id=1', async () => {
    const { repository, prisma } = setup();

    const forA = await repository.getSettings(contextFor(TENANT_A));
    const forB = await repository.getSettings(contextFor(TENANT_B));

    expect(forA.id).toBe(1);
    expect(forA.tenant_id).toBe(TENANT_A);
    expect(forB.id).not.toBe(1);
    expect(forB.tenant_id).toBe(TENANT_B);
    expect(prisma.sellerCommissionSettings.rows).toHaveLength(2);
  });

  it('does not let one tenant\'s settings update touch another\'s', async () => {
    const { repository, prisma } = setup();
    await repository.getSettings(contextFor(TENANT_B));

    await repository.updateSettings(contextFor(TENANT_B), { default_rate: 99 } as any);

    const rowA = prisma.sellerCommissionSettings.rows.find((r: any) => r.tenant_id === TENANT_A);
    const rowB = prisma.sellerCommissionSettings.rows.find((r: any) => r.tenant_id === TENANT_B);
    expect(Number(rowA.default_rate)).toBe(10);
    expect(Number(rowB.default_rate)).toBe(99);
  });

  it('does not resolve a seller from another tenant', async () => {
    const { repository } = setup();
    expect(await repository.findSeller(contextFor(TENANT_B), SELLER_A)).toBeNull();
    expect(await repository.findSeller(contextFor(TENANT_A), SELLER_A)).not.toBeNull();
  });

  it('refuses to set a commission override on another tenant\'s seller', async () => {
    const { service } = setup();
    await expect(
      service.updateSellerSettings(contextFor(TENANT_B), SELLER_A, { rate: 50 } as any, owner),
    ).rejects.toThrow('Seller not found');
  });

  it('lists only the calling tenant\'s closed periods', async () => {
    const { repository, prisma } = setup();
    prisma.sellerCommissionPeriod.rows = [
      { id: randomUUID(), tenant_id: TENANT_A, closed_at: new Date(), rows: [], closer: null },
      { id: randomUUID(), tenant_id: TENANT_B, closed_at: new Date(), rows: [], closer: null },
    ];
    const forA = await repository.listPeriods(contextFor(TENANT_A));
    expect(forA).toHaveLength(1);
    expect(forA[0].tenant_id).toBe(TENANT_A);
  });

  /**
   * The application-level "already closed" check is tenant-scoped, so two
   * tenants closing the same calendar period do not collide in code. The
   * database's `@@unique([period_start, period_end_exclusive])` is still
   * global and would reject the second write — that constraint conversion is
   * Phase B (§B.4 item 3), not fixable here.
   */
  it('scopes the already-closed check to the calling tenant', async () => {
    const { repository, prisma } = setup();
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-02-01T00:00:00.000Z');
    prisma.sellerCommissionPeriod.rows = [
      { id: randomUUID(), tenant_id: TENANT_A, period_start: start, period_end_exclusive: end },
    ];

    expect(await repository.findPeriod(contextFor(TENANT_A), start, end)).not.toBeNull();
    expect(await repository.findPeriod(contextFor(TENANT_B), start, end)).toBeNull();
  });
});
