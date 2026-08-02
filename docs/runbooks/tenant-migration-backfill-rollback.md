# Tenant Migration, Backfill and Rollback Runbook

**Status:** Proposed
**Author:** Claude Code CLI (WP-005 Phase A)
**Requires approval from:** Osama (project owner) before Phase B may begin

- **Date:** 2026-08-02
- **Work package:** WP-005 Phase A (this document); executed in WP-005 Phase B
- **Scope:** MT-MIG-000 through MT-MIG-004 only (Stable Base, Add Tenant Foundation, Branch→Location, User→Identity/Membership, Tenant Backfill), per `ATHR Multi-tenancy Blueprint v1.0` §116. **MT-MIG-005 through MT-MIG-008 (application dual-compatibility, constraint enforcement, POS enrollment cutover, legacy removal) are explicitly out of scope for this runbook and for WP-005 — they belong to WP-006/WP-007.**
- **Governs:** the live-shaped Railway/Supabase database, not a toy dataset. Every step below assumes real production-shaped data may be present.
- **Depends on:** `docs/adr/0002-tenant-data-ownership.md` through `docs/adr/0006-platform-boundary.md`, all `Accepted`, before any step in this runbook is executed against a real branch.

## 0. Non-negotiable ground rules

1. **Forward-only.** Per `ATHR Coding Standards v1.0` §19 and `ATHR Git and Branching Strategy v1.0` §18/§21: applied migrations are immutable. If a step fails after a prior migration in this sequence has already been applied, the recovery is always a **new forward migration**, never editing or deleting an applied one, never `prisma migrate resolve --rolled-back` unless Prisma's own migration-history bookkeeping (not the schema itself) is provably inconsistent — and even then, only after the same investigation discipline used in the WP-001 P3009 incident (`docs/ATHR Work Mode Delivery Log`, "WP-000 / WP-001 Deployment Recovery — RCA").
2. **Expand-only in this runbook's scope.** Every migration described here only adds tables/columns or backfills nullable columns. Nothing in MT-MIG-000–004 drops, renames, or type-changes an existing production column, makes anything `NOT NULL`, or adds a constraint that could reject an existing row. That is MT-MIG-006 (WP-007) territory.
3. **Fail loud, never guess.** Any row this runbook cannot unambiguously assign to the Initial ATHR Demo Tenant, a Location, or a Membership stops the migration with a specific, itemized list of offending row IDs. No default-assignment, no "assign to tenant 1 and move on."
4. **Single guarded migration runner only.** All `prisma migrate deploy` execution against Railway/Supabase goes through `backend/scripts/prisma-migrate-deploy.cjs` (`npm run prisma:migrate:deploy` from `backend/`). Never run raw `npx prisma migrate deploy` against a real environment — the guarded runner is what enforces `DIRECT_URL` (rejecting the Supabase transaction pooler on port 6543), retries only bounded `P1002` advisory-lock contention, and is the single source of truth for "did this actually apply." This mirrors ADR-0012 (Single Production Migration Runner) in `ATHR ADR Catalog v1.0`.
5. **Every step below is proven twice before touching the real database**: once against a clean, empty PostgreSQL 16 database, and once against a populated database seeded with realistic-*shape* fixtures (not real customer data) — per `ATHR Testing Strategy v1.0` §12 and `ATHR Database Blueprint v1.0` §32 (Migration Quality Gates).
6. **No destructive reset.** Per Multi-tenancy Blueprint §118, a destructive reset of the current Supabase database is not the Baseline path and is only permitted with Osama's explicit, separate decision, on a Demo (not paid-customer) environment, with export/backup taken first. This runbook assumes the forward-migration path throughout; it does not describe a reset procedure because none is authorized by default.

## 1. Pre-migration checklist (do this before creating `feat/wp-005b-tenant-schema`)

1. Confirm all six documents in `docs/adr/0002-*.md` through `docs/adr/0006-*.md` and this file itself show `Status: Accepted`. If even one is `Proposed`, **stop** — do not create the Phase B branch.
2. `git fetch origin && git checkout master && git pull origin master` — confirm clean tree and that `master` includes the merged Phase A ADR docs.
3. Read the current `backend/prisma/schema.prisma` in full again — do not assume the shape described in this runbook is still accurate; Phase B may start weeks after this runbook was written, and other WPs may have touched the schema in the meantime. Reconcile any drift before writing migration SQL.
4. Get actual current row counts for every table this runbook's steps touch, via a **read-only** query against the real database (or the most recent trusted backup/replica-equivalent — do not run ad hoc exploratory writes against production):
   ```sql
   select 'Branch' as table_name, count(*) from "Branch"
   union all select 'User', count(*) from "User"
   union all select 'Product', count(*) from "Product"
   union all select 'ProductVariant', count(*) from "ProductVariant"
   union all select 'Customer', count(*) from "Customer"
   union all select 'PosTerminal', count(*) from "PosTerminal"
   union all select 'SalesInvoice', count(*) from "SalesInvoice"
   -- extend to every table identified as tenant-owned per the Identifier
   -- Classification Matrix and a fresh read of schema.prisma at Phase B time.
   ;
   ```
   Record these counts in the WP-005 Phase B Delivery Log entry before any migration is written — they are the baseline the post-migration invariant checks (§6) are compared against.
5. Read at least 3 existing folder names in `backend/prisma/migrations/` to confirm the naming convention is still `YYYYMMDDNNNN_description` (14-digit date + zero-padded sequence, e.g. `202607290003_inventory_cost_negative_balance`). Do not guess a different format.

## 2. Step-by-step sequence

Each step below is one Prisma migration folder, created with `npm run prisma:migrate --workspace backend -- --name <description> --create-only` (review the generated SQL before applying), following the monotonic timestamp convention. Do not combine steps into one migration — each must be independently reviewable and, if something goes wrong, independently diagnosable.

### Step A — MT-MIG-000: Stable base check (verification only, no new migration)

**What:** Confirm WP-000's negative-stock/accounting fixes are intact on the branch point.

**Commands:**
```bash
cd backend
npm run prisma:migrations:policy
npx prisma migrate status
```

**Success looks like:** `prisma:migrations:policy` reports zero repaired/edited applied migrations; `prisma migrate status` shows the schema up to date against `master`'s existing 31 migrations, including `202607290001_sales_inventory_single_writer`, `202607290002_inventory_movement_negative_balance`, `202607290003_inventory_cost_negative_balance`.

**If it fails:** Stop. This is not new work — if the baseline is not stable, WP-005 Phase B has not actually started from where WP-000/002 said it would; report the discrepancy instead of proceeding.

### Step B — MT-MIG-001: Add Tenant foundation (expand only, additive)

**What:** New tables `Tenant`, `OrganizationProfile`, `LegalEntity`, `Membership` (or the Platform-Identity-layer decision documented per ADR-0003). `Tenant` carries stable ID, full lifecycle/access-mode enum (per Multi-tenancy Blueprint §88 — implement the full state list now even though most states are unreachable until later WPs), organization profile reference, default locale/timezone/currency, timestamps.

**Commands:**
```bash
cd backend
npm run prisma:migrate -- --name add_tenant_foundation --create-only
# review prisma/migrations/<ts>_add_tenant_foundation/migration.sql by hand
npx prisma migrate diff --exit-code --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma
```

**Then seed exactly one Tenant row** ("Initial ATHR Demo Tenant", per Multi-tenancy Blueprint §115) and its primary `LegalEntity`, via a dedicated seed script (`backend/prisma/seed/initial-tenant-seed.ts` or an extension of the existing `prisma/seed.ts` — check which already exists before creating a new one).

**Success looks like:** Migration applies cleanly on an empty database; exactly one `Tenant` row and one `LegalEntity` row exist after seeding; re-running the seed script is idempotent (does not create a second Tenant) per `BR-TPR-100`.

**If it fails:** If the migration SQL itself fails to apply (syntax/constraint error), fix the migration file and re-run `--create-only` generation — since nothing has been applied yet in a fresh attempt, this is safe to iterate on locally. If the seed step fails after the migration already applied, the migration itself is not rolled back (rule §0.1); fix the seed script and re-run it — do not re-run the migration.

### Step C — MT-MIG-002: Branch to Location

**What:** Add `Location` table. Every existing `Branch` row becomes a `Location` row owned by the Initial ATHR Demo Tenant, preserving the original `Branch.id` as `Location.id` (UUID type is compatible — no mapping table needed unless Phase B's actual implementation finds otherwise). Add a default `Warehouse` per Location per `BR-WHS-202` (see ADR-0004).

**Pre-migration validation query** (run before writing the backfill, to know what you're dealing with):
```sql
select id, code, name_ar, name_en, is_active
from "Branch"
order by created_at;
```

**Commands:**
```bash
cd backend
npm run prisma:migrate -- --name add_location_from_branch --create-only
# migration.sql must: create Location + Warehouse tables, then INSERT INTO
# "Location" SELECT ... FROM "Branch" (preserving id), then INSERT INTO
# "Warehouse" one default row per new Location.
```

**Post-step validation query** (must return zero rows before proceeding to Step D):
```sql
select b.id, b.code
from "Branch" b
left join "Location" l on l.id = b.id
where l.id is null;
```
```sql
select l.id
from "Location" l
left join "Warehouse" w on w.location_id = l.id
where w.id is null;
```

**Success looks like:** Both validation queries above return zero rows. `count(*) from "Branch"` equals `count(*) from "Location"`. Every Location has exactly one default Warehouse.

**If it fails:** If the first query returns rows, the backfill INSERT did not cover every Branch — do not proceed to Step D; fix the migration's SELECT/INSERT and re-test against a fresh clean+populated pair. Never manually INSERT the missing rows outside a migration file.

### Step D — MT-MIG-003: User to Identity and Membership

**What:** Every existing `User` row gets exactly one `Membership` into the Initial ATHR Demo Tenant, with a role mapping from the legacy `Role` enum (`owner`, `branch_manager`, `cashier`, `warehouse_manager`, `seller`) to an equivalent Membership role assignment (per ADR-0003). The legacy `Role` enum and `User.branch_id` column are **not** removed or altered — only read from, to populate the new structures.

**Pre-migration validation query:**
```sql
select id, name, phone, email, role, branch_id, is_active
from "User"
order by created_at;
```
Specifically check for the edge cases the backfill must handle: `role` values with no obvious Membership-role equivalent (should not exist given the fixed 5-value enum, but verify), and `branch_id is null` rows (these still get a Membership — Membership is independent of Location/Scope assignment; a null `branch_id` just means no default Location-scoped Role assignment is created for that Membership in this step).

**Commands:**
```bash
cd backend
npm run prisma:migrate -- --name add_membership_from_user --create-only
# migration.sql must: create Membership (+ Platform Identity layer per the
# ADR-0003 mechanics decision), then INSERT one Membership per User row into
# the Initial ATHR Demo Tenant, with a role-assignment mapping table/case
# expression translating the legacy Role enum value.
```

**Role mapping table to encode in the migration** (document the exact mapping decided in Phase B's PR description and Delivery Log, since the ADR fixes the concept, not the exact target role names):

| Legacy `Role` enum value | Target Membership role (Phase B to confirm exact name) |
| --- | --- |
| `owner` | Tenant Owner |
| `branch_manager` | Location Manager |
| `cashier` | Cashier |
| `warehouse_manager` | Warehouse Manager |
| `seller` | Seller |

**Post-step validation query** (must return zero rows before proceeding to Step E):
```sql
select u.id, u.name
from "User" u
left join "Membership" m on m."identityId" = u.id and m."tenantId" = '<initial-tenant-id>'
where m.id is null;
```

**Success looks like:** `count(*) from "User"` equals the count of Memberships into the Initial ATHR Demo Tenant. Every Membership has exactly one role assignment traceable to the mapping table above.

**If it fails:** Same discipline as Step C — do not proceed, do not hand-patch rows outside a migration, fix the migration and re-test clean+populated.

### Step E — MT-MIG-004: Tenant backfill

**What:** Add `tenant_id` as **nullable** to every table identified as tenant-owned per the Identifier Classification Matrix (`Code Gap Analysis — 2026-07-29`) and a fresh, complete read of `schema.prisma` at Phase B time — the illustrative list (`Branch`/`Location`, `User`, `Product`, `ProductVariant`, `Customer`, `PosTerminal`, `SalesInvoice`, and every other business-data table) is a starting point, not the final list. Backfill every row to the Initial ATHR Demo Tenant's ID. **Do not** make `tenant_id` `NOT NULL` or add composite FKs/tenant-scoped uniqueness — that is MT-MIG-006 (WP-007).

**Pre-migration ambiguous-row validation script** (`backend/scripts/validate-tenant-backfill.cjs`, per the WP-005 document's indicative file list): this script must run **before** the backfill migration is applied and report, per table, any row that cannot be unambiguously assigned to a single Tenant via its ownership chain (e.g. a `SalesInvoice` whose `branch_id` does not resolve to any `Location`, or an orphaned row with no ownership chain at all). Given the current single-tenant dataset, "unambiguous" in practice means "resolves to the Initial ATHR Demo Tenant via Location/owner chain, or has no chain and is unconditionally assigned to the Initial ATHR Demo Tenant as the only Tenant that exists" — but the script must still explicitly enumerate and report every row it assigns this way, not silently pass.

Example shape of the query the script runs per table (adapt per table's actual ownership chain):
```sql
-- Example for SalesInvoice: every row must resolve to exactly one tenant
-- via its branch_id -> Location -> tenant_id chain.
select si.id, si.invoice_number, si.branch_id
from "SalesInvoice" si
left join "Location" l on l.id = si.branch_id
where l.id is null or l."tenantId" is null;
```
Any row returned by a query shaped like this is a **hard stop** — the script must exit non-zero and print the exact offending IDs, not a count.

**Commands:**
```bash
cd backend
node scripts/validate-tenant-backfill.cjs   # must exit 0 with zero ambiguous rows
npm run prisma:migrate -- --name add_nullable_tenant_id_backfill --create-only
# migration.sql: ALTER TABLE ... ADD COLUMN tenant_id uuid NULL for every
# identified table, then UPDATE ... SET tenant_id = '<initial-tenant-id>'
# (or via the resolved ownership chain where one exists), scoped per table.
node scripts/validate-tenant-backfill.cjs --post-check  # re-run to confirm zero NULLs remain
```

**Post-step validation query** (run per tenant-owned table; must return zero rows for every one before Step E is considered done):
```sql
select id from "<table>" where tenant_id is null;
```

**Success looks like:** `validate-tenant-backfill.cjs` (and its dedicated test `validate-tenant-backfill.test.cjs`) both pass; zero rows with `tenant_id is null` remain in any tenant-owned table; row counts before and after backfill match exactly per table (compare against §1 step 4's recorded baseline).

**If it fails:** This is the step most likely to surface real data problems (an orphaned `SalesInvoice`, a `Customer` with no resolvable chain). **Do not** assign such a row to the Initial ATHR Demo Tenant just to make the count match — per `BR-TERR-100` and MT-MIG-004's own rule, report the exact row IDs to Osama and stop. Resolving the ambiguity is a data decision, not a migration-engineering one.

## 3. What "the migration is done" means (Definition of Done for this runbook's scope)

All of the following must be true — this is the same list as the WP-005 document's §B.9, restated here as the runbook's own completion gate:

1. `Tenant`, `OrganizationProfile`, `LegalEntity`, `Location`, `Warehouse`, `Membership` tables exist, additive only.
2. Exactly one `Tenant` seeded: Initial ATHR Demo Tenant.
3. Every existing `Branch` row has exactly one corresponding `Location` row, ID-preserved.
4. Every selling Location has a resolvable default Warehouse.
5. Every existing `User` row has exactly one Membership into the Initial ATHR Demo Tenant, with a role mapping from the legacy `Role` enum.
6. `tenant_id` added as nullable to every tenant-owned table; every row backfilled; zero orphaned/ambiguous rows remain (proven by the validator, not assumed).
7. Legacy `Role` enum, `branch_id` columns, and any old global-uniqueness constraints are untouched — still present, still working.
8. No `tenant_id` column is `NOT NULL`; no composite FKs or tenant-scoped uniqueness added yet.
9. No application code (Backend/Admin/POS) changed.

## 4. Migration gate (must pass for every step above, per `ATHR Testing Strategy v1.0` §12 and `ATHR Database Blueprint v1.0` §32)

For each migration folder created in §2, run the full gate before moving to the next step:

1. **Policy check:** `npm run prisma:migrations:policy` — applied migrations remain untouched.
2. **Clean deploy:** apply from an empty PostgreSQL 16 database via `npm run prisma:migrate:deploy`.
3. **Repeat-deploy idempotence:** run `npm run prisma:migrate:deploy` a second time immediately after — must be a no-op, `prisma migrate status` reports up to date.
4. **Populated upgrade:** build a database matching the pre-Phase-B release baseline with realistic-shape fixtures (a `Branch` with no `code`... — note: `Branch.code` is `@unique` and not nullable in the current schema, so construct fixtures against columns that actually are nullable today, e.g. a `User` with `branch_id = null`, a `PurchaseInvoice` with `invoice_number = null`, duplicate-looking `Customer.phone` values before normalization — check the live `schema.prisma` for exactly which columns are nullable at Phase B time rather than assuming this list), then apply the new migration on top.
5. **Schema drift check:** `npx prisma migrate diff --exit-code` on both the clean and populated paths — zero drift.
6. **Data-invariant validation:** the specific post-step validation queries in §2 for that step, plus the row-count comparison against §1 step 4's baseline.
7. **Backend regression:** `npm run test:soft` for Backend must still pass unchanged after every step (no application code is touched in this runbook's scope, so this is a pure regression check, not a new-behavior check).
8. **Docker/runtime proof** (per WP-005 §0.3's hardened rule, itself in response to the WP-003/WP-004 incidents in the Delivery Log): a clean `npm ci` at repo root still produces a working Backend build and a working Docker image (`docker build` + `docker run` + `GET /api/v1/health/ready`) — verify even though a schema-only change is not expected to affect this, because `prisma generate` output is consumed by more than one build target.

Record the result of every one of these against every migration folder in the WP-005 Phase B Delivery Log entry — not a summary claim, the actual command output/evidence, per the Delivery Log's own operating rule ("Include actual test results, not claims").

## 5. Failure handling and forward-fix policy

- **A migration fails to apply on a clean database:** nothing has touched production; fix the migration file (it has not been applied anywhere yet) and re-run `--create-only` generation. This is the cheap, safe case.
- **A migration applies cleanly but a post-step validation query finds unexpected rows:** the migration *schema change* stays (per §0.1, forward-only) but do not proceed to the next step. Write a new, additional forward migration that corrects the data (e.g. a second UPDATE statement with corrected logic), test it through the full gate in §4, and only then continue.
- **The ambiguous-row validator (Step E) finds rows it cannot resolve:** stop entirely. This is a Stop Condition per the WP-005 document (§B.12): report the exact rows to Osama and wait for a data decision. Do not pick an assignment to make the migration "succeed."
- **A migration partially applies against the real Railway/Supabase database** (connection drop, timeout mid-transaction): Prisma migrations run inside a transaction per migration file by default; a partial apply should roll back automatically. Confirm via `prisma migrate status` before taking any action. If Prisma's own migration-history table disagrees with the actual schema state (the WP-001 P3009 class of problem), follow the same evidence-gathering discipline as that incident — inspect `_prisma_migrations`, `pg_stat_activity`, and `pg_locks` directly, and do not run `prisma migrate resolve` until the actual state (not the error message) is understood. Record findings in the Delivery Log the same way that incident was recorded.
- **Rollback is never "backward."** Per Coding Standards §19 and Git/Branching Strategy §21/§18: there is no down-migration path in this project's policy. Every recovery from a bad migration is a new, forward, corrective migration. This applies even during WP-005 Phase B's own development iteration once a migration has been applied to any shared environment (CI's populated-upgrade database counts as "applied" for this purpose only in the sense that you should still prefer fixing forward rather than deleting the migration folder once others may have pulled the branch — deleting an unpushed local-only migration folder before anyone else has seen it is fine).

## 6. Explicitly out of scope for this runbook

Per the WP-005 document's Phase B scope boundary, this runbook does **not** cover, and Phase B must not implement:

- MT-MIG-005 (application dual-compatibility / `TenantContext` introduction) — WP-006.
- MT-MIG-006 (`tenant_id NOT NULL`, composite FKs, tenant-scoped uniqueness, removing old global-unique constraints) — WP-007.
- MT-MIG-007 (POS enrollment cutover) — WP-006/WP-007.
- MT-MIG-008 (removing legacy `Role` enum / `branch_id` / old routes) — later WP, after a proven rollback window.
- Row-Level Security activation (`OD-MT-001`) — deferred pending a separate Prisma/Supabase-pooler proof spike, not part of any MT-MIG step in this runbook.
