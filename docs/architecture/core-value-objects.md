# ATHR Core Value Objects

WP-004 builds the real `@athr/domain-core` value-object layer defined by the
Domain Model's "Shared Kernel المحدود" (§3): `Money`, `CurrencyCode`,
`Quantity`, a reference-only `UnitOfMeasureId`, `Percentage`/`Rate`,
`UtcTimestamp`/`BusinessDate`, typed opaque IDs, `AggregateVersion`, a
minimal `Result`/`DomainFailure` primitive, and `EmailAddress`/`PhoneNumber`.
It then removes floating-point (`REAL`) money storage from the POS local
SQLite database, migrating existing local data non-destructively. It does
not touch `backend/prisma/schema.prisma`, does not wire `Result` into any
real handler, and does not implement Unit-of-Measure conversion, tax, or
pricing rules (WP-008).

## `@athr/domain-core`

| File | Contents |
| --- | --- |
| `internal/decimal.ts` | Shared BigInt-scaled decimal parsing/formatting/division helpers used by `money.ts`, `quantity.ts`, `percentage.ts`. Not exported from the package. |
| `money.ts` | `Money`, `CurrencyCode`, `SUPPORTED_CURRENCY_CODES`, `MONEY_ROUNDING_MODE`, `MoneyWire` |
| `quantity.ts` | `Quantity`, `UnitOfMeasureId`, `QUANTITY_DEFAULT_SCALE`, `QuantityWire` |
| `percentage.ts` | `Percentage`, `PERCENTAGE_RATE_SCALE`, `PercentageWire` |
| `ids.ts` | `OpaqueId<Brand>`, `parseOpaqueId`, and concrete `TenantId`/`IdempotencyKey`/`ClientOperationId`/`CorrelationId`/`CausationId`/`AggregateVersion` |
| `datetime.ts` | `UtcTimestamp`, `BusinessDate`, `OccurredAt`/`RecordedAt`/`EffectiveAt` naming aliases (Domain Model `DM-GEN-010`) |
| `result.ts` | `Result<TValue, TFailure>`, `DomainFailure`, `ok`/`fail` |
| `identity-value-objects.ts` | `EmailAddress`, `PhoneNumber` |

No aggregate-specific status/state-machine value object was added (no
`SaleStatus`, no `PaymentStatus`) — everything here passes the Shared Kernel
Admission Rule (`ATHR Dependency Rules v1.0` §23). No `SaleId`/`TransferId`/
etc. opaque ID was pre-created; those land with the WP that introduces the
owning aggregate, using the same `OpaqueId` helper.

### Rounding policy

`MONEY_ROUNDING_MODE = 'HALF_UP'` (round half away from zero), applied
consistently across `Money`, `Quantity`, and `Percentage`. This was chosen
over banker's rounding (round-half-to-even) specifically to match the POS
local money codec already shipped in `pos-electron/electron/money.ts`
(`toCents`'s `roundsUp = fraction[2] >= 5` check), which cashiers already
reconcile cash drawers against — introducing a different rounding policy in
`domain-core` would create silent discrepancies between the new value
objects and existing POS totals for the same input.

All arithmetic operates on `BigInt`-scaled integers, never on native JS
`number`, so classic float traps cannot occur:
`Money.of('0.10','EGP').add(Money.of('0.20','EGP'))` yields exactly `'0.30'`,
not `0.30000000000000004`. `Money.multiplyByRate` similarly multiplies
scaled `BigInt`s and rounds once at the end, rather than rounding
intermediate floats.

### Currency and precision policy

`money.ts` starts with a small fixed table (`EGP`, `USD`, `SAR`, 2 decimal
places each). To add a currency: add its code to `SUPPORTED_CURRENCY_CODES`
and its `CurrencyPolicy` entry (code + minor-unit scale) to
`CURRENCY_POLICIES` — no other change is required.

`quantity.ts` uses a single provisional `QUANTITY_DEFAULT_SCALE = 3` for
every unit, since the real per-Unit-of-Measure precision/conversion policy
is WP-008's job; this WP only needed a reference `UnitOfMeasureId` and a
scale-validated decimal value, not real UOM semantics.

`percentage.ts` stores `rate` (6 decimal places internally) as the single
canonical value; `display_percent` is always derived from it on demand
(`rate * 100`, formatted at `PERCENTAGE_RATE_SCALE - 2` decimal places) —
never independently settable, per API Contract v1.0 §28.

### `@athr/contracts` dependency direction (Task 3 resolution)

`ATHR Dependency Rules v1.0` §3's workspace graph lists `@athr/domain-core`
and `@athr/error-registry` above `@athr/contracts`, and §4 is explicit in
both directions: `@athr/contracts` "May import: pure value/identifier
representations approved for wire use" (i.e. `domain-core`), while
`@athr/domain-core` "Must not import: ... contracts transport DTOs." So
`domain-core` is the more foundational package — the opposite of the
assumption named in WP-004 §4 Task 3 ("domain-core depending on contracts is
allowed"). This is not treated as a Stop Condition conflict, because it
resolves cleanly without touching anything WP-003 already shipped:

- **Production code** (`money.ts`, `quantity.ts`, `percentage.ts`) never
  imports `@athr/contracts`. Each file declares its own `MoneyWire`/
  `QuantityWire`/`PercentageWire` interface, structurally identical to the
  ones in `packages/contracts/src/money.ts`. No runtime or type-level
  production dependency exists in either direction between the two
  packages.
- **Contract tests only** (`money.spec.ts`, `quantity.spec.ts`,
  `percentage.spec.ts`) use `import type { MoneyWire as ContractsMoneyWire }
  from '@athr/contracts'` to assign a constructed value object's `toWire()`
  output to the real contracts type, proving structural round-trip
  compatibility at compile time. This matches `ATHR Testing Strategy v1.0`
  §28 ("Contract tests import public API only") and `ATHR Dependency Rules
  v1.0` §16 ("build/test-only tools appear in devDependencies").
- `@athr/contracts` is therefore declared only under `domain-core`'s
  `devDependencies`, not `dependencies`. `scripts/check-workspace.mjs`
  confirms zero cycles with this edge in place (`contracts` does not depend
  back on `domain-core`).
- `packages/domain-core/package.json`'s `exports` map gained a `"default"`
  condition alongside the existing `"require"`/`"types"` ones — needed
  because Vite's ESM resolver (used by `pos-electron`'s vitest suite) does
  not match a bare `"require"` condition. This is additive and does not
  change resolution for any existing CommonJS consumer.

## POS local database migration (`pos-electron/electron/`)

### §0.5 discovery

The POS local schema is defined inline in `main.ts`'s `initDb()` (no
separate schema/migration files exist). The `REAL` money columns are:

- `products.cost_price`, `products.selling_price`, `products.unit_tax`
- `sales_local.total`

Schema evolution already has an established mechanism: an array of
`ALTER TABLE ... ADD COLUMN` statements run inside a `try { } catch {}` loop
every startup, tolerating "column already exists" errors (idempotent by
construction). This WP extends that exact mechanism rather than inventing a
new one — it does not touch the `CREATE TABLE` statements.

The existing non-destructive, SHA-verified, "original data retained"
pattern is `pos-electron/electron/local-state-migration.ts` (the
`bold_pos.sqlite` → `athr_pos.sqlite` file migration from WP-001): never
overwrite an existing target, verify the copy's checksum, and write a local
JSON marker recording what happened. This WP's data migration follows the
same non-destructive spirit at the row level: the `REAL` columns are never
modified or dropped, only new columns are added and backfilled.

### Chosen representation

Each `REAL` column gets a sibling `INTEGER` column holding the amount in
**minor units** (cents): `cost_price_minor_units`, `selling_price_minor_units`,
`unit_tax_minor_units`, `total_minor_units`. Integer minor-units is the
simplest safe SQLite representation — SQLite's `INTEGER` storage class has
no float-precision concerns, and it matches the internal representation
`@athr/domain-core`'s `Money` already uses.

### Migration (`money-column-migration.ts`)

`migrateMoneyColumnsToMinorUnits` runs once per app start (called from
`initDb()`, right after the `ALTER TABLE` loop):

1. **Idempotency gate**: reads a `sync_meta` marker
   (`money_minor_units_migration_version`, reusing the exact
   `getMeta`/`setMeta` mechanism already used for `catalog_format_version`/
   `sync_cursor`). If already set, the migration is a no-op.
2. **Backfill**: for every `products`/`sales_local` row where the
   corresponding `*_minor_units` column `IS NULL`, converts the `REAL` value
   to minor units and writes it — the `REAL` column itself is never
   touched. A `NULL` source value (e.g. an unset `cost_price`) stays `NULL`,
   not `0`.
3. **Checksum log**: sums the `REAL` values before and the derived minor
   units (divided by 100) after, per table, and writes both counts and sums
   to `athr-money-migration.json` in the app's `userData` directory (plus a
   `console.log`) — local only, never transmitted to a server — so a
   support engineer can confirm no value moved by more than the expected
   rounding epsilon.
4. Sets the marker, so a second run (e.g. next app start) is a fast no-op.

**Float-to-decimal conversion bug caught by the migration's own test**: the
first implementation converted a `REAL` value via `numeric.toFixed(2)`
before feeding it to the codec. `toFixed` rounds using the raw IEEE-754
binary value, which for an input like `100.005` (whose nearest double is
actually `~100.00499999999999901`) silently rounds down to `"100.00"`
instead of `"100.01"`. The fix uses `String(numeric)` — the shortest
round-trip decimal — which preserves the digits as originally written and
lets `Money`'s exact `BigInt` parser make the correct `HALF_UP` call. The
migration's fixture test (`money-column-migration.test.ts`) seeds exactly
this value, plus a raw `0.1 + 0.2` (`0.30000000000000004`) value, to prove
the migration collapses both back to the correct minor units (`10001` and
`30` respectively).

### POS local-storage codec (`money-codec.ts`)

Per `ATHR Dependency Rules v1.0` §3/§4, `domain-core` only exports the pure
`Money` value object — it has no SQLite/storage awareness. The local-storage
codec that adapts `Money` to SQLite's integer column type lives in
`pos-electron/electron/money-codec.ts`:

```ts
decimalToMinorUnits(amount: number | string): number
minorUnitsToDecimal(minorUnits: number): string
```

ATHR POS currently operates in Egypt only (the receipt template already
hardcodes `EGP`/`"ج"`), so the codec fixes the currency to `EGP` rather than
threading a `CurrencyCode` through every call site; a future multi-currency
WP will change that.

### Call sites updated (narrow, mechanical substitution)

- `hydrateHeldSale()` — reads `selling_price_minor_units`/
  `unit_tax_minor_units` instead of the `REAL` columns.
- `pos:sale` handler — `INSERT INTO sales_local` now also writes
  `total_minor_units` via `decimalToMinorUnits(localTotal)`.
- `sync:get_outbox` — reads `total_minor_units` and derives `local_total`
  via `minorUnitsToDecimal` instead of selecting the `REAL` column directly.
- `pos:list_local_sales` — reads `total_minor_units` and derives `total` the
  same way.
- Catalog upsert (`INSERT OR REPLACE INTO products`) — now also computes
  and writes `cost_price_minor_units`/`selling_price_minor_units`/
  `unit_tax_minor_units` alongside the existing `REAL` columns (this
  statement fully replaces each row on every catalog sync, so the new
  columns must be populated at write time, not just backfilled once).

The receipt-printing HTML template (`formatMoney(invoice.total)`) was left
unchanged: `invoice` there is renderer-supplied sale data passed as an IPC
argument, not a `REAL` column read, so it is out of this WP's §0.5 scope.

### POS installed-version compatibility

An already-installed `1.5.0` POS device upgrades cleanly: `initDb()`'s
`ALTER TABLE` loop and the migration both run unconditionally on every
start and are fully idempotent (tolerate "column exists", gated by the
`sync_meta` marker). No existing row is deleted, no column is dropped, and
the legacy `REAL` columns keep their pre-migration values forever as an
audit trail. The migration was tested against a fixture resembling real
pending-offline-sale data (multiple `products` rows including a `NULL`
`cost_price`, and `sales_local` rows with pending totals), not just empty
tables — see `money-column-migration.test.ts`.

## What remains out of scope

- `backend/prisma/schema.prisma` — untouched; PostgreSQL already uses
  `Decimal`.
- Wiring `Result`/`DomainFailure` into any real application handler — no
  handlers exist yet outside WP-000/001/003 fixes.
- Unit-of-Measure conversion, tax calculation, pricing rules — WP-008.
- Dropping the legacy `REAL` columns — forward-only for now; a later WP may
  prove it safe to drop them once enough production devices have run this
  migration.
