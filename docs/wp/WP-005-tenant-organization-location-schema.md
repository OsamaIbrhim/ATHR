# WP-005 — Tenant, Organization and Location Schema

**Repository:** `OsamaIbrhim/bold_system`
**Base branch:** `master`
**This WP has TWO phases on TWO separate branches, with a mandatory human approval gate between them. Do not skip the gate. Do not combine the phases into one branch/PR.**
**Depends on:** WP-000 through WP-004, all merged and verified per `docs/wp/WP-000-to-002-baseline-status.md`, `docs/wp/WP-003-api-and-error-contract-foundation.md`, `docs/wp/WP-004-core-value-objects.md`.
**Blocks:** WP-006, WP-007, and every domain WP from WP-008 onward — none of them can be tenant-aware until this lands.

---

## 0. Mandatory Pre-Flight — Every Session, Both Phases

1. Read `docs/wp/WP-000-to-002-baseline-status.md` and re-verify its §2 markers.
2. Confirm WP-003 and WP-004 are merged (search for `packages/domain-core/src/money.ts`, `backend/src/common/http/athr-exception.filter.ts`; confirm `packages/domain-core/package.json` has **no** dependency on `@athr/contracts`).
3. **Read the hard lesson from WP-003/WP-004 before doing anything:** three separate production/CI failures happened because code that looked correct locally didn't actually resolve or build cleanly for every real consumer (Backend build, Backend Docker runtime, POS/Vite, Admin/Vercel). A fourth failure was a genuine forbidden dependency-direction violation that the workspace checker didn't catch. **Every task in this WP that touches `packages/*` or `backend/prisma/` must be proven against a clean `npm ci` and, where relevant, a real `docker build`/`docker run`, across every consumer that touches it — not just `npm run build` on one machine.** This is now a hard acceptance criterion, not a nice-to-have — see §9.
4. `git fetch origin && git checkout master && git pull origin master`, confirm clean tree.
5. Read in full before writing anything:
   - `backend/prisma/schema.prisma` — the actual current schema. Do not assume table/column names from any planning document; confirm them here. Pay specific attention to the current `Branch`, `User`, `Role` enum, and every model that currently has a `branch_id` or global-unique constraint.
   - `docs/00-product/br-tenant-org-locations-membership.md` in full (Business Rules — read already by the author of this WP doc; you must read it yourself too, it is long and authoritative).
   - `docs/03-architecture/multi-tenancy-blueprint.md` in full, **especially §116 "Migration Sequence" (MT-MIG-000 through MT-MIG-008)** — this WP's Phase B task list below is a direct implementation of that sequence, adapted to this specific WP's scope (MT-MIG-000 through MT-MIG-004; later steps belong to WP-006/WP-007).
   - `docs/01-domain/database-blueprint.md` — sections on Tenant/Organization/Location/Warehouse if present.
   - `docs/01-domain/entity-ownership-matrix.md`.
   - `docs/Code Gap Analysis — 2026-07-29*.md` — §"Stage 2 Entry Gate — Mandatory ADRs" and §"Identifier Classification Matrix". This is the source of the ADR list in Phase A.
   - `docs/04-engineering/adr-catalog.md` — check whether an ADR template/numbering convention already exists; if `docs/adr/0001-npm-workspace-foundation.md` exists (it should, from WP-002), copy its exact format/frontmatter style for consistency.
   - `docs/04-engineering/coding-standards.md` §19 (Database and Migration Code) and `docs/04-engineering/git-branching-strategy.md` §18 (Migration Branch Rules).

---

# PHASE A — Author and Propose the Required ADRs (STOP after this phase)

## A.1 Objective

Draft the six architecture artifacts that `Code Gap Analysis — 2026-07-29` requires be approved before any multi-tenancy schema code is written. This phase produces **documents only** — zero `schema.prisma` changes, zero migrations, zero application code.

## A.2 Branch

Create `docs/wp-005a-tenancy-adrs` from `master`.

## A.3 Required Artifacts

Create these files under `docs/adr/`, following the numbering convention already established by `docs/adr/0001-npm-workspace-foundation.md` (read it first and match its exact structure: Status, Context, Decision, Consequences, or whatever sections it actually uses):

1. `docs/adr/0002-tenant-data-ownership.md` — **Tenant/Data Ownership ADR.** Must resolve, citing the Multi-tenancy Blueprint decisions MT-DEC-001 through MT-DEC-005: shared application + shared PostgreSQL + row-level tenant isolation (not database-per-tenant, not schema-per-tenant); Tenant as the ownership boundary (not Location/Branch/Role); the full hierarchy (Tenant → Organization Profile → Legal Entity → Locations → Warehouses/Terminals); one primary Legal Entity per Tenant for MVP (`OD-TEN-001`, `MT-DEC-002`, §5–§9 of the Multi-tenancy Blueprint).
2. `docs/adr/0003-identity-membership.md` — **Identity/Membership ADR.** Must resolve: Platform Identity (global) vs. Tenant Membership (per-tenant) separation; Membership lifecycle states (`BR-MEM-101`); one Membership per Identity/Tenant pair; last-owner safeguard (`BR-OWN-100`, Multi-tenancy Blueprint §14); allow-only permission model for MVP with explicit deny deferred (`OD-TEN-005`); system roles first, custom roles deferred (`OD-TEN-004`).
3. `docs/adr/0004-location-warehouse.md` — **Location/Warehouse ADR.** Must resolve: Location vs. Warehouse vs. Terminal as distinct entities (`BR-TEN-106`); Warehouse may be Location-linked or centralized (`BR-WHS-201`); every selling Location needs an explicit inventory source (`BR-WHS-202`); Location access does not implicitly grant Warehouse access unless decided otherwise (`OD-TEN-006` — resolve this open decision explicitly, don't leave it open in the ADR).
4. `docs/adr/0005-authorization-entitlements.md` — **Authorization/Entitlements ADR.** Must resolve: Access Scope types (tenant-wide/location/warehouse/terminal, `BR-SCP-100`); explicit Tenant-wide scope is never implied by an empty scope (`BR-SCP-101`); permission vs. entitlement separation is deferred in *implementation* to WP-022 but the *conceptual* boundary must be fixed now so WP-006's permission model doesn't collide with it later.
5. `docs/adr/0006-platform-boundary.md` — **Platform Boundary ADR.** Must resolve: Platform Operator identity is never a standing Tenant Membership (`BR-PLT-100`, `MT §79`); no default access to tenant data; Support Access is grant-based, time-boxed, and audited (`BR-SUPA-100` through `BR-SUPA-105`, `MT §80`–§84); impersonation is never silent (`BR-PLT-103`).
6. `docs/runbooks/tenant-migration-backfill-rollback.md` — **Migration/Backfill/Rollback Runbook.** Must contain the concrete, step-by-step operational procedure for the Phase B migration sequence (MT-MIG-000 through MT-MIG-004 scope only — see Phase B below), written so a human operator could follow it without this WP doc open: exact commands, exact order, what "success" looks like at each step, what to do if a step fails partway, and how to roll forward (never backward — per Coding Standards §19, applied migrations are immutable) if backfill data is found to be ambiguous or incomplete (`MT-MIG-004`: "Fail migration on ambiguous/unassigned rows").

Every ADR file must open with:

```markdown
**Status:** Proposed
**Author:** Claude Code CLI (WP-005 Phase A)
**Requires approval from:** Osama (project owner) before Phase B may begin
```

## A.4 What Phase A Must NOT Do

- No `schema.prisma` edits.
- No new Prisma migration folder.
- No application code changes (Backend, Admin, POS).
- No resolving of any open decision (`OD-TEN-*`, `OD-MT-*`) by silently picking whichever option seems obviously right — every open decision referenced in §A.3 must be explicitly written into the relevant ADR's "Decision" section as a resolved choice with a one-paragraph justification, so Osama is approving a concrete decision, not a menu of options.

## A.5 Phase A Acceptance and Stop

1. Push `docs/wp-005a-tenancy-adrs`, open a PR titled `WP-005 Phase A: Tenant Multi-tenancy ADRs`, containing only the 6 files above plus a PR description summarizing every decision made in each ADR in 2-3 sentences so Osama can review without opening all 6 files if he doesn't want to.
2. **Stop here.** Do not start Phase B in this session or any session until Osama has explicitly confirmed each ADR's `Status:` line has been changed to `Accepted` (he may ask for changes first — treat that as normal review, revise and re-push to the same branch).
3. Append a Delivery Log entry for `WP-005 Phase A` using the standard template, status `Passed` (docs only, no gates affected) or `Blocked` if waiting on review.

---

# PHASE B — Implement the Schema (only after all 6 ADRs are Accepted)

## B.1 Objective

Implement the approved Tenant/Organization/Legal Entity/Location/Warehouse schema against the live-shaped database, following the exact expand → backfill → validate → constrain sequence from `ATHR Multi-tenancy Blueprint v1.0` §116, scoped to steps **MT-MIG-000 through MT-MIG-004 only** (Stable Base, Add Tenant Foundation, Branch→Location, User→Identity/Membership, Tenant Backfill). Steps MT-MIG-005 through MT-MIG-008 (application dual-compatibility, constraint enforcement, POS enrollment cutover, legacy removal) belong to WP-006 and WP-007 — do not implement them here even if it seems convenient.

## B.2 Pre-condition Check (do this before creating the branch)

Read `docs/adr/0002-tenant-data-ownership.md` through `docs/adr/0006-platform-boundary.md` and `docs/runbooks/tenant-migration-backfill-rollback.md`. Confirm every one of them has `Status: Accepted` at the top. **If even one is still `Proposed`, stop immediately and report back — do not proceed with any schema work.**

## B.3 Branch

Create `feat/wp-005b-tenant-schema` from current `master` (which by now includes the merged Phase A ADR docs).

## B.4 Scope

### In scope (MT-MIG-000 → MT-MIG-004)

1. **MT-MIG-000 — Stable base check.** Confirm WP-000's negative-stock/accounting fixes are intact (they should be, as part of `master`) — this is a verification step, not new work.
2. **MT-MIG-001 — Add Tenant foundation (expand only, additive).**
   - New tables: `Tenant`, `OrganizationProfile`, `LegalEntity`, `Membership` (Platform Identity itself may already partially exist as `User` — see B.5 below for how to handle this without a destructive rename).
   - `Tenant` carries: stable ID, lifecycle/access-mode enum (per Multi-tenancy Blueprint §88's full state list — implement the enum now even though most states aren't reachable until WP-022/WP-024; Prisma enums are cheap to define fully up front and expensive to extend later mid-migration), organization profile reference, default locale/timezone/currency, timestamps.
   - Seed exactly one `Tenant` row: `Initial ATHR Demo Tenant` (Multi-tenancy Blueprint §115).
   - Create the primary `LegalEntity` for that tenant.
3. **MT-MIG-002 — Branch to Location.**
   - Add a `Location` table. Every existing `Branch` row becomes a `Location` row owned by the Initial ATHR Demo Tenant. Preserve the original `Branch` primary key values as `Location.id` where the ID type is compatible, or store the original ID in a `legacy_branch_id` mapping column if not — do not silently discard traceability between old and new IDs; the migration validation step must be able to prove every old Branch maps to exactly one new Location.
   - Add a default `Warehouse` per Location (`BR-WHS-202`: every selling Location needs an explicit inventory source) — do not leave any Location without a resolvable inventory source.
4. **MT-MIG-003 — User to Identity and Membership.**
   - Do not destructively rename or drop the existing `User` table. Instead: treat existing `User` rows as the seed for `Membership` records (Platform Identity concept may be introduced as a thin new layer above `User`, or `User` may be repurposed as Platform Identity with `Membership` added alongside — read the current `User` model in `schema.prisma` first and decide which is the smaller, safer expand-only change; document the choice and reasoning in the PR description and the WP-005 Delivery Log entry, since the ADR describes the target shape but not necessarily the exact migration mechanics for this specific existing table).
   - Every existing `User` gets exactly one `Membership` into the Initial ATHR Demo Tenant.
   - Map each legacy `Role` enum value to an equivalent Membership role assignment. Do **not** yet remove the legacy `Role` enum or `branch_id` column — that is MT-MIG-006/008 territory (WP-006/WP-007). This WP only **adds** the new structures and **populates** them; it does not yet **enforce** or **remove** the old ones.
5. **MT-MIG-004 — Tenant backfill.**
   - Add `tenant_id` as **nullable** first to every table identified as tenant-owned per the Identifier Classification Matrix (`Code Gap Analysis` — Branch.code, User.phone/email, Product.sku_base, ProductVariant.sku/barcode, Customer.phone, PosTerminal.device_id/terminal_code, SalesInvoice.invoice_number/sync_id, and every other table owning business data). Read the actual current schema to get the complete, accurate list — do not rely solely on the examples given here, they are illustrative, not exhaustive.
   - Backfill every row to the Initial ATHR Demo Tenant's ID.
   - **Fail the migration explicitly** (do not silently skip or default) if any row cannot be unambiguously assigned — per `BR-TERR-100` and MT-MIG-004's own rule. Write a pre-migration validation query that reports any ambiguous/orphaned rows *before* attempting the backfill, so a failure is diagnosed with a clear list of offending row IDs, not a generic constraint violation.
   - Do **not** yet make `tenant_id` `NOT NULL` or add composite foreign keys/tenant-scoped uniqueness constraints — that is MT-MIG-006, explicitly deferred to WP-007 (Tenant Context Enforcement), because enforcing those constraints requires the application to actually be tenant-aware first (WP-006), which hasn't happened yet. Adding hard constraints before the application can satisfy them would break every existing write path.

### Out of scope (do not implement in this WP)

- `TenantContext` application-level enforcement, guards, or repository scoping — that's WP-007.
- Making `tenant_id` `NOT NULL` or adding composite FKs/tenant-scoped uniqueness — WP-007 (MT-MIG-006).
- Removing the legacy `Role` enum or `branch_id` column — WP-006/WP-007 (MT-MIG-008).
- POS enrollment cutover to tenant/terminal binding — WP-006/WP-007 (MT-MIG-007).
- Any permission/authorization logic — WP-006.
- Row-Level Security (RLS) — explicitly deferred per `OD-MT-001` until proven safe with Prisma/Supabase pooling; not this WP.
- Any Admin/POS UI change.

## B.5 Handling the Existing `User`/`Role`/`Branch` Models Without Breaking Production

This is the highest-risk part of this WP because it touches live production data (the actual Railway/Supabase database, not a toy dataset). Follow this discipline exactly:

1. Every migration is **expand-only** in this WP — new tables and new nullable columns, never a rename, drop, or type change on an existing production column.
2. Before writing the migration, get the actual current row counts for `Branch`, `User`, and every table that will receive a `tenant_id` column, from a read-only query against a **non-destructive** snapshot or Supabase read-replica-equivalent approach documented in the runbook from Phase A — do not run ad hoc exploratory writes against production.
3. Test the full migration sequence twice, per `ATHR Testing Strategy v1.0` §12: once against a clean database (proves the migration is internally consistent), and once against a populated database seeded with a realistic copy of the *shape* of current data (not real customer data) including edge cases the backfill query must handle correctly (a `Branch` with no `code`, a `User` with `branch_id = null`, duplicate-looking rows, etc. — check the actual schema for which columns are nullable today and construct fixtures accordingly).
4. Run `prisma migrate diff --exit-code` on both paths per the existing forward-only policy already enforced by `backend/scripts/prisma-migrate-deploy.cjs` from WP-002 — do not bypass or modify that guarded runner.

## B.6 Files You Will Create (indicative)

```
backend/prisma/migrations/<timestamp>_add_tenant_foundation/migration.sql
backend/prisma/migrations/<timestamp>_add_location_from_branch/migration.sql
backend/prisma/migrations/<timestamp>_add_membership_from_user/migration.sql
backend/prisma/migrations/<timestamp>_add_nullable_tenant_id_backfill/migration.sql
backend/prisma/seed/initial-tenant-seed.ts                (or extend existing seed.ts — check first)
backend/scripts/validate-tenant-backfill.cjs               (pre-migration ambiguous-row reporter, per B.4 step 5)
backend/scripts/validate-tenant-backfill.test.cjs
backend/prisma/migrations/<...>/README.md                  (per-migration human explanation, if the repo's existing migrations follow this pattern — check first)
```

Do not guess exact migration folder naming — read at least 3 existing migration folder names in `backend/prisma/migrations/` first and match the established convention exactly.

## B.7 Files You Will Modify

```
backend/prisma/schema.prisma
```

Do not touch `backend/src/**` application code in this WP (no repositories, no controllers, no services) — this WP is schema-and-backfill only. Do not touch `admin-web/` or `pos-electron/` at all.

## B.8 Testing Requirements

- Migration gate in full per `ATHR Testing Strategy v1.0` §12: policy check, clean deploy, repeat-deploy idempotence, populated upgrade from realistic fixtures, schema drift check, data-invariant validation (every old Branch → exactly one new Location; every old User → exactly one new Membership; every backfilled row has a non-null `tenant_id` pointing at the Initial ATHR Demo Tenant; row counts before/after match exactly for every affected table).
- A dedicated test proving the ambiguous-row detector actually fails the migration (not just warns) when a genuinely unassignable row is present in the fixture.
- Confirm `npm run test:soft` for Backend still passes unchanged (no application code was touched, so this should be a pure regression check).
- **Per §0.3's hardened rule:** confirm a clean `npm ci` at repo root still produces a working Backend build and a working Docker image (`docker build` + `docker run` + `GET /api/v1/health/ready`), even though this WP shouldn't structurally affect that — verify anyway, since a schema change can still break `prisma generate` output consumed elsewhere.

## B.9 Acceptance Criteria (Definition of Done)

- [ ] All 6 ADRs from Phase A show `Status: Accepted` before any Phase B commit was made (verified, not assumed).
- [ ] `Tenant`, `OrganizationProfile`, `LegalEntity`, `Location`, `Warehouse`, `Membership` tables exist, additive only.
- [ ] Exactly one `Tenant` seeded: Initial ATHR Demo Tenant.
- [ ] Every existing `Branch` row has exactly one corresponding `Location` row, traceable via preserved or mapped ID.
- [ ] Every selling Location has a resolvable default Warehouse.
- [ ] Every existing `User` row has exactly one `Membership` into the Initial ATHR Demo Tenant, with a role mapping from the legacy `Role` enum.
- [ ] `tenant_id` added as nullable to every tenant-owned table identified from the actual current schema; every row backfilled; zero orphaned/ambiguous rows remain (proven by the validator, not assumed).
- [ ] Legacy `Role` enum, `branch_id` columns, and any old global-uniqueness constraints are **untouched** — still present, still working, nothing removed yet.
- [ ] No `tenant_id` column is `NOT NULL` yet; no composite FKs or tenant-scoped uniqueness added yet.
- [ ] No application code (Backend/Admin/POS) changed.
- [ ] Full migration gate passes: clean deploy, repeat deploy, populated upgrade, drift check, data-invariant validation.
- [ ] Clean `npm ci` + Backend build + Docker build/run + `/api/v1/health/ready` all verified green.
- [ ] Delivery Log entry appended for `WP-005 Phase B`.

## B.10 Branch, Commit and PR Instructions

Per `ATHR Git and Branching Strategy v1.0` §18 (Migration Branch Rules): migration names monotonic and unique, no editing applied migrations. Branch `feat/wp-005b-tenant-schema` from `master` (post Phase-A-merge). One focused PR titled `WP-005 Phase B: Tenant Schema Foundation`, referencing this document and the 6 accepted ADRs by their exact commit/PR links. PR description must state explicitly: exact row counts migrated for Branch→Location and User→Membership, and confirmation zero rows were left ambiguous. Squash-merge after required checks (including migration gate) pass. **Do not merge without Osama's explicit review given this touches live production data on the next deploy** — flag this PR clearly as "touches production schema" in its title/description.

## B.11 Prohibited in This WP

- No destructive rename/drop/type-change on any existing production column.
- No `NOT NULL` constraint on `tenant_id` yet.
- No composite foreign keys or tenant-scoped uniqueness yet.
- No removal of the legacy `Role` enum, `branch_id`, or old global-unique constraints.
- No application code changes.
- No RLS.
- No silent default-assignment of ambiguous rows — must fail loudly and list them.

## B.12 Stop Conditions

- Any ADR not `Accepted` — stop before creating the branch.
- The pre-migration validator finds ambiguous/unassignable rows in a way the runbook didn't anticipate — stop, report the exact rows, do not guess an assignment.
- Any existing test (Backend, migration gate, hard-smoke) that was passing before this WP starts failing — stop, do not proceed to "fix" it by loosening the failing assertion; root-cause it, since this touches production-shaped data and a loosened assertion here is exactly the kind of shortcut that caused the WP-003/004 incidents.
