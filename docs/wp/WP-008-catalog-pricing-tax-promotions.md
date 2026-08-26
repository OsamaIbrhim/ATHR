# WP-008 — Catalog, Pricing, Tax and Promotions

**Repository:** `OsamaIbrhim/bold_system`
**Base branch:** `master`
**Wave:** 4 — Domain Migration (first WP in this wave; per `docs/delivery/execution-plan.md`, WP-007 is the last item of Wave 3 and is a hard dependency).
**Depends on:** WP-007 (all phases A–C merged, deployed, health-verified; Phase D is legacy cleanup and is *not* a dependency — it can remain parked).
**Blocks:** WP-009 (Inventory and Stock) needs UOM/conversion; WP-010 (Sales and Payments) and WP-011 (Returns) need the Price Book/Tax/Promotion evaluation contracts to be real, not the current flat formula.

This WP replaces the current single-table `PricingRule` flat-formula pricing engine and the free-text `Product.brand` field with the versioned, auditable model required by `ATHR Product Catalog, Pricing, Taxes & Promotions Business Rules v1.0` (hereafter "the BR doc") — 39 sections, ~200 BR-tagged rules, 14 Open Decisions (OD-CAT-001–014) that already fix this WP's MVP boundary, and a 12-item Acceptance Gate (§38). This is a **large domain WP, not a small one** — it runs as **four sequential phases**, same discipline as WP-007: each phase merged, deployed, and health-verified before the next starts. Do not collapse phases.

---

## 0. Mandatory Pre-Flight — Every Session, Every Phase

1. Read the BR doc in full: `docs/00-product/br-catalog-pricing-tax-promotions.md`. Do not paraphrase from this WP document instead of the source — this WP document summarizes; the BR doc's exact wording governs.
2. Read `docs/02-contracts/permission-matrix.md` §16 (Catalog), §17 (Pricing), §18 (Tax), §19 (Promotion/Coupon) in full.
3. Read `docs/03-architecture/multi-tenancy-blueprint.md` §26–35 again (repository contract, composite FKs, tenant-scoped uniqueness) — every new table in this WP is tenant-owned and must follow the `UNIQUE (tenant_id, id)` + composite-FK pattern and `findById(context,id)/list(context,filters)/save(context,aggregate)` repository contract WP-007 already established for `products`/`pricing`/`offers`.
4. Read the current `backend/src/products/`, `backend/src/pricing/`, `backend/src/offers/` modules and `backend/prisma/schema.prisma`'s `Product`, `ProductVariant`, `Category`, `PricingRule`, `OfferSuggestion` models before writing anything — this WP extends and partially replaces existing code, it does not start from a blank module.
5. Confirm WP-007 Phases A–C are merged, deployed, and Railway-health-verified (see Delivery Log). Confirm Phase D's status (parked or not) but do not treat it as a blocker either way.
6. **Read OD-CAT-001 through OD-CAT-014 (BR doc §35) and §36 "Out of scope now" before scoping any phase below.** These already fix the MVP boundary — do not build the deferred version of anything listed in §36 without asking first.
7. **Do not author any documentation, ADR, or Delivery Log entry in this session.** Report facts (row counts, test results, endpoints changed, PR links) in the PR description only. The planning layer writes the Delivery Log entry from your factual report, same as every prior WP.
8. Standing rules carried forward unchanged: never treat an unavailable local check as a pass (report unverified, rely on CI); no destructive command against the shared Supabase dev database; every migration tested clean + populated; root-cause before patching.

---

## MVP Boundary (fixed by OD-CAT-001–014 and §36 — do not re-litigate per phase)

- Price Books: **single operating currency only** (OD-CAT-005/006).
- Tax: **versioned tax codes + inclusive/exclusive calculation only. No jurisdiction-determination engine** (OD-CAT-007) — Egypt ETA e-invoice integration is explicitly a separate, not-yet-scheduled WP (see project memory on the ETA compliance gap); this WP only makes tax *rates* versioned and auditable, it does not file anything with ETA.
- Promotions: **percentage, fixed-amount, fixed-price, and simple BOGO only. Defer composite/multi-condition stacking rules** (OD-CAT-008).
- Coupons: **single-use and public codes, online-first. Defer offline redemption** (OD-CAT-009).
- Bundles: **virtual sales bundles only (price allocated across existing components at sale time). No stock-kit assembly/disassembly** (OD-CAT-010, §36).
- Out of scope entirely per §36: AI dynamic pricing, marketplace syndication, full PIM, manufacturing BOM/MRP, global multi-jurisdiction tax determination, competitor-price scraping, rebate settlement, hidden personalized pricing, cross-tenant shared catalog, recurring subscription products.

---

# PHASE A — Catalog Foundation: Brand, UOM, Assortment (BR §4–12, §26–27 partial)

## A.1 Objective

Turn the current free-text `Product.brand` field and implicit tenant-wide `is_active` flag into the real entities the BR doc requires: a `Brand` entity, a Unit-of-Measure/conversion model, and per-Location assortment (sellability). This phase touches schema but is additive-only — no removal of existing columns.

## A.2 Branch

`feat/wp-008a-catalog-foundation` from `master`.

## A.3 Scope In

1. `Brand` entity (tenant-owned, `UNIQUE(tenant_id, id)`), migrate `Product.brand` (string) to `Product.brand_id` (FK) with a data migration that creates one `Brand` row per distinct existing string value per tenant — do not lose any existing brand data (BR-CLS-1xx).
2. `UnitOfMeasure` (tenant-owned reference: base units + derived units) and `UomConversion` (versioned, immutable once published per BR-UOM-1xx: conversion factor must be positive, and a historical conversion record must never be edited after it has been used in a transaction — supersede with a new version instead).
3. `Assortment` (or equivalent per-Location sellability table): a Product/Variant can be `Active` tenant-wide but not sellable at every `Location` (BR-AST-1xx, BR-STA-2xx) — this is the gap between today's single `is_active` boolean and location-level control.
4. Item type classification per BR-TYP-1xx: stocked / non-stock / service / bundle-kit-placeholder (the bundle *type* is scoped here; the bundle *evaluation engine* is Phase D). Type-change restrictions once a variant has transaction history.
5. Retrofit `backend/src/products` repository/service to the new entities using the existing `findById(context,id)/list(context,filters)/save(context,aggregate)` contract — extend, do not replace, the WP-007 tenant-scoping already in place.
6. Cross-tenant isolation tests for every new table, same pattern as WP-007 (`*.cross-tenant.spec.ts`).

## A.4 Scope Out

- No Price Book, Tax Code, or Promotion/Coupon work — later phases.
- No stock-kit assembly (§36, deferred indefinitely, not just this phase).
- No import/export tooling (BR-IMP-2xx) — flagged as a candidate for its own later WP if Osama wants it; not silently dropped, just not in this WP.

## A.5 Testing Requirements

- Full existing regression suite green (no behavior change to today's single-tenant catalog reads/writes beyond what the new columns require).
- Data migration proof: every existing `Product.brand` string value has a corresponding `Brand` row post-migration, zero data loss (a validation query, not an assertion).
- Cross-tenant isolation tests per new table.
- UOM conversion immutability test: attempting to edit a conversion factor already referenced by a transaction is rejected; a new version is created instead.

## A.6 Acceptance Criteria

- [ ] `Brand` entity exists; `Product.brand_id` FK in place; zero data loss from the string→entity migration.
- [ ] `UnitOfMeasure`/`UomConversion` exist, tenant-scoped, versioned, immutable-once-used.
- [ ] Per-Location assortment/sellability exists and is distinct from tenant-wide `Active` status.
- [ ] Item type classification exists with type-change restrictions enforced once transaction history exists.
- [ ] Clean `npm ci` + all builds + Docker build/run/health verified (CI acceptable per WP-006/WP-007 precedent).

## A.7 Branch/PR and Stop Condition

One PR, `WP-008 Phase A: Catalog Foundation`. Merge, deploy, Railway-health-verify before Phase B.

---

# PHASE B — Price Books and Pricing Evaluation (BR §13–16, §18)

## B.1 Objective

Replace the current flat, single-table `PricingRule` (`cost * (1+overhead) * (1+profit) * (1+tax)`, one rule matched by polymorphic `scope_id`) with the versioned Price Book model the BR doc requires: effective-dated entries, deterministic price-source ordering, quantity breaks, manual-override vs. discount separation, and floor-price approval.

## B.2 Pre-condition Check

Confirm Phase A is merged, deployed, health-verified, with zero regressions in its cross-tenant tests since merge (same discipline as WP-007 §B.2).

## B.3 Branch

`feat/wp-008b-price-books` from `master`.

## B.4 Scope In

1. `PriceBook` (tenant-owned, single-currency per OD-CAT-005/006, `scope` + `status` per BR-PRB-1xx: draft → submit → approve → schedule → activate → end lifecycle, matching Permission Matrix §17's maker-checker keys).
2. `PriceBookEntry` (effective-dated, no silent retroactive edits — an edit to an already-active entry creates a new version, per BR-PRB-1xx and BR-CAUD-2xx audit requirements).
3. Deterministic price-source ordering per BR-PSL-1xx: variant-specific → product → brand → category → global default (the same priority chain the current flat `PricingRule.scope_type` approximates, but now versioned and explainable). No-price blocks sale by default; zero/negative price requires explicit rule, not silent fallback.
4. Quantity-break support (BR-PSL-1xx).
5. Manual override vs. discount kept as **distinct entities** (BR-OVP-1xx) — an override changes the applied unit price at sale time within a role-based limit; a discount is a separate calculated adjustment. Below-floor requires separate approval (`pricing.manual-override.above-threshold` per Permission Matrix §17) — do not let one permission imply the other.
6. Cost visibility restriction: `pricing.cost.view` / `pricing.margin.view` stay separate from `catalog.product.view` (already partially modeled in WP-007's `permission-catalog.ts` — confirm alignment, don't duplicate the keys).
7. `PricingService.calculate()` rewritten against the new Price Book model; keep the existing method signature (`calculate(context, variantId, transaction?)`) where possible so calling code in sales/purchasing isn't broken — but this is explicitly **not** a zero-behavior-change phase like WP-007; today's flat formula pricing is being replaced with real Price Books, and that is the point of this WP. Say so plainly in the PR description; do not claim zero behavior change here.
8. Migrate existing `PricingRule` rows into the new Price Book model as a one-time data migration — do not silently drop existing pricing data. Any `PricingRule` row that cannot be unambiguously mapped (per CLAUDE.md §6 "fail loud on ambiguous data") must be reported explicitly, not defaulted.

## B.5 Scope Out

- No Tax Code work — Phase C.
- No Promotion/Coupon work — Phase D.
- No multi-currency (single operating currency only, per MVP boundary).

## B.6 Testing Requirements

- Deterministic price resolution test per priority level (variant/product/brand/category/global), including the no-price-blocks-sale default.
- Quantity-break calculation tests.
- Override-vs-discount separation test; below-floor-requires-approval test.
- `PricingRule`→`PriceBook` migration: every existing rule accounted for, ambiguous cases explicitly reported (not silently mapped).
- Full regression suite for sales/purchasing code paths that call `PricingService.calculate()` — this is the one phase in this WP most likely to break a caller, so this suite matters more than usual.

## B.7 Acceptance Criteria

- [ ] `PriceBook`/`PriceBookEntry` exist with full draft→approve→schedule→activate→end lifecycle.
- [ ] Deterministic price-source ordering implemented and tested at every priority level.
- [ ] Manual override and discount are distinct, with role-based limits and below-floor approval enforced.
- [ ] Every existing `PricingRule` row migrated or explicitly reported as ambiguous — none silently dropped.
- [ ] Full regression green for every caller of `PricingService`.
- [ ] Clean `npm ci` + builds + Docker build/run/health verified.

## B.8 Branch/PR and Stop Condition

One PR, `WP-008 Phase B: Price Books and Pricing Evaluation`, flagged `[REPLACES PRICING ENGINE]` in the title since this is not a pure-additive phase. Merge, deploy, Railway-health-verify before Phase C.

---

# PHASE C — Versioned Tax Codes (BR §17, §36 boundary)

## C.1 Objective

Replace `PricingRule.tax_percent` (a single flat 14% default baked into the pricing formula) with the versioned `TaxCode` model per BR-TAX-2xx: a product carries a tax *category*, not a permanent rate; the rate is resolved and snapshotted onto the document at transaction time; rate changes never rewrite historical documents.

## C.2 Pre-condition Check

Confirm Phase B is merged, deployed, health-verified, zero regressions.

## C.3 Branch

`feat/wp-008c-tax-codes` from `master`.

## C.4 Scope In

1. `TaxCode` (tenant-owned, versioned per BR-TAX-2xx — draft → submit → approve → schedule → activate → supersede, matching Permission Matrix §18).
2. `Product`/`ProductVariant` carry a tax *category* reference (product-level default with variant-level override, per OD-CAT-014), not a rate.
3. Inclusive/exclusive tax calculation defined per price context (BR-TAX-2xx) — this determines whether a Price Book entry's price already contains tax or not, and must be explicit per entry, never assumed.
4. Tax snapshot: every sales document stores the resolved rate/code version at the moment of the transaction (BR-CAUD-2xx, BR-CREP-2xx) — a later rate change must never alter a historical document's reported tax.
5. Exemptions require evidence (BR-TAX-2xx) — an exemption is a recorded, auditable decision, not a silent zero.
6. Manual tax override forbidden by default (`tax.calculation.override` per Permission Matrix §18 is C/A3 and may be fully disabled per jurisdiction) — implement as deny-by-default, explicitly grantable, not implicitly available to any role.
7. **Explicitly out of scope, stated plainly in the PR**: this is not Egypt ETA e-invoice integration. That is a separate compliance gap already flagged to Osama and not scheduled in any current WP. This phase makes the *rate* versioned and auditable; it does not produce an ETA-compliant e-invoice or talk to any government API.

## C.5 Scope Out

- No jurisdiction-determination engine (single-jurisdiction assumption stands per OD-CAT-007).
- No ETA integration (see C.4.7).
- No Promotion/Coupon/Bundle work — Phase D.

## C.6 Testing Requirements

- Tax snapshot immutability: create a sale under tax version 1, activate tax version 2, confirm the original sale's reported tax is unchanged.
- Inclusive vs. exclusive calculation test per price context.
- Exemption-requires-evidence test; manual-override-denied-by-default test.
- Migration of existing flat 14% `tax_percent` values into `TaxCode` v1 — every existing rule accounted for, ambiguous cases explicitly reported per CLAUDE.md §6.

## C.7 Acceptance Criteria

- [ ] `TaxCode` versioned lifecycle implemented per BR-TAX-2xx.
- [ ] Product/Variant tax category (with override) replaces the flat percentage.
- [ ] Historical tax snapshots proven immutable under a rate change.
- [ ] Exemption evidence and override-denied-by-default both enforced and tested.
- [ ] Clean `npm ci` + builds + Docker build/run/health verified.

## C.8 Branch/PR and Stop Condition

One PR, `WP-008 Phase C: Versioned Tax Codes`. Merge, deploy, Railway-health-verify before Phase D.

---

# PHASE D — Promotions, Coupons, Bundles — MVP (BR §20–25, OD-CAT-008/009/010)

## D.1 Objective

Build the Promotion/Coupon/Bundle engine within the explicit MVP boundary already fixed by OD-CAT-008/009/010 — no composite stacking, online-first coupons, virtual bundles only.

## D.2 Pre-condition Check

Confirm Phase C is merged, deployed, health-verified, zero regressions.

## D.3 Branch

`feat/wp-008d-promotions-coupons-bundles` from `master`.

## D.4 Scope In

1. `Promotion` lifecycle per BR-PMT-1xx: draft → submit → approve → schedule → activate → pause/resume → end, timezone-aware start/end, activation never reprices already-completed sales, pause blocks new use without retroactively touching history.
2. Benefit types limited to MVP per OD-CAT-008: percentage, fixed-amount, fixed-price, simple BOGO (BR-BEN-1xx). Defer composite/multi-condition stacking — a single explicit priority order is enough for this phase (BR-STK-1xx), not a general combinatorial engine.
3. Eligibility conditions (BR-CND-1xx) must be explainable (a sale can report *why* a promotion did or didn't apply) and must not claim offline support unless actually evaluable offline — cross-check against `ATHR Offline Protocol v1.0` before claiming any promotion type works offline.
4. `Coupon` as a separate entity from `Promotion` (BR-CPN-2xx): normalized unique codes, public or single-use or customer-bound, idempotent redemption (redeeming the same code twice never double-applies), centralized usage limits, codes never appear in plaintext logs. Online-first per OD-CAT-009 — offline coupon redemption is explicitly deferred, say so in the PR rather than silently building a partial version.
5. `Bundle` as virtual-only per OD-CAT-010/§36: versioned components and quantities, price allocated across components at sale time, partial-return allocation policy defined before activation (BR-BND-1xx) — no stock-kit assembly/disassembly.
6. Promotion-evaluation failure must never hide the base price (BR-CERR-2xx) — if the promotion engine errors, the sale must still be completable at the correct non-promotional price, not blocked or silently mispriced.
7. Raw coupon-code export (`coupon.export-codes`, Permission Matrix §19) is C/A3/P2 — encrypted, time-limited access, not a plain CSV endpoint.

## D.5 Scope Out

- Composite/multi-condition promotion stacking (deferred per OD-CAT-008).
- Offline coupon redemption (deferred per OD-CAT-009).
- Stock-kit assembly/disassembly (deferred indefinitely per §36, not just this phase).
- Any AI-driven or personalized pricing (§36, out of scope entirely, not a future phase of this WP).

## D.6 Testing Requirements

- Full BR-PMT-1xx lifecycle test (draft→...→end), including pause-doesn't-rewrite-history and activation-doesn't-reprice-completed-sales.
- Idempotent coupon redemption test (double-redemption rejected, not double-applied).
- Bundle price-allocation and partial-return tests.
- Promotion-evaluation-failure-doesn't-block-sale test (BR-CERR-2xx) — this is a resilience requirement, test it as a failure-injection case, not just the happy path.
- Cross-tenant isolation tests for every new table.

## D.7 Acceptance Criteria

- [ ] Promotion lifecycle implemented per BR-PMT-1xx within the MVP benefit-type boundary.
- [ ] Coupons implemented online-first per OD-CAT-009, idempotent redemption proven.
- [ ] Bundles implemented virtual-only per OD-CAT-010, allocation and return policy defined and tested.
- [ ] Promotion-evaluation failure proven not to block or mis-price a sale.
- [ ] Clean `npm ci` + builds + Docker build/run/health verified.
- [ ] Full BR doc §38 Acceptance Gate items 8–10 (Promotion MVP types + stacking, Coupon scope, Bundle scope + return allocation) satisfied explicitly — reference each item in the PR description.

## D.8 Branch/PR and Stop Condition

One PR, `WP-008 Phase D: Promotions, Coupons and Bundles (MVP)`. Merge, deploy, Railway-health-verify. This closes WP-008.

---

## Prohibited Across All Phases

- No phase starts before the previous phase is merged, deployed, and health-verified in production.
- No building of anything listed in BR doc §36 "Out of scope now" without asking Osama first, even if it seems like a small addition.
- No silent mapping of ambiguous legacy `PricingRule`/tax-percent data during migration — fail loud and report per CLAUDE.md §6.
- No documentation/ADR/Delivery Log authored by the CLI — facts only, in PR descriptions.
- No treating an unavailable local check as a pass — report it as unverified and rely on CI, or stop and ask.
- No Egypt ETA e-invoice work under this WP's name — that is a separate, not-yet-scheduled compliance gap.

---

## Compliance Checklist (per the project's WP-008-onward standard)

Every item from `CLAUDE.md` §1–6, marked done-with-evidence or `N/A — reason`, at WP close:

| # | CLAUDE.md item | Status |
| --- | --- | --- |
| 1.1 | Zero-Trust input validation (Zod/Joi) on all new endpoints | To be satisfied per-phase — every new controller endpoint (Price Book, Tax Code, Promotion, Coupon, Bundle CRUD) must have schema validation; report which validator and file in each phase's PR. |
| 1.2 | Auth/RBAC explicitly enforced; tenant context from trusted server-side state only | Inherited from WP-007's global guard + Permission Matrix §16–19 keys — confirm each new endpoint is wired to the matching new permission key, not left ungated. |
| 1.3 | No hardcoded secrets; no sensitive fields in responses/logs | Cost/margin fields (`pricing.cost.view`/`pricing.margin.view`) must be excluded from responses when the caller lacks that permission, not just hidden in the UI. |
| 1.4 | Injection/XSS prevention | N/A unless raw SQL is used anywhere in this WP (WP-007 precedent used raw SQL in a few reconciliation queries with bound params) — if any raw SQL appears here, same bound-parameter discipline applies. |
| 2.1 | SOLID/clean architecture, light controllers | Follow the existing `products`/`pricing`/`offers` module pattern already in the repo. |
| 2.2 | Modular independence, explicit dependency direction | Price Book/Tax/Promotion modules should not directly reach into each other's repositories — go through service-layer contracts. |
| 2.3 | Extensible patterns | Versioned-entity pattern (Price Book, Tax Code, Promotion) should be structurally consistent across all three so a later WP can add a fourth versioned type without inventing new plumbing. |
| 2.4 | DRY with prudence | N/A call-out only if a specific duplication is found; not a blanket requirement. |
| 3.1 | DB indexing on queried/filtered/FK fields | Every new tenant-owned table needs `tenant_id`-leading indexes per Blueprint §35 — confirm in each phase's migration. |
| 3.2 | Pagination/sorting/field-projection on list endpoints | New `list()` endpoints (Price Books, Tax Codes, Promotions, Coupons) must paginate — this is a real gap risk since the current `products`/`offers` list endpoints should be checked for this too while touched. |
| 3.3 | Non-blocking async | N/A unless a specific heavy computation is identified (e.g., bulk price recalculation) — if so, must not block the request thread. |
| 4.1–4.4 | Standardized error handling, predictable responses, no silent failures, edge-case coverage | Directly required by BR-CERR-2xx (§32) — this BR section *is* CLAUDE.md §4 applied to this domain; treat BR-CERR-2xx test coverage as satisfying this item. |
| 5.1–5.3 | Strict typing, naming conventions, self-documenting code | Standard, no domain-specific exception. |
| 6.1–6.8 | Stable deployable state, branch discipline, evidence-based verification, prove across consumers, root-cause before patching, forward-only non-destructive migrations, deliberate documentation authorship, fail loud on ambiguous data | All directly enforced throughout this document's phase structure — see Pre-Flight §8 and the ambiguous-data-migration requirements in Phases B/C. |
