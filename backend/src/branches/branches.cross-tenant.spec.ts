import { randomUUID } from 'crypto';
import { BranchesRepository } from './branches.repository';
import { BranchesService } from './branches.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-007 Phase A §A.3.6 — cross-tenant isolation for the `branches` module. */

const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();

function setup() {
  const prisma = fakePrisma({
    branch: [
      { id: BRANCH_A, tenant_id: TENANT_A, code: 'MAIN', name_ar: 'A', is_active: true },
      { id: BRANCH_B, tenant_id: TENANT_B, code: 'MAIN-B', name_ar: 'B', is_active: true },
    ],
  });
  const repository = new BranchesRepository(prisma);
  return { prisma, repository, service: new BranchesService(repository) };
}

describe('branches — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s branches', async () => {
    const { service } = setup();
    expect((await service.findAll(contextFor(TENANT_A))).map((row) => row.id)).toEqual([BRANCH_A]);
    expect((await service.findAll(contextFor(TENANT_B))).map((row) => row.id)).toEqual([BRANCH_B]);
  });

  it('does not resolve another tenant\'s branch by id', async () => {
    const { repository } = setup();
    expect(await repository.findById(contextFor(TENANT_B), BRANCH_A)).toBeNull();
  });

  /**
   * Every module that takes a caller-supplied `branch_id` funnels through
   * this guard, so a cross-tenant branch reference is rejected once here
   * rather than in eighteen separate places.
   */
  it('rejects a cross-tenant branch reference', async () => {
    const { repository } = setup();
    await expect(repository.assertInTenant(contextFor(TENANT_B), BRANCH_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(repository.assertInTenant(contextFor(TENANT_A), BRANCH_A)).resolves.toMatchObject({
      id: BRANCH_A,
    });
  });

  it('stamps new branches with the calling tenant', async () => {
    const { repository } = setup();
    const created = await repository.save(contextFor(TENANT_B), { code: 'NEW', name_ar: 'N' } as any);
    expect(created.tenant_id).toBe(TENANT_B);
    expect(await repository.findById(contextFor(TENANT_A), created.id)).toBeNull();
  });
});
