# ATHR Monitoring and Observability v1.0

**Planning Baseline — Logs, Metrics, Traces, SLOs, Alerts, Dashboards, Tenant Health and Incident Detection**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة كيفيرىفريقATHR حالةالنظام ويفهمالمشكلات، وتشمل:

- Structured logs.
- Metrics andservice indicators.
- Distributed traces/correlation.
- SLI/SLO/error budgets.
- Health/readiness/dependency status.
- Alerts androuting/escalation.
- Dashboards andrunbooks.
- Database/worker/sync/POS/provider visibility.
- Tenant-aware observability دونتسريببيانات.
- Security signals.
- Release/migration monitoring.
- Cost/cardinality/retention controls.
- Incident evidence andpost-incident learning.

Observability ليستتخزينكلشيء، وليستمجردLogs. الهدفأننتمكنمنالإجابة بسرعة: ماذاحدث؟ لمن؟ متى؟ لماذا؟ ماهوحجمالأثر؟ وماالإجراءالتالي؟

## 2. الحدود

### هذهالوثيقة تملك

- Telemetry contracts.
- SLI/SLO definitions.
- Alert conditions andownership.
- Dashboard/runbook requirements.
- Observability data safety.

### لا تملك

- Business source oftruth.
- Audit legal history.
- Backup/restore execution.
- Provider/tool selection النهائي قبلقياسالحاجة.

## 3. المبادئ غيرالقابلة للتفاوض

1. Logs لا تستبدلAudit records.
2. Metrics لا تستبدلBusiness ledgers.
3. Health endpoint لا تكشفسرًا.
4. كلrequest/job/event لهاcorrelation identity.
5. Tenant context موجودةفيTelemetry بصورةآمنة.
6. لاPII أوSecrets أوTokens فيLogs/traces.
7. High-cardinality labels محدودةومراقبة.
8. Alerts تكونقابلةللتصرف، لاNoise.
9. كلAlert حرجة لهاOwner وRunbook وEscalation.
10. Dashboard بلاSLO/قرار ليستControl كافية.
11. Client-reported success لا يثبتServer success.
12. Provider accepted لا يساويDelivered/Settled.
13. Outcome unknown حالةمرئيةومقاسة.
14. Queue lag أهممنعددjobs فقط.
15. Database saturation تقاسقبلنفادالاتصالات.
16. Release/migration versions تظهرمعكلTelemetry.
17. Demo observability أخف، لكننفسschema/hook design.
18. Monitoring provider لا يدخلDomain logic.
19. Telemetry failure لا يوقفمعاملةعادية، لكنAudit critical failure قديفعلوفقSecurity.
20. Security telemetry access مقيدةومدققة.
21. Sampling لا يسقطErrors/critical traces.
22. كلSLO يحددماذايدخل وماذايستبعد.
23. Maintenance windows لاتخفيحوادثغيرمرتبطة.
24. Multi-tenant fairness والمشكلات المعزولةظاهرة.
25. تكلفةالـtelemetry تقاسوتضبط.

# القسم الأول — Observability Model

## 4. Signals

- **Logs:** أحداثنصيةمهيكلة للتشخيص.
- **Metrics:** قياساتزمنيةمجمعة.
- **Traces:** مسارطلب/عملية عبرالمكونات.
- **Events:** Deployment/migration/incident markers.
- **Synthetic checks:** اختباراتخارجية دورية.
- **Business control signals:** فروقاتLedger/Reconciliation، وليستmetrics تخمينية.

## 5. Golden Signals

لكلخدمة:

- Latency.
- Traffic/throughput.
- Errors/outcome certainty.
- Saturation/capacity.

لـWorkers/Queues:

- Backlog.
- Oldest item age.
- Processing latency.
- Retry/dead-letter rate.

## 6. Telemetry Context

حقول مشتركة:

```
timestamp
service/component/environment
release_version/commit_sha
request_id/correlation_id/causation_id
trace_id/span_id
tenant_id_or_safe_label
membership/service/device/terminal IDs where permitted
operation/route/job/event type
resource type/id masked where needed
outcome/error_code/outcome_certainty
latency/duration
schema/protocol/policy versions
```

## 7. Tenant Labels

- داخليًايمكنTenant UUID/opaque ID فيLogs المقيدة.
- Metrics عاليةالحجم لا تستخدمTenant ID كlabel افتراضيًا.
- PerTenant analysis عبرlogs/traces أوbounded top-N/hashed dimensions.
- Tenant-facing dashboards تعرضTenant نفسهافقط.

# القسم الثاني — Structured Logging

## 8. Log Format

JSON structured logs، لاتعتمدfree-form strings فقط.

أدنىحقول:

- timestamp/level/message_key.
- service/environment/version.
- request/correlation.
- actor/channel.
- tenant scope.
- operation/outcome/error.
- duration.

## 9. Log Levels

- `DEBUG`: Local/temporary diagnostics، disabled/restricted inProduction.
- `INFO`: lifecycle/business-operation summary بدونPII.
- `WARN`: degraded/retryable/unusual condition.
- `ERROR`: failed operation requiringattention.
- `FATAL`: process cannotcontinue safely.

لا تستخدمERROR للـexpected validation denials العادية.

## 10. Redaction

ممنوعفيLogs:

- Passwords.
- Access/refresh/reset tokens.
- MFA secrets/recovery codes.
- Private keys/provider secrets.
- Full payment/bank credentials.
- Raw webhook sensitive payload.
- Fullcustomer PII بلاسبب.
- Database URLs.

Redaction centrally tested.

## 11. Error Logging

- Public error code.
- Internal safe cause category.
- Stack trace داخليًا للunexpected errors فقط.
- Request ID.
- Retry/outcome certainty.
- Provider reference masked.
- No duplicate logging atmultiplelayers withoutvalue.

## 12. Audit vs Log

- Audit append-only accountability.
- Log operational andretention-limited.
- High-risk action mayproduceboth، معsharedcorrelation ID.
- Log rotation لا يفقدAudit truth.

# القسم الثالث — Tracing and Correlation

## 13. Request Correlation

Client قديرسلcorrelation hint، لكنServer يولد/يتحققRequest ID.

المسار:

```
Admin/POS
→ API
→ DB transaction/outbox
→ Worker/job
→ Provider
→ Webhook/reconciliation
```

## 14. Trace Boundaries

Spans لــ:

- HTTP request.
- Authentication/authorization decision summary.
- Application command/query.
- Database query/transaction.
- Outbox/job processing.
- External provider call.
- Sync batch/snapshot.
- Document render/export.

## 15. Sensitive Attributes

- SQL text/parameters لا تسجلraw افتراضيًا.
- Request/response bodies لا تسجلإلاallow-listed/sanitized diagnostic mode.
- IDs/PII masked/classified.

## 16. Sampling

- 100% Errors وcritical/security flows.
- Tail/conditional sampling preferred asscale grows.
- Lower sample forhigh-volume successful reads.
- Sampling decision propagated.
- Demo mayretainmore temporarily withstrictredaction.

# القسم الرابع — Service Health

## 17. Liveness

يثبتprocess running.

- No deep provider calls.
- Fast/cheap.
- Failure triggersrestart.
- لا يكشفconfig.

## 18. Readiness

يثبتقدرةالخدمةعلىاستقبالtraffic:

API:

- Config valid.
- DB reachable/compatible.
- keys loaded.
- required internal components ready.

Worker:

- DB/job store.
- config/keys.
- compatible schema.

## 19. Dependency Health

داخلي/مقيد:

- PostgreSQL.
- Object storage.
- Email/payment providers.
- Job queue/outbox.
- Signing/key services.
- GitHub update channel status ifmonitored.

Third-party outage لا يفشلLiveness تلقائيًا.

## 20. Synthetic Checks

- Admin login page load.
- API health/readiness.
- Safe authenticated read.
- Demo/Production isolated critical flow whereappropriate.
- POS update manifest availability.
- Email provider test onlyincontrolled cadence.

No financial mutation synthetic inProduction withoutdedicatedsandbox flow.

# القسم الخامس — Service Level Indicators

## 21. API Availability SLI

نسبةالطلباتالمؤهلة التيأعادتنتيجةصالحة خلالالوقتالمستهدف.

يستبعدبوضوح:

- Client validation errors.
- Unauthorized expected denials.
- Planned maintenance ifapproved.

يشملunexpected 5xx/timeouts/dependency failures.

## 22. API Latency SLI

- p50/p95/p99 byroute class.
- Separate reads, commands, sync, reports.
- Server duration andend-to-end client duration whenavailable.

## 23. Correctness SLI

لا يكفيHTTP 200.

إشارات:

- Ledger reconciliation success.
- No duplicate idempotent effects.
- Sync operation acceptance/conflict correctness.
- Document/control total consistency.
- Outcome unknown aging.

## 24. Sync SLI

- Pull/push success.
- Oldest pending operation age.
- Cursor lag/change lag.
- Snapshot/bootstrap duration.
- Conflict/manual review rate.
- Terminals beyondlast-sync threshold.

## 25. Worker SLI

- Oldest ready job age.
- Time-to-start/process.
- Success/retry/dead-letter.
- Projection freshness.
- Provider reconciliation lag.

## 26. Database SLI

- Connection utilization/wait.
- Query latency.
- Lock waits/deadlocks.
- Transaction duration.
- CPU/memory/storage/IO provider signals.
- Replication/PITR/backup health whereavailable.

## 27. POS SLI

- Client version adoption.
- Crash/startup failure.
- Enrollment/auth failures.
- Sync success/lag.
- Pending queue depth/age.
- Offline duration/lease expiry.
- Print/update success.

## 28. Business Continuity SLI

- Completed sales successfullypersisted/synced.
- Payment outcome unknown count/age.
- Refund/reconciliation backlog.
- Inventory/cost projection mismatch.
- Cash shifts awaitingfinalization.

# القسم السادس — SLO and Error Budgets

## 29. SLO Principles

- User journey based، لاinfrastructure only.
- SeparateDemo target fromProduction SLO.
- Exactnumbers approved beforefirstpaid launch.
- Rolling windows andmeasurement source specified.
- Each SLO hasowner andbreach action.

## 30. Initial SLO Families

- Core API availability.
- Core command latency.
- POS sync freshness.
- Worker/notification/report freshness.
- Recovery backup success andrestore rehearsal.
- Payment/reconciliation outcome resolution.

## 31. Error Budget

When consumed quickly:

- Pause risky feature rollout.
- Prioritize reliability fixes.
- Reducechanges/concurrency.
- Review capacity/provider.
- No automatic blame ofone service withouttrace evidence.

## 32. SLO Exclusions

Explicit only:

- Approved maintenance.
- Customer-controlled offline beyondlease/policy.
- Unsupported client versions afterenforcement.
- External provider outage onlyifjourney contract explicitlydefinesdegraded expectation; otherwiseitmaystillcount.

# القسم السابع — Metrics Catalog

## 33. API Metrics

- requests_total.
- request_duration.
- responses_by_status/error_code.
- active_requests.
- rate_limit decisions.
- auth/session/MFA outcomes aggregated safely.
- idempotency replay/conflicts.

## 34. Database Metrics

- pool active/idle/waiting/max.
- connect/acquire duration.
- query duration byoperation fingerprint.
- slow queries.
- transaction duration/rollback.
- lock waits/deadlocks.
- migration status/duration.

## 35. Job/Outbox Metrics

- ready/in-progress/retry/dead-letter counts.
- oldest age.
- processing duration.
- claim conflicts/lease expiry.
- perjobtype/priority.
- outbox publish lag.

## 36. Sync Metrics

- bootstrap/snapshot requests.
- snapshot bytes/chunks/duration.
- pull changes/lag.
- push operations/results.
- duplicate/conflict/rejected/manualreview.
- terminal last-sync andoffline duration.

## 37. Billing/Payment Metrics

- collection attempts bynormalized outcome.
- outcome unknown age.
- webhook lag/failures.
- reconciliation mismatches.
- invoice generation lag.

لا تعرضcard/provider secrets.

## 38. Notification Metrics

- requests/attempts byintent/channel.
- accepted/delivered/bounced/unknown.
- retry/dead-letter.
- oldest critical notification age.
- suppression/consent outcomes aggregated.

## 39. Reporting Metrics

- projection watermark/freshness.
- report duration/rows/bytes.
- export queue age/failures.
- rebuild progress.
- control-total mismatches.

## 40. Storage Metrics

- upload/download/render errors.
- referenced missing objects.
- storage growth byclassification aggregated.
- signed-link failures.
- malware/processing queue whereimplemented.

## 41. Security Metrics

- failed login/MFA/reset trends.
- refresh reuse.
- cross-tenant mismatch attempts.
- device signature/replay failures.
- support/break-glass usage.
- secret/dependency scan findings.
- webhook signature failures.

Security details restricted andrate-limited.

# القسم الثامن — Dashboards

## 42. Executive Platform Health

- Availability/SLO status.
- Active incidents.
- Core transaction/sync health.
- Queue/database saturation.
- Release/version.
- Backup status/rehearsal age.

## 43. API Dashboard

- Traffic/latency/errors.
- Top failingroutes/error codes.
- Instance/readiness/restarts.
- Auth/rate limits.
- DB pool correlation.

## 44. Database Dashboard

- Connections.
- Slow queries/locks/deadlocks.
- Transactions.
- Storage growth.
- Migration markers.
- Backup/PITR provider signals whenavailable.

## 45. Worker Dashboard

- Queue/backlog/oldest age.
- Processing success/retry/deadletter.
- Consumer versions.
- Provider latency/errors.

## 46. POS and Sync Dashboard

- Active terminals.
- Online/offline/degraded.
- Last sync.
- Queue depth/age.
- Client versions.
- Conflicts andlease expiry.
- Update adoption.

## 47. Tenant Health View

Scoped support/tenant operators:

- Tenant API/sync/job health.
- Terminal statuses.
- Last successful critical operations.
- Entitlement/limit warnings.
- No cross-tenant data.

## 48. Security Dashboard

Restricted:

- Authentication anomalies.
- cross-tenant denials.
- support grants.
- device integrity.
- secret/scanner findings.
- high-risk audit failures.

## 49. Release Dashboard

- Environment/release/commit.
- Migration version/outcome.
- Deployment health.
- Error/latency change frombaseline.
- POS channel versions/adoption.
- Rollback/forward-fix markers.

# القسم التاسع — Alerting

## 50. Alert Quality

Alert يجبأن تحتوي:

- What failed.
- Environment/service/tenant scope ifsafe.
- Severity.
- Current value/threshold/window.
- User/business impact.
- Dashboard/runbook links.
- Correlation/release context.
- Owner/escalation.

## 51. Severity

- **SEV-1:** Widespread/cross-tenant/security/financial integrity orcore outage.
- **SEV-2:** Significant degraded service ormultiple tenants.
- **SEV-3:** Limited tenant/component issue requiringbusiness-hours action.
- **SEV-4:** Warning/capacity/trend.

## 52. Paging vs Ticketing

Page onlywhenimmediatehuman action changesoutcome.

Ticket/async for:

- Slow capacity trend.
- Low-rate retryable failures.
- Noncritical report failures.
- Knownprovider transient underbudget.

## 53. Alert Conditions

Prefer:

- Sustained threshold.
- Rate/ratio.
- Burn-rate forSLO.
- Oldest age.
- Multi-signal correlation.

Avoidsingle noisy spike unlesssecurity/critical.

## 54. Core Alerts

- API readiness/availability SLO burn.
- Database pool saturation/connectivity.
- Migration failed/drift/schema incompatibility.
- Job/outbox oldest age.
- Sync lag/terminals offline beyondpolicy.
- Payment/refund outcome unknown aging.
- Inventory/cost/control mismatch.
- Audit writer failure.
- Backup failure/rehearsal overdue.
- Cross-tenant/security anomaly.
- POS badrelease/crash spike.

## 55. Provider Alerts

- Webhook signature failures/replay.
- Provider outage/error/latency.
- Email bounce/complaint anomaly.
- Storage missing objects.
- GitHub update artifact unavailable/signature issue.

## 56. Deduplication andGrouping

- Group byincident cause/service/release/tenant scope.
- Suppresschild alerts whenparent known.
- Maintenance silences scoped/expiring/audited.
- No global indefinite mute.

## 57. Escalation

- Primary owner/on-call.
- Secondary/escalation.
- Security/DB/domain specialist.
- Incident commander forSEV-1/2.
- Business/customer communications owner.

# القسم العاشر — Runbooks

## 58. Required Runbook Structure

- Symptom/alert.
- Impact andseverity.
- Immediate safety checks.
- Dashboards/queries.
- Containment.
- Recovery steps.
- Verification.
- Escalation.
- Evidence tocollect.
- Unsafe actions/prohibited shortcuts.

## 59. Initial Runbooks

- API unavailable/high 5xx.
- Database pool saturated.
- Slow/deadlocked migration.
- Queue/outbox lag.
- Sync conflict spike.
- Terminal offline fleet.
- Payment outcome unknown.
- Inventory reconciliation mismatch.
- Audit writer failure.
- Backup/restore failure.
- Cross-tenant incident.
- BadPOS release.
- Provider/webhook outage.

# القسم الحادي عشر — Database Observability

## 60. Query Instrumentation

- Operation/fingerprint، notraw sensitive SQL.
- Duration/rows/result.
- Tenant/service context safe.
- Slow threshold byquery class.
- Explain plans collectedmanually/controlled، notfor everyrequest.

## 61. Pool Monitoring

- Max/active/idle/waiting.
- Acquire timeout.
- Perinstance/service.
- Database connection budget.
- Alert beforehardlimit.

## 62. Locks and Transactions

- Long transactions.
- Idle intransaction.
- Blocking chains.
- Deadlocks.
- Migration locks.
- Repeated serialization retries.

## 63. Data Integrity Controls

Scheduled control checks:

- Inventory balance equalsmovement ledger.
- Payment allocations equalpayments/invoices.
- Refund ceilings.
- Cash shift totals.
- Outbox/domain event consistency.
- Cross-tenant FK/orphan checks.

Mismatch createsincident/reconciliation، لاauto-fix عمياء.

# القسم الثاني عشر — POS and Offline Observability

## 64. Terminal Heartbeat

يحملMinimal telemetry:

- terminal/device IDs.
- app/protocol/local schema version.
- online/offline state.
- last sync.
- queue depth/oldest age.
- lease expiry.
- last error code.
- disk/local integrity health summary.

لا يرسلPII أوtransaction bodies.

## 65. Offline Visibility

- Time offline.
- Lease remaining/expired.
- Pending sales/value/count aggregated.
- Failed signature/integrity.
- Clock drift.
- Snapshot freshness.

## 66. Crash and Startup

- Crash-safe report withoutsecrets.
- Startup/migration duration.
- Repeated crash loop.
- Auto-update result.
- Secure storage/local DB failure category.

## 67. Admin Terminal Monitoring

Tenant operators يرون:

- Online/offline/degraded.
- Last sync/heartbeat.
- Current version.
- Pending count/age.
- Open shift summary accordingpermission.
- Required action.

Platform seesaggregate/support-scoped details.

# القسم الثالث عشر — Security and Privacy

## 68. Access Control

- Observability dashboards/logs restricted byrole/purpose/environment.
- Tenant users seeownTenant only.
- Security logs narrower access.
- Raw logs export audited.
- Support grant required fortenant drill-down.

## 69. Retention

Different classes:

- High-volume traces short.
- Operational logs moderate.
- Security signals longer accordingpolicy.
- Metrics downsampled/aggregated.
- Audit separate retention.

Exactdurations cost/legal/security driven.

## 70. Data Residency andProviders

Telemetry provider/location assessedbeforeProduction. No unrestricted PII export toobservability service.

## 71. Debug Mode

- Time-bounded.
- Environment/service/tenant scoped.
- Approved forProduction.
- Redaction remains.
- Automatically expires.
- Audit config change.

# القسم الرابع عشر — Release and Migration Observability

## 72. Deployment Markers

Emit:

- environment/service.
- version/commit.
- start/end/outcome.
- actor/workflow.
- config schema.
- migration IDs.

## 73. Baseline Comparison

Afterrelease compare:

- Error rate.
- p95/p99 latency.
- DB/query/pool.
- Queue lag.
- Sync/conflicts.
- Client crashes.
- Business control mismatches.

## 74. Canary/Staged Rollout

Whenavailable:

- Newversion receiveslimited traffic/tenant set.
- Comparetooldbaseline.
- Automatic/controlled stop criteria.
- No schema contract untiladoption.

## 75. Migration Monitoring

- Start/end/current step.
- Rows processed/rate/checkpoint.
- Locks/waits/timeouts.
- Failed invariants.
- DB load.
- Backfill ETA foroperators only.

# القسم الخامس عشر — Cost and Cardinality

## 76. Cost Controls

- Logs sampled/filtered byvalue.
- Metrics label allow-list.
- Trace sampling.
- Retention tiers.
- Compression/downsampling.
- Budget alerts.

## 77. Cardinality Prohibitions

Do not useasmetric labels:

- request ID.
- resource ID.
- customer/email/phone.
- rawURL withIDs.
- error message text.
- unboundedtenant ID bydefault.

Use logs/traces fordrill-down.

## 78. Free Demo Baseline

- Structured stdout logs fromservices.
- Provider platform basic metrics/logs.
- PostgreSQL health queries.
- Internal health dashboard/API.
- Lightweight synthetic checks.
- No paidobservability dependency beforefirstcustomer.

Hooks/schema ready formigration toprovider later.

# القسم السادس عشر — Incident Management Integration

## 79. Incident Record

Contains:

- incident ID/severity/status.
- start/detect/ack/contain/recover/end.
- affected services/tenants/journeys.
- current commander/owners.
- timeline withdeployment/config markers.
- hypotheses/evidence.
- communication/recovery links.

## 80. Timeline

Auto-ingest:

- Alerts.
- Deployments/migrations.
- Support/break-glass actions.
- Provider status changes.
- Recovery operations.

Human decisions addedstructured.

## 81. Post-incident Metrics

- Time to detect.
- Time to acknowledge.
- Time to contain.
- Time to recover.
- Recurrence.
- Alert usefulness/noise.
- Runbook gaps.

# القسم السابع عشر — Error Contract

## 82. Telemetry Errors

- `OBSERVABILITY_EXPORT_FAILED`
- `OBSERVABILITY_PROVIDER_UNAVAILABLE`
- `OBSERVABILITY_PAYLOAD_REDACTED`
- `OBSERVABILITY_CARDINALITY_LIMITED`
- `OBSERVABILITY_TRACE_DROPPED`

## 83. Alert Errors

- `ALERT_DELIVERY_FAILED`
- `ALERT_ROUTE_UNASSIGNED`
- `ALERT_RUNBOOK_MISSING`
- `ALERT_SUPPRESSION_EXPIRED`
- `ALERT_ESCALATION_FAILED`

## 84. Health Errors

- `HEALTH_DEPENDENCY_DEGRADED`
- `READINESS_DATABASE_UNAVAILABLE`
- `READINESS_SCHEMA_INCOMPATIBLE`
- `READINESS_KEY_UNAVAILABLE`
- `SERVICE_SATURATED`

# القسم الثامن عشر — Testing Contract

## 85. Logging Tests

- Required context fields.
- Redaction ofsecrets/PII.
- Structurederror codes.
- No duplicate/noisy stack logs.
- Correlation propagation.

## 86. Metrics Tests

- Correct counters/histograms.
- Bounded labels.
- Outcome certainty dimensions.
- Queue oldest age.
- Tenant fairness withoutcardinality explosion.

## 87. Trace Tests

- API→DB→outbox→worker→provider.
- Errors alwayssampled.
- Sensitive payload omitted.
- Async correlation.

## 88. Alert Tests

- Threshold/window/burn-rate.
- Routing/escalation.
- Dedup/grouping.
- Maintenance expiry.
- Runbook links.
- No falsepage forvalidation traffic.

## 89. Dashboard Tests

- Data freshness.
- Environment/version markers.
- Tenant scope authorization.
- NoPII leakage.
- Drill-downworks.

## 90. Failure Drills

- API down.
- DB pool saturation.
- Queue backlog.
- Provider outage.
- Sync lag.
- Badrelease.
- Backup failure.
- Cross-tenant alert.
- POS crash/version spike.

## 91. SLO Tests

- Eligibleevent calculation.
- Exclusion correctness.
- Error budget/burn alerts.
- Historical replay againstfixtures.

# القسم التاسع عشر — First Paid Customer Gate

## 92. Required Before Activation

1. Production logs/metrics/traces paths working.
2. Core SLOs andowners approved.
3. Paging/notification route tested.
4. API/DB/worker/sync/POS dashboards.
5. Backup andrestore alerts.
6. Security/cross-tenant alerts.
7. Release/migration markers.
8. Synthetic checks.
9. Runbooks forcriticalalerts.
10. On-call/escalation ownership.
11. Retention/redaction/access controls.
12. Incident drill completed.

# القسم العشرون — Open Decisions

## 93. OD-OBS-001 — Observability Provider

**Baseline:** Provider-independent OpenTelemetry-compatible hooks/structured logs. Exactpaid/free platform selectedatimplementation/cost gate.

## 94. OD-OBS-002 — SLO Values

**Baseline:** Definitions now; exacttargets approvedbeforefirstpaid afterbaseline measurement.

## 95. OD-OBS-003 — Trace Sampling

**Baseline:** Allerrors/critical flows; adaptive sampling forsuccess traffic.

## 96. OD-OBS-004 — Tenant Metrics

**Baseline:** AvoidunboundedTenant labels; usecontrolledlogs/traces andaggregates.

## 97. OD-OBS-005 — Client Crash Provider

**Baseline:** Adapter/interface andredacted crash reports; exactprovider later.

## 98. OD-OBS-006 — On-call Tool

**Baseline:** Manual/simple routing beforefirstpaid onlyiftested; dedicatedtool whenoperationalneed/cost justified.

## 99. OD-OBS-007 — Retention

**Baseline:** Tiered andcost-aware; exactperiods afterlegal/security/provider choice.

# القسم الحادي والعشرون — Prohibited Patterns

## 100. أنماطممنوعة

- Secrets/tokens/passwords فيLogs.
- Full request/response body logging افتراضيًا.
- Metrics labels غيرمحدودة.
- اعتبارHTTP 200 دليلcorrectness.
- Alert لكلخطأمفرد متوقع.
- Paging بلاOwner/Runbook.
- Global indefinite alert mute.
- Liveness تعتمدexternal provider.
- Public detailedhealth endpoint.
- Observability provider داخلDomain logic.
- Tenant drill-down بلاSupport grant.
- Open/click telemetry كإثباتbusiness truth.
- Logs كبديلAudit أوBackup.
- Dashboard بلاfreshness/version.
- Release بلاdeployment markers.
- Sampling يسقطكلErrors.
- Demo كذريعةلعدموجودstructured telemetry.
- SLO targets غيرمقاسة كوعودتجارية.

# القسم الثاني والعشرون — Acceptance Gate

## 101. بوابةالاعتماد

لا تعتبرالوثيقة مكتملة قبل:

1. تثبيتsignals/context/model.
2. تثبيتlogging/redaction.
3. تثبيتtracing/correlation/sampling.
4. تثبيتhealth/readiness/synthetic checks.
5. تثبيتSLIs/SLO/error budgets.
6. تثبيتmetrics catalogs.
7. تثبيتdashboards.
8. تثبيتalerting/severity/routing.
9. تثبيتrunbooks.
10. تثبيتDB/POS/security/release observability.
11. تثبيتprivacy/retention/cost/cardinality.
12. تثبيتincident integration.
13. تثبيتtests/firstpaid gate/open decisions/prohibited patterns.

## 102. القرار التخطيطي الحالي

- Structured JSON logs +metrics +traces/correlation.
- OpenTelemetry-compatible/provider-independent instrumentation.
- No secrets/PII raw؛ redaction centrally tested.
- SLOs user-journey based، exacttargets afterbaseline measurement.
- Alerts تعتمدburn-rate/age/sustained signals، لاNoise spikes.
- PerTenant drill-down دونhigh-cardinality metric labels.
- DB pool/locks/jobs/sync/POS/outcome-unknown/control totals كلهاfirst-class signals.
- Demo تستخدمplatform basic logs +lightweight hooks بلاPaid dependency.
- لاPaid customer قبلdashboards/alerts/runbooks/on-call/incident drill.

## 103. المرحلة التالية

**ATHR Performance Strategy v1.0**

ستثبتworkloads, datasets, SLO thresholds, load profiles, query budgets, sync/POS performance, capacity tests andregression gates.

بعدها تبدأ **Engineering Design** بوثيقتين فيكلدورة حسبالسياسةالجديدة.