import {
  ALL_ROLE_PERMISSIONS,
  BUSINESS_PERMISSIONS,
  BUSINESS_ROLE_PERMISSIONS,
  DENY_BY_DEFAULT_PERMISSIONS,
  PERMISSION_POLICY_CURRENT_VERSION,
} from '../identity/permission-catalog';
import type { MembershipRole } from '@prisma/client';

/**
 * WP-008 Phase C — Permission Matrix §18 and BR-TAX-206.
 *
 * The standing lesson these guard: Phase B shipped a key that was declared,
 * granted, and enforced at zero call sites. Declaring a key is not the same as
 * governing anything, and granting one "because the owner gets everything" is
 * how a deny-by-default rule quietly becomes allow-by-default.
 */

/** Matrix §18, verbatim. */
const MATRIX_18_KEYS = [
  'tax.code.view',
  'tax.rule.create',
  'tax.rule.update-draft',
  'tax.rule.submit',
  'tax.rule.approve',
  'tax.rule.schedule',
  'tax.rule.activate',
  'tax.rule.supersede',
  'tax.exemption.apply',
  'tax.exemption.approve',
  'tax.calculation.override',
  'tax.export',
] as const;

const ROLES = Object.keys(BUSINESS_ROLE_PERMISSIONS) as MembershipRole[];

describe('Permission Matrix §18 — the catalog declares every tax key', () => {
  it.each(MATRIX_18_KEYS)('declares %s', (key) => {
    expect(BUSINESS_PERMISSIONS).toContain(key);
  });

  it('declares no tax key the Matrix does not list', () => {
    const declared = BUSINESS_PERMISSIONS.filter((key) => key.startsWith('tax.'));
    expect([...declared].sort()).toEqual([...MATRIX_18_KEYS].sort());
  });
});

describe('BR-TAX-206 — manual tax override is deny-by-default for EVERY role', () => {
  it('is listed as deny-by-default', () => {
    expect(DENY_BY_DEFAULT_PERMISSIONS).toContain('tax.calculation.override');
  });

  it.each(ROLES)('is NOT granted to %s by the default template', (role) => {
    expect(ALL_ROLE_PERMISSIONS[role]).not.toContain('tax.calculation.override');
  });

  it('is withheld from tenant_owner too, despite the blanket owner grant', () => {
    // This is the case that would regress silently: `TENANT_OWNER_GRANTS` is
    // derived from the whole catalog, so a key added without the
    // `DENY_BY_DEFAULT_PERMISSIONS` subtraction reaches every owner on the
    // next policy snapshot.
    expect(ALL_ROLE_PERMISSIONS.tenant_owner).not.toContain('tax.calculation.override');
    // ...while the owner does hold the rest of §18.
    expect(ALL_ROLE_PERMISSIONS.tenant_owner).toEqual(
      expect.arrayContaining([
        'tax.code.view',
        'tax.rule.create',
        'tax.rule.approve',
        'tax.rule.activate',
        'tax.rule.supersede',
        'tax.exemption.approve',
      ]),
    );
  });

  it('every deny-by-default key is granted to no role at all', () => {
    for (const key of DENY_BY_DEFAULT_PERMISSIONS) {
      for (const role of ROLES) {
        expect(ALL_ROLE_PERMISSIONS[role]).not.toContain(key);
      }
    }
  });
});

describe('Matrix §18 — tax authoring is not a till-side or store-side capability', () => {
  it('grants location_manager read-only visibility, not the rule lifecycle', () => {
    const granted = BUSINESS_ROLE_PERMISSIONS.location_manager;
    expect(granted).toContain('tax.code.view');
    for (const key of ['tax.rule.create', 'tax.rule.approve', 'tax.rule.activate'] as const) {
      expect(granted).not.toContain(key);
    }
  });

  it.each(['cashier', 'seller', 'warehouse_manager'] as MembershipRole[])(
    'grants %s no §18 key at all — POS receives tax through the catalog snapshot',
    (role) => {
      expect(BUSINESS_ROLE_PERMISSIONS[role].filter((key) => key.startsWith('tax.'))).toEqual([]);
    },
  );
});

describe('the policy snapshot version moved with these grants (ADR-0005)', () => {
  it('is at least 6, so an environment on v5 actually re-seeds', () => {
    // `PermissionPolicyService.ensureSeeded()` only re-seeds when the code's
    // constant is HIGHER than the stored snapshot. Adding keys without moving
    // this leaves every existing environment default-denying the new endpoints.
    expect(PERMISSION_POLICY_CURRENT_VERSION).toBeGreaterThanOrEqual(6);
  });
});
