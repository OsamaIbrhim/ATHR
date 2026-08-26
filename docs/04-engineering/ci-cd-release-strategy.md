# ATHR CI/CD and Release Strategy v1.0

**Status:** Approved engineering-design baseline

**Applies to:** GitHub Actions, Railway Backend, Vercel Admin, Windows POS packaging, Supabase migrations, artifacts, environments andproduction releases.

## 1. Purpose

تحدد هذهالوثيقة pipeline منcommit إلىartifact ثمdeployment، معضمان أنمايصلللProduction هو نفسSHA الذي اجتاز الاختبارات.

## 2. Core Principles

1. build once, promote verified evidence wherepossible.
2. release fromimmutable tested SHA.
3. CI isolated fromproduction data.
4. migration runner واحد فقط.
5. failing gate blocksrelease.
6. deployment config versioned andreviewed.
7. production change observable andrecoverable.
8. no secrets inlogs/artifacts.

## 3. Environment Model

- Local: developer convenience only.
- CI: isolated ephemeral services/databases.
- Preview: PR-scoped Admin andoptional Backend preview.
- Staging: production-like integration environment beforecustomer release.
- Production: controlled promotion.

Each environment hasseparate credentials anddatabase boundaries.

## 4. Pipeline Stages

```
Checkout
→ Clean Install
→ Static/Workspace Gates
→ Shared Packages
→ App Soft Gates
→ Migration Gates
→ Integration/E2E
→ Hard Smoke/Security
→ Artifact Build
→ Release Gate
→ Deploy
→ Post-Deploy Verification
```

## 5. Clean Install

- root lockfile authoritative.
- `npm ci` fromclean checkout.
- exactNode/npm policy.
- no global tool dependency.
- cache keyed bylockfile/runtime.
- cache miss muststill succeed.

## 6. Static and Architecture Gates

- formatting/lint.
- typecheck.
- workspace graph.
- no cycles.
- noforbidden imports/dependencies.
- no `bold-*` afterWP-002.
- secret scanning.
- dependency audit.

## 7. Shared Package Gates

For each internal package:

- build.
- declaration generation.
- public export validation.
- contract tests.
- browser/node boundary validation.
- no runtime import fromtesting package.

## 8. Application Soft Gates

### Backend

- Prisma validate/generate.
- unit/contract/performance contracts.
- typecheck/build.

### Admin

- tests/typecheck/build.
- server/client env boundary.

### POS

- tests/typecheck/build.
- main/preload/renderer boundaries.

## 9. Migration Gate

For migration-impact PRs:

- immutable-history policy.
- clean database deploy.
- repeat deploy/status.
- populated upgrade.
- drift check.
- data invariant assertions.
- migration duration/lock review.

CI usesisolated PostgreSQL, neverProduction Supabase.

## 10. Integration and E2E

- Backend + PostgreSQL integration.
- Admin E2E againstsame-run Backend.
- POS integration/local state tests.
- Sync/offline protocol journeys.
- provider sandbox/fakes.

## 11. Hard Smoke

Required forcritical paths:

- authentication.
- products/catalog read.
- shift open/current context.
- sale posting/idempotency.
- inventory ledger.
- purchasing/transfer accounting.
- sync pull/push.
- health/readiness.

## 12. Security Gates

- dependency/secret scan.
- auth/tenant isolation suites.
- IDOR/resource path tests.
- webhook replay/signature whereaffected.
- POS IPC privilege checks.
- high-severity audit policy.

## 13. Performance Gates

- fast contract thresholds onPRs.
- hard-smoke performance oncritical changes.
- scheduled full load/soak.
- environment fingerprint.
- p50/p95/p99/error-rate evidence.
- regression andabsolute ceilings.

## 14. Artifact Strategy

Artifacts include:

- Backend container/image digest whereused.
- Admin build/deployment record.
- POS installer.
- update manifest.
- SBOM/checksums whereintroduced.
- test reports/logs.

Everyartifact records:

- commit SHA.
- version.
- build timestamp.
- protocol compatibility.

## 15. Backend Deployment — Railway

- source branch/commit explicit.
- root `/backend` untilworkspace deployment config updated.
- config file versioned.
- one pre-deploy migration runner.
- application start command doesnotrunmigrations.
- health/readiness required.
- old deployment remains untilnew onehealthy whereplatform supports.

## 16. Migration Runner Policy

- exactly oneowner/service.
- uses`DIRECT_URL` whenavailable.
- advisory locking remains enabled.
- logs migration count/status withoutsecrets.
- `status → deploy → status` forcontrolled runner.
- bounded retry onlyforverified transient lock contention.
- no parallel local/manual migration duringdeployment.
- no`migrate reset` inproduction.

## 17. Admin Deployment — Vercel

- PR preview required.
- production promotion fromapproved SHA.
- `ATHR_API_INTERNAL_BASE` validated.
- browser-exposed env explicitly public.
- noBackend/POS secrets inbundle.
- post-deploy API connectivity check.

## 18. POS Release

- Windows installer built fromtested SHA.
- version bump deliberate.
- immutable tag `athr-pos-vX.Y.Z`.
- installer andmanifest checksums.
- update manifest points toimmutable artifact.
- legacy data migration andupgrade tests.
- norelease publication fromPR branch withoutapproval.

## 19. Release Types

- Patch: compatible fix.
- Minor: backward-compatible feature.
- Major: breaking contract/protocol/customer migration.
- Hotfix: urgent production correction.

Release type chosen fromactual compatibility impact.

## 20. Release Candidate

Formaterial releases:

- createRC artifact/tag.
- staging rehearsal.
- migration rehearsal.
- restore/readiness verification.
- no newscope duringstabilization exceptblockers.

## 21. Approval Gates

Production release requires:

- greenrequired checks.
- review approval.
- migration risk accepted.
- config/secrets ready.
- release notes.
- rollback/forward-fix plan.
- exact SHA confirmation.

## 22. Deployment Order

Default coordinated order:

1. backward-compatible DB expansion.
2. Backend supportingold/new clients.
3. Admin.
4. POS release/update window.
5. backfill/monitor.
6. constraints/contract cleanup inlaterrelease.

## 23. Post-Deploy Verification

- deployed SHA/version.
- liveness/readiness.
- DB migration status.
- auth/session basic.
- Admin connectivity.
- queue/worker status.
- error/latency baseline.
- POS compatibility endpoint/manifest whenreleased.

## 24. Rollback and Forward Fix

- code rollback onlyifDB compatible.
- applied migrations neverdeleted/edited.
- data correction viaforward migration/script withaudit.
- unknown provider/payment outcomes reconciled, notblindly retried.
- rollback decision owner declared.

## 25. Failure Handling

Ifpre-deploy fails:

- newversion doesnotstart.
- current healthy version remains whenpossible.
- capturefirst DB error andtimestamp.
- do notrepeat `resolve` blindly.

Ifhealth fails:

- stop promotion/rollback accordingtoplatform.
- preserve logs/artifacts.

## 26. Concurrency Protection

- environment concurrency group.
- oneproduction deployment atatime.
- cancel superseded preview runs, notactiveproduction migration.
- migration runner protected fromparallel triggers.

## 27. Configuration Management

- env schema validated.
- secrets stored inplatform secret manager.
- noquoted/whitespace-corrupted values.
- rotate leaked credentials immediately.
- config changes recorded withrelease.
- nohard-coded production URL.

## 28. Observability Requirements

Deployment emits/records:

- release SHA/version.
- migration status/duration.
- readiness time.
- error rate andlatency.
- worker/queue health.
- alert links/runbook.

## 29. Release Notes

Include:

- user-visible changes.
- operational/config changes.
- migrations.
- compatibility window.
- knownrisks.
- verification steps.
- rollback limitations.

## 30. Scheduled Pipelines

- nightly/regular full load.
- dependency/security updates.
- backup/restore rehearsal cadence.
- drift/config checks.
- POS installer validation.
- stale branch/artifact cleanup.

## 31. Manual Actions

Manual production action requires:

- named operator.
- ticket/incident/release reference.
- exactcommand.
- target environment verification.
- outcome evidence.
- no secrets inrecord.

## 32. Delivery Log Evidence

Record:

- branch/base/head.
- CI run IDs.
- suite counts.
- artifact IDs/checksums.
- migration status.
- deployed SHA/URLs.
- post-deploy result.
- deviations/blockers.

## 33. WP-002 Mapping

WP-002 must updateCI/CD for:

- root workspace install.
- shared package build/test.
- one lockfile.
- graph/cycle checks.
- Backend/Admin/POS gates preserved.
- Railway/Vercel/POS build paths validated.

## 34. First-Paid-Customer Release Gate

Beforefirst paid customer:

- staging rehearsal.
- D2 data/load profile.
- migration andrestore rehearsal.
- tenant/security critical suites.
- POS offline upgrade/recovery.
- production runbooks/on-call readiness.
- nocritical flaky tests.

## 35. Prohibited Patterns

- deploy fromuntested SHA.
- production DB inCI.
- multiple migration runners.
- migration inapp startup/replicas.
- mutable release tags.
- manual artifact replacement.
- secret inlog/build output.
- successful deploy claim withoutpost-deploy evidence.

## 36. Acceptance Gate

- allrequired checks enforced.
- artifacts trace toSHA.
- migration runner single andsafe.
- Railway/Vercel/POS flows documented andtested.
- production concurrency controlled.
- post-deploy evidence captured.
- rollback/forward-fix path viable.

## 37. Approval Outcome

هذهالوثيقة هيالعقد المعتمد للـCI/CD والإصدارات والنشر فيATHR.