# WP-003 — API and Error Contract Foundation

**Repository:** `OsamaIbrhim/bold_system`
**Base branch:** `master`
**Work branch to create:** `feat/wp-003-api-error-contracts`
**Depends on:** WP-000, WP-001, WP-002 (all closed and merged — see `docs/wp/WP-000-to-002-baseline-status.md`)
**Blocks:** WP-004 and everything after it (all later WPs return errors and API responses through this contract)

---

## 0. Mandatory Pre-Flight — Do This Before Writing Any Code

You are starting in a brand-new session with no memory of any prior conversation. Do the following, in order, before touching code:

1. Read `docs/wp/WP-000-to-002-baseline-status.md` in full and independently verify every marker listed in its §2. If any marker is missing, stop and report — do not proceed.
2. Run `git fetch origin && git checkout master && git pull origin master` and confirm a clean working tree (`git status`).
3. Create the work branch: `git checkout -b feat/wp-003-api-error-contracts`.
4. Read these files in the repository (not summaries — the actual current files) before writing anything:
   - `packages/contracts/package.json`, `packages/contracts/src/index.ts`
   - `packages/error-registry/package.json`, `packages/error-registry/src/index.ts`
   - `packages/domain-core/src/index.ts`
   - `backend/src/app.module.ts`
   - `backend/src/main.ts`
   - Any existing global exception filter under `backend/src/` (search: `grep -rl "ExceptionFilter" backend/src`)
   - Any existing response-shaping interceptor (search: `grep -rl "NestInterceptor" backend/src`)
   - `backend/src/sales/sales.controller.ts` and `backend/src/sync/sync.controller.ts` as examples of current (pre-WP-003) response shapes — you will migrate these gradually, not all at once.
5. Read `docs/02-contracts/api-contract.md` and `docs/02-contracts/error-catalog.md` in full. These are the planning-baseline source of truth for everything in this WP. Do not invent envelope shapes, error codes, or header names that contradict them.

---

## 1. Objective

Turn `@athr/contracts` and `@athr/error-registry` (currently near-empty scaffolds from WP-002) into the real, enforced API and error contract layer described in `ATHR API Contract v1.0` and `ATHR Error Catalog v1.0`: response envelopes, command/query result shapes, field errors, a stable error-code registry, retry modes, outcome-certainty, idempotency-key handling, and request/correlation IDs. Wire this into the Backend as a global, reusable foundation — **without** rewriting every existing controller in this WP. Existing unmigrated routes must keep working.

## 2. Scope

### In scope

- `@athr/contracts`: TypeScript types (not classes with logic) for:
  - Query response envelope (`data`, `meta`, `links`) — API Contract §8.
  - List response envelope with cursor `page` block — API Contract §9.
  - Command success envelope (sync "succeeded" and async "accepted" variants) — API Contract §10.
  - Error envelope and error detail shape — API Contract §12, Error Catalog §3–§4.
  - Money, Quantity, Percentage wire-format types (decimal **strings**, not `number`) — API Contract §26–§28. (Full value-object *behavior* — arithmetic, rounding — is WP-004's job; WP-003 only defines the wire shapes these travel in.)
  - Standard request/response header name constants: `X-Request-Id`, `X-Correlation-Id`, `Idempotency-Key`, `If-Match`, `ETag`, `Retry-After`, `X-Client-Operation-Id` — API Contract §6.
  - Cursor pagination request/response types — API Contract §33–§34.
- `@athr/error-registry`: the stable error-code catalog as a typed, enumerable registry:
  - Error code → `{ category, defaultHttpStatus, retryable, retryMode, outcome, severity, auditRequired }` metadata, per Error Catalog §29.
  - Start with the codes needed by currently-existing modules only (auth, sales, sync, generic request/validation, generic internal) — do **not** pre-populate codes for domains that don't exist in code yet (e.g. billing, loyalty). Add the rest module-by-module in WP-005 onward as each context is built. List which code groups you added at the end of this WP's Delivery Log entry.
  - Category enum exactly matching Error Catalog §5.
  - Retry-mode enum exactly matching Error Catalog §7.
  - Outcome-certainty enum exactly matching Error Catalog §6 (`no_effect`, `committed`, `pending`, `partial`, `unknown`, `not_applicable`).
- Backend infrastructure (NestJS), added as new, additive pieces — do not delete or rewrite existing controllers:
  - A global `ResponseEnvelopeInterceptor` that wraps successful controller returns in the query/list/command envelope shape, driven by metadata the controller declares (not by guessing response shape).
  - A global `AthrExceptionFilter` that catches thrown domain/application errors and any unhandled exception, maps them through `@athr/error-registry` to the standard error envelope, and never leaks raw Prisma/SQL/provider messages or stack traces (Error Catalog §2 rule 5, Coding Standards §16/§24).
  - A `RequestContextMiddleware` (or interceptor) that generates/propagates `X-Request-Id` and `X-Correlation-Id` on every request and response, per API Contract §6.
  - An `IdempotencyKeyGuard`/interceptor skeleton: validates the `Idempotency-Key` header is present on routes that declare `@RequiresIdempotencyKey()`, and defines (but does not yet have to fully implement storage for, since no domain module uses it yet) the record shape from API Contract §21. If there is no natural first consumer yet, add one focused contract test proving the guard rejects a missing key on a synthetic test route, and leave a `// TODO(WP-010): wire real idempotency storage` marker with owner and WP reference per Coding Standards §22/§26.
  - A minimal `ExpectedVersionGuard` concept documented and stubbed the same way (real usage starts once aggregates have versions — WP-005+).
- Contract tests in `packages/contracts` and `packages/error-registry` proving the shapes/enums match the two source documents.
- Backend contract tests proving: unhandled exception → safe `500 INTERNAL_ERROR` envelope with no stack trace; a deliberately-thrown known domain error → correct HTTP status + code + envelope; every response carries `X-Request-Id`.
- Migrate **exactly two** existing endpoints as a proof-of-concept to the new envelope/error contract, chosen because they are low-risk and already well-tested: pick one query endpoint (e.g. `GET /health` extended, or a simple read route) and one already-idempotent command endpoint. State exactly which two you migrated in the Delivery Log. Do not migrate `sales`, `sync`, or any endpoint with financial/inventory side effects in this WP — that happens per-domain in WP-008 through WP-018 as each context is rebuilt.

### Out of scope (do not do this in WP-003)

- Rewriting all existing controllers to the new envelope — that is incremental, per-domain, in later WPs.
- Implementing real Money/Quantity value-object arithmetic — that's WP-004.
- Tenant context, permissions, entitlements — WP-005/006/007.
- Sync protocol implementation — WP-016.
- Any change to `schema.prisma` or a new migration. This WP has **zero** database impact.
- Any change to Admin or POS applications beyond consuming the new `@athr/contracts` types if trivially convenient; do not force a UI change in this WP.

## 3. Architecture Rules You Must Follow (condensed from approved baselines)

From `ATHR Repository and Package Architecture v1.0` §7 and `ATHR Dependency Rules v1.0` §4:

- `@athr/contracts` may import pure value/identifier types and `@athr/error-registry` public metadata only. It must **never** import Prisma, NestJS decorators, application handlers, React, or Electron code.
- `@athr/error-registry` may import pure shared identifiers/types only. No HTTP framework exceptions, no UI translation bundles.
- Both packages must declare explicit `exports` in `package.json` (no wildcard exports) per Repository Architecture §19 and Dependency Rules §15.
- The Backend `AthrExceptionFilter` and `ResponseEnvelopeInterceptor` live in `backend/src/common/` (or a similarly-scoped, non-"utils" location — do not create a generic `utils/` dumping ground per Repository Architecture §11).
- Domain/Application code (once it exists in later WPs) must throw **domain failures**, never HTTP exceptions directly — the Delivery layer (this WP's filter) does the HTTP mapping. This WP establishes that seam even though most domain code doesn't exist yet.

From `ATHR Coding Standards v1.0`:

- No floats for money — even at the wire-type level, `amount` is a `string`.
- No `any` outside a documented, bounded adapter boundary.
- Errors carry stable code, retry mode, outcome certainty, correlation ID (§16).
- No empty catch blocks (§16).

## 4. Detailed Task List

1. **`@athr/contracts` types** — add to `packages/contracts/src/`:
   - `envelopes.ts`: `QueryEnvelope<T>`, `ListEnvelope<T>`, `CommandSuccessEnvelope<T>`, `CommandAcceptedEnvelope`, `ErrorEnvelope`, `ErrorDetail` — matching the exact JSON shapes in API Contract §8, §9, §10, §12 and Error Catalog §3, §4.
   - `money.ts`: `MoneyWire { amount: string; currency: string }`, `QuantityWire { value: string; unit_id: string; unit_code: string }`, `PercentageWire { rate: string; display_percent: string }`.
   - `headers.ts`: exported `const` string names for every header in API Contract §6 (avoid magic strings scattered across the codebase).
   - `pagination.ts`: `PageRequest { limit?: number; after?: string; before?: string }`, `PageMeta { limit: number; next_cursor: string | null; previous_cursor: string | null; has_more: boolean }`.
   - Update `packages/contracts/src/index.ts` to export all of the above with explicit named exports (no `export *` from unreviewed internals).
   - Update `packages/contracts/package.json` `exports` field if new sub-path exports are needed; otherwise keep single entry point unless a browser/node split is genuinely required (it likely is not yet, since these are pure types).

2. **`@athr/error-registry` registry** — add to `packages/error-registry/src/`:
   - `categories.ts`: the `ErrorCategory` union exactly matching Error Catalog §5.
   - `retry-modes.ts`: the `RetryMode` union exactly matching Error Catalog §7.
   - `outcomes.ts`: the `OutcomeCertainty` union exactly matching Error Catalog §6.
   - `codes/common.ts`: request/schema codes from Error Catalog §31–§33 that are actually reachable today (malformed body, missing header, pagination/cursor/filter codes).
   - `codes/auth.ts`: authentication/authorization codes from Error Catalog §34–§36 that map to the Backend's current JWT guard behavior (`AUTHENTICATION_REQUIRED`, `ACCESS_TOKEN_INVALID`, `ACCESS_TOKEN_EXPIRED`, `SESSION_REVOKED`, `PERMISSION_DENIED`, `RESOURCE_NOT_FOUND` for concealment per §36).
   - `codes/internal.ts`: `INTERNAL_ERROR`, `UNEXPECTED_PROCESSING_ERROR` (Error Catalog §24).
   - `registry.ts`: a single `ERROR_REGISTRY: Record<ErrorCode, ErrorMetadata>` map plus a `getErrorMetadata(code)` accessor that throws a clear developer-time error if a code is used without being registered (this is what prevents silent drift between code and catalog).
   - Update `packages/error-registry/src/index.ts` exports accordingly.

3. **Backend common module** — create `backend/src/common/`:
   - `resource-id.ts` already exists from WP-000 (`backend/src/common/resource-id.ts`) — do not duplicate; import from there for any ID-safety logic you need.
   - `http/response-envelope.interceptor.ts` — implements `NestInterceptor`, wraps outgoing responses. Reads a small decorator (`@Envelope('query' | 'list' | 'command')`) or a naming convention agreed in this file; document whichever you choose in a short comment block, since later WPs' controllers depend on it.
   - `http/athr-exception.filter.ts` — implements `ExceptionFilter`, catches all exceptions, maps known error codes via `@athr/error-registry`, falls back to `INTERNAL_ERROR` for anything unrecognized, strips stack traces and raw provider/Prisma messages from the client response (they may still go to server-side structured logs, redacted per Coding Standards §17).
   - `http/request-context.middleware.ts` — generates `X-Request-Id` if the client didn't send one, always generates `X-Correlation-Id` server-side, attaches both to `req` for downstream use and to every response header.
   - `http/idempotency-key.guard.ts` — the skeleton described in §2 above, with the explicit `// TODO(WP-010)` marker.
   - Register the interceptor, filter, and middleware globally in `backend/src/main.ts` (filter/interceptor via `app.useGlobalFilters` / `app.useGlobalInterceptors`; middleware via `app.use` or a Nest module).
   - Do **not** remove or alter any existing guard/interceptor already wired in `main.ts` — add alongside them, and if you find a genuine conflict (e.g. an existing catch-all filter), read it fully, understand why it exists, and reconcile rather than silently overriding. Document what you found and how you reconciled it in the Delivery Log.

4. **Proof-of-concept migration** — pick and migrate exactly two endpoints per §2 "In scope" above. Show the before/after response shape in the PR description.

5. **Tests** — see §6 below.

6. **Documentation** — add `docs/design-notes/api-error-contract-foundation.md` (short, factual, mirrors the workspace-foundation doc style from WP-002) describing what was implemented, what remains a stub (idempotency storage, expected-version enforcement), and which two endpoints were migrated.

## 5. Files You Will Create

```
packages/contracts/src/envelopes.ts
packages/contracts/src/money.ts
packages/contracts/src/headers.ts
packages/contracts/src/pagination.ts
packages/contracts/test/envelopes.test.cjs
packages/contracts/test/money.test.cjs
packages/error-registry/src/categories.ts
packages/error-registry/src/retry-modes.ts
packages/error-registry/src/outcomes.ts
packages/error-registry/src/codes/common.ts
packages/error-registry/src/codes/auth.ts
packages/error-registry/src/codes/internal.ts
packages/error-registry/src/registry.ts
packages/error-registry/test/registry.test.cjs
backend/src/common/http/response-envelope.interceptor.ts
backend/src/common/http/response-envelope.interceptor.spec.ts
backend/src/common/http/athr-exception.filter.ts
backend/src/common/http/athr-exception.filter.spec.ts
backend/src/common/http/request-context.middleware.ts
backend/src/common/http/request-context.middleware.spec.ts
backend/src/common/http/idempotency-key.guard.ts
backend/src/common/http/idempotency-key.guard.spec.ts
docs/design-notes/api-error-contract-foundation.md
```

## 6. Files You Will Modify

```
packages/contracts/src/index.ts        — add new exports
packages/error-registry/src/index.ts   — add new exports
backend/src/main.ts                    — register global filter/interceptor/middleware
backend/src/app.module.ts              — only if module registration is required; keep change minimal
<the two chosen POC controller files>  — apply @Envelope() and updated error throwing
```

Do not touch any file under `backend/src/sales/`, `backend/src/sync/`, `backend/src/inventory/`, `backend/src/shifts/`, `pos-electron/`, or `admin-web/` unless one of them is your chosen POC endpoint (state which, if so, explicitly in the PR).

## 7. Testing Requirements (per `ATHR Testing Strategy v1.0`)

- **Contract tests** (`packages/contracts`, `packages/error-registry`): every exported shape/enum has at least one test asserting its keys/values against this WP doc's transcription of the source documents. Registry completeness test: every `ErrorCode` referenced anywhere in `backend/src` after this WP resolves via `getErrorMetadata` (a static scan test, not just runtime).
- **Backend unit/contract tests**:
  - `athr-exception.filter.spec.ts`: unknown thrown value → `500 INTERNAL_ERROR`, no stack trace in body, correlation ID present; known registered error → correct status/code/envelope.
  - `response-envelope.interceptor.spec.ts`: query/list/command envelope shapes match exactly, including `meta.request_id`.
  - `request-context.middleware.spec.ts`: request without `X-Request-Id` gets one generated; request with one gets it echoed; `X-Correlation-Id` always present.
  - `idempotency-key.guard.spec.ts`: route decorated with `@RequiresIdempotencyKey()` rejects missing header with `IDEMPOTENCY_KEY_REQUIRED` (428, per Error Catalog §22); route without the decorator is unaffected.
- **Regression**: run the full existing Backend suite and confirm the previously-passing 50+ suites / 216+ tests still pass unchanged (global interceptor/filter must not alter untouched endpoints' behavior for callers who don't opt into `@Envelope()`).
- Run from repo root: `npm run test:soft` (Backend/Admin/POS soft gates), plus any package-specific test command declared in `packages/contracts/package.json` and `packages/error-registry/package.json`.
- This WP has no database/migration impact, so the migration gate does not need to run — but confirm `npm run workspace:cycles` (or whatever the WP-002 dependency-cycle script is named — check `scripts/check-workspace.mjs`) still passes, since you're adding new cross-package imports.

## 8. Acceptance Criteria (Definition of Done)

- [ ] `@athr/contracts` exports envelope, money/quantity/percentage wire types, header constants, and pagination types; all have explicit `exports` and pass contract tests.
- [ ] `@athr/error-registry` exports category/retry-mode/outcome enums and a registry covering common/auth/internal codes only (not speculative future-domain codes); registry completeness test passes.
- [ ] Backend has a global exception filter that never leaks stack traces, raw Prisma errors, or provider secrets to clients, and always returns the standard error envelope with `request_id`/`correlation_id`.
- [ ] Backend has a global response-envelope interceptor usable via an explicit opt-in mechanism (decorator or documented convention), proven on exactly two migrated endpoints.
- [ ] `X-Request-Id` and `X-Correlation-Id` appear on every Backend HTTP response, migrated or not.
- [ ] Idempotency-key guard exists and is tested against a synthetic route; a clear `TODO(WP-010)` marks where real storage plugs in.
- [ ] Zero changes to `schema.prisma`, zero new migrations.
- [ ] All previously-passing Backend/Admin/POS tests still pass unchanged.
- [ ] `npm run typecheck`, `npm run test:soft`, dependency-cycle check, and Backend/Admin/POS builds all pass from a clean checkout.
- [ ] No `bold-*` names introduced; no new dependency cycle; no forbidden import direction per `ATHR Dependency Rules v1.0` (verify with the WP-002 graph/cycle script).
- [ ] `docs/design-notes/api-error-contract-foundation.md` written, describing scope, stubs, and the two migrated endpoints.
- [ ] Delivery Log entry appended (do not edit prior entries) using the template in `docs/delivery/delivery-log.md`.

## 9. Branch, Commit and PR Instructions

Per `ATHR Git and Branching Strategy v1.0`:

1. Work on `feat/wp-003-api-error-contracts`, branched from current `master` (confirmed clean per §0).
2. Commit in logical steps using Conventional Commits (`feat(contracts): ...`, `feat(errors): ...`, `feat(backend): ...`, `test(...): ...`, `docs(...): ...`). No `WIP` commits in final history.
3. Open **one** PR titled `WP-003: API and Error Contract Foundation`, referencing this document. PR description must include: scope implemented, base/head SHA, the two migrated endpoints with before/after response examples, test results, and confirmation of zero migration impact.
4. Do not merge without required CI checks green (workspace/static gates, Backend/Admin/POS soft gates, dependency-cycle check). This WP does not require the migration gate (no schema change) but does require standard soft gates and release-gate-equivalent checks that apply to non-DB PRs.
5. Squash-merge per default policy. Delete the branch after merge.
6. Do not touch or reopen PR #43, #44, or #45 — they are already merged/closed.

## 10. Delivery Log Entry

Append a new entry to `docs/delivery/delivery-log.md` (find the exact current filename — do not guess) using the standard template already present at the top of that file (`Entry Template` section). Fill in real branch/SHA/test-result data — do not copy example values from this WP doc.

## 11. Prohibited in This WP

- Do not migrate `sales`, `sync`, `inventory`, `shifts`, or any endpoint with financial/inventory side effects to the new envelope yet.
- Do not implement real Money/Quantity arithmetic (WP-004).
- Do not touch `schema.prisma` or create a migration.
- Do not introduce a generic `utils/` or `common/helpers/` dumping ground beyond the specific `backend/src/common/http/` files listed above.
- Do not add tenant/permission logic (WP-005/006/007) — this WP is transport/error-contract only.
- Do not force Admin or POS to consume the new contracts in this WP.

## 12. Stop Conditions

Stop and report back rather than improvising if:

- The baseline markers in `docs/wp/WP-000-to-002-baseline-status.md` §2 don't match what you find in `master`.
- An existing global exception filter or interceptor already exists and its removal/replacement would change behavior for currently-passing tests in a way not describable as "additive."
- The API Contract or Error Catalog documents contradict something you find already implemented and load-bearing in production code — do not silently pick a side; document the contradiction and stop.
