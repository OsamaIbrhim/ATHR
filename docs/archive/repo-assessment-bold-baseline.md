# ATHR Current Repository Assessment — Bold Baseline 2026-07-29

**Authoritative assessment prepared before Work mode execution**

## 1. Repository Baseline

- Repository: `OsamaIbrhim/bold_system`.
- Default branch: `master`.
- Current stack:
    - Backend: NestJS 11 + TypeScript + Prisma + PostgreSQL.
    - Admin: Next.js 15 + React + React Query.
    - POS: Electron + React + `sql.js` local database.
    - CI: GitHub Actions with soft, migration, E2E smoke, hard-smoke and scheduled load gates.
    - Deployment: Railway API, Vercel Admin, Supabase PostgreSQL.
    - Release: GitHub Release workflow for the Windows POS installer and updater manifest.

## 2. Evidence Reviewed

- `package.json` root test orchestration.
- `backend/package.json`.
- `backend/prisma/schema.prisma`.
- `backend/src/app.module.ts`.
- `backend/src/main.ts`.
- `backend/src/auth/roles.guard.ts`.
- `backend/src/auth/permissions.ts`.
- `backend/src/sales/sales.controller.ts`.
- `backend/src/sales/sales.service.ts`.
- `backend/src/sync/sync.controller.ts`.
- `backend/src/sync/sync.service.ts`.
- `pos-electron/package.json`.
- `pos-electron/electron/main.ts`.
- `admin-web/package.json`.
- `.github/workflows/ci.yml`.
- POS release commit `6f4002ac79de8731cc58bce435093859e7ec19f7`.
- Open PR `#42` and its failed hard-smoke run.

## 3. What Must Be Preserved

### Architecture

- Modular Monolith as the first ATHR production architecture.
- NestJS module boundaries as an implementation starting point.
- One PostgreSQL source of truth.
- Prisma migration history and migration policy gate.
- Separate Admin and Electron clients.
- Offline local transaction + outbox principle.
- Server-side repricing and invariant enforcement.

### Reliability Assets

- Idempotent sales through stable operation identity.
- Inventory movement and cost ledgers.
- Transactional sales, purchasing, returns, transfers and shifts.
- Device enrollment, revocation, heartbeat and updater pipeline.
- Soft, migration, E2E and hard-performance gates.
- Forward-only migration validation.
- Request IDs, structured API errors and performance timing.

## 4. What Must Be Replaced or Generalized

### Single-business Root

Current truth is rooted in:

- `Branch` as the top operational owner.
- One global user record with one optional `branch_id`.
- Fixed Prisma `Role` enum.
- Global product, supplier, customer and document uniqueness.

ATHR requires:

- Tenant.
- Organization / Legal Entity.
- Location and Warehouse.
- Membership and scoped assignments.
- Permission keys and constraints rather than Domain logic based on role names.
- Tenant-safe uniqueness and queries.

### Bold-specific Product Identity

Must be converted:

- Package names and descriptions.
- Swagger title and system messages.
- Electron `appId`, product name, installer artifact and shortcut.
- Local filename `bold_pos.sqlite`.
- Hard-coded Railway API URL.
- GitHub release tags, titles, manifest paths and artifact names.
- Admin and POS visible branding.

### Current Sync Limitations

Current sync:

- Pulls a full first snapshot in one response.
- Uses an exposed integer cursor.
- Stores a minimal `SyncChange` row.
- Has `POST /sync/push` disabled.
- Uploads sales through a dedicated endpoint.
- Does not have a structured conflict resource or generic operation result ledger.

ATHR requires the approved bootstrap, snapshot manifest, opaque cursor, operation batch, deduplication, conflict and recovery contracts.

### POS Technical Debt

`pos-electron/electron/main.ts` currently owns too many responsibilities:

- Local database schema and migrations.
- Authentication and refresh.
- Offline login.
- API client.
- Sync.
- Sale persistence.
- Printing.
- Enrollment.
- Diagnostics and IPC.

ATHR must split these into testable modules while preserving behavior.

### Data Representation Risks

- Cloud money uses PostgreSQL Decimal, which is reusable.
- POS tables still contain `REAL` money fields.
- Several business states are free-form strings.
- Some uniqueness constraints are global rather than tenant-scoped.
- Audit storage is minimal compared with the approved Audit Catalog.

## 5. Current Baseline Problems Before Transformation

### Open PR #42

PR `fix/p0-negative-stock-sync` contains an important deterministic negative-stock accounting repair and migration safety improvements.

Its backend, Admin, POS, migration gate and E2E smoke passed. The hard-smoke failed because the test called:

`POST /shifts/undefined/offline-context`

The immediate cause is that the performance flow consumed an open-shift result without proving a valid `shift.id` before creating terminals.

### Deployment Status

- Vercel status on current `master` is successful.
- The Railway status reported on current `master` is failing.
- Therefore the existing hosted demo cannot be treated as the transformation quality gate.

## 6. Reuse Decision

| Area | Decision | Reason |
| --- | --- | --- |
| NestJS backend | KEEP WITH CHANGES | Strong modular base; Domain and tenant boundaries must be redesigned. |
| PostgreSQL + Prisma | KEEP WITH CHANGES | Suitable for ATHR; schema requires tenant-safe migration. |
| Next.js Admin | KEEP WITH CHANGES | Reuse framework and UI foundation; replace navigation, permissions and branding. |
| Electron POS | KEEP WITH MAJOR REFACTOR | Working offline and release assets exist; main process must be modularized. |
| sql.js local store | KEEP TEMPORARILY | Fastest transformation path; abstraction required so storage can change later. |
| Current Branch/Role model | REPLACE | Cannot support ATHR multi-tenancy and scoped membership. |
| Inventory ledgers | KEEP AND GENERALIZE | High-value reliability asset. |
| Current sync implementation | KEEP BEHAVIOR, REPLACE CONTRACT | Offline safety is valuable; protocol is too narrow for ATHR. |
| GitHub CI and POS release | KEEP AND RENAME | Already valuable and production-oriented. |
| Railway/Vercel/Supabase | KEEP FOR DEMO | Reuse existing free deployment until ATHR earns subscription revenue. |

## 7. Correct Starting Point

Work mode must **not** begin with random feature work or a full rewrite.

It begins with:

### WP-000 — Transformation Baseline

1. Create `feat/athr-transformation` from PR #42 head `ba2af73ff35a5b4ad2c4ab9005d3a016f895fd22` so the deterministic inventory repair is retained.
2. Fix the hard-smoke `undefined shift` failure.
3. Run all release gates until green.
4. Preserve the existing deployment while the branch is unstable.
5. Record the verified baseline commit in the ATHR delivery log.

### WP-001 — ATHR Product Identity and Configuration

After WP-000:

1. Convert all product/package/API/Admin/POS/release identity from Bold to ATHR.
2. Remove the hard-coded Railway URL and use validated environment/enrollment configuration.
3. Rename installer, app ID, release tags, manifest metadata and visible product text.
4. Add compatibility migration for existing local Bold POS state only when it is safe and useful for the demo.
5. Keep CI green.

### WP-002 — Shared Foundation

After identity conversion:

1. Add shared contracts and value objects.
2. Centralize error registry.
3. Create tenant-context and authorization abstractions without yet performing the full database migration.
4. Split POS main-process infrastructure into modules behind unchanged behavior.

The full Tenant/Database transformation begins only when the relevant Database Blueprint section is marked `Ready for Implementation`.

## 8. Final Assessment

The fastest professional route is an **in-place controlled transformation**, not a new repository and not a superficial rename.

Bold is the implementation seed. ATHR is the only target product. Backward compatibility with Bold is not a business requirement, but valuable reliability behavior and data should be preserved until replaced by a stronger ATHR contract.