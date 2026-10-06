import {
  ALL_PERMISSIONS,
  ALL_ROLE_PERMISSIONS,
  effectivePermissions,
  isPermission,
} from './permission-catalog';
import { IDENTITY_PERMISSIONS } from './system-roles';

describe('effectivePermissions (role defaults + granted - revoked)', () => {
  it('a role with no overrides gets exactly its defaults', () => {
    expect([...effectivePermissions('cashier')].sort()).toEqual([...ALL_ROLE_PERMISSIONS.cashier].sort());
  });

  it('granted keys are added on top of the role defaults', () => {
    const permissions = effectivePermissions('cashier', ['pricing.cost.view']);
    expect(permissions.has('pricing.cost.view')).toBe(true);
    expect(permissions.has('sales.sale.create')).toBe(true);
    // Only what was granted: the cashier is not silently promoted.
    expect(permissions.has('pricing.margin.view')).toBe(false);
  });

  it('revoked keys are removed from the role defaults', () => {
    const permissions = effectivePermissions('cashier', [], ['sales.sale.create']);
    expect(permissions.has('sales.sale.create')).toBe(false);
    expect(permissions.has('sales.sale.view')).toBe(true);
  });

  it('a revoke wins over a grant of the same key', () => {
    const permissions = effectivePermissions('seller', ['sales.sale.create'], ['sales.sale.create']);
    expect(permissions.has('sales.sale.create')).toBe(false);
  });

  it('ignores unknown keys instead of granting them', () => {
    const permissions = effectivePermissions('seller', ['products.manage', 'not.a.permission']);
    expect(permissions.has('products.manage' as never)).toBe(false);
    expect(permissions.size).toBe(ALL_ROLE_PERMISSIONS.seller.length);
  });

  it('a tenant owner cannot be locked out by a revoke', () => {
    const permissions = effectivePermissions('tenant_owner', [], ['membership.invite', 'sales.sale.create']);
    expect(permissions.has('membership.invite')).toBe(true);
    expect(permissions.has('sales.sale.create')).toBe(true);
  });
});

describe('role defaults', () => {
  it('grants tenant_owner the identity-admin permissions', () => {
    const permissions = effectivePermissions('tenant_owner');
    expect(permissions.has('ownership.transfer')).toBe(true);
    expect(permissions.has('support_access.grant')).toBe(true);
    expect(permissions.has('tenant.settings.manage')).toBe(true);
  });

  it('does not bundle sensitive permissions into location_manager (BR-ROL-105)', () => {
    const permissions = effectivePermissions('location_manager');
    expect(permissions.has('ownership.transfer')).toBe(false);
    expect(permissions.has('support_access.grant')).toBe(false);
    expect(permissions.has('tenant_data.export_all')).toBe(false);
    expect(permissions.has('tenant.settings.manage')).toBe(false);
    expect(permissions.has('membership.invite')).toBe(true);
  });

  it('grants cashier and seller no identity/administrative permissions', () => {
    for (const role of ['cashier', 'seller'] as const) {
      const identityKeys = [...effectivePermissions(role)].filter((key) =>
        (IDENTITY_PERMISSIONS as readonly string[]).includes(key));
      expect(identityKeys).toEqual([]);
    }
  });

  it('default-denies a catalog key that is not in the role grant', () => {
    expect(effectivePermissions('cashier').has('inventory.adjustment.post')).toBe(false);
    expect(effectivePermissions('seller').has('sales.sale.create')).toBe(false);
    expect(effectivePermissions('cashier').has('reports.sales.export')).toBe(false);
  });

  it('keeps the seller commission settings owner-only', () => {
    expect(effectivePermissions('location_manager').has('sellers.report.view')).toBe(true);
    expect(effectivePermissions('location_manager').has('sellers.commission.manage')).toBe(false);
    expect(effectivePermissions('tenant_owner').has('sellers.period.close')).toBe(true);
  });
});

describe('catalog', () => {
  it('has no duplicate keys and recognises them all', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    expect(ALL_PERMISSIONS.every((key) => isPermission(key))).toBe(true);
    expect(isPermission('products.manage')).toBe(false);
  });
});
