# WP-007 — Tenant Context Enforcement

**Repository:** `OsamaIbrhim/bold_system`
**Base branch:** `master`
**This is the highest-risk WP so far.** It touches every existing production module, adds hard database constraints on live data, and eventually removes legacy columns. It runs as **four sequential phases, each on its own branch**, each requiring the previous phase to be merged, deployed, and verified in production before the next one starts. Do not collapse phases. Do not skip the production-verification gate between phases.
**Depends on:** WP-005 (Phases A+B) and WP-006, both merged and deployed and health-verified.
**Blocks:** every domain WP from WP-008 onward — none of them can safely assume tenant isolation actually works until this closes.

---

## 0. Mandatory Pre-Flight — Every Session, Every Phase

1. Read `docs/wp/WP-005-tenant-organization-location-schema.md`, `docs/wp/WP-006-identity-membership-permission-model.md`, and the 6 accepted ADRs (`docs/adr/0002` through `0006`, `docs/runbooks/tenant-migration-backfill-rollback.md`) in full.
2. Confirm WP-006 is merged to `master` and Railway `/api/v1/health/ready` was confirmed `ok` after that deploy (see Delivery Log entry `WP-006 — ... — Passed`).
3. Read `docs/03-architecture/multi-tenancy-blueprint.md` §116 again — this WP implements **MT-MIG-005 through MT-MIG-008**, the remainder of the sequence WP-005 deliberately left undone.
4. Read `docs/02-contracts/permission-matrix.md` in full — you have not read this yet in any prior WP and Phase A depends on it directly for wiring the permission evaluator to real endpoints.
5. Read the current `backend/prisma/schema.prisma` in full and list every table that currently has a nullable `tenant_id` (from WP-005 Phase B's backfill) — this is your definitive scope list for Phase B's constraint work, not the illustrative examples in this document.
6. **Re-apply the standing hardened rule**: every phase's acceptance criteria include proving a clean `npm ci` across backend/admin/pos-electron plus a real `docker build`/`docker run`/`GET /api/v1/health/ready` — done in CI is acceptable evidence (per WP-006's precedent), but it must actually run and be reported, never assumed.
7. **Standing rule from prior WPs, repeated because this WP is the most likely to tempt a shortcut:** never treat an unavailable local verification step as a pass. If Docker or a throwaway Postgres isn't available locally, say so explicitly and rely on CI's isolated services for that gate — do not substitute silence for evidence, and never point a destructive reset/seed command at the shared Supabase dev database.
8. **Do not author any documentation, ADR, or Delivery Log entry in this session.** Report facts (row counts, test results, endpoints changed, PR links) in the PR description only. The planning layer writes the Delivery Log entry from your factual report, same as WP-005/WP-006.

---

# PHASE A — Application-Wide TenantContext Enforcement (MT-MIG-005)

## A.1 Objective

Wire the TenantContext resolver from WP-006 as a **global** guard, and retrofit every existing module's repositories and services to be tenant-scoped. `tenant_id` stays nullable in the database throughout this phase — this is purely an application-layer change. When this phase is done, every request is provably tenant-scoped in application code, but the database does not yet enforce it.

## A.2 Branch

`feat/wp-007a-tenant-context-enforcement` from `master`.

## A.3 Scope In

1. Wire `TenantContextMiddleware`/guard globally in `backend/src/main.ts` or `app.module.ts` (whichever the current auth wiring pattern uses — read it first, don't guess).
2. Retrofit every existing repository/service in `backend/src/{sales,inventory,purchasing,transfers,customers,products,pricing,offers,suppliers,terminals,shifts,sellers,reports,notifications,sync,updates,branches,users}` to accept `TenantContext` explicitly and filter every query by `tenant_id`. Follow the same `findById(context, id)` / `list(context, filters)` / `save(context, aggregate)` pattern established in WP-006's new identity module — no bare `findById(id)` should remain anywhere in the codebase after this phase.
3. Every existing endpoint's controller must resolve and pass `TenantContext` through to its service layer. Do not change response shapes or existing endpoint contracts beyond what tenant-scoping requires — this phase is about isolation, not new features.
4. Since `tenant_id` is still nullable, every retrofitted query must handle the WP-005-backfilled state correctly: all existing rows already belong to the Initial ATHR Demo Tenant, so scoping by the caller's resolved tenant should be transparent for today's single-tenant reality, but the code path must be genuinely tenant-aware, not hardcoded to the demo tenant's ID.
5. Wire the permission evaluator from WP-006 (system roles + allow-only policy + access scope) into real authorization checks on these retrofitted endpoints, per `ATHR Permission Matrix v1.0`. **Correction from Phase A execution:** the Matrix defines permission keys and role templates but explicitly does not bind them to concrete endpoints (§21, §62, §93), and the API Contract doesn't either — so the role→permission→endpoint mapping is necessarily derived by whoever implements this step, not quoted verbatim from a source document. Record that derivation explicitly in the PR description as original mapping work, not a transcription, so it gets real review.
6. Add the cross-tenant isolation test catalog from Multi-tenancy Blueprint §119/§120/§122 ("Membership A does not grant B", scope-boundary and repository tests — corrected citation; §127 is Support Access Tests, a different catalog for a later phase) — at minimum one deliberate two-tenant test per retrofitted module proving a second tenant's data is genuinely unreachable through the existing endpoints. This requires seeding a second, throwaway test tenant in the test suite (not in production) — the Initial ATHR Demo Tenant remains the only real tenant.

## A.4 Scope Out

- No `NOT NULL` on `tenant_id`, no composite FKs, no tenant-scoped uniqueness — Phase B.
- No POS enrollment/terminal binding changes — Phase C.
- No removal of legacy `Role` enum or `branch_id` — Phase D.
- No new business features or endpoint changes beyond tenant-scoping and authorization wiring.
- No RLS.

## A.5 Testing Requirements

- Full existing regression suite for every retrofitted module must still pass unchanged in behavior for the single-tenant case.
- New cross-tenant isolation tests per A.3.6, one per retrofitted module minimum.
- Dual-compatibility check: confirm no existing Admin/POS client behavior changes for today's single-tenant reality — this phase must be invisible to current users.
- Hardened multi-consumer build proof per §0.6.

## A.6 Acceptance Criteria

- [ ] Every repository method in every retrofitted module takes `TenantContext` explicitly.
- [ ] Global TenantContext guard wired; every endpoint resolves it.
- [ ] Permission evaluator wired to real endpoints per the Permission Matrix.
- [ ] Cross-tenant isolation tests exist and pass for every retrofitted module.
- [ ] Zero behavior change for today's single-tenant production reality (full regression green).
- [ ] `tenant_id` still nullable everywhere; no DB constraint changes.
- [ ] Clean `npm ci` + backend/admin/POS builds + Docker build/run/health all verified.

## A.7 Branch/PR and Stop Condition

One PR, `WP-007 Phase A: Application-Wide Tenant Context Enforcement`. Merge, deploy, and get Railway health confirmed **before** starting Phase B — this is a hard gate, not a suggestion, given the size of the surface this phase touches.

---

# PHASE B — Hard Database Constraints (MT-MIG-006)

## B.1 Objective

Now that the application is provably tenant-aware (Phase A merged and verified in production with zero incidents), make the database itself enforce isolation: `tenant_id NOT NULL`, composite same-tenant foreign keys, and tenant-scoped uniqueness replacing the old global-unique constraints, per ADR-0002 Decision item 5 (defense in depth) and Consequences.

## B.2 Pre-condition Check

Confirm Phase A's PR is merged, deployed, and Railway health-verified, and that Phase A's cross-tenant isolation tests have been running green in CI for every commit since merge (i.e., not just passed once and then silently regressed). If Phase A shows any regression, stop and report back — do not start Phase B on a shaky Phase A.

## B.3 Branch

`feat/wp-007b-tenant-constraints` from `master`.

## B.4 Scope In

1. For every table identified in Pre-Flight step 5: `ALTER TABLE ... ALTER COLUMN tenant_id SET NOT NULL`. This is safe now because WP-005 Phase B already backfilled every row and Phase A proved the application never leaves `tenant_id` unset on new writes.
2. Add composite same-tenant foreign keys per the Multi-tenancy Blueprint pattern: `UNIQUE (tenant_id, id)` on the parent plus `FOREIGN KEY (tenant_id, x_id) REFERENCES x(tenant_id, id)` on the child, for every parent/child relationship among tenant-owned tables (`Product`→`ProductVariant`, `Location`→`Warehouse`, `SalesInvoice`→its lines, etc. — derive the full list from the actual schema, not from this illustrative set).
3. Replace the old global-unique constraints identified in ADR-0002 Consequences (`Product.sku_base`, `ProductVariant.sku`/`barcode`, `Customer.phone`, `PosTerminal.terminal_code`, `SalesInvoice.invoice_number`, and any others found in the actual schema) with tenant-scoped unique constraints (`UNIQUE (tenant_id, sku_base)` etc.).
4. Each constraint addition is its own migration, tested twice (clean + populated) per the established discipline, with a pre-migration validation query proving zero rows would violate the new constraint before applying it.

## B.5 Scope Out

- No POS enrollment changes — Phase C.
- No legacy column removal — Phase D.
- No RLS.

## B.6 Testing Requirements

- Migration gate in full for every constraint migration.
- A dedicated test per constraint proving the database itself (not just application code) rejects a cross-tenant foreign key reference and a duplicate value within the same tenant scope.
- Full regression suite green — a wrong constraint here fails loudly (a legitimate write gets rejected), which is exactly why Phase A must already be solid.

## B.7 Acceptance Criteria

- [ ] Every tenant-owned table's `tenant_id` is `NOT NULL`.
- [ ] Every parent/child relationship among tenant-owned tables has a composite same-tenant foreign key.
- [ ] Every previously-global-unique column is now tenant-scoped-unique.
- [ ] Database-level rejection tests pass for both violation classes.
- [ ] Full regression green; zero production incidents from Phase A carried into this phase.
- [ ] Hardened multi-consumer build proof.

## B.8 Branch/PR and Stop Condition

One PR, `WP-007 Phase B: Hard Tenant Database Constraints`, flagged `[TOUCHES PRODUCTION SCHEMA]` in the title. Merge, deploy, verify Railway health, **and** run the full cross-tenant test catalog against production-shaped data once more before Phase C.

---

# PHASE C — POS Enrollment Cutover (MT-MIG-007)

## C.1 Objective

Bind POS terminal enrollment explicitly to a Tenant, replacing whatever implicit single-tenant assumption the current enrollment flow makes.

## C.2 Branch

`feat/wp-007c-pos-enrollment-cutover` from `master`.

## C.3 Scope In

1. Read the current POS enrollment flow (`backend/src/terminals/`, `pos-electron/electron/` enrollment-related files) before writing anything.
2. Extend enrollment to require and record a `tenant_id` on the `Terminal` record and in the POS local state, consistent with `BR-TRM-101`/`BR-ENR-102` (Terminal mapped to Tenant/Location/Scope at enrollment).
3. Update the offline/sync protocol handshake so a terminal's sync requests are always evaluated against its enrolled Tenant — read `ATHR Sync Protocol v1.0` and `ATHR Offline Protocol v1.0` §"Device Sync Identity" sections before changing anything here, since this is a protocol contract, not just a schema change.
4. Existing enrolled terminals (today's production POS installs) must continue working without re-enrollment — this phase must include a migration path that assigns today's terminals to the Initial ATHR Demo Tenant automatically, not a breaking change requiring every cashier to re-enroll their device.

## C.4 Scope Out

- No legacy column removal — Phase D.
- No POS UI changes beyond what enrollment identity requires.

## C.5 Testing Requirements

- Full POS build/test suite plus a dedicated test proving an existing enrolled terminal keeps working post-migration with zero re-enrollment.
- A test proving a terminal enrolled under one tenant cannot sync data belonging to another.

## C.6 Acceptance Criteria

- [ ] Every terminal record carries an explicit `tenant_id`.
- [ ] Sync/offline protocol validates tenant identity on every exchange.
- [ ] Zero disruption to currently-enrolled production terminals.
- [ ] Hardened multi-consumer build proof, with particular attention to the POS/Electron build and its offline test suite.

## C.7 Branch/PR and Stop Condition

One PR, `WP-007 Phase C: POS Enrollment Tenant Cutover`. Merge, deploy, and get explicit confirmation from Osama that a real POS device still works end-to-end post-deploy (this is the one phase where a live device check matters more than an API health endpoint) before Phase D.

---

# PHASE D — Legacy Removal (MT-MIG-008)

## D.1 Objective

Remove the legacy `Role` enum, `User.branch_id`, and any remaining old global-unique constraints now superseded by Phase B's tenant-scoped ones — the final cleanup step, only after a proven rollback window.

## D.2 Pre-condition Check

This phase does not start automatically after Phase C. **It requires Osama's explicit go-ahead**, given as a separate instruction, confirming enough production bake time has passed on Phases A–C with zero incidents. Do not infer "enough time has passed" — ask.

## D.3 Branch

`feat/wp-007d-legacy-cleanup` from `master`, created only after the explicit go-ahead in D.2.

## D.4 Scope In

1. Confirm nothing in the codebase still reads the legacy `Role` enum or `User.branch_id` (should already be true after Phase A retrofitted every consumer to the new Membership/Role/Scope model) — grep the full codebase, don't assume.
2. Drop the legacy `Role` enum, `User.branch_id` column, and any old global-unique constraints already superseded in Phase B.
3. This is the one migration in the whole WP-005–WP-007 sequence that is genuinely destructive (a real `DROP COLUMN`) — follow the Destructive Reset Policy discipline from the Multi-tenancy Blueprint even though this isn't a full reset: take an explicit backup/export reference point immediately before, and get it recorded in the PR description.

## D.5 Testing Requirements

- Full regression suite green with the legacy structures gone.
- Confirm no lingering reference anywhere (backend, Admin, POS, scripts, seed files) via a full-repo grep as part of the test, not just a manual check.

## D.6 Acceptance Criteria

- [ ] Legacy `Role` enum and `User.branch_id` removed.
- [ ] Old global-unique constraints removed.
- [ ] Zero remaining references anywhere in the codebase.
- [ ] Full regression green; hardened multi-consumer build proof.

## D.7 Branch/PR and Stop Condition

One PR, `WP-007 Phase D: Legacy Column and Constraint Removal — DESTRUCTIVE`, clearly flagged. Requires Osama's direct review and explicit merge approval — do not merge automatically even if all checks pass, given this is the one irreversible step in the entire multi-tenancy migration sequence.

---

## Prohibited Across All Phases

- No phase starts before the previous phase is merged, deployed, and health-verified in production.
- No RLS anywhere in this WP.
- No destructive reset/seed command pointed at the shared Supabase dev database.
- No documentation/ADR/Delivery Log authored by the CLI — facts only, in PR descriptions.
- No treating an unavailable local check as a pass — report it as unverified and rely on CI, or stop and ask.
