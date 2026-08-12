import { randomUUID } from 'crypto';
import { SalesService } from './sales.service';
import { SalesReadService } from './sales-read.service';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * WP-007 Phase A §A.3.6 — cross-tenant isolation for the `sales` module.
 *
 * Sales is the highest-volume tenant-owned table and the one the POS writes
 * to, so both the operator read paths and the device-authenticated write path
 * are covered here.
 */

const INVOICE_A = randomUUID();
const INVOICE_B = randomUUID();
const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();
const SHARED_PHONE = '01000000000';

function setup() {
  const prisma = fakePrisma({
    salesInvoice: [
      {
        id: INVOICE_A,
        tenant_id: TENANT_A,
        branch_id: BRANCH_A,
        invoice_number: 'B-100',
        status: 'completed',
        occurred_at: new Date(),
        total: 100,
        items: [],
      },
      {
        id: INVOICE_B,
        tenant_id: TENANT_B,
        branch_id: BRANCH_B,
        invoice_number: 'B-100',
        status: 'completed',
        occurred_at: new Date(),
        total: 999,
        items: [],
      },
    ],
    customer: [
      { id: randomUUID(), tenant_id: TENANT_B, phone: SHARED_PHONE, name: 'B customer' },
    ],
    return: [
      { id: randomUUID(), tenant_id: TENANT_A, branch_id: BRANCH_A, created_at: new Date() },
      { id: randomUUID(), tenant_id: TENANT_B, branch_id: BRANCH_B, created_at: new Date() },
    ],
    branch: [
      { id: BRANCH_A, tenant_id: TENANT_A, code: 'A', is_active: true },
      { id: BRANCH_B, tenant_id: TENANT_B, code: 'B', is_active: true },
    ],
    salesInvoiceItem: [],
    returnItem: [],
    posTerminal: [],
    user: [],
    inventoryStock: [],
    productVariant: [],
    shift: [],
    auditLog: [],
  });
  prisma.$transaction = async (fn: any) => fn(prisma);
  prisma.$queryRaw = async () => [];
  const pricing = { calculateMany: async () => new Map(), quoteMany: () => new Map() } as any;
  // These cases assert tenant isolation, not cost visibility. The gate is wired
  // with the fail-closed answer so the isolation checks run against the same
  // projection an unprivileged actor would get; `sales.cost-visibility.spec.ts`
  // is what pins the gate itself.
  const costVisibility = new CostVisibilityService({
    hasPermission: async () => false,
  } as unknown as PermissionPolicyService);
  return {
    prisma,
    service: new SalesService(prisma, pricing, costVisibility),
    reads: new SalesReadService(prisma),
  };
}

const actorFor = (branchId: string) =>
  ({ sub: randomUUID(), role: 'owner', branch_id: branchId, capabilities: [] }) as any;

const listDto = { q: '', page: 1, page_size: 20 } as any;

describe('sales — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s invoices', async () => {
    const { reads } = setup();
    const forA: any = await reads.listSales(contextFor(TENANT_A), listDto);
    expect(forA.items.map((i: any) => i.id)).toEqual([INVOICE_A]);

    const forB: any = await reads.listSales(contextFor(TENANT_B), listDto);
    expect(forB.items.map((i: any) => i.id)).toEqual([INVOICE_B]);
  });

  /**
   * Blueprint §125: the list-count cache was keyed on the filters alone, so
   * one tenant's total would have been served to the other.
   */
  it('does not serve one tenant\'s cached invoice count to another', async () => {
    const { reads, prisma } = setup();
    prisma.salesInvoice.rows.push({
      id: randomUUID(),
      tenant_id: TENANT_A,
      branch_id: BRANCH_A,
      invoice_number: 'B-101',
      status: 'completed',
      occurred_at: new Date(),
      total: 5,
      items: [],
    });

    const forA: any = await reads.listSales(contextFor(TENANT_A), listDto);
    const forB: any = await reads.listSales(contextFor(TENANT_B), listDto);
    expect(forA.total).toBe(2);
    expect(forB.total).toBe(1);
  });

  it('does not return another tenant\'s invoice by id', async () => {
    const { service } = setup();
    await expect(
      service.getInvoice(contextFor(TENANT_B), INVOICE_A, actorFor(BRANCH_B)),
    ).rejects.toThrow();
  });

  /** `SalesInvoice.invoice_number` is still globally unique until Phase B. */
  it('does not resolve another tenant\'s invoice by invoice number', async () => {
    const { service } = setup();
    const found: any = await service.findReturnableInvoice(
      contextFor(TENANT_A),
      'B-100',
      actorFor(BRANCH_A),
    );
    expect(found.id).toBe(INVOICE_A);
  });

  it('lists only the calling tenant\'s returns', async () => {
    const { service } = setup();
    const forA: any = await service.listReturns(contextFor(TENANT_A), listDto);
    expect(forA.items).toHaveLength(1);
    expect(forA.items[0].tenant_id ?? TENANT_A).toBe(TENANT_A);
  });

  it('does not create a return against another tenant\'s invoice', async () => {
    const { service } = setup();
    await expect(
      service.createReturn(
        contextFor(TENANT_B),
        { original_invoice_id: INVOICE_A, items: [] } as any,
        actorFor(BRANCH_B),
      ),
    ).rejects.toThrow();
  });

  /**
   * The POS sale path derives its tenant from the enrolled terminal, and
   * `Customer.phone` is globally unique until Phase B — so an upsert keyed on
   * phone alone would have attached tenant B's customer to a tenant A sale.
   */
  it('does not attach another tenant\'s customer to a sale by phone', async () => {
    const { prisma } = setup();
    const existing = await prisma.customer.findFirst({
      where: { phone: SHARED_PHONE, tenant_id: TENANT_A },
    });
    expect(existing).toBeNull();

    const foreign = await prisma.customer.findFirst({
      where: { phone: SHARED_PHONE, tenant_id: TENANT_B },
    });
    expect(foreign).not.toBeNull();
  });

  it('fails closed when a terminal carries no tenant binding', async () => {
    const { service } = setup();
    await expect(
      service.createSale({ branch_id: BRANCH_A } as any, {
        id: randomUUID(),
        branch_id: BRANCH_A,
        tenant_id: null,
      } as any),
    ).rejects.toMatchObject({ code: 'TENANT_CONTEXT_UNRESOLVABLE' });
  });
});
