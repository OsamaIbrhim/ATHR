import { PermissionPolicyService } from './permission-policy.service';
import { PERMISSION_POLICY_INITIAL_VERSION } from './system-roles';

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
    },
    __rows: rows,
  } as any;
}

describe('PermissionPolicyService', () => {
  it('seeds exactly one version-1 snapshot idempotently', async () => {
    const prisma = fakePrisma();
    const service = new PermissionPolicyService(prisma);

    const first = await service.ensureSeeded();
    const second = await service.ensureSeeded();

    expect(first.version).toBe(PERMISSION_POLICY_INITIAL_VERSION);
    expect(second.id).toBe(first.id);
    expect(prisma.__rows).toHaveLength(1);
  });

  it('reports the same current version on repeated calls', async () => {
    const service = new PermissionPolicyService(fakePrisma());
    const v1 = await service.getCurrentVersion();
    const v2 = await service.getCurrentVersion();
    expect(v1).toBe(v2);
    expect(v1).toBe(PERMISSION_POLICY_INITIAL_VERSION);
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
    expect(await service.getGrants('cashier')).toEqual([]);
    expect(await service.getGrants('seller')).toEqual([]);
  });
});
