# ATHR Performance Strategy v1.0

**Status:** Approved planning baseline for implementation

**Applies to:** Backend, Admin, POS, PostgreSQL/Prisma, Sync/Offline, Workers, Reporting, CI/CD and deployment capacity.

## 1. Purpose

هذه الوثيقة تحدد الطريقة المعتمدة لقياس وتحسين ومنع تراجع أداء ATHR. الأداء هنا لا يعني سرعة endpoint منفرد فقط؛ بل يعني إكمال رحلة المستخدم الصحيحة بأمان، مع الحفاظ على سلامة القيود المالية والمخزنية، عزل المستأجرين، وضمانات idempotency وoffline recovery.

## 2. Scope

يشمل النطاق:

- API latency, throughput, error rate and saturation.
- PostgreSQL query, transaction, lock and connection-pool behavior.
- Admin rendering, navigation, list/search and export behavior.
- POS startup, login, scan, search, cart, checkout, printing and local persistence.
- Sync bootstrap, pull, push, conflict handling and reconnect storms.
- Workers, outbox/inbox, webhooks, notifications and report projections.
- Migrations, backfills and release-time operational load.
- Tenant fairness and noisy-neighbor protection.

## 3. Out of Scope

- تقديم Production SLA قبل قياس Staging/Production فعليًا.
- Microservices أوsharding كحل افتراضي للأداء.
- استخدامCache لإخفاء أخطاءالصحة أوالعزل أوالمحاسبة.
- بناءData warehouse مدفوع فيالمرحلة الحالية.
- مقارنة أرقام أجهزة أوشبكات مختلفة كأنهاBaseline واحدة.

## 4. Performance Principles

1. Correctness, security and tenant isolation precede speed.
2. نقيس `p50`, `p95`, `p99`, throughput, error rate and saturation؛ المتوسط وحده غير كافٍ.
3. كلBenchmark يسجل commit SHA، البيئة، نظام التشغيل، Node version، database/provider، dataset profile، concurrency، warm-up، ووقت التشغيل.
4. نفصل client/network time عن server time وعن database time.
5. لا تعتمد نتيجة علىempty أوtiny dataset فقط.
6. الاختبارات تشمل warm, cold, steady-state, spike, degraded and recovery scenarios.
7. الأداء يقاس علىuser journeys وعلىcritical mutations، وليسread endpoints فقط.
8. لايجوز تحسين السرعة بإضعاف validation أوidempotency أوaudit أوledger guarantees.
9. أي regression جوهري هوrelease blocker حتى لوكانت الاختبارات الوظيفية ناجحة.
10. Optimize measured bottlenecks before adding infrastructure.

## 5. Current Evidence Baseline

الأرقام الحالية ليستProduct SLO؛ هي evidence لفصل البيئات:

- Linux CI أظهر `/auth/me` وقراءات القوائم فينطاق عدةmilliseconds عندdataset صغير ومحلي.
- Windows local أظهر p95 يقارب 831–908ms لنفس الفئة، معقياسات `SELECT 1` متغيرة منمئاتmilliseconds إلىعدةثوانٍ، مايشير إلىnetwork/database path مختلف.
- لذلك لايجوز دمج Windows remote-database baseline معLinux isolated-CI baseline.
- Hard tests الحالية تستخدم error-rate threshold `0.005` وبعضread p95 ceiling؛ ستعادمعايرتها حسبservice class وdataset profile.

## 6. Service Classes

### P0 — Critical Interactive

- POS scan/search/cart/checkout acknowledgement.
- Shift open/close and payment acceptance.
- Authentication/session continuation.
- Sync operation upload acknowledgement.

### P1 — Normal Interactive

- Admin lists, search, details and operational dashboards.
- Customer, supplier, inventory and document navigation.

### P2 — Bulk and Export

- Large reports, CSV exports, projection rebuilds and reconciliation runs.
- يجب أنتتحول إلىasync job عندتجاوزحدودrequest lifecycle.

### P3 — Background

- Outbox dispatch, webhooks, notifications, report projections and maintenance.

### P4 — Maintenance

- Migrations, backfills, index operations, restore validation and data repair.

## 7. Critical User Journeys

### POS

- Application start → local database ready → configuration validated → login/enrollment ready.
- Barcode scan → product resolution → cart update.
- Search over a large local catalog.
- Checkout → local durable operation → receipt/acknowledgement.
- Offline sale → pending queue → reconnect → push → idempotent acknowledgement.
- Reprint and recovery after application restart.

### Admin

- Login → tenant context → dashboard.
- List/search/filter/page through products, sales, inventory and customers.
- Open operational document withhistorical snapshots.
- Start anexport andreceive completion state.
- Inspect terminal health, sync lag and errors.

### Backend and Operations

- API request → authorization → transaction → outbox → response.
- Worker claim → process → retry/dead-letter.
- Deployment → migration → readiness → smoke → stable traffic.

## 8. Dataset Profiles

كلtest suite يعلن profile صراحة:

### D0 — Unit/Contract

- Minimal deterministic fixtures.
- لايستخدم للحكم علىProduction performance.

### D1 — Demo

- 1 tenant, 3 locations, 10 terminals, 30 users.
- 5,000 products/variants.
- 50,000 sales, 250,000 sale lines.
- 500,000 inventory/cost movements.
- 25,000 customers and 10,000 documents/jobs/events.

### D2 — Small Production

- 10 tenants, 50 locations, 200 terminals, 500 users.
- 100,000 tenant-scoped catalog records.
- 2,000,000 sales and 15,000,000 lines.
- 30,000,000 ledger/movement rows.
- Realistic hot products, uneven tenant sizes and long histories.

### D3 — Growth/Stress

- Scale D2 dimensions bymeasured bottleneck rather than onefixed multiplier.
- Includes one large tenant plusmany small tenants to expose noisy-neighbor behavior.

## 9. Data Distribution Rules

- Include hot SKUs, cold catalog entries, deep history and skewed locations.
- Include negative stock, returns, partial transfers, failed payments and late offline operations.
- Include Arabic/English text, long names and realistic search terms.
- Include active andarchived states withoutviolating lifecycle rules.
- Generate deterministic data withseed/version metadata.

## 10. Test Tiers

1. **Soft:** unit, contract, typecheck and build.
2. **Hard Smoke:** small representative end-to-end mutation/read flow on every PR.
3. **Load:** expected concurrency anddataset.
4. **Stress:** find saturation andsafe failure point.
5. **Spike:** reconnect storms, login bursts andshift-opening peaks.
6. **Soak:** hours-long memory, connection andqueue stability.
7. **Scalability:** compare resource increase tothroughput/latency gain.
8. **Degraded:** slow DB/provider, partial network, worker delay andread-only mode.
9. **Migration/Backfill:** duration, locks, connection usage andrestartability.
10. **POS Local:** startup, catalog, queue, rendering, memory andcrash recovery.

## 11. Measurement Model

كلresult يسجل:

- end-to-end duration.
- client/network duration whenapplicable.
- server duration androute fingerprint.
- DB duration, query count andslow fingerprints.
- transaction duration andlock wait.
- queue age, processing duration andretry count.
- CPU, memory, event-loop delay, GC andopen handles.
- connection-pool active/waiting/timeout.
- result correctness andoutcome certainty.

## 12. Provisional Engineering Budgets

هذه حدودCI/Staging أولية وليستProduction SLA:

- Error rate forexpected-success traffic: `<= 0.5%`.
- No `OutcomeUnknown` silently counted assuccess.
- Simple isolated-CI reads: p95 `<= 250ms`.
- Normal interactive API operations: p95 `<= 500ms`.
- Critical mutation acknowledgement: p95 `<= 750ms` excludingexternal-provider completion.
- Demo-profile sync pull chunk: p95 `<= 1.5s` withbounded payload.
- POS local barcode/cart action: p95 `<= 100ms`.
- POS local durable checkout commit: p95 `<= 300ms` beforeprint/provider completion.
- Any approved baseline regression greater than20% requires review; greater than35% blocks release unlessanADR accepts it.
- Percentile gates require sufficient samples; tiny samples cannotclaim p95/p99 confidence.

## 13. API Performance Rules

- Everylist endpoint hasexplicit pagination andmaximum page size.
- Deep pagination useskeyset/cursor whenoffset cost becomesmaterial.
- Reject unbounded filters, expansions andresponse payloads.
- Request timeout, provider timeout andjob timeout areseparate.
- Bulk exports cross toasync jobs.
- Compression applies only whenmeasured andsafe.
- Rate limits aretenant/user/device aware.
- Route metrics usecanonical templates, notraw IDs.

## 14. PostgreSQL and Prisma Rules

- Inspect query plans withrepresentative data beforeindex approval.
- Prevent N+1 queries andunbounded relation loading.
- Select onlyrequired fields.
- Keep transactions short; neverperform network calls insideDB transactions.
- Record andalert onlong-running transactions andlock waits.
- Maintain aconnection budget acrossAPI, worker, migration andadmin tools.
- Index tenant-first access patterns andactual predicates.
- Use batch writes withbounded sizes andidempotent checkpoints.
- No runtime DDL.
- Partitioning andread replicas requiremeasured evidence andADR.

## 15. Cache Strategy

- Cache isnot source oftruth.
- Keys include tenant, scope, version andauthorization-relevant dimensions.
- Everycache hasowner, TTL, invalidation andstale-data policy.
- Financial, inventory andpermission decisions cannotdepend onunsafe stale entries.
- POS local catalog/cache must expose snapshot/cursor/version.
- Cache hit rate withoutcorrectness checks isnot a success metric.

## 16. POS Performance Contract

- Main, preload andrenderer metrics remainseparate.
- Startup phases aremeasured: process start, secure state, DB, migrations, UI ready andsync ready.
- Catalog indexes supportbarcode andnormalized search.
- UI virtualizes large lists anddoes notload full history into memory.
- Printing/updater/network work neverblocks renderer interaction.
- Local migrations areatomic, versioned andrestartable.
- Pending operations survivecrash/update/re-enrollment safety procedures.
- No floating-point money calculations.

## 17. Sync and Offline Performance

- Bootstrap usesmanifest andbounded chunks.
- Incremental pull usesopaque cursor andlogical cutoff.
- Push batches havecount andbyte ceilings.
- Server appliesbackpressure instead ofaccepting unbounded work.
- Reconnect storms usejitter andtenant/device fairness.
- Conflict andresync paths arebenchmarked, notonly happy path.
- Queue oldest age ismore important thanqueue count alone.
- Compression isenabled only afterCPU/bandwidth measurement.

## 18. Worker and Job Performance

- Metrics: backlog, oldest age, claim latency, processing, success, retry anddead-letter.
- Concurrency isbounded byDB/provider budgets.
- Jobs areidempotent andlease-based.
- One tenant cannotmonopolize workers.
- Retry storms useexponential backoff andjitter.
- Large rebuilds usecheckpoints andpause/resume.

## 19. Reports and Exports

- Operational screens usebounded projections oroptimized source queries.
- Large exports areasync andstreamed.
- CSV isbaseline; XLSX onlywhenimplemented withmemory limits.
- Report freshness isdeclared usingapproved F0–F4 model.
- Rebuild performance ismeasured byversion andcheckpoint.
- No huge report generation insideinteractive request transaction.

## 20. Noisy-Neighbor Controls

- Per-tenant request, export, sync andjob limits.
- Fair worker scheduling.
- Connection andmemory safeguards.
- Heavy operations exposequeued/deferred state.
- Dashboards distinguish global saturation fromone-tenant pressure withouthigh-cardinality metric labels.

## 21. Infrastructure Capacity

- Railway, Vercel andSupabase exact plan limits must beverified duringimplementation; they arenot assumed frommemory.
- Scale decisions start withquery/index/pool/payload/job fixes.
- Database reliability andbackup capability takepriority overhorizontal application scale.
- Autoscaling requiresconnection-budget guardrails.
- Demo capacity doesnot implyProduction capacity.

## 22. CI Performance Gates

Every performance artifact includes:

- commit andbranch.
- environment fingerprint.
- dataset profile andseed version.
- requests/concurrency/warm-up/duration.
- p50/p95/p99, throughput anderror classes.
- server/DB/queue timing whenavailable.
- baseline comparison.

Rules:

- PR hard-smoke ismandatory forruntime/DB/sync changes.
- Scheduled load/soak jobs mayrun separately butcannotreplace PR smoke.
- Flaky tests arequarantined onlywithowner, issue andexpiry; they arenot silently ignored.
- Baselines areenvironment-specific.

## 23. Migration and Backfill Performance

- Rehearse onclean andpopulated copies.
- Record duration, locks, rewritten rows, WAL/storage growth andconnection usage.
- Use Expand → backfill → constrain → contract.
- Backfills arechunked, resumable, idempotent andobservable.
- High-risk changes requirepre-migration recovery point androllback/forward-fix decision.
- Application startup neverruns heavy migration/backfill.

## 24. Release Performance Gate

A release isblocked when:

- critical journey exceedsapproved hard ceiling.
- regression exceedsaccepted budget withoutADR.
- error rate orOutcomeUnknown increases materially.
- DB pool, locks orqueue age approachunsafe saturation.
- migration cannotcomplete withinapproved maintenance/release window.
- POS startup/local operation regresses materially.
- evidence ismissing ordataset isnot representative.

## 25. Observability Integration

Performance metrics followATHR Monitoring and Observability v1.0:

- correlation IDs acrossrequest, DB, outbox andworker.
- deployment/migration markers.
- route/query fingerprints withcardinality controls.
- noPII, secrets orraw payloads.
- dashboards forAPI, DB, worker, POS/sync andrelease comparison.

## 26. Error Contracts

Recommended stable errors:

- `PERFORMANCE_BUDGET_EXCEEDED`
- `QUERY_TIMEOUT`
- `DB_POOL_SATURATED`
- `RESOURCE_LIMIT_EXCEEDED`
- `EXPORT_ASYNC_REQUIRED`
- `SYNC_BATCH_TOO_LARGE`
- `SYNC_BACKPRESSURE`
- `JOB_BACKLOG_LIMIT`
- `REPORT_DATASET_TOO_LARGE`
- `MAINTENANCE_CAPACITY_UNAVAILABLE`

Errors must declare retry mode andoutcome certainty accordingtoATHR Error Catalog.

## 27. Security and Privacy

- Performance tests cannotdisable authorization ortenant filters.
- Production-like datasets aresynthetic orproperly anonymized.
- Debug traces cannotcapturetokens, PII, payment data ordocument bodies.
- Load generation isauthorized andbounded.
- Rate-limit bypasses forCI areenvironment-scoped andnot deployed toProduction.

## 28. Acceptance Tests

- Dataset generator isdeterministic andversioned.
- Linux CI andWindows/local baselines arestored separately.
- Core API/POS/sync journeys havehard-smoke coverage.
- DB query count andpool metrics arevisible.
- Regression comparison producesmachine-readable result.
- One large tenant cannotstarve another inworker/sync tests.
- Migration andbackfill tests arerestartable.
- Failure injection preservesdata correctness.

## 29. First-Paid-Customer Gate

Before first paid customer:

- Production-like Staging baseline exists.
- Core journey SLOs areapproved withmeasured evidence.
- D2 dataset passesload andmigration rehearsal.
- Soak test showsstable memory/connections/queues.
- POS startup, search, checkout andoffline recovery meetapproved budgets.
- DB capacity andconnection budgets aredocumented.
- Alerts andrunbooks coverperformance saturation.
- No unresolved critical performance regression.

## 30. Open Decisions

- ExactProduction SLOs anderror budgets afterStaging baseline.
- Exact D2/D3 counts afterreal customer sizing.
- Whether dedicated Redis/queue isneeded aftermeasurement.
- When keyset pagination replacesoffset permodule.
- Exact export async threshold.
- Provider plan upgrades andregional placement.
- Whether a read replica orpartitioning isever justified.

## 31. Prohibited Patterns

- Benchmarking onlyempty datasets.
- Comparing unrelated environments asone baseline.
- Optimizing average whileignoring p95/p99.
- Unlimited pagination, batch orresponse payload.
- Network calls insideDB transactions.
- Cache asfinancial/inventory truth.
- Disabling tenant/security checks forspeed.
- Blind retries forOutcomeUnknown.
- In-memory critical queues.
- Big-bang sharding ormicroservices withoutmeasured evidence.
- Claiming Production SLA fromDemo orCI results.

## 32. Implementation Mapping

- WP-002 creates shared test/config foundations.
- WP-003 standardizes errors, correlation andoutcome contracts.
- WP-004 removesunsafe numeric representations.
- WP-005–WP-018 addtenant/domain/sync performance tests alongsidefeatures.
- WP-025 completes observability andrepresentative-volume gates.
- WP-026 rehearses deployment/migration/recovery performance.
- WP-027 requires approvedDemo journey baseline.

## 33. Approval Outcome

هذهالوثيقة تغلق مستوى **D — Architecture and Operations** منناحيةPerformance. أيتنفيذ أداء لاحق يجب أنيستخدم هذهالاستراتيجية كعقد، ويضيفقياسات فعلية دونتغييرالمبادئ أوالحدود إلا عبرADR موثق.