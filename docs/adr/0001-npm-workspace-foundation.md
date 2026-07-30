# ADR-0001: npm workspace foundation

- **Status:** Accepted
- **Date:** 2026-07-30
- **Work package:** WP-002

## Context

Backend, Admin, and POS were installed independently, each owned a lockfile,
and each declared a pseudo-dependency on the repository root. That model hid
undeclared imports, allowed dependency versions to drift, and could not safely
host shared ATHR contracts.

Moving applications to `apps/*` would add deployment churn without changing
ownership, so directory relocation is not part of WP-002.

## Decision

- Keep `backend`, `admin-web`, and `pos-electron` as canonical application
  paths.
- Use npm workspaces from the repository root.
- Keep one root `package-lock.json`.
- Name every application and shared package under `@athr/*`.
- Introduce only four initial shared packages: contracts, domain-core,
  error-registry, and testing.
- Build shared packages with plain TypeScript and explicit root exports.
- Enforce declared dependencies, direction, cycles, and provider build roots
  with repository tests.
- Keep runtime migrations in a dedicated pre-deploy runner; application startup
  never runs schema migrations.

## Consequences

- Local and CI installation starts at the repository root.
- Railway and Vercel must build with repository-root context.
- POS installer jobs install once at root, then build the POS workspace.
- Existing application behavior, database schema, API contract, and POS
  protocol do not change.
- Backend and Admin retain explicit legacy TypeScript strictness exceptions;
  new shared packages do not inherit those exceptions.

## Recovery

If provider builds cannot use the workspace root, revert this work through a
new commit on `feat/athr-transformation`. Do not restore child lockfiles
partially, modify database migrations, or change production data as a workspace
rollback mechanism.
