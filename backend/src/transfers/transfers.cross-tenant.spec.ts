import { randomUUID } from 'crypto';
import { TransfersService } from './transfers.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aBranch, aProductVariant } from '../identity/testing/fixture-builders';

/**
 * WP-007 Phase A §A.3.6 — cross-tenant isolation for the `transfers` module.
 *
 * Transfers move stock between branches, so the destination is caller-supplied
 * and the module is almost entirely raw SQL. Both facts make it the easiest
 * place in the codebase to move inventory straight across a tenant boundary.
 */

const TRANSFER_A = randomUUID();
const TRANSFER_B = randomUUID();
const BRANCH_A1 = randomUUID();
const BRANCH_A2 = randomUUID();
const BRANCH_B1 = randomUUID();
const VARIANT_A = randomUUID();

function setup() {
  const prisma = fakePrisma({
    transfer: [
      {
        id: TRANSFER_A,
        tenant_id: TENANT_A,
        from_branch_id: BRANCH_A1,
        to_branch_id: BRANCH_A2,
        status: 'pending',
        transfer_number: 'TR-A',
        created_at: new Date(),
        items: [],
      },
      {
        id: TRANSFER_B,
        tenant_id: TENANT_B,
        from_branch_id: BRANCH_B1,
        to_branch_id: BRANCH_B1,
        status: 'pending',
        transfer_number: 'TR-B',
        created_at: new Date(),
        items: [],
      },
    ],
    branch: [
      aBranch({ id: BRANCH_A1, tenant_id: TENANT_A }),
      aBranch({ id: BRANCH_A2, tenant_id: TENANT_A }),
      aBranch({ id: BRANCH_B1, tenant_id: TENANT_B }),
    ],
    productVariant: [aProductVariant({ id: VARIANT_A, tenant_id: TENANT_A })],
    transferItem: [],
    auditLog: [],
    inventoryStock: [],
  });
  const captured: string[] = [];
  // `$queryRaw` is used in its tagged-template form here, so the first
  // argument is the raw strings array and the interpolated values follow.
  prisma.$queryRaw = async (query: any) => {
    captured.push(Array.isArray(query) ? query.join('?') : String(query?.sql ?? query));
    return [];
  };
  prisma.$executeRaw = async () => 1;
  prisma.$transaction = async (fn: any) => fn(prisma);
  return { prisma, captured, service: new TransfersService(prisma) };
}

const actorFor = (branchId: string) =>
  ({ sub: randomUUID(), role: 'warehouse_manager', branch_id: branchId, capabilities: [] }) as any;

describe('transfers — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s transfers', async () => {
    const { service } = setup();
    expect((await service.list(contextFor(TENANT_A))).map((t: any) => t.id)).toEqual([TRANSFER_A]);
    expect((await service.list(contextFor(TENANT_B))).map((t: any) => t.id)).toEqual([TRANSFER_B]);
  });

  it('does not return another tenant\'s transfer by id', async () => {
    const { service } = setup();
    await expect(
      service.get(contextFor(TENANT_B), TRANSFER_A, actorFor(BRANCH_B1)),
    ).rejects.toThrow('Transfer not found');
  });

  /**
   * The sharpest leak in this module: the branch existence check counted any
   * two active branches, so a caller could name another tenant's branch as the
   * destination and ship stock straight out of their own tenant.
   */
  it('refuses to create a transfer whose destination is another tenant\'s branch', async () => {
    const { service } = setup();
    await expect(
      service.create(
        contextFor(TENANT_A),
        {
          from_branch_id: BRANCH_A1,
          to_branch_id: BRANCH_B1,
          items: [{ variant_id: VARIANT_A, qty: 1 }],
        } as any,
        actorFor(BRANCH_A1),
      ),
    ).rejects.toThrow('One or more active branches were not found');
  });

  it('refuses to create a transfer for another tenant\'s variant', async () => {
    const { service, prisma } = setup();
    prisma.productVariant.rows.push(aProductVariant({ id: 'foreign-variant', tenant_id: TENANT_B }));

    await expect(
      service.create(
        contextFor(TENANT_A),
        {
          from_branch_id: BRANCH_A1,
          to_branch_id: BRANCH_A2,
          items: [{ variant_id: 'foreign-variant', qty: 1 }],
        } as any,
        actorFor(BRANCH_A1),
      ),
    ).rejects.toThrow('One or more product variants were not found');
  });

  /**
   * Every state read and mutation in the command paths is raw SQL, so the
   * predicate has to be present in the statement text rather than in a Prisma
   * filter (Blueprint §120 "Raw SQL guarded").
   */
  it('binds the tenant predicate into the raw transfer state reads', async () => {
    const { service, captured } = setup();
    await service
      .get(contextFor(TENANT_A), TRANSFER_A, actorFor(BRANCH_A1))
      .catch(() => undefined);

    const transferRead = captured.find((sql) => sql.includes('FROM "Transfer"'));
    const itemRead = captured.find((sql) => sql.includes('FROM "TransferItem"'));
    expect(transferRead).toMatch(/"tenant_id" =/);
    expect(itemRead).toMatch(/"tenant_id" =/);
  });

  it('scopes the in-transit reconciliation to the calling tenant on both sides', async () => {
    const { service, captured } = setup();
    await service.reconcileInTransit(contextFor(TENANT_A), actorFor(BRANCH_A1));

    const sql = captured.find((text) => text.includes('TransferTransitMovement'))!;
    expect(sql).toMatch(/FROM "TransferItem" item[\s\S]*WHERE item\."tenant_id"/);
    expect(sql).toMatch(/FROM "TransferTransitMovement" movement[\s\S]*WHERE movement\."tenant_id"/);
  });

  it('does not ship another tenant\'s transfer', async () => {
    const { service } = setup();
    await expect(
      service.ship(contextFor(TENANT_B), TRANSFER_A, {} as any, actorFor(BRANCH_B1)),
    ).rejects.toThrow('Transfer not found');
  });
});
