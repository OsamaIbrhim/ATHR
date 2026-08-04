import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('development and CI seed contract', () => {
  const seed = readFileSync(
    resolve(process.cwd(), 'prisma/seed.ts'),
    'utf8',
  );
  const validator = readFileSync(
    resolve(process.cwd(), 'prisma/validate-development-seed.mjs'),
    'utf8',
  );
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  );

  // WP-007 Phase A: the global TenantContextGuard resolves a tenant from the
  // caller's Membership and fails closed. A seeded account without one can
  // authenticate and then be denied every request — the API boots and nobody
  // can do anything. This is exactly what admin-e2e-smoke caught.
  it('gives every seeded identity a Membership in a real Tenant', () => {
    expect(seed).toContain('Initial ATHR Demo Tenant');
    expect(seed).toContain('prisma.membership.create');
    expect(seed).toContain('tenantId: tenant_id');
    // Membership has a Restrict FK to User, so it must be cleared first.
    expect(seed).toContain('prisma.membership.deleteMany()');
  });

  it('stamps every seeded tenant-owned row with the tenant', () => {
    for (const create of [
      'prisma.branch.create({ data: { tenant_id,',
      'prisma.supplier.create({ data: { tenant_id,',
      'prisma.category.create({ data: { tenant_id,',
      'prisma.customer.create({ data: { tenant_id,',
      'prisma.inventoryStock.create({ data: { tenant_id,',
    ]) {
      expect(seed).toContain(create);
    }
    // Prisma nested creates do not inherit the parent row's scalars.
    expect(seed).toContain('items: { create: items.map((item) => ({ ...item, tenant_id })) }');
  });

  it('bootstraps the production owner with a Membership too', () => {
    const productionSeed = readFileSync(
      resolve(process.cwd(), 'prisma/seed-production.ts'),
      'utf8',
    );
    expect(productionSeed).toContain('tx.membership.upsert');
    expect(productionSeed).toContain('Initial ATHR Demo Tenant');
  });

  it('creates every operational role deterministically', () => {
    for (const role of [
      'owner',
      'branch_manager',
      'cashier',
      'warehouse_manager',
      'seller',
    ]) {
      expect(seed).toContain(`role: '${role}'`);
      expect(validator).toContain(`'${role}'`);
    }

    expect(seed).toContain('deterministicRandom');
    expect(seed).not.toContain('Math.random');
  });

  it('validates mutation prerequisites immediately after every normal seed', () => {
    expect(packageJson.scripts['prisma:seed']).toContain(
      'validate-development-seed.mjs',
    );
    expect(packageJson.prisma.seed).toContain(
      'validate-development-seed.mjs',
    );
    expect(validator).toContain('qty_on_hand: { gte: 12 }');
    expect(validator).toContain('qty_reserved: 0');
    expect(validator).toContain('development-seed-contract');
  });
});
