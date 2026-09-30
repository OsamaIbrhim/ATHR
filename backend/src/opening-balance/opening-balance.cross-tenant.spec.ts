import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { OpeningBalanceService } from './opening-balance.service';
import { actorFor } from '../auth/testing/actors';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aBranch, aProductVariant } from '../identity/testing/fixture-builders';

/** Cross-tenant isolation of the opening balance: another tenant's branch or variant is simply not found. */

const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();
const VARIANT_A = randomUUID();
const VARIANT_B = randomUUID();
const WAREHOUSE_A = randomUUID();

function setup() {
  const prisma = fakePrisma({
    branch: [aBranch({ id: BRANCH_A, tenant_id: TENANT_A }), aBranch({ id: BRANCH_B, tenant_id: TENANT_B })],
    productVariant: [aProductVariant({ id: VARIANT_A, tenant_id: TENANT_A }), aProductVariant({ id: VARIANT_B, tenant_id: TENANT_B })],
    auditLog: [],
  });
  const applied: any[] = [];
  prisma.$queryRaw = async () => [];
  prisma.$transaction = async (fn: any) => fn(prisma);
  const inventory: any = {
    defaultWarehouseId: async () => WAREHOUSE_A,
    apply: async (_tx: unknown, command: any) => {
      applied.push(command);
      return command.lines.map((line: any) => ({
        variantId: line.variantId,
        qtyBefore: new Prisma.Decimal(0),
        qtyAfter: new Prisma.Decimal(line.qtyDelta),
        reserved: new Prisma.Decimal(0),
        avgCostBefore: new Prisma.Decimal(0),
        avgCost: new Prisma.Decimal(line.unitCost),
      }));
    },
  };
  return { applied, service: new OpeningBalanceService(prisma, inventory) };
}

const owner = () => actorFor('tenant_owner', { sub: randomUUID(), tenantWide: true });
const dto = (branch_id: string, variant_id: string) =>
  ({ branch_id, idempotency_key: 'opening-key-1', lines: [{ variant_id, qty: 3 }] }) as any;

describe('opening balance — cross-tenant isolation', () => {
  it('does not find another tenant\'s branch', async () => {
    const { service, applied } = setup();
    await expect(service.post(contextFor(TENANT_A), dto(BRANCH_B, VARIANT_A), owner())).rejects.toThrow('Branch not found');
    expect(applied).toHaveLength(0);
  });

  it('refuses another tenant\'s variant as not found and posts nothing', async () => {
    const { service, applied } = setup();
    await expect(service.post(contextFor(TENANT_A), dto(BRANCH_A, VARIANT_B), owner())).rejects.toMatchObject({
      response: { code: 'OPENING_BALANCE_REJECTED', data: { results: [{ code: 'VARIANT_NOT_FOUND' }] } },
    });
    expect(applied).toHaveLength(0);
  });

  it('posts the tenant\'s own variant into the tenant\'s own warehouse', async () => {
    const { service, applied } = setup();
    const result = await service.post(contextFor(TENANT_A), dto(BRANCH_A, VARIANT_A), owner());
    expect(result).toMatchObject({ posted: 1, rejected: 0 });
    expect(applied[0]).toMatchObject({ tenantId: TENANT_A, warehouseId: WAREHOUSE_A, type: 'opening_balance' });
  });

  it('refuses a branch outside the user\'s access scope', async () => {
    const { service } = setup();
    const scoped = actorFor('warehouse_manager', { sub: randomUUID(), branchId: randomUUID() });
    await expect(service.post(contextFor(TENANT_A), dto(BRANCH_A, VARIANT_A), scoped)).rejects.toThrow('another branch');
  });
});
