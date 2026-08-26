# ATHR Deployment Architecture v1.0

**Planning Baseline — Environments, Deployment Units, Railway, Vercel, Supabase, GitHub Releases, Migrations, Scaling and First-Paid Production Gate**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة معمارية نشر وتشغيل ATHR، وتشمل:

- بيئات Local وCI وPreview وDemo وStaging وProduction.
- مسؤوليات Railway وVercel وSupabase وGitHub.
- وحدات نشر Backend وWorkers وAdmin وPOS.
- Domains وTLS وCORS والـrouting.
- Configuration وSecrets distribution.
- Database migrations وترتيبالإصدارات.
- Jobs وSchedulers وOutbox وQueues.
- Object Storage وNotification providers.
- Health وReadiness وGraceful shutdown.
- Zero-downtime principles والـcompatibility windows.
- Rollback وForward-fix boundaries.
- Horizontal scaling وNoisy-neighbor controls.
- تكلفةالـFree Demo ومسارالترقية.
- بوابةأولعميل مدفوع.
- اختباراتالنشر والـacceptance gates.

هذه الوثيقة لا تحدد سياسةالنسخ الاحتياطي وRPO/RTO التفصيلية؛ ذلك في **ATHR Backup and Recovery v1.0**. ولا تحدد أدواتالـmetrics والـalerts النهائية؛ ذلك في **Monitoring and Observability**.

## 2. خطالأساس الحالي

Repository الحالي يستخدم:

- NestJS backend.
- Next.js Admin.
- Electron POS.
- Prisma + PostgreSQL.
- Railway للـAPI.
- Vercel للـAdmin.
- Supabase PostgreSQL.
- GitHub Actions للاختبارات والنشر والـPOS releases.

قرارATHR هو **تحويلهذهالبنية تدريجيًا**، وليسإنشاءمنصةجديدة أوMicroservices مبكرة.

## 3. المبادئ غيرالقابلة للتفاوض

1. PostgreSQL هيالمصدرالرئيسي للحقيقة.
2. Application artifacts immutable؛ Configuration خارجartifact.
3. لاDatabase migration غيرمراجعة أوغيرموجودةفيGit.
4. لاMigration destructive وتشغيلCode غيرمتوافق فينفسالخطوة.
5. لاSchema migration تلقائية عندكلApplication startup.
6. Release واحدةلهاCommit SHA وArtifact versions واضحة.
7. Admin وAPI وWorker وPOS قدتتحركبسرعاتمختلفة ضمنCompatibility contract.
8. Secrets لا تدخلFrontend bundle أوGit أوBuild logs.
9. Preview deployments لا تصلProduction data افتراضيًا.
10. Demo وProduction منفصلتانفيالبيانات والأسرار والهويةالتشغيلية.
11. Health endpoint لا يعنيReadiness ولايكشفتفاصيلحساسة.
12. Workers والـCron idempotent وقابلةللتكرار.
13. Provider outage لا يفسدBusiness transaction المكتملة.
14. لاDistributed transaction بينRailway/Vercel/Supabase/providers.
15. Database rollback ليستافتراضيًا؛ Schema failures تعالجForward-fix أوRestore وفقخطةمسبقة.
16. POS update لا يمحوPending operations أويفرضSchema محليةغيرمتوافقة.
17. لاPaid service قبلقرارصريح أوأولعميل، لكنArchitecture لا تعتمدحدودالخطةالمجانية.
18. كلEnvironment لهاCredentials ومفاتيحهاوقاعدةبياناتها أوعزلهاالمثبت.
19. Deployment failure لا يمرصامتًا ولا يعلنRelease ناجحة.
20. Production traffic لا يوجهلـinstance غيرReady.
21. Configuration validation تفشلStartup قبلخدمةالطلبات.
22. One primary region baseline؛ Multiregion ليسوعدًا فيMVP.
23. Tenant isolation لا تعتمدDeployment pertenant.
24. Every release قابلةللتتبع منCommit إلىDB migration إلىPOS installer.
25. كلانحرافعنالخطة يوثقفيDelivery Log.

# القسم الأول — Environment Model

## 4. Local Development

الغرض:

- تطويرBackend/Admin/POS.
- Unit وintegration tests.
- Local PostgreSQL أوisolated development database.
- Fake/local notification provider.
- Local object-storage adapter أوisolated bucket.

القواعد:

- لاProduction secrets.
- Seed destructive مسموحةفقطعلىDatabase محليةمتحققمنها.
- Environment schema validation إلزامية.
- Bash scripts هيالواجهةالمعتمدة.

## 5. CI Environment

بيئةمؤقتة لكلRun أوJob:

- Clean PostgreSQL database.
- Populated-upgrade fixture database.
- Fake providers.
- No external financial side effects.
- No Production credentials.
- Deterministic clocks/data حيثيلزم.

تغطي:

- Typecheck/lint.
- Unit/contract/integration.
- Migration clean apply.
- Migration populated upgrade.
- Admin E2E.
- POS build/tests.
- Security andtenant tests.
- Hard-smoke/load gates.

## 6. Preview Environment

تستخدملمعاينةPR أوBranch، خصوصًاAdmin Web.

Baseline:

- Preview Admin لا تتصلDemo أوProduction data افتراضيًا.
- إماMock API أوisolated preview API/database عندالحاجة.
- Preview URL ليستCORS origin معتمدة تلقائيًا.
- Secrets محدودة وغيرProduction.
- Preview تزالأوتنتهيبعدPR.

## 7. Demo Environment

الغرض:

- عروضالعملاء.
- اختبارالتدفقاتالحرجة بـInitial ATHR Demo Tenant.
- استخدامRailway/Vercel/Supabase الحالية قدرالإمكان.

خصائصها:

- ليستProduction SLA.
- لا تحتويبياناتعميلمدفوع حقيقية.
- يمكنإعادةتهيئتها بقرارمقصود، معالحفاظعلىMigration discipline.
- Alerting/backup أبسط، لكنSecurity controls الأساسيةلاتلغى.
- Internal demo entitlement، لاMRR ولاInvoice.

## 8. Staging Environment

بيئةشبيهةProduction لإعادةالنشر والـmigrations والـreleases.

Baseline:

- تصبحإلزامية قبلأولعميلمدفوع.
- بياناتSynthetic أوAnonymized فقط.
- نفسBuild artifacts وConfig schema وMigration path.
- Provider sandbox/Test modes.
- نسخةPOS beta/internal channel.

قبلإنشاءStaging مدفوعة، CI +Preview +Demo تؤديبعضوظائفها، لكنلا تدعيأنهابديلكامل.

## 9. Production Environment

- Dedicated application, database, storage andsecrets boundary.
- لا تشتركمعDemo فيCredentials أوبيانات.
- Custom domains وTLS.
- Monitoring/alerting/on-call.
- Backup/restore/PITR capabilities وفقBackup plan.
- Controlled migrations andapprovals.
- Signed stable POS channel.
- Capacity andprovider plans مناسبةللعميلالمدفوع.

## 10. Environment Promotion

```
Developer branch
→ Pull Request CI
→ Preview
→ Transformation branch / Demo release
→ Staging rehearsal
→ Production approval
→ Production deployment
```

لا يتمPromote لبيانات أوSecrets؛ يتمPromote لنفسArtifacts معConfiguration مستقلة.

# القسم الثاني — Deployment Units

## 11. API Service

NestJS Modular Monolith يحتوي:

- Interactive REST/API endpoints.
- Authentication andauthorization boundaries.
- Sync endpoints.
- Webhook intake.
- Health/readiness endpoints.
- Command/query orchestration.

لا يحتويLong-running jobs داخلRequest lifecycle.

## 12. Worker Service

نفسRepository وDomain/Application packages، لكنEntrypoint منفصل لمعالجة:

- Outbox dispatch.
- Inbox/event consumers.
- Notifications.
- Reports/exports.
- Provider reconciliation.
- Projection updates/rebuilds.
- File processing.
- Billing/scheduled processes.
- Retention andcleanup jobs.

## 13. Scheduler

Scheduler لا ينفذBusiness work الثقيلنفسه؛ ينشئDurable jobs idempotently.

Baseline:

- Job schedules محفوظةومنسقةفيApplication/DB.
- Leader election أوPostgreSQL advisory lock يمنعduplicate scheduling.
- Multiple scheduler instances آمنة.
- Scheduled occurrence لهاidempotency identity.

## 14. Demo Process Consolidation

لتقليلتكلفةDemo يجوزتشغيل:

- API +light outbox/worker loops فيService واحدة، أو
- API service وWorker service حسبالمتاح.

لكن:

- Code entrypoints والـresponsibilities منفصلة.
- Heavy jobs لهاlimits.
- Production تفصلWorker عنAPI.
- Consolidation ليستDomain coupling.

## 15. Admin Web

Next.js علىVercel baseline:

- Browser UI وserver-side web boundary عندالحاجة.
- لا تمتلكBusiness source oftruth.
- لا تتصلPostgreSQL مباشرة.
- تتحدثمعATHR API عبرconfigured origin.
- Public frontend variables غيرحساسةفقط.

## 16. POS Desktop

Electron artifact مستقل:

- ينشرويتحدثعبرGitHub Releases baseline.
- يتصلAPI عبرenrollment/configuration.
- يحتفظLocal cache وPending operations.
- لهProtocol version وMinimum supported server/client policy.

## 17. Migration Runner

Entrypoint/Job مخصص:

- يمتلكMigration credentials فقطوقتالتنفيذ.
- ينفذ`prisma migrate deploy` والـcustom validation scripts.
- لا يعملداخلكلAPI instance startup.
- ينتجMigration report وschema/version evidence.

## 18. One-off Administrative Jobs

مثل:

- Backfill.
- Tenant export/import.
- Projection rebuild.
- Security key rotation.

تستخدمCLI/Job entrypoints صريحة:

- Environment andtenant scope mandatory.
- Dry run حيثيلزم.
- Approval/audit.
- Checkpoint/resume.

# القسم الثالث — Provider Responsibilities

## 19. Railway Baseline

Railway تستضيففيDemo:

- ATHR API service.
- Worker service إذاأمكن.
- Environment configuration الخاصةبالخدمة.
- Service health routing.

Railway لا تملك:

- Business data source oftruth.
- POS artifacts.
- Admin static/frontend deployment.
- Long-term backups كبديلعنDatabase backup plan.

Exact capabilities/limits للخطةالمستخدمة تتحققوقتالتنفيذ، ولا تثبتكـDomain assumption.

## 20. Vercel Baseline

Vercel تستضيف:

- ATHR Admin Web.
- Preview deployments.
- Custom Admin domain مستقبلًا.
- Frontend environment separation.

لا تستخدملتنفيذ:

- Long-running background workers.
- Database migrations.
- Direct business writes خارجATHR API contract.

## 21. Supabase Baseline

Supabase توفر:

- Managed PostgreSQL primary database للـDemo.
- Connection endpoints/pooling حسبنمطالعمل.
- Private object storage عنداعتماده.

قراراتATHR:

- ATHR Authentication تبقىداخلنموذجPlatform Identity، ولا نفترضSupabase Auth كمرجعDomain.
- Prisma يستخدمConnection mode مناسبلكلRuntime/Migration.
- Direct connection للمهاجراتعندالحاجة، وpooling للـruntime بعداختبار.
- Storage private وSigned links server-mediated.

Exact backup/PITR/pool/plan capabilities تتحققفيBackup/Deployment implementation، ولا نفترضميزةمدفوعةمتاحةمجانيًا.

## 22. GitHub

GitHub تملك:

- Source repository.
- Pull requests andbranch protection.
- GitHub Actions CI/CD.
- Release metadata.
- POS installers/manifests/checksums.

GitHub Release ليستقناةتحديث آمنةبمفردها؛ ATHR تحتاجSigning, checksums, channel policy andprovenance.

## 23. Notification Provider

- Development: local/fake sink.
- Demo: free email tier إنتمتكوينه.
- Production: approved provider withverified domain, webhooks andreconciliation.
- SMS/WhatsApp/Push disabled حتىقرارCommercial.

## 24. Object Storage

Baseline:

- Supabase Storage أوprovider-compatible adapter.
- Private buckets.
- Tenant namespacing.
- Signed URLs.
- Lifecycle/retention metadata فيPostgreSQL.

## 25. Optional Future Providers

Architecture تسمحبإضافة:

- Redis/distributed cache.
- Durable queue provider.
- Dedicatedobservability platform.
- CDN/WAF.
- External data warehouse.

لكنلاتضافقبلقياسالحاجة أوأولعميل.

# القسم الرابع — Domain, TLS and Routing

## 26. Logical Domains

Baseline logical names:

```
app.<athr-domain>      Admin Web
api.<athr-domain>      API / Sync / Webhooks
downloads.<athr-domain> optional secure delivery facade
status.<athr-domain>    optional later
```

الـdomain الفعلي قرارOperational منفصل؛ لا يوضعHard-coded فيالكود.

## 27. TLS

- HTTPS only خارجLocal.
- TLS termination عبرprovider/edge.
- HTTP redirected أوblocked.
- HSTS بعدتأكيدكلsubdomains والـcertificates.
- POS لا يعطلتوثيقTLS.

## 28. CORS

API allow-list لكلEnvironment:

- Exact Admin origins.
- لاWildcard معcredentials.
- Preview origins لا تضافعالميًا؛ تستخدمisolatedpreview policy.
- POS/Electron لا يعتمدCORS كحماية؛ Authentication/device trust هيالأساس.

## 29. Cookies

Admin session cookie:

- Secure/HttpOnly.
- Domain/Path ضيقة.
- لا تشتركعبرDemo/Production.
- Custom domain layout يجبأن يدعم`__Host-` cookie إنأمكن.

## 30. Webhooks

```
api.<domain>/webhooks/{provider}/{version}
```

- لا تمرعبرAdmin Web.
- Raw body verification.
- Dedicated rate limits.
- Fast acknowledgment ثمDurable processing.

## 31. POS Downloads

- Installer andmanifest عبرGitHub Release أوdownload facade.
- HTTPS.
- Manifest/artifact signature/checksum.
- Channel/version policy.

# القسم الخامس — Configuration and Secrets

## 32. Configuration Schema

كلService تقرأTyped validated configuration عندStartup:

- environment name.
- public origins/domains.
- database connection mode.
- session/token key IDs.
- provider namespaces.
- storage bucket names.
- job/worker limits.
- feature gates.
- observability endpoints.
- release/protocol versions.

Missing أوinvalid config تمنعReadiness.

## 33. Secret Boundaries

كلEnvironment لها:

- DB credentials.
- token/lease signing keys.
- field encryption keys.
- webhook/provider secrets.
- storage service credentials.
- CI/deploy credentials.
- POS signing key/certificate.

لاSecret واحدةمشتركةبينDemo وProduction.

## 34. Frontend Variables

أيVariable تصلBrowser تعتبرPublic.

مسموح:

- API public base URL.
- Environment label.
- Non-secret feature display flags.

ممنوع:

- Database URL.
- Provider secret.
- Signing key.
- Service role token.
- Internal support endpoint secret.

## 35. Config Versioning

- Application logs config schema/version، لاقيمالأسرار.
- Policy values التجارية/الأمنية تخزنVersioned فيDB حيثيلزم.
- Infrastructure config changes عبرPR أوprovider-audited change.

## 36. Secret Rotation Deployment

1. إضافةNew key/secret version.
2. Deploy readers/verifiers القادرةعلىالقديم والجديد.
3. Switch writers إلىالجديد.
4. Verify.
5. Retire القديم بعدoverlap.
6. Emergency compromise يسمحImmediate revoke.

# القسم السادس — Database Connections

## 37. Runtime Connection

- API وWorkers تستخدمRuntime role محدودة.
- Connection pooling مناسبلمدىعمرالعمليات.
- Pool size محسوبةمقابلDatabase limit وعددinstances.
- Timeouts: connect, statement, idle transaction.
- TLS.

## 38. Migration Connection

- Direct/approved migration connection.
- Migration role منفصلة.
- لا تستخدمpooling mode غيرمتوافقةمعDDL/locks.
- Credentials لا تكونمتاحةللـruntime service.

## 39. Connection Budget

```
Database capacity
- reserved admin/migration/monitoring
= runtime connection budget
```

يوزععلى:

- API instances.
- Worker instances.
- Scheduler.
- One-off jobs.

Autoscaling لا يزيدinstances دونPool budget.

## 40. Transactions

- Interactive transactions قصيرة.
- لاNetwork calls داخلDB transaction.
- Workers تقسمbatch وتثبتcheckpoints.
- Long locks/idle transactions monitored.

# القسم السابع — Database Migration Architecture

## 41. Expand / Backfill / Constrain / Contract

المسارالمعتمد:

```
Expand schema
→ Deploy compatible code
→ Backfill/checkpoint/reconcile
→ Enforce constraints
→ Remove legacy reads/writes
→ Contract in later release
```

## 42. Migration Release Rules

- Migration SQL committed.
- Clean DB apply passes.
- Populated previous-release upgrade passes.
- Row counts/invariants checked.
- Drift zero.
- Lock/time estimate reviewed.
- Backup/recovery gate حسبخطرالبيئة.
- Migration runner single-writer.

## 43. Release Ordering

Baseline:

1. CI validatesallartifacts/migrations.
2. Createimmutable release candidate.
3. Rehearse onStaging/populated fixture.
4. Applybackward-compatible DB migration.
5. Verifymigration.
6. DeployAPI/Worker compatible versions.
7. Runreadiness/smoke/reconciliation.
8. DeployAdmin.
9. PublishPOS update onlywhenserver compatible.
10. Observe.
11. Later contract oldschema/protocol.

## 44. Migration Failure

- Stopnewdeployment promotion.
- Preservecurrentapp ifschema remainscompatible.
- Diagnoseusingmigration evidence.
- Forward-fix preferred.
- Restore onlyunderBackup/Recovery plan.
- لا تحاول`down migration` تلقائيةعلىproduction data.

## 45. Backfills

- Idempotent andcheckpointed.
- Bounded batches.
- Tenant-by-tenant wherepossible.
- Resume afterfailure.
- Control totals.
- Rate limited toprotectinteractive traffic.

## 46. Schema Compatibility Window

- API/Workers تدعمold+new columns/states خلالالتحول.
- POS protocol compatibility lasts longer لأنadoption غيرفورية.
- Removal migration لا تدخلحتىقياسclient adoption وإبطالالنسخغيرالمدعومة.

# القسم الثامن — Jobs, Queues and Scheduling

## 47. Durable Job Baseline

قبلإضافةQueue مدفوعة:

- PostgreSQL job/outbox/inbox tables.
- `FOR UPDATE SKIP LOCKED` أوequivalent reviewed pattern.
- Lease/lock owner/expiry.
- Idempotency key.
- Attempts/backoff/not-before.
- Dead-letter state.
- Tenant andpriority.

## 48. Worker Concurrency

- Global maximum.
- Perjob-type maximum.
- PerTenant fairness.
- Provider-specific limits.
- DB pool budget.
- Graceful stop stopsclaimingnewwork ثمfinishes/returnslease.

## 49. Scheduler Safety

- Occurrence identity unique.
- Leader lock/advisory lock.
- Timezone/DST handled bybusiness schedule definitions.
- Scheduler replay safe afterdowntime.
- Missed occurrences policy perjob.

## 50. Cron Provider Independence

قد يستخدمRailway/GitHub/provider schedule كـwake-up trigger، لكنBusiness schedule source تبقىDB/ATHR process؛ إعادةتشغيلالـtrigger لا تكررالأثر.

## 51. Queue Upgrade Trigger

انتقالإلىmanaged queue/Redis عندمايثبت:

- DB job contention يؤثرOLTP.
- Queue lag أوthroughput تجاوزالسعة.
- Need fan-out/delayed delivery beyondDB design.
- Multiple services تحتاجisolation أقوى.

الـjob contract لا يتغير.

# القسم التاسع — Health, Readiness and Lifecycle

## 52. Liveness

يثبتأنProcess قادرةعلىالاستمرار، دونفحصعميقلمزودات خارجية.

- لا يكشفسرًا.
- سريع.
- لا يفشللمجردProvider email outage.

## 53. Readiness

يثبتأنService يمكنهاخدمةنوعحركتها:

API readiness:

- Config valid.
- Required signing/verification keys loaded.
- Database reachable.
- Schema version compatible.
- Critical dependencies internal ready.

Worker readiness:

- Database/job store reachable.
- Requiredkeys/config loaded.
- Worker version compatible.

## 54. Dependency Health

Dashboard داخلي منفصل يعرض:

- DB connectivity/pool.
- Outbox/job lag.
- Provider health.
- Storage.
- Notification delivery.
- Migration/schema version.

لا يعرضتفاصيلحساسةللعامة.

## 55. Startup

1. Load andvalidateconfig.
2. Initialize structured logging.
3. Checkbuild/schema compatibility.
4. Load keys/adapters.
5. Start listeners.
6. Mark ready.

لا تنفذHeavy backfill أوmigration عندstartup.

## 56. Graceful Shutdown

- Stop acceptingnewrequests/jobs.
- Finishbounded in-flight work.
- Releasejob leases/locks safely.
- Flushdurable logs/outbox whereapplicable.
- CloseDB pool.
- Respect platform termination window.

## 57. Readiness During Migration

- Instance غيرمتوافقةلاتصبحReady.
- Expand migrations تسمحالقديم والجديد.
- Contract migration تتمبعدإزالةالقديم.

# القسم العاشر — Deployment Flow

## 58. Pull Request Flow

```
Checkout exact commit
→ npm ci
→ generate Prisma/client artifacts
→ typecheck/lint
→ unit/contract/integration
→ clean migration
→ populated upgrade
→ backend/admin/POS builds
→ E2E/security/hard-smoke
→ artifact metadata/checksums
```

## 59. Backend Release

- Build once.
- Embedcommit/version metadata غيرحساسة.
- Migration gate منفصلة.
- Deploy API andWorker fromsamecompatible release set.
- Health/readiness thenSmoke.

## 60. Admin Release

- Build withpublic environment variables فقط.
- SameAPI contract compatibility.
- Preview beforepromotion.
- Post-deployauth/navigation/critical E2E smoke.

## 61. POS Release

Channels:

- Internal/Development.
- Beta/Demo.
- Stable/Production.

كلRelease:

- Version +commit.
- Installer artifact.
- Manifest.
- Checksum/signature.
- Minimum server protocol.
- Local migration version.
- Release notes androllback constraints.

## 62. POS Rollout

- Staged adoption.
- Monitorupdate success/client versions.
- Server supportsN/N-1 protocol حسبpolicy.
- Critical security version يمكنفرضminimum.
- لا نشرStable قبلنجاحupgrade withpending outbox fixture.

## 63. Release Manifest

يحملعلىالأقل:

- product/app identity ATHR.
- channel.
- version.
- artifact URL/reference.
- checksum/signature/key ID.
- minimum OS/app/server protocol.
- published time.

# القسم الحادي عشر — Zero-downtime and Compatibility

## 64. Zero-downtime Meaning

هدفوليسوعدًا مطلقًا فيFree Demo. Production design يقللinterruption عبر:

- Backward-compatible schema.
- Readiness routing.
- Multiple instances عندالخطةالمناسبة.
- Graceful shutdown.
- VersionedAPI/protocol.
- Worker idempotency.

## 65. Rolling Deployment

مسموحإذا:

- Old/new versions تفهمنفسschema/events.
- Token/key overlap صالح.
- No singleton in-memory state.
- Jobs ليستمرتبطةprocess memory.

## 66. Breaking API Changes

- Versioned route/contract أوcompatibility adapter.
- Admin deploy coordinated.
- POS longer deprecation window.
- Usage telemetry andclient minimum policy قبلالإزالة.

## 67. Event Compatibility

- Event schema version.
- Consumers ignoreoptional unknown fields.
- Breakingevent version جديدة.
- Outbox القديمة تظلprocessable أثناءالdeploy.

## 68. Feature Flags

تستخدمللـrollout لا لإخفاءSchema غيرمكتملة.

- Server authoritative.
- Tenant/plan/environment scope.
- Default safe.
- Expiry/owner.
- No secret flags inclient.

# القسم الثاني عشر — Rollback and Forward Fix

## 69. Application Rollback

مسموحإلىArtifact سابقة فقطإذا:

- Schema مازالتcompatible.
- Events/jobs produced bynewversion مفهومة.
- Config/key versions متاحة.
- POS/admin compatibility محفوظة.

## 70. Database Rollback

ليست`git revert` أو`down migration` تلقائية.

الخيارات:

- Forward-fix migration.
- Disable feature/read-only path.
- Restore verified backup/PITR ضمنDisaster plan.

## 71. Partial Deployment

إذاWorker نجحت وAPI فشلت أوالعكس:

- Compatibility matrix تحددالآمن.
- Promotion تتوقف.
- Readiness تمنعversion غيرصالحة.
- Job consumers قابلةللتعطيل منفصلًا.
- No schema contract step untilallcomponents adopted.

## 72. Provider Configuration Rollback

- Previous secret/key kept خلالoverlap إنغيرمخترق.
- Config change versioned/audited.
- No rollback إلىcompromised key.

# القسم الثالث عشر — Scaling Architecture

## 73. Baseline Scale

قبلأولعميل:

- One API instance acceptable للـDemo.
- One worker أوconsolidated process.
- OnePostgreSQL primary.
- NoRedis/managedqueue requirement.

هذاBaseline تكلفة، وليسحدًا معماريًا.

## 74. Horizontal API Scaling

يتطلب:

- Stateless request processing.
- Server-side/shared session persistence أوrevocable token model.
- Idempotency inDB.
- No process-local currenttenant/business state.
- Shared object storage.
- DB connection budget.

## 75. Worker Scaling

- Durableclaim/lease.
- Idempotent handlers.
- PerTenant fairness.
- Partition byjob type/priority عندالحاجة.
- Provider/DB concurrency limits.

## 76. Database Scaling Order

1. Query/index optimization.
2. Connection/pool tuning.
3. Removeunbounded operations.
4. Projection/preaggregation.
5. Resource plan upgrade.
6. Read replica forsafe read workloads ifsupported/needed.
7. Partitioning/warehouse basedonmeasurement.

لاSharding مبكر.

## 77. Scaling Triggers

يحددPerformance Strategy أرقامها، لكنSignals تشمل:

- Sustained CPU/memory saturation.
- DB connection saturation.
- p95/p99 SLO breach.
- Queue/outbox lag.
- Slow queries/lock contention.
- Storage/backup limits.
- Noisy tenant impact.
- Build/deploy duration.

## 78. Tenant Fairness

- API rate limits.
- Query row/range limits.
- Sync batch limits.
- Job/export concurrency.
- Storage/notification quotas.
- PerTenant circuit/incident controls.

# القسم الرابع عشر — Availability and Provider Failures

## 79. Railway/API Failure

- Admin تعرضDegraded/Offline state.
- POS تنتقلللـOffline protocol إنLease صالحة.
- No false success foronline-only operations.
- Workers resume idempotently.

## 80. Vercel/Admin Failure

- POS والـAPI يظلانمستقلين.
- لا يفقدBusiness data.
- Support mayusecontrolled API/operational tools later.

## 81. Supabase/PostgreSQL Failure

- API mutations failclosed.
- POS cash operations onlywithinvalidOffline Lease.
- No in-memory write acceptance.
- Reconnect/backoff withoutduplicate effects.
- Recovery followsBackup plan.

## 82. Object Storage Failure

- Business document remainsissued.
- Render/export/upload markedpending/failed.
- Retry later.
- لا يعادPosting transaction.

## 83. Notification Provider Failure

- Notification queued/retried/fallback.
- Source business event remainscomplete.

## 84. GitHub Release/Update Failure

- ExistingPOS keepsworking withinprotocol support.
- Installer/update publish retried.
- No unsigned alternate channel.

# القسم الخامس عشر — Data and Storage Placement

## 85. PostgreSQL

يحتوي:

- Domain aggregates/ledgers.
- Identity/membership/session metadata.
- Outbox/inbox/jobs.
- Audit/security evidence.
- Reporting projections.
- File metadata.

لا يخزنLarge binary files.

## 86. Object Storage

يحتوي:

- Documents/renders.
- Exports.
- Product media.
- Evidence attachments.
- Temporary uploads.

معprivate access وretention metadata.

## 87. POS Local Storage

- Cache/snapshots.
- Pending operations/outbox.
- Local document/print snapshots.
- Minimal user/customer data.
- No server secrets.

## 88. Logs and Telemetry

- Structured operational/security logs.
- Retention تختلفعنAudit.
- No secrets/PII raw.
- Provider selection فيMonitoring document.

# القسم السادس عشر — Observability Hooks

## 89. Release Metadata

كلService تعرضداخليًا:

- app/service version.
- commit SHA.
- build time.
- environment.
- protocol/schema compatibility version.

لا تعرضSecrets أوdependency detail للعامة.

## 90. Required Metrics

- Request rate/error/latency.
- DB pool/query/lock health.
- Job/outbox lag.
- Sync lag/conflicts.
- Active client versions.
- Notification/provider outcomes.
- Deployment/readiness failures.
- Migration duration/result.

## 91. Correlation

Request/correlation IDs تنتقلعبر:

```
Admin/POS
→ API
→ DB/outbox/job
→ Worker
→ Provider
```

## 92. Deployment Events

كلDeploy/Migration/POS release ينتجEvent/Audit operational record:

- environment.
- version/commit.
- actor/workflow.
- migration IDs.
- start/end/outcome.
- rollback/forward-fix reference.

# القسم السابع عشر — First Paid Customer Gate

## 93. مبدأالبوابة

الـDemo المجانية تستمرحتىوجودأولمشترك. قبلتفعيلأولPaid tenant للاستخدامالحقيقي، يجبإغلاقProduction readiness gate.

## 94. Infrastructure Gate

- DedicatedProduction Railway/Vercel/Supabase resources أوخططمعتمدة.
- Production database منفصلةعنDemo.
- Capacity/connection limits مراجعة.
- Object storage private.
- Custom domains/TLS.
- Verifiedemail sender عنداستخدامEmail.

## 95. Recovery Gate

- Automated backups/PITR حسبالخطةالمختارة.
- Restore rehearsal ناجحة.
- Migration rollback/forward-fix runbook.
- RPO/RTO معلنة.

## 96. Security Gate

- Production secrets rotated andseparated.
- MFA للـplatform/owners/high-risk users.
- Signed POS release.
- No high/critical unresolved findings.
- Dependency/secret/security gates green.
- Support/break-glass access controlled.

## 97. Operational Gate

- Staging rehearsal.
- Monitoring andalerts.
- On-call/escalation ownership.
- Status/incident communication process.
- Database/provider dashboards.
- Client version/update monitoring.

## 98. Product Gate

- Tenant provisioning.
- Subscription/entitlements active.
- Admin andPOS critical flows.
- Sync/offline/recovery tested.
- Documents/notifications required forlaunch.
- Demo data notpresent inpaidtenant.

## 99. Release Gate

- Exact release candidate passedallCI.
- Populated migration rehearsal.
- Production migration approved.
- Smoke andbusiness reconciliation scripts.
- Delivery Log complete.
- Go/no-go owner assigned.

## 100. No Automatic Paid Upgrade

أولInvoice أوPayment لا تشتريخدماتتلقائيًا داخلنفسTransaction.

- Billing activation emitsoperational milestone.
- Human/controlled workflow verifiesinfrastructure gate.
- لاتفعيلعميل علىبنيةغيرجاهزة.

# القسم الثامن عشر — Cost-aware Transition

## 101. Free Demo Baseline

- ExistingRailway API.
- ExistingVercel Admin.
- ExistingSupabase PostgreSQL.
- GitHub Actions/Releases.
- Fake/local notifications أوfree tier.
- PostgreSQL-backed jobs.
- NoRedis/paidqueue/datawarehouse.

## 102. Cost Decisions

كلخدمةجديدة تحتاج:

- Problem measured.
- Free/local-compatible fallback.
- Monthly cost estimate وقتالقرار.
- Data/security/compliance impact.
- Exit/migration path.
- Approval.

## 103. Upgrade Priority

عندأولإيراد، الأولوية:

1. Database reliability/backups/capacity.
2. API uptime/capacity.
3. Monitoring/alerts.
4. Storage/email reliability.
5. Staging.
6. Distributed queue/cache عندالحاجة.
7. Advancedanalytics later.

# القسم التاسع عشر — Deployment Error Contract

## 104. Configuration Errors

- `DEPLOYMENT_CONFIG_INVALID`
- `DEPLOYMENT_SECRET_MISSING`
- `DEPLOYMENT_ENVIRONMENT_MISMATCH`
- `DEPLOYMENT_ORIGIN_NOT_ALLOWED`
- `DEPLOYMENT_KEY_VERSION_UNAVAILABLE`

## 105. Migration Errors

- `MIGRATION_SCHEMA_INCOMPATIBLE`
- `MIGRATION_DRIFT_DETECTED`
- `MIGRATION_ALREADY_FAILED`
- `MIGRATION_LOCK_TIMEOUT`
- `MIGRATION_BACKFILL_INCOMPLETE`
- `MIGRATION_INVARIANT_FAILED`
- `MIGRATION_RESTORE_REQUIRED`

## 106. Runtime Errors

- `SERVICE_NOT_READY`
- `SERVICE_DEPENDENCY_UNAVAILABLE`
- `WORKER_QUEUE_UNAVAILABLE`
- `SCHEDULER_LEADER_UNAVAILABLE`
- `DATABASE_CONNECTION_BUDGET_EXCEEDED`
- `CLIENT_PROTOCOL_UNSUPPORTED`

## 107. Release Errors

- `RELEASE_ARTIFACT_INVALID`
- `RELEASE_SIGNATURE_INVALID`
- `RELEASE_COMPATIBILITY_FAILED`
- `RELEASE_SMOKE_FAILED`
- `RELEASE_PROMOTION_BLOCKED`
- `RELEASE_ROLLBACK_NOT_SAFE`

# القسم العشرون — Failure and Recovery Rules

## 108. API Deploy Fails Before Ready

- Provider keepsoldready version wherecapable.
- Newinstance receivesnotraffic.
- Promotion fails.
- NoDB contract migration.

## 109. Migration Succeeds, App Fails

- Keepoldapp onlyifschema compatible.
- Otherwisedeployknowncompatibleforward-fix version.
- Do notreverseDB automatically.
- Incident/runbook.

## 110. Worker Deploy Fails

- API maystayup ifqueues durable andlag acceptable.
- Pausefeatures requiringimmediate worker completion.
- Alert onlag.
- Retry knownartifact.

## 111. Admin Deploy Fails

- API/POS unaffected.
- PreviousAdmin artifact remainsorrollback ifcompatible.
- NoDB rollback.

## 112. POS Release Is Bad

- Stopchannel promotion.
- Publishfixedhigher version; avoidunsafe downgrade oflocal schema.
- Server mayblockbadversion ifsecurity/data risk.
- Pending operations recovered beforereinstall/reset.

## 113. Provider Plan Limit Reached

- Alert beforehardlimit wherepossible.
- Throttle noncritical jobs/exports.
- Protectsales/sync/auth.
- Upgrade decision ortemporarycapacity response.
- No silent data loss.

# القسم الحادي والعشرون — Testing Contract

## 114. Environment Tests

- Config schema perenvironment.
- Demo/Production secret separation.
- NoPreview→Production data path.
- Public frontend variables containnosecrets.

## 115. Deployment Tests

- Buildonce/promote artifact.
- Readiness beforetraffic.
- Gracefulshutdown.
- Rollingold/new compatibility.
- Failedrelease notmarkedgreen.

## 116. Migration Tests

- Clean apply.
- Repeat/no-op behavior.
- Populated previousversion upgrade.
- Backfill resume.
- Lock timeout.
- Invariant/control totals.
- Old/newapp compatibility.
- Contract migration delayed.

## 117. Worker/Scheduler Tests

- Duplicate scheduler occurrence.
- Multipleworkers claimonce.
- Crash/lease expiry/retry.
- Dead-letter.
- PerTenant fairness.
- Gracefulshutdown.

## 118. Provider Failure Tests

- DB unavailable.
- Storage unavailable.
- Email unavailable.
- Railway restart.
- Vercel/Admin unavailable.
- GitHub update channel unavailable.
- Partial webhook outage.

## 119. POS Release Tests

- Signature/checksum.
- Manifest compatibility.
- Upgrade withpending outbox.
- Local migration.
- Protocol N/N-1.
- Forcedminimum version.
- Failedupdate recovery.

## 120. Security Tests

- Environment secret isolation.
- CORS origins.
- TLS-only endpoints.
- Migration role notruntime.
- Preview noProduction secrets.
- Signed artifact validation.
- Support/deploy audit.

## 121. Performance Tests

- API instance concurrency.
- DB connection budget.
- Worker load vsAPI latency.
- Backfill throttling.
- HeavyTenant fairness.
- Startup/readiness duration.
- Queue lag underburst.

## 122. First-paid Rehearsal

- Provision production tenant.
- Runmigration.
- Activateentitlements.
- EnrollPOS.
- Execute sale/sync/report/document flow.
- Simulateprovider outage.
- Restore test.
- Rollback/forward-fix drill.

# القسم الثاني والعشرون — Open Decisions

## 123. OD-DEP-001 — Production Provider Continuity

**Baseline:** Railway/Vercel/Supabase remainpreferred forinitial production iftheir current plans meetvalidated requirements. Reassess atfirst-paid gate.

## 124. OD-DEP-002 — Worker Separation in Demo

**Baseline:** May consolidate forcost; code/runtime entrypoint remainsseparable. Production separates.

## 125. OD-DEP-003 — Staging Timing

**Baseline:** Mandatory beforefirstpaid launch. Until then CI/Preview/Demo arepartial substitutes only.

## 126. OD-DEP-004 — Distributed Queue

**Baseline:** PostgreSQL-backed durable jobs first. Managed queue onlywhenmeasured.

## 127. OD-DEP-005 — Redis

**Baseline:** Notrequired initially. Add fordistributed sessions/cache/rate limits onlywhenruntime topology requires.

## 128. OD-DEP-006 — Custom Domains

**Baseline:** Logical split `app`/`api`. Final domain/registrar/edge atproduction setup.

## 129. OD-DEP-007 — Supabase Connection Mode

**Baseline:** Runtime pooling anddirect migration connections, exactURLs/modes proven duringimplementation.

## 130. OD-DEP-008 — Backup/PITR Plan

**Baseline:** Decided inBackup andRecovery; production launch blockedwithoutverified solution.

## 131. OD-DEP-009 — Email Provider

**Baseline:** Adapter-based. Free/fake forDemo, verifiedproduction provider atlaunch.

## 132. OD-DEP-010 — Observability Provider

**Baseline:** Structured logs/metrics hooks now; exactplatform inMonitoring document.

## 133. OD-DEP-011 — API High Availability

**Baseline:** SingleinstanceDemo. Multi-instance production whenplan/capacity/SLO require; first-paid assessment mandatory.

## 134. OD-DEP-012 — POS Hosting

**Baseline:** GitHub Releases. Secure download facade optional later.

## 135. OD-DEP-013 — Infrastructure as Code

**Baseline:** Provider configuration documented/versioned first; formalIaC introducedwhenproduction topology stabilizes, withoutmanual undocumented drift.

## 136. OD-DEP-014 — Region

**Baseline:** Oneprimary region close toinitial customers/database. Multi-region deferred.

# القسم الثالث والعشرون — Prohibited Patterns

## 137. أنماطممنوعة

- Demo وProduction علىنفسDatabase.
- Production secrets فيPreview/PR.
- Frontend bundle تحتويsecret/service-role token.
- Migration عندكلAPI startup.
- Runtime DB role تنفذDDL.
- Destructive migration +contract code فينفسrelease.
- `down migration` تلقائيةعلىProduction.
- Application rollback بعدSchema incompatible دونتحقق.
- Worker work داخلHTTP request طويل.
- In-memory-only queue لعملحرج.
- Cron يفترضexactly-once دونidempotency.
- Unbounded autoscaling معDB pool ثابت.
- Health endpoint يكشفconfig/secrets.
- Liveness تفشللأيthird-party outage.
- Traffic قبلReadiness.
- Hard-coded Railway/API URL فيPOS/Admin.
- CORS wildcard معcredentials.
- UnsignedPOS installers/updates.
- POS downgrade يمسحlocal data.
- Preview تتصلProduction data تلقائيًا.
- Paid service تضافبلاقراروتكلفةوخطةخروج.
- Database/schema pertenant.
- Provider plan limits كـDomain constants.
- ManualProduction schema change خارجGit.
- Release ناجحةمعSmoke/migration failure.
- First paid tenant علىDemo shared credentials/data.

# القسم الرابع والعشرون — Implementation Readiness

## 138. Ready in WP-000/WP-001

- StabilizecurrentCI/deploy health.
- ATHR product/release identity.
- Removehard-coded URL.
- Validateenvironment config.
- RenamePOS artifacts/channels.
- Exposebuild/version health metadata.

## 139. Ready in Shared Foundation

- SeparateAPI/Worker/Migration entrypoints.
- Durable job/outbox interfaces.
- Typedconfig package.
- Provider/storage adapters.
- Compatibility/version contracts.
- Release metadata package.

## 140. Ready with Domain Work

- Deploybackward-compatible migrations.
- Tenant backfills.
- Workers/projections/sync.
- Notification/report/billing jobs.
- POS protocol rollout.

## 141. Ready in WP-026

- ConvertDemo infrastructure fullytoATHR.
- Production/staging configuration.
- Migration runner.
- Backup/restore rehearsal.
- Monitoring/readiness.
- Release/rollback runbooks.

## 142. Deferred

- Finalprovider plans/prices.
- Exactdomains.
- Exactmonitoring/queue/cache vendors.
- Multi-region/replicas.
- Dedicatedtenant deployments.
- Data warehouse.

# القسم الخامس والعشرون — Acceptance Gate

## 143. بوابةالاعتماد

لا تعتبرDeployment Architecture مكتملة قبل:

1. تثبيتEnvironment model والـpromotion flow.
2. تثبيتdeployment units والـentrypoints.
3. تثبيتمسؤولياتRailway/Vercel/Supabase/GitHub.
4. تثبيتdomains/TLS/CORS boundaries.
5. تثبيتconfiguration/secrets model.
6. تثبيتdatabase connection roles/budget.
7. تثبيتmigration architecture/release ordering.
8. تثبيتjobs/queues/scheduler model.
9. تثبيتhealth/readiness/shutdown.
10. تثبيتbackend/admin/POS release flows.
11. تثبيتcompatibility/zero-downtime principles.
12. تثبيتrollback/forward-fix boundaries.
13. تثبيتscaling/fairness/provider failure behavior.
14. تثبيتfirst-paid production gate.
15. تثبيتcost-aware transition.
16. تثبيتerrors/recovery/tests/open decisions/prohibited patterns.

## 144. القرار التخطيطي الحالي

- Railway API/Worker، Vercel Admin، Supabase PostgreSQL/Storage، GitHub POS releases.
- Demo الحاليةتبقىمجانيةقدرالإمكان ومفصولةعنProduction المستقبلية.
- API وWorker وMigration runner Entrypoints منفصلة.
- PostgreSQL-backed jobs قبلRedis/managed queue.
- Migrations تنفذمرةواحدة قبلpromotion، وليستعندstartup.
- Expand/backfill/constrain/contract هيالاستراتيجية.
- Admin Preview لا تصلProduction data.
- Production تستعملDatabase وأسرارًا مستقلة.
- POS releases موقعة وبقنواتInternal/Beta/Stable.
- Schema rollback تلقائي ممنوع؛ Forward-fix أوRestore مدروس.
- Staging وBackup/Restore rehearsal وMonitoring مطلوبةقبلأولPaid customer.
- لاخدمةمدفوعة قبلقرار، لكنأولإيراد يوجهأولًالموثوقيةوالـbackups والـmonitoring.

## 145. المرحلة التالية

**ATHR Backup and Recovery v1.0**

ستثبت:

- Data classes andbackup scope.
- PostgreSQL logical/physical/PITR strategy.
- Supabase backup capability validation.
- Object storage backup/versioning.
- POS local recovery andpending operations.
- RPO/RTO byservice anddata class.
- Restore runbooks andisolated rehearsal.
- Migration failure recovery.
- Tenant-level export/restore limitations.
- Encryption andbackup access.
- Corruption/ransomware/provider-loss scenarios.
- Evidence, approval andaudit.
- First-paid recovery gate.

بعدها: **ATHR Monitoring and Observability v1.0**.