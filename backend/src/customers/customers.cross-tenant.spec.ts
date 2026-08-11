import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aCustomer } from '../identity/testing/fixture-builders';

/**
 * WP-007 Phase A §A.3.6 — "Membership A does not grant B" (Multi-tenancy
 * Blueprint §122) for the `customers` module, plus the §120 repository rules.
 */

const CUSTOMER_A = randomUUID();
const CUSTOMER_B = randomUUID();
const SHARED_PHONE = '01000000000';

function setup() {
  const prisma = fakePrisma({
    customer: [
      aCustomer({
        id: CUSTOMER_A,
        tenant_id: TENANT_A,
        name: 'Tenant A Customer',
        phone: SHARED_PHONE,
        email: 'a@example.com',
        total_invoices: 9,
        total_spent: new Prisma.Decimal(5000),
      }),
      aCustomer({
        id: CUSTOMER_B,
        tenant_id: TENANT_B,
        name: 'Tenant B Customer',
        phone: '01111111111',
        email: 'b@example.com',
        total_invoices: 2,
        total_spent: new Prisma.Decimal(100),
        is_vip: true,
      }),
    ],
    salesInvoice: [],
  });
  const repository = new CustomersRepository(prisma);
  return { prisma, repository, service: new CustomersService(repository) };
}

describe('customers — cross-tenant isolation', () => {
  it('does not return another tenant\'s customer by id', async () => {
    const { repository } = setup();
    expect(await repository.findById(contextFor(TENANT_A), CUSTOMER_A)).not.toBeNull();
    expect(await repository.findById(contextFor(TENANT_B), CUSTOMER_A)).toBeNull();
  });

  it('lists only the calling tenant\'s customers', async () => {
    const { repository } = setup();
    const listedForA = await repository.list(contextFor(TENANT_A));
    expect(listedForA.map((row) => row.id)).toEqual([CUSTOMER_A]);

    const listedForB = await repository.list(contextFor(TENANT_B));
    expect(listedForB.map((row) => row.id)).toEqual([CUSTOMER_B]);
  });

  it('does not leak another tenant\'s customer through search', async () => {
    const { repository } = setup();
    const hits = await repository.list(contextFor(TENANT_B), { search: 'Tenant A' });
    expect(hits).toEqual([]);
  });

  /**
   * `Customer.phone` is still globally unique in the database until Phase B,
   * so this is precisely the lookup that would leak across tenants if the
   * repository used `findUnique({ where: { phone } })`.
   */
  it('does not resolve another tenant\'s customer by phone', async () => {
    const { repository } = setup();
    expect(await repository.findByPhone(contextFor(TENANT_A), SHARED_PHONE)).not.toBeNull();
    expect(await repository.findByPhone(contextFor(TENANT_B), SHARED_PHONE)).toBeNull();
  });

  it('refuses to update another tenant\'s customer (§120)', async () => {
    const { repository, prisma } = setup();
    await expect(
      repository.update(contextFor(TENANT_B), CUSTOMER_A, { name: 'hijacked' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    expect(prisma.customer.rows.find((row: any) => row.id === CUSTOMER_A).name).toBe(
      'Tenant A Customer',
    );
  });

  it('refuses to delete another tenant\'s customer (§120)', async () => {
    const { repository, prisma } = setup();
    await expect(
      repository.remove(contextFor(TENANT_B), CUSTOMER_A),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(prisma.customer.rows).toHaveLength(2);
  });

  it('stamps new customers with the calling tenant, not a hardcoded one', async () => {
    const { repository } = setup();
    const created = await repository.save(contextFor(TENANT_B), { name: 'New B' } as any);
    expect(created.tenant_id).toBe(TENANT_B);
    expect(await repository.findById(contextFor(TENANT_A), created.id)).toBeNull();
  });

  it('conceals another tenant\'s customer through the service layer', async () => {
    const { service } = setup();
    expect(await service.findOne(contextFor(TENANT_B), CUSTOMER_A)).toBeNull();
    expect(await service.loyaltyStatus(contextFor(TENANT_B), SHARED_PHONE)).toEqual({
      eligible: false,
    });
  });
});
