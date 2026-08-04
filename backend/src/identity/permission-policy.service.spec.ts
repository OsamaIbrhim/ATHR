import { PermissionPolicyService } from './permission-policy.service';
import { IDENTITY_PERMISSIONS, PERMISSION_POLICY_INITIAL_VERSION, SYSTEM_ROLE_PERMISSIONS } from './system-roles';
import { PERMISSION_POLICY_CURRENT_VERSION } from './permission-catalog';

function fakePrisma() {
  const rows: any[] = [];
  return {
    permissionPolicySnapshot: {
      findFirst: jest.fn(async ({ orderBy }: any) => {
        if (rows.length === 0) return null;
        const sorted = [...rows].sort((a, b) => b.version - a.version);
        return sorted[0];
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `snap-${rows.length + 1}`, created_at: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    __rows: rows,
  } as any;
}

describe('PermissionPolicyService', () => {
  it('seeds exactly one current-version snapshot idempotently', async () => {
    const prisma = fakePrisma();
    const service = new PermissionPolicyService(prisma);

    const first = await service.ensureSeeded();
    const second = await service.ensureSeeded();

    expect(first.version).toBe(PERMISSION_POLICY_CURRENT_VERSION);
    expect(second.id).toBe(first.id);
    expect(prisma.__rows).toHaveLength(1);
  });

  it('reports the same current version on repeated calls', async () => {
    const service = new PermissionPolicyService(fakePrisma());
    const v1 = await service.getCurrentVersion();
    const v2 = await service.getCurrentVersion();
    expect(v1).toBe(v2);
    expect(v1).toBe(PERMISSION_POLICY_CURRENT_VERSION);
  });

  // WP-007 Phase A: an environment already seeded at WP-006's version 1 must
  // be upgraded on boot, otherwise every business permission default-denies.
  it('upgrades a pre-existing version-1 snapshot to the current version', async () => {
    const prisma = fakePrisma();
    prisma.__rows.push({
      id: 'snap-v1',
      version: PERMISSION_POLICY_INITIAL_VERSION,
      grants: SYSTEM_ROLE_PERMISSIONS,
      is_active: true,
      created_at: new Date(),
    });

    const service = new PermissionPolicyService(prisma);
    const upgraded = await service.ensureSeeded();

    expect(upgraded.version).toBe(PERMISSION_POLICY_CURRENT_VERSION);
    expect(prisma.__rows.find((row: any) => row.id === 'snap-v1').is_active).toBe(false);
    expect(await service.hasPermission('cashier', 'sales.sale.create')).toBe(true);
  });

  it('grants tenant_owner the full permission set (allow-only union)', async () => {
    const service = new PermissionPolicyService(fakePrisma());
    expect(await service.hasPermission('tenant_owner', 'ownership.transfer')).toBe(true);
    expect(await service.hasPermission('tenant_owner', 'support_access.grant')).toBe(true);
  });

  it('does not bundle sensitive permissions into location_manager (BR-ROL-105)', async () => {
    const service = new PermissionPolicyService(fakePrisma());
    expect(await service.hasPermission('location_manager', 'ownership.transfer')).toBe(false);
    expect(await service.hasPermission('location_manager', 'support_access.grant')).toBe(false);
    expect(await service.hasPermission('location_manager', 'tenant_data.export_all')).toBe(false);
    expect(await service.hasPermission('location_manager', 'membership.invite')).toBe(true);
  });

  it('grants cashier and seller no identity/administrative permissions', async () => {
    const service = new PermissionPolicyService(fakePrisma());
    // The invariant this has always asserted (BR-ROL-105): neither role gets
    // any *identity/administrative* key. They now hold business keys, so the
    // assertion is expressed against the identity catalog rather than against
    // an empty grant list.
    for (const role of ['cashier', 'seller'] as const) {
      const grants = await service.getGrants(role);
      expect(grants.filter((grant) => (IDENTITY_PERMISSIONS as readonly string[]).includes(grant)))
        .toEqual([]);
    }
  });

  it('default-denies a key that is in the catalog but not in the role grant', async () => {
    const service = new PermissionPolicyService(fakePrisma());
    expect(await service.hasPermission('cashier', 'inventory.adjustment.post')).toBe(false);
    expect(await service.hasPermission('seller', 'sales.sale.create')).toBe(false);
    expect(await service.hasPermission('cashier', 'reports.sales.export')).toBe(false);
  });
});
