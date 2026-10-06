import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';
import { CustomerAccountsService } from './customer-accounts.service';

// The money paths (collection, balance = sum of the ledger, concurrency, shift cash, append-only)
// are proven against Postgres by scripts/verify-sales-w3.cjs (C1-C8); these cases pin the scoping.
const ctx = contextFor(TENANT_A);

function setup(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    customer: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { balance: null } }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    customerLedgerEntry: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  return { prisma, service: new CustomerAccountsService(prisma) };
}

describe('CustomerAccountsService', () => {
  it('lists only this tenant\'s customers who owe, biggest debt first, with the total owed', async () => {
    const { service, prisma } = setup();
    prisma.customer.aggregate.mockResolvedValue({ _sum: { balance: new Prisma.Decimal(300) } });
    const result = await service.debtors(ctx);
    const where = prisma.customer.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenant_id: TENANT_A, balance: { gt: 0 } });
    expect(prisma.customer.findMany.mock.calls[0][0].orderBy[0]).toEqual({ balance: 'desc' });
    expect(result.total_owed.toString()).toBe('300');
  });

  it('answers 404 for the statement of a customer of another tenant', async () => {
    const { service, prisma } = setup();
    await expect(service.statement(ctx, 'customer-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customer.findFirst.mock.calls[0][0].where).toEqual({ id: 'customer-b', tenant_id: TENANT_A });
  });

  it('reads the ledger of the customer inside the tenant', async () => {
    const { service, prisma } = setup();
    prisma.customer.findFirst.mockResolvedValue({ id: 'c1', balance: new Prisma.Decimal(0) });
    await service.statement(ctx, 'c1');
    expect(prisma.customerLedgerEntry.findMany.mock.calls[0][0].where).toEqual({ tenant_id: TENANT_A, customer_id: 'c1' });
  });

  it('sets and clears a credit limit inside the tenant, and 404s for a stranger', async () => {
    const { service, prisma } = setup();
    await expect(service.setCreditLimit(ctx, 'c1', 500)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customer.updateMany.mock.calls[0][0].where).toEqual({ id: 'c1', tenant_id: TENANT_A });
    prisma.customer.updateMany.mockResolvedValue({ count: 1 });
    await service.setCreditLimit(ctx, 'c1', null);
    expect(prisma.customer.updateMany.mock.calls[1][0].data).toEqual({ credit_limit: null });
  });
});
