# ATHR Testing Strategy v1.0

**Status:** Approved engineering-design baseline

**Applies to:** Backend, Admin, POS, shared packages, PostgreSQL/Prisma migrations, Sync/Offline, workers, deployment and release validation.

## 1. Purpose

تحدد هذه الوثيقة كيف يثبت ATHR أنالكود صحيح وآمن وقابلللنشر. الاختبارات ليستعددًا أوcoverage فقط؛ هيevidence علىbusiness invariants، tenant isolation، financial/inventory integrity، idempotency، offline recovery، migration safety وrelease readiness.

## 2. Testing Principles

1. test behavior andcontracts، لاimplementation details فقط.
2. كلbug fix يحتاجregression test.
3. كلcritical invariant يختبرhappy/failure/concurrency/idempotency.
4. production-like behavior معisolated data.
5. deterministic bydefault.
6. no test order dependence.
7. no shared mutable external state بينPRs.
8. failures تنتجdiagnostics قابلةللاستخدام.
9. skipped/flaky tests ليستنجاحًا.
10. release gate يجمعالأدلة ولايعيدادعاءها.

## 3. Test Pyramid

### Unit

Pure domain/value/policy/helper tests، سريعةومعزولة.

### Contract

Public package/API/error/event/sync/IPC contracts.

### Integration

Prisma/PostgreSQL, provider adapters, local POS DB, filesystem/IPC boundaries.

### E2E

User/business journeys عبرreal delivery boundaries.

### Hard/Performance

Representative load, smoke, migration, failure andrecovery behavior.

## 4. Soft vs Hard Suites

### Soft

- typecheck.
- unit/contract tests.
- builds.
- lint/static architecture.
- schema validation.
- fast deterministic integration subset.

### Hard

- API hard-smoke.
- Admin E2E.
- POS integration/startup.
- sync/offline journeys.
- migration clean/populated.
- performance/load/degraded scenarios.

Soft failure يمنعHard. Hard required حسبimpact matrix.

## 5. Test Naming

- `*.spec.ts`: unit/module behavior.
- `*.contract.test.ts`: stable public contract.
- `*.integration.test.ts`: DB/provider/process boundary.
- `*.e2e.test.ts`: end-to-end journey.
- `*.smoke.*`: minimal release-critical flow.
- names describecondition andexpected outcome.

## 6. Test Structure

Use Arrange/Act/Assert أوGiven/When/Then بوضوح.

- one behavior focus pertest.
- explicit fixtures.
- assert outcome andpersisted effects.
- verify absence ofduplicate/forbidden side effects.
- no arbitrary sleeps; useevents/poll-with-timeout/fake clock.

## 7. Determinism

- fixed/fake clock.
- deterministic IDs/seeds.
- explicit timezone/locale.
- isolated DB/schema/database perrun.
- mock randomness onlythroughport.
- no dependence onnetwork/public APIs.
- test retries لا تخفيfailure.

## 8. Shared Test Package

`@athr/testing` may own:

- deterministic clock/ID builders.
- domain fixture builders.
- contract assertions.
- DB harness setup/cleanup.
- API client helpers.
- dataset profile metadata.

It must not:

- importproduction secrets.
- bypassauthorization globally.
- hide tenant context.
- beused inruntime dependencies.

## 9. Domain Tests

لكلAggregate/Value Object:

- valid creation.
- invalid state rejection.
- state transitions.
- version/concurrency rules.
- emitted events.
- immutable history/snapshots.
- numeric/time edge cases.

No framework/DB required.

## 10. Application Tests

- handler authorization/tenant preconditions.
- command/query orchestration.
- idempotency andexpectedVersion.
- port interactions.
- no external call insidetransaction whereapplicable.
- failure mapping andcompensation request.

Use fakes atports، notmock everyprivate method.

## 11. Repository and Database Integration Tests

- run againstreal PostgreSQL version compatible withproduction.
- prove tenant scoping andsame-tenant FKs.
- unique/idempotency constraints.
- transaction rollback.
- append-only ledger behavior.
- query pagination/order.
- lock/concurrency behavior forcritical paths.
- no reliance onPrisma mocks forDB invariants.

## 12. Migration Tests

Everymigration change requires:

1. policy check: applied migrations untouched.
2. clean database deploy.
3. repeat deploy idempotence/status.
4. populated upgrade fromapproved baseline.
5. schema drift check.
6. data invariant validation.
7. lock/duration review forrisk.
8. forward-fix/recovery notes.

No remote production mutation inPR tests.

## 13. API Contract Tests

- response envelope/status/error code.
- validation failures.
- auth/permission/scope.
- tenant isolation.
- pagination/cursor.
- idempotency.
- outcome certainty andretry mode.
- backward compatibility forsupported clients.

## 14. Event and Outbox Tests

- domain mutation + outbox atomicity.
- event schema/version.
- privacy filtering.
- consumer inbox/dedupe.
- duplicate delivery.
- out-of-order handling wherecontract permits.
- retry/dead-letter.
- projection rebuild.

## 15. Sync and Offline Tests

Must cover:

- bootstrap manifest/chunks.
- incremental pull cursor.
- push batches andper-operation outcomes.
- duplicate upload/replay.
- conflict andresync.
- offline lease expiry/revocation.
- crash before/after local durable commit.
- reconnect storm/backpressure.
- incompatible protocol/local schema.
- tenant/device reassignment safety.

## 16. POS Tests

### Main

- config validation.
- secure state.
- local DB migration.
- API/auth/enrollment.
- sync queue.
- printing/updater diagnostics.

### Preload

- exact typed IPC surface.
- reject malformed payloads.
- noextra privileged method.

### Renderer

- user workflows anderror states.
- offline/online transitions.
- noNode dependency.
- large catalog/render behavior.

### Installer/Upgrade

- legacy data migration.
- preserve pending operations.
- version/update manifest compatibility.

## 17. Admin Tests

- authentication/session behavior.
- tenant-aware navigation.
- permission-driven UI withoutassuming authority.
- lists/search/pagination.
- forms/validation/error UX.
- export/job status.
- terminal health views.
- server/client environment separation.
- production build.

## 18. Security Tests

- cross-tenant access attempts.
- IDOR/resource-path manipulation.
- revoked/suspended identity/membership/device.
- CSRF/CORS/session cookie rules.
- rate limits andbrute force controls.
- webhook signature/replay.
- secret/PII redaction.
- POS IPC privilege boundaries.
- dependency/secret scanning.

## 19. Financial and Inventory Integrity Tests

- exact decimals/rounding.
- sale/return/refund allocation.
- payment OutcomeUnknown.
- duplicate payment/webhook.
- inventory single writer.
- negative stock policy.
- reservations nonnegative/bounded.
- cost movement deficit/recovery.
- ledger reconciliation.
- cash drawer expected/actual discrepancy.

## 20. Tenant Isolation Test Matrix

For everytenant-owned module:

- create inTenant A.
- read/update/delete attempt fromTenant B.
- guessed ID.
- valid membership wrongscope.
- background job wrongtenant context.
- cache key separation.
- export/report separation.
- sync cursor/device separation.

Cross-tenant success isCritical blocker.

## 21. Concurrency Tests

Critical operations test:

- duplicate command simultaneous.
- optimistic version conflict.
- sale/post/payment race.
- transfer receive duplicate.
- shift close vsnew cash movement.
- worker duplicate claim.
- migration runner single ownership.

Use database constraints/transactions، notonlyin-memory mocks.

## 22. Provider Tests

- fake/sandbox provider adapters.
- success, decline, timeout, malformed response.
- callback before/afterrequest response.
- duplicate callback.
- unknown outcome andlater reconciliation.
- credential/config failure.

No liveProduction provider calls inCI.

## 23. Performance Tests

Follow ATHR Performance Strategy:

- environment fingerprint.
- representative dataset.
- warm-up/sample size.
- p50/p95/p99/error rate/saturation.
- separate Windows local andLinux CI baselines.
- regression thresholds andabsolute ceilings.
- startup, POS local actions, sync, API, DB, worker, reports.

## 24. Failure Injection

Inject bounded failures:

- DB timeout/connection pressure.
- provider timeout.
- worker crash afterclaim.
- process crash afterlocal POS commit.
- partial network/reconnect.
- stale cursor/version.
- disk/write failure inlocal POS test harness.

Assert correctness andrecovery، notjusterror display.

## 25. Coverage Policy

Coverage isdiagnostic, notsole gate.

- critical domain modules requirehigh branch/invariant coverage.
- changed code coverage cannotdrop materially withoutreason.
- generated files/config excluded explicitly.
- 100% line coverage doesnotreplacecontract/integration tests.
- untested critical branch blocksmerge.

Exact percentages established afterbaseline; no arbitrary target masksweak tests.

## 26. Flaky Test Policy

A flaky test:

- remainsfailure untiltriaged.
- may quarantine onlywithissue, owner, reason, expiry.
- cannotbeexcluded fromrelease-critical path indefinitely.
- retries recorded anddo notturnred into green silently.
- root cause fixed, thenquarantine removed.

## 27. Test Data Management

- synthetic deterministic data.
- noProduction dump bydefault.
- sensitive fixtures prohibited.
- seed version tracked.
- realistic skew/hot records/history.
- cleanup reliable andscoped.
- destructive seed guards forremote DB.

## 28. Environment Matrix

- Linux CI: canonical automated baseline.
- Windows: POS installer/runtime-specific gates.
- local developer: convenience only, notsole evidence.
- Preview/Staging: integration withdeployed config.
- Production: smoke/readiness onlyafterapproved release; no destructive tests.

## 29. PR Impact Matrix

### Shared package/contract change

All consumers typecheck/test/build.

### Backend domain/API change

Backend soft + integration + Admin/POS contract impact + hard-smoke.

### Migration change

Full migration gate + affected runtime tests.

### Admin change

Admin tests/build/E2E; Backend contracts ifchanged.

### POS change

POS tests/build + Windows installer + protocol tests.

### Sync/offline/security/payment/inventory

Mandatory hard-smoke andspecialized integrity suites.

## 30. CI Order

1. install fromclean root lockfile.
2. workspace/dependency/static checks.
3. shared packages build/test.
4. Backend/Admin/POS soft gates.
5. migration gate ifaffected.
6. integration/E2E.
7. hard-smoke.
8. security/audit.
9. release gate/artifacts.

Fail fast onstructural issues، butretain useful logs/artifacts.

## 31. Test Evidence

Delivery Log records:

- branch/base/head SHA.
- exactcommands.
- suite/test counts.
- environment/database profile.
- migrations andstatus.
- skipped/quarantined tests.
- CI run/artifact links.
- deployment/preview verification.
- deviations andrisks.

## 32. Release Gate

Release blocked when:

- requiredsuite fails/skips.
- migration history/drift unresolved.
- tenant/security test fails.
- duplicate/ledger/reconciliation invariant fails.
- critical journey hard-smoke fails.
- artifact notbuilt fromtested SHA.
- required evidence missing.

## 33. Production Smoke

After deployment onlysafe checks:

- liveness/readiness/version.
- auth/session basic.
- scoped read usingdemo/synthetic tenant whereapproved.
- queue/worker/DB health.
- migration status evidence.
- Admin connectivity.

No destructive sale/payment/stock mutation unlessdedicated demo tenant andexplicit runbook.

## 34. Local Commands Contract

Root provides stable commands:

- `npm run test:soft`
- `npm run test:hard:smoke`
- `npm run test:all`
- package-specific focused tests.
- migration clean/populated scripts.

Commands work fromclean checkout andBash shell.

## 35. Ownership

- module owner ownsunit/contract/integration tests.
- platform/release owner ownsCI harness andhard-smoke orchestration.
- security ownssecurity test policy.
- database owner owns migration/recovery harness.
- failing test hasnamed owner throughaffected module/WP.

## 36. WP-002 Acceptance Mapping

WP-002 testing portion requires:

- shared `@athr/testing` package.
- deterministic builders/contracts.
- root orchestration.
- package tests fromclean install.
- dependency/cycle tests.
- Backend/Admin/POS existing gates preserved.
- one authoritative lockfile.
- no runtime import fromtesting package.

## 37. First-Paid-Customer Gate

Before first paid customer:

- tenant isolation suite complete.
- financial/inventory reconciliation suites pass.
- D2 load/migration rehearsal.
- POS offline crash/recovery andupgrade tests.
- restore rehearsal evidence.
- security critical paths.
- staging release rehearsal.
- no critical flaky/quarantined test.

## 38. Open Decisions

- exact coverage thresholds afterbaseline.
- exact browser E2E tool consolidation.
- exact dependency graph checker.
- scheduled full load/soak cadence.
- provider sandbox availability.
- Windows installer test depth inPR vsnightly.

## 39. Prohibited Patterns

- tests depending onorder.
- arbitrary sleeps.
- Production DB inCI.
- mocks forDB invariants only.
- snapshot tests replacingbehavior assertions.
- retry-until-green.
- hidden skipped tests.
- shared tenant/data acrossparallel runs.
- direct mutation ofmigration history.
- claimingrelease success withouttested SHA evidence.

## 40. Approval Outcome

هذه الوثيقة هيعقد الاختبار لكلWork Package وRelease. نجاحالكود لايُقبل بدونevidence مناسبة لمخاطره وحدوده.