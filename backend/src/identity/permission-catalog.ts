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

/**
 * Matrix §16 Product Catalog, §19 Promotions.
 *
 * WP-008 Phase D adds `catalog.bundle.manage` (§16, previously undeclared —
 * `Bundle` did not exist as a code entity before this phase) and the six
 * `promotion.*` keys the Matrix declares that Phase A did not need yet
 * (`submit`, `schedule`, `activate`, `pause`, `resume`, `simulate`) —
 * `view`/`create`/`update-draft`/`approve`/`end` were already here since
 * Phase A, added early for `offers.controller.ts`'s (unrelated, pre-existing
 * AI-suggested-pricing feature) reuse of the same keys. `promotion.simulate`
 * is declared here but wired to no endpoint in this phase — see the Phase D
 * PR description, same "declared-but-unwired" precedent Phase C used for
 * `tax.calculation.override`/`tax.export`. Promotion evaluation is folded
 * into the existing `pricing.price-book.view`-gated `POST /pricing/calculate`
 * quote endpoint instead (see that controller), so no caller of today's quote
 * endpoint needs a new key to keep seeing prices.
 */
const CATALOG_PERMISSIONS = [
  'catalog.product.view',
  'catalog.product.view-cost-sensitive',
  'catalog.product.create',
  'catalog.product.update',
  'catalog.product.archive',
  'catalog.variant.create',
  'catalog.variant.update',
  'catalog.export',
  // WP-008 Phase A: Brand, UOM/Conversion, Assortment (Matrix §16).
  'catalog.brand.manage',
  'catalog.uom.view',
  'catalog.uom.create',
  'catalog.uom.update',
  'catalog.uom-conversion.publish',
  'catalog.assortment.view',
  'catalog.assortment.manage',
  // WP-008 Phase D: Bundle is catalog composition (Matrix §16), not a
  // Promotion/Coupon key (Matrix §19) -- see `catalog/bundle.entity` note.
  'catalog.bundle.manage',
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

/**
 * Matrix §19 Coupon. All six keys are new in WP-008 Phase D (`Coupon` did not
 * exist as a code entity before this phase). `coupon.export-codes` is
 * declared here but wired to no endpoint in this phase (Matrix: "Raw coupon
 * export C/A3/P2 ومشفّر ومؤقت" -- encrypted, time-limited access; building
 * that safely needs a signing/encryption primitive that does not exist
 * anywhere else in this codebase yet, and inventing one under this phase's
 * scope was judged riskier than deferring it -- see the Phase D PR
 * description). It is granted to `tenant_owner` via the blanket grant below
 * rather than added to `DENY_BY_DEFAULT_PERMISSIONS`, matching the
 * `tax.export` precedent (declared + granted + unwired), not the
 * `tax.calculation.override` precedent (declared + actively withheld) --
 * there is no endpoint for either role to reach yet, so the distinction is
 * inert today but documented for whoever wires the endpoint next.
 */
const COUPON_PERMISSIONS = [
  'coupon.campaign.create',
  'coupon.code.generate',
  'coupon.code.view-sensitive',
  'coupon.usage.view',
  'coupon.redemption.override',
  'coupon.export-codes',
] as const;

/**
 * Matrix §17 Pricing. `pricing.price-book.view`/`pricing.price-entry.manage`/
 * `pricing.cost.view`/`pricing.margin.view` already existed (WP-007 Phase A);
 * WP-008 Phase B adds the rest of the maker-checker lifecycle keys plus
 * override/floor/export — the full key list the Matrix declares for §17.
 */
const PRICING_PERMISSIONS = [
  'pricing.price-book.view',
  'pricing.price-book.create',
  'pricing.price-book.update-draft',
  'pricing.price-book.submit',
  'pricing.price-book.approve',
  'pricing.price-book.schedule',
  'pricing.price-book.activate',
  'pricing.price-book.end',
  'pricing.price-entry.manage',
  'pricing.cost.view',
  'pricing.margin.view',
  'pricing.floor.configure',
  'pricing.manual-override.apply',
  'pricing.manual-override.approve',
  'pricing.manual-override.above-threshold',
  'pricing.export',
] as const;

/**
 * Matrix §18 Tax — WP-008 Phase C. The full key list the Matrix declares,
 * verbatim. Which of these are actually *enforced* at a call site in this
 * phase, and which are declared-but-unwired, is spelled out in
 * `DENY_BY_DEFAULT_PERMISSIONS` below and in the Phase C PR description —
 * Phase B shipped a key that was declared, granted, and enforced at zero call
 * sites, and that leak is the reason this distinction is written down.
 */
const TAX_PERMISSIONS = [
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
  'transfer.cancel-before-shipment',
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
  ...COUPON_PERMISSIONS,
  ...PRICING_PERMISSIONS,
  ...TAX_PERMISSIONS,
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
  // The enrolled terminal reports its own sync/health state via
  // POST /terminals/heartbeat regardless of which role is logged in on the
  // till. `@Roles` already allows `cashier` on that route; without this grant
  // every cashier-operated terminal fails the permission check on every
  // heartbeat and can never advance past it to pull catalog updates.
  'terminal.view-health',
  // Matrix §406: cashier manual override within a role-configured limit is
  // P0/P1 (no separate approval); below-floor is always a separate approval
  // (`pricing.manual-override.above-threshold`, deliberately NOT granted
  // here — see the header comment on this file for the derivation rule).
  'pricing.manual-override.apply',
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
  // WP-008 Phase A: Brand, UOM/Conversion, Assortment management.
  'catalog.brand.manage',
  'catalog.uom.view',
  'catalog.uom.create',
  'catalog.uom.update',
  'catalog.uom-conversion.publish',
  'catalog.assortment.view',
  'catalog.assortment.manage',
  // WP-008 Phase D (BR-BND-104: component availability determines
  // sellability -- an inventory-facing concern, same grouping as the
  // Assortment keys immediately above).
  'catalog.bundle.manage',
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
  'transfer.cancel-before-shipment',
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
  // WP-008 Phase B: full Price Book maker-checker lifecycle, floor
  // configuration, and override approval — Store Manager is the
  // location-scoped pricing authority (Matrix §50 "Local ... approvals").
  // Self-approval (creator === approver) is still blocked at the service
  // layer regardless of holding both keys (Matrix §17 "Separation").
  ...PRICING_PERMISSIONS,
  // WP-008 Phase C: read-only. A store manager needs to see which rate
  // applies to what they sell; authoring and activating tax rules is
  // tenant-level (Matrix §18: activation is H/A2/P2) and stays with the
  // owner. `tax.calculation.override` is deny-by-default for every role
  // (BR-TAX-206) — see `DENY_BY_DEFAULT_PERMISSIONS`.
  'tax.code.view',
  // WP-008 Phase D: full Promotion maker-checker lifecycle -- Store Manager
  // is the location-scoped promotion authority, same grouping rationale as
  // the full Pricing key set immediately above. Self-approval (creator ===
  // approver) is blocked at the service layer regardless of holding both
  // `promotion.submit` and `.approve`, same as Pricing/Tax (Matrix §19
  // implies the same "Separation" pattern §17/§18 state explicitly).
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
  // WP-008 Phase D: day-to-day coupon campaign operations. `coupon.export-
  // codes` is deliberately NOT granted here (Matrix: C/A3/P2 -- tenant-level
  // only, via the blanket `tenant_owner` grant; see `COUPON_PERMISSIONS`).
  'coupon.campaign.create',
  'coupon.code.generate',
  'coupon.code.view-sensitive',
  'coupon.usage.view',
  'coupon.redemption.override',
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

/**
 * Keys that exist in the catalog so they can be granted deliberately, and are
 * granted to **no role by any default template** — not even `tenant_owner`.
 *
 * `tax.calculation.override` (Matrix §18: "Manual tax override C/A3 وقد تمنع
 * بالكامل حسب jurisdiction") is the only member today. BR-TAX-206 classifies
 * manual tax override as forbidden by default and says a correction is made by
 * changing tax eligibility or issuing an authorised corrective document —
 * "لا مبلغ ضريبة حر", not a free tax amount.
 *
 * This differs from `pricing.manual-override.above-threshold`, which is
 * withheld from `cashier` but still reaches `tenant_owner` through the blanket
 * grant below. A tax override must not reach anyone implicitly, so it is
 * subtracted from that blanket grant rather than merely omitted from the
 * narrower ones.
 *
 * Removing a key from this list re-grants it to every owner on the next policy
 * snapshot version. Do not do that without a jurisdiction decision.
 */
export const DENY_BY_DEFAULT_PERMISSIONS: readonly BusinessPermission[] = [
  'tax.calculation.override',
];

/**
 * Matrix §48 Tenant Owner: everything in this catalog **except** the
 * deny-by-default keys above.
 */
const TENANT_OWNER_GRANTS: readonly BusinessPermission[] = BUSINESS_PERMISSIONS.filter(
  (permission) => !DENY_BY_DEFAULT_PERMISSIONS.includes(permission),
);

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
 * Version 3 of the versioned snapshot (ADR-0005). WP-006 seeded version 1
 * with the identity-admin grants only; adding business keys to the *same*
 * version would be invisible to any environment that already seeded v1 —
 * every business endpoint would default-deny after deploy. Bumping the
 * version makes the upgrade explicit and lets `permission_policy_version` in
 * a live session/`TenantContext` still identify exactly which grant set was
 * in force (Matrix §78, §80 case 20).
 *
 * v2 -> v3: cashier gained `terminal.view-health` (heartbeat permission
 * fix). `PermissionPolicyService.ensureSeeded()` only re-seeds when the
 * code's constant is *higher* than the stored snapshot's version — editing
 * `CASHIER_GRANTS` alone is inert against a database that already has an
 * active v2 row; every environment stays on the frozen v2 `grants` JSON
 * until this constant moves past it.
 *
 * v3 -> v4: WP-008 Phase A adds the Brand/UOM/Assortment catalog keys
 * (`catalog.brand.manage`, `catalog.uom.*`, `catalog.uom-conversion.publish`,
 * `catalog.assortment.*`) and grants them to `warehouse_manager` (and, by
 * the existing spread, `location_manager`/`tenant_owner`) — the same roles
 * that already manage `catalog.product.*`/`catalog.variant.*`. `cashier` and
 * `seller` are unchanged; this phase built no POS-facing consumer of these
 * keys.
 *
 * v4 -> v5: WP-008 Phase B adds the remaining Matrix §17 Pricing keys
 * (`pricing.price-book.create/update-draft/submit/approve/schedule/
 * activate/end`, `pricing.floor.configure`,
 * `pricing.manual-override.apply/approve/above-threshold`,
 * `pricing.export`) alongside the four that already existed. `cashier`
 * gains only `pricing.manual-override.apply` (Matrix §406: within-limit
 * override is P0/P1, no separate approval); `location_manager` gains the
 * full Pricing key set (Matrix §50 Store Manager: location-scoped pricing
 * authority); `warehouse_manager`/`seller` are unchanged — neither role
 * manages pricing today. Self-approval (a Price Book's creator approving
 * their own submission) is blocked at the service layer even for a role
 * holding both `pricing.price-book.submit` and `.approve` — the permission
 * catalog only ever expresses "may this role call this endpoint," not the
 * per-instance maker-checker check (Matrix §17 "Separation").
 *
 * v5 -> v6: WP-008 Phase C adds the Matrix §18 Tax keys. `tenant_owner` gains
 * all of them **except** `tax.calculation.override`, which is subtracted from
 * the blanket owner grant by `DENY_BY_DEFAULT_PERMISSIONS` (BR-TAX-206:
 * forbidden by default, Matrix §18: "قد تمنع بالكامل حسب jurisdiction").
 * `location_manager` gains `tax.code.view` only — a store manager needs to
 * see which rate applies, but tax rules are tenant-level and their
 * maker-checker lifecycle (Matrix §18: activation is H/A2/P2) sits with the
 * owner. `warehouse_manager`, `cashier` and `seller` are unchanged: the POS
 * receives tax through the catalog sync snapshot, not through a tax endpoint,
 * so no till-side role needs a §18 key.
 *
 * v6 -> v7: WP-008 Phase D adds the remaining Matrix §19 Promotion keys
 * (`promotion.submit/schedule/activate/pause/resume/simulate` -- `view/
 * create/update-draft/approve/end` already existed from Phase A), all six
 * §19 Coupon keys, and §16's `catalog.bundle.manage`. `location_manager`
 * gains the full Promotion lifecycle (same "location-scoped authority"
 * grouping as its full Pricing grant) and every Coupon key except
 * `coupon.export-codes`; `warehouse_manager` (and by the existing spread,
 * `location_manager`) gains `catalog.bundle.manage` (BR-BND-104: component
 * availability is an inventory-facing concern). `tenant_owner` gains all of
 * these via the blanket grant, including `coupon.export-codes` and
 * `promotion.simulate` -- both declared-but-unwired in this phase (no
 * endpoint exists yet for either), matching the `tax.export` precedent from
 * v5 -> v6, not the `tax.calculation.override` one (that key is actively
 * withheld via `DENY_BY_DEFAULT_PERMISSIONS`; these two are not, since
 * nothing reaches them regardless). `cashier`/`seller` are unchanged: the POS
 * quote path (`PricingController.calculate`) folds promotion evaluation into
 * the existing `pricing.price-book.view` gate rather than requiring a new
 * key, and neither role manages promotions/coupons/bundles.
 */
export const PERMISSION_POLICY_CURRENT_VERSION = 7;

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
