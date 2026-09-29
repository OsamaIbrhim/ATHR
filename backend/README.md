# Bold POS API – NestJS + Prisma

Multi-branch, offline-first POS for Bold Men's Clothing – Egypt

## Quick start
Requires Node.js 20.11 or newer and PostgreSQL.

```
cp .env.example .env
# Set JWT_SECRET to a unique value with at least 32 characters.
# For local PostgreSQL, DIRECT_URL can match DATABASE_URL.
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run start:dev
```
API: http://localhost:3000/api/v1
Docs: http://localhost:3000/api/docs
Liveness: http://localhost:3000/api/v1/health/live
Readiness: http://localhost:3000/api/v1/health/ready

Seed login: phone `+200100000000` / password `Bold1234` – role: owner

## Modules
- Auth – short-lived JWT access tokens, rotating hashed refresh tokens, bcryptjs, RBAC
- Pricing – compound engine, protected overhead, min_allowed_price
- Products – search by EAN-13 / internal barcode, stock_by_branch
- Inventory – lookup across branches
- Sales – server-priced, idempotent, transactional stock decrement
- Returns – original-line lookup, 14-day window, concurrency-safe quantities, refund snapshots
- Purchasing – atomic invoice/stock receipt, discount % / EGP, weighted cost, OCR import stub
- Customers – phone/WhatsApp, VIP pricing tier
- Transfers – authorized pending → shipped → received lifecycle with guarded stock
- Reports – sales / profit / best sellers
- Offers – slow-stock suggestions (90d default)
- Notifications – Email / WhatsApp Cloud API
- Sync – first branch snapshot followed by durable cursor-based product, price,
  and stock deltas; sales upload through idempotent command endpoints

Business endpoints require a JWT. The sale-upload endpoint is the deliberate
exception: it authenticates the enrolled POS device directly so completed
offline sales can still reach the cloud after a cashier JWT expires. Role
authorization and branch scoping remain server-side for all operator actions.

AR/EN i18n ready, EGP, tax configurable.

## Railway production deployment

The API intentionally refuses to start with missing or placeholder core
configuration. Configure these Railway variables before deploying:

```
NODE_ENV=production
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
JWT_SECRET=<unique random value of at least 32 characters>
CORS_ORIGINS=https://bold-system.vercel.app
POS_PROTOCOL_MIN=2
POS_PROTOCOL_MAX=2
POS_MIN_APP_VERSION=1.4.0
```

Price-signing and offline-ticket secrets are intentionally absent from sales
protocol v2. The locally completed sale contains an immutable item and price
snapshot; catalog drift produces a reconciliation warning instead of rejecting
the invoice.

Use this Railway pre-deploy command:

```
npm run prisma:migrate:deploy
```

Use `npm run start:prod` as the start command and
`/api/v1/health/live` as Railway's liveness path. Monitor
`/api/v1/health/ready` separately for database readiness.

### Required release gate

Backend releases must follow this path:

```
feature branch -> pull request -> release-gate -> master -> Railway
```

Protect `master` in GitHub and require the uniquely named `release-gate`
status check. Disable direct pushes and require the branch to be up to date
before merging. In Railway, enable **Wait for CI** for the connected GitHub
branch. Railway must keep `npm run prisma:migrate:deploy` as its pre-deploy
command; never put seeding or `prisma migrate resolve` in deployment commands.

The CI `backend` job performs all of the following before a release can
reach Railway:

- rejects edits or deletions of migrations already present in the target
  branch (`prisma/migrations/000000000000_baseline` is the collapsed history;
  adding a new baseline is the only explicit re-baseline);
- rejects a Prisma schema change without a new forward-only migration;
- applies the migrations to an empty PostgreSQL database and detects Prisma
  schema drift (`prisma migrate diff`);
- seeds the development data and runs `npm run test:db`, the real-PostgreSQL
  verifiers (tenant constraints, price books, tax codes, promotions, sync
  snapshot, raw-SQL tenant scoping, nested creates).

Run the immutable-history check locally against the exact target commit:

```
npm run prisma:migrations:policy -- --base origin/master
```

New database changes must be added in a new timestamped migration. A failed
production migration must stop the release and be investigated; do not edit
an applied migration and do not use `migrate resolve --applied` to bypass the
gate.

Run `npm run prisma:seed` only against an isolated development or test
database. It intentionally resets accounting, purchase, inventory-ledger, and
transfer data. The reset is blocked in production and requires:

```
ALLOW_DEVELOPMENT_ACCOUNTING_RESET=reset-development-accounting
```

A disposable remote test database additionally requires:

```
ALLOW_REMOTE_DEVELOPMENT_ACCOUNTING_RESET=1
```
