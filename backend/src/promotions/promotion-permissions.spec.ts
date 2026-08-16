import {
  ALL_ROLE_PERMISSIONS,
  BUSINESS_PERMISSIONS,
  BUSINESS_ROLE_PERMISSIONS,
  DENY_BY_DEFAULT_PERMISSIONS,
  PERMISSION_POLICY_CURRENT_VERSION,
} from '../identity/permission-catalog';
import type { MembershipRole } from '@prisma/client';

/**
 * WP-008 Phase D — Permission Matrix §19 (Promotion, Coupon) and §16
 * (`catalog.bundle.manage`), mirroring `tax-permissions.spec.ts`'s pattern:
 * declaring a key is not the same as governing anything (the same standing
 * lesson that file guards for §18).
 */

/** Matrix §19 Promotion, verbatim. */
const MATRIX_19_PROMOTION_KEYS = [
  'promotion.view',
  'promotion.create',
  'promotion.update-draft',
  'promotion.submit',
  'promotion.approve',
  'promotion.schedule',
  'promotion.activate',
  'promotion.pause',
  'promotion.resume',
  'promotion.end',
  'promotion.simulate',
] as const;

/** Matrix §19 Coupon, verbatim. */
const MATRIX_19_COUPON_KEYS = [
  'coupon.campaign.create',
  'coupon.code.generate',
  'coupon.code.view-sensitive',
  'coupon.usage.view',
  'coupon.redemption.override',
  'coupon.export-codes',
] as const;

const ROLES = Object.keys(BUSINESS_ROLE_PERMISSIONS) as MembershipRole[];

describe('Permission Matrix §19 — the catalog declares every promotion and coupon key', () => {
  it.each([...MATRIX_19_PROMOTION_KEYS, ...MATRIX_19_COUPON_KEYS])('declares %s', (key) => {
    expect(BUSINESS_PERMISSIONS).toContain(key);
  });

  it('declares no promotion.* key the Matrix does not list', () => {
    const declared = BUSINESS_PERMISSIONS.filter((key) => key.startsWith('promotion.'));
    expect([...declared].sort()).toEqual([...MATRIX_19_PROMOTION_KEYS].sort());
  });

  it('declares no coupon.* key the Matrix does not list', () => {
    const declared = BUSINESS_PERMISSIONS.filter((key) => key.startsWith('coupon.'));
    expect([...declared].sort()).toEqual([...MATRIX_19_COUPON_KEYS].sort());
  });

  it('declares catalog.bundle.manage (Matrix §16)', () => {
    expect(BUSINESS_PERMISSIONS).toContain('catalog.bundle.manage');
  });
});

describe('promotion.simulate and coupon.export-codes are declared-but-unwired, same as tax.export before it', () => {
  it('are not deny-by-default (nothing reaches them regardless — see the Phase D PR description)', () => {
    expect(DENY_BY_DEFAULT_PERMISSIONS).not.toContain('promotion.simulate');
    expect(DENY_BY_DEFAULT_PERMISSIONS).not.toContain('coupon.export-codes');
  });

  it('are still granted to tenant_owner via the blanket grant', () => {
    expect(ALL_ROLE_PERMISSIONS.tenant_owner).toEqual(
      expect.arrayContaining(['promotion.simulate', 'coupon.export-codes']),
    );
  });
});

describe('Matrix §19 — location_manager has full Promotion lifecycle and Coupon operations, minus export', () => {
  it('grants location_manager the full promotion lifecycle', () => {
    const granted = BUSINESS_ROLE_PERMISSIONS.location_manager;
    for (const key of MATRIX_19_PROMOTION_KEYS) {
      expect(granted).toContain(key);
    }
  });

  it('grants location_manager every coupon key EXCEPT export-codes', () => {
    const granted = BUSINESS_ROLE_PERMISSIONS.location_manager;
    expect(granted).not.toContain('coupon.export-codes');
    for (const key of MATRIX_19_COUPON_KEYS.filter((k) => k !== 'coupon.export-codes')) {
      expect(granted).toContain(key);
    }
  });

  it.each(['cashier', 'seller'] as MembershipRole[])(
    'grants %s no promotion.*/coupon.* management key — the POS quote path needs none',
    (role) => {
      const granted = BUSINESS_ROLE_PERMISSIONS[role];
      expect(granted.filter((key) => key.startsWith('promotion.') || key.startsWith('coupon.'))).toEqual([]);
    },
  );

  it('grants warehouse_manager (and by the spread, location_manager) catalog.bundle.manage', () => {
    expect(BUSINESS_ROLE_PERMISSIONS.warehouse_manager).toContain('catalog.bundle.manage');
    expect(BUSINESS_ROLE_PERMISSIONS.location_manager).toContain('catalog.bundle.manage');
  });
});

describe('the policy snapshot version moved with these grants (ADR-0005)', () => {
  it('is at least 7, so an environment on v6 actually re-seeds', () => {
    expect(PERMISSION_POLICY_CURRENT_VERSION).toBeGreaterThanOrEqual(7);
  });

  it('every role listed is a real role the snapshot can seed', () => {
    expect(ROLES.length).toBeGreaterThan(0);
    for (const role of ROLES) {
      expect(ALL_ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });
});
