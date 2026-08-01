# ATHR API and Error Contract Foundation

WP-003 turns `@athr/contracts` and `@athr/error-registry` from WP-002's
near-empty scaffolds into the real, enforced API/error contract layer, and
wires a global, opt-in envelope/error seam into the Backend. It does not
rewrite existing controllers, does not implement Money/Quantity arithmetic,
does not touch tenancy/permissions, and makes zero `schema.prisma` changes.

## `@athr/contracts`

Pure TypeScript types (no runtime classes) for the wire shapes in
`ATHR API Contract v1.0`:

| File | Contents |
| --- | --- |
| `envelopes.ts` | `QueryEnvelope`, `ListEnvelope`, `CommandSuccessEnvelope`, `CommandAcceptedEnvelope`, `ErrorEnvelope`, `ErrorDetail`, plus the `ErrorCategory`/`RetryMode`/`OutcomeCertainty`/`ErrorSeverity` wire unions (§8–§10, §12) |
| `money.ts` | `MoneyWire`, `QuantityWire`, `PercentageWire` — decimal **strings**, never `number` (§26–§28) |
| `headers.ts` | Header name constants — scoped to the seven headers this WP has a real consumer for: `X-Request-Id`, `X-Correlation-Id`, `Idempotency-Key`, `If-Match`, `ETag`, `Retry-After`, `X-Client-Operation-Id` (§6) |
| `pagination.ts` | `PageRequest`, `PageMeta` — cursor pagination (§33–§34) |

`ErrorCategory`/`RetryMode`/`OutcomeCertainty`/`ErrorSeverity` are
transcribed independently in `@athr/contracts` (wire shape) and
`@athr/error-registry` (server-side registry), deliberately **not** shared
across a package edge — each package contract-tests its own copy against the
same source document, so drift fails a test on whichever side drifted rather
than being hidden by a shared import.

Contract enforcement is two-layered: `src/__wire-shape-fixtures.ts` assigns
literal objects transcribed from the API Contract's own JSON examples to each
exported type, so `npm run build`/`typecheck` fails the moment a shape
drifts; `test/*.test.cjs` runtime-checks the header constants and confirms
the envelope/wire types stay pure types (no accidental runtime export).

## `@athr/error-registry`

| File | Contents |
| --- | --- |
| `categories.ts`, `retry-modes.ts`, `outcomes.ts` | Exhaustive unions matching Error Catalog §5, §7, §6 |
| `codes/common.ts` | Request/schema/query codes (§31, §33) reachable today, plus `IDEMPOTENCY_KEY_REQUIRED`/`IDEMPOTENCY_KEY_FORMAT_INVALID` (§37, §22) for `IdempotencyKeyGuard` |
| `codes/auth.ts` | Exactly the six codes the current `JwtAuthGuard`/`RolesGuard` can reach: `AUTHENTICATION_REQUIRED`, `ACCESS_TOKEN_INVALID`, `ACCESS_TOKEN_EXPIRED`, `SESSION_REVOKED`, `PERMISSION_DENIED`, `RESOURCE_NOT_FOUND` (concealment, §36) |
| `codes/internal.ts` | `INTERNAL_ERROR`, `UNEXPECTED_PROCESSING_ERROR` (§24) |
| `registry.ts` | `ERROR_REGISTRY: Record<ErrorCode, ErrorMetadata>` and `getErrorMetadata(code)`, which throws a developer-time error for any unregistered code |

Money/Quantity/Date codes (§32) are deliberately excluded — no validation
logic exists yet that can raise them (WP-004). Billing/loyalty/sync/etc.
codes are excluded per WP-003's explicit scope; they land module-by-module
from WP-005 onward.

`ErrorCode` is a real string-literal union (not `string`): every
`COMMON_ERROR_CODES`/`AUTH_ERROR_CODES`/`INTERNAL_ERROR_CODES` entry is typed
via `satisfies` rather than an explicit `: ErrorMetadata` annotation, which
keeps each `code` field's literal type intact instead of widening it.

## Backend common HTTP infrastructure (`backend/src/common/http/`)

| File | Role |
| --- | --- |
| `response-envelope.interceptor.ts` | `ResponseEnvelopeInterceptor` + `@Envelope('query' \| 'list' \| 'command')`. Registered **globally** via `app.useGlobalInterceptors` in `main.ts`. A handler without `@Envelope(...)` passes through completely unchanged. |
| `athr-exception.filter.ts` | `AthrExceptionFilter` + `AthrDomainError` (the seam future domain code throws through instead of raw `HttpException`s). Applied **per-route** via `@UseFilters(AthrExceptionFilter)` — see "Exception filter conflict" below. |
| `request-context.middleware.ts` | `RequestContextMiddleware`. Registered **globally** via `app.use` in `main.ts`, replacing the previous inline arrow-function middleware with identical request-id behavior plus `X-Correlation-Id`. |
| `idempotency-key.guard.ts` | `IdempotencyKeyGuard` + `@RequiresIdempotencyKey()` (functional skeleton, `TODO(WP-010)` for real storage), and `ExpectedVersionGuard` + `@RequiresExpectedVersion()` (pure stub, always allows — real enforcement in WP-005+). Neither is wired into any real route yet; both are proven against a synthetic handler in their spec. |

### Exception filter conflict and how it was reconciled

`backend/src/common/api-error.filter.ts` (`ApiExceptionFilter`) already
existed, already globally registered in `main.ts`
(`app.useGlobalFilters(new ApiExceptionFilter())`), and already produces a
different, non-ATHR-Catalog error shape (`status_code`/`code`/`message_ar`/…)
that many currently-passing tests and POS/Admin clients depend on.

NestJS resolves exception filters by taking the **first** filter in
registration order whose `@Catch()` metadata matches the thrown exception —
an unscoped `@Catch()` filter matches *every* exception. Two globally
registered catch-all filters cannot coexist additively: registering
`AthrExceptionFilter` after `ApiExceptionFilter` would mean it never fires;
registering it before would silently replace `ApiExceptionFilter`'s output
on every not-yet-migrated route, which is exactly the regression this WP
must not cause.

`AthrExceptionFilter` is therefore **not** passed to `app.useGlobalFilters`.
It is applied with `@UseFilters(AthrExceptionFilter)` directly on the two
migrated handlers (`HealthController.live`, `AuthController.logout`).
NestJS resolves method-scoped filters before falling back to global ones, so
this is genuinely additive: `ApiExceptionFilter` keeps owning every
unmigrated route's error output byte-for-byte, while the two migrated routes
get the real new contract. `AthrExceptionFilter` itself is written as an
ordinary global-style `ExceptionFilter` (no route-specific logic) and is
proven in isolation in `athr-exception.filter.spec.ts` — including the
`unknown exception → 500 INTERNAL_ERROR` and
`known AthrDomainError → registered status/code` cases required by this WP —
independent of how any given route chooses to attach it.

### Request-id/correlation-id middleware

`main.ts` already generated `X-Request-Id` inline (validate-or-`randomUUID()`,
stash on `req.requestId`, echo on the response) before this WP; that exact
behavior — same regex, same fields `PerformanceInterceptor` and
`ApiExceptionFilter` already read — is preserved unchanged inside
`RequestContextMiddleware`, which additionally always issues a
server-generated `X-Correlation-Id`. This is a formalization, not a new
global filter, so it carries none of the exception-filter conflict above:
`X-Request-Id`/`X-Correlation-Id` now appear on **every** response,
migrated or not.

### `ResponseEnvelopeInterceptor` is global (unlike the filter)

Unlike exception filters, NestJS interceptors compose (each wraps
`next.handle()`) rather than short-circuiting on first match, so a second
global interceptor is safe to add alongside the existing
`PerformanceInterceptor`. `ResponseEnvelopeInterceptor` only transforms a
response when the handler carries `@Envelope(...)` metadata; every other
route's response passes through `next.handle()` completely untouched.

## Proof-of-concept migration

Exactly two endpoints, per WP-003 scope (no `sales`/`sync`/`inventory`/`shifts`
endpoint touched):

### `GET /api/v1/health/live` — query envelope

Before:

```json
{"status":"ok","product":"ATHR","service":"athr-api","version":"1.0.0","commit":"unknown","environment":"development","configuration_schema":1}
```

After:

```json
{
  "data": {"status":"ok","product":"ATHR","service":"athr-api","version":"1.0.0","commit":"unknown","environment":"development","configuration_schema":1},
  "meta": {"request_id":"...","correlation_id":"...","generated_at":"2026-08-01T04:17:01.459Z"},
  "links": {"self":"/api/v1/health/live"}
}
```

### `POST /api/v1/auth/logout` — command envelope

Chosen because it is already idempotent: revoking an already-revoked or
non-existent refresh token is a no-op success (`updateMany` with a
`revoked_at: null` filter), so migrating it carries no new failure mode.

Before:

```json
{"ok": true}
```

After:

```json
{
  "data": {"resource": {"ok": true}, "command": {"command_id": "cmd_...", "status": "succeeded"}},
  "meta": {"request_id": "...", "correlation_id": "..."}
}
```

Both were verified end-to-end against a running instance (not just unit
tests): `health/live`, `health/ready` (unmigrated, confirmed byte-identical
except for the now-global request/correlation-id headers), `auth/logout`
(both a validation-error path and a success path), and an unmigrated 404
route (confirmed still served by `ApiExceptionFilter`'s original shape).

## What remains a stub

- **Idempotency storage** (`IdempotencyKeyGuard`): header presence/format
  only. `TODO(WP-010)` marks where stored-result lookup, payload-hash
  comparison, and `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` enforcement
  plug in, once a real command endpoint declares `@RequiresIdempotencyKey()`.
- **Expected-version enforcement** (`ExpectedVersionGuard`): always allows
  the request through. Real `If-Match`/`EXPECTED_VERSION_MISMATCH`
  enforcement starts once an Aggregate carries a version field (WP-005+).
- **List envelope in production**: `ResponseEnvelopeInterceptor` implements
  and unit-tests the `list` kind, but no real list endpoint opts in yet
  (neither POC route is a list) — the first list migration is later WP work.
