# ATHR Multi-tenancy Blueprint v1.0

**Planning Baseline — Tenant Ownership, Context Propagation, Isolation Across Database, Jobs, Cache, Files, POS and Platform Operations**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة التصميم المعتمد لتحويلATHR مننظامBold أحاديالمؤسسة إلىSaaS متعددةالمستأجرين، وتثبت:

- تعريفTenant وحدودملكيةالبيانات.
- Organization وLegal Entity وLocation وWarehouse hierarchy.
- الفرق بينPlatform Identity وTenant Membership.
- كيفيةاستخراجTenant context والتحققمنه وتمريره.
- عزلالبيانات فيAPI وApplication وRepositories وPostgreSQL.
- Tenant-scoped IDs وUniqueness وForeign keys.
- عزلOutbox وJobs وEvents وSync وReporting.
- عزلCache وObject Storage وSigned URLs.
- ربطPOS والـDevices والـOffline data بـTenant واحدة.
- Platform support access وBreak-glass.
- Tenant provisioning وActivation وRestriction وClosure.
- Noisy-neighbor controls والـEntitlement limits.
- Observability وAudit وIncident containment.
- Migration منBold الحالي إلىInitial ATHR Tenant.
- بواباتالتنفيذ والاختبارات.

هذه الوثيقة لا تستبدلSecurity Blueprint؛ هيتثبتحدودالعزل والـcontext التي سيبنيعليهاAuthentication وAuthorization وSecrets وThreat controls.

## 2. القرار المعماري الرئيسي

### MT-DEC-001 — Shared Application, Shared PostgreSQL, Row-level Tenant Isolation

Baseline:

```
One ATHR application deployment
        ↓
One primary PostgreSQL database
        ↓
Tenant-owned rows carry tenant_id
        ↓
Application scope + composite constraints + optional RLS
```

لا نستخدمفيBaseline:

- Database per tenant.
- PostgreSQL schema per tenant.
- Table per tenant.
- Deployment per tenant.

الأسباب:

- أقلتكلفة وتشغيلًا قبلأولعميل.
- مناسبRailway/Supabase المجانيين للـDemo.
- أسهلفيالمهاجرات والـmonitoring والـsupport.
- يدعمإضافةالعملاء دونProvisioning بنيةمنفصلة.
- يحافظعلىإمكانيةفصلTenant كبيرةمستقبلًا عبرExport/migration contract.

### MT-DEC-002 — Tenant هيحدالملكية، وليستLocation

- Tenant تمثلعميلATHR المتعاقد والمالك لبياناته.
- Organization Profile تمثلالهويةالتجارية.
- Legal Entity تمثلالمسؤوليةالقانونية والمالية.
- Location تمثلموقعالتشغيل.
- Warehouse تمثلعهدةالمخزون.
- Terminal تمثلتثبيتPOS مسجلًا.

لا تستخدمLocation أوBranch أوRole كبديلعنTenant.

### MT-DEC-003 — Explicit Tenant Context Everywhere

لاCommand أوQuery أوJob أوEvent أوFile أوCache entry تخصعميلًا بدونTenant context صريحةوموثقة.

### MT-DEC-004 — Defense in Depth

عزلTenant لا يعتمدطبقةواحدة. المطلوب:

1. Authentication/session claims.
2. Membership andscope validation.
3. TenantContext داخلApplication.
4. Scoped repositories.
5. Tenant predicates فيSQL/Prisma.
6. Composite same-tenant foreign keys.
7. Tenant-scoped uniqueness.
8. Optional PostgreSQL RLS بعدProof.
9. Tenant-aware cache/storage/job keys.
10. Audit, telemetry andcross-tenant tests.

### MT-DEC-005 — Current Free Infrastructure Does Not Change the Model

- Railway/Vercel/Supabase الحالية تستخدمDemo ATHR.
- لا ندفعقبلأولمشترك.
- أولPaid activation تطلقInfrastructure upgrade milestone.
- نفسTenant model تستمرعندالترقية، دونإعادةتصميم.

# القسم الأول — Tenant and Organizational Hierarchy

## 3. Tenant

Tenant تحمل:

- stable tenant ID.
- lifecycle/access mode.
- organization profile reference.
- default locale/timezone/currency.
- subscription/entitlement reference.
- data region/residency metadata مستقبلًا.
- created/provisioned/activated/closed timestamps.

تغييرالاسم أوSlug لا يغيرTenant ID.

## 4. Organization Profile

بياناتالعرض والتواصل والعلامةالتجارية:

- trade/display name.
- logo/branding.
- public contacts.
- default business settings.

لا تمنحLogin أوOwnership.

## 5. Legal Entity

- المسؤولةعنالمستنداتالقانونية والضرائب والعقود.
- MVP يبدأLegal Entity واحدةأساسية لكلTenant.
- التصميم يسمحبأكثرمنLegal Entity مستقبلًا.
- المستندات تحفظLegal Entity snapshot.

## 6. Location

- موقعبيع أوتشغيل أوإدارة.
- لهTimezone وBusiness-day policy.
- قديرتبطبـLegal Entity.
- قديمتلكأكثرمنWarehouse أوTerminal.
- إغلاقه لا يحذفالمعاملات.

## 7. Warehouse

- مخزنمركزي أومرتبطLocation.
- هوحدInventory account/ownership.
- لا ينتقلبينTenants.
- نقلLocation/Warehouse بينLegal entities يحتاجMigration/Effective-date workflow.

## 8. Terminal and Device

- Device هوجهاز/تثبيت مسجل.
- Terminal هيهويةتشغيلPOS داخلTenant/Location.
- Device credential لا تمنحTenant access دونEnrollment/assignment صالح.
- Terminal assignment effective-dated.

## 9. Hierarchy Baseline

```
Tenant
├── Organization Profile
├── Primary Legal Entity
│   └── Locations
│       ├── Warehouses
│       └── Terminals
├── Memberships
├── Subscription / Entitlements
└── Tenant-owned operational data
```

Business Unit مؤجلةولا تستخدمفيالـMVP كطبقةإلزامية.

# القسم الثاني — Platform Identity and Membership

## 10. Platform Identity

هويةشخص عالميةداخلATHR:

- يمكنأنتملكMemberships فيTenants متعددة.
- Authentication methods والـsessions تخصالهويةالعالمية.
- لا تحملصلاحياتعميل مباشرة.

## 11. Membership

العلاقةبينIdentity وTenant:

```
identity_id + tenant_id → membership_id
```

تحمل:

- lifecycle status.
- role assignments.
- access scopes.
- invitation/activation history.
- display attributes داخلTenant عندالحاجة.
- effective dates.

## 12. Membership Independence

- تعليقMembership فيTenant A لا يغيرTenant B.
- تعطيلPlatform Identity أمنيًا قديلغيكلالجلسات.
- Role assignment لا تعبرTenants.
- Membership ID هيActor reference داخلعملياتTenant، وليسIdentity ID وحدها.

## 13. Tenant Selection

المستخدم متعددالعضويات:

1. Authentication تثبتIdentity.
2. النظام يعرضTenants ذاتMembership فعالة.
3. المستخدم يختارTenant أويستخدمآخرTenant آمن افتراضيًا.
4. Session/access token تحملSelected tenant +membership.
5. تغييرTenant يصدرContext/token جديدًا ويصفركلTenant-local UI/cache state.

لا يتمتغييرTenant بإرسالHeader عشوائي معToken لاتسمحبه.

## 14. Last Owner Safeguard

لا يمكن:

- تعطيلآخرOwner فعال.
- إزالةآخرOwnership assignment.
- إغلاقTenant دونOwnership/closure approval.

Ownership transfer Workflow مستقلة، Step-up وAudit.

# القسم الثالث — Tenant Resolution

## 15. Sources of Tenant Context

قديُستدلTenant من:

- Authenticated session/access token selected tenant.
- Tenant-specific route أوsubdomain كـhint فقط.
- Resource identity بعدLookup آمن.
- Device enrollment/terminal credential.
- Offline lease.
- Signed job/event envelope.
- Platform operator support grant.

## 16. Trusted Resolution Order

### Interactive API

```
Verified token/session
→ membership_id + selected tenant_id
→ optional route/subdomain must match
→ resource must belong to same tenant
```

### Device/POS API

```
Verified device credential
→ registered device
→ terminal assignment
→ tenant_id + location_id
→ offline lease/scope validation
```

### Background Job

```
Signed/durable job record
→ explicit tenant_id
→ service identity + job purpose
→ resource same-tenant validation
```

## 17. Untrusted Inputs

لا نثقمنفردًا في:

- `tenant_id` منrequest body.
- `X-Tenant-Id` header منClient.
- URL slug/subdomain.
- Location/branch ID.
- Local POS database value غيرموقع.
- Event payload قادممنخارجOutbox/verified integration.

تستخدمكـselection hint فقط وتطابقالمصدرالموثوق.

## 18. Tenant Slug and Domain

- Slug/custom domain ليسSecurity boundary.
- Slug unique platform-wide خلالفترةفعاليته.
- يمكنتغييره معredirect/reservation policy.
- Domain verified قبلالربط.
- Host resolution يجبأنتطابقSession tenant، وإلافشل `TENANT_CONTEXT_MISMATCH`.

## 19. Resource-derived Tenant

Routes مثل`/sales/{id}` لا تبحثعالميًا ثمترجعTenant owner. Query تكون:

```
WHERE tenant_id = current_tenant_id
  AND id = resource_id
```

لمنعكشفوجودResource فيTenant أخرى.

# القسم الرابع — TenantContext Contract

## 20. TenantContext Fields

الـApplication context المعتمد:

```
tenant_id
membership_id | service_principal_id
authenticated_identity_id
tenant_access_mode
entitlement_snapshot_version
permission_policy_version
scope_set
selected_location_id optional
selected_warehouse_id optional
terminal_id/device_id optional
support_grant_id optional
request_id
correlation_id
actor_type
```

## 21. Immutability

TenantContext immutable طوالCommand/Query واحدة.

- لا تتغيرفيمنتصفTransaction.
- إذااحتاجالمستخدمتغييرTenant يبدأRequest جديدة.
- Entitlement/permission revocation عاليةالأثر قدتتطلبRevalidation قبلcommit.

## 22. Context Creation

تنشأفيBoundary واحدة:

- HTTP guard/middleware +authorization resolver.
- WebSocket connection handshake معmessage-level revalidation.
- Job consumer envelope validator.
- CLI/admin task explicit scope.

لا تنشأعشوائيًا داخلService منDTO.

## 23. Context Propagation

تمررExplicitly أوعبرrequest-scoped mechanism مضبوطإلى:

- Application command/query handlers.
- Domain services where needed.
- Repositories.
- Transaction manager.
- Outbox/event metadata.
- Audit logger.
- Metrics/logging context.

Async context storage إنستخدمتلا تكونالوسيلةالوحيدة؛ الوظائفالحرجة تستقبلTenantContext صراحة.

## 24. Context Validation

عندبدايةكلCommand:

- Tenant lifecycle/access mode.
- Membership active/effective.
- Requiredpermission/scope.
- Entitlement.
- Device/terminal status عندPOS.
- Resource tenant ownership.
- Optionalapproval/step-up.

# القسم الخامس — API and Application Isolation

## 25. API Contract

- Tenant context لا تؤخذمنBody كمصدرحقيقة.
- Platform endpoints وTenant endpoints منفصلةNamespaces/guards.
- Response لا تكشفTenant IDs أخرى.
- Errors لعدموجودResource وCross-tenant access تتصرفكـnot found/forbidden وفقSecurity policy دونEnumeration.

## 26. Controllers

Controller:

- لا تستدعيPrisma مباشرة.
- تستخرجValidated TenantContext منGuard.
- لا تقبلbranch/tenant access logic فيUI فقط.
- تمررcontext إلىCommand/Query.

## 27. Application Services

- كلHandler يعلنهلهوPlatform-scoped أمTenant-scoped.
- Tenant-scoped handler بدونContext يفشلفوريًا.
- Cross-tenant workflow تحتاجنوعًا صريحًا وموافقة، مثلPlatform migration/export فقط.

## 28. Domain Services

- Domain entities تحملTenant ownership عندالحاجة.
- Aggregate لا تقبلChild/reference منTenant مختلفة.
- Domain rule لا تعتمدRole name، بلPermission/Policy result.

## 29. Repositories

واجهاتالمستودعاتTenant-scoped:

```
findById(context, id)
list(context, filters)
save(context, aggregate)
```

ممنوعBaseline:

```
findById(id)
findMany(filters_without_tenant)
```

إلاداخلPlatform/global repository مصنفةصراحة.

## 30. Raw SQL

- يجبتمريرTenant predicate.
- Query helper/linter/tests تمنعRaw SQL غيرمصنفة.
- Platform maintenance SQL منفصلة، audited، ولا تستخدمفيrequest path عادي.

# القسم السادس — Database Isolation

## 31. Tenant-owned Tables

كلجدول تشغيلي لعميل يحمل:

```
tenant_id uuid not null
```

حتىلوTenant قابلةللاستنتاج منLocation أوSale.

الفائدة:

- Query safety.
- Composite integrity.
- Efficient indexes.
- Easier export/partition/migration.
- Easierincident containment.

## 32. Same-tenant Composite Foreign Keys

النمطالمعتمد:

```
UNIQUE (tenant_id, id)
FOREIGN KEY (tenant_id, customer_id)
  REFERENCES customers (tenant_id, id)
```

يطبقعلى:

- Sale →Location/Customer/Shift.
- Inventory movement →Warehouse/Product.
- Transfer →Source/Destination warehouses.
- Membership role assignment →Membership/Role.
- Document →LegalEntity/Source.
- Device/Terminal assignments.

## 33. Tenant-scoped Uniqueness

أمثلة:

- `(tenant_id, sku)`.
- `(tenant_id, normalized_customer_phone)` حسبالسياسة.
- `(tenant_id, terminal_code)`.
- `(tenant_id, supplier_reference)`.
- `(tenant_id, legal_entity_id, document_type, document_number)`.
- `(tenant_id, client_operation_id, device_id)`.

## 34. Global Tables

الجداولالعالمية الحقيقيةفقط لا تحملTenant، مثل:

- Platform identities.
- Country/currency/UOM reference catalogs المشتركة عندتصنيفهاGlobal.
- Platform permission definitions.
- Provider registry metadata غيرالحساسة.

أيTenant override يخزنفيجدولTenant-owned منفصل.

## 35. Indexing

Tenant-owned indexes تبدأغالبًا بـ`tenant_id` ثمحقولالفلترة/الترتيب:

```
(tenant_id, business_date desc, id desc)
(tenant_id, status, created_at)
(tenant_id, warehouse_id, product_id)
```

لا نضيفtenant_id تلقائيًا فينهايةIndex بما يضعفselectivity/prefix use.

## 36. Query Plans and Statistics

- اختبارTenants صغيرةوكبيرة.
- منعPlan سيئة بسببSkew.
- Analyze/autovacuum monitoring.
- Partial indexes للحالاتالنشطة.
- Query limits لحمايةالـshared database.

# القسم السابع — PostgreSQL Row-Level Security

## 37. RLS Decision

Baseline:

- Application tenant enforcement +composite constraints إلزاميةمنالبداية.
- RLS دفاع إضافي مرغوب، لكنلا يفعلعشوائيًا قبلProof معPrisma وSupabase pooler والمعاملات.

## 38. RLS Proof Requirements

قبلالتفعيل:

1. تحديدconnection mode والـpooler behavior.
2. تعيينTenant context داخلTransaction (`SET LOCAL` أوequivalent آمن).
3. منعcontext leakage بينpooled connections.
4. اختبارinteractive transactions.
5. اختبارworkers/migrations/service roles.
6. اختبارPrisma query engine reconnect/retry.
7. اختبارSupabase direct وpooler URLs.
8. قياسperformance.
9. ضمانFail-closed عندغيابcontext.

## 39. RLS Policies

عنداعتمادها:

- Policies حسبtenant_id.
- Application role لا تملك`BYPASSRLS`.
- Owner/migration role منفصلة ولا تستخدمRuntime.
- Support access لا تستخدمGlobal bypass؛ تستخدمGrant/controlled function أوservice path audited.
- Audit/immutable tables قدتملكسياساتأشد.

## 40. RLS Limitations

RLS لا تستبدل:

- Authorization.
- Composite foreign keys.
- Tenant-aware caches/files/jobs.
- Application scope intersection.
- Provider/webhook verification.

# القسم الثامن — Transactions and Cross-context Work

## 41. Transaction Scope

كلTenant transaction تحملTenantContext واحدة.

- لا تخلطصفوفTenants مختلفة.
- Transaction manager يرفضcontext مختلفةداخلنفسUnit of Work.
- Platform maintenance batch يعالجTenant واحدةفيكلtransaction أوchunk واضح.

## 42. Cross-tenant Commands

ممنوعةفيBusiness operation العادي.

مسموحةفقطلـ:

- Platform migration.
- Approved tenant merge/split/import/export.
- Aggregated platform billing/health reporting دونكشفبيانات.
- Security incident response.

وتحتاج:

- Dedicated command type.
- Platform permission.
- Approval/step-up.
- Dry run/plan.
- Audit.
- Tenant-by-tenant execution.

## 43. Data Transfer Between Tenants

لا يتمبتغيير`tenant_id`.

المسار:

1. Export source snapshot.
2. Validateclassification/ownership/consent.
3. Transform andmap IDs.
4. Import intotarget withnewownership.
5. Reconcile totals.
6. Preserveaudit/evidence.
7. Keep source history perretention.

# القسم التاسع — Events, Outbox and Inbox Isolation

## 44. Event Envelope

كلTenant event تحمل:

- tenant_id.
- event ID/type/version.
- aggregate type/id/version.
- occurred/recorded time.
- actor/membership/service identity.
- correlation/causation IDs.
- data classification.

## 45. Outbox

- Outbox row تحملtenant_id.
- تكتبمعDomain transaction.
- Worker batch maymix tenants for efficiency، لكنprocessing context منفصللكلmessage.
- Retry/failure لا يمنعTenants أخرى.

## 46. Inbox

Dedupe key تشملconsumer +message ID، وtenant ownership تتحقققبلSide effect.

## 47. Event Handlers

- لا تثقtenant_id فيpayload دونOutbox/provider verification.
- Resource queries تستخدمEnvelope tenant +same-tenant check.
- Handler لا يقرأglobally باسمID فقط.

## 48. Platform Events

Platform-scoped event تصنفصراحةبـ`scope=platform` ولا تستخدمTenant-shaped envelope بقيمةnull غامضة.

# القسم العاشر — Background Jobs and Schedulers

## 49. Job Record

كلTenant job تحفظ:

- tenant_id.
- job type/version.
- source/resource reference.
- requested byactor/service.
- idempotency key.
- entitlement/policy snapshot reference عندالحاجة.
- state/attempts/not-before/expiry.

## 50. Job Execution

- Worker ينشئTenantContext خدمة محدودةالغرض.
- يعيدالتحققمنTenant access mode وresource ownership.
- لا يرثUser session منذاكرةprocess.
- Job logs/metrics تحملtenant tag/hash آمن.

## 51. Schedulers

Scheduler العالمي:

- يحددTenants المستحقة عبرPlatform-safe index.
- ينشئJobs مستقلةلكلTenant/period.
- لا ينفذBusiness mutations لكلTenants فيTransaction واحدة.

## 52. Fairness

- Per-tenant concurrency caps.
- Queue quotas/rate limits.
- Large export/rebuild jobs لا تجوعPOS/sales jobs.
- Priority classes.
- Backpressure.
- Dead-letter isolation.

## 53. Job Cancellation

Tenant suspension/closure قدتلغيأوتوقفJobs معينة، لكن:

- Financial reconciliation/retention/security jobs قدتستمر.
- Cancellation policy حسبjob type.
- لا تتركpartial side effects دونresume/reconciliation.

# القسم الحادي عشر — Cache Isolation

## 54. Cache Keys

كلTenant cache key تبدأبـnamespace/version/tenant:

```
athr:v1:tenant:{tenant_id}:...
```

وتضمحسبالحاجة:

- membership/scope.
- entitlement/policy version.
- locale/currency.
- resource/version.
- query/filter hash.

## 55. No Unscoped Cache

ممنوع:

```
product:{id}
permissions:{identity_id}
report:{filter_hash}
```

دونTenant/Scope حيثالبياناتTenant-owned.

## 56. Authorization Cache

Key تشمل:

- tenant_id.
- membership_id.
- role/policy/scope versions.
- entitlement snapshot version.

Revocation تنشرInvalidation أوتستخدمTTL قصيرة للقراراتالحساسة.

## 57. Local In-process Cache

- نفسالقواعد.
- لا Singleton mutable `currentTenant`.
- Tests لتسريبcontext بينrequests المتزامنة.

## 58. Redis

- ليسSource of truth.
- مؤجلحتىاحتياج مثبت/خطةمدفوعة.
- تصميمالـkeys الحالي يتيحإضافته دونتغييرDomain.

# القسم الثاني عشر — Object Storage and Files

## 59. Storage Ownership

كلFile object تحفظmetadata:

- tenant_id.
- owner context/resource.
- classification.
- checksum/size/content type.
- storage provider/key.
- retention/expiry/legal hold.
- created byactor.

## 60. Object Key Namespace

```
tenants/{tenant_id}/{context}/{resource_id}/{file_id}
```

- IDs opaque.
- لا تعتمدالأسماءالبشريةكحدعزل.
- Platform assets فيnamespace منفصل.

## 61. Upload

- Upload grant تصدرمنServer بعدAuthorization.
- Bound totenant, purpose, size, type, checksum andTTL.
- Client لا يختارObject key حرًا.
- Finalization تتحققأنالملف وصلالمسارالمتوقع.

## 62. Download and Signed Links

- Server يتحققTenant/Permission/Scope ثمينشئSigned URL قصيرةالعمر.
- Link purpose-bound عندالحساسية.
- لاPermanent public links للمستنداتوالـexports.
- CDN/cache لا تجعلملفTenant عامًا.

## 63. File Processing

Virus scan/thumbnail/PDF jobs تحملtenant_id وتكتبOutputs فينفسnamespace. لا تستخدمملفمنTenant كInput لـTenant أخرى.

## 64. Supabase Storage

يمكناستخدامSupabase Storage للـDemo، مع:

- Private buckets.
- Tenant-aware object paths.
- Server-mediated signed links.
- Storage RLS/Policies كدفاع إضافي بعداختبار.

# القسم الثالث عشر — Reporting and Analytics Isolation

## 65. Tenant Reports

- كلReport Run تحملtenant_id وscope.
- Aggregation تطبقTenant filter قبلأيGroup/Join.
- Drill-through يعيدAuthorization.
- Exports tenant-scoped ومؤقتة.

## 66. Platform Analytics

يجوزمقاييسمنصةمجملة مثل:

- active tenants.
- subscription states.
- API/sync health.
- aggregate usage.

لكن:

- لا تكشفPII أوBusiness details بلاPurpose/Permission.
- Dataset Platform-scoped مصنفةومدققة.
- Support dashboard لا تمنحفتحTenant data تلقائيًا.

## 67. Projection Rebuild

- Rebuild pertenant أوchunk.
- Checkpoints tenant-aware.
- Failure فيTenant لا يفسدالآخرين.
- Control totals تقارننفسTenant فقط.

# القسم الرابع عشر — Sync, POS and Offline Isolation

## 68. POS Installation Binding

Baseline:

> كلPOS installation تكونمسجلةومربوطةبـTenant واحدة وTerminal واحدةفيالوقت نفسه.
> 

السبب:

- يقللخطرخلطoffline data.
- يبسطlocal storage, receipt numbering andleases.
- يمنعoperator منتبديلTenant فوقPending outbox.

## 69. Tenant Switching on POS

لا يتمبـdropdown بسيط.

يتطلب:

1. لاPending operations غيرمحسومة، أوExport/recovery workflow.
2. Revoke old enrollment/lease.
3. Clear/rotate credentials.
4. Archive/wipe oldtenant projections بطريقةآمنة دونفقدevidence المطلوبة.
5. New enrollment totenant/terminal.
6. Bootstrap new snapshot.

## 70. Local Database

كلLocal row تحملحيثيلزم:

- tenant_id.
- terminal/device ID.
- client operation ID.
- source/snapshot version.

حتىلوinstallation single-tenant، لتقويةالمهاجرة ومنعخلطstate.

## 71. Local Database Files

Baseline يفضلملفمحلي منفصللكلinstallation/tenant binding، معmetadata واضحة. اسم`bold_pos.sqlite` يتحولإلىATHR naming، ولا يكونالاسمحدأمان.

## 72. Offline Lease

Lease تحمل:

- tenant_id.
- membership/terminal/device.
- location/warehouse scopes.
- capability/entitlement versions.
- expiry/limits.
- key version.

Server يرفضLease تخصTenant أخرى حتىلوالتوقيعصالح.

## 73. Sync Bootstrap

- Device credential تحددTenant.
- Client لا يطلبTenant أخرى.
- Snapshot manifest/datasets/cursors tenant-bound.
- Cursor opaque ولا تنقلبينTenants.

## 74. Client Operations

Dedupe scope:

```
tenant_id + device/installation_id + client_operation_id
```

Resource references تتحققSame tenant.

## 75. Conflicts and Resync

- Conflict record tenant-owned.
- Resync لا يمسحPending operations.
- Server never returns cross-tenant snapshot evenoninvalid cursor; it failsclosed.

# القسم الخامس عشر — Notifications and Integrations Isolation

## 76. Notifications

- Intent/request/template/preference/recipient/attempt تحملtenant_id عندTenant-owned.
- Platform security notification تصنفPlatform scope.
- Tenant branding/template لا تتسرب.
- Dedupe/rate limits pertenant.

## 77. Webhooks

- Endpoint belongs totenant.
- Secret andevent subscriptions tenant-scoped.
- Payload تحتويtenant-safe external references.
- Delivery worker validatesendpoint tenant.
- Tenant A لا يشتركفيEvents Tenant B.

## 78. External Provider References

Uniqueness:

```
(tenant_id, provider_namespace, external_reference)
```

إلاProvider global identity مقصودةوموثقة.

# القسم السادس عشر — Platform Support Access

## 79. No Standing Tenant Membership for Support

Platform operator لا يحصلتلقائيًا علىMembership داخلكلTenant.

## 80. Support Grant

الوصوليحتاجGrant تحمل:

- operator identity.
- tenant_id.
- purpose/ticket.
- permissions/scopes.
- start/expiry.
- approval.
- step-up evidence.
- read-only/mutation limits.
- reason.

## 81. Support Modes

### Metadata-only

يرىhealth/configuration غيرالحساسة.

### Read-only diagnostic

يرىبياناتمحدودةومخفية حسبScope.

### Assisted operation

Command محددةبموافقة، معAudit إضافي.

### Break-glass

لحادثأمني/تشغيلي حرج، وقتقصير، إشعارومراجعةإلزامية.

## 82. Impersonation

Baseline:

- لاImpersonation صامتة.
- UI تظهرأنالجلسةSupport.
- Actions تسجلoperator الحقيقي وeffective tenant/membership context.
- لا تستخدمكلمةمرورالعميل أوTokenه.
- Tenant owner notification حسبpolicy.

## 83. Data Masking

Support يرىافتراضيًا:

- Masked PII.
- No payment secrets.
- No unrestricted exports.
- Sensitive fields تحتاجPermission/approval إضافية.

## 84. Revocation

Support grant قابلةللإلغاءفوريًا، وتبطلSessions/tokens المرتبطة.

# القسم السابع عشر — Tenant Lifecycle and Provisioning

## 85. Provisioning States

```
Requested
→ Validating
→ Provisioning
→ ReadyForActivation
→ Active/Trial/InternalDemo
→ FailedNeedsRecovery
```

## 86. Provisioning Steps

1. CreateTenant idempotently.
2. CreateOrganization profile.
3. CreatePrimary Legal Entity.
4. CreateOwner Membership.
5. Publish/default Roles andpolicies.
6. ResolveDemo/Trial/Paid entitlement snapshot.
7. Optional Quick Setup Location/Warehouse.
8. Initialize numbering/settings versions.
9. EmitTenantProvisioned.
10. Verifyacceptance checklist.

## 87. Provisioning Failure

- Step-based andresumable.
- لا تنشئTenant مكررةعندRetry.
- Partial tenant access blocked حتىReady.
- Compensation لا تحذفEvidence عميانيًا.

## 88. Tenant Access Modes

- Provisioning.
- Internal Demo.
- Trial.
- Active.
- Payment Grace.
- Read-only.
- Restricted.
- Suspended.
- Closure Requested.
- Closed.
- Deletion Pending.

Billing وSecurity قدينتجانRestrictions مختلفة؛ Effective access mode تحسمPolicy بأشدالقيودالمطبقة معRecovery routes.

## 89. Suspension

- لا يحذفالبيانات.
- يمنعNew business mutations حسبالسبب.
- يسمحRecovery/export/support المصرح.
- Pending offline operations تقيموفقOffline/Billing/Security policy.

## 90. Closure

Workflow:

1. Ownership/authorization/step-up.
2. Resolve open financial/operational obligations.
3. Stop new operations.
4. Reconcile pending sync/jobs.
5. Generate tenant export where entitled/legal.
6. Revoke devices/integrations.
7. EnterClosed/retention mode.
8. Applyretention/legal holds.
9. Disposition/anonymization later.

## 91. Reopening

لا يتمبتغييرstatus فقط. يحتاج:

- Retention/data availability check.
- Subscription/entitlement.
- Security review.
- Membership/device/integration reactivation separately.

# القسم الثامن عشر — Entitlements and Limits

## 92. Tenant Limits

أمثلة:

- Maximum locations.
- Active terminals.
- Active memberships.
- Storage/export limits.
- Offline lease duration.
- Feature access.

## 93. Enforcement

كلإنشاءResource يتحقق:

```
Tenant active/access mode
AND entitlement permits feature
AND usage below hard limit
AND actor permission/scope
```

## 94. Limit Reduction

- لا يحذفResources موجودة.
- يمنعإنشاءجديدة عندHard limit.
- يسمحCritical completion/recovery حسبpolicy.
- يعرضusage/limit/remediation.

## 95. Noisy-neighbor Controls

Pertenant:

- API rate limits.
- Concurrent requests/jobs.
- Export/report limits.
- Sync batch sizes/frequency.
- Storage quotas.
- Notification limits.
- Query timeouts/date ranges.
- Worker fairness.

## 96. Isolation vs Billing

حدودالحمايةالتشغيلية قدتكونأقلمنEntitlement لمنعAbuse/outage، لكنيجبتمييز:

- Commercial limit.
- Safety rate limit.
- Temporary incident throttle.

# القسم التاسع عشر — Observability and Audit

## 97. Structured Logs

كلطلب/Job Tenant-scoped يسجل:

- request/correlation ID.
- tenant ID أوsafe hashed label.
- membership/service principal.
- route/operation.
- resource type/id masked asneeded.
- result/error code.
- latency.

لا تسجلبياناتحساسةأوSQL payload كاملًا.

## 98. Metrics

- Pertenant request/error/latency internally.
- Aggregate platform dashboards.
- High-cardinality tenant labels managed carefully.
- Tenant-facing health metrics scoped.

## 99. Traces

Tenant context propagation عبرAPI→DB→Outbox→Worker→Provider، معPII minimization.

## 100. Audit

Audit records تحمل:

- tenant_id أوplatform scope.
- real actor/effective actor.
- support grant.
- resource/action.
- before/after safe diff.
- request/correlation.
- outcome.

## 101. Cross-tenant Anomaly Detection

Alerts على:

- Query/result tenant mismatch.
- Missing tenant context.
- Cache key withouttenant namespace.
- File path tenant mismatch.
- Job/event envelope mismatch.
- Support access outsidegrant.
- RLS denial spikes.

# القسم العشرون — Error Contract

## 102. Tenant Resolution Errors

- `TENANT_CONTEXT_REQUIRED`
- `TENANT_CONTEXT_INVALID`
- `TENANT_CONTEXT_MISMATCH`
- `TENANT_NOT_FOUND`
- `TENANT_NOT_ACCESSIBLE`
- `TENANT_SELECTION_REQUIRED`
- `TENANT_DOMAIN_NOT_VERIFIED`

## 103. Membership and Scope Errors

- `TENANT_MEMBERSHIP_REQUIRED`
- `TENANT_MEMBERSHIP_INACTIVE`
- `TENANT_SCOPE_FORBIDDEN`
- `TENANT_LAST_OWNER_PROTECTED`
- `TENANT_OWNERSHIP_TRANSFER_REQUIRED`

## 104. Lifecycle and Limit Errors

- `TENANT_PROVISIONING_INCOMPLETE`
- `TENANT_READ_ONLY`
- `TENANT_RESTRICTED`
- `TENANT_SUSPENDED`
- `TENANT_CLOSED`
- `TENANT_LIMIT_REACHED`
- `TENANT_OPERATION_NOT_ALLOWED_IN_STATE`

## 105. Isolation Errors

- `CROSS_TENANT_REFERENCE_FORBIDDEN`
- `CROSS_TENANT_OPERATION_FORBIDDEN`
- `TENANT_RESOURCE_NOT_FOUND`
- `TENANT_STORAGE_SCOPE_MISMATCH`
- `TENANT_JOB_SCOPE_MISMATCH`
- `TENANT_EVENT_SCOPE_MISMATCH`

## 106. Support Errors

- `SUPPORT_GRANT_REQUIRED`
- `SUPPORT_GRANT_EXPIRED`
- `SUPPORT_GRANT_SCOPE_FORBIDDEN`
- `SUPPORT_STEP_UP_REQUIRED`
- `BREAK_GLASS_APPROVAL_REQUIRED`

# القسم الحادي والعشرون — Failure and Recovery

## 107. Missing Tenant Context

- Fail closed.
- لاQuery افتراضيةلكلTenants.
- Alert إذاحدثفيRuntime path مفترضTenant-scoped.

## 108. Context Mismatch

- Roll backtransaction.
- Return stable error/not-found policy.
- Security audit withrequest IDs.
- لا تكشفTenant الصحيحة للمهاجم.

## 109. Worker Processes Wrong Tenant

- Same-tenant guard قبلSide effect.
- Fail message/dead-letter.
- Contain affectedjob.
- Incident review إذاكانbug نظامي.

## 110. Cache Leakage Suspected

- Disable/flush affectednamespace.
- Fall backtoauthoritative DB.
- Revoke leakedsigned links إنوجدت.
- Incident audit andtenant notification حسبSecurity policy.

## 111. RLS Context Leakage

- Kill affectedpool/deployment.
- Fail closed.
- Rotateconnections/credentials عندالحاجة.
- DisableRLS integration path والرجوعلـapplication constraints فقطإذاكانذلكأكثرأمانًا مؤقتًا.

## 112. Tenant Provisioning Partial Failure

- Resume sameprovisioning process.
- Tenant remainsinaccessible.
- لا destructive reset تلقائيًا.

## 113. Closure Job Failure

- Tenant remainsrestricted/closure pending.
- Resume fromcheckpoint.
- Retention/legal hold respected.

# القسم الثاني والعشرون — Bold to ATHR Migration

## 114. Baseline Source

Bold الحالي:

- `Branch` أعلىنطاقتشغيلي.
- User يحملRole و`branch_id` اختياريًا.
- Products/Suppliers/Customers وبعضuniqueness عالمية.
- POS/Sync مرتبطانبـBranch/Device.

## 115. Initial Tenant Strategy

كلبياناتBold الحالية تتحولإلىTenant واحدة:

```
Initial ATHR Demo Tenant
```

- لا نحافظعلىBold كمنتج منفصل.
- IDs الحالية تبقىقدرالإمكان.
- Existing deployment/database يمكنتغييرهما علىفرعATHR وخطةcutover المعتمدة.

## 116. Migration Sequence

### MT-MIG-000 — Stable Base

- WP-000 gates خضراء.
- Negative-stock/accounting fixes محفوظة.

### MT-MIG-001 — Add Tenant Foundation

- CreateTenant/Organization/LegalEntity/Membership tables.
- Seed oneinitial tenant.
- Createprimary legal entity.

### MT-MIG-002 — Branch to Location

- كلBranch تصبحLocation داخلinitial tenant.
- Preserve branch IDs wherecompatible أوmapping evidence.
- Adddefault warehouse mapping.

### MT-MIG-003 — User to Identity and Membership

- Create/reusePlatform Identity لكلuser.
- CreateMembership داخلinitial tenant.
- Maplegacy role toATHR role/permission assignments.
- Preservepassword/session migration onlyifsecurity design approves؛ otherwise forced reset.

### MT-MIG-004 — Tenant Backfill

- Add nullabletenant_id first.
- Backfill frombranch/location/owner chain أوinitial tenant.
- Global master data assigninitial tenant.
- Fail migration onambiguous/unassigned rows.

### MT-MIG-005 — Application Dual Compatibility

- TenantContext introduced.
- Repositories scoped.
- Legacy branch routes adapttoLocation temporarily.
- No long-lived dual writes.

### MT-MIG-006 — Enforce Constraints

- tenant_id NOT NULL.
- Same-tenant composite FKs.
- Tenant-scoped uniques/indexes.
- Removeincorrect global unique constraints.

### MT-MIG-007 — POS Enrollment Cutover

- Existingdevice/terminal records assignedinitial tenant/location.
- Local database migration storesTenant/Terminal binding.
- Pending outbox preserved.
- New ATHR enrollment/bootstrap.

### MT-MIG-008 — Remove Legacy Root

- RemoveBranch-as-tenant assumptions.
- RemovefixedRole enum dependencies.
- Contract old columns/routes inlatermigration.

## 117. Migration Validation

- Every tenant-owned row assignedexactly oneTenant.
- No orphan/cross-tenant references.
- Counts andfinancial/inventory totals unchanged.
- POS pending operations preserved.
- Sync bootstrap doesnotcrossscope.
- Existingdemo users canaccesscorrectlocations only.
- Clean andpopulated upgrade gates pass.

## 118. Destructive Reset Policy

Destructive reset للـSupabase الحالية ليسBaseline.

مسموحفقطإذا:

- User/owner يصدرقرارًا صريحًا.
- البيئةDemo وليستعميلمدفوع.
- Export/backup/evidence المناسبةأخذت حسبالحاجة.
- Migration/reseed path موثقةومختبرة.

# القسم الثالث والعشرون — Testing Contract

## 119. Tenant Resolution Tests

- Selected tenant fromvalid session.
- Missing context failsclosed.
- Header/body mismatch.
- Slug/domain mismatch.
- Resource ID fromanother tenant.
- Multi-membership switching.
- Concurrent requests ononeidentity todifferent tenants.

## 120. Repository Tests

- Every tenant repository requirescontext.
- Query includes tenant predicate.
- Raw SQL guarded.
- Update/delete cannotaffectothertenant.
- Batch operation scoped.

## 121. Database Constraint Tests

- Cross-tenant FK rejected.
- Tenant-scoped unique works.
- SameID values permittedacrossTenant onlyifID strategy allows، معUUID global collision still improbable.
- RLS failclosed whenenabled.
- Pool connection context reset.

## 122. Authorization Tests

- Identity withoutmembership denied.
- Membership A doesnotgrantB.
- Location/warehouse scope intersection.
- Entitlement vspermission.
- Last owner protection.
- Suspended/read-only behavior.

## 123. POS and Offline Tests

- Device boundtooneTenant.
- WrongTenant lease rejected.
- Cursor/snapshot/client operation tenant-bound.
- Tenant switch blockedwithpendingoutbox.
- Local migration preservesoperations.
- Resync cannotreturnanotherTenant data.

## 124. Job/Event Tests

- Duplicate event.
- Wrongtenant envelope/resource mismatch.
- Worker concurrency fairness.
- Scheduler createsonejob pertenant.
- Tenant failure isolated.
- Dead-letter scoped.

## 125. Cache Tests

- Keys containTenant andpolicy versions.
- ConcurrentTenant requests nevercrossread.
- Invalidation scoped.
- No singleton currentTenant leakage.

## 126. Storage Tests

- Upload grant boundtoTenant.
- Path mismatch rejected.
- Signed URL scoped/expired.
- Processor output sameTenant.
- Cross-tenant file ID returnsnot found.

## 127. Support Access Tests

- No standing access.
- Grant expiry/scope.
- Step-up/approval.
- Impersonation banner/effective actor.
- PII masking.
- Break-glass audit/revocation.

## 128. Lifecycle Tests

- Idempotent provisioning.
- Partial failure/resume.
- Suspension/read-only/recovery.
- Closure/export/revocation.
- Reopen validation.

## 129. Migration Tests

- Realistic Bold dataset.
- Branch→Location mapping.
- User→Identity/Membership mapping.
- Tenant backfill completeness.
- Global uniqueness conversion.
- Financial/inventory invariant comparison.
- POS local upgrade.

## 130. Performance and Noisy-neighbor Tests

- LargeTenant +smallTenant concurrently.
- Heavy export doesnotblockPOS.
- PerTenant rate/job limits.
- Tenant-index query plans.
- RLS overhead ifenabled.
- Sharedpool connection behavior.

# القسم الرابع والعشرون — Open Decisions

## 131. OD-MT-001 — RLS Activation

**Baseline:** Application isolation +composite constraints first. RLS enabled onlyafterSupabase pooler/Prisma proof passes.

## 132. OD-MT-002 — Custom Domains

**Baseline:** Slug/subdomain laterforAdmin convenience، notsecurity boundary. Custom domains deferred.

## 133. OD-MT-003 — Multiple Legal Entities

**Baseline:** One primaryLegal Entity perTenant inMVP؛ schema supportsfuture expansion.

## 134. OD-MT-004 — POS Multi-tenant Installation

**Baseline:** OneTenant/Terminal perinstallation. Switching requiresre-enrollment andpending-operation resolution.

## 135. OD-MT-005 — Tenant Data Region

**Baseline:** Oneprimary region/provider initially. Region-aware metadata includedforfuture migration، notpromised pertenant now.

## 136. OD-MT-006 — Dedicated Tenant Deployment

**Baseline:** Not offeredinitially. PossiblefutureEnterprise isolation viaexport/migration contract.

## 137. OD-MT-007 — Support Notification

**Baseline:** Support access alwaysaudited؛ tenant-owner notification forhigh-risk/impersonation حسبSecurity policy.

## 138. OD-MT-008 — Cache Provider

**Baseline:** In-process/DB-backed first؛ Redis laterwhenneeded andpaid.

## 139. OD-MT-009 — Tenant Merge/Split

**Baseline:** Notgeneral self-service. Platform migration workflow only.

## 140. OD-MT-010 — Existing Password Migration

**Baseline:** Security Blueprint decides whetherhash format isretained safely orforced reset required.

## 141. OD-MT-011 — Demo Data Reset

**Baseline:** Forward migration preservescurrent data. Reset onlybyexplicit owner decision.

## 142. OD-MT-012 — Platform Aggregate Analytics

**Baseline:** Operational/SaaS aggregates allowed withminimization؛ no unrestrictedcross-tenant business browsing.

# القسم الخامس والعشرون — Prohibited Patterns

## 143. أنماطممنوعة

- `tenant_id` منBody/Header كمصدرحقيقةمنفرد.
- Query byID دونTenant predicate لبياناتTenant-owned.
- Repository unscoped تستخدمفيBusiness path.
- Global mutable `currentTenant` singleton.
- Cache key بلاTenant namespace.
- Object storage public/permanent Tenant files.
- Event/Job بلاTenant scope صريح.
- Background worker يستخدمآخرrequest context.
- Cross-tenant reference دونComposite guard.
- Global SKU/customer/document uniqueness بلاقرار.
- Role name كTenant isolation.
- Location/Branch كبديلعنTenant.
- Platform support لديهstanding admin membership لكلTenant.
- Impersonation صامتة.
- Support bypass عام غيرمؤقت.
- RLS كبديلعنAuthorization والـFKs.
- Runtime DB role تملكBYPASSRLS.
- Tenant switching علىPOS معPending outbox.
- تغييرtenant_id لنقلبيانات.
- Database/schema/table pertenant فيBaseline.
- Tenant-specific code fork/deployment.
- HeavyTenant job يستهلككلالـworkers.
- Tenant closure تحذفالتاريخفورًا.
- Billing suspension تمسحOffline operations.
- Demo/free infrastructure يفرضنموذجًا غيرProduction-ready.

# القسم السادس والعشرون — Implementation Readiness

## 144. Ready after WP-000 and WP-001

- ATHR naming/configuration.
- TenantContext interface.
- Platform vsTenant handler classification.
- Request/job/event metadata contracts.
- Cache/storage namespace helpers.

## 145. Ready in WP-002 Shared Foundation

- OpaqueTenantId/MembershipId.
- TenantContext factory/guards.
- Scoped repository interfaces.
- Cross-tenant error registry.
- Test utilities لإنشاءTenant contexts.

## 146. Ready in Tenant Database Work Packages

بعدالـShared Foundation والـmigration gates:

- Tenant/Organization/LegalEntity/Location/Membership expand migrations.
- Initial tenant seed/backfill.
- Tenant-scoped repositories.
- Composite keys/constraints.
- POS enrollment binding.

## 147. Deferred to Security Blueprint

- Authentication token exact claims/lifetimes.
- Password migration.
- MFA/step-up standards.
- Support break-glass approval detail.
- RLS runtime role/security implementation.
- Secrets/key management.
- Incident notification detail.

# القسم السابع والعشرون — Acceptance Gate

## 148. بوابةالاعتماد

لا يعتبرMulti-tenancy Blueprint مكتملًا قبل:

1. تثبيتTenant ownership boundary والـhierarchy.
2. تثبيتIdentity vsMembership.
3. تثبيتTenant resolution/trust order.
4. تثبيتTenantContext fields/lifecycle/propagation.
5. تثبيتAPI/Application/Repository isolation.
6. تثبيتDatabase tenant columns/FKs/uniqueness/indexes.
7. تثبيتRLS decision andproof gate.
8. تثبيتTransaction/event/job isolation.
9. تثبيتCache andObject Storage isolation.
10. تثبيتReporting/Sync/POS/Offline isolation.
11. تثبيتNotifications/Webhooks isolation.
12. تثبيتPlatform support andbreak-glass boundary.
13. تثبيتProvisioning/suspension/closure.
14. تثبيتEntitlement/noisy-neighbor controls.
15. تثبيتObservability/audit/errors/recovery.
16. تثبيتBold→Initial ATHR Tenant migration.
17. تثبيتtests/open decisions/prohibited patterns.

## 149. القرار التخطيطي الحالي

- Shared PostgreSQL، row-level tenant isolation.
- لاDatabase أوSchema أوDeployment pertenant فيBaseline.
- `tenant_id` صريحفيكلبياناتالعميل.
- Composite same-tenant FKs وtenant-scoped uniqueness إلزامية.
- TenantContext منمصدرموثوق وليستDTO.
- Platform Identity عالمية، Membership مستقلةلكلTenant.
- POS installation مرتبطةTenant/Terminal واحدة.
- Jobs/events/cache/files كلهاtenant-aware.
- Support access مؤقتومحددومدقق، دونstanding access.
- RLS مؤجلةحتىProof معPrisma/Supabase pooling.
- Current Bold data تتحولإلىInitial ATHR Demo Tenant.
- Railway/Supabase/Vercel المجانية تستمرللـDemo، والترقيةمعأولعميل لاتغيرالتصميم.

## 150. المرحلة التالية

**ATHR Security Blueprint v1.0**

سيثبت:

- Authentication architecture.
- Session andtoken model.
- Password hashing andmigration.
- MFA andstep-up authentication.
- Authorization enforcement lifecycle.
- Device credentials andkey rotation.
- Secrets management.
- Encryption intransit/atrest/application fields.
- CSRF, CORS, CSP andbrowser security.
- API abuse/rate limiting.
- Webhook/provider verification.
- Supply-chain anddependency security.
- Secure SDLC andCI gates.
- Threat model andincident response.
- Support/break-glass security.
- Data access, logging andPII controls.

بعده: **ATHR Deployment Architecture v1.0**.