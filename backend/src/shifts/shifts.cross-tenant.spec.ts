import { actorFor } from '../auth/testing/actors';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { ShiftsRepository } from './shifts.repository';
import { ShiftsService } from './shifts.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aBranch, aSalesInvoice, aSalesPayment } from '../identity/testing/fixture-builders';

/** WP-007 Phase A §A.3.6 — cross-tenant isolation for the `shifts` module. */

const SHIFT_A = randomUUID();
const SHIFT_B = randomUUID();
const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();
const INVOICE_A = randomUUID();
const INVOICE_B = randomUUID();

function setup() {
  const prisma = fakePrisma({
    shift: [
      {
        id: SHIFT_A,
        tenant_id: TENANT_A,
        branch_id: BRANCH_A,
        status: 'open',
        opening_cash: 100,
        opened_at: new Date(),
        closed_at: null,
      },
      {
        id: SHIFT_B,
        tenant_id: TENANT_B,
        branch_id: BRANCH_B,
        status: 'open',
        opening_cash: 500,
        opened_at: new Date(),
        closed_at: null,
      },
    ],
    branch: [
      aBranch({ id: BRANCH_A, tenant_id: TENANT_A }),
      aBranch({ id: BRANCH_B, tenant_id: TENANT_B }),
    ],
    salesInvoice: [
      // Same shift_id in both tenants: an unscoped aggregate would fold
      // tenant B's cash into tenant A's expected drawer total.
      aSalesInvoice({ id: INVOICE_A, tenant_id: TENANT_A, shift_id: SHIFT_A, total: new Prisma.Decimal(50) }),
      aSalesInvoice({ id: INVOICE_B, tenant_id: TENANT_B, shift_id: SHIFT_A, total: new Prisma.Decimal(9999) }),
    ],
    salesPayment: [
      aSalesPayment({ tenant_id: TENANT_A, sales_invoice_id: INVOICE_A, method: 'cash', amount: new Prisma.Decimal(50) }),
      aSalesPayment({ tenant_id: TENANT_B, sales_invoice_id: INVOICE_B, method: 'cash', amount: new Prisma.Decimal(9999) }),
    ],
    return: [],
  }, { salesPayment: { invoice: { table: 'salesInvoice', localKey: 'sales_invoice_id' } } });
  // WP-T2/F4 audit: this file's only raw-SQL-reaching test ("stamps a new
  // shift with the calling tenant") exercises open()'s advisory lock
  // (shifts.service.ts:31). That call site is now centrally allowlisted in
  // raw-sql-allowlist.ts (a pure pg_advisory_xact_lock, no row read or
  // written), so fakePrisma's default already resolves it correctly — the
  // local `$executeRaw = async () => 0` override this file used to carry was
  // a redundant re-declaration of exactly that stub and has been removed.
  const repository = new ShiftsRepository(prisma);
  return { prisma, repository, service: new ShiftsService(prisma, repository) };
}

const ownerFor = (branchId: string) =>
  actorFor('tenant_owner', { sub: randomUUID(), tenantWide: true, branchId });

describe('shifts — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s shifts', async () => {
    const { service } = setup();
    expect((await service.list(contextFor(TENANT_A))).items.map((row) => row.id)).toEqual([SHIFT_A]);
    expect((await service.list(contextFor(TENANT_B))).items.map((row) => row.id)).toEqual([SHIFT_B]);
  });

  it('does not resolve another tenant\'s open shift for a branch', async () => {
    const { service } = setup();
    expect(await service.current(contextFor(TENANT_A), BRANCH_B)).toBeNull();
  });

  it('does not close another tenant\'s shift', async () => {
    const { service, prisma } = setup();
    await expect(
      service.close(contextFor(TENANT_B), SHIFT_A, ownerFor(BRANCH_A), 150),
    ).rejects.toThrow('Shift not found');
    expect(prisma.shift.rows.find((row: any) => row.id === SHIFT_A).status).toBe('open');
  });

  /**
   * The money path. Expected cash must be opening_cash + this tenant's cash
   * sales only — 100 + 50 = 150, never 100 + 50 + 9999.
   */
  it('computes expected cash from the calling tenant\'s sales only', async () => {
    const { service, prisma } = setup();
    await service.close(contextFor(TENANT_A), SHIFT_A, ownerFor(BRANCH_A), 150);

    const closed = prisma.shift.rows.find((row: any) => row.id === SHIFT_A);
    expect(Number(closed.expected_cash)).toBe(150);
    expect(Number(closed.difference)).toBe(0);
  });

  it('refuses to open a shift against another tenant\'s branch', async () => {
    const { service } = setup();
    await expect(
      service.open(contextFor(TENANT_A), BRANCH_B, ownerFor(BRANCH_B), 0),
    ).rejects.toThrow('Active branch not found');
  });

  it('stamps a new shift with the calling tenant', async () => {
    const { service, prisma } = setup();
    prisma.shift.rows = [];
    await service.open(contextFor(TENANT_B), BRANCH_B, ownerFor(BRANCH_B), 0);
    expect(prisma.shift.rows[0].tenant_id).toBe(TENANT_B);
  });
});
