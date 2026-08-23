# WP-004 — Core Value Objects

**Repository:** `OsamaIbrhim/bold_system`
**Base branch:** `master`
**Work branch to create:** `feat/wp-004-core-value-objects`
**Depends on:** WP-000, WP-001, WP-002, WP-003 (all closed/merged — see `docs/wp/WP-000-to-002-baseline-status.md` and `docs/wp/WP-003-api-and-error-contract-foundation.md`)
**Blocks:** WP-005 onward — every later domain WP (Sales, Inventory, Purchasing, etc.) uses these value objects instead of primitive numbers/strings.

---

## 0. Mandatory Pre-Flight

1. Read `docs/wp/WP-000-to-002-baseline-status.md` and re-verify its §2 markers against current `master`.
2. Confirm WP-003 is merged: `packages/contracts/src/envelopes.ts`, `packages/contracts/src/money.ts`, `packages/error-registry/src/registry.ts` must exist. If they don't, stop — WP-003 must land first.
3. `git fetch origin && git checkout master && git pull origin master`, confirm clean tree, then `git checkout -b feat/wp-004-core-value-objects`.
4. Read in full (not summaries):
   - `packages/domain-core/src/index.ts` (current near-empty scaffold from WP-002).
   - `packages/contracts/src/money.ts` (the wire-format types from WP-003 — your domain value objects must serialize to/from exactly these shapes).
   - `docs/01-domain/domain-model.md` §2 (`DM-GEN-011`, `DM-GEN-014`) and §3 ("Shared Kernel المحدود") — this is the authoritative list of what belongs in `domain-core` and what does not.
   - `docs/04-engineering/coding-standards.md` §13 (Numeric Standards) and §14 (Date and Time).
   - `docs/03-architecture/dependency-rules.md` §4 (`@athr/domain-core` import rules) and §23 (Shared Kernel Admission Rule).
5. Locate and read the **actual current POS local database schema** — do not guess table/column names:
   ```bash
   grep -rl "REAL" pos-electron/electron | grep -i -E "schema|migration|sql"
   ```
   Read every file that command returns in full before touching it. Also read `pos-electron/electron/main.ts` sections that read/write those money columns (search for the column names you find), and any existing local-migration mechanism already used for the WP-001 `bold_pos.sqlite` → ATHR data migration, so you extend the same mechanism rather than inventing a second one.

## 1. Objective

Build the real `@athr/domain-core` value-object layer defined by the Domain Model's "Shared Kernel المحدود" (§3): `Money`, `CurrencyCode`, `Quantity`, `UnitOfMeasureId` (reference type only — the real Unit-of-Measure *aggregate* is WP-008's job), `Percentage`/`Rate`, `BusinessDate`/UTC timestamp handling, typed opaque IDs, `AggregateVersion`, `IdempotencyKey`, `ClientOperationId`, `CorrelationId`/`CausationId`, and a minimal `Result`/domain-failure primitive. Then remove floating-point (`REAL`) money storage from the POS local database, migrating existing local data safely.

## 2. Scope

### In scope

- **`packages/domain-core/src/`** pure, framework-free value objects:
  - `money.ts` — `Money` class/factory: constructed from a decimal string + `CurrencyCode`, immutable, validates scale against currency policy (start with a small fixed table: `EGP`, `USD`, `SAR` — 2 decimal places each; document how to add more), exposes `add`, `subtract`, `multiplyByRate`, `isNegative`, `isZero`, `equals`, `toWire(): MoneyWire` (from `@athr/contracts`), `static fromWire(wire): Money`. All internal arithmetic uses a decimal-safe representation (integer minor-units or a vetted arbitrary-precision approach) — **never** native JS `number` arithmetic on the amount. Rounding policy is explicit and documented at the top of the file (banker's rounding vs. half-up — pick one, document why, and make it a named constant, not a magic literal).
  - `quantity.ts` — `Quantity` value object: decimal value + `unitCode` reference (opaque `UnitOfMeasureId` string for now; real conversion logic is WP-008's), scale-validated, `toWire()`/`fromWire()` matching `QuantityWire`.
  - `percentage.ts` — `Percentage`/`Rate`: stores a single canonical decimal representation (pick `rate` as source of truth per API Contract §28, derive `display_percent` on demand — do not store both as independently-settable fields), `toWire()`/`fromWire()`.
  - `ids.ts` — a generic `OpaqueId<Brand extends string>` branded-type helper plus concrete branded ID types actually needed today: `TenantId`, `IdempotencyKey`, `ClientOperationId`, `CorrelationId`, `CausationId`, `AggregateVersion` (a positive integer wrapper, not a bare `number`, so callers can't accidentally pass an unrelated int where a version is expected). Do **not** pre-create ID types for aggregates that don't exist yet (no `SaleId`, `TransferId`, etc. — those are added by the WP that introduces that aggregate, using this same `OpaqueId` helper).
  - `datetime.ts` — `UtcTimestamp` (wraps an ISO-8601 UTC instant, rejects naive/local timestamps), `BusinessDate` (a `YYYY-MM-DD` value with an explicit IANA `TimezoneId`, distinct type from `UtcTimestamp` so the two can never be silently interchanged), helpers for `occurredAt`/`recordedAt`/`effectiveAt` naming per Domain Model `DM-GEN-010`.
  - `result.ts` — a minimal `Result<TValue, TFailure>` / `DomainFailure` primitive (discriminated union, no HTTP knowledge, no NestJS knowledge) that later WPs' application handlers will return instead of throwing for expected business failures. Keep this intentionally small — this WP does not wire it into any controller (that begins per-domain from WP-008 onward once real handlers exist).
  - `identity-value-objects.ts` — `EmailAddress` (normalized/validated) and `PhoneNumber` (E.164-normalized) per Domain Model §3, since the Identifier Classification Matrix in `Code Gap Analysis` treats these as globally-unique login identities. Only the value-object validation/normalization logic belongs here — the actual uniqueness enforcement is a WP-006 database concern.
- **Contract tests** for every value object: valid construction, invalid-state rejection, arithmetic correctness (including known decimal edge cases: `0.1 + 0.2` style traps must be proven absent), `toWire`/`fromWire` round-trip against the exact `@athr/contracts` wire types from WP-003, immutability (mutating methods return new instances, never mutate in place).
- **POS local schema migration**: convert the `REAL` money columns found in §0.5 to a decimal-safe representation (integer minor-units is the simplest safe choice for SQLite — document the chosen approach and why in `docs/design-notes/core-value-objects.md`). Write a local-database migration that:
  - Preserves every existing local row (this runs on real cashier machines with real pending offline sales — data loss here is a P0 incident, not a bug).
  - Converts existing `REAL` values to the new representation with explicit, tested rounding rules, and logs (locally, not to a remote server) a before/after checksum per affected table so a support engineer can verify no value silently changed by more than the expected rounding epsilon.
  - Follows the same "non-destructive, SHA-verified, original data retained" pattern WP-001 already established for the `bold_pos.sqlite` → ATHR migration (read that WP-001 migration code before writing this one; extend the established pattern, don't invent a new one).
  - Is forward-only: no destructive `DROP COLUMN` without first proving the new column round-trips correctly against a snapshot of production-shaped local data.
- Update the POS code paths that read/write those money columns to go through `Money.fromWire`/`toWire` (or an equivalent local-storage codec) instead of raw floats, in the specific files identified in §0.5 — this is a narrow, mechanical substitution in this WP, not a POS-wide refactor (that's WP-018).

### Out of scope

- Any Backend `schema.prisma` change. PostgreSQL already uses `Decimal` (per Current Repository Assessment §4) — this WP does not touch the cloud schema.
- Wiring `Result`/`DomainFailure` into any real application handler — no handlers exist yet outside WP-000/001 fixes; that starts in WP-008+.
- Unit-of-Measure conversion logic, tax calculation, pricing rules — WP-008.
- Tenant-scoping of anything — WP-005/006/007.
- POS main-process modularization beyond the specific money-column read/write call sites — that's WP-018's full scope.

## 3. Architecture Rules

- `@athr/domain-core` must not import NestJS, Prisma, React, Next.js, or Electron (`ATHR Dependency Rules v1.0` §4). If POS-side code needs a *local-storage codec* built on top of `Money`, that codec lives in `pos-electron/electron/`, not in `domain-core` — `domain-core` only exports the pure value object.
- A concept only enters `domain-core` if it passes the Shared Kernel Admission Rule (`ATHR Dependency Rules v1.0` §23): at least two contexts need identical semantics, ownership is not commercially disputed, no context-specific state machine. `Money`, `Quantity`, IDs, timestamps all pass this test. Do **not** add anything context-specific (no `SaleStatus`, no `PaymentStatus` — explicitly forbidden by §23).
- No floats for money anywhere you touch, per `ATHR Coding Standards v1.0` §13 and §28 (Prohibited Patterns).

## 4. Detailed Task List

1. Implement each file listed in §2 under `packages/domain-core/src/`, with unit tests colocated per `ATHR Testing Strategy v1.0` §9 (domain/value-object tests: valid creation, invalid-state rejection, arithmetic, immutability, no framework/DB required).
2. Update `packages/domain-core/src/index.ts` with explicit named exports (no wildcard).
3. Update `packages/domain-core/package.json` if a `@athr/contracts` dependency needs to be declared (it will, for `toWire`/`fromWire` types) — confirm this doesn't create a cycle (`domain-core` depending on `contracts` is allowed per the dependency graph in `ATHR Dependency Rules v1.0` §3: `domain-core` and `error-registry` sit *below* `contracts` — re-read that graph carefully; if `contracts` is meant to sit below `domain-core` instead, the wire-type conversion belongs the other way around. Resolve this precisely before writing code, and note your resolution in the Delivery Log, since WP-003 already shipped `@athr/contracts` independently of `domain-core`).
4. Write the POS local-database migration script following the WP-001 non-destructive pattern (§2 above), with a companion test that runs the migration against a fixture SQLite file seeded with realistic pre-migration data (including at least one row with a fractional value known to be float-unsafe, e.g. an amount that doesn't round-trip cleanly through IEEE-754) and asserts exact post-migration values.
5. Update the specific POS read/write call sites identified in §0.5 to use the new codec.
6. Write `docs/design-notes/core-value-objects.md`: document the rounding policy, the chosen minor-units representation, the currency table, and the migration approach.

## 5. Files You Will Create (indicative — confirm exact POS file names during §0.5 discovery)

```
packages/domain-core/src/money.ts
packages/domain-core/src/money.spec.ts
packages/domain-core/src/quantity.ts
packages/domain-core/src/quantity.spec.ts
packages/domain-core/src/percentage.ts
packages/domain-core/src/percentage.spec.ts
packages/domain-core/src/ids.ts
packages/domain-core/src/ids.spec.ts
packages/domain-core/src/datetime.ts
packages/domain-core/src/datetime.spec.ts
packages/domain-core/src/result.ts
packages/domain-core/src/result.spec.ts
packages/domain-core/src/identity-value-objects.ts
packages/domain-core/src/identity-value-objects.spec.ts
pos-electron/electron/<local-db-dir>/migrations/<next-sequential-id>_money_minor_units.ts   # exact path per §0.5 discovery
pos-electron/electron/<local-db-dir>/migrations/<next-sequential-id>_money_minor_units.spec.ts
docs/design-notes/core-value-objects.md
```

## 6. Files You Will Modify

```
packages/domain-core/src/index.ts
packages/domain-core/package.json               — only if a new declared dependency is required
<POS files identified in §0.5 that read/write REAL money columns>
```

Do not touch `backend/prisma/schema.prisma`. Do not touch any file under `backend/src/sales/`, `backend/src/inventory/`, or `admin-web/` in this WP.

## 7. Testing Requirements

- Full domain unit-test coverage per `ATHR Testing Strategy v1.0` §9 for every value object (valid/invalid construction, transitions/arithmetic, immutability, numeric edge cases).
- POS local-migration test proving: all pre-existing rows preserved, float→minor-units conversion is exact for a representative fixture set (include known problem values like `19.99`, `0.1`, `100.005` boundary-rounding cases), migration is idempotent if run twice (does not double-convert), and the migration does not run destructively against a database that has already been migrated.
- Re-run full existing POS test suite; all previously-passing tests must still pass.
- Run `npm run typecheck`, `npm run test:soft`, and the dependency-cycle script from repo root.

## 8. Acceptance Criteria (Definition of Done)

- [ ] `@athr/domain-core` exports `Money`, `Quantity`, `Percentage`, opaque ID helpers + concrete IDs listed in §2, `UtcTimestamp`/`BusinessDate`, `Result`/`DomainFailure`, `EmailAddress`/`PhoneNumber` — matching exactly the Shared Kernel list in `ATHR Domain Model v1.0` §3, no more, no less.
- [ ] No value object in `domain-core` fails the Shared Kernel Admission Rule (no context-specific status/state machine leaked in).
- [ ] Every value object has passing unit tests covering valid/invalid states, arithmetic/transitions, immutability, and `toWire`/`fromWire` round-trips against `@athr/contracts`.
- [ ] Zero native `number` arithmetic on money anywhere in `domain-core` or in the touched POS files.
- [ ] POS local `REAL` money columns identified in §0.5 are migrated to a decimal-safe representation with a tested, non-destructive, forward-only migration that preserves 100% of pre-existing local rows.
- [ ] `docs/design-notes/core-value-objects.md` documents rounding policy and migration approach.
- [ ] No `schema.prisma` change; no Backend/Postgres migration.
- [ ] All previously-passing Backend/Admin/POS tests still pass.
- [ ] Dependency-cycle check passes; no forbidden import direction.
- [ ] Delivery Log entry appended.

## 9. Branch, Commit and PR Instructions

Same process as WP-003 (`ATHR Git and Branching Strategy v1.0`): branch `feat/wp-004-core-value-objects` from `master`, Conventional Commits, one focused PR titled `WP-004: Core Value Objects`, squash-merge after required checks pass, delete branch after merge.

Because this WP touches the POS local database format, the PR description must explicitly call out: (a) the exact POS installed-version compatibility story (does an already-installed `1.5.0` POS device upgrade cleanly through this migration?), and (b) confirmation the migration was tested against a fixture resembling real pending-offline-sale data, not just empty tables.

## 10. Prohibited in This WP

- Do not add any aggregate-specific status/state-machine value object to `domain-core` (e.g. no `SaleStatus`).
- Do not touch `backend/prisma/schema.prisma`.
- Do not perform a POS-wide `main.ts` refactor — only the specific money read/write call sites.
- Do not run this migration against any real device or production data as part of this WP — it ships in the next POS release per normal release process; this WP only produces and tests the migration code.

## 11. Stop Conditions

- If §0.5 discovery finds no `REAL` money columns at all (i.e., they were already removed by an undocumented change), stop and report — do not silently skip the migration portion; confirm with Osama whether this section of the WP is already satisfied before marking it done.
- If resolving the `contracts` vs. `domain-core` dependency-direction question in Task 3 reveals an actual conflict with what WP-003 already shipped, stop and document the contradiction rather than picking a side unilaterally.
