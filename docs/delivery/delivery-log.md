# ATHR Work Mode Delivery Log

**Work mode writes implementation results here. Planning documents remain separate.**

## Operating Rules

1. Appendoneentry perWork Package execution attempt.
2. Neverreplaceolderentries.
3. Includeexactbranch andcommitSHA.
4. Includeactualtest results, notclaims.
5. Includeeverymigration andwhetherclean/upgrade gates passed.
6. IncludeRailway/Vercel/Supabase/GitHub Release changes.
7. Includeanydeviation fromATHR plan.
8. Do notincludeSecrets.
9. Failedattempts arelogged asFailed, nothidden.

## Entry Template

### `<WP-ID> — <Title> — <Status>`

- **Started at:**
- **Completed at:**
- **Branch:**
- **Base SHA:**
- **Head SHA:**
- **Status:** `Passed | Failed | Blocked | Partial`

#### Scope Implemented

- 

#### Files Changed

- 

#### Database and Migrations

- Migration names:
- Clean database deploy:
- Populated upgrade:
- Schema drift check:
- Remote database changed:

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Typecheck |  |  |
| Unit/Contract |  |  |
| Backend build |  |  |
| Admin build/tests |  |  |
| POS build/tests |  |  |
| Migration gate |  |  |
| Admin E2E |  |  |
| Hard smoke/load |  |  |
| Release gate |  |  |

#### Deployment and Release

- Railway:
- Vercel:
- Supabase:
- POS release:

#### Findings and Blockers

- 

#### Deviations from Plan

- 

#### Next Recommended Action

- 

---

### `WP-006 — Identity, Membership and Permission Model — Passed`

- **Started at:** 2026-08-03
- **Completed at:** 2026-08-03
- **Branch:** `feat/wp-006-identity-membership-permission` (PR #51)
- **Base SHA:** `3145985b8c11fd1d4b1bce6f62f02a58cbddaf21` (master)
- **Head SHA:** `904aab3` (5 commits: `555bda5` domain-core Membership/Invitation opaque IDs, `f7b2dc7` error-registry identity/membership/permission codes, `4edcf61` identity module implementation, `269a34b` Dockerfile fix, `904aab3` regression test for the Dockerfile fix)
- **Status:** `Passed`

#### Scope Implemented

- TenantContext type and resolution service (NestJS provider, not yet wired as a global guard — per WP-006 §2/§3).
- Membership lifecycle service and endpoints (invite → active → suspended → revoked).
- System roles and allow-only permission policy, seeded per the Business Rules document's role catalog.
- Access Scope assignment; empty scope rejected, never implicit tenant-wide.
- Last-owner safeguard, proven by test.
- Additive session/token claims; dual-compatibility regression test proves old clients still read pre-existing claims unchanged.
- Support Access grant model (creation, time-box, audit fields, expiry).

#### Files Changed

- `packages/domain-core/src/*` — MembershipId/InvitationId opaque IDs.
- `packages/error-registry/src/*` — identity/membership/permission error codes.
- `backend/src/modules/identity/**` — TenantContext resolver, membership/invitation/roles/scope/support-access services, controllers, specs.
- `backend/src/app.module.ts` — registers `IdentityModule`.
- `backend/Dockerfile` — runtime stage now copies `@athr/domain-core` build output (see Findings below).
- `scripts/check-workspace.mjs` — new assertion: every `@athr/*` backend dependency must have a matching runtime `COPY` in the Dockerfile; regression test added.

#### Database and Migrations

- Migration names: additive tables for Invitation/RoleAssignment/AccessScope/SupportAccessGrant (exact folder names per WP-006 §5 indicative list — confirm against PR diff for final names).
- Clean database deploy: Passed.
- Populated upgrade: Passed.
- Schema drift check: Passed, no unexpected drift.
- Remote database changed: Not yet — this PR was not merged/deployed at the time of this entry; see Next Recommended Action.

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Typecheck | Passed | |
| Unit/Contract | Passed | Backend 62 suites / 314 tests; identity+auth 13/86 |
| Backend build | Passed | |
| Admin build/tests | Passed | Admin E2E also passed |
| POS build/tests | Passed | |
| Migration gate | Passed | |
| Admin E2E | Passed | |
| Hard smoke/load | Passed | Windows installer also passed |
| Docker runtime smoke | **Initially misreported as "cannot run — no Docker in this environment," then caught failing for real in CI** | `Cannot find module '@athr/domain-core'` — Dockerfile runtime stage never copied `domain-core`'s build output, only the symlink tree. Fixed in `269a34b`, regression test added in `904aab3`, both verified failing-before/passing-after. This is the third WP hit by this "shared package present in symlink tree but not in runtime image" bug class (see WP-003, WP-005 Phase B) — now covered by a standing `check-workspace.mjs` assertion. |
| Release gate | **Blocked — unrelated to this WP** | `npm audit --audit-level=high` fails on `brace-expansion 4.0.0–5.0.8` (GHSA-rgw5-rvv9-x895) in `backend` and `pos-electron`. Confirmed via `git diff master...HEAD -- package-lock.json`: zero `brace-expansion` lines touched by this branch; the only lockfile change is the one-line `@athr/domain-core` dependency declaration. The advisory landed after master's last green CI run (05:00 UTC today) — master would fail the same audit right now, independent of this WP. |

#### Deployment and Release

- Railway: Deployed. `GET /api/v1/health/ready` confirmed `ok` by Osama directly after merge.
- Vercel: No Admin UI change in this WP; unaffected.
- Supabase: Additive Invitation/RoleAssignment/AccessScope/SupportAccessGrant tables applied via the merged migration.
- POS release: N/A.

#### Findings and Blockers

- **Process finding, not a WP-006 defect:** the Docker runtime-smoke gate was first recorded as "environment cannot run this check" instead of "unverified — must be proven in CI before this WP is considered done." That is exactly the gap the WP-005 §0.3 hardened rule exists to catch, and it worked as designed once CI actually ran the gate — but the initial local judgment call to substitute unavailability for a pass was wrong and is noted here so future WPs don't repeat it: an unavailable verification step must be reported as an open risk, never silently treated as satisfied.
- Release gate is red, but for a pre-existing, unrelated, dependency-advisory reason confirmed not introduced by this branch.

#### Deviations from Plan

- None inside WP-006's scope. The Dockerfile fix and the new `check-workspace.mjs` assertion are in-scope hardening directly required to make the WP-006 hardened testing requirement (§7) actually pass, not scope creep.
- `marketing/landing-page/` (untracked, unrelated work) correctly left out of this PR's commits.

#### Next Recommended Action

Closed. Sequence executed in full: `fix/brace-expansion-audit` (PR #52) merged to `master` first → PR #51 rebased onto updated `master` (new head `32b5631`, zero conflicts) → all 11 CI checks green, `mergeStateStatus=CLEAN` → merged by Osama → Railway `/api/v1/health/ready` returned `ok`, confirmed directly by Osama. WP-006 is closed. WP-007 (Tenant Context Enforcement) is next and unblocked.

---

## Initial Baseline Note — Prepared by Planning Review

- Repository reviewed: `OsamaIbrhim/bold_system`.
- Target: ATHR only.
- Starting candidate: PR #42 head `ba2af73ff35a5b4ad2c4ab9005d3a016f895fd22`.
- Knownfailure: hard-smoke constructs `/shifts/undefined/offline-context`.
- OtherCI gates onthathead passed.
- Current master Railway status reportedfailure; Vercel reportedsuccess.
- Firstrequiredexecution: **WP-000 — Stabilize Transformation Base**.

### `WP-000 — Stabilize Transformation Base — Passed`

- **Started at:** 2026-07-29 09:57:06 Africa/Cairo
- **Completed at:** 2026-07-29 11:02:50 Africa/Cairo
- **Branch:** `feat/athr-transformation`
- **Pull request:** [PR #43](https://github.com/OsamaIbrhim/bold_system/pull/43)
- **Base SHA:** `ba2af73ff35a5b4ad2c4ab9005d3a016f895fd22`
- **Head SHA:** `59e54c9121544d02f8925fd7a71d04f93b5bcd7c`
- **Status:** `Passed`

#### Scope Implemented

- Fixed the root cause of `POST /shifts/undefined/offline-context`: an empty current-shift HTTP response had been normalized to a truthy empty object, then a helper interpolated its missing ID into a resource path.
- Added shared resource-ID and resource-path invariants at Backend, Admin BFF, POS runtime, and hard-smoke helper boundaries. Empty IDs and sentinel path segments such as `undefined` and `null` are rejected before any request is issued.
- Added regression coverage for empty HTTP responses, missing current resources, malformed resource records, invalid resource paths, and Backend shift resource validation.
- Aligned hard-smoke mutation fixtures with the exact POS sync-catalog contract, including Arabic/English name fallback and positive-price selection.
- Added persisted sale-acknowledgement and idempotent replay verification so a successful HTTP sale must map to one persisted invoice with the same `sync_id`.
- Preserved deterministic negative-stock accounting and removed the legacy duplicate sales inventory writer. `SalesService` is now the single sales stock and ledger writer; return and transfer ledger triggers remain intact.
- Aligned both inventory ledgers with acceptance-first offline sales: on-hand may become negative, reservations remain nonnegative and bounded by positive available stock, and cost movements can cross a negative deficit while retaining exact quantity arithmetic.
- Added deterministic negative-cost coverage fixtures and CI API-log diagnostics for hard-smoke failures.
- No WP-001 or other ATHR feature work was started.

#### Files Changed

- **CI:** `.github/workflows/ci.yml`.
- **Admin:** `admin-web/lib/api.ts`, `admin-web/lib/api.test.ts`, `admin-web/lib/resource-path.ts`, `admin-web/lib/resource-path.test.ts`.
- **Backend runtime and contracts:** `backend/src/common/resource-id.ts`, `backend/src/common/resource-id.spec.ts`, `backend/src/shifts/shifts.service.ts`, `backend/src/shifts/shifts.service.spec.ts`, `backend/src/inventory/inventory-ledger-contract.spec.ts`, `backend/package.json`.
- **Hard-smoke and ledger verification:** `backend/perf/hard-load.mjs`, `backend/perf/inventory-ledger-smoke.mjs`, and catalog/resource/sale-acknowledgement helpers plus their tests under `backend/perf/support/`.
- **POS:** `pos-electron/electron/api-policy.ts`, `pos-electron/electron/main.ts`, `pos-electron/electron/resource-path.ts`, `pos-electron/electron/resource-path.test.ts`, `pos-electron/src/api-policy.test.ts`.

#### Database and Migrations

- **Migration names:** `202607290001_sales_inventory_single_writer`, `202607290002_inventory_movement_negative_balance`, `202607290003_inventory_cost_negative_balance`.
- **Migration policy:** Passed; applied migrations remained immutable and all repairs are forward-only.
- **Clean database deploy:** Passed twice, followed by `prisma migrate status`.
- **Populated upgrade:** Passed from the release baseline, then current migrations applied twice.
- **Schema drift check:** Passed on both clean and populated databases with `prisma migrate diff --exit-code`.
- **Remote database changed:** No. No Railway, Vercel production, or Supabase database mutation was performed.

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Backend typecheck | Passed | `tsc --noEmit`; included in Backend `test:soft`. |
| Backend unit/contract | Passed | 48 suites, 211 tests; 13 performance contract tests. |
| Backend build | Passed | Nest build and Prisma validation/generation passed. |
| Admin build/tests | Passed | Admin CI `test:soft`, build, and high-severity audit passed. |
| POS build/tests | Passed | POS CI `test:soft`, build, and high-severity audit passed. |
| Migration gate | Passed | Forward-only policy, clean deploy, populated upgrade, repeat deploy, status, and drift checks passed. |
| Admin E2E | Passed | Isolated PostgreSQL migration/seed, Backend and Admin build/start, then E2E smoke passed. |
| Hard smoke | Passed | API hard-load smoke, inventory ledger, purchasing accounting, and transfer-state suites passed. |
| Release gate | Passed | [CI run 30433761633](https://github.com/OsamaIbrhim/bold_system/actions/runs/30433761633) required Backend, Migration, Admin, Admin E2E, POS, and Hard Smoke success. |
| Windows installer | Passed | [Installer run 30433761618](https://github.com/OsamaIbrhim/bold_system/actions/runs/30433761618) completed successfully; no release was published. |

#### Deployment and Release

- **Railway:** No deployment or configuration change.
- **Vercel:** No production deployment or configuration change initiated. The repository integration produced an automatic PR preview check only.
- **Supabase:** No remote database, credential, or configuration change.
- **POS release:** No release published. Windows installer build verification passed.
- **Merge:** Not merged to `master`.

#### Findings and Blockers

- Root-cause analysis exposed three linked baseline contradictions beyond the original undefined path: hard-smoke fixture drift from the real sync catalog, duplicate sales inventory writers, and legacy ledger constraints that rejected the accepted negative-stock domain state.
- Every discovered defect was fixed at its owning boundary with regression coverage; no temporary bypass or edited applied migration was used.
- **Remaining blockers:** None for WP-000.

#### Deviations from Plan

- Work was isolated in a clean worktree because the original local checkout contained user-owned changes; those changes were not modified.
- The scheduled full `hard-load` job remained skipped by workflow design for this pull-request run. The required `hard-smoke` job and release gate both passed.

#### Next Recommended Action

- Review PR #43. Do not merge or deploy as part of WP-000. Begin the next Work Package only after the required ATHR architecture inputs and approval gates permit it.

---

### `WP-001 — ATHR Identity, Configuration and Release — Passed`

- **Started at:** 2026-07-29 11:05 Africa/Cairo
- **Completed at:** 2026-07-29 13:00 Africa/Cairo
- **Branch:** `feat/athr-transformation`
- **Pull request:** [PR #44](https://github.com/OsamaIbrhim/bold_system/pull/44) — Draft, open, mergeable, not merged
- **Base SHA:** `59e54c9121544d02f8925fd7a71d04f93b5bcd7c`
- **Head SHA:** `f84b7678a8639e1149bc3f32f8e758cda9783b29`
- **Status:** `Passed`

#### Root Causes

- Packaged code embedded Bold identity and a specific Railway URL, coupling runtime behavior to one customer and deployment.
- Changing Electron `appId` moves the Windows `userData` directory and could orphan the SQLite database and pending offline sales without an explicit migration.
- Admin production URL validation did not distinguish safe CI loopback HTTP from insecure remote HTTP.
- Railway `P3009` came from a failed migration-history row for `202607280002_acceptance_first_negative_stock`. Inspection confirmed `applied_steps_count = 0` and a fully rolled-back transaction.

#### Scope Implemented

- Established ATHR identity across Backend, Admin, POS, installer, updater, diagnostics, release tags, manifests, cookies, and visible UI.
- Removed the compiled Railway API URL. POS now uses validated `ATHR_API_URL` or persisted `deployment-config.json`; packaged remote endpoints require HTTPS and `/api/v1`.
- Added a trusted POS API configuration screen and IPC for already-enrolled devices.
- Added non-destructive SHA-256-verified migration of legacy `bold_pos.sqlite` and `secure-state.bin`; original data is retained and ATHR data is never overwritten.
- Renamed the runtime bridge and local ATHR data identifiers, and raised the POS version to `1.5.0` so installed `1.4.0` devices can update.
- Added Backend release metadata to health responses.
- Added validated Admin `ATHR_API_INTERNAL_BASE`; HTTP is allowed only on verified loopback hosts for same-runner CI.
- Renamed release artifacts to `athr-pos-vX.Y.Z`, `ATHR-POS-Setup-<version>.exe`, and `athr-pos-update.json`.
- Added identity/configuration regression tests and updated ATHR README/environment documentation.
- No WP-002 work was started.

#### Files Changed

- **POS:** identity/build metadata, API configuration, local-state migration, main/preload bridge, updater, diagnostics, renderer screens/types/tests, and ATHR icon.
- **Backend:** package/Docker identity, health/release metadata, bootstrap, notification, PDF, update modules, environment examples, and identity tests.
- **Admin:** package identity, API configuration/tests, health route, shell/layout/theme, cookies/events, and README.
- **Release/CI/docs:** workflows, release contracts, CI database/log identifiers, and root/package documentation.

#### Database and Migrations

- **New WP-001 migrations:** None.
- **Migration policy:** Passed; no applied migration was edited.
- **Production recovery:** Used official Prisma `migrate resolve --rolled-back 202607280002_acceptance_first_negative_stock` only after confirming zero applied steps and no committed schema mutation.
- **Post-recovery status:** `Database schema is up to date!`
- **Manual DDL:** None.
- **Deployment:** None. The next authorized Railway deployment can re-run the resolved committed migration normally.

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Backend | Passed | 50 suites, 216 tests, typecheck and Nest build. |
| Backend performance contracts | Passed | 13 tests. |
| Admin | Passed | 13 files, 37 tests and production Next build. |
| POS | Passed | 22 files, 97 tests and build; focused 1.5.0/config tests passed after version bump. |
| Prisma policy/validation | Passed | Schema valid; forward-only policy reported zero new or repaired migrations. |
| CI, migration, Admin E2E, hard smoke, release gate | Passed | [CI run 30441611959](https://github.com/OsamaIbrhim/bold_system/actions/runs/30441611959) completed with conclusion `success` for this exact head SHA. |
| Windows installer | Passed | [Installer run 30441611966](https://github.com/OsamaIbrhim/bold_system/actions/runs/30441611966) completed with conclusion `success`. |
| Vercel preview check | Passed | Commit status for the exact head SHA is `success`. |

#### Deployment and Release

- **Railway:** No deployment or service configuration mutation. Migration history recovery only.
- **Vercel:** No production promotion; preview check only.
- **Supabase:** No manual schema DDL or credential change.
- **POS release:** No release published.
- **Merge:** PR #44 is not merged.

#### Required Before Promotion

- Set `ATHR_API_INTERNAL_BASE=https://<backend-domain>/api/v1` in Admin production.
- Merge only after user review.
- Then authorize Railway/Vercel promotion and publish `athr-pos-v1.5.0`.
- Upgrade existing POS installations without uninstalling or deleting local application data.

#### Findings and Blockers

- Direct live verification on 2026-07-29 for head `f84b7678a8639e1149bc3f32f8e758cda9783b29` shows CI and Windows Installer workflow conclusions are `success`, Vercel commit status is `success`, and PR #44 is mergeable.
- The Backend still has no `lint` npm script; this inherited tooling gap is recorded and was not falsely reported as a passed gate.
- **Remaining blocker:** User review and merge authorization only.

#### Deviations from Plan

- POS version is `1.5.0`, not `1.4.0`, to preserve updater monotonicity for devices already on 1.4.0.
- No local Docker smoke was run; GitHub hard-smoke and release gates passed.
- No merge, production deploy, or WP-002 work was performed.

#### Next Recommended Action

- Review PR #44.
- Configure the required Admin production API value before promotion.
- Merge and deploy only after explicit approval, then verify Railway migration, health metadata, Admin connectivity, legacy POS data migration, and ATHR POS 1.5.0 update flow.

---

### `WP-001 Deployment Recovery Correction — 2026-07-29`

- **Related work package:** `WP-001 — ATHR Identity, Configuration and Release`
- **Status:** `Partial — deployment verification pending`
- **Evidence reviewed:** Production Supabase project `qckaxnojypfglqbbcdov` has exactly one database project. A direct migration-history query returned `0` for rows where `finished_at IS NULL AND rolled_back_at IS NULL`.
- The failed records for `202607280001_acceptance_first_sales_v2` and `202607280002_acceptance_first_negative_stock` are both explicitly marked rolled back with `applied_steps_count = 0`. No partial schema mutation was inferred from those rows.
- **Correction:** The earlier statement that `prisma migrate status` had returned “Database schema is up to date” was not independently retained as evidence and must not be treated as the current deployment result.
- **Current interpretation:** The copied Railway P3009 text refers to a failed migration state, but that state is not currently present in the connected production database. It is therefore either from a deployment that started before recovery completed or from an outdated deployment configuration/container.
- **Required verification:** Trigger one new Railway deployment from the current `master` and inspect its timestamp/commit. If migration execution now fails, record its new timestamp and exact first database error; do not reuse the historic P3009 message as the root cause.
- **WP-001 PR state:** [PR #44](https://github.com/OsamaIbrhim/bold_system/pull/44) remains Draft and unmerged, so it has not been deployed to Railway.
- **No schema DDL, destructive reset, or automatic migration-history rewrite was performed in this correction.**
- **Next action:** Re-run Railway deployment from current `master`; then verify the new deploy log and health endpoint before any WP-002 work.

---

### WP-000 / WP-001 Deployment Recovery — RCA — Blocked

- **Started at:** 2026-07-29 Africa/Cairo
- **Completed at:** 2026-07-29 Africa/Cairo
- **Branch:** `feat/athr-transformation`
- **Base SHA:** `bfdbcb7d77428675072a56b9a88075aa426d7bf9` (master, PR #43 merge)
- **Head SHA:** `f84b7678a8639e1149bc3f32f8e758cda9783b29` (PR #44, Draft/open/unmerged)
- **Status:** `Blocked`

#### Root Cause

- The historic `P3009` is resolved: the successful second execution of `202607280002_acceptance_first_negative_stock` started at `2026-07-29 19:49:44 UTC` and finished at `19:50:06 UTC`. There are zero rows in `public._prisma_migrations` with both `finished_at IS NULL` and `rolled_back_at IS NULL`.
- The current `P1002` is advisory-lock contention, not a Supabase outage. Prisma's lock correctly prevented concurrent schema writers. The successful migration above held the migration lifecycle for 22 seconds; a competing `migrate deploy` started within Prisma's 10-second acquisition window and timed out.
- At inspection time, `pg_stat_activity` contained no active Prisma migration query and `pg_locks` contained no advisory lock. No PID was terminated.

#### 27 vs 30 migrations

- `feat/athr-transformation` and current `master` both contain **30** migration folders.
- The three folders absent from the 27-migration baseline are:
    1. `202607290001_sales_inventory_single_writer`
    2. `202607290002_inventory_movement_negative_balance`
    3. `202607290003_inventory_cost_negative_balance`
- They were added after baseline `3b5a4996c6d095ff5b303fe4af7ac3c8f50a8a86` by WP-000/PR #43. Therefore Railway's “30 migrations found” is consistent with current source; the local “27” checkout is stale/wrong-ref. The three 20260729 migrations remain pending on the connected production database.

#### Deployment ownership findings

- Repository `backend/railway.toml` declares exactly one source-level runner: `preDeployCommand = ["npm run prisma:migrate:deploy"]`. Docker CMD only starts Node and does not invoke Prisma.
- GitHub migration gates use isolated runner-local PostgreSQL databases, not the production Supabase database; they cannot hold the production lock.
- Railway Dashboard settings and deployed SHA were not accessible through the connected tools. They must be verified before a production retry: exactly one backend service owns this database/schema; no persisted Dashboard custom start/pre-deploy command invokes Prisma; Root Directory is `/backend`; Config File is `/backend/railway.toml`; and no manual/second deploy is running.

#### Connection policy

- Runtime `DATABASE_URL` may use Supavisor Session Pooler on port 5432.
- Migration `DIRECT_URL` must prefer direct `db.<project-ref>.supabase.co:5432` with SSL. If Railway cannot use direct connectivity, Session Pooler port 5432 is the only fallback.
- Transaction Pooler port 6543 and `pgbouncer=true` are not valid for migrations. Advisory locking must remain enabled; `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK` was not used.

#### Files Changed

- None. An attempted GitHub write to add a guarded migration-runner script and regression tests was rejected with `403 Resource not accessible by integration`. No local repository checkout was available in this Codex workspace. No migration, schema, migration-history row, or Supabase process was modified.

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Migration policy | Not run | Requires a writable branch/check run after the deployment-runner change. |
| Clean database migration | Not run | Blocked pending code write permission. |
| Populated database upgrade | Not run | Blocked pending code write permission. |
| Schema drift | Not run | Blocked pending code write permission. |
| Backend/Admin/POS/hard-smoke/release | Not run | No source change could be created for validation. |

#### Deployment and Release

- **Railway:** No configuration or deployment mutation made.
- **Supabase:** Read-only inspection only; no manual DDL, reset, history editing, or process termination.
- **Vercel/POS:** Unchanged.

#### Required unblock and next action

1. Grant the GitHub app write permission to `OsamaIbrhim/bold_system` (the current integration is read-only despite local `gh` login), or provide a writable local checkout in this workspace.
2. Implement and test a single guarded migration runner: force Prisma migration child-processes to use `DIRECT_URL`, reject transaction-pooler URLs, log the exact migration-folder count, run status → deploy → status, and retry **only** P1002 advisory-lock contention with a bounded wait.
3. In Railway Dashboard clear all custom build/start/pre-deploy commands; keep only the committed pre-deploy runner. Confirm branch/SHA and one owning service.
4. Then run the documented production sequence: status → deploy → status → health/readiness, and record the exact deployed commit and logs here.

#### Deviations and risks

- The requested successful production deployment cannot honestly be claimed until Railway Dashboard ownership/configuration and write authority are available.
- No WP-002 work started.

---

---

### WP-002 — Monorepo and Shared Packages Foundation — Passed

- **Date:** 2026-07-30 (Africa/Cairo)
- **Repository:** `OsamaIbrhim/bold_system`
- **Branch:** `feat/athr-transformation`
- **Base SHA:** `f84b7678a8639e1149bc3f32f8e758cda9783b29`
- **Head SHA:** `7844c1dea3d2066c06b5af64e100c6e4446aeeb9`
- **Pull Request:** [PR #45](https://github.com/OsamaIbrhim/bold_system/pull/45)
- **Status:** Passed — ready for review and merge; not merged or deployed.

#### Delivered scope

- Converted the repository to one npm workspace with a single root lockfile while preserving the three application identities.
- Added the initial shared package boundaries: `@athr/contracts`, `@athr/domain-core`, `@athr/error-registry`, and `@athr/testing`.
- Added a strict shared TypeScript baseline and workspace-level build, typecheck, test, and structural validation commands.
- Added automated enforcement for dependency direction, app-to-app import bans, package cycles, package identities, provider paths, the single migration-runner invariant, and cross-platform Rollup binaries.
- Updated Backend Docker/Railway configuration to build from the workspace root and use exactly one guarded migration runner before application startup.
- Added an ADR, workspace architecture documentation, and updated the root README and environment guidance.
- Added CI coverage for the workspace foundation, production Backend image build, and release-gate dependency on the workspace job.

#### Root-cause findings and permanent corrections

- **Migration count mismatch:** the previous runner counted only folder names matching a 14-digit timestamp pattern, so it could undercount a repository that actually contains 30 valid migration folders. The runner now counts folders containing `migration.sql`, and the regression test asserts all 30 migrations plus the final three migration names.
- **27 versus 30 migrations:** the 27-migration view came from stale/wrong repository state that lacked the final three migrations: `202607290001_sales_inventory_single_writer`, `202607290002_inventory_movement_negative_balance`, and `202607290003_inventory_cost_negative_balance`. The branch and CI now use the same 30-folder history.
- **Migration concurrency and advisory locks:** Railway has one explicit pre-deploy migration runner. Runtime startup never runs migrations. The runner requires `DIRECT_URL`, rejects Supabase transaction-pooler migration URLs, preserves Prisma advisory locking, and retries only bounded `P1002` lock acquisition failures after status inspection.
- **Vercel preview failure:** with the dashboard Root Directory set to `admin-web`, `admin-web/.next` resolved to a duplicated path. The repository now declares `.next` as the output directory and the preview deployment passes.
- **Linux CI build failure:** a root lockfile generated on Windows omitted Rollup's Linux native optional binary. Admin and POS now declare both required Windows and Linux Rollup native optional packages, and workspace validation checks the lock entries.

#### Files and areas changed

- Root workspace: `package.json`, `package-lock.json`, `tsconfig.base.json`, `scripts/check-workspace.mjs`, CI workflows, `.gitignore`, and `vercel.json`.
- Shared packages: `packages/contracts`, `packages/domain-core`, `packages/error-registry`, and `packages/testing`.
- Backend: workspace metadata, TypeScript configuration, Dockerfile, Railway config, environment example, and guarded Prisma migration runner with tests.
- Admin and POS: workspace metadata, TypeScript inheritance, cross-platform build dependencies, and removal of child lockfiles.
- Documentation: root README, ADR 0001, and workspace architecture guide.

#### Database and deployment state

- **New migrations in WP-002:** none.
- Migration policy passed against the base SHA.
- Clean-database migration, populated-database upgrade, and schema-drift checks passed in GitHub Actions.
- Supabase production data and migration history were not mutated by WP-002.
- Railway production was not redeployed; only deployment configuration and the production image were validated in CI.
- Vercel preview passed; no production promotion was performed.
- POS installer was built in CI only; no release was published.

#### Quality-gate evidence

- Workspace foundation: passed.
- Shared package builds and tests: passed.
- Backend tests: 50 suites / 216 tests passed; typecheck, Prisma validation, Nest build, and production Docker image build passed.
- Admin tests: 13 files / 38 tests passed; typecheck and Next production build passed.
- POS tests: 22 files / 97 tests passed; typecheck, Vite/Electron build, and Windows installer build passed.
- Migration gate: passed, including clean database, populated upgrade, and drift checks.
- Admin E2E smoke: passed.
- Hard smoke: passed.
- Release gate: passed.
- Vercel deployment check: passed.
- Full PR check set is green on Head SHA `7844c1dea3d2066c06b5af64e100c6e4446aeeb9`.

#### Deviations and remaining risks

- The repository still has an inherited lint-tooling gap; WP-002 added structural enforcement and full TypeScript/build/test gates but did not introduce a new lint stack outside the approved package-foundation scope.
- Local Node 20 reports engine warnings for Electron build dependencies that declare Node 22.12 or newer. The configured Windows installer CI completed successfully; Node/toolchain alignment should be handled explicitly in a later approved work package.
- The scheduled full hard-load workflow remains separate by design; the required hard-smoke release gate passed.

#### Closure and next action

WP-002 is complete on PR #45. Review and merge are the next authorized actions. Do not begin WP-003 until the PR is accepted and the next work package is explicitly authorized.

---

### `WP-003 — API and Error Contract Foundation — Passed`

- **Started at:** 2026-08-01 ~05:15 Africa/Cairo
- **Completed at:** 2026-08-01 08:35 Africa/Cairo
- **Branch:** `feat/wp-003-api-error-contracts`
- **Base SHA:** `5f7370688465eafa16c94b1ebb7c9fb386cebb5d`
- **Head SHA:** `3b8d80f410071c7d191389c475d712ca1fed1c18`
- **Status:** `Passed`

#### Pre-flight

- Independently re-verified every marker in §2 of `WP-000-to-002-baseline-status.md` against `origin/master` before branching: root `package.json` workspaces/`private`, all four `@athr/*` package.json files, `backend/scripts/prisma-migrate-deploy.cjs`, `scripts/check-workspace.mjs`, zero `bold-*` names, 31 migration folders including the three named WP-000 migrations, POS version `1.5.0`. All present. Branched from clean `master` at `5f73706`.

#### Scope Implemented

- **`@athr/contracts`:** `envelopes.ts` (`QueryEnvelope`, `ListEnvelope`, `CommandSuccessEnvelope`, `CommandAcceptedEnvelope`, `ErrorEnvelope`, `ErrorDetail`, wire unions for category/retry-mode/outcome/severity), `money.ts` (`MoneyWire`/`QuantityWire`/`PercentageWire`), `headers.ts` (7 in-scope header constants), `pagination.ts` (`PageRequest`/`PageMeta`). Compile-time shape fixtures (`src/__wire-shape-fixtures.ts`) transcribed directly from the API Contract's JSON examples, plus runtime contract tests.
- **`@athr/error-registry`:** `categories.ts`/`retry-modes.ts`/`outcomes.ts` (exhaustive Error Catalog §5/§7/§6 unions), `codes/common.ts` (§31 + §33 request/query codes, reachable today, plus `IDEMPOTENCY_KEY_REQUIRED`/`IDEMPOTENCY_KEY_FORMAT_INVALID` for the new guard), `codes/auth.ts` (exactly the 6 codes the current JWT/roles guards can reach), `codes/internal.ts` (`INTERNAL_ERROR`, `UNEXPECTED_PROCESSING_ERROR`), `registry.ts` (`ERROR_REGISTRY`, `getErrorMetadata`, literal `ErrorCode` union). Replaced the WP-002 placeholder `defineError`/`ErrorDescriptor` API (zero real consumers existed) with the concrete registry.
- **Backend (`backend/src/common/http/`):** `RequestContextMiddleware` (global, formalizes the prior inline `X-Request-Id` middleware, adds `X-Correlation-Id`), `ResponseEnvelopeInterceptor` + `@Envelope('query'|'list'|'command')` (global — interceptors compose, so this is safe), `AthrExceptionFilter` + `AthrDomainError` (route-scoped via `@UseFilters`, not global — see Findings below), `IdempotencyKeyGuard` + `@RequiresIdempotencyKey()` (functional, tested against a synthetic route, `TODO(WP-010)` for storage), `ExpectedVersionGuard` + `@RequiresExpectedVersion()` (pure stub for WP-005+).
- **Proof-of-concept migration (exactly two endpoints):** `GET /api/v1/health/live` (`@Envelope('query')`) and `POST /api/v1/auth/logout` (`@Envelope('command')`, chosen because revoking an already-revoked/absent token is already idempotent). Both verified end-to-end against a running local instance, including confirming `GET /api/v1/health/ready` and a 404 on an unmigrated route are byte-identical to before (aside from the now-global `X-Correlation-Id` header).
- **Docs:** `docs/design-notes/api-error-contract-foundation.md`.

#### Files Changed

- **New:** `packages/contracts/src/{envelopes,money,headers,pagination,__wire-shape-fixtures}.ts`, `packages/contracts/test/{envelopes,money}.test.cjs`, `packages/error-registry/src/{categories,retry-modes,outcomes,registry}.ts`, `packages/error-registry/src/codes/{common,auth,internal}.ts`, `packages/error-registry/test/registry.test.cjs`, `backend/src/common/http/{response-envelope.interceptor,athr-exception.filter,request-context.middleware,idempotency-key.guard}.ts` + matching `.spec.ts`, `docs/design-notes/api-error-contract-foundation.md`.
- **Modified:** `packages/contracts/src/index.ts`, `packages/error-registry/src/index.ts` (explicit named exports added), `backend/package.json` (added `@athr/contracts`/`@athr/error-registry` dependencies), `backend/src/main.ts` (wired middleware/interceptor globally, documented why the filter is not global), `backend/src/health/health.controller.ts`, `backend/src/auth/auth.controller.ts` (the two POC migrations), `package-lock.json`.
- **Deleted:** `packages/error-registry/test/error-registry.test.cjs` (superseded by `registry.test.cjs` after removing the unused placeholder API it tested).
- Not touched: `backend/src/sales/`, `backend/src/sync/`, `backend/src/inventory/`, `backend/src/shifts/`, `pos-electron/`, `admin-web/`, `schema.prisma`.

#### Database and Migrations

- **Migration names:** None. Zero `schema.prisma` changes, as required by this WP's scope.
- **Clean database deploy / populated upgrade / schema drift check:** Not applicable — no migration gate required (no DB impact).
- **Remote database changed:** No.

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Typecheck | Passed | `npm run typecheck` (all 7 workspaces: `@athr/contracts`, `@athr/domain-core`, `@athr/error-registry`, `@athr/testing`, Backend, Admin, POS) clean from a clean checkout. |
| Unit/Contract | Passed | `@athr/contracts`: 6/6 tests. `@athr/error-registry`: 10/10 tests. Backend: 54 suites / 242 tests (WP-002 baseline was 50/216 — the +4 suites/+26 tests are exactly the four new `common/http` spec files). |
| Backend build | Passed | `nest build` succeeded; `dist/src/main.js` produced. |
| Admin build/tests | Passed | 13 files / 38 tests; `next build` succeeded (unchanged from WP-002 baseline — Admin was not touched). |
| POS build/tests | Passed | 22 files / 97 tests; `tsc`/Vite/Electron build succeeded (unchanged from WP-002 baseline — POS was not touched). |
| Migration gate | N/A | No `schema.prisma` change; not required per this WP's scope. |
| Workspace validate/cycles | Passed | `npm run workspace:validate` and `node scripts/check-workspace.mjs --cycles` (`[]`, zero cycles) both clean after adding the `backend → @athr/contracts` and `backend → @athr/error-registry` dependency edges. |
| End-to-end smoke | Passed | Booted the real Backend (`npm run start`, real Postgres) and curled: `GET /health/live` (new query envelope), `GET /health/ready` (unmigrated, byte-identical body), `POST /auth/logout` both a validation-error path and a success path (new command envelope), and a 404 on an unmigrated route (still `ApiExceptionFilter`'s original shape). |

#### Deployment and Release

- **Railway:** No deployment or configuration change.
- **Vercel:** No deployment or configuration change.
- **Supabase:** No change.
- **POS release:** Not applicable; POS untouched.

#### Findings and Blockers

- **Pre-existing global exception filter found (§0.4/§12 stop-condition check):** `backend/src/common/api-error.filter.ts` (`ApiExceptionFilter`) was already registered globally in `main.ts` and produces a different, non-ATHR-Catalog error shape that many currently-passing tests and clients depend on. Read it fully (`toFriendlyError`, Prisma `P2002`/`P2025` mapping, message-substring-based domain mapping). Confirmed via NestJS source (`@nestjs/core/router/router-exception-filters.js`, `select-exception-filter-metadata.util.js`) that exception-filter resolution is "first matching `@Catch()` filter wins" — two globally registered catch-all filters cannot both meaningfully run; one would either never fire or silently replace the other's output on every route. This is not describable as additive, so `AthrExceptionFilter` was **not** added to `app.useGlobalFilters`. It is instead applied per-route via `@UseFilters(AthrExceptionFilter)` on exactly the two migrated handlers — NestJS resolves method-scoped filters before falling back to global ones, which is genuinely additive (verified: an unmigrated 404 route's response body is byte-identical to its pre-WP-003 shape). Full reasoning in `docs/design-notes/api-error-contract-foundation.md`. This is a documented deviation from the literal "register the filter globally via `app.useGlobalFilters`" instruction text, chosen because following it literally would have violated the WP's own "existing unmigrated routes must keep working" requirement and the stop-condition itself.
- **Pre-existing inline request-id middleware found:** `main.ts` already generated `X-Request-Id` inline before this WP. Reconciled by moving the identical logic (same regex, same fields) into `RequestContextMiddleware` and additively adding `X-Correlation-Id` generation, rather than running two separate request-id generators.
- **No contradiction found** between the API Contract/Error Catalog documents and anything already implemented and load-bearing in production code that would require stopping.
- **Environment-only, non-blocking:** `node --test <directory>` (used by each `@athr/*` package's `npm test` script) fails to resolve a directory argument on this Windows/Node v22.23.1 local setup (reproduces identically on the untouched `@athr/domain-core` package, so it predates this WP and is not a regression). CI runs on `ubuntu-latest`, which is unaffected. Verified all four shared packages' tests directly with `node --test 'test/*.test.cjs'` as a local workaround; no script was changed to "fix" this since it is not a real defect and touching it was out of this WP's scope.

#### Deviations from Plan

- `AthrExceptionFilter` is not registered via `app.useGlobalFilters` in `main.ts` — see Findings above. This is the one deliberate deviation from the WP document's literal task-list wording; it was chosen specifically because it is the only way to satisfy the WP's own additivity/stop-condition requirements given the pre-existing filter.
- `ExpectedVersionGuard`, `IdempotencyKeyGuard`'s `IDEMPOTENCY_KEY_REQUIRED`/`IDEMPOTENCY_KEY_FORMAT_INVALID` codes were added to `codes/common.ts` rather than a dedicated file, since the WP's file list for `backend/src/common/http/` and `packages/error-registry/src/` did not include a separate idempotency-codes file, and the "no generic dumping ground beyond the files listed" rule made adding a new file the wrong call.

#### Next Recommended Action

- Review this PR. Do not merge — hold for review per instruction. Next WP (WP-004, Core Value Objects) should not begin until this PR is accepted and merged.

#### Follow-up — 2026-08-01: CI red on `backend`/`admin-e2e-smoke`/`hard-smoke` after merge to branch, root cause and fix

- **Symptom:** The PR's GitHub Actions run (`CI`, run `30685989876`) failed on `backend`, `admin-e2e-smoke`, and `hard-smoke` (and consequently `release-gate`), all with `TS2307: Cannot find module '@athr/contracts'` / `'@athr/error-registry'`. This contradicts the original entry's "Backend build: Passed" / "Typecheck: Passed" rows above — those were verified locally from a working directory that had already run the root-level `npm run build:shared`, which the CI jobs never did.
- **Root cause:** `.github/workflows/ci.yml`'s `backend`, `admin-e2e-smoke`, and `hard-smoke` jobs each run `npm ci` at the workspace root and then immediately build/test the `backend` workspace directly, without ever running `npm run build:shared` (the script that compiles `@athr/contracts`, `@athr/domain-core`, `@athr/error-registry`, `@athr/testing` to their `dist/` output). Only the separate `workspace` job built the shared packages, and its build output does not carry over to other jobs (no artifact upload/download or cache sharing between jobs). Reproduced locally by deleting the four packages' `dist/` output and running `backend`'s own `npm run test:soft` in isolation (not the root-orchestrated one): identical `TS2307` failures. `hard-load` has the same unguarded pattern but wasn't exercised by this PR run (schedule/`workflow_dispatch`-only trigger).
- **Fix:** Added a `npm run build:shared` step (reusing the existing root script — no new script introduced) immediately after the root `npm ci` step in the `backend`, `admin-e2e-smoke`, `hard-smoke`, and `hard-load` jobs. `migration-gate`, `admin`, and `pos` were confirmed unaffected and left untouched: `migration-gate` only runs Prisma CLI commands and `ts-node`-executed seed scripts with no `@athr/*` imports; `admin-web` and `pos-electron` have no dependency on `@athr/contracts` or `@athr/error-registry` (confirmed via `grep`). Verified the fix locally by repeating the same clean-`dist` + isolated-`backend`-workspace reproduction: `backend`'s `test:soft` (54 suites / 242 tests, typecheck, `nest build`) now passes with zero `TS2307` errors.
- **Related, separately fixed:** The local-only `node --test <directory>` issue noted above (line ~480) as "environment-only, non-blocking" was upgraded from a workaround to an actual fix while touching these files: each of the four shared packages' `package.json` `test` script now uses an explicit glob (`node --test "test/*.test.cjs"`) instead of a bare directory argument, so it works identically on Windows and Linux. This was in scope this time because the CI-failure investigation required repeatedly running `test:shared` locally to verify the real fix, and leaving a known cross-platform footgun in place while doing that work made verification unnecessarily unreliable.
- **Verification performed:** `npm ci` (clean), `npm run build` (root), `npm run test:soft` (root) all pass from a clean state. CI re-run pending push — see PR status for final confirmation before merge.
- **Correction to the above (same day, second push):** The quoted-glob `node --test "test/*.test.cjs"` fix claimed above to work "identically on Windows and Linux" was wrong — it regressed `workspace-foundation` in CI (`Could not find '.../test/*.test.cjs'`), because Node's `--test` glob-pattern support for positional arguments is not present at Node 20.11 (CI's pinned version); it only resolved locally because this machine runs Node 22.23.1. Replaced with an explicit per-file list (`node --test test/a.test.cjs test/b.test.cjs ...`) in all four shared packages, which is supported identically on every Node LTS version and OS — no version-gated feature involved. Also found and fixed in the same push: `backend/Dockerfile`'s production image build stage (not just CI) had the identical missing-shared-build gap — `nest build` inside the Docker image itself hit the same `TS2307`, since only `packages/*/package.json` was ever copied into the image, never `src/` or a build step. Added `COPY packages ./packages` + `RUN npm run build:shared` to the build stage, mirroring the CI fix. After this second push, CI run `30693235705` passed all required checks (`workspace-foundation`, `backend`, `migration-gate`, `admin`, `admin-e2e-smoke`, `pos`, `hard-smoke`, `release-gate`) green.

#### Follow-up — 2026-08-01: Railway runtime crash (`Cannot find module '@athr/contracts'`) — Docker runtime-stage packaging bug, distinct from the CI fix above

- **Symptom:** A Railway deploy off this branch failed at container startup (not at the `preDeployCommand` Prisma migration, which succeeded cleanly — no data risk) with `Error: Cannot find module '@athr/contracts'` when Node loaded `backend/dist/src/common/http/athr-exception.filter.js`. This is a *different* failure surface than the CI fixes above: CI's `backend` job only runs `docker build` (proves the image compiles), it never runs `docker run` and hits a live endpoint, so a runtime-only packaging gap in the final image was invisible to CI.
- **Confirmed master/production was not affected:** `master`'s `backend/package.json` has no `@athr/contracts` or `@athr/error-registry` dependency, and `master`'s `backend/src/main.ts` has zero references to `athr-exception.filter` — that code path doesn't exist on `master`, since WP-003 (which introduced it) has never been merged. This Railway failure is necessarily from a branch-level/manual deploy of `feat/wp-003-api-error-contracts`, not the live production service.
- **Root cause:** `backend/Dockerfile` is three-stage (`dependencies` → `build` → `runtime`). Reproduced the exact `dependencies`-stage `npm ci --workspace athr-operations-api --include-workspace-root=false --install-strategy=nested` command in an isolated directory (Docker itself is not installed in this environment, so this is a faithful command-level reproduction rather than a literal `docker build`) and found that npm places the `@athr/contracts`/`@athr/error-registry` workspace symlinks at the **workspace-root** `node_modules/@athr/`, not `backend/node_modules/@athr/`, regardless of `--install-strategy=nested` (that flag only affects hoisting of registry dependencies, not intra-monorepo workspace symlink placement). The `runtime` stage's `COPY` set only ever copied `/app/backend/node_modules`, `/app/backend/dist`, `/app/backend/prisma`, `/app/backend/scripts`, and root `package.json`/`package-lock.json` — it never copied root `/app/node_modules` (where the `@athr/*` symlinks actually live) or `/app/packages/*` (their symlink targets). So the runtime image is missing the symlinks *and* their targets, not just the targets. Reproduced the identical `MODULE_NOT_FOUND` by hand-building both the broken and fixed final-stage directory layouts (mirroring the Dockerfile's exact `COPY --from=build` source/dest paths) and running `require('@athr/contracts')` against each.
- **No prior WP-002 pattern existed for this:** WP-002 established the workspace-aware `npm ci --workspace` install pattern in this Dockerfile, but at that point backend had zero runtime dependency on any `@athr/*` package (WP-002 only *created* the packages; WP-003 is what made backend import them), so WP-002 never needed to solve shipping a workspace-linked package into the final stage. This fix extends WP-002's existing convention (the runtime stage already does absolute-path `COPY --from=build /app/X /app/X` for things outside `backend/`, e.g. the root `package.json`/`package-lock.json` line) rather than inventing a new one.
- **Fix:** Added three `COPY --from=build` lines to the `runtime` stage, before the existing `backend/*` copies: `/app/node_modules/@athr` → `/app/node_modules/@athr` (the symlinks), and `/app/packages/{contracts,error-registry}/{package.json,dist}` → the matching `/app/packages/{contracts,error-registry}/` paths (the symlink targets — `src/` and build caches deliberately excluded, matching the runtime stage's existing dist-only philosophy for `backend` itself). Only `contracts` and `error-registry` are copied — confirmed `backend/package.json` depends on neither `@athr/domain-core` nor `@athr/testing`, and confirmed via the same local `npm ci` reproduction that npm's workspace linker only symlinks the two packages actually declared as dependencies. Verified end-to-end (hand-built old vs. new runtime-stage layouts, not a literal `docker build`/`docker run` since Docker is unavailable in this environment): the broken layout reproduces `Cannot find module '@athr/contracts'`; the fixed layout successfully `require()`s both packages and resolves real exports (`ATHR_HEADERS`, `getErrorMetadata`), not stubs.
- **Verification gap, disclosed:** This fix has not been verified with a literal `docker build && docker run` — Docker is not installed in this local environment. Verification is by faithful hand-reproduction of each Dockerfile stage's exact file set and `COPY` source/dest paths, plus Node's real module-resolution algorithm against that reproduced layout. A real `docker build`/`docker run` (or the next Railway branch deploy) is the outstanding confirmation step. CI's `backend` job docker-build step will also confirm the image still compiles, but will not catch a runtime-only regression like this one — CI has no container-run/health-check step, which is how this class of bug got through in the first place.
- **Not merged, no deploy triggered (at time of writing):** Pushed to `feat/wp-003-api-error-contracts` only, per explicit instruction not to merge or trigger another deploy without confirmation.
- **Update — same day, ~09:15:** PR #46 was merged to `master` externally (merge commit `00f678f`), not by this session — no `gh pr merge` or push-to-master was issued here. Timing: the merge landed after the CI-fix push (`fdac079`) but *before* the Docker runtime-stage fix push (`8b7a798`), so for a window, `master` carried the new `@athr/contracts` runtime dependency **without** the Docker packaging fix — i.e., master's Dockerfile would have reproduced the exact Railway `Cannot find module '@athr/contracts'` crash on its next deploy. Confirmed with the user and, per their explicit go-ahead, cherry-picked `8b7a798` directly onto `master` (commit `657a6fc`) to close the window — verified the cherry-pick applied cleanly (no conflicts, since master's `backend/Dockerfile` at merge time was byte-identical to `8b7a798`'s parent). CI on `master` re-ran for this push; see run `30695283957` for the actual result.

#### Follow-up — 2026-08-01: second Railway crash-loop, corrected root cause — Docker `COPY` semantics flattened `dist/`

- **Symptom:** Railway kept crash-looping (`Starting Container` / `Stopping Container` on repeat), but the error narrowed: no longer `Cannot find module '@athr/contracts'`, now `Cannot find module '/app/node_modules/@athr/contracts/dist/index.js'`. Live-endpoint check (`GET https://boldsystem-production.up.railway.app/api/v1/health/ready`) at the time returned `200` with `"commit":"5f7370688465eafa16c94b1ebb7c9fb386cebb5d"` — the pre-WP-003 baseline commit. Railway does not cut traffic to a new deployment until it passes its health check, so the crash-looping attempts were not the version actually serving production traffic; there was no live customer-facing outage, but the deploy pipeline itself was broken and, left alone, would have kept burning through `restartPolicyMaxRetries: 10` on every push.
- **Root cause — a bug in the previous fix, not a new bug:** The `627a6fc`/`8b7a798` fix's runtime-stage `COPY` line was `COPY --from=build .../packages/contracts/package.json .../packages/contracts/dist .../packages/contracts/` — a multi-source copy where one source (`dist`) is a directory. Docker's `COPY` copies a source directory's *contents* into the destination; it does not create a same-named subdirectory there. So `dist/index.js`, `dist/envelopes.js`, etc. landed directly at `packages/contracts/index.js`, `packages/contracts/envelopes.js` — the `dist/` nesting was silently discarded. `package.json`'s `"main": "./dist/index.js"` then pointed at a path that never existed in the image. The package was now correctly *linked* (this session's first fix worked), but its compiled output wasn't where its own `package.json` said it would be.
- **Why the previous verification didn't catch this:** That fix was "verified" by hand-reproducing the runtime-stage layout using `cp -r` in a scratchpad directory (Docker itself is not installed in this environment). Bash's `cp -r src_dir dest_dir/` preserves `src_dir` as a named subdirectory of `dest_dir` — the *opposite* of Docker's `COPY` semantics for a directory source. The hand-simulation was internally consistent but simulated the wrong tool's behavior, so it couldn't have caught this class of bug. Recorded here as the reason this round's fix was verified differently (see below).
- **Fix:** Split the combined multi-source `COPY` into two single-source `COPY` lines per package, each with an explicit, unambiguous destination (`.../packages/contracts/package.json` → itself, `.../packages/contracts/dist` → itself), removing any dependence on Docker's directory-flattening behavior producing the right result by coincidence.
- **Real verification this time, not another hand-simulation:** Docker is still not installed locally, so rather than hand-simulate again, added a new `docker-runtime-smoke` CI job that does the real thing on GitHub Actions' actual Docker daemon: `docker build` the production image from `backend/Dockerfile` (same file, same root build context CI already uses), `docker run` it against a real ephemeral Postgres service with production-shaped env vars, and curl `/api/v1/health/ready` in a retry loop, dumping container logs unconditionally. Triggered via `workflow_dispatch` on a throwaway branch (`fix/docker-runtime-dist-path`) *before* touching `master` again, per explicit instruction not to push blind. Run `30696110049`'s `docker-runtime-smoke` job passed for real: container logs show NestJS booting, both health routes mapping (`/api/v1/health/live`, `/api/v1/health/ready`), Prisma connecting, and the health check succeeding within seconds — genuine end-to-end proof, not a filesystem-layout proxy. This job is now wired into `release-gate` as a required check, closing the exact CI gap (no job ever built-and-ran the actual image) that let both this bug and the previous one reach Railway undetected.
- **Master timeline:** Verified the throwaway branch's single commit was a clean fast-forward of `master` (`657a6fc` + this one commit, no divergence), then pushed directly to `master` (`785c249`) only after the real `docker-runtime-smoke` result came back green. CI re-ran on `master` itself (run `30696443965`) as final confirmation.
- **Outstanding:** Railway's actual redeploy of `master` and the live health endpoint were not independently reconfirmed by this session after this push — check Railway's dashboard directly. Also outstanding: this session cannot determine from repo state alone whether Railway is configured to auto-deploy on push to `master` (that setting lives entirely in Railway's own dashboard, not in this repo) — recommended the user check Railway's project settings directly and disable auto-deploy for `master` if WP-003 work should not go live automatically.

---

### `WP-004 — Core Value Objects — Passed`

- **Started at:** 2026-08-01 (exact Africa/Cairo clock time not reliably available in this session's environment — this session's OS clock is US Eastern; see Deviations)
- **Completed at:** 2026-08-01
- **Branch:** `feat/wp-004-core-value-objects`
- **Base SHA:** `785c2497c88cdda87e6d244706600a0bd6f71ba4` (master, includes WP-003 + both Docker follow-up fixes)
- **Head SHA:** `c440f608c599fcec492122b0661792ddae1069d0`
- **Status:** `Passed` — ready for review; not merged, no PR opened yet at time of writing this entry (opened immediately after)

#### Pre-flight

- Re-verified `WP-000-to-002-baseline-status.md` §2 markers against `origin/master`: workspace `dependencies`/`private`, all four `@athr/*` package.json files, `backend/scripts/prisma-migrate-deploy.cjs`, `scripts/check-workspace.mjs`, zero `bold-*` names, 31 migration folders, POS `1.5.0`. All present.
- Confirmed WP-003 merged into `origin/master`: `packages/contracts/src/{envelopes,money}.ts` and `packages/error-registry/src/registry.ts` all present at `origin/master`'s tip (`785c249`, which is WP-003's merge plus both Docker runtime-stage follow-up fixes described in the WP-003 entry above).
- Fetched, checked out, and pulled `master` (fast-forwarded 10 commits from a stale local `master`), confirmed a clean tree, then branched.

#### Scope Implemented

- **`@athr/domain-core`:** `Money`/`CurrencyCode` (`EGP`/`USD`/`SAR`, 2 decimal places, `HALF_UP` rounding — chosen to match the POS money codec's existing rounding rather than banker's rounding), `Quantity`/`UnitOfMeasureId` (provisional fixed 3-decimal scale, real UOM policy deferred to WP-008), `Percentage`/`Rate` (`rate` as sole canonical value, `display_percent` always derived), `ids.ts` (`OpaqueId<Brand>` + `TenantId`/`IdempotencyKey`/`ClientOperationId`/`CorrelationId`/`CausationId`/`AggregateVersion`), `datetime.ts` (`UtcTimestamp`, `BusinessDate`, `OccurredAt`/`RecordedAt`/`EffectiveAt` naming aliases), `result.ts` (`Result`/`DomainFailure`/`ok`/`fail`), `identity-value-objects.ts` (`EmailAddress`, `PhoneNumber`). All arithmetic uses `BigInt`-scaled integers via a shared `internal/decimal.ts` helper — never native `number`. `index.ts` rewritten with explicit named exports (no wildcard).
- **`@athr/contracts` dependency-direction resolution (Task 3):** `ATHR Dependency Rules v1.0` §3/§4 place `domain-core` *below* `contracts` (contracts may import domain-core; domain-core must not import contracts), the reverse of the assumption named in the WP document. Resolved without contradicting anything WP-003 shipped: production code in `domain-core` never imports `@athr/contracts` (each file declares its own structurally-identical wire interface); only `*.spec.ts` contract tests do, via `import type`, to prove `toWire`/`fromWire` round-trips against the real wire types. `@athr/contracts` is declared only under `domain-core`'s `devDependencies`. Full reasoning in `docs/design-notes/core-value-objects.md`.
- **POS local database (`pos-electron/electron/`):** §0.5 discovery found the `REAL` money columns (`products.cost_price`/`selling_price`/`unit_tax`, `sales_local.total`) inline in `main.ts`'s `initDb()` (no separate schema files), and the existing non-destructive/SHA-verified pattern in `local-state-migration.ts` (WP-001's `bold_pos.sqlite` → `athr_pos.sqlite` file migration). Added sibling `*_minor_units` INTEGER columns via the existing `ALTER TABLE`-in-`try/catch` mechanism (no new mechanism invented), a one-time idempotent backfill (`money-column-migration.ts`, gated by a `sync_meta` marker reusing the existing `getMeta`/`setMeta` pattern) that never modifies or drops the `REAL` columns, and a local-storage codec (`money-codec.ts`, built on `@athr/domain-core`'s `Money`, fixed to `EGP`). Updated the five identified read/write call sites (`hydrateHeldSale`, the `pos:sale` insert, `sync:get_outbox`, `pos:list_local_sales`, the catalog upsert) to go through the new columns/codec instead of the `REAL` columns.
- **Docs:** `docs/design-notes/core-value-objects.md`.

#### Files Changed

- **New:** `packages/domain-core/src/{money,quantity,percentage,ids,datetime,result,identity-value-objects}.ts` + matching `.spec.ts`, `packages/domain-core/src/internal/decimal.ts`, `pos-electron/electron/{money-codec,money-column-migration}.ts` + matching `.test.ts`, `docs/design-notes/core-value-objects.md`.
- **Modified:** `packages/domain-core/src/index.ts` (explicit named exports), `packages/domain-core/package.json` (added `@athr/contracts`/`@types/node` devDependencies; added an `exports["."].default` condition so Vite's ESM resolver, used by `pos-electron`'s vitest suite, can resolve the package — additive, does not change resolution for the existing CommonJS `require` consumer), `pos-electron/package.json` (added `@athr/domain-core` runtime dependency), `pos-electron/electron/main.ts` (new `ALTER TABLE` statements, migration wiring in `initDb()`, the five call sites above, a local-only `athr-money-migration.json` checksum log), `package-lock.json`.
- **Deleted:** `packages/domain-core/test/domain-core.test.cjs` (superseded by colocated `ids.spec.ts`, which covers the same `parseOpaqueId` behavior plus the new concrete ID parsers).
- Not touched: `backend/prisma/schema.prisma`, any file under `backend/src/sales/`, `backend/src/inventory/`, or `admin-web/`.

#### Database and Migrations

- **Cloud/Postgres migration names:** None. Zero `schema.prisma` changes, as required by this WP's scope.
- **POS local SQLite migration:** `migrateMoneyColumnsToMinorUnits` (forward-only, additive columns only, idempotent via `sync_meta` marker). Tested against a fixture resembling real pending-offline-sale data (multiple `products` rows including one with a `NULL cost_price`, `sales_local` rows with pending totals, and deliberately float-unsafe seed values) — see `money-column-migration.test.ts`'s three tests: full backfill + exact minor-units + non-destructive preservation of the original `REAL` values; idempotent re-run; and no re-conversion against an already-migrated database.
- **Clean database deploy / populated upgrade / schema drift check:** Not applicable to the cloud database (no `schema.prisma` change). For the POS local database: verified conceptually equivalent properties (clean-DB fresh-install path via `CREATE TABLE IF NOT EXISTS` + full `ALTER`/migration run; populated-DB upgrade path via the fixture test seeding pre-existing rows before migrating) since there is no cloud migration-gate tooling that applies to a local SQLite file.
- **Remote database changed:** No.

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Typecheck | Passed | `npm run typecheck` (all 7 workspaces) clean from a clean checkout. |
| `@athr/domain-core` unit/contract | Passed | 52/52 tests (`node --test`), including the `0.1 + 0.2` float-trap proof, `100.005`/`-0.005` `HALF_UP` boundary cases, immutability, and `toWire`/`fromWire` round-trips against the real `@athr/contracts` types. |
| POS unit/contract | Passed | 24 files / 105 tests (`vitest run`), including the two new files (`money-codec.test.ts`: 5 tests; `money-column-migration.test.ts`: 3 tests) — zero regressions against the pre-existing 22 files / 97 tests. |
| POS build | Passed | `tsc && vite build && tsc -p tsconfig.electron.json` succeeded (both standalone and via root `test:soft`). |
| Backend/Admin build/tests | Passed (unchanged) | Backend 54 suites/242 tests, Admin 13 files/38 tests — both untouched by this WP, confirmed still green via the root `npm run test:soft`. |
| Migration gate | N/A (cloud) | No `schema.prisma` change. POS local-migration gate covered above. |
| Workspace validate/cycles | Passed | `node scripts/check-workspace.mjs --cycles` → `[]`. Graph confirms `domain-core → contracts` (devDependency only, no reverse edge, zero cycle) and the new `pos-electron → domain-core` runtime edge. |
| Root `test:soft` | Passed | Full chain (`test:workspace && workspace:validate && test:shared && build:shared` + all three apps' `test:soft`) completed with exit code 0. |
| Docker build/run | **Not run — condition did not apply** | This WP was told to prove a real `docker build`+`docker run` if anything backend-runtime-facing imports `@athr/domain-core`. Confirmed `backend/` was not touched at all (`git diff --stat master -- backend/` is empty) and `athr-operations-api` does not depend on `@athr/domain-core` (confirmed via the workspace graph dump above and a repo-wide `grep` for `domain-core` under `backend/`, zero hits). `@athr/domain-core` is only consumed by `pos-electron` (an Electron desktop app, not part of the Railway Docker image) in this WP. |

#### Deployment and Release

- **Railway:** No deployment or configuration change.
- **Vercel:** No deployment or configuration change.
- **Supabase:** No change.
- **POS release:** No release published; local build/test verification only, per Prohibited-in-this-WP §10 ("do not run this migration against any real device or production data").

#### Findings and Blockers

- **No `REAL` columns already removed** (Stop Condition 1 does not apply) — found exactly the four expected columns in `main.ts`.
- **Dependency-direction ambiguity resolved, not a Stop Condition** (Stop Condition 2's trigger, "reveals an actual conflict with what WP-003 already shipped," did not occur) — see Scope Implemented above and `docs/design-notes/core-value-objects.md`'s dedicated section. WP-003's `@athr/contracts` package needed zero changes to satisfy this resolution.
- **Real bug caught by the migration's own fixture test:** the first implementation of the REAL→minor-units backfill converted via `numeric.toFixed(2)`, which rounds using the raw IEEE-754 binary value and silently rounded `100.005` down to `"100.00"` instead of up to `"100.01"` (a well-known `toFixed` quirk: the nearest double to `100.005` is actually `~100.00499999999999901`). Caught immediately by the fixture test's boundary-value assertion, before it reached any call site. Fixed by using `String(numeric)` (the shortest round-trip decimal) instead of `toFixed`, letting `Money`'s exact `BigInt` parser make the correct call. Documented in `docs/design-notes/core-value-objects.md` as a worked example, since it is exactly the kind of float trap this WP exists to eliminate.
- **`packages/domain-core/package.json`'s `exports` map needed a `"default"` condition** (in addition to the existing `"require"`/`"types"`) for Vite's ESM resolver (used by `pos-electron`'s vitest suite) to resolve the package at all — without it, `vitest run` failed with `Failed to resolve entry for package "@athr/domain-core"`. Additive; does not change resolution for the existing CommonJS `require` consumer (none exists yet outside this WP's own tests).
- **No remaining blockers.**

#### Deviations from Plan

- `Money.multiplyByRate` takes a `Percentage` value object (not a raw decimal string/number) as its parameter — the WP document didn't specify the exact signature, and accepting `Percentage` keeps the operation fully type-safe/decimal-exact end-to-end (no string round-trip needed) since `Percentage` already exists as a value object in this same WP.
- The products catalog upsert (`INSERT OR REPLACE INTO products`) now writes the new minor-units columns on every future catalog sync, in addition to the existing `REAL` columns (dual-write), rather than only backfilling once — because that statement fully replaces each row on every sync, so the new columns would silently regress to `NULL` on the very next sync if not populated at write time. `sales_local` (an append-only ledger, rows never fully replaced after insert) does not need this and only gets the new column populated at insert time.
- Docker build/run verification was not performed — see the Tests table row above for why the stated condition (backend-runtime-facing code importing `@athr/domain-core`) does not apply to this WP.
- This session's OS clock reports US Eastern time rather than Africa/Cairo; exact per-step timestamps in this entry are approximate for that reason (the date, 2026-08-01, is confirmed via the session's provided context).

#### Next Recommended Action

- Review this PR. Do not merge — hold for review per instruction. Confirm whether Task List item 6 in the WP document ("Update the specific POS read/write call sites") is fully satisfied by the five call sites listed above, or whether any other code path reads `products`/`sales_local` money columns that this session's `grep`-based discovery missed.
- Next WP should not begin until this PR is accepted and merged.

#### Follow-up — 2026-08-02: `pos` soft-gate red in CI — same root-cause class as the two WP-003 shared-package incidents above, this time fixed systemically instead of per-job

- **Symptom:** CI's `pos` job failed with `Failed to resolve entry for package '@athr/domain-core'` via `vite:import-analysis`, surfaced in `electron/money-codec.ts` and `electron/money-column-migration.test.ts` (the two new files this WP added). This is the third distinct consumer to hit "shared package not built/resolvable" — Backend build and the Backend Docker image both hit variants of it during WP-003 (see the two Follow-up sections above); `pos` is the third.
- **Root cause, this time named explicitly instead of patched per-symptom:** `.github/workflows/ci.yml`'s `pos` job runs `npm ci` at the workspace root and goes straight into `npm run test:soft --workspace athr-pos-electron` — it never ran `npm run build:shared`, unlike `backend`/`admin-e2e-smoke`/`hard-smoke`/`hard-load`, which had that step bolted on individually after the WP-003 incidents. The underlying defect was never "job X forgot a step"; it's that nothing in this repo made `npm ci`/`npm install` itself guarantee the four shared packages' `dist/` output exists. Every fix through WP-003 treated a symptom (one job, one Dockerfile stage) rather than the mechanism (no install-time guarantee), so a fourth consumer — `pos`, added by this WP — was exposed to the exact same gap on day one. Confirmed by reproduction: a clean `npm ci` from a fully wiped `node_modules`/`dist` state (and, since TypeScript's `composite`/incremental cache in `*.tsbuildinfo` can mask a missing-`dist` state by skipping emit on a false "up to date" read, also wiped every stray `.tsbuildinfo`) left all four of `packages/{contracts,domain-core,error-registry,testing}/dist` absent.
- **Fix — one mechanism, not another per-job patch:** Added `"postinstall": "npm run build:shared"` to the root `package.json`. `npm install`/`npm ci` always run the root project's `postinstall` lifecycle script after the full workspace tree (including the `@athr/*` symlinks) is in place, so this now builds all four shared packages as a direct, unconditional consequence of installing — no CI job, Dockerfile stage, or future app can skip it by omission ever again. Removed the now-redundant explicit `npm run build:shared` steps from the `workspace`, `backend`, `admin-e2e-smoke`, `hard-smoke`, and `hard-load` jobs (all of which do a plain unscoped root `npm ci`, so `postinstall` already covers them); left `pos`, `migration-gate`, and `docker-runtime-smoke` untouched since they never had the step and don't need one added now — `postinstall` covers `pos` automatically, which is the actual fix for the reported symptom.
- **One real wrinkle, caught and fixed rather than glossed over:** `backend/Dockerfile`'s `dependencies` stage intentionally runs a *scoped* install (`npm ci --workspace athr-operations-api --include-workspace-root=false --install-strategy=nested`) before `packages/` source is copied in, specifically to preserve Docker layer caching (dependency install is cached separately from source changes). With the new root `postinstall` in place, that scoped install would now try to build the shared packages before their `tsconfig.json`/`src/` exist, failing outright. Reproduced this exact failure in an isolated scratch directory mirroring the Dockerfile's `COPY` set before shipping the fix. Resolved by adding `--ignore-scripts` to that specific `npm ci` invocation (the only install site that legitimately cannot run `postinstall` yet) and leaving the existing explicit `RUN npm run build:shared` step in the `build` stage (which runs after `COPY packages ./packages`) as the one place that actually builds them for the Docker image — not a duplicate mechanism, the one place `--ignore-scripts` deliberately deferred it to.
- **`packages/domain-core/package.json`'s `exports` map was checked against `packages/contracts/package.json`'s, on request, and deliberately left different:** `contracts`'s `exports["."]` has only `types`/`require` (no `default`); `domain-core`'s also has `default` (added earlier this WP, see the Findings entry above). Mirroring `contracts` exactly would mean *removing* `domain-core`'s `default` condition — which would break the actual Vite consumer. The difference is justified, not an oversight: `contracts` and `error-registry` are only ever consumed via CommonJS/webpack-style resolution (`backend` via `ts-node`/Nest, `admin-web` via Next.js's webpack) where the `require` condition alone resolves; `domain-core` is the only one of the four consumed by Vite (`pos-electron`), whose ESM resolver requires a matching `import`/`default` condition that `require`-only exports do not satisfy. Confirmed by running `pos-electron`'s full `test:soft` (24 files / 105 tests including both new WP-004 files, then `tsc && vite build && tsc -p tsconfig.electron.json`) against the current exports shape — all green, no resolution error.
- **Verification performed:** Clean `npm ci` (wiped `node_modules` + all four `dist/` + all stray `.tsbuildinfo`) populates all four shared packages' `dist/` via `postinstall` alone, no manual step. `backend`: `npm test` (54 suites / 242 tests) and `npm run build` (`nest build`) both pass. `admin-web`: `npm run build` passes (Next.js production build, 23 routes). `pos-electron`: `npm run test:soft` passes (105 tests + `vite build` + electron `tsc`), including the two files named in the original CI failure. `backend/Dockerfile`'s corrected `dependencies`-stage command (with `--ignore-scripts`) and `build`-stage `build:shared` were each verified by faithful reproduction of their exact `COPY` source sets in an isolated scratch directory (Docker itself is not installed in this environment, consistent with the WP-003 entries above). Root `npm run test:workspace` and `workspace:validate` both pass. A literal `docker build`/`docker run` and the full GitHub Actions `release-gate` were not executed locally (no Docker daemon here) — pushed for CI to confirm; see the next Follow-up entry or PR status for the actual run result before merge.
- **This bug class is now structurally prevented, not just fixed for `pos`:** any future workspace/app (a fifth consumer, a new shared package, a new Dockerfile) that runs `npm ci`/`npm install` from the workspace root gets a built `dist/` for all four shared packages automatically, with no per-job or per-Dockerfile step to remember. The only place that must still opt out deliberately is a scoped pre-source-copy Docker dependency stage, and that one now does so explicitly via `--ignore-scripts` rather than by silent omission.

#### Follow-up — 2026-08-02: Vercel deployment failure exposed a second, latent bug behind the postinstall fix — TypeScript's incremental cache silently skipping emit

- **Symptom:** After the `postinstall` push above went green on GitHub Actions, a Vercel deployment of the same commit (`5424c5a`) failed during `npm ci` with `TS2307: Cannot find module '@athr/contracts'` in `domain-core`'s `*.spec.ts` files — the exact failure signature this session had earlier dismissed as "just local `.tsbuildinfo` contamination on this machine, not a real bug" while first reproducing the original CI issue. Vercel's build log showed `Restored build cache from previous deployment` immediately before `npm ci` ran.
- **Root cause — a real, environment-independent bug, not local contamination:** All four shared packages' `tsconfig.json` set `"composite": true`, which implies `"incremental": true` and makes `tsc` write/read a `tsconfig.tsbuildinfo` file. TypeScript's incremental mode trusts that file's record of "this input hasn't changed, output is already correct" *without verifying the actual output files still exist on disk*. Nothing in this repo ever uses TS project references (`grep -rn '"references"' packages/*/tsconfig.json backend/tsconfig*.json admin-web/tsconfig.json pos-electron/tsconfig*.json` — zero hits), so `composite` was providing no benefit here, only this risk. Vercel's persistent build cache restores more than just `node_modules` across deployments; it evidently restored a stale `packages/contracts/tsconfig.tsbuildinfo` from a prior build into the fresh clone. `tsc` read it, believed `contracts` was already built, and silently emitted nothing — zero errors, zero warnings, zero `dist/` output — leaving `domain-core`'s build (which needs `@athr/contracts`'s type declarations for its `*.spec.ts` contract tests) to fail on the very next line of `build:shared`. Reproduced deterministically and locally, independent of Vercel: deleted `packages/contracts/dist/` while leaving its `tsconfig.tsbuildinfo` in place, ran `npm run build --workspace @athr/contracts` — no errors printed, `dist/` never recreated.
- **Why this wasn't caught by this session's own earlier "clean npm ci" reproduction:** GitHub Actions checks out a genuinely fresh clone every run with no persistent working-directory cache, so `tsconfig.tsbuildinfo` (gitignored, never committed) never exists there to go stale — the bug was real but invisible on that platform. Vercel's build cache behaves differently and surfaced it immediately. This is exactly the kind of platform-specific blind spot the WP-003 Follow-up above (`cp -r` vs. Docker `COPY` semantics) also flagged: a fix "verified" on one platform's caching/copy semantics isn't proof against another's.
- **Fix:** Removed `"composite": true` from all four shared packages' `tsconfig.json` (`contracts`, `domain-core`, `error-registry`, `testing`). With it gone, `tsc` no longer writes or trusts a `.tsbuildinfo` file at all — every invocation of `build:shared` performs a full, deterministic compile and emit, regardless of what any host's build cache did or didn't restore. This closes the bug class itself (no incremental state to go stale) rather than working around this one cache-restore incident specifically (e.g., by force-deleting `.tsbuildinfo` before each build, which would have been a narrower, more fragile fix).
- **Verification performed:** Re-ran the exact adversarial repro that failed pre-fix (stale `tsconfig.tsbuildinfo` present, `dist/` deleted) and confirmed `tsc` now always re-emits correctly. Full clean-room re-verification chain repeated end-to-end: wiped `node_modules`, all four `dist/`, and all `.tsbuildinfo` files; `npm ci` alone (via `postinstall`) rebuilt all four `dist/` correctly; confirmed zero `.tsbuildinfo` files are generated post-fix (`find packages -iname "*.tsbuildinfo"` → empty); `npm run test:shared` (all four packages' own test suites) passes; `backend` (`npm test`: 54/54 suites, `npm run build`: `nest build` clean) passes; `pos-electron` `test:soft` (105 tests + `vite build` + electron `tsc`) passes.
- **Not yet independently reconfirmed on Vercel itself:** this fix addresses the mechanism that caused the Vercel failure and was verified by faithfully reproducing Vercel's own reported failure state locally, but the actual Vercel deployment has not been re-triggered/re-checked by this session after this push — recommend confirming the next Vercel build for this branch (or the relevant redeploy) comes back green.

#### Follow-up — 2026-08-02: Vercel failed again on a genuinely clean `npm ci` — the real bug was a dependency-direction violation, not another caching artifact

- **Symptom:** After the `composite`/`tsbuildinfo` fix above (`eeef3a5`) merged to `master` via PR #47, Vercel's isolated build environment (no restored cache, no stale `.tsbuildinfo` — a truly fresh `npm ci`) still failed to build `domain-core`, again surfacing `Cannot find module '@athr/contracts'` from its `*.spec.ts` files. This ruled out the caching explanation given for the previous Follow-up: the failure now reproduced on an environment with nothing to go stale.
- **Root cause — a real dependency-direction violation, not a packaging or build-order gap:** `ATHR Dependency Rules v1.0` §3 is unambiguous — `@athr/contracts` MAY depend on `@athr/domain-core`; the reverse is forbidden. The Findings entry earlier in this WP ("`@athr/contracts` dependency-direction resolution") reasoned that keeping `@athr/contracts` under `domain-core`'s `devDependencies`, consumed only by `*.spec.ts` files via `import type`, was an acceptable exception because production code never imported it. That reasoning was wrong: a `devDependency` that an entire package's own build (`tsc -p tsconfig.json`, which has no test-file exclusion and always type-checks `*.spec.ts` alongside production sources) cannot compile without is not a soft/optional edge — it is a real, hard dependency of `@athr/domain-core` on `@athr/contracts`, pointed in exactly the direction §3 forbids. It happened to keep working in this session's own local reproductions and on GitHub Actions because of install/build-order/hoisting behavior specific to those environments; Vercel's isolated `npm ci` was the first environment to expose it cleanly and correctly. Vercel was not misbehaving — it was doing exactly what a forbidden reverse dependency should do when nothing papers over it.
- **Fix — removed the edge itself, not the symptom:**
  - `packages/domain-core/package.json`: dropped `@athr/contracts` from `devDependencies` entirely. `@athr/domain-core` now has zero package.json reference to `@athr/contracts`.
  - `packages/domain-core/src/{money,quantity,percentage}.spec.ts`: replaced the `import type { XWire as ContractsXWire } from '@athr/contracts'` round-trip assertions with the identical check against `domain-core`'s own already-existing, structurally-identical local `XWire` interfaces (`money.ts`/`quantity.ts`/`percentage.ts` each already declared their own `MoneyWire`/`QuantityWire`/`PercentageWire` — production code never needed the import; only the tests did, and only to prove a shape equivalence TypeScript's structural typing already guarantees without a nominal import). No behavior change: the same `assert.deepEqual` wire-shape assertions and `fromWire`/`toWire` round-trips still run, now typed against `domain-core`'s own exported interface instead of reaching upward into `@athr/contracts`.
  - Regenerated the root lockfile (`npm install`) to drop the now-removed `packages/domain-core` → `@athr/contracts` edge from `package-lock.json`.
- **`scripts/check-workspace.mjs` did not catch this before merge — investigated and closed, not just patched for this one case:** The checker had two independent gaps, both fixed:
  1. It had no concept of a *forbidden reverse edge* at all — only a hardcoded `forbiddenDomainDependencies` set for framework packages (`react`, `next`, `@nestjs/*`, etc.) on `domain-core`, and cycle detection over the declared-dependency graph. A one-directional edge that isn't a cycle (`domain-core` → `contracts`, with nothing pointing back) is invisible to cycle detection, and `@athr/contracts` was never in the framework-package set. Added a new `forbiddenReverseDependencies` map (`packages/domain-core` and `packages/error-registry` → `{@athr/contracts, @athr/testing}`, per §3's layering) and two new checks: one over each workspace's declared `package.json` dependencies (any group), one over actual `import`/`require`/`from` specifiers found by the existing source-file scanner — so both a declared-but-unused edge and an actually-imported one are caught, exactly the two forms this violation took (declared in `devDependencies` *and* imported in three `*.spec.ts` files).
  2. A genuine, independent cross-platform bug found while writing the regression test below: `workspaceDirectories()` built each package's directory identifier with `path.join('packages', name)`, which emits backslash-separated paths (`packages\domain-core`) on Windows, while every directory-keyed comparison in the file (`directory === 'packages/domain-core'`, the new `forbiddenReverseDependencies` map's keys, `directory.startsWith('packages/')`) is a forward-slash string literal. On Windows this silently no-ops every one of those checks, including the pre-existing `forbiddenDomainDependencies` check — the checker would report clean regardless of what `domain-core` actually imported. Fixed by building directory identifiers with an explicit `` `packages/${name}` `` instead of `path.join`, since these are logical labels compared against string literals, not literal filesystem paths (the actual filesystem reads still go through `path.join(root, directory, ...)`, which normalizes mixed separators correctly either way). This was not the cause of the Vercel failure (Vercel runs Linux, where `path.join` already emits forward slashes), but it means the checker was one platform away from silently no-op'ing on a developer's own Windows machine, which is worth closing regardless.
- **Regression test added, proven to fail without the fix:** `scripts/check-workspace.mjs`'s `validateWorkspace()` took a hardcoded module-scope `repositoryRoot`, making it untestable against anything but the real repo. Refactored it to accept a `root` parameter (defaulting to the real repository root for the CLI entry point, so `npm run workspace:validate`'s behavior is unchanged). `scripts/check-workspace.test.mjs` now builds a minimal, otherwise-fully-valid fixture workspace on disk (`mkdtempSync`) and asserts: (1) the clean fixture produces zero failures; (2) a fixture with `@athr/contracts` added to `domain-core`'s `devDependencies` *and* imported in a source file reproduces both new failure messages verbatim; (3) a fixture where `domain-core` imports `@athr/testing` without even declaring it still fails on the reverse-edge check specifically (not just the pre-existing "undeclared dependency" check). Ran all three against the pre-fix checker first to confirm they fail without the `forbiddenReverseDependencies` logic, then against the fixed checker to confirm they pass — this is a real regression test, not an assertion against the fix's own output.
- **Verification performed:** Fully wiped `node_modules`, all four `packages/*/dist`, `backend/dist`, `admin-web/.next`, `pos-electron/dist`+`dist-electron`, and any stray `.tsbuildinfo`, then ran a genuinely clean `npm ci` from the workspace root — `postinstall` built all four shared packages, `domain-core` included, with zero reference to `@athr/contracts` anywhere in its `package.json` or compiled output. `npm run workspace:validate` and `npm run test:workspace` (now 5 tests, all passing, including the two new regression tests) both pass. `packages/domain-core`'s own `npm run test` (build + `node --test`) passes 52/52. All four consumers verified against this same clean install: `backend` `npm run test:soft` (54/54 suites, 242/242 tests) + Nest build clean; `admin-web` `npm run build` (Next.js production build, 23 routes, unchanged from the WP-004 baseline) clean; `pos-electron` `npm run test:soft` (24 files / 105 tests, `vite build`, electron `tsc`) clean. Applied this fix directly to `master` (not the already-merged `feat/wp-004-core-value-objects` branch — PR #47 had already merged before this failure surfaced, so `master` itself carried the violation) and pushed; see commit message and CI/Vercel check results on that commit for the corresponding real, remote confirmation referenced below.
- **Why this is a different class of finding than every other WP-004 Follow-up above:** every prior Follow-up in this WP (`postinstall`, `composite`/`tsbuildinfo`) was a packaging/build-order/caching gap — the underlying architecture was correct, but installing or building it didn't reliably reproduce that correctness across environments. This one is not: the architecture itself was wrong, in a direction the project's own dependency rules explicitly name and forbid. It happened to be masked by environment-specific install behavior for long enough to pass this WP's own review, merge, and two rounds of "clean npm ci" verification that didn't happen to expose it — which is itself the reason `scripts/check-workspace.mjs` needed a structural fix (assert the graph's *legal edges*, not just its cycles) rather than a one-off correction, so the same class of violation cannot reach `master` silently again regardless of which environment's install quirks would or wouldn't have caught it this time.

---

- **Symptom:** Railway kept crash-looping (`Starting Container` / `Stopping Container` on repeat), but the error narrowed: no longer `Cannot find module '@athr/contracts'`, now `Cannot find module '/app/node_modules/@athr/contracts/dist/index.js'`. Live-endpoint check (`GET https://boldsystem-production.up.railway.app/api/v1/health/ready`) at the time returned `200` with `"commit":"5f7370688465eafa16c94b1ebb7c9fb386cebb5d"` — the pre-WP-003 baseline commit. Railway does not cut traffic to a new deployment until it passes its health check, so the crash-looping attempts were not the version actually serving production traffic; there was no live customer-facing outage, but the deploy pipeline itself was broken and, left alone, would have kept burning through `restartPolicyMaxRetries: 10` on every push.
- **Root cause — a bug in the previous fix, not a new bug:** The `627a6fc`/`8b7a798` fix's runtime-stage `COPY` line was `COPY --from=build .../packages/contracts/package.json .../packages/contracts/dist .../packages/contracts/` — a multi-source copy where one source (`dist`) is a directory. Docker's `COPY` copies a source directory's *contents* into the destination; it does not create a same-named subdirectory there. So `dist/index.js`, `dist/envelopes.js`, etc. landed directly at `packages/contracts/index.js`, `packages/contracts/envelopes.js` — the `dist/` nesting was silently discarded. `package.json`'s `"main": "./dist/index.js"` then pointed at a path that never existed in the image. The package was now correctly *linked* (this session's first fix worked), but its compiled output wasn't where its own `package.json` said it would be.
- **Why the previous verification didn't catch this:** That fix was "verified" by hand-reproducing the runtime-stage layout using `cp -r` in a scratchpad directory (Docker itself is not installed in this environment). Bash's `cp -r src_dir dest_dir/` preserves `src_dir` as a named subdirectory of `dest_dir` — the *opposite* of Docker's `COPY` semantics for a directory source. The hand-simulation was internally consistent but simulated the wrong tool's behavior, so it couldn't have caught this class of bug. Recorded here as the reason this round's fix was verified differently (see below).
- **Fix:** Split the combined multi-source `COPY` into two single-source `COPY` lines per package, each with an explicit, unambiguous destination (`.../packages/contracts/package.json` → itself, `.../packages/contracts/dist` → itself), removing any dependence on Docker's directory-flattening behavior producing the right result by coincidence.
- **Real verification this time, not another hand-simulation:** Docker is still not installed locally, so rather than hand-simulate again, added a new `docker-runtime-smoke` CI job that does the real thing on GitHub Actions' actual Docker daemon: `docker build` the production image from `backend/Dockerfile` (same file, same root build context CI already uses), `docker run` it against a real ephemeral Postgres service with production-shaped env vars, and curl `/api/v1/health/ready` in a retry loop, dumping container logs unconditionally. Triggered via `workflow_dispatch` on a throwaway branch (`fix/docker-runtime-dist-path`) *before* touching `master` again, per explicit instruction not to push blind. Run `30696110049`'s `docker-runtime-smoke` job passed for real: container logs show NestJS booting, both health routes mapping (`/api/v1/health/live`, `/api/v1/health/ready`), Prisma connecting, and the health check succeeding within seconds — genuine end-to-end proof, not a filesystem-layout proxy. This job is now wired into `release-gate` as a required check, closing the exact CI gap (no job ever built-and-ran the actual image) that let both this bug and the previous one reach Railway undetected.
- **Master timeline:** Verified the throwaway branch's single commit was a clean fast-forward of `master` (`657a6fc` + this one commit, no divergence), then pushed directly to `master` (`785c249`) only after the real `docker-runtime-smoke` result came back green. CI re-ran on `master` itself (run `30696443965`) as final confirmation.
- **Outstanding:** Railway's actual redeploy of `master` and the live health endpoint were not independently reconfirmed by this session after this push — check Railway's dashboard directly. Also outstanding: this session cannot determine from repo state alone whether Railway is configured to auto-deploy on push to `master` (that setting lives entirely in Railway's own dashboard, not in this repo) — recommended the user check Railway's project settings directly and disable auto-deploy for `master` if WP-003 work should not go live automatically.

---

### `WP-005 Phase A — Tenant Multi-tenancy ADRs — Blocked`

- **Started at:** 2026-08-02
- **Completed at:** 2026-08-02
- **Branch:** `docs/wp-005a-tenancy-adrs`
- **Pull request:** [PR #48](https://github.com/OsamaIbrhim/bold_system/pull/48) — open, not merged
- **Base SHA:** `86d6328ef0493573f5a9d0328913364c83f9efde` (master, PR #47 merge + forbidden-dependency-edge fix)
- **Head SHA:** `9723199f3bf0271f0f621c86bcc974ffb9c02ef2`
- **Status:** `Blocked` — waiting on Osama's review; each of the six documents must show `Status: Accepted` before WP-005 Phase B may start. Not a failure: Phase A's own acceptance criteria (§A.5 of the WP-005 document) treat "awaiting review" as the expected terminal state for this session.

#### Scope Implemented

- Completed the WP-005 §0 Mandatory Pre-Flight in full before writing anything: re-verified all seven WP-000–002 baseline markers directly against the working tree (root `package.json` workspaces declaration, all four `packages/*` scoped `package.json` files, `backend/scripts/prisma-migrate-deploy.cjs`, `scripts/check-workspace.mjs`, zero `bold-*` package names, 31 migration folders including the three named WP-000 migrations, POS `1.5.0`); confirmed WP-003/WP-004 markers (`packages/domain-core/src/money.ts`, `backend/src/common/http/athr-exception.filter.ts` both present; `packages/domain-core/package.json` has zero `@athr/contracts` reference, consistent with the `86d6328` fix already on `master`); read `backend/prisma/schema.prisma` in full; read all documents named in §0.5 in full (Tenant/Organization/Locations & User Membership Business Rules, Multi-tenancy Blueprint including §116, Database Blueprint, Entity Ownership Matrix, Code Gap Analysis §"Stage 2 Entry Gate" and §"Identifier Classification Matrix", ADR Catalog, existing `docs/adr/0001-npm-workspace-foundation.md`, Coding Standards §19, Git and Branching Strategy §18); confirmed clean `master` tree via `git fetch`/`git status`.
- Created `docs/wp-005a-tenancy-adrs` from `master`.
- Wrote all six required Phase A artifacts, each opening with the required `Status: Proposed` / `Author` / `Requires approval from` block and matching `docs/adr/0001-npm-workspace-foundation.md`'s established structure (extended with the ADR Catalog's fuller template — Alternatives Considered, Security/Data/Operational Impact, Compatibility and Migration, Validation/Acceptance, Review or Expiry — since the Catalog's own template requires those sections and 0001 predates that template):
  - `docs/adr/0002-tenant-data-ownership.md`
  - `docs/adr/0003-identity-membership.md`
  - `docs/adr/0004-location-warehouse.md`
  - `docs/adr/0005-authorization-entitlements.md`
  - `docs/adr/0006-platform-boundary.md`
  - `docs/runbooks/tenant-migration-backfill-rollback.md`
- Every open decision referenced in the WP-005 document's §A.3 was resolved with an explicit written choice and justification, not left as a menu: `OD-TEN-001` (one Legal Entity per Tenant for MVP), `OD-TEN-004`/`OD-TEN-005` (system roles first, allow-only permissions), `OD-TEN-006` (Location Scope auto-includes its own linked Warehouse; any other Warehouse relationship needs its own explicit grant), `OD-MT-001` (RLS deferred, not enabled), `OD-TEN-008` (Support Access consent-by-default with a narrow break-glass exception).
- Did not touch `schema.prisma`, create any migration, or modify any Backend/Admin/POS application code, per §A.4.
- Opened PR #48 with a description summarizing the concrete decision made in each document.

#### Files Changed

- `docs/adr/0002-tenant-data-ownership.md` (new)
- `docs/adr/0003-identity-membership.md` (new)
- `docs/adr/0004-location-warehouse.md` (new)
- `docs/adr/0005-authorization-entitlements.md` (new)
- `docs/adr/0006-platform-boundary.md` (new)
- `docs/runbooks/tenant-migration-backfill-rollback.md` (new)

Note: `docs/` is gitignored wholesale in this repository except for individually force-added engineering artifacts (`docs/adr/`, `docs/design-notes/`, a handful of top-level files); all six new files were force-added (`git add -f`) to be committed, matching how `docs/adr/0001-npm-workspace-foundation.md` is already tracked. The large Notion-exported planning corpus (Business Rules, Blueprints, Code Gap Analysis, this Delivery Log itself, and `docs/wp/*.md`) remains untracked local reference material, consistent with its current state on `master`.

#### Database and Migrations

- **Migration names:** None. No `schema.prisma` change, no new migration folder — explicitly forbidden in Phase A.
- **Clean database deploy:** N/A — no migration in this WP.
- **Populated upgrade:** N/A.
- **Schema drift check:** N/A.
- **Remote database changed:** No.

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Typecheck | N/A | Docs-only change; no source files touched. |
| Unit/Contract | N/A | Docs-only change. |
| Backend build | Not run | Not applicable to a docs-only PR; no reason to expect impact since zero Backend files changed. |
| Admin build/tests | Not run | Same reasoning. |
| POS build/tests | Not run | Same reasoning. |
| Migration gate | N/A | No migration exists in this WP. |
| Admin E2E | Not run | Not applicable. |
| Hard smoke/load | Not run | Not applicable. |
| Release gate | Pending | Standard CI will run against PR #48 on GitHub; expected to pass trivially since only new Markdown files under `docs/adr/` and `docs/runbooks/` were added, but this session did not independently trigger or observe that CI run. |

#### Deployment and Release

- **Railway:** No change.
- **Vercel:** No change.
- **Supabase:** No change.
- **POS release:** No change.

#### Findings and Blockers

- `docs/` is gitignored except for a small, deliberately force-added subset — this was not obvious from the WP-005 document alone and required investigation (`git check-ignore -v`, `git ls-files docs/`) before the six new files could be committed at all. Recorded here so a future session does not lose time rediscovering this.
- The ADR Catalog's own template (`docs/ATHR ADR Catalog v1.0` §6) is richer than `docs/adr/0001-npm-workspace-foundation.md`'s actual structure (0001 predates the Catalog's template — it has no "Alternatives Considered" or "Validation/Acceptance" sections). Resolved by using 0001's opening-block style (bulleted Status/Date/Work package) plus the WP-005-mandated `Status`/`Author`/`Requires approval from` header, then following the Catalog's fuller section list for the body, since the Catalog is the more authoritative and more recent naming/structure source and the WP-005 document explicitly names both as inputs.
- **Remaining blocker:** All six documents require Osama's explicit review and `Accepted` status change before Phase B (`feat/wp-005b-tenant-schema`) may begin, per the WP-005 document's hard stop at §A.5.2. This session did not proceed into Phase B and was explicitly instructed not to, regardless of session capability.

#### Deviations from Plan

- None identified against the WP-005 Phase A instructions as written.

#### Next Recommended Action

- Osama reviews PR #48 and either requests changes to any of the six documents (pushed as follow-up commits to `docs/wp-005a-tenancy-adrs`) or sets each document's `Status:` line to `Accepted` and merges.
- Do not begin WP-005 Phase B in any session until every one of the six documents shows `Status: Accepted` in the merged `master` copy — per §B.2 of the WP-005 document, this must be verified directly by reading the files at Phase B start time, not assumed from this log entry.

### `WP-006 — Identity, Membership and Permission Model — Partial`

- **Started at:** 2026-08-03
- **Completed at:** 2026-08-03 (implementation complete; every WP-006 gate green in CI — one unrelated repo-wide blocker remains, see Findings)
- **Branch:** `feat/wp-006-identity-membership-permission`
- **Base SHA:** `3145985` (merge of WP-005 Phase B into `master`)
- **Head SHA:** `904aab3` (PR [#51](https://github.com/OsamaIbrhim/bold_system/pull/51))
- **Status:** `Partial` — every WP-006 acceptance criterion is met and verified, **including the Docker and migration gates, which ran in CI rather than locally**. The PR is nonetheless still red because of `npm audit --audit-level=high`, a pre-existing repo-wide advisory that has nothing to do with this WP (see Findings). Recorded as `Partial` rather than `Passed` because §10 forbids claiming done while the PR's required checks are red, whatever the cause.

> **Correction to the first version of this entry.** It was originally written claiming the Docker build/run + `/health/ready` gate was simply "not run" because Docker is not installed on this machine. That was true at the time of writing, but incomplete as a conclusion: CI *does* run that gate (`docker-runtime-smoke`), and when it ran it **failed** — surfacing a real WP-006 defect that every local gate had missed. See "The Docker gate caught a real defect" below. The tables and findings in this entry have been updated to reflect what actually happened.

#### Scope Implemented

- **TenantContext** (`tenant-context.type.ts`): matches Multi-tenancy Blueprint §20 field-for-field — all 15 fields. Resolver exists as a NestJS provider only; **not** wired as a global guard (WP-007's job, per §3).
- **Membership lifecycle** (`membership.service.ts`): state machine taken **verbatim from `BR-MEM-101`**, not the WP document's own paraphrase — `invited → pending_verification → active ⇄ suspended`, terminal `deactivated`, renewable `expired`. Per pre-flight item 4, the Business Rules text wins over the WP doc's summary; the WP doc's `Invited → Active → Suspended → Revoked` is a four-state simplification, and there is no `revoked` Membership state in the BR document (`revoked` exists on Invitation only).
- **Invitation flow** (`invitation.service.ts`): create / accept / expire / revoke, token-hash based.
- **System roles + PermissionPolicy** (`system-roles.ts`, `permission-policy.service.ts`): fixed `MembershipRole` enum values from WP-005 Phase B — no invented role names. Permission catalog drawn from `BR-ADM-100`; allow-only union per ADR-0003 item 5. Versioned and snapshot-resolvable (ADR-0005), one active global snapshot, idempotent seed with a P2002 race guard for concurrent instances.
- **Access Scope** (`access-scope.service.ts`): explicit scope required; empty/absent scope is a validation failure, never an implicit tenant-wide grant (`BR-SCP-101`).
- **Last-owner safeguard** (`BR-OWN-100`): enforced in `MembershipService` and routed through by *every* mutation path (`transition`/`suspend`/`reinstate`/`deactivate`/`expire`/`changeRole`), so no endpoint can bypass it.
- **Platform Support Access grants** (ADR-0006 / `BR-SUPA-*`): time-boxed, audited, four `SupportAccessMode` levels; data model + service only, no support UI.
- **Session/token dual-compatibility** (MT-MIG-005): `tenant_id`, `membership_id`, `scope_set`, `permission_policy_version` added additively to both the JWT payload and the session `user` object. Every pre-existing claim/field is unchanged. When no active Membership exists the new fields are `null`/`[]` — always present, never omitted, never throwing.

#### Files Changed

- New: `backend/src/identity/**` (26 files — services, tenant-scoped repositories, controllers, DTOs, specs), `backend/src/auth/identity-claims.ts`, `backend/src/auth/dual-compatibility.spec.ts`, `backend/prisma/migrations/202608030001_add_identity_membership_permission_tables/migration.sql`.
- Modified: `backend/prisma/schema.prisma` (additive tables only), `backend/src/auth/{auth.service,auth.module,jwt.strategy,authenticated-user}.ts` and their specs, `backend/src/app.module.ts` (register `IdentityModule`), `backend/package.json` + `package-lock.json` (add `@athr/domain-core` dependency), `backend/scripts/prisma-migrate-deploy.test.cjs`.
- **Zero changes** to `sales`, `inventory`, `catalog`, `customers` or any other existing domain module — verified against `git status`.

#### Database and Migrations

- **Migration name:** `202608030001_add_identity_membership_permission_tables`.
- **Additive-only:** verified — a grep for `DROP`/`ALTER COLUMN`/`SET NOT NULL`/`RENAME`/`DELETE FROM`/`TRUNCATE` over the migration returns nothing. Four new tables (`Invitation`, `AccessScopeAssignment`, `PermissionPolicySnapshot`, `SupportAccessGrant`), three new enums, indexes, and FKs pointing *from* the new tables *to* existing `Tenant`/`Membership`.
- **`tenant_id` still nullable everywhere; no composite FKs; no tenant-scoped uniqueness constraints added; legacy `Role` enum and `branch_id` untouched.**
- **Clean database deploy / populated upgrade / schema drift check:** **not run in this session** — no database was reachable from this environment. These remain to be verified in CI or against a real database before merge.
- **Remote database changed:** No.
- **Note carried forward from WP-005 Phase B:** `prisma migrate dev --create-only` again emitted unrelated `DropForeignKey`/`AlterTable`/`AddForeignKey` churn against `InventoryCostMovement`, `InventoryMovement`, `PurchaseInvoice`, `SupplierReturn`, `SupplierReturnItem`, `TransferTransitMovement` — the same pre-existing `gen_random_uuid()` DB-default-vs-Prisma-app-default drift baked in since those tables' original 2026-07 migrations. It was stripped from the migration file by hand so this migration only ever touches the four new tables. **This drift is still unresolved repo-wide and will keep resurfacing on every future `migrate dev` until someone fixes it deliberately.**

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Typecheck | Passed | `tsc --noEmit` clean across all workspaces. |
| Unit/Contract | Passed | Backend: **62 suites / 314 tests passed**. Identity + auth subset: **13 suites / 86 tests passed**. POS: 24 files / 105 tests passed. |
| Backend build | Passed | `nest build` clean, including on a fresh `npm ci` tree. |
| Admin build/tests | Passed | Green via root `npm run test:soft` (exit 0). |
| POS build/tests | Passed | `tsc && vite build && tsc -p tsconfig.electron.json` — built in 1.37s. |
| Clean `npm ci` proof | Passed | Root `npm ci` from lockfile → 0 vulnerabilities → `postinstall`/`build:shared` green → full root `test:soft` re-run green (exit 0) on the freshly installed tree. This is the WP-005 §0.3 hardened criterion, and it was actually run, not assumed. |
| Docker build/run + `/health/ready` | **Failed, fixed, then Passed** | Docker is not installed on this machine, so this ran in CI (`docker-runtime-smoke`). **The first run failed** — the image built, then the container died at boot with `Cannot find module '@athr/domain-core'`. Fixed in `269a34b`; **re-run passed in 2m44s**. |
| Migration gate | Passed | Ran in CI against a real Postgres 16 service; `prisma migrate deploy` applied cleanly (2m43s). |
| Admin E2E | Passed | `admin-e2e-smoke` green in CI (2m30s). |
| Hard smoke/load | Passed | `hard-smoke` green (1m44s); `hard-load` skipped by workflow config. |
| Windows installer | Passed | Green in CI (4m16s). |
| `npm audit --audit-level=high` | **Failed** | **Pre-existing and unrelated to this WP** — see Findings. Fails in both the `backend` and `pos` jobs and cascades into `release-gate`. |
| Release gate | Failed | Cascades from the `npm audit` failure above. No WP-006 code gate is red. |

**Dual-compatibility regression test** — the WP document calls this "the single most important test in this WP". Implemented in `backend/src/auth/dual-compatibility.spec.ts` with an explicit `readAsOldShapeConsumer()` helper that reads *only* the pre-WP-006 fields (`sub`/`role`/`branch_id` from the token; `id`/`name`/`role`/`branch_id`/`capabilities` from `user`). Four cases pass: an old-shape consumer sees identical shape and values both with and without an active Membership; new claims are present additively when a Membership exists; new claims are `null`/`[]` rather than absent when none does.

#### Deployment and Release

- **Railway:** No config change. Worth recording that `railway.toml` runs `npm run prisma:migrate:deploy` as a `preDeployCommand`, i.e. **migrations apply before the new container serves traffic**. This matters for this WP specifically: `PermissionPolicyService.onModuleInit` seeds the policy snapshot at boot, and `resolveIdentityClaims` reads `Membership`/`AccessScopeAssignment` on every login, so both depend on the new tables existing. The pre-deploy ordering makes that safe on Railway — but it is now a real ordering dependency where none existed before.
- **Vercel:** No change. **Supabase:** No change (migration not yet applied). **POS release:** No change.

#### Findings and Blockers

- **The Docker gate caught a real defect that every other gate missed — this is the single most important finding of this WP.** WP-006 added `@athr/domain-core` to `backend/package.json`. The backend Dockerfile's runtime stage copies each shared package's build output in by hand (`packages/contracts`, `packages/error-registry`), and `domain-core` was never added to that list. Line 38 copies the `node_modules/@athr` symlink tree, so the *symlink* to `domain-core` existed while its *target* did not. Consequence: the image builds perfectly, `prisma migrate deploy` succeeds, and then the container dies at startup with `Error: Cannot find module '@athr/domain-core'` / `MODULE_NOT_FOUND`. **This would have been a production outage on the next Railway deploy.** Nothing local catches it: typecheck, all 314 backend tests, `nest build`, POS build, Admin build, and even a clean `npm ci` all pass, because outside the container the workspace symlinks resolve fine. Only a real container run exposes it. Fixed in `269a34b`.
  - **This is the third work package bitten by this same class of bug** (the WP-003/004 lesson that §0.3 of WP-005 exists to codify). So the fix ships with a guard: `scripts/check-workspace.mjs` now asserts that every `@athr/*` dependency in `backend/package.json` has a matching runtime-stage `COPY` of its `dist`. It runs inside `npm run workspace:validate` (part of root `test:soft` and the `workspace-foundation` CI job) and **needs no Docker daemon**, so the next session catches this locally instead of in CI. Verified both directions: it emits the exact missing-`COPY` failure before the fix and passes after, with fixture cases added to `scripts/check-workspace.test.mjs` (`904aab3`).
  - **Process lesson worth carrying forward:** "cannot run gate X here" is not the same as "gate X is unverifiable" — CI could run it all along. Push early and read CI rather than recording a gate as simply unrun.
- **Blocker (the reason this entry is `Partial`, and it is *not* a WP-006 defect):** `npm audit --audit-level=high` fails in the `backend` and `pos` jobs on `brace-expansion` 4.0.0–5.0.8, a high-severity DoS advisory ([GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895)). **This branch does not touch that dependency** — `git diff master...HEAD -- package-lock.json` returns **zero** `brace-expansion` lines; the only lockfile change is the one-line `@athr/domain-core` declaration. Master's last CI run passed at 05:00 UTC on 2026-08-03, so the advisory was published after that; `master` would fail the same audit today. Fixing it means a dependency bump that is out of WP-006's scope and should land on its own branch — but PR #51 cannot go green until it does, so it is a hard merge blocker regardless of ownership.
- **Migration/database gates:** originally recorded as unverifiable here (no reachable database). They ran green in CI instead — `migration-gate` and `docker-runtime-smoke` both applied `prisma migrate deploy` against a real Postgres 16 service.
- **New boot/login dependency on the new tables** (see Deployment above). Safe under Railway's current pre-deploy ordering; flagged because `resolveIdentityClaims` has no try/catch, so if the `Membership`/`AccessScopeAssignment` read ever throws, login fails rather than degrading to the pre-WP-006 claim set. Deliberately left as-is rather than silently swallowing errors — but WP-007 should revisit it when this path becomes load-bearing for every request.
- **No WP-005 Phase B entry exists in this Delivery Log**, despite Phase B having been merged as `d012c4c`. Pre-existing gap from an earlier session, recorded here so it is not lost; this session had no evidence from that run to reconstruct it.
- The Delivery Log itself remains untracked local reference material (`docs/` is gitignored except individually force-added engineering artifacts), so this entry is **not** part of the WP-006 commit — consistent with how the WP-005 Phase A entry was handled.

#### Deviations from Plan

- **Folder layout:** the WP document's §5 predicted `backend/src/modules/identity/<subfolder>/`. There is no `backend/src/modules/` directory in this repository — every existing module lives flat at `backend/src/<module>/`. Per §5's own instruction ("confirm exact naming/folder conventions against 2-3 existing modules … match house style, don't invent a new pattern"), the code went to a flat `backend/src/identity/` instead. This is compliance with that instruction, not a departure from it.
- **Membership state names:** used `BR-MEM-101`'s six states verbatim rather than the WP document's four-state paraphrase — explicitly what pre-flight item 4 requires when the two disagree. Documented inline in `membership.service.ts`.
- **One non-tenant-scoped repository method:** `InvitationRepository.findByTokenHash(tokenHash)` takes no `TenantContext`, because an accept-invitation request arrives carrying only a bearer token and the Tenant is *derived from the invitation row* rather than asserted by the caller. This is a token lookup, not a cross-tenant read; documented inline. Every other repository method across all four repositories takes a `TenantScope`/`TenantContext` first parameter — no bare `findById(id)` anywhere else in this WP's code.

#### Next Recommended Action

- **Resolve the `brace-expansion` advisory on its own branch** (`npm audit fix` or a targeted override), merge it to `master`, then rebase PR #51 on it. That is the only thing standing between this PR and an all-green check set — every WP-006 gate is already green, including Docker and migrations. Once it is green, flip this entry from `Partial` to `Passed`.
- PR [#51](https://github.com/OsamaIbrhim/bold_system/pull/51) is open with the full evidence in its description. Do not squash-merge while any required check is red — §10 forbids it explicitly.
- WP-007 picks up from here: global guard wiring, `tenant_id` `NOT NULL`, legacy `Role`/`branch_id` removal, and the data/repository half of MT-MIG-005.

---

### `WP-008 Phase A — Catalog Foundation (Brand, UOM, Assortment) — Passed`

- **Started at:** 2026-08-06
- **Completed at:** 2026-08-06
- **Branch:** `feat/wp-008a-catalog-foundation` (PR [#63](https://github.com/OsamaIbrhim/bold_system/pull/63))
- **Base SHA:** `master` at branch time (commit `b26a6a4`, after PR #62 merged).
- **Head SHA:** `2349895`
- **Status:** `Passed` — merged, deployed, `/api/v1/health/ready` confirmed `ok` by Osama.

#### Scope Implemented

- `Brand` entity (tenant-owned, archivable), replacing `Product.brand` free text with `Product.brand_id` FK. Data migration creates one `Brand` row per distinct `(tenant_id, trimmed brand string)` with a validation query proving zero data loss/duplication; the legacy `Product.brand` string column is left untouched (additive, not destructive).
- `UnitOfMeasure` + `UomConversion`: versioned, no update path — only create (v1) and supersede (new version, prior row marked superseded, factor never mutated). Conversion factor DB-constrained positive.
- `Assortment`: per-Branch `sellable`/`purchasable`/`displayable` flags, distinct from the existing tenant-wide `Product.is_active`. Keyed on `Branch`, not the `Location` model — deliberate and verified: `Location` exists in the schema since WP-005 but has zero application-code references anywhere in `backend/src` (confirmed independently via full-repo grep before approving), so every operational module including this one correctly follows the `Branch`-based precedent WP-007 already established across all 18 retrofitted modules.
- Item type classification on `ProductVariant` (`stocked`/`non_stock`/`service`/`bundle_kit_placeholder`), defaulting existing rows to `stocked` (zero behavior change), with a change restriction once the variant has transaction history (checked across inventory movements, sales/purchase/transfer/return items).
- Three new modules (`brands`, `uom`, `assortment`) on the `findById(context,id)/list(context,filters)/save(context,aggregate)` contract from WP-007; cross-tenant isolation specs per new table plus new `products.cross-tenant.spec.ts` cases for `brand_id`/`item_type`.
- Permission Matrix §16 keys added (`catalog.brand.manage`, `catalog.uom.view/create/update`, `catalog.uom-conversion.publish`, `catalog.assortment.view/manage`), granted to `warehouse_manager` (inherited by `location_manager`/`tenant_owner`). `PERMISSION_POLICY_CURRENT_VERSION` bumped 3→4 **in the same PR** — the lesson from WP-007 Phase C's missed version bump was correctly applied this time without being re-prompted.

#### Files Changed

- `backend/prisma/migrations/202608060001_add_brand_table` through `202608060006_add_assortment_table` (6 migrations).
- `backend/src/brands/**`, `backend/src/uom/**`, `backend/src/assortment/**` (new modules).
- `backend/src/products/**` (brand_id/item_type retrofit, new cross-tenant spec cases).
- `backend/src/identity/permission-catalog.ts` (new §16 keys, version 3→4).

#### Database and Migrations

- Migration names: `202608060001_add_brand_table`, `202608060002_add_product_brand_id_backfill`, `202608060003_add_unit_of_measure_table`, `202608060004_add_uom_conversion_table`, `202608060005_add_productvariant_item_type_base_uom`, `202608060006_add_assortment_table`.
- Clean database deploy: Passed (CI).
- Populated upgrade / production deploy: **Passed** — confirmed directly from Railway deploy logs: `athr_migration_runner_started` → all 6 migrations listed and applied in order → `athr_migration_runner_succeeded` → `Database schema is up to date!` → NestJS boot log shows all modules initializing cleanly → `Nest application successfully started`. No exceptions in the boot log; all "error"-severity lines in the raw log are npm's own harmless version-notice output, not application errors (verified by inspection, not assumed).
- Schema drift check: Implied clean by the above; not separately itemized.
- Remote database changed: Yes — `Brand`, `UnitOfMeasure`, `UomConversion`, `Assortment` tables created; `Product.brand_id` and `ProductVariant.item_type`/base UOM columns added and backfilled.

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Monorepo typecheck | Passed | |
| Shared-package builds | Passed | |
| Backend build | Passed | |
| Backend Jest suite | Passed | 83 suites / 448 tests (up from 80/422 after WP-007 Phase C). |
| Docker build/run/health | Unverified locally, relies on CI | No Docker daemon in the CLI's environment — reported unverified per standing rule, not assumed. |
| CI (first run) | **Cancelled after 15m, all jobs** | Investigated, not assumed pre-existing/unrelated: re-triggered: subsequent run completed normally. Cause consistent with GitHub Actions concurrency-based auto-cancellation from a same-branch push during the run, not a code or infra failure. |
| Production deploy + migration | **Passed** | See Database and Migrations row above — verified directly from Railway logs, not just claimed. |
| Live `/api/v1/health/ready` | Passed | Confirmed `ok` by Osama post-deploy. |

#### Deployment and Release

- Railway: Deployed. Migration applied cleanly (6/6), app boot clean, `/api/v1/health/ready` confirmed `ok` by Osama.
- Vercel: No Admin UI change in this phase.
- Supabase: Schema-mutating — 4 new tables, 2 new/backfilled columns on existing tables, all confirmed applied via deploy logs.
- POS release: N/A.

#### Findings and Blockers

- **`Location` vs `Branch` duality confirmed as a real, pre-existing architectural gap, not something this phase should fix.** `Location` (Tenant→OrganizationProfile→LegalEntity→Location→Warehouse hierarchy from WP-005) has zero code references anywhere in `backend/src`; every operational module (including all 18 retrofitted in WP-007, and now `assortment` here) uses `Branch`. This WP correctly followed the existing precedent rather than introducing a second, disconnected pattern. Worth a future WP or ADR addendum to either formally deprecate `Location` or plan its eventual adoption — not blocking, but the duality should stop being silently repeated by every new WP without a decision.
- CI's first run cancelling across all jobs simultaneously was investigated rather than re-run blindly — consistent with standard GitHub concurrency-cancellation behavior from a same-branch push, not a masked failure.
- No ambiguous data encountered in the `Product.brand` string→entity migration; validation query confirmed zero loss/duplication.

#### Deviations from Plan

- None materially out of scope. Keying `Assortment` on `Branch` instead of the BR doc's literal prose ("Location") is a deliberate, disclosed, and verified deviation — not a silent shortcut — consistent with WP-007's established precedent across the entire retrofitted codebase.

#### Next Recommended Action

- **Closed.** WP-008 Phase B (Price Books and Pricing Evaluation) is next and unblocked — this is the phase that replaces the flat `PricingRule` formula, not a zero-behavior-change phase; say so plainly when kicking it off.

---

### `WP-007 Phase C — POS Enrollment Cutover (MT-MIG-007) — Passed`

- **Started at:** 2026-08-05
- **Completed at:** 2026-08-06
- **Branch:** `feat/wp-007c-pos-enrollment-cutover` (PR [#57](https://github.com/OsamaIbrhim/bold_system/pull/57), merged), plus follow-on hotfixes surfaced by live-device testing: `chore/pos-electron-security-bump` (PR [#59](https://github.com/OsamaIbrhim/bold_system/pull/59), version bump + release pipeline repair; PR #58 was an accidental duplicate of the same commit, closed as a no-op), `fix/pos-cashier-heartbeat-permission-500` (PR [#60](https://github.com/OsamaIbrhim/bold_system/pull/60), rebased once onto PR #61's electron bump), `chore/pos-electron-security-bump` for the actual Electron 39.8.9→39.8.10 advisory fix (PR [#61](https://github.com/OsamaIbrhim/bold_system/pull/61)), `fix/permission-policy-version-bump` (PR [#62](https://github.com/OsamaIbrhim/bold_system/pull/62)).
- **Status:** `Passed` — merged, deployed, and independently confirmed by Osama on a real POS device: online sale synced, full offline sale synced correctly after reconnect.

#### Scope Implemented

- Enrollment response and POS local device state now carry `tenant_id` explicitly (`BR-TRM-101`/`BR-ENR-102`), rather than only inheriting it implicitly server-side.
- `TerminalsService.authenticate()` — the shared choke point behind pull/heartbeat/return/invoice-lookup/offline-context/self-decommission — hardened to reject a tenant mismatch unconditionally. The prior check (`actor.tenant_id && existing.tenant_id && existing.tenant_id !== actor.tenant_id`) silently skipped the comparison whenever either side was falsy; now `existing.tenant_id !== actor.tenant_id` is asserted unconditionally.
- Client-side self-heal (`reconcileDeviceTenantId`, wired into the existing heartbeat call): a terminal enrolled before this release learns its `tenant_id` from the next heartbeat response with zero re-enrollment. Defensive: only applies when the heartbeat's terminal id matches the locally enrolled device, never blanks an already-known `tenant_id`.
- POS release version bumped `1.5.0` → `1.5.1` (PR #59) — required because `pos-electron/electron/main.ts` changed, and the auto-updater gates purely on version string; an unchanged version would have meant already-installed devices never detected this build. Caught before merge by direct inspection of `update-policy.ts`, not assumed.

#### Files Changed

- `backend/src/terminals/terminals.service.ts`, `terminals.service.spec.ts`, `terminals.cross-tenant.spec.ts`.
- `pos-electron/electron/device-tenant-migration.ts` (new), `device-tenant-migration.test.ts` (new), `main.ts`, `diagnostics-runtime.ts`.
- `pos-electron/src/types.ts`, `api.test.ts`.
- `pos-electron/package.json` (version 1.5.0→1.5.1, then Electron 39.8.9→39.8.10 in PR #61).
- `backend/src/identity/permission-catalog.ts` (cashier `terminal.view-health` grant + `PERMISSION_POLICY_CURRENT_VERSION` 2→3, across PR #60/#62).
- `backend/src/common/api-error.filter.ts` (maps `AthrDomainError` to its real registered status/code instead of defaulting to a fake 500).

#### Database and Migrations

- Migration names: none — `check-migration-policy.cjs` confirmed no new DB migration was needed; Phase B already did the `NOT NULL`/backfill, so this phase's "migration path" is the POS client catching up, not a schema change.
- Clean database deploy: N/A (no migration).
- Remote database changed: Only via the permission policy snapshot re-seed triggered by PR #62's version bump (application-level seed, not a schema migration).

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Backend regression | Passed | 422/422 (up from 419 after Phase B), 80/80 suites. |
| POS build/tests | Passed | 110/110. |
| Admin | Unaffected | 38/38. |
| Docker build/run/health | Unverified locally, passed in CI | Standing rule followed. |
| Live POS device test (Osama, post PR #62) | **Passed** | Real pre-existing terminal: online sale created and synced; full offline sale created while disconnected, synced correctly after reconnect. This is the acceptance bar §C.5/§C.6 actually require — not just CI green. |

#### Deployment and Release

- Railway: Deployed across PR #57, #60, #61, #62; `/api/v1/health/ready` confirmed `ok` after each by Osama.
- POS release: `athr-pos-v1.5.1` published with the version-bump/release-pipeline fix from PR #59.
- Supabase: No schema change; permission policy snapshot re-seeded to version 3 on next boot after PR #62.

#### Findings and Blockers

- **Real regression caught by live-device testing that no automated gate caught.** The initial device test failed with a fake HTTP 500 (`INTERNAL_ERROR`) on sync. Root-caused via the `request_id` and Railway logs (not guessed) to two compounding bugs: (1) the cashier role's Phase A permission derivation omitted `terminal.view-health`, even though the legacy `RolesGuard` had always allowed cashier on the heartbeat route — a genuine Phase A "zero behavior change" violation; (2) `ApiExceptionFilter` defaulted every unhandled `AthrDomainError` (permission denials, tenant-context failures, etc.) to a fake 500 instead of its real status/code, masking the true cause of *any* future permission/tenant-context denial on a non-opted-in route, not just this one. Both fixed in PR #60.
- **A second regression, caught before it reached production.** PR #60's fix didn't visibly take effect after deploy — cashier still denied. Root-caused (not guessed) to `PERMISSION_POLICY_CURRENT_VERSION` not being bumped: `PermissionPolicyService.ensureSeeded()` only re-derives and activates a new snapshot when the code's version constant exceeds the DB's active row, so production kept serving the frozen pre-fix grants JSON. The 403-vs-500 signature (proving the exception-filter half of #60 was live while the grant half silently wasn't) was the diagnostic tell. Fixed in PR #62 (version 2→3). This is the same class of "version bump makes the change visible to already-seeded environments" lesson from WP-006/Phase A, now hit a third time — worth naming as a standing pattern: **any permission-catalog or policy-shape change must bump `PERMISSION_POLICY_CURRENT_VERSION` in the same PR**, and this should probably become an automated CI check rather than a manually-remembered rule.
- **Third, unrelated regression caught and self-fixed during the Electron bump (PR #61).** A plain `npm install` during lockfile regeneration hoisted `ms` (a transitive dep of `jsonwebtoken`) from three per-workspace nested copies to one root copy. `backend/Dockerfile` uses `--install-strategy=nested` and only copies `backend/node_modules` into the production image, so the hoisting would have broken the container (`Cannot find module 'ms'`) — the fourth occurrence of this general bug class (shared/hoisted dependency not matching what the Docker runtime image actually copies). Caught and fixed by the CLI itself before it reached CI, by regenerating with `--install-strategy=nested` to match the Dockerfile exactly.
- **Fourth, pre-existing and unrelated finding.** `pos`/`release-gate` CI jobs were red on PR #60 before the Electron bump — confirmed (not assumed) to also fail on `master`'s scheduled nightly run from the same morning, caused by an Electron security-advisory database update overnight, unrelated to any code in this WP. Correctly sequenced: fixed on its own PR (#61) first, then #60 rebased onto it — same pattern as the `brace-expansion` precedent from WP-006.
- PR #58 (an independently cherry-picked duplicate of PR #59's exact fix commit, opened before the CLI knew #59 existed) was correctly closed as a no-op after a diff against `master` came back empty — not merged, no redundant history introduced.

#### Deviations from Plan

- None out of scope. Every fix in this sequence (permission grant, exception filter, policy version, Electron bump, npm hoisting) was either a direct consequence of Phase C's own change or a pre-existing issue correctly isolated onto its own PR rather than folded in silently.

#### Next Recommended Action

- **Closed.** Phase C is the one phase where a live device check outranks a health endpoint (§C.7), and that check passed cleanly: online sale, full offline sale, and post-reconnect sync all confirmed by Osama on a real, pre-existing terminal.
- **Phase D (MT-MIG-008, legacy `Role` enum / `branch_id` removal) does not start automatically.** Per §D.2, it requires Osama's separate, explicit go-ahead confirming enough production bake time has passed on Phases A–C with zero incidents — do not infer this, ask when the time comes.
- Worth raising as a process improvement, not urgent: consider a CI check that fails if `permission-catalog.ts`'s grant sets change without a matching `PERMISSION_POLICY_CURRENT_VERSION` bump, given this is now a repeat failure mode.

---

### `WP-007 Phase B — Hard Database Constraints (MT-MIG-006) — Passed`

- **Started at:** 2026-08-05
- **Completed at:** 2026-08-05
- **Branch:** `feat/wp-007b-tenant-constraints` (PR [#54](https://github.com/OsamaIbrhim/bold_system/pull/54)), plus two standalone hotfix PRs merged first: `fix/seed-ledger-tenant-id` (PR #56) and one other pre-existing seed-script bugfix (PR #55) — both fixing bugs the new constraints correctly surfaced, not caused.
- **Base SHA:** `master` at merge time.
- **Head SHA:** `f378d4f` (merge commit on `master`).
- **Status:** `Passed` — merged, deployed, Railway `/api/v1/health/ready` confirmed `ok` by Osama, and full post-merge re-verification against `master`'s head confirmed clean (see below).

#### Scope Implemented

- 112 migrations: `tenant_id SET NOT NULL` on 32 tables, composite same-tenant foreign keys on 49 relationships, tenant-scoped uniqueness replacing global-unique constraints on 11 columns, a `SyncChange.tenant_id` backfill, and one trigger fix-forward (see Findings).
- `backend/scripts/verify-tenant-constraints.cjs` — a dedicated database-level proof (not application-code assertions) that every new constraint genuinely rejects cross-tenant references/duplicates while still allowing the same value across two different tenants. Wired into CI's `migration-gate` job against a real, freshly-migrated throwaway Postgres.

#### Files Changed

- `backend/prisma/migrations/2026080400xx_*` through `202608040112_fix_ledger_triggers_tenant_id` (112 migration folders).
- `backend/scripts/verify-tenant-constraints.cjs` (new).
- `backend/prisma/schema.prisma` (NOT NULL, composite FK, tenant-scoped unique annotations).

#### Database and Migrations

- Migration names: 112 total; last is `202608040112_fix_ledger_triggers_tenant_id` (the trigger restoration, see Findings).
- Clean database deploy: Passed (CI `migration-gate`, `athr_migrations_clean`).
- Populated upgrade: Passed (each constraint migration tested clean + populated per standing discipline; pre-migration validation queries confirmed zero violating rows before each `NOT NULL`/constraint was applied).
- Schema drift check: Passed (implied by green `migration-gate`; not separately called out in the CLI's report — acceptable given the constraint-proof script is a stronger signal than drift alone for this WP).
- Remote database changed: Yes — deployed to Railway/Supabase production via the merge; confirmed via Railway health.

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Full CI check set (PR run) | Passed | workspace-foundation, backend, admin, pos, migration-gate, docker-runtime-smoke, admin-e2e-smoke, hard-smoke, release-gate — all green. |
| Post-merge CI on `master` @ `f378d4f` | Passed | Run 30976695090, triggered automatically by the merge push — every job green (`hard-load` skipped by design, non-smoke mode). |
| `verify-tenant-constraints.cjs` (post-merge, on `master`) | 70/70 pass | 48 composite-FK cross-tenant-rejection checks + 22 tenant-scoped-uniqueness checks (11 constraints × 2: same-tenant duplicate rejected, cross-tenant same-value allowed). Byte-for-byte identical output to the pre-merge PR run. |
| Cross-tenant isolation catalog (post-merge, on `master`) | 99/99 pass, 18/18 suites | In-memory harness (`FakeTable`, no DB connection) run locally against the exact merge-commit code. Suite list and pass count identical to the original PR run — zero diff. |
| Full backend regression | Passed | 419/419 (unchanged count from Phase A). |

#### Deployment and Release

- Railway: Deployed. `GET /api/v1/health/ready` confirmed `ok` by Osama directly after merge.
- Vercel: No Admin UI change reported.
- Supabase: Schema-mutating — all 112 migrations applied to the production database via the merge/deploy.
- POS release: N/A (Phase C's scope).

#### Findings and Blockers

- **A real transcription bug, caught by CI and independently verified by me before recommending merge.** Migration `202608040112_fix_ledger_triggers_tenant_id`'s first version of `record_inventory_cost_movement` was rewritten from a truncated read of the original `202607280002_acceptance_first_negative_stock` migration — the read stopped partway through the function body. That silently dropped real business logic: the calculated-cost range check, the `purchase_reversal`/`supplier_return` validation branches, the "unsupported movement type" fallback, the negative-deficit guard, the negative-cost guard, and critically the `negative_inventory_units_covered` metadata calculation used by the negative-stock coverage policy. CI's `hard-smoke` job caught it via its "Negative inventory cost coverage policy failed" assertion. Fixed in a follow-up commit (`6d0ac6f`) that rewrote the function body to the verified-complete original plus only the `tenant_id` additions. **I independently reviewed this diff via `git show` before recommending merge** — confirmed the restoration is complete and matches the commit message's claim line-for-line, not just asserted.
- Two pre-existing seed-script bugs (opening-balance ledger rows not stamped with `tenant_id`, and another) were correctly surfaced by the new NOT NULL constraints and fixed via standalone PRs #55/#56, merged to `master` before PR #54 — correct sequencing, not scope creep into this WP.
- No regressions found in post-merge re-verification; `verify-tenant-constraints.cjs` and the full cross-tenant catalog are byte-for-byte/count-for-count identical between the pre-merge PR run and the post-merge `master` run.

#### Deviations from Plan

- None flagged. Schema drift check wasn't separately itemized in the CLI's report (see Tests table note) — not treated as a gap given the stronger constraint-level proof, but worth asking for explicitly next time a schema-migration WP closes.

#### Next Recommended Action

- **Closed.** §B.8's requirement to re-run the full cross-tenant catalog against production-shaped data post-merge is satisfied. Phase B of WP-007 is confirmed solid.
- **Phase C (MT-MIG-007) is next and unblocked:** POS terminal enrollment cutover to explicit tenant binding. This is the one phase where a live POS device check matters more than an API health endpoint (§C.7) — Osama's explicit device-level confirmation is required before Phase D, not just Railway health.

---

### `WP-007 Phase A — Tenant Context Enforcement (MT-MIG-005) — Passed`

- **Started at:** 2026-08-04
- **Completed at:** Not yet — PR open, not merged.
- **Branch:** `feat/wp-007-phase-a-tenant-context-enforcement` (PR [#53](https://github.com/OsamaIbrhim/bold_system/pull/53))
- **Base SHA:** not recorded in the CLI report; confirm against PR diff base before merge.
- **Head SHA:** not individually recorded; 11 commits, one identified explicitly as `c40e872` (seed fix, see Findings).
- **Status:** `Passed` — merged, deployed, Railway `/api/v1/health/ready` confirmed `ok` directly by Osama. Application-layer only: `tenant_id` stays nullable, no composite FKs, no tenant-scoped uniqueness, no POS enrollment contract change, no legacy `Role`/`branch_id` removal — all correctly out of Phase A scope per the WP document.

#### Scope Implemented

- `TenantContextGuard` registered as a global `APP_GUARD`, resolving `TenantContext` for every non-`@Public()` route from authenticated session claims only — never body/query/header (ADR-0002 item 6 / MT-DEC-003). Fails closed with `TENANT_CONTEXT_UNRESOLVABLE`. Guard order: authenticate → resolve tenant → legacy role/capability → Matrix permission (Blueprint §74 precedence).
- Device-authenticated POS routes (no session) resolve tenant via `deviceTenantContext()`, reading the enrolled terminal's own `tenant_id` — a read, not an enrollment-contract change (that stays Phase C).
- `PermissionPolicyService` snapshot bumped v1→v2 in place, adding business keys alongside WP-006's identity-admin-only v1 grants (a fresh v2 would have been invisible to already-seeded environments and default-denied every business endpoint post-deploy).
- All 18 backend modules retrofitted to `findById(context, id)` / `list(context, filters)` / `save(context, aggregate)`: sales, inventory, purchasing, transfers, customers, products, pricing, offers, suppliers, terminals, shifts, sellers, reports, notifications, sync, updates, branches, users. Each has a behavioural cross-tenant isolation suite (`identity/testing/cross-tenant-harness.ts` evaluates the actual generated `where` clause, including nested relation filters, rather than asserting in prose).
- `backend/src/identity/permission-catalog.ts` — role→permission→endpoint mapping. **Flagged explicitly by the CLI as original derivation work, not a transcription**: ATHR Permission Matrix v1.0 fixes permission keys and role templates in prose but explicitly declines to bind them (§21, §62, §93 hands it to API Contract v1.0, which itself lists it as open). Derivation rule was conservative: each role's grants are the Matrix-shaped expansion of exactly what the legacy `permissions.ts` already allows that role today, and `PermissionGuard` runs alongside — not replacing — the legacy `RolesGuard`, so this can only be at least as strict as current behavior even if the derivation is wrong somewhere. Role mapping: owner→tenant_owner (§48), branch_manager→location_manager (§50), cashier→cashier (§51), warehouse_manager→warehouse_manager (§53), seller→read-only subset (no Matrix template exists).
- Knowingly unmodeled in this phase, listed rather than silently skipped: Entitlement intersection (§65, deferred to WP-022 per ADR-0005), Approval classes P0–P4 (§9, no workflow exists yet), Authentication strength A0–A3 (§8, no step-up mechanism), Separation-of-Duties pairs (§63, e.g. transfer shipper≠receiver, PO creator≠approver — not enforced).

#### Files Changed

- `backend/src/identity/**` — `TenantContextGuard`, `permission-catalog.ts`, `cross-tenant-harness.ts`, policy snapshot v2.
- All 18 module directories under `backend/src/<module>/` — repository/service layer retrofit + cross-tenant isolation specs.
- Seed scripts (dev + CI) — see Findings.

#### Database and Migrations

- Migration names: none new in Phase A (application-layer only). `tenant_id` stays nullable per scope.
- Clean database deploy: Passed (CI, `migration-gate`).
- Populated upgrade: not separately reported; confirm against PR diff.
- Schema drift check: not separately reported; confirm against PR diff.
- Remote database changed: No — PR not merged.

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Typecheck (`tsc --noEmit`) | Passed | Clean. |
| Backend unit/contract (jest) | Passed | 419 tests / 80 suites (314 before this WP — 105 new). |
| Clean `npm ci` at repo root | Passed | 1454 packages, 0 vulnerabilities. |
| Backend build | Passed | |
| Admin build | Passed | Next.js. |
| POS build | Passed | tsc + vite + electron tsc. |
| Docker build/run + `GET /api/v1/health/ready` | Passed in CI | `docker-runtime-smoke`, 2m34s. Docker not installed on the CLI's local machine — reported **unverified** rather than a pass per §0.7 until CI confirmed it green, consistent with the WP-006 process lesson about not substituting unavailability for a pass. |
| admin-e2e-smoke | **Failed on first push, then Passed** | Genuine Phase A defect, not flaky — see Findings. |
| Full CI check set | Passed | workspace-foundation, backend, admin, admin-e2e-smoke, pos, migration-gate, docker-runtime-smoke, hard-smoke, release-gate — all green. |

#### Deployment and Release

- Railway: Deployed. `GET /api/v1/health/ready` confirmed `ok` by Osama directly after merge.
- Vercel: No Admin UI change reported.
- Supabase: Additive-only at the application layer for this phase; no schema migration accompanied Phase A.
- POS release: N/A.

#### Findings and Blockers

- **Five real cross-tenant defects found and fixed** during the retrofit of the 6 modules new to this pass (beyond the 12 already covered in a prior session per the conversation record):
  - `terminals`: `createEnrollment` accepted any active branch id — an operator could mint a working enrollment code against another tenant's branch; newly enrolled terminals also received no `tenant_id`, which would have left every post-deploy till unable to sell (fails closed under `deviceTenantContext()`).
  - `transfers`: branch-existence check counted any two active branches, so a caller could name another tenant's branch as transfer destination and ship stock across the tenant boundary.
  - `purchasing`: supplier lookup was a bare `findUnique` — a goods receipt could be booked against another tenant's supplier, landing the liability on the wrong tenant's books; `costReconciliation` compared one tenant's costs against every tenant's ledger.
  - `sellers`: `SellerCommissionSettings.id` is `Int @id @default(1)` — a singleton shared by every tenant; a rate change in one tenant would have silently repaid every seller in every other tenant. Now keyed per tenant.
  - `sales`: `Customer.phone` is globally unique until Phase B, so the POS customer upsert on phone alone would attach another tenant's customer to the sale.
  - Also (from the broader 18-module pass): `shifts` unscoped cash aggregates folding another tenant's sales into a till discrepancy; `products`/`sales` list-count caches keyed on filters alone serving another tenant's total (Blueprint §125); `inventory` reconciliation raw SQL comparing one tenant's stock against every tenant's ledger; `sync` POS catalogue feed unscoped, which would have written another tenant's catalogue/prices onto a physical till (Blueprint §123). Raw SQL in transfers/purchasing/inventory/products binds the tenant as a parameter, never interpolated (§120).
- **The A.5 gate caught a real defect, not a flaky test.** First push failed `admin-e2e-smoke`: both seeds create users *after* migrations run, so MT-MIG-003's Membership backfill (which only covers users existing at migration time) never reached them. With the new global guard, those accounts authenticated successfully and were then denied every subsequent request — API boots, login page renders, nothing else works. Every CI job seeding a throwaway database was affected, and so would a fresh production bootstrap have been. Fixed in `c40e872`: both seeds now resolve-or-create the demo tenant, stamp `tenant_id` on every tenant-owned row including nested creates, and create a Membership per identity using the same legacy-Role mapping as migration `202608020003`. A static `development-seed-contract.spec.ts` guards this so it cannot silently regress. **This is the second WP where the containerized/e2e gate caught something every local gate missed** (see WP-006 Docker finding).
- Zero behavior change expected for today's single-tenant production: every existing user already has a Membership into the Initial ATHR Demo Tenant (guaranteed by migration `202608020003`'s post-step invariant), so every request resolves the same tenant it implicitly used before.
- **Known Phase B item surfaced here:** `SellerCommissionPeriod` still carries a global `@@unique([period_start, period_end_exclusive])`. Application reads are now tenant-scoped, but the DB constraint still spans tenants — a second tenant closing the same calendar period would be rejected by Postgres. Tracked as §B.4 item 3, not fixable in Phase A.
- **Two WP-007 document corrections applied during execution** (already reflected in the WP doc per the conversation record): cross-tenant test catalog citation corrected from Blueprint §127 (Support Access Tests — wrong catalog) to §119/§120/§122; and §A.3.5's "don't infer it" premise corrected — no such mapping exists in any source document, so it is original derivation work requiring explicit review, not a transcription (see Scope above).

#### Deviations from Plan

- None flagged as out-of-scope creep. The permission-catalog role→endpoint mapping is flagged prominently in the PR description as a security decision needing real review, not a documentation transcription — per the WP-compliance-checklist standard's spirit of never silently omitting a material gap.

#### Next Recommended Action

- **Closed.** PR #53 reviewed by Osama (including the `permission-catalog.ts` role→permission derivation and the returns.request/approve-standard/post split, independently verified against `backend/src/sales/sales.controller.ts` to have zero live enforcement point for the two unwired keys — no regression risk), merged, deployed, and Railway `/api/v1/health/ready` confirmed `ok` by Osama. Phase A of WP-007 is closed.
- Retrofit the WP-007 doc's Compliance Checklist section (per the memory-saved standard) — Phase A's CLI session has finished; safe to edit now.
- **Phase B (MT-MIG-006) is next and unblocked:** `tenant_id NOT NULL`, composite same-tenant FKs, tenant-scoped uniqueness replacing old global-unique constraints — including the `SellerCommissionPeriod` global-unique-period item surfaced in Phase A's findings.

---

### `WP-008 Phase B — Price Books and Pricing Evaluation — Passed`

- **Started at:** 2026-08-07
- **Completed at:** 2026-08-12
- **Branch:** `feat/wp-008b-price-books` — originally PR [#64](https://github.com/OsamaIbrhim/ATHR/pull/64), finally merged as PR [#71](https://github.com/OsamaIbrhim/ATHR/pull/71) (`[REPLACES PRICING ENGINE]`).
- **Base SHA:** `38c102e` (the WP-008 Phase A merge) at branch time; later rebased onto `e7980ca`.
- **Head SHA:** `675a46c`, rebased to `b490315`.
- **Status:** `Passed` — merged, deployed via a **manual** Railway deploy, all 7 migrations applied, `/api/v1/health/ready` confirmed `ok` by Osama. Two independent review rounds and one fix round preceded merge. **Not a zero-behavior-change phase**, and flagged as such in the PR title and description: the flat `cost × (1+overhead) × (1+profit) × (1+tax)` formula is replaced by versioned Price Books.

> **Merge accident — recorded because it nearly corrupted this log, and because the recovery path is non-obvious.** PR #64 was **auto-closed by GitHub as a side effect of merging PR #67**, with the banner *"Closed with unmerged commits"* and the attribution *"closed this in #67"*. No merge commit existed; `master` sat at `e7980ca` while this entry had already been written as `Passed`. The close was invisible from the merge UI at the time, so the mistake was made in good faith — but it was a mistake, and it was caught only because a later session independently re-checked `mergedAt`.
>
> **Reopen was not possible** — the branch had been force-pushed (rebased) after the close, so GitHub refused. Recovery was to open a fresh PR (#71) from the same branch, explicitly marked as superseding #64 so the review history stays findable.
>
> **Two rules this establishes.** First: *"merged" means a merge commit exists on the base branch* — not that the merge button was clicked without an error. Verify with `mergedAt` / the base branch's log, never from the UI impression. Second: **never write `closes #N` / `fixes #N` in a PR body or commit message unless closing that issue/PR is genuinely intended** — that is what silently killed #64.

#### Scope Implemented

- `PriceBook` / `PriceBookEntry` with a genuinely enforced lifecycle (draft → submit → approve → schedule → activate → end). Transitions are not a bare status column: `PriceBookRepository.transition` puts the prior status inside the `updateMany` predicate, so concurrent double-transitions are safe; `activate()` wraps the default-supersede in a `$transaction` with the same guard.
- Deterministic price-source ordering: variant → product → brand → category → global. No-price genuinely blocks (returns `null` / throws / skips at three distinct call sites, each with its own deliberate behavior and test) rather than falling back to a default.
- Quantity breaks, tested at the boundaries (1/9/10/49/50/1000 against a 1/10/50 ladder); no off-by-one.
- `PriceOverride` and `Discount` as genuinely separate tables with separate constraints — not one table with a type flag. Below-floor override requires an independent approver (see `H3`), and `pricing.manual-override.above-threshold` is checked independently of `.apply`.
- 12 new `pricing.*` permission keys; `PricingService.calculate()` rewritten with its signature preserved so the sales/offers/sync callers were patched, not rewritten.
- One-time `PricingRule` → Price Book data migration freezing every currently-live variant price into a variant-scoped entry.
- **`CostVisibilityService`** — introduced during the fix round, now the single place deciding who may see cost-derived values. Gates on permission keys, not role names, replacing a hardcoded `role !== 'cashier'` check.

#### Database and Migrations

- Migration names: 7 new — `202608070001_add_price_book_table` through `202608070007_add_price_book_sync_triggers`.
- Clean database deploy + populated upgrade: Passed (`migration-gate`, run against both a clean and a baseline-seeded database).
- The data migration's 1:1 `RAISE EXCEPTION` invariant guard ran armed against real seeded data and passed.
- Remote database changed: only via the normal Railway deploy after merge.

#### Tests

| Gate | Result | Evidence / Notes |
| --- | --- | --- |
| Backend unit/contract | Passed | 554 tests at the sales-masking commit; full suite green at final head. |
| migration-gate | Passed | Data migration executed twice on real Postgres; validator wired in (see `B6`). |
| admin / admin-e2e-smoke | Passed | After the `B2` frontend fix. |
| docker-runtime-smoke | Passed | |
| hard-smoke | Passed | Also carries the new real-Postgres behaviour suite `verify-price-book-behaviour.cjs`. |
| workspace-foundation | Passed | |
| `hard-load` | **Skipped** | Schedule-only by workflow design. Recorded as **verified by nothing** — neither CLI nor CI — rather than implied green. |

#### Findings and Blockers

**Twelve defects were found by review, not by CI — every one of them on a branch whose CI was already green.** This is the most important fact in this entry: green CI was not sufficient evidence of correctness for this WP.

Blockers (all fixed before merge):

- **B1 — price changes never reached POS terminals.** The new Price Book path emitted no `SyncChange`, so a till would have kept serving its cached price indefinitely while the old `PricingRule` trigger still fired for rows that no longer priced anything. Fixed by migration `202608070007`, ordered deliberately *after* the backfill so the cutover itself does not emit N sync rows. Proven by 4 real-Postgres assertions including the negative case (renaming a draft emits nothing).
- **B2 — `admin-web/app/pricing/page.tsx` broken** by the `PriceQuote` shape change; it read three removed fields and compiled clean only because `res` was typed `any`. Exactly the "prove it across every real consumer" case in CLAUDE.md §6.
- **B3 — variant cost disclosed to cashier.** `floor_price` fell back to `variant.cost_price` verbatim and surfaced as `min_allowed_price`; the cutover leaves `floor_price` null for the entire catalog, so this was exact unit cost for every migrated entry. Cashier holds `pricing.manual-override.apply`, and even a *rejected* override disclosed the value in its error message. Contradicts Permission Matrix §51 and BR-CST-101.
- **B4 — O(N²) resolution in the POS snapshot path.** `loadActiveRules` loaded every active entry tenant-wide and `quote()` rescanned that array per variant per scope level; post-migration `N_entries ≈ N_variants`, so roughly 10⁸ operations for a 10k-variant catalogue pull.
- **B5 — default-book replacement was structurally impossible.** The `is_default` partial unique index carried no status predicate, so the carefully written supersede-on-activate branch could never be reached — the replacement draft could not be created in the first place. The spec passed because `fakePrisma` enforces no indexes.
- **B6 — the "fail loud on ambiguous data" mechanism was silent.** `prisma migrate deploy` does not surface PostgreSQL `NOTICE`, so the migration's ambiguous-row reporting went nowhere. Fixed by wiring `validate-pricing-rule-migration.cjs` into `migration-gate` as a pre- and post-check; CI now prints the real counts (`2 category + 1 global AMBIGUOUS`).
- **B7 — the migration's tie-break dropped `priority`,** so two same-scope rules on one variant resolved arbitrarily instead of by lowest priority as the old engine did — a silently changed live price, contradicting the PR's own "zero drift" claim.
- **B8 — found by the CLI itself, using the verification discipline the review round demanded.** `supersedeEntry` inserted the successor *then* demoted the predecessor; Postgres checks non-deferrable unique indexes per statement, so every supersede raised `P2002` against a real database. BR-PRB-103's only sanctioned way to change a live price could not run. The spec passed because `fakePrisma` has no indexes. Fixed by demoting first, with the demotion predicated on `status='active'` so concurrent supersedes resolve to exactly one winner at the storage-engine level.

High-severity (all fixed): `H1` supersede silently reset `tax_percent`/`floor_price` to literals instead of inheriting; `H2` entries were freely mutable on an *active* book, bypassing lifecycle governance; `H3` below-floor overrides were self-approved; `H4` the self-approval check read `submitted_by` instead of `created_by`, so create → have a colleague submit → approve your own book was possible.

**A second, larger cost leak was found in `sales`, not `pricing`:** `SalesInvoiceItem.unit_cost` was returned through four paths of `GET /sales/:id` (plus both return joins), and `cashier` holds `sales.sale.view` — so a till could read exact cost for every line it had ever sold. The governing key `sales.sale.view-cost-margin` was declared in the Permission Matrix, granted in the catalog, and **enforced at zero call sites**. Now gated, with `POST /pos/sale` stripping unconditionally since a device token has no membership to resolve.

Two honesty notes recorded by the CLI rather than buried, both worth keeping:

- The `offers` masking commit was justified on a premise that turned out false — `location_manager` already holds `pricing.cost.view` via `PRICING_PERMISSIONS`, so what shipped is defence-in-depth, not a leak fix. Flagged explicitly, with the observation that any other review finding resting on role→permission inference deserves the same direct check.
- One fix round shipped incomplete: the first sales-masking commit covered only one of the two return joins, and its test passed *vacuously* because the fixture left `return_items` empty. Caught on self-review, fixed, with the new case confirmed failing first.

#### Known-open, deliberately deferred

- `suggested_price` presence/absence oracle: the clamped *value* is masked, but whether the field is present still yields a bound on cost. Narrow; own follow-up.
- `products.controller.ts` gates raw `cost_price` on a hardcoded legacy role list read from `req.user.role` — literally the defect `pricing.controller.ts` documents as fixed. `catalog.product.view-cost-sensitive` and `inventory.position.view-cost` are both declared, granted, and enforced nowhere.
- `offers.service.ts` writes true `suggested_price` into audit meta on the "audit is not disclosure" principle; whether that meta is actor-readable downstream was **not** independently verified.
- The `H2` policy gap is documented in a docblock attached to the enforcing function (not merely in a PR description): BR-PRB-1xx defines neither a per-entry approval state machine nor draft-only entries, and draft-only would contradict BR-PRB-103. Flagged for a deliberate decision rather than resolved unilaterally.
- Operational consequence, not a defect: with `H4` in place, only `tenant_owner` holds both `price-book.create` and `.approve`, so a single-owner tenant cannot approve any Price Book. Consistent with Permission Matrix §63's mandatory SoD pair, but it needs to be a conscious provisioning decision.

#### Deviations from Plan

- The WP document anticipated 6 Phase B migrations; 7 shipped (the `SyncChange` trigger was added during the fix round). The in-code migration-count assertion is correct at 160; only the surrounding comment prose still says 6/159.

#### Deployment and Release

- **Railway: deployed manually.** The automatic deploy was **skipped** for #71's merge commit despite `railway.toml`'s `watchPatterns` including `/backend/**`, which this PR changes extensively. Unexplained — recorded as an open question below, not as expected behaviour. (A prior skip, on #65, *was* legitimate: that PR touched only `scripts/`, which no pattern matches.)
- All 7 Phase B migrations applied on the manual deploy, including `202608070006` (the pricing data migration, whose `RAISE EXCEPTION` 1:1 guard was armed and did not fire against real production data).
- `/api/v1/health/ready` confirmed `ok` by Osama post-deploy.

#### CI evidence and one transient failure

Every merge-gating job passed: `backend`, `admin`, `pos`, `workspace-foundation`, `migration-gate`, `hard-smoke`, `docker-runtime-smoke`, `admin-e2e-smoke`, `release-gate`.

Before that, PR #71's first run failed `migration-gate` and `Build Windows installer`. Root-caused as **a transient network fault, not a defect**: both died in `npm ci` on the `electron` postinstall with `RequestError: socket hang up`, on two different operating systems 61 seconds apart, neither reaching a single line of project code (`migration-gate` died at step 4 of 12, before any database step). Ruled out by evidence: the Electron version is pinned and had installed successfully on this same branch five times since; the lockfile's last change is an ancestor of the tested commit; every other job in the same run ran the identical `npm ci` and passed; and a missing artifact would surface as HTTP 404, not a connection reset. Cleared on re-run.

Two things that investigation corrected, worth keeping:

- **A prior "every merge-gating job passed" claim was incomplete.** That evidence came from a `workflow_dispatch` run, which never invokes the separate `pos-windows-installer.yml` workflow — so the Windows installer had *never* run on that commit. The `pull_request` job set is strictly larger than what a dispatch exercises.
- **A merge-state hypothesis was tested and killed with data**, not assumed: `compare/e7980ca...b490315` returned `behind: 0`, making the merge a fast-forward, so the state `pull_request` CI tested is byte-identical to the branch tip and the earlier `migration-gate` evidence (clean + populated, both green) transfers to it.

#### Open questions from this phase

- **Why did Railway skip the automatic deploy** for a merge commit that changes `backend/**` extensively, when `watchPatterns` covers exactly that? Needs checking before the next deploy, or the next one will silently not happen either.
- **`migration-gate` — a Postgres/DDL job — runs `npm ci` at the workspace root and therefore depends on downloading an Electron binary from GitHub releases.** A merge-gating database job should not be able to fail on an unrelated binary download. Setting `ELECTRON_SKIP_BINARY_DOWNLOAD=1` on the non-Electron jobs removes the failure surface. Robustness improvement, tracked, not urgent.

---

### `Interim — master CI recovery: PRs #66, #67, #68 — Passed`

Recorded because it establishes a standing rule and because the root cause was a prior WP's merge.

- **PR [#67](https://github.com/OsamaIbrhim/ATHR/pull/67)** `fix/stale-migration-count-assertion` (`628defa`) — WP-008 Phase A (#63) added 6 migrations without updating `countMigrationFolders()`'s assertion (147) or its `slice(-3)` list; the second failure was masked because `assert.equal` threw first. `master`'s `backend` job had been red since that merge. **Nobody noticed, because #63's own CI had been red at merge time and was waved through as a runner-availability issue.**
- **PR [#66](https://github.com/OsamaIbrhim/ATHR/pull/66)** `chore/resolve-npm-advisories-nanoid-jsyaml` (`de475ba`, lockfile only, 3 lines) — nanoid 3.3.16→3.3.18 and js-yaml 4.3.0→4.3.1, clearing GHSA-2v37-7h3g-55p8 and GHSA-5p4m-2wfm-xmqj. Both had in-range fixes, so no override and **no downgrade** was needed. An earlier attempt had stalled on `npm audit fix --force` wanting to downgrade `@nestjs/swagger` 11.4.6→11.4.5 — correctly refused as an unverified runtime-dependency change rather than pushed blind.
- **PR [#68](https://github.com/OsamaIbrhim/ATHR/pull/68)** `chore/pin-js-yaml-root-override` — closes a latent trap: `npm ci` is clean, but any plain `npm install` re-resolves and materialises a vulnerable nested `js-yaml` under `@nestjs/swagger`, taking `backend` from 0 to 2 high advisories. Scoped root override (not tree-wide, which would have forced 5.x onto electron-builder's `^4.1.0` closure). **Zero installed bytes change** — the lockfile is untouched; the override is future-tense.
  - Notable: **no CI job covered Swagger YAML generation.** `jsyaml.dump()` runs only inside the `GET /api/docs-yaml` handler and nothing ever requested it. Rather than claim safety, a check was added to `hard-smoke` that fetches both documents and cross-checks the YAML against the JSON.

**Standing rule adopted by Osama as a result:** no merge while any CI check is red — including pre-existing, inherited, or third-party-advisory failures. Tolerating a standing red check is exactly what let #63's real breakage through.

Two structural facts recorded for future reference: per-workspace `overrides` in this repo are **inert** (npm honours only root-level `overrides`), so the pre-existing per-workspace entries for `brace-expansion`/`postcss` do nothing; and no CI job runs a plain `npm install`, which is why the lockfile inconsistency stayed latent.

---

### `WP-T1 — Test Infrastructure Hardening (F1, F2, F5, F6) — Passed`

- **Completed at:** 2026-08-11
- **Branch:** `chore/wp-t1-test-infrastructure-hardening` (PR [#69](https://github.com/OsamaIbrhim/ATHR/pull/69))
- **Status:** `Passed` — all CI green on first push.

Motivated by the move from solo work to a 2–4 person team on 3 parallel tracks starting WP-009: several tests were structurally guaranteed to break on legitimate changes made by someone who did not cause them.

- **F1 — a `backend` spec read `admin-web` and `pos-electron` source files** by relative path, so editing a POS screen or an admin page failed the *backend* CI job. It also bypassed the existing dependency-direction guard entirely, since `check-workspace.mjs` only blocks app→app dependencies declared in `package.json`. Assertions relocated verbatim into each app's own suite; a new `check-workspace.mjs` rule now blocks cross-workspace test reads, implemented with a string/comment-state extractor rather than a regex sweep (that scanner had already shipped one prose false positive).
- **F2 — an exact file list that four consecutive WPs would each have broken.** `inventory-ledger-contract.spec.ts` asserted the set of `InventoryStock` writers equals exactly three files; WP-009/010/011/013 each legitimately add or move one. Replaced with a declared allowlist module (`inventory/audited-stock-writers.ts`) so adding a writer becomes a reviewed one-line decision instead of a surprise failure.
- **F5 — misdiagnosed by the analysis, and verified before acting.** The `groupBy` separator was reported as `''` (join/split not being inverse). It is actually a literal NUL byte, which round-trips exactly and cannot collide — proven three ways including a runtime probe on the exact rows a space separator would merge. **No fix was needed; the analysis was wrong.** The real defect was that the separator was an invisible literal NUL in source, so it is now an explicit `' '` escape behind a named constant, with a regression test locking a value that has already been misread once.
- **F6 — `findFirstOrThrow`/`findUniqueOrThrow` missing from the fake**, used at 5 production call sites; any test touching them died with a misleading `TypeError`. Implemented throwing a real `PrismaClientKnownRequestError` with `P2025`, because `api-error.filter.ts` branches on both class and code to produce a 404.

**Process note worth keeping: three of four items reproduced, one did not.** Each was verified by experiment before being fixed — F1 by appending a line to a POS file and watching the backend spec fail; F2 by adding a throwaway service with a stock write. The mandatory verify-before-fix step is what caught the F5 misdiagnosis, which would otherwise have had us "fix" working code.

Two items recorded rather than silently absorbed: `athr-identity-contract.spec.ts` reads 11 files across workspace boundaries — the same violation class, but scoped to F3 — so it is grandfathered with the reason in code and documented as a list that must shrink, not persist. And `F6` is narrower than it looks: all five call sites pass `include:`, which the fake ignores, so those paths still are not fully testable (F7).

Results: backend 84→85 suites, 448→454 tests; admin-web 13→14 files; pos-electron 25→26 files. `hard-load` remains skipped and therefore verified by nothing — stated plainly rather than left to imply CI coverage.

---

### `Electron 39 → 41 upgrade (GHSA-jmr9-qjv8-65gv) — Passed`

- **Completed at:** 2026-08-13
- **Branch:** `chore/electron-43-upgrade` (name is inaccurate — see below) — PR [#72](https://github.com/OsamaIbrhim/ATHR/pull/72)
- **Commits:** `5aa503d` (electron 39.8.10 → 41.10.5), `01ac482` (CI Node 20.11 → 22.12.0), `c29077d` (backend Dockerfile root `node_modules` copy)
- **Status:** `Passed` — all 9 CI jobs green, Windows installer green **and confirmed to have run on the head commit specifically**, full manual POS smoke completed by Osama on the test laptop.

Triggered by a newly published advisory (`extract-zip` unvalidated symlink path traversal, GHSA-jmr9-qjv8-65gv, reached transitively via `electron`) that turned the `pos` job red on `master` and, under the standing no-merge-on-red rule, blocked PR #70.

**The task premise was wrong and was corrected by measurement.** The brief assumed Electron 43 was required. Per-version `npm audit` runs in isolated trees showed otherwise: 39.8.10 → 2 high, 40.10.6 → 1 high, 41.10.3 → 0, 42/43 → 0. Electron had backported the `extract-zip` fix to 40.10.3 by swapping the dependency, **but 40.x is a dead end** — GHSA-9f4c-93c8-jc8g (sandboxed iframe bypassing `allow-popups`) covers 40.0.0-alpha.2 – 41.10.2, an advisory the 39 pin was never exposed to. So stopping at 40 would have traded one high advisory for another. Shipped 41.10.5: the latest patch on the lowest clearing line, two majors crossed instead of four.

Breaking-changes review was read from the `v41.10.5` tag rather than `main`, because `main`'s copy has been reorganized and misattributes entries across majors. All five documented entries checked against real usage; none applied. Zero application source files changed — the diff is 4 files, all configuration.

**Two real failures surfaced that only the upgrade could have revealed:**

- **Every CI job died at `npm ci`.** Electron 41's postinstall `require()`s `@electron/get@5`, now ESM-only; `require(esm)` needs Node ≥ 22.12. `pos-release.yml` was already pinned there — `ci.yml` was the straggler, still on 20.11.
- **The production container died at boot** with `Cannot find module 'ms'`. Dropping `extract-zip` removed `pos-electron`'s `debug`/`ms` copy, which flipped npm's dedup to hoist them to the root, while `backend/Dockerfile`'s runtime stage copied only `@athr` from root. Root-caused by replaying the Dockerfile deps stage against both lockfiles (master resolves `ms` under `backend/node_modules`, the branch resolves it at root) and fixed at the class level by copying the whole root tree. **This one would have reached production.**

Verification: `npm audit --audit-level=high` clean at root, in `pos-electron`, and in the `pos` CI step. Full manual POS smoke on Windows passed — install, launch, product search (proves the `athr` context bridge), login/quit/relaunch, **offline sale**, receipt print, hold/resume, reconnect and sync, update check, diagnostics copy.

The offline-sale step deserves recording: it was flagged in advance as the most likely failure, since `safeStorage` is DPAPI-backed on Windows and a major Electron bump is the plausible way state written by Electron 39 stops decrypting. It survived. Had it not, a clean reinstall was an acceptable remedy given no live customers — but knowing it survives is materially better than knowing a workaround exists.

Two things the CLI declined to count as evidence, correctly: a local `npm run dist` failed at NSIS icon generation on a memory limit (Electron-version-independent) and was not claimed as a pass despite producing a `41.10.5`-stamped executable; and `pos-release.yml` is dispatch-only so it never ran — it was read rather than assumed, and reported as covered by inference, not execution.

---

### `F8 — Test Fixture Builders — Passed`

- **Completed at:** 2026-08-11
- **Branch:** `chore/test-fixture-builders` (PR [#70](https://github.com/OsamaIbrhim/ATHR/pull/70), commits `90b2add`, `4f98ca9`)
- **Status:** `Passed` — merged 2026-08-13, after a rebase onto post-Phase-B master and an Electron-advisory fix (#72) cleared the `pos` gate.

> **Rebase conflict worth recording, because taking the wrong side would have been invisible.** Phase B merged after #70 was opened and rewrote `pricing.cross-tenant.spec.ts` entirely against the new Price Book engine, while #70's copy was the *old* pricing spec with builders applied — the same file edited from two incompatible models of the domain. Resolution took **master's version verbatim as the base of truth**, then re-applied the builder migration on top (10 insertions / 8 deletions, confined to two seed rows). The trap: #70's stale copy used `brand`, while the new engine walks the scope chain via `variant.product.brand_id` — and since `FakeTable.findFirst` ignores `include`, that stub is exactly what the engine sees. Taking #70's side would have produced a passing test that exercised nothing. Zero assertions changed.
>
> Three additional specs added by Phase B were migrated to builders in the same pass (`overrides.cross-tenant`, `overrides.service`, `offers.cost-visibility`). Phase B added **no** mandatory column to any builder-covered entity — verified two ways (schema diff touches existing models only via back-relations; grepping the seven new migrations for `ALTER TABLE` finds only FK constraints on new tables).
>
> **Follow-up identified:** `priceBook`/`priceBookEntry` are now hand-seeded by seven spec files, which qualifies them for builders under this module's own documented rule. Deliberately not added inside a conflict resolution — new builder surface belongs in its own scoped change.

**The premise this was scoped on was partly false, and the correction matters.** The planning assumption was that WP-008 Phase C's new mandatory column would force hand-edits across ~25 spec files. In fact `fakePrisma` performs **no schema validation at all** (`type Row = Record<string, any>`), so a new mandatory column does not break these specs at compile time. The real exposure is narrower: when production code *reads* the new field, seeds omitting it yield `undefined`. That reaches 6 files, not 25. There are 21 cross-tenant specs, not ~25.

The work remained justified on different grounds: `branch` — not `productVariant` — is the most duplicated entity (7 files).

- Eight builders in `backend/src/identity/testing/fixture-builders.ts`, co-located with the harness every spec already imports: `aBranch`, `aBrand`, `aProduct`, `aProductVariant`, `aCustomer`, `aSupplier`, `anInventoryStock`, `aSalesInvoice`. Contract stated in the module header: **a new mandatory column gets a default here, once.**
- Two deliberate rules: defaults are schema-valid with `Decimal` columns defaulting to `Prisma.Decimal` (the type the real client returns), and **defaults carry columns only, never relations** — pre-hydrating nested objects would hide the fake's missing `include` support behind a fixture that no longer resembles a row.
- `user` and `inventoryMovement` clear the two-caller bar and were still excluded, with reasons recorded. Single-file entities excluded as indirection with nothing to deduplicate.
- 16 spec files migrated. **No assertion changed** — fields were dropped only where the default is byte-equivalent.

#### Finding: tests passing because the fixture had the wrong type

`uom.cross-tenant.spec.ts` seeded `factor: 24` against `factor Decimal @db.Decimal(18,6)`. Substituting a real `Prisma.Decimal` made exactly one assertion fail (`Expected: 24, Received: "24"`) while the other 7 tests passed — so `UomService` handles Decimal correctly and only the test's identity comparison was type-sensitive. **That assertion had been passing because the fixture was the wrong type.** Measured, not assumed, and reported for decision rather than silently changed inside a fixture refactor.

A follow-up scan found the problem is **not** widespread: 3 sites in 2 files out of roughly 140 raw grep hits. The reason is structural and worth recording — production code is already Decimal-safe (`PricingService.quote()` wraps every input in `Prisma.Decimal` and returns `.toNumber()`; `common/money.ts` accepts all three types), and the fake coerces on aggregate. The second real site was `sellers.service.spec.ts` (`default_rate`, plus `default_target`/`default_bonus` also being `Decimal`). Both fixed by Osama directly.

Two latent harness limits documented rather than fixed (F7 territory): `FakeTable.sort` compares `Prisma.Decimal` via `>`, which coerces through `valueOf()` to a **string**, so `orderBy` on a money column would sort lexicographically (`'9' > '100'`) — currently latent because the only such `orderBy` repo-wide never executes a comparison in its spec. And builder defaults do not apply to the fake's `create` path.

**The durable conclusion:** type fidelity belongs in the builders, not in a one-time sweep of call sites. The convention already existed in the repo (`reports.service.spec.ts`, `purchasing.service.spec.ts` used `Prisma.Decimal` correctly) — it just was not applied uniformly, which is exactly what a builder layer fixes permanently.

Results: backend 84→85 suites, 454→483 tests; the entire +29 delta is `fixture-builders.spec.ts`, which pins the builder contract itself (money columns are `Decimal`, no default is `undefined`, every builder stamps a tenant, no relation is pre-hydrated, overrides win, two rows share no mutable state).

---

### `Open finding — hard-load: /sync/pull returns 500 (Postgres stack depth limit exceeded)`

- **Discovered:** 2026-08-11, while establishing CI evidence for the rebased Phase B branch.
- **Status:** `Open` — not caused by Phase B; reproduces identically on `master`.

The scheduled `hard-load` job fails on `master` with `GET /sync/pull` returning **500**, root cause `stack depth limit exceeded` raised by PostgreSQL. This is not a latency complaint — it is a query reaching the database's recursion ceiling, on the exact endpoint every POS terminal uses to pull its catalogue. It warrants its own root-cause work package.

`hard-load` also reports a p95 breach on `GET /sales?page=500` (`listSales`). That one is far weaker evidence: it is a read path untouched by Phase B, and the same metric swings between roughly 97ms and 278ms across `master`'s own nightly runs, so the threshold is measuring noise as much as regression.

Two structural facts about this job, worth recording so it is neither over- nor under-weighted in future merge decisions: it runs **only** on schedule/dispatch (never on `pull_request`), and `release-gate` does not check it. So it gates nothing today — which is precisely why a real 500 has been able to sit on `master` unaddressed.

---

### `WP-P0 — hard-load /sync/pull 500 (Postgres stack depth) — Passed`

- **Completed at:** 2026-08-15
- **Branch:** `fix/hard-load-stack-depth` — PR [#75](https://github.com/OsamaIbrhim/ATHR/pull/75), merged `6a2f50ff71fa0e3ed3ce0df8ce9760661a6bfe2f`
- **Status:** `Passed` — closes the `Open finding` recorded above on 2026-08-11. `stack depth limit exceeded` no longer occurs. `hard-load` is **still red** for two unrelated latency failures; see WP-P1.

Root cause: `SyncService.snapshot()` and `pull()`'s `resetCatalog` branch called `productVariant.findMany({ include: { product: true } })` with no upper bound. Prisma's relation loader for `include` fans out into a Postgres statement that exhausts `max_stack_depth` once the parent result set is large — bisected against a real `postgres:16` service container as safe through 7,500 rows and failing between 7,500 and 10,031, which is exactly CI catalogue volume (`PERF_PRODUCTS=10000` plus dev-seed rows). Fixed by `attachProducts()`: same filter query, then a manually chunked flat `product.findMany({ where: { id: { in: chunk } } })` at `PRODUCT_BATCH_SIZE=1000`. No API contract change, no consumer change.

**The architect's hypothesis was wrong and the CLI disproved it rather than building on it.** The task brief named a trigger cascade (`record_sale_inventory_movement` → `record_inventory_movement` → `InventoryStock` update → `bold_inventory_sync_change`) as the leading suspect, inferred from the invoice-seed loop's sharp slowdown. That trigger and its function had already been dropped in `202607290001_sales_inventory_single_writer`, and `perf:seed` completes cleanly. The brief said explicitly to treat the hypothesis as unproven; it was, and the finding stands as evidence the instruction earns its place. Three further hypotheses were tested and falsified before landing: JIT (query cost ~808 against `jit_above_cost` 100,000; `jit=off` changed nothing), the container's stack `ulimit` (raised to 8MB, no effect), and the raw SQL itself (every variant executed cleanly standalone under `psql`, including the exact `PREPARE`/`EXECUTE` form).

**The mechanism was never diagnosed, only isolated — and the PR says so.** Bisection showed filter-alone safe, `+include` unsafe, `+take:100` safe. Why that specific access pattern becomes stack-recursive inside Postgres is unexplained. The fix does not depend on the explanation, because it takes a categorically different query shape rather than tuning the unsafe one. Recorded because the honest version is what a future reader needs.

#### Finding: the migration-gate proof did not protect the code it guarded

Caught by an **independent review round**, on a branch whose CI was fully green. The first version of `verify-sync-snapshot-behaviour.cjs` reimplemented the chunking inline and never imported `sync.service.ts`. It proved that raw Prisma still crashes on `include`, and that a hand-copied strategy works — neither touched the shipped service. Reverting `attachProducts` to `include: { product: true }`, or raising `PRODUCT_BATCH_SIZE` to an unsafe value, would have left the check green. `PRODUCT_BATCH_SIZE` was also duplicated by comment rather than imported, so the two could drift silently.

This is a **different failure mode** from `verify-price-book-behaviour.cjs` / `verify-tax-code-behaviour.cjs`, which also call raw Prisma but legitimately prove database-level invariants — triggers and partial unique indexes fire identically regardless of caller. Here the defect was an application-level choice of query shape, so proving the shape works in isolation proves nothing about the shipped code still using it.

Rewritten to construct `SyncService` directly against a real `PrismaClient` (the pattern already in `sync.cross-tenant.spec.ts`) and assert on actual `.pull()` output at 10,500 rows, with `PRODUCT_BATCH_SIZE` imported from the service.

**The guard was then observed failing, which is the part that matters.** The fix was reverted on the branch, CI dispatched, and `S2` watched go red at the exact reverted line (`Invalid productVariant.findMany() invocation ... sync.service.js:114`); the fix was restored and CI dispatched again to confirm green. Both runs are in branch history (`38178af` red, `5cb0654` restore). **A guard that has never been observed failing is not a guard** — this is the second time in this project that a green check turned out to protect nothing, and the first time we have proof one does.

#### Scope discipline

Two pre-existing latency failures were surfaced by this fix and deliberately **not** folded into it: `READ_P95_EXCEEDED` on deep-offset pagination, and `SALE_P95_EXCEEDED` — the latter previously masked entirely, because the sales suite aborted on the snapshot crash before reaching the check. Both carried into **WP-P1** (`docs/wp/WP-P1-hard-load-latency-budgets.md`). `hard-load` therefore remains red on the nightly schedule after this merge.

**On the no-merge-on-red rule:** this merge did not cross it. `hard-load` runs only on `schedule`/`workflow_dispatch`, so it is *skipped* — not red — on the PR, and every check that did run was green. The nightly failure is real, is known, is attributed, and has an owning WP. Recording the distinction because "the job was red somewhere" and "a red check gated this merge" are different facts and the rule concerns the second.

#### Follow-up opened

`include` on an unbounded query is a **class**, not an instance. Only the `sync` occurrence is fixed; any other `include` with no `take` in `backend/src` carries the same failure and would surface at the first customer with a large catalogue rather than in CI. A sweep of all such call sites is added to the backlog, to land before the three-track split. Separately, `productVariant.findMany` in `sync.service.ts` remains unbounded by design — capping snapshot completeness is a protocol decision requiring a paginated-snapshot wire contract, not a side effect of a bug fix.

---

### `WP-008 Phase D — Promotions, Coupons and Bundles (MVP) — Passed`

- **Completed at:** 2026-08-17
- **Branch:** `feat/wp-008d-promotions-coupons-bundles` — PR [#76](https://github.com/OsamaIbrhim/ATHR/pull/76), merged
- **Status:** `Passed` — **this closes WP-008.**

Promotion / Coupon / CouponRedemption / Bundle / BundleComponent models and migrations, the full NestJS module, permission keys, `PromotionEvaluationService` wired into `POST /pricing/calculate`, a real-Postgres proof script (`verify-promotion-behaviour.cjs`) in `migration-gate`, and an `admin-web` update.

**Written with zero local verification.** The coder's session had ~800MB free RAM and `prisma generate` OOM'd repeatedly, so no local build, test or typecheck was possible. Every claim rested on CI alone. Disclosed plainly in the PR rather than glossed — which is why an independent review was mandatory here.

**The guard-failing proof, done properly.** The coupon-uniqueness migration was deliberately split in two so `verify-promotion-behaviour.cjs` could be observed genuinely RED (`93bbb64`, run 31926709198 — 8/14 checks failed, exactly those depending on the missing constraints) and then GREEN (`22dd191`, run 31927359601 — 14/14).

#### Review finding: `CouponType.single_use` was a label with no behaviour

Found by independent review on a fully green branch. `grep -rn single_use backend/src` matched only the enum declaration and test fixtures — nothing branched on it, while `customer_bound` was enforced in two places. A coupon created as `single_use` without an explicit `max_total_uses` was redeemable **without limit**, silently identical to `public` — while the PR's own Acceptance Gate section claimed Item 9 satisfied.

Classified as **merge-blocking**, not a disclosure gap: the type exists in the enum and the DTO, an operator can select it today, and the behaviour contradicts the name. Distinguished deliberately from `stack_group`, which is stored-but-unread and was honestly disclosed as such — the same shape of gap, disclosed in one place and not the other.

Fixed by deriving `max_total_uses = 1` for `single_use` and **rejecting** a conflicting explicit value rather than silently overriding it (a silently overridden input is the same defect class as a silently ignored one — see `PriceBookEntry.tax_percent`). Proven red-then-green: two new negative cases failed for the expected reason with the fix stashed and passed with it restored, plus 4 new P5 assertions against real Postgres (run 31970951792, 18/18).

#### Also recorded

- The reviewer caught his own error mid-review: the first diff pass used a stale local `master` ref and pulled ~110 unrelated files in. Corrected via `git update-ref` **before** drawing any conclusions. Worth recording — the review would have been worthless otherwise, and self-correction is the reason it was not.
- `pos-windows-installer.yml` genuinely ran on the head SHA (run 31928203767) via a real `pull_request` trigger — the exact failure mode a prior PR hit, and it did not recur.
- Three permission keys are declared-and-granted but wired to zero endpoints: `coupon.export-codes` (deliberate — no encryption primitive exists in the codebase to build a safe raw-code export), `promotion.simulate`, and `coupon.redemption.override`. All three now disclosed. Accepted; a backlog item is opened for an encryption primitive.
- BR-PMT-103/104 ("pause doesn't rewrite history", "activation doesn't reprice completed sales") hold **vacuously** this phase — no Sale integration exists until WP-010. Stated in the spec and the PR rather than counted as tested.
- Documentation-layer gaps flagged, not patched by the CLI: the OD-CAT numbering off-by-one (same as Phase C), a missing `promotion.cancel` key, and a missing coupon-redemption key in the Permission Matrix. The architect owns these.

---

### `WP-P1 — Hard-Load Latency Budgets — Partially delivered`

- **Period:** 2026-08-16 → 2026-08-20
- **PRs:** [#77](https://github.com/OsamaIbrhim/ATHR/pull/77) (merged `894851f`), [#78](https://github.com/OsamaIbrhim/ATHR/pull/78) (merged)
- **Status:** `Open` — the latency budgets are **not** resolved. What was delivered is a 90% cut in the cost of measuring them, plus a diagnosis that falsified the WP's own premise.

**The WP document's diagnosis was wrong, and the CLI disproved it instead of building on it.** WP-P1 named deep-`OFFSET` scanning as the cause of `READ_P95_EXCEEDED` and prescribed an index. `EXPLAIN (ANALYZE)` showed `page=500` executing in **13.4ms**, and the composite index the WP called for already existed and was already being used at low offsets. The stop-and-report clause fired exactly as intended.

What the measurements actually showed:

- A connection-pool ceiling pinned at 5 — the app's hardcoded `connection_limit` — from concurrency 5 through 25, while p95 climbed to 640-650ms.
- Raising it to 10 moved the ceiling but **not** the outcome: read p95 barely improved (593 → 548ms, still failing) and the sale path got **49% worse** (547 → 817ms, non-overlapping ranges across all six samples, p99 roughly doubling). Something degrading under a larger pool points past the pool to contention. Reverted (`cfe64df`).
- Runner variance was ruled out directly: one run produced the best read p95 and the worst sale p95 of all six samples simultaneously.

**The real cost finding, which was not in the WP at all.** `workflow_dispatch` on `ci.yml` reruns all 10 jobs (~30 billed minutes) when only `hard-load` (~4) was needed — 86% waste on every measurement iteration, and the direct cause of the account exhausting its Actions minutes. `hard-load` has no `needs:` and is absent from `release-gate`'s `needs:`, so it was already independent. Extracted into its own `hard-load.yml` with `concurrency: cancel-in-progress`. Measured: **30 billed minutes → 3** (runs 32058754605 → 32360324715).

Two of my own premises were corrected by measurement along the way: that the seed dominates `hard-load`'s cost (it does not — `npm ci` ~60-69s and `perf:seed` ~60-72s are comparable), and that Windows runners carry a 10× multiplier (they do not — Linux $0.006/min, Windows $0.010, macOS $0.062; the 10× is macOS).

**Also merged:** PR #78 — `ELECTRON_SKIP_BINARY_DOWNLOAD=1` on the eight CI jobs that never invoke Electron, after `master` went red on a transient `TypeError: fetch failed` while `admin`'s `npm ci` downloaded a binary it does not use. `pos` was deliberately left unskipped, with the reasoning recorded: it is the only Linux job installing Electron on every PR, and skipping it would silently drop that coverage. This closes a standing backlog item.

**Still open, carried forward:** `READ_P95_EXCEEDED` and `SALE_P95_EXCEEDED`. The leading hypotheses are a single-hot-row contention artefact in the sale harness (the harness drives every sale through one variant, so all sales serialize on one `InventoryStock` row) and a Node-side rather than Postgres-side ceiling on the read path (13.4ms in the database against ~548ms observed). Also unresolved: `ci.yml`'s 300ms budget conflicts with the Performance Strategy document's provisional 250-500ms bands.

---

### `Decision — hosting suspended, and what replaces the deploy gate`

- **Date:** 2026-08-20
- **Decision by:** Osama.

Railway's free allowance is exhausted and the deployment is down. Hosting is **deliberately not renewed**: the project is pre-launch, there is no live customer, and the deployment was serving as a demo surface rather than as production.

**This changes a standing rule, so it is recorded rather than left to erode.** Every WP phase so far closed on "merged, deployed, and Railway-health-verified". With no host that step cannot execute — and a rule that cannot execute but stays written is precisely how red CI became normal during WP-008 Phase A.

Until hosting returns, the closing condition is: **merged, and proven by `docker-runtime-smoke` (container build + run + health probe) and `migration-gate` (migrations against clean and populated Postgres)**. These already cover the two failure classes the deploy step was catching — `docker-runtime-smoke` is what caught `Cannot find module 'ms'` at container boot during the Electron upgrade, a failure no unit test would have surfaced.

**What is genuinely lost and is not claimed to be covered:** behaviour against real data over time, and POS-to-server integration across a real network. Neither is needed at this stage.

Hosting will be required again at **WP-027 (demo release)**, and the provider should be chosen then on cost, not inherited from whatever happened to be running.

---

### `WP-008 — Catalog, Pricing, Tax and Promotions — CLOSED`

- **Closed at:** 2026-08-20
- **Phases:** A (Catalog Foundation), B (Price Books), C (Versioned Tax Codes), D (Promotions/Coupons/Bundles) — all merged.
- **Alongside:** WP-T1, F8 (fixture builders), Electron 39→41, WP-P0 (sync stack-depth), WP-P1 (partial).

The largest domain WP in the project. It replaced a single-table flat-formula pricing engine and a free-text brand field with the versioned, auditable model the BR doc requires.

**Deliberately deferred inside the MVP boundary, each with a reason on record:** composite promotion stacking (OD-CAT-008), offline coupon redemption (OD-CAT-009), stock-kit assembly (§36), jurisdiction determination (OD-CAT-006), and **Egypt ETA e-invoice integration** — which remains an unscheduled legal gap and is explicitly *not* what this WP delivered.

**Carried into the backlog:** `PriceBookEntry.tax_percent` accepted-and-ignored; tax exemption not applied at the till (needs a POS protocol change); `SUM(SalesTaxSnapshot.tax_amount)` diverging from `SalesInvoice.tax_amount` under `PRICE_VARIANCE`; `stack_group` stored but never read; three declared-and-unwired permission keys; no encryption primitive for a safe coupon-code export; `include` on unbounded queries as an unswept class; and `priceBook`/`priceBookEntry` fixture builders.

**Gate before the three-track split: WP-T2 (item F4).** `fakePrisma` executes no raw SQL and enforces no unique constraints, so every spec covering a raw-SQL path is green while testing nothing. WP-007 found a real cross-tenant leak inside raw SQL, and Phase D had to route coupon-uniqueness proof to real Postgres for the same reason. This is not optional before parallel work begins.

---

### `WP-T2 — Raw-SQL Harness Honesty (F4 + F7c)`

- **Date:** 2026-08-21
- **PR:** #79 (`fix/wp-t2-f4-raw-sql-fail-loud`) — green and reviewed, awaiting merge.
- **Document:** `docs/wp/WP-T2-raw-sql-harness-honesty.md`

`fakePrisma` implemented `$queryRaw`/`$executeRaw` as no-ops. Every spec covering a raw-SQL path was green while executing nothing — the exact blind spot in which WP-007 found a real cross-tenant leak.

**The inventory corrected its own premise.** Not nine production files but **ten, 45 call sites** — `promotions/coupon.repository.ts` was added by WP-008 Phase D (`f8e7dea`) after the 2026-08-10 fragility analysis was written. The "nine" figure was correct when written and is now wrong; it is corrected wherever it appears.

**The finding that reframed the work.** Flipping the harness default to throw broke only one suite, 8 tests. That small number is not good news: ~15 sites already carried hand-written silent stand-ins inside their own specs. A fail-loud default alone fixes almost nothing — **auditing every existing override is the actual work**, which the original WP-T plan did not anticipate.

**`registerRawStub()` was rejected, deliberately.** WP-T prescribed it; a runtime registration hook makes future silent stubbing invisible to review, which is the very failure being repaired. Replaced with a **static declared allowlist** — adding a site is a diff a reviewer can object to. Eligibility criterion, corrected once during the work: *does the statement write or lock real rows* — not *is the return value consumed*. Final list is five entries, all advisory locks and session flags.

**Three separate conclusions were falsified or completed by measurement**, continuing the WP-P1 pattern: a read-only guess about `lockVariants` coverage (corrected by `--coverage`), a grep scoped to 27 spec files when the relevant failure lived outside them (re-run across all 103), and the `purchasing:1000` safety argument — whose load-bearing fact (`ProductVariant.id` is globally unique, not tenant-scoped, so one `variant_id` resolves to exactly one `(tenant_id, id)` row) was supplied by review, not by the original claim. The conclusion held; the reasoning behind it did not, until checked.

**The guard rule held under pressure, after being enforced once.** The first evidence pass had no commit SHA for either RED state, and only 3 of the new script's 6 checks had ever been observed failing — the three positive-direction assertions could not be reached by the break used. This was sent back rather than waived: *the defect this WP repairs is literally "a check that cannot fail", so a scoping proof nobody has watched fail is indistinguishable from the disease.* Re-run properly on `scratch/wp-t2-f4-guard-drill` (pushed, never merged, tip byte-identical to PR head): **14 real commits**, each break isolated to one check with the other five staying green. All six turned out real; none needed deletion. The fail-loud RED produced 11 failures rather than the original 8 — a superset, because the guard had widened.

**F7c closed here, not in WP-T4 as originally scoped** — it dissolved into the route-to-real-Postgres direction. **Residual gap carried forward verbatim:** F4's guard fires on raw SQL only. An ORM-level `create()` that a unique constraint should reject still succeeds silently in the fake. **WP-011 (duplicate-receipt) and WP-013 (duplicate-refund) must be checked call-by-call** for whether their duplicate-prevention path is raw SQL or ORM before assuming this fix covers them.

**Numbering correction.** `WP-T-test-and-foundation-hardening.md` defined WP-T2 as the compiler/lint layer and WP-T3 as the harness fix. Execution ran the harness fix first under the name WP-T2. Decision (Osama, 2026-08-21): **WP-T2 is the harness work as published**; the WP-T document is corrected, and the `strict`+lint work is renumbered and remains unexecuted — WP-002 item 3's unmet acceptance stands open.

**Opened as a new work package:** the **34 raw-SQL sites that remain unproven**, named by line in the PR body. The list cuts across purchasing, transfers, sales and promotions and does **not** belong inside WP-009 (Inventory). Highest priority within it: `transfers.service.ts:593/610` (the lock every other statement in that file relies on) and `promotions/coupon.repository.ts:201`.

**Discovery, recorded not fixed:** `PurchasingService.reverse()`'s success path (lines 922–1148) is executed by no passing test — six raw-SQL sites among them — measured by `--coverage`, not inferred. A purchasing coverage gap, not a harness gap; belongs to WP-009/010. Same shape for `transfers.service.ts:581`.

**Loose ends:** six `wp-t2-r2-*` test tenants remain in the Supabase dev database because a real immutability trigger refused their deletion and the coder correctly did not route around it (assessed harmless — CI runs against a disposable database). `origin` in the main working tree still points at the pre-rename `bold_system` URL, currently carried by GitHub's redirect.

---

### `WP-009 Phase 0 + Phase 0.5 — inventory pre-work, and a core path that never worked`

- **Date:** 2026-08-22
- **PRs:** #80 (Phase 0) and #81 (Phase 0.5, merge commit `ceb40e7`) — both merged.
- **Document:** `docs/wp/WP-009-inventory-and-stock.md` §8

WP-009's survey found two defects before any inventory work began. Closing them found a third that neither was looking for, and that one reframed the work package.

**Phase 0 — both hypotheses were wrong, in opposite directions.** The two raw `UPDATE "InventoryStock"` statements with no `tenant_id` predicate turned out to be **already structurally safe**: `Branch.id` and `ProductVariant.id` are globally unique, and the composite FKs make a cross-tenant match schema-impossible. `tenant_id` was added anyway as defence in depth — the asymmetry with `transfers.service.ts:240` is a trap for the next reader — but the change is not a leak fix and is not described as one. This is the third time the *conclusion* held while the *stated reasoning* was incomplete until a second pair of eyes traced it; the weakest leg here was "input provenance is tenant-scoped", which depends on callers rather than on the schema.

The second defect went the other way: the 409 mapping was **hypothesised broken and measured working**. The three sites already returned 409. What shipped is therefore an error-code adoption (`INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY` from `error-catalog.md` §52, replacing free-text substring matching), not a bug fix. **Fourth hypothesis falsified by measurement in this project.** The rule keeps paying for itself.

**Phase 0.5 — goods receipt has never worked against a real database.** Prisma excludes a column that is part of a composite FK shared with the parent from the nested-create input type and rejects it if passed explicitly, before any SQL is sent. `PurchasingService.receive()` passes it. The failure is unconditional for every input the DTO permits. It was reproduced independently three times on real Postgres.

**Why nothing caught it — three different reasons, each verified rather than assumed:** the jest specs use doubles that never validate argument shape; `prisma/seed.ts` uses the *correct* shape and so never exercises the bug; and the hard-smoke script never calls `receive()` at all, building its own fixture instead. Three independent safety nets, three independent ways of missing the same thing.

**Sweeping the class before fixing the instance found a second site nobody knew about** — `sellers`' `savePeriod()`/`closePeriod()`, which additionally used an explicit `as any` to silence the check that would have caught it, next to a comment asserting the composite FK does not exist while `schema.prisma:390` proves it does. Both were fixed in one PR: splitting them would have landed the guard while a known instance of the class it guards was still broken.

**Correction on record:** "70 composite FK relations" was wrong and was carried into the brief by the architect without verification. The correct figures, independently derived and matching the tool's own output, are **73 relations across 46 distinct field names**.

**Guards:** a real-Postgres check that actually calls `receive()` and `closePeriod()` in CI (the load-bearing one — nothing called these against a real database before), plus a static check over 46 field names in 205 files. The static check's limits are recorded rather than glossed: it matches **by name** and only fires on an inline object literal, so extracting the nested-create input into a local variable — an ordinary refactor — makes it invisible. Demonstrated by the reviewer with a synthetic file. Not exploited today; the real-Postgres guard still catches the regression.

**The finding that outranks both defects.** Measured, not inferred: `sales.service.ts` **is never loaded at all** by any real-Postgres path in CI; `transfers.service.ts`'s entire write surface is unexecuted apart from `reconcileInTransit()`; five of nine `purchasing.service.ts` methods likewise; and `reverse()`'s success path was already known unexecuted from WP-T2. `receive()` was not an outlier — it was the first visible symptom of production code that no test has ever run against a real database. This is now its own work package, merged with WP-T2's 34 unproven raw-SQL sites, because the two have one root.

**Also disclosed, not fixed:** `SellerCommissionSettings` carries `CHECK (id = 1)` while `getSettings()` tries to allocate a fresh primary key per tenant — behaviour the schema structurally forbids. Not a cross-tenant leak; a deterministic hard failure the first time any second tenant touches seller commissions. Live today, not latent. Needs a schema decision before WP-009 reaches commissions.

**WP-009's four open decisions were settled** (Osama, 2026-08-21): `StockReservation` is its own aggregate root with the availability invariant enforced in the database; negative-stock stays acceptance-first by default but becomes a tenant setting; Phase A (generalising stock from Branch to Warehouse) runs now rather than later, because there are no live customers and the break is cheap today; and error-catalog codes were adopted for the three sites only.

---

### `WP-009 Phase A / PR1 — inventory moves to Warehouse, and a third check that could not fail`

- **Date:** 2026-08-23
- **PR:** #82, merged as `a525f84`. Storage-only: expand + backfill + validate, zero application-code changes.
- **Document:** `docs/wp/WP-009-inventory-and-stock.md` §9

**Measurement overturned this project's own WP document.** §3 Phase A was written on the assumption that `Warehouse.is_default` meant every branch already had one. Against the real database: **90 of 92 branches have no Location and no Warehouse at all.** The cause is not bad data but a product gap — `BranchesRepository.save()`, behind `POST /branches`, creates neither. The original linkage migration was **a snapshot, not an invariant**: true the day it ran, enforced by nothing since. The count itself is our own guard-drill pollution; the gap is real and ongoing, and fixing `BranchesRepository.save()` is now a separate item — without it the orphan gap re-accumulates the moment this lands, and Phase A would have cleaned up a leak it left open.

**The design keeps `branch_id` as a stored column rather than deriving it**, which is what makes "storage change, not contract change" achievable at all — no client-visible field moves, and `admin-web` (where a second developer is working in parallel), `pos-electron` and `sync` need no change. Deriving it through `Warehouse → Location` was rejected because `location_id` is nullable, so a field every consumer treats as guaranteed would become conditionally absent — a contract risk hidden inside a storage change. A three-part key was rejected because it generalises nothing and defeats centralised warehouses outright. The denormalisation's invalidating condition is written on the column in `schema.prisma`, not just argued in chat.

**A CI gap that made a guard unprovable was closed.** The populated migration path seeded only the two branches that already had a Location, so it was **structurally incapable** of exercising the guard for the case that exists 90 times in reality. A warehouse-less branch is now seeded permanently.

**And the finding that sent the PR back: the data-loss check was a tautology.** `validate-warehouse-backfill.cjs` built both sides of its comparison from the *identical* query — neither ever grouped by `branch_id` or `warehouse_id` — so the `PASSED` line in the CI log was true by construction. Its unit test pinned both sides to the same value, making the failure path unreachable rather than merely untested.

**This is the third green check in this project that proved nothing, and it appeared inside the work that followed WP-T2 — the work package created to eliminate exactly this.** The root cause is worth stating plainly, because it generalises: the guard drill covered the interesting check and not this one. **From here, every new check is broken and watched failing individually — not just the one that seems to matter.** A check nobody has seen fail is indistinguishable from a check that cannot fail, and this PR is the proof of that sentence.

The fix makes the two sides genuinely different — one joins through `Warehouse` on `w.location_id = s.branch_id`, so a misattributed row drops out of the total and the divergence surfaces. A quantity-only before/after comparison structurally cannot see misattribution; this can. All three post-checks were then drilled individually, red and green, with SHAs.

**Recorded as a Phase B constraint:** that new check assumes a 1:1 branch↔warehouse relationship. The first `is_centralized` warehouse — one warehouse serving several branches — will make it report false divergence. Same class as the `branch_id` denormalisation: correct today, enforced by nothing.

**Deferred to PR2, explicitly:** two Postgres triggers (`record_return_inventory_movement`, `record_transfer_inventory_movement`) resolve `branch_id` **inside the database, from the tables themselves** — invisible from the service files, found only by reading migration SQL. They are the highest-risk remainder of Phase A: logic that breaks silently in production and looks green in CI. The PR1/PR2 boundary is forced rather than chosen — Prisma generates the compound-key `where` shape from `@@id`, so queries on the new key cannot compile against the old primary key, making the key swap and the call-site cutover one atomic deployable unit.

---
