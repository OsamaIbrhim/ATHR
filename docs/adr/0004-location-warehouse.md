# ADR-0004: Location / Warehouse

**Status:** Proposed
**Author:** Claude Code CLI (WP-005 Phase A)
**Requires approval from:** Osama (project owner) before Phase B may begin

- **Date:** 2026-08-02
- **Work package:** WP-005 Phase A
- **Related docs:** `ATHR Tenant, Organization, Locations & User Membership Business Rules v1.0` §8–9 (BR-LOC-200–207, BR-WHS-200–205), §32 (OD-TEN-006); `ATHR Multi-tenancy Blueprint v1.0` §6–7 (Location, Warehouse); `ATHR Database Blueprint v1.0` §7 (`organization.locations`, `organization.warehouses`)

## Context

The current schema has only `Branch`, which is simultaneously "the operational site" and implicitly "the inventory account" (`InventoryStock` is keyed on `branch_id` + `variant_id` directly). The Business Rules document requires Location and Warehouse to be modeled as **distinct entities** (`BR-TEN-106`), because a real deployment can have a Location with no independent inventory custody (relying on a centralized Warehouse) or a Warehouse serving more than one Location. WP-005 Phase B (MT-MIG-002) must turn every existing `Branch` into a `Location` and give every selling `Location` a resolvable `Warehouse`, so this ADR must fix both the entity separation and the still-open access-inheritance question (`OD-TEN-006`) before that migration is written.

## Decision

### 1. Location, Warehouse, and Terminal are distinct entities (`BR-TEN-106`)

- **Location** represents an operational/commercial site (a store, an office). It carries its own lifecycle state, timezone, and operating-settings snapshot (`BR-LOC-201`–`203`).
- **Warehouse** represents inventory custody/accounting scope — stock is measured per `(Warehouse, Variant)`, not per `(Location, Variant)` (`BR-WHS-200`).
- **Terminal** represents a registered POS installation with its own lifecycle, independent of both (`BR-TRM-200`–`206`).

None of the three is used as a substitute for another. A Location is not automatically a Warehouse.

### 2. Warehouse may be Location-linked or centralized (`BR-WHS-201`)

A Warehouse either belongs to exactly one Location or is centralized (independent of any single Location, e.g. serving multiple selling Locations). WP-005 Phase B's default-Warehouse-per-Location step (MT-MIG-002) creates a Location-linked Warehouse for each migrated `Branch`; centralized Warehouses are not required by Phase B but the schema must not preclude them later.

### 3. Every selling Location needs an explicit, resolvable inventory source (`BR-WHS-202`)

A Location must never rely on an implicit or hidden Warehouse-selection rule to sell. WP-005 Phase B enforces this by creating a default Warehouse for every migrated Location as part of the same migration that creates the Location — no Location may exist post-migration without a resolvable default selling Warehouse (see acceptance criteria in the WP-005 document, §B.9).

### 4. Location access does not implicitly grant Warehouse access — resolved (`OD-TEN-006`)

This was an explicitly open decision in the Business Rules document (`OD-TEN-006`: "يحسم في Permission Matrix"). This ADR resolves it now, since WP-005/006/007 cannot proceed with an unresolved access-inheritance rule:

**Decision:** For **simple operational roles** (e.g. Cashier, Branch/Location Manager acting in their normal day-to-day capacity), a Scope assignment to a Location **does** implicitly include the Warehouse(s) directly linked to that Location — a cashier who can sell at a Location must be able to see and consume that Location's own inventory without a second, separate Warehouse grant. This mirrors `BR-WHS-205`'s explicit allowance: "يمكن الربط الافتراضي، لكن الـScope النهائي صريح وقابل للمراجعة" (default linkage is allowed, but the resulting effective scope is explicit and reviewable — i.e., it is a real, inspectable Scope grant computed from the Location assignment, not a silent bypass).

For **centralized or cross-Location roles** (e.g. a central Warehouse Manager operating a centralized Warehouse serving several Locations, or any role needing Warehouse access independent of a specific Location's Scope), Warehouse access must be granted as its own explicit Scope, separate from any Location Scope (`BR-SCP-102`, `BR-SCP-103`: Location scope does not grant Warehouse access outside it, and Warehouse scope does not grant Location-wide sale authority).

In short: **Location → its own linked Warehouse is an automatic, derived Scope; any other Warehouse relationship requires an explicit Scope.** This keeps the common case (a store clerk selling from their own store's stock) ergonomic without collapsing the Location/Warehouse distinction the Blueprint requires.

### 5. Location closure does not close its Warehouse automatically (`BR-LOC-205`)

Closing a Location does not implicitly close or orphan a centralized Warehouse it happened to use — Warehouse closure/liquidation is its own decision, with its own preconditions (`BR-WHS-203`: open stock, reservations, transfers in transit, open counts, pending receipts must be resolved first).

## Alternatives Considered

1. **Merge Location and Warehouse into one entity (status quo, generalized).** Rejected: cannot express centralized-warehouse or multi-warehouse-per-Location cases the Business Rules explicitly require (`BR-WHS-201`); would need to be re-split later at higher migration cost.
2. **Location Scope never implies Warehouse access (fully explicit, no default linkage).** Rejected: creates unnecessary friction for the overwhelmingly common single-Location-single-Warehouse cashier/manager case, requiring two grants for what is operationally one job. `BR-WHS-205` explicitly allows default linkage.
3. **Location Scope always implies access to every Warehouse the Tenant owns.** Rejected: violates `BR-SCP-102` directly and would leak inventory visibility across unrelated Locations for any tenant-wide Warehouse.

## Consequences

- WP-005 Phase B creates `Location` (from `Branch`) and a default `Warehouse` per Location in the same migration step (MT-MIG-002), satisfying Decision items 2–3.
- WP-006's permission/scope evaluator must implement the derived-Scope rule in Decision item 4 exactly: computing "Location Scope ⇒ + linked Warehouse Scope" as one of its scope-expansion rules, and must have a regression test proving a Location-scoped Cashier can consume that Location's linked Warehouse stock without an explicit Warehouse grant, while a Location-scoped Cashier at Location X cannot see Warehouse stock centralized to Location Y.
- `OD-TEN-006` is no longer open after this ADR is Accepted; any future change to this rule requires an ADR superseding this one.

## Security / Data / Operational Impact

Getting the derived-Scope rule wrong in either direction is a real security/data-leak risk: too permissive leaks cross-Location inventory visibility (violates `BR-MLC-104`); too restrictive breaks the basic cashier workflow. WP-006/WP-007 must include the specific dual-direction test named above.

## Compatibility and Migration

MT-MIG-002 (WP-005 Phase B) implements Decision items 1–3. Decision item 4 is a permission-model rule consumed by WP-006's authorization work, not by WP-005 Phase B's schema/migration itself.

## Validation / Acceptance

- [ ] Osama has reviewed and set this file's `Status:` to `Accepted`.
- [ ] WP-005 Phase B's Location/Warehouse migration is traceable to Decision items 1–3.
- [ ] WP-006's scope evaluator design explicitly implements Decision item 4, including the dual-direction test.

## Review or Expiry

Review if a real customer scenario needs a different default-linkage behavior (e.g. a role that should see its Location but explicitly not its own linked Warehouse). No fixed expiry.
