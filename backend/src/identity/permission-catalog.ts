import type { MembershipRole } from '@prisma/client';
import {
  IDENTITY_PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  type IdentityPermission,
} from './system-roles';

/**
 * WP-007 Phase A §A.3.5 — the business-domain half of the permission catalog.
 *
 * ## Provenance, and one deliberate deviation from the WP text
 *
 * §A.3.5 says to take "the exact role-to-endpoint mapping" from
 * `ATHR Permission Matrix v1.0`. The Matrix does not contain one. It fixes
 * the permission **keys** (§11–§47, ~260 of them) and describes role
 * **templates** in prose (§48–§61), but explicitly refuses to bind a key to a
 * role name: §21 ("Role templates كبداية، دون ربط الـPermission باسم Role
 * ثابت"), §62 ("Templates قابلة للنسخ، وليست Roles hard-coded"), and §93,
 * which hands "Permission mapping" to `ATHR API Contract v1.0` — which does
 * not contain it either (its §1512 lists it as a still-open acceptance item).
 *
 * So: every **key** below is copied verbatim from the Matrix section cited
 * above it. The **role→key grants** are derived here, not quoted, and that
 * derivation is called out in the PR description rather than presented as
 * documentation. Nothing in this file is authored as an ADR or spec.
 *
 * ## The derivation rule (and why it is conservative)
 *
 * §A.6 requires *zero behavior change* for today's single-tenant production.
 * A default-deny evaluator dropped onto live endpoints could easily deny an
 * operation that works today — a production outage disguised as a security
 * improvement. So each role's grants below are the Matrix-shaped expansion of
 * exactly what `backend/src/auth/permissions.ts` already allows that role
 * today, no more and no less:
 *
 *   owner             → tenant_owner      (Matrix §48 Tenant Owner)
 *   branch_manager    → location_manager  (Matrix §50 Store Manager)
 *   cashier           → cashier           (Matrix §51 Cashier)
 *   warehouse_manager → warehouse_manager (Matrix §53 Inventory Manager)
 *   seller            → seller            (no Matrix template; read-only subset)
 *
 * (Role name mapping is the one already fixed in migration
 * `202608020003_add_membership_from_user`, not a new invention.)
 *
 * What this *does* buy, versus the legacy 26-capability list: the Matrix's
 * separation of concerns is now structural — `view` / `view-sensitive` /
 * `export` are distinct keys (Matrix §3 rule 11, §70), as are
 * `create` / `approve` / `post` / `void` (rule 12), so a later phase can
 * tighten a role without inventing new plumbing. Default-deny is real: a key
 * absent from a role's list is denied (Matrix §3 rule 1).
 *
 * Deliberately **not** modelled here, because Phase A is isolation only and
 * these have no enforcement point yet: Entitlement intersection (§65 — that
 * is WP-022 per ADR-0005), Approval classes P0–P4 (§9), Authentication
 * strength A0–A3 (§8), and the Separation-of-Duties pairs (§63). They are
 * listed in the PR description as knowingly-open items, not silently skipped.
 */

/** Matrix §16 Product Catalog, §17 Pricing, §19 Promotions. */
const CATALOG_PERMISSIONS = [
  'catalog.product.view',
  'catalog.product.view-cost-sensitive',
  'catalog.product.create',
  'catalog.product.update',
  'catalog.product.archive',
  'catalog.variant.create',
  'catalog.variant.update',
  'catalog.export',
  'pricing.price-book.view',
  'pricing.price-entry.manage',
  'pricing.cost.view',
  'pricing.margin.view',
  'promotion.view',
  'promotion.create',
  'promotion.update-draft',
  'promotion.approve',
  'promotion.end',
] as const;

/** Matrix §20 Sales, §28 Returns. */
const SALES_PERMISSIONS = [
  'sales.sale.view',
  'sales.sale.view-all-in-scope',
  'sales.sale.create',
  'sales.sale.complete',
  'sales.sale.view-cost-margin',
  'sales.sale.reprint-receipt',
  'returns.return.view',
  'returns.return.request',
  'returns.return.approve-standard',
  'returns.return.post',
] as const;

/** Matrix §23 Inventory, §24 Transfers. */
const INVENTORY_PERMISSIONS = [
  'inventory.position.view',
  'inventory.position.view-cost',
  'inventory.movement.view',
  'inventory.movement.post-standard',
  'inventory.adjustment.request',
  'inventory.adjustment.approve',
  'inventory.adjustment.post',
  'inventory.availability.export',
  'transfer.view',
  'transfer.create',
  'transfer.update-draft',
  'transfer.submit',
  'transfer.approve',
  'transfer.ship',
  'transfer.receive',
  'transfer.record-discrepancy',
  'transfer.resolve-discrepancy',
  'transfer.close',
] as const;

/** Matrix §26 Suppliers, §27 Purchasing. */
const PURCHASING_PERMISSIONS = [
  'supplier.view',
  'supplier.create',
  'supplier.update',
  'supplier.archive',
  'purchasing.purchase-order.view',
  'purchasing.purchase-order.create',
  'purchasing.purchase-order.approve',
  'purchasing.purchase-order.cancel',
  'purchasing.goods-receipt.view',
  'purchasing.goods-receipt.create',
  'purchasing.goods-receipt.post',
  'purchasing.supplier-return.create',
  'purchasing.supplier-return.post',
  'purchasing.export',
] as const;

/** Matrix §29 Customers. */
const CUSTOMER_PERMISSIONS = [
  'customer.profile.view',
  'customer.profile.view-sensitive',
  'customer.profile.search',
  'customer.profile.create',
  'customer.profile.update',
  'customer.export',
] as const;

/** Matrix §15 Devices and Terminals, §34 Shifts. */
const TERMINAL_SHIFT_PERMISSIONS = [
  'terminal.view',
  'terminal.view-health',
  'terminal.provision',
  'terminal.activate',
  'terminal.block',
  'terminal.retire',
  'shift.view',
  'shift.open-own',
  'shift.close-own',
  'shift.close-for-other',
  'shift.view-history',
] as const;

/** Matrix §37 Notifications, §38 Reporting. */
const REPORTING_PERMISSIONS = [
  'reports.sales.view',
  'reports.sales.view-cost-margin',
  'reports.sales.export',
  'reports.inventory.view',
  'reports.inventory.view-cost',
  'reports.purchasing.view',
  'reports.customers.view',
  'reports.schedule.manage-recipients',
  'notifications.notification.view',
  'notifications.notification.resend',
] as const;

/**
 * Matrix §12 Tenant/Location and §13 Membership — the Location half of the
 * legacy `branches` module, and the read side of the legacy `users` module.
 * (The membership *mutation* keys stay in WP-006's `IDENTITY_PERMISSIONS`;
 * only the read key is added here, since §13 separates view from manage.)
 */
const TENANT_STRUCTURE_PERMISSIONS = [
  'location.view',
  'location.create',
  'location.update',
  'location.close',
  'tenant.membership.view',
] as const;

export const BUSINESS_PERMISSIONS = [
  ...CATALOG_PERMISSIONS,
  ...SALES_PERMISSIONS,
  ...INVENTORY_PERMISSIONS,
  ...PURCHASING_PERMISSIONS,
  ...CUSTOMER_PERMISSIONS,
  ...TERMINAL_SHIFT_PERMISSIONS,
  ...REPORTING_PERMISSIONS,
  ...TENANT_STRUCTURE_PERMISSIONS,
] as const;

export type BusinessPermission = (typeof BUSINESS_PERMISSIONS)[number];

/** The full catalog: WP-006's identity-admin keys plus this phase's business keys. */
export type AthrPermission = IdentityPermission | BusinessPermission;

export const ALL_PERMISSIONS: readonly AthrPermission[] = [
  ...IDENTITY_PERMISSIONS,
  ...BUSINESS_PERMISSIONS,
];

// --- Role grants (derived — see the header comment) ---------------------

/** Matrix §51 Cashier: sell, own shift, standard return request, reprint. */
const CASHIER_GRANTS: readonly BusinessPermission[] = [
  'catalog.product.view',
  'inventory.position.view',
  'sales.sale.view',
  'sales.sale.create',
  'sales.sale.complete',
  'sales.sale.reprint-receipt',
  'returns.return.view',
  'returns.return.request',
  'customer.profile.view',
  'customer.profile.search',
  'shift.view',
  'shift.open-own',
  'shift.close-own',
];

/** No Matrix template; the legacy `seller` role is read-only today. */
const SELLER_GRANTS: readonly BusinessPermission[] = [
  'catalog.product.view',
  'inventory.position.view',
  'customer.profile.view',
  'customer.profile.search',
];

/** Matrix §53 Inventory Manager: warehouse-scoped posting/approval + cost reports. */
const WAREHOUSE_MANAGER_GRANTS: readonly BusinessPermission[] = [
  'catalog.product.view',
  'catalog.product.view-cost-sensitive',
  'catalog.product.create',
  'catalog.product.update',
  'catalog.product.archive',
  'catalog.variant.create',
  'catalog.variant.update',
  'inventory.position.view',
  'inventory.position.view-cost',
  'inventory.movement.view',
  'inventory.movement.post-standard',
  'inventory.adjustment.request',
  'inventory.adjustment.approve',
  'inventory.adjustment.post',
  'transfer.view',
  'transfer.create',
  'transfer.update-draft',
  'transfer.submit',
  'transfer.approve',
  'transfer.ship',
  'transfer.receive',
  'transfer.record-discrepancy',
  'transfer.resolve-discrepancy',
  'transfer.close',
  'supplier.view',
  'supplier.create',
  'supplier.update',
  'supplier.archive',
  'purchasing.purchase-order.view',
  'purchasing.purchase-order.create',
  'purchasing.purchase-order.approve',
  'purchasing.purchase-order.cancel',
  'purchasing.goods-receipt.view',
  'purchasing.goods-receipt.create',
  'purchasing.goods-receipt.post',
  'purchasing.supplier-return.create',
  'purchasing.supplier-return.post',
  'reports.sales.view',
  'reports.inventory.view',
  'reports.inventory.view-cost',
  'reports.purchasing.view',
];

/** Matrix §50 Store Manager: location-scoped oversight plus approvals. */
const LOCATION_MANAGER_GRANTS: readonly BusinessPermission[] = [
  ...WAREHOUSE_MANAGER_GRANTS,
  'pricing.price-book.view',
  'pricing.price-entry.manage',
  'pricing.cost.view',
  'pricing.margin.view',
  'promotion.view',
  'promotion.create',
  'promotion.update-draft',
  'promotion.approve',
  'promotion.end',
  'sales.sale.view',
  'sales.sale.view-all-in-scope',
  'sales.sale.create',
  'sales.sale.complete',
  'sales.sale.view-cost-margin',
  'sales.sale.reprint-receipt',
  'returns.return.view',
  'returns.return.request',
  'returns.return.approve-standard',
  'returns.return.post',
  'customer.profile.view',
  'customer.profile.view-sensitive',
  'customer.profile.search',
  'customer.profile.create',
  'customer.profile.update',
  'terminal.view',
  'terminal.view-health',
  'terminal.provision',
  'terminal.activate',
  'terminal.block',
  'terminal.retire',
  'shift.view',
  'shift.open-own',
  'shift.close-own',
  'shift.close-for-other',
  'shift.view-history',
  'reports.sales.view-cost-margin',
  'reports.sales.export',
  'reports.customers.view',
  'reports.schedule.manage-recipients',
  'notifications.notification.view',
  'notifications.notification.resend',
  'location.view',
  // Legacy `branch_manager` can already list its branch's users today.
  'tenant.membership.view',
];

/** Matrix §48 Tenant Owner: everything in this catalog. */
const TENANT_OWNER_GRANTS: readonly BusinessPermission[] = [...BUSINESS_PERMISSIONS];

export const BUSINESS_ROLE_PERMISSIONS: Readonly<
  Record<MembershipRole, readonly BusinessPermission[]>
> = {
  tenant_owner: TENANT_OWNER_GRANTS,
  location_manager: dedupe(LOCATION_MANAGER_GRANTS),
  warehouse_manager: WAREHOUSE_MANAGER_GRANTS,
  cashier: CASHIER_GRANTS,
  seller: SELLER_GRANTS,
};

function dedupe<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

/**
 * Version 2 of the versioned snapshot (ADR-0005). WP-006 seeded version 1
 * with the identity-admin grants only; adding business keys to the *same*
 * version would be invisible to any environment that already seeded v1 —
 * every business endpoint would default-deny after deploy. Bumping the
 * version makes the upgrade explicit and lets `permission_policy_version` in
 * a live session/`TenantContext` still identify exactly which grant set was
 * in force (Matrix §78, §80 case 20).
 */
export const PERMISSION_POLICY_CURRENT_VERSION = 2;

export const ALL_ROLE_PERMISSIONS: Readonly<Record<MembershipRole, readonly AthrPermission[]>> =
  Object.fromEntries(
    (Object.keys(BUSINESS_ROLE_PERMISSIONS) as MembershipRole[]).map((role) => [
      role,
      dedupe<AthrPermission>([
        ...SYSTEM_ROLE_PERMISSIONS[role],
        ...BUSINESS_ROLE_PERMISSIONS[role],
      ]),
    ]),
  ) as Record<MembershipRole, readonly AthrPermission[]>;
