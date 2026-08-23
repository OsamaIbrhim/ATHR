# Code Gap Analysis — 2026-07-29

# نطاق التقرير

Code Gap Analysis لمسار الكود فقط مقابل BOLD SaaS MASTER BLUEPRINT v1.0 والخطة التنفيذية النهائية داخل صفحة SaaS.

- التاريخ: 2026-07-29
- المستودع: bold_system
- الفرع المراجع: fix/p0-negative-stock-sync
- Commit: ba2af73ff35a5b4ad2c4ab9005d3a016f895fd22
- origin/master عند وقت المراجعة: 3b5a4996c6d095ff5b303fe4af7ac3c8f50a8a86
- حالة الفرع: متقدم 3 commits عن origin/master
- حالة Git: نظيفة
- لم يتم تعديل أي ملف أثناء التحليل

# نتائج التحقق

- Backend: 47 Test Suites و195 Test ناجحة.
- Backend TypeScript typecheck: ناجح.
- Admin: 11 Test Files و25 Test ناجحة.
- POS: 18 Test Files و69 Test ناجحة.
- بوابة test:soft المجمعة لم تكتمل في هذه المراجعة لأن Prisma generate لم يستطع استبدال Query Engine DLL المقفول من Process محلي يعمل.
- لم يتم اعتماد full build أو hard smoke في هذه المراجعة.
- تعطل Prisma المحلي هنا قيد بيئي، وليس Syntax Error أو Type Error مثبتًا.

# الحكم العام

الكود الحالي صالح كـOperational Core، لكنه ليس SaaS حتى الآن.

أقوى الأجزاء الحالية:

- Acceptance-first offline sales.
- Idempotency ومنع تكرار الفاتورة.
- Inventory movement وcost ledgers.
- POS outbox والمزامنة.
- Modular Monolith.
- Migration وCI gates كأساس جيد.

أكبر فجوة معمارية:

> النظام Single-tenant بالكامل، والـBranch هي أعلى مستوى للمؤسسة. لا يوجد Tenant أو Membership أو Subscription أو Platform authentication boundary.
> 

# Keep

- NestJS Modular Monolith.
- PostgreSQL وPrisma.
- تطبيق POS Electron وقاعدة SQLite والـOutbox.
- sync_id وterminal_sequence وcommand fingerprints.
- Acceptance-first price variance وnegative-stock warnings.
- InventoryMovement وInventoryCostMovement.
- Purchase receiving وsupplier returns وtransfer state machine.
- Refresh token rotation.
- POS enrollment وdevice credentials.
- Migration gate وhard smoke وadmin E2E وrelease gate.
- Customer Admin الحالي كأساس لـBold Control.
- Backend business modules الحالية بعد جعلها Tenant-aware.

# Modify

- كل Business Entity ليصبح Tenant-aware.
- Branch ليصبح Location تابعًا لـTenant، مع قرار معماري لاحق حول الاسم الفيزيائي داخل قاعدة البيانات.
- User.role وbranch_id إلى Global Identity + Tenant Membership + scoped roles.
- كل Identifier وUnique Constraint يُصنف أولًا عبر Identifier Classification Matrix؛ لا يوجد Tenant-scoping افتراضي عام.
- JWT وrequest context ليحملا membership وtenant context مشتقًا من الجلسة.
- POS Terminal ليحمل Tenant وLocation وTerminal Lease.
- Admin الحالي إلى Customer Control للمراقبة والإدارة، وليس Daily Warehouse Entry.
- Permissions لتكون Backend-owned بدل تكرار تعريفاتها في Backend وAdmin.
- Audit ليحمل Tenant وactor وapplication وrequest وreason وbefore/after.
- README لأنه ما زال يصف المشروع كنظام متجر واحد، ويحتوي وصفًا قديمًا لمسار إعادة تسعير البيع.
- كل cache key وjob وfile وexport ليكون Tenant-namespaced.
- عمليات المخزون لتستخدم command وledger surface موحدًا.

# Remove

الإزالة هنا تعني إزالة السلوك، وليس حذف Migration history.

- افتراض أن owner مستخدم عالمي للنظام كله.
- Global uniqueness لأرقام الفروع والعملاء والمنتجات والأجهزة والفواتير عندما تكون Business uniqueness مطلوبة داخل Tenant فقط.
- الثقة في branch_id أو tenant_id القادم من Request Body.
- Role checks المتفرقة داخل الخدمات لصالح authorization policy موحد.
- Daily purchasing/products/transfers mutations من Customer Control بعد تشغيل Warehouse Workspace.
- اعتبار docs/BOLD_FINAL_[ROADMAP.md](http://ROADMAP.md) مصدر الخطة الأعلى؛ يظل مرجعًا للـOperational Core فقط.
- أي Approval flow يعطل فاتورة مكتملة محليًا بسبب تغير تقني.
- أي direct stock mutation لا يمر من Ledger command موحد.
- Permission definitions المتكررة بين Backend وFrontend.
- أي SQL يدوي في Production كطريقة طبيعية لإصلاح حالة تشغيلية.

# Defer

- Microservices.
- Enterprise dedicated database أو deployment stamp حتى يصبح Shared SaaS مستقرًا.
- Marketing Website implementation حتى يكتمل الربط مع Billing وOnboarding.
- Egypt ETA integration حتى Stage 11.
- Internationalization حتى اختيار سوق ثان محدد.
- Advanced growth features خارج Gates المراحل الحالية.

# Build New

- Tenant وMembership foundation.
- Tenant/request execution context.
- Cashier وWarehouse وSupervisor Workspaces.
- Warehouse App/Workspace.
- Customer Control SaaS areas.
- Platform Owner Admin بحد أمان منفصل.
- Plans وPlanVersion وEntitlements وLimits وOverrides وUsage.
- Subscription وBilling lifecycle.
- Terminal Lease وOffline grace.
- Onboarding وProvisioning وImports.
- Support access leases.
- Queue/jobs/object storage foundations.
- Cross-tenant/security/recovery test suites.
- SaaS operational metrics and alerts.

---

# Stage 0A — Architecture Input Lock

## الحالة

In Progress، وهي Gate إلزامية قبل Stage 2.

## المطلوب للإغلاق

- [ ]  تثبيت أن **ATHR Operations** منتج واحد يحتوي Cashier Workspace وWarehouse Workspace وSupervisor Workspace.
- [ ]  اعتماد Product/Application boundaries؛ اختلاف Runtime بسبب Electron أوHardware لا ينشئ Product منفصلًا.
- [ ]  اعتماد Identifier Classification Matrix.
- [ ]  اعتماد Tenant/Data Ownership ADR.
- [ ]  اعتماد Identity/Membership ADR.
- [ ]  اعتماد Location/Warehouse ADR.
- [ ]  اعتماد Authorization/Entitlements ADR.
- [ ]  اعتماد Platform Boundary ADR.
- [ ]  اعتماد Migration/Backfill/Rollback Runbook.

## Gate

لا يبدأ أي Multi-tenancy code أوStage 2 migration قبل إغلاق Stage 1 وStage 0A واعتماد كل ADRs والـRunbook.

---

# Stage 0B — Market Validation

## الحالة

تعمل بالتوازي مع Stage 1 والمسار المعماري، ولا تعطل Stabilization.

## المطلوب للإغلاق

- [ ]  ICP وشرائح العملاء المستهدفة.
- [ ]  مقابلات السوق وتوثيق المشاكل المدفوعة.
- [ ]  Positioning وpricing assumptions.
- [ ]  Billing provider والقيود المحلية.
- [ ]  Hardware وsupport assumptions.
- [ ]  Pilot entry criteria وsuccess metrics.

## Gate

تُغلق قبل Plans/Billing/Pilot؛ أي نتيجة تغير Plan model أوBilling أوOnboarding تُعتمد في Notion قبل التنفيذ.

---

# Stage 1 — Stabilize Existing Core

## الحالة

In Progress.

## Keep

- Acceptance-first Sales v2.
- Immutable sale line snapshots.
- اختلاف سعر Cloud يتحول إلى PRICE_VARIANCE.
- Negative stock يتحول إلى Warning.
- Idempotent inventory movements.
- POS 1.4.0.
- Local outbox.
- Retry/backoff/quarantine.
- Migration/release gates.
- Terminal enrollment وheartbeat وrevocation.

## الفجوات

- إصلاحات P0 الحالية ما زالت على branch وليست في master.
- لم يتم إثبات Deploy وCanary وProduction observation بعد هذه commits.
- الفاتورة المعلقة على جهاز المحل ليست مسجلة كـResolved في المصدر المركزي.
- لا يوجد E2E حقيقي يجمع POS SQLite ثم API ثم PostgreSQL ثم lost acknowledgment ثم replay.
- README مخالف لبعض السلوك الحالي.
- Full build gate لم يُنفذ في هذه المراجعة بسبب Prisma DLL lock.
- Production migration state وproduction data behavior يحتاجان verification بعد النشر.

## Gate الإغلاق

- [ ]  Unblock Prisma بصورة جذرية مع Regression Test لسياسة توليد Prisma Client.
- [ ]  إضافة lint scripts لكل التطبيقات وRoot aggregator وCI gate إلزامية.
- [ ]  نجاح full typecheck وtests وbuild للـBackend وAdmin وPOS.
- [ ]  نجاح soft smoke وhard smoke كاملة.
- [ ]  نجاح E2E حقيقي من POS SQLite إلى API إلى PostgreSQL.
- [ ]  نجاح lost acknowledgment ثم replay مع إثبات فاتورة واحدة وحركة مخزون واحدة.
- [ ]  حل الفاتورة المعلقة على جهاز المحل والتحقق من نتيجتها في Cloud.
- [ ]  تحديث README وهذا التقرير بنتائج التنفيذ والمخاطر المتبقية.
- [ ]  Merge بعد كل Gates.
- [ ]  Deploy ثم Canary على جهاز واحد.
- [ ]  Production verification لبيع Online وبيع Offline ثم reconnect وreplay.
- [ ]  فترة Observation بلا data loss أوduplication أوstuck outbox.

لا تُعتبر Stage 1 مغلقة قبل اكتمال البنود كلها وتسجيل أدلتها هنا.

---

# Identifier Classification Matrix — Required Before Stage 2

لا يُطبق Tenant-scoped uniqueness بصورة عامة. التصنيف التالي هو Baseline معماري ويصبح نهائيًا عند اعتماد ADRs.

| Identifier | Classification | قاعدة التنفيذ |
| --- | --- | --- |
| Identity email | Globally unique | عند استخدامه كهوية Login بعد normalization؛ بريد العميل أو جهة الاتصال ليس Identity ويُصنف Tenant-scoped. |
| Identity phone | Globally unique | عند استخدامه كهوية Login بعد E.164 normalization؛ Customer phone داخل بيانات العمل Tenant-scoped. |
| SKU | Tenant-scoped | نفس SKU مسموح بين Tenants وممنوع تكراره داخل Tenant بحسب catalog policy. |
| Barcode | Tenant-scoped | القيمة القياسية قد تتكرر بين Tenants؛ lookup وconstraint داخل Tenant، مع فصل barcode type عند الحاجة. |
| invoice_number | Tenant-scoped | يُميز داخل Tenant وinvoice series؛ لا يعتمد Location scope افتراضيًا إلا بقرار محاسبي صريح. |
| sync_id | Globally unique | UUID أوULID يولده الجهاز لمنع replay والcollision عبر كل Tenants، مع tenant context داخل fingerprint. |
| device_id | Globally unique | هوية Installation أوHardware ولا يُعاد استخدامها بين Tenants. |
| terminal_code | Tenant-scoped | مقروء للبشر ويُمنع تكراره داخل Tenant؛ Location يبقى Scope للصلاحية وليس uniqueness الافتراضي. |

أي Identifier جديد يجب أن يُصنف كـGlobally unique أوTenant-scoped أوLocation-scoped أوUser-scoped قبل إضافة Constraint.

---

# Stage 2 Entry Gate — Mandatory ADRs

- [ ]  Tenant/Data Ownership ADR — Approved.
- [ ]  Identity/Membership ADR — Approved.
- [ ]  Location/Warehouse ADR — Approved.
- [ ]  Authorization/Entitlements ADR — Approved.
- [ ]  Platform Boundary ADR — Approved.
- [ ]  Migration/Backfill/Rollback Runbook — Approved and rehearsed on an isolated database.

Stage 2 محظورة حتى تكون Stage 1 = Done وStage 0A = Done وكل البنود أعلاه Approved.

---

# Stage 2 — SaaS Tenant Foundation

## الحالة

Not Started، وهي أكبر فجوة معمارية.

## الوضع الحالي

لا يوجد:

- Tenant.
- Membership.
- Tenant context.
- Cross-tenant constraints.
- Cross-tenant tests.
- Platform identity boundary.

Global constraints الحالية تشمل أمثلة مثل:

- Branch.code.
- [User.phone](http://User.phone) [وUser.email](http://وUser.email).
- Product.sku_base.
- ProductVariant.sku وbarcode.
- [Customer.phone](http://Customer.phone).
- PosTerminal.device_id وterminal_code.
- SalesInvoice.invoice_number وsync_id.

## Build New

- Global Identity منفصلة عن Tenant Membership.
- Tenant وTenantMembership.
- Membership roles.
- Location وWarehouse scopes.
- Tenant execution context مشتق من الجلسة أو terminal identity.
- Platform operator identity منفصلة.
- Tenant-aware data access layer.
- Composite foreign keys وconstraints تمنع cross-tenant references.
- Tenant-aware jobs/files/cache/exports.
- Support access contract مؤقت ومسجل.
- Cross-tenant tests لكل Endpoint حساس.

## Migration strategy

لا تبدأ هذه الاستراتيجية قبل اعتماد ADRs والـRunbook وإغلاق Stage 1 وStage 0A.

- Expand.
- Backfill إلى Tenant أولي.
- Validate.
- Add composite constraints.
- Enforce Tenant context.
- Contract أوcleanup لاحق فقط بعد إثبات عدم وجود readers قديمة.
- لا تعديل destructive في Migration واحدة.
- لا حذف Migration history.

## Gate

Tenant A لا يمكنه قراءة أو تعديل أو ربط أي سجل تابع لـTenant B، حتى مع IDs صحيحة مسربة من Tenant B.

---

# Stage 3 — Warehouse MVP

## الحالة

Backend جزئي، التطبيق غير موجود.

## الموجود

- Products وVariants.
- Barcode fields.
- Suppliers.
- Purchase receiving.
- Supplier returns.
- Transfers وpartial receiving.
- Cost accounting.
- Inventory history.

## الناقص

- Warehouse Workspace.
- Local drafts وoutbox للعمليات المخزنية.
- Labels.
- Barcode workflow كامل.
- Operational product entry بعيدًا عن Customer Admin.
- Idempotent Warehouse command envelope موحد.
- Role-scoped warehouse UX.
- Warehouse-specific diagnostics.
- Offline draft recovery.

## ATHR Operations — Product boundary

- **ATHR Operations منتج واحد** يحتوي Cashier Workspace وWarehouse Workspace وSupervisor Workspace.
- Cashier Workspace قد يستخدم Electron بسبب Offline وprinting وhardware.
- Warehouse وSupervisor يمكن أن يستخدما Web runtime أوRuntime مناسب للتشغيل.
- اختلاف Runtime لا يعني Product منفصلًا، ولا Entitlement catalog منفصلًا، ولا Business Logic مكررًا.
- Workspaces تشترك في product identity وnavigation model وdesign system وauth/API contracts.
- قواعد العمل والـinvariants تظل في Backend وتُستهلك من كل Workspaces.
- لا يوجد Product تجاري منفصل باسم Warehouse App؛ الموجود Workspace داخل ATHR Operations.

## Gate

متجر Pilot يستطيع إدخال المنتجات والبضاعة واستلامها وإرجاعها وبيعها دون استخدام Customer Control كواجهة إدخال مخزني يومي.

---

# Stage 4 — Inventory Integrity

## الحالة

Partial.

## الموجود

- Quantity ledger.
- Cost ledger.
- Purchase/return/transfer movements.
- Idempotency keys.
- Reconciliation read endpoints.
- Negative-stock accounting.
- Contract tests تحاول حصر stock writers.

## الناقص

- Stock count sessions.
- Stock count lines.
- Count freeze أوcutoff policy.
- Adjustment commands.
- Approval policy للتسويات الحساسة.
- Reconciliation cases.
- Recovery commands.
- Tenant/location-aware ledger.
- Alert lifecycle للرصيد السالب.
- Audit كامل لكل writer.
- Restore/rebuild verification من ledger.
- Operational UI للجرد والتسويات.

## Gate

أي كمية حالية يمكن إثباتها من opening balance + movements، وأي Repair يتم عبر Command مسجل وليس SQL يدوي.

---

# Stage 5 — Plans and Entitlements

## الحالة

Not Started.

## الوضع الحالي

النظام يحتوي Permissions فقط، وتعريفات الـcapabilities مكررة بين Backend وAdmin.

## Build New

- Plan.
- PlanVersion.
- Entitlement catalog.
- PlanEntitlement.
- PlanLimit.
- SubscriptionOverride.
- UsageRecord.
- Central entitlement evaluator.
- Transactional limit enforcement.
- Standard UPGRADE_REQUIRED response.
- Customer plan/usage UI.
- Immutable plan versions.
- Platform plan management.

## Separation rules

- Permission: هل المستخدم يستطيع تنفيذ العملية؟
- Entitlement: هل اشتراك Tenant يحتوي على الميزة؟
- Limit: كم موردًا أو استخدامًا مسموحًا؟
- لا يُخلط أي منها مع الآخر.

## Gate

تغيير Plan أو Limit أو Entitlement لا يحتاج Deploy ولا تعديل يدوي في قاعدة البيانات.

---

# Stage 6 — Subscription and Billing

## الحالة

Not Started.

## Build New

- Billing provider interface.
- Egypt provider adapter.
- Global provider-ready adapter.
- Subscription lifecycle.
- Checkout.
- Customer billing portal.
- Webhook inbox.
- Signature verification.
- Unique provider event ID.
- Idempotent webhook processing.
- Retry وdead-letter.
- Reconciliation job.
- BillingCustomer.
- BillingInvoice.
- BillingPayment.
- Upgrade/downgrade/cancel.
- Failed renewal recovery.

## Gate

يمكن بدء وتجديد وترقية وتخفيض وإلغاء اشتراك دون تعديل يدوي في قاعدة البيانات، ودون خلط BillingInvoice مع SalesInvoice.

---

# Stage 7 — POS SaaS Licensing

## الحالة

Device foundation موجود، Licensing غير موجود.

## Keep

- Enrollment.
- Device credentials.
- Heartbeat.
- Revocation.
- Update manifest.
- SHA-256 installer verification.

## Build وModify

- Tenant-aware terminal identity.
- Signed Terminal Lease.
- Plan وentitlements snapshot.
- Offline grace.
- Device limit enforcement.
- Safe restricted mode.
- Lease renewal.
- Expiry warnings.
- منع توقف Sale بدأت بالفعل بسبب Billing أوLease expiry.
- Release/update trust model أقوى للmanifest نفسه.

## Gate

فشل Billing أوالإنترنت لا يوقف عملية بيع آمنة، ولا يسمح باستخدام أجهزة غير مرخصة بلا حدود.

---

# Stage 8 — Customer Onboarding

## الحالة

Not Started.

Development/Production seed وManual enrollment لا يعتبران Onboarding.

## Build New

- Signup.
- Email/phone verification.
- Idempotent tenant provisioning.
- Trial creation.
- Setup wizard.
- Location وWarehouse creation.
- Product import jobs.
- User invitations.
- POS enrollment.
- Printer test.
- First-sale checklist.
- Activation tracking.
- Trial countdown.
- Lifecycle notifications.

## Gate

عميل جديد يصل لأول عملية بيع دون مطور أوتعديل يدوي في قاعدة البيانات.

---

# Stage 9 — Platform Admin and Operations

## الحالة

Not Started.

الـAdmin الحالي Customer Admin وليس Platform Admin.

## Build New

- تطبيق وحد أمان منفصل لفريق Bold.
- Tenant lifecycle.
- Plans.
- Subscriptions.
- Trials.
- Payments.
- Provisioning.
- Support access مؤقت ومسجل.
- Terminal health.
- Sync health.
- Incidents.
- Feature overrides.
- Usage.
- Exports.
- Suspension/reactivation.
- Offboarding.
- Backup/restore status.
- Operational audit.

## Gate

يمكن تشغيل عشرات العملاء دون الدخول المباشر لقاعدة البيانات.

---

# Customer Control Dashboard Gap

## Keep

- Dashboard foundation.
- Sales and invoice views.
- Inventory views.
- Purchasing and supplier visibility.
- Transfers visibility.
- Branches.
- Terminals.
- Users.
- Reports.

## Modify

- يصبح Tenant-scoped.
- إضافة Plan وusage وbilling وonboarding وalerts وsettings وintegrations.
- إضافة Location وWarehouse scope selection.
- عرض Audit وoperational health.
- صلاحياته تأتي من Backend membership context.

## Remove after Warehouse Gate

- Daily product creation.
- Daily purchase receiving.
- Supplier return posting.
- Transfer shipping/receiving.
- Daily stock adjustment.
- أي عملية تشغيل مخزني يفترض تنفيذها من Warehouse Workspace.

---

# Roles / Permissions / Scopes Gap

## Current

- User لديه Role واحدة.
- User مرتبط بـBranch واحدة أوglobal owner.
- Capabilities ثابتة داخل الكود.
- Per-user grants/revocations موجودة.
- Frontend يعيد تعريف جزء من Capability vocabulary.

## Required

- Global User Identity.
- Tenant Membership.
- Membership role assignments.
- Location/Warehouse scopes.
- Backend-owned permission catalog.
- Policy evaluator موحد.
- Entitlement evaluator منفصل.
- Platform role boundary منفصلة.
- Support access ليس Role دائمًا.
- Regression tests للـscope escalation.
- Default-deny لأي Route أوCommand جديد.

---

# Reliability Gap

## Keep

- Migration gate.
- Forward migration checks.
- Clean database and upgrade database paths.
- Hard smoke suites.
- Admin E2E smoke.
- POS/backend/admin test suites.
- Release gate.
- Request IDs.
- Friendly error contract.
- POS retry/backoff.

## Missing

- Lint scripts وlint CI gate.
- Full cross-tenant test matrix.
- Contract tests بين التطبيقات والـBackend.
- Real POS SQLite to API E2E.
- Crash/replay test after server commit.
- Queue/job reliability tests.
- Backup restore automation.
- Restore test status.
- Coverage thresholds for critical domains.
- Production synthetic checks.
- SLA/SLO definitions.
- Oldest outbox age monitoring.
- Alerting for duplicate prevention and negative stock.

---

# Security Gap

## موجود

- Default JWT guard.
- Short access tokens.
- Hashed rotating refresh tokens.
- Device enrollment and revocation.
- DTO whitelist and unknown-field rejection.
- CORS allowlist.
- Secret validation.
- Diagnostic redaction tests.
- npm audit.
- Optional Windows code signing configuration.

## ناقص

- Tenant isolation.
- Owner MFA.
- Login rate limiting.
- Account lockout.
- Login alerts.
- Security headers وHelmet.
- Production Swagger policy.
- Secret scanning.
- SAST.
- Dependency update automation.
- Cross-tenant authorization tests.
- Support access lease model.
- Retention/deletion workflow.
- Tenant-scoped export.
- Backup and restore testing.
- Signed Terminal Lease.
- Signed/trusted update manifest model.
- Central security audit taxonomy.

---

# Documentation Gap

- README يعرف المشروع كمنتج لمتجر واحد، وليس Specialty Retail SaaS.
- README يصف بعض سلوك السعر والمزامنة بصورة أقدم من الكود.
- docs/BOLD_FINAL_[ROADMAP.md](http://ROADMAP.md) يجب أن يصبح Operational Core reference فقط.
- صفحة Backend في Notion كانت فارغة وقت التحليل.
- لا توجد Architecture Decision Records لمسارات Tenancy وMembership وEntitlements وPlatform boundary.
- لا توجد Data migration runbook للانتقال إلى Multi-tenancy.
- لا توجد Workspace responsibility matrix في المستودع.

---

# ترتيب التنفيذ المعتمد

1. إغلاق Stage 1 بالكامل وإثباته في CI وCanary وProduction.
2. تحديث README وNotion وتسجيل أدلة الإغلاق.
3. إغلاق Stage 0A واعتماد Identifier Classification Matrix وكل ADRs والـRunbook.
4. Stage 2 Multi-tenancy foundation فقط بعد Gates السابقة.
5. Stage 3 ATHR Operations Workspaces وWarehouse MVP.
6. Stage 4 Inventory Integrity.
7. إغلاق Stage 0B قبل Plans/Billing/Pilot.
8. Stage 5 Plans وEntitlements.
9. Stage 6 Billing.
10. Stage 7 Terminal licensing.
11. Stage 8 Onboarding.
12. Stage 9 Platform Operations.

Stage 0B تعمل بالتوازي، لكنها Gate إلزامية قبل Plans/Billing/Pilot.

# القرار النهائي للتنفيذ

- Stage 1 فقط هي المسموح تنفيذها الآن.
- لا يبدأ Refactor كبير أوMulti-tenancy code قبل إغلاق Stage 1.
- لا يبدأ Stage 2 قبل Stage 1 = Done وStage 0A = Done واعتماد Identifier Classification Matrix وكل ADRs والـRunbook.
- Stage 0B تعمل بالتوازي وتُغلق قبل Plans/Billing/Pilot.
- كل Stage تقسم إلى PRs صغيرة قابلة للمراجعة.
- كل Bug Fix يبدأ بـRoot Cause ويضيف Regression Test.
- كل تغيير مؤثر يحدث README وNotion في نفس المهمة.
- لا PR قبل lint وtypecheck وtests وbuild وsmoke/contract gates المرتبطة.
- أي تغيير في migrations أوsync أوpermissions أوbilling أوinventory يحتاج failure وidempotency وregression tests.
- أي قرار معماري جديد يُسجل تحت صفحة SaaS قبل اعتباره معتمدًا.

[WP-002 Delivery Summary](WP-002%20Delivery%20Summary%203adf9447e5ca80c59202d0174f99c168.md)