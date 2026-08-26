# ATHR Baseline Status — WP-000, WP-001, WP-002 (Reference Document)

**Purpose:** Every Work Package doc from WP-003 onward assumes this baseline is true. Read this file first in every fresh Claude Code CLI session before starting any WP-003+ work. This is a reference/status document, not an executable Work Package.

**Last confirmed by project owner (Osama):** 2026-08-01 — "final merger #45" is merged, and it is active/deployed on Railway.

---

## 1. What Is Confirmed Done

| WP | Title | Status | PR | Notes |
|----|-------|--------|----|----|
| WP-000 | Stabilize Transformation Base | Closed / Passed | #43 | Fixed `undefined shift` hard-smoke failure, single sales inventory writer, negative-stock ledger fixes. |
| WP-001 | ATHR Identity, Configuration and Release | Closed / Passed | #44 | ATHR branding, Electron appId/installer/updater renamed, hard-coded Railway URL removed, POS bumped to `1.5.0`. |
| WP-002 | Workspace and Shared Packages Foundation | Closed / Passed / **Merged** | #45 | npm workspaces, `@athr/contracts`, `@athr/domain-core`, `@athr/error-registry`, `@athr/testing`, single Prisma migration runner, dependency-graph enforcement script (`scripts/check-workspace.mjs`). |

**Confirmed by Osama on 2026-08-01:** PR #45 has been merged (this is described as "final merger #45, meaning the final commitment") and the resulting deployment is active on Railway.

## 2. What Every WP-003+ Session Must Independently Re-Verify

Do **not** trust this file's SHAs or dates as current fact by the time you run a WP. Instead, at the start of every session:

```bash
git fetch origin
git status
git log origin/master -5 --oneline
```

Then confirm the following markers exist in `origin/master` before proceeding (these prove WP-000/001/002 are actually present):

1. Root `package.json` declares `"workspaces": ["backend", "admin-web", "pos-electron", "packages/*"]` and `"private": true`.
2. `packages/contracts/`, `packages/domain-core/`, `packages/error-registry/`, `packages/testing/` exist with `package.json` files scoped `@athr/*`.
3. `backend/scripts/prisma-migrate-deploy.cjs` exists (the guarded single migration runner).
4. `scripts/check-workspace.mjs` exists (dependency/cycle/boundary enforcement).
5. No `bold-*` package name remains in any `package.json` (`grep -r "bold-" --include=package.json .`).
6. `backend/prisma/migrations/` contains 30+ migration folders, including `202607290001_sales_inventory_single_writer`, `202607290002_inventory_movement_negative_balance`, `202607290003_inventory_cost_negative_balance`.
7. POS `package.json` version is `1.5.0` or higher.

If any marker is missing, **stop** — the branch you are on does not match this baseline. Do not proceed with a WP-003+ document; report the discrepancy back to Osama instead of guessing.

## 3. Branching Going Forward

Per `ATHR Git and Branching Strategy v1.0`, the long-lived `feat/athr-transformation` branch was a temporary exception used only to land WP-000 and WP-001 together. **From WP-002 onward, every WP works on its own short-lived branch cut from `master`**, named `feat/wp-<id>-<slug>` (e.g. `feat/wp-003-api-error-contracts`), merged back to `master` via squash-merge PR, then deleted.

Do not create or reuse `feat/athr-transformation` for WP-003 or any later WP.

## 4. Known Open Risk Carried Forward

The Delivery Log recorded one earlier "Blocked" RCA about Railway `P3009`/`P1002` migration contention during WP-001 deployment recovery. Osama has since confirmed PR #45 is merged and live, which implies this was resolved operationally. However, no WP-003+ session should assume migrations are risk-free — every WP that changes `schema.prisma` must still run the full migration gate (clean deploy, populated upgrade, drift check) exactly as required by `ATHR Testing Strategy v1.0` §12 and `ATHR CI/CD and Release Strategy v1.0` §9/§16.

## 5. Architecture Governance Documents (apply to every WP from here on)

These five documents are the binding engineering contract for all remaining Work Packages. They are summarized inline in each WP doc where relevant, but the full text lives in `docs/`:

- `ATHR Repository and Package Architecture v1.0`
- `ATHR Module Boundaries v1.0`
- `ATHR Dependency Rules v1.0`
- `ATHR Git and Branching Strategy v1.0`
- `ATHR CI/CD and Release Strategy v1.0`
- `ATHR Testing Strategy v1.0`
- `ATHR Coding Standards v1.0`

Any WP whose instructions conflict with these documents is wrong — stop and flag it rather than silently deviating.

## 6. ADR Gate (new, added by this planning pass)

`Code Gap Analysis — 2026-07-29` introduced a mandatory ADR gate before any multi-tenancy code (Stage 2, mapping to WP-005 onward) may begin:

- Tenant/Data Ownership ADR
- Identity/Membership ADR
- Location/Warehouse ADR
- Authorization/Entitlements ADR
- Platform Boundary ADR
- Migration/Backfill/Rollback Runbook

**WP-005's document splits into Phase A (draft these 6 artifacts, commit them as `Proposed`, then STOP) and Phase B (implement schema, only after Osama has changed their status to `Accepted` in the committed files).** WP-003 and WP-004 do not touch tenancy and are not blocked by this gate.
