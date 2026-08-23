# ATHR SaaS

# ATHR Stage 1 Reliability Closure — Execution Plan v1.0

الحالة: **Approved — Current Execution Priority**

## 1. نتيجة المرحلة

Stage 1 لا تنتهي عند إصلاح آخر Error ظاهر؛ تنتهي عندما يمكن إثبات المسار التالي باستمرار:

```
قاعدة نظيفة أوقديمة
→ migrations آمنة
→ seed معزول
→ backend يعمل
→ POS يسجل بيعًا Online وOffline
→ SQLite تحفظ Outbox
→ API تستقبل Idempotently
→ PostgreSQL تسجل مرة واحدة
→ المخزون يتحرك مرة واحدة
→ الطباعة والمزامنة والحالة واضحة
→ deploy Canary
→ production verification
→ rollback مجرب
```

النتيجة المطلوبة:

- لا Data loss.
- لا Duplicate financial أوinventory effects.
- لا تعديل يدوي في قاعدة البيانات لتشغيل النظام.
- لا Test يعتمد على أسرار أوبقايا بيانات محلية.
- لا نجاح شكلي بينما Full path غير مجرب.

## 2. قواعد التنفيذ

- فرع Stage 1 مخصص، وتُدمج التغييرات على دفعات صغيرة قابلة للمراجعة.
- لا تبدأ Multi-tenancy أوStage 2 migrations.
- لا إعادة تصميم واسعة للواجهات أثناء إغلاق Reliability.
- كل Fix يحصل على Regression test قبل اعتباره Done.
- لا تعديل Migration مطبقة في Production إلا وفق Runbook موثق؛ الإصلاح يكون Forward migration أوقرار Rollback/replace واضحًا حسب الحالة.
- لا تستخدم Production database لتشغيل seed أوHard tests.
- كل Command في CI يجب أن يعمل بالطريقة نفسها محليًا على بيئة معزولة.
- Windows وLinux كلاهما بيئتا دعم لأن الأعطال السابقة ظهرت باختلاف واضح بينهما.

## 3. Workstreams وترتيبها

```
W0 — Baseline and Environment Control
W1 — Prisma and Migration Recovery
W2 — Safe Seed and Test Identity
W3 — Soft Test Closure
W4 — Sync and Invoice Correctness
W5 — POS Electron Operational Closure
W6 — Hard Performance and Resilience
W7 — Build, Packaging and Deployment
W8 — Canary and Production Verification
```

W0 وW1 يبدأان أولًا. W4 وW5 يمكن أن يتحركا بعد استقرار Prisma وTest database. W8 لا يبدأ قبل إغلاق كل الـgates السابقة.

## 4. W0 — Baseline and Environment Control

### الهدف

إزالة الغموض حول ما يفشل بسبب الكود وما يفشل بسبب Process أوEnvironment.

### المهام

- توثيق Node وnpm وPrisma وPostgreSQL versions المعتمدة.
- تثبيت Node version في ملف المشروع وCI.
- توحيد package manager وlockfile.
- إضافة command واحد لعرض Diagnostic summary بدون أسرار.
- تحديد Processes التي تقفل Prisma Query Engine على Windows.
- قبل `prisma generate`:
    - إيقاف dev servers وtest workers المرتبطة بالمشروع.
    - التأكد من عدم وجود Prisma Client process قديم.
    - تنظيف generated client بطريقة آمنة.
- منع تشغيل test suites متوازية على نفس database/schema.
- إنشاء أسماء واضحة للبيئات:
    - local-development.
    - local-test.
    - CI-test.
    - performance-test.
    - staging.
    - production.
- توثيق Environment variable contract مع Required وOptional وTest-only flags.

### Deliverables

- `docs/runbooks/environment.md` أوالمسار القياسي داخل المشروع.
- Script Bash موحد لفحص البيئة.
- CI preflight يعرض versions ويخفي secrets.
- Error واضح عند محاولة Test على Database غير مصرح بها.

### Gate

- `prisma generate` ينجح بعد Fresh clone على Windows وLinux.
- لا توجد Query Engine DLL lock متكررة بعد اتباع الـrunbook.
- Test database URL تختلف صراحة عن Development وProduction URLs.

## 5. W1 — Prisma and Migration Recovery

### المشكلات المعروفة

- Failed migration: `202607230002_transfer_state_machine`.
- PostgreSQL error `55006` في محاولة تطبيق migration.
- Shadow database failure لأن `gin_trgm_ops` غير متاحة.
- Contract test يبحث عن ترتيب migration ولا يجد marker المتوقع.
- Migration history وواقع قاعدة البيانات يحتاجان Reconciliation بدل محاولات متفرقة.

### مسار الإصلاح

#### 5.1 Inventory

تسجيل جدول لكل Migration يتضمن:

- الاسم.
- الغرض.
- dependency السابقة واللاحقة.
- هل طُبقت محليًا؟
- هل طُبقت في Remote development؟
- هل فشلت؟
- هل تم `resolve --rolled-back` أو`--applied`؟
- هل تحتوي destructive operation؟
- هل تحتاج extension؟

#### 5.2 `pg_trgm`

- إضافة Forward migration آمنة تنشئ `pg_trgm` باستخدام `CREATE EXTENSION IF NOT EXISTS pg_trgm` قبل أي index يستخدم `gin_trgm_ops`.
- التأكد أن مستخدم migration يملك القدرة المطلوبة في البيئات المستهدفة.
- إذا كانت بعض البيئات لا تسمح بإنشاء extension، يفشل Preflight برسالة واضحة قبل تنفيذ باقي migration.
- Shadow database يجب أن تحصل على نفس prerequisite تلقائيًا، لا إعداد يدوي من المطور.
- إضافة Regression test يفحص ترتيب extension قبل indexes.

#### 5.3 Transfer state machine

- مراجعة SQL الخاص بـ`202607230002_transfer_state_machine` كسلسلة حالات فعلية:
    - draft.
    - approved.
    - shipped.
    - received/partially received.
    - cancelled وفق القواعد.
- تثبيت immutable lines بعد approval.
- duplicate receipt protection.
- partial receipt وdiscrepancy behavior.
- مراجعة legacy trigger removal وbackfill وconstraints بالترتيب الصحيح.
- إصلاح `transfers/transfer-state-contract.spec.ts` ليختبر Contract دلالي ثابت، لا offsets هشة أوبحثًا يمكن أن يعيد `-1` بلا تفسير.
- عند غياب marker، يظهر الاختبار اسم الملف والمقطع المطلوب بوضوح.

#### 5.4 Recovery strategy

- لا نكرر `migrate resolve` بلا Evidence.
- لكل قاعدة متأثرة، نحدد واحدة من:
    - Apply forward fix.
    - Mark rolled back ثم re-apply بعد تنظيف جزئي موثق.
    - Replace isolated development DB عندما لا توجد بيانات مطلوبة، وفق قرار المستخدم السابق.
- Production strategy منفصلة ولا تفترض أن Development state يطابقها.

### اختبارات Migration

- Fresh database migration.
- Migration من snapshot قبل transfer state machine.
- Shadow database validation.
- Idempotent preflight للـextensions.
- Schema diff بدون drift غير متوقع.
- Transfer backfill verification ببيانات legacy.
- Constraint verification بعد backfill.
- Rollback/restore rehearsal من Backup أوsnapshot معزولة.

### Gate

- `prisma migrate deploy` ينجح على Fresh DB.
- ينجح على نسخة Upgrade fixture.
- `prisma migrate dev` أوالـvalidation المعتمد لا يفشل بسبب Shadow DB.
- لا migration في failed state.
- لا schema drift غير مفسر.
- Transfer contract test خضراء وتفشل برسالة مفهومة عند كسر الترتيب عمدًا.

## 6. W2 — Safe Seed and Test Identity

### الهدف

منع Seed destructive أوLogin failures المتكررة في CI.

### المشكلات المعروفة

- Seed يتطلب flags خطرة:
    - `ALLOW_DEVELOPMENT_ACCOUNTING_RESET=reset-development-accounting`.
    - `ALLOW_REMOTE_DEVELOPMENT_ACCOUNTING_RESET=1`.
- CI فشل بـ`LOGIN_INVALID` لأن بيانات الدخول والـseed لم تكن Contract واحدة.
- Local seed واجه `Transaction not found` أثناء reset.

### التصميم المعتمد

فصل واضح بين:

- `seed:reference`: بيانات مرجعية غير مدمرة.
- `seed:test`: بيانات deterministic لقاعدة Test معزولة.
- `seed:demo`: Demo dataset.
- `reset:development`: أمر صريح وخطر، لا يُستدعى ضمن test commands.

### المهام

- إضافة Test database fingerprint guard يفحص:
    - اسم قاعدة البيانات أوschema.
    - Environment marker.
    - منع production/staging hosts.
- CI ينشئ Test identity ثابتة من Config واحدة.
- Hard وSoft tests تقرأ نفس Credentials من test fixture، لا YAML values موزعة.
- Login test ينشئ أويتحقق من المستخدم قبل البدء.
- إصلاح reset transaction بحيث لا يعتمد على transaction انتهت أوخرجت من scope.
- جعل seed قابلة لإعادة التشغيل دون duplicates.
- عدم طباعة passwords أوtokens في logs.

### Gate

- `npm run prisma:seed:test` ينجح مرتين متتاليتين.
- يفشل عمدًا على Production-like URL قبل أي Delete.
- Soft وHard suites تسجل الدخول بنفس Fixture.
- لا `LOGIN_INVALID` بسبب Drift بين seed وCI.

## 7. W3 — Soft Test Closure

### الهدف

بوابة correctness سريعة تكتشف كسر Contracts الأساسية قبل Hard tests.

### التغطية المطلوبة

- Migration contracts.
- Authentication وauthorization basics.
- Product list default pagination: 20 عنصرًا بدون Search.
- Search behavior.
- Invoice creation validation.
- Sale stock movement.
- Transfer state transitions.
- Duplicate receipt prevention.
- Return quantity fraud protection.
- Shift linking.
- Sync cursor contracts.
- Error envelope وrequest IDs.

### قواعد الاختبار

- لا تعتمد على ترتيب ملفات هش إلا عندما يكون الترتيب Business requirement، وحينها يُشرح في Assertion.
- لا تعتمد على Remote shared data.
- كل Test تنشئ بياناتها أوتستخدم Fixture معزولة.
- تنظيف البيانات يتم ضمن Test scope، وليس Reset شاملًا خطيرًا.
- Failure message يذكر Business invariant.

### Command gate

```bash
npm run test:soft
```

يجب أن:

- يبدأ من Test preflight.
- ينشئ أويفحص Fixtures.
- يشغل كل suites.
- يخرج non-zero عند أي Skip غير مصرح به أوFailure.
- ينشر Summary بعدد الاختبارات والمدة.

### Gate

- 3 تشغيلات متتالية خضراء محليًا.
- 3 تشغيلات متتالية خضراء في CI.
- لا flaky retry يخفي Failure حقيقية.

## 8. W4 — Sync and Invoice Correctness

### الهدف

إثبات أن البيع والمزامنة والمخزون يعملان Exactly-once من منظور الأثر المالي والمخزني.

### المسار المرجعي

```
POS creates local sale
→ local invoice and lines committed atomically
→ Outbox event created in same local transaction
→ push request carries stable sync_id/idempotency key
→ API authenticates terminal and shift
→ server transaction creates orreturns existing sale
→ inventory movement recorded once
→ response acknowledges server identity and cursor
→ POS marks Outbox acknowledged
```

### Invariants

- إعادة نفس Request لا تنشئ Invoice ثانية.
- إعادة نفس Request لا تخصم Stock مرة ثانية.
- Failure قبل Server commit تسمح بالمحاولة.
- Failure بعد Server commit وقبل Response تُحل عبر Idempotency.
- POS لا تعرض “فشل البيع” إذا كان البيع محفوظًا محليًا.
- Pending invoice لا تُعاد يدويًا كفاتورة جديدة.
- Sync pull لا تعيد نفس العناصر بلا Cursor logic واضح.
- Invoice وstock movement وpayment records تتفق أوتُسجل حالة pending صريحة.

### الاختبارات المطلوبة

- Online sale happy path.
- Offline sale ثم reconnect.
- Duplicate push بنفس key.
- Timeout بعد Server commit.
- POS restart قبل acknowledgement.
- Multiple retries.
- Concurrent duplicate requests.
- Pending invoice recovery.
- Sync pull initial snapshot.
- Cursor resume.
- Invoice pulled إلى POS أوالمسار المعتمد لعرضها.
- Stock decrement verification في PostgreSQL.
- Local SQLite state verification.

### E2E إلزامي

اختبار Black-box نسبيًا يشغل:

- POS local database fixture.
- Backend حقيقي.
- PostgreSQL test database.
- Sale command.
- Network interruption simulation.
- Reconnect وsync.
- Assertions على SQLite وAPI وPostgreSQL.

### Gate

- كل السيناريوهات خضراء.
- لا duplicate invoice أوmovement تحت retries.
- Pending invoice لها UI state وRecovery path.
- كل Failure تعرض للمستخدم ما تم حفظه وما الخطوة التالية.

## 9. W5 — POS Electron Operational Closure

### الهدف

جعل POS قابلة للتشغيل في متجر، لا مجرد واجهة Demo.

### Login وEnrollment

- Terminal enrollment واضح وآمن.
- Login حقيقي للمستخدم.
- Tenant/Location/Terminal context محفوظ ومُعرض.
- Session expiry وre-login behavior واضحان.
- لا Credentials hardcoded.

### Shift

- فتح وردية.
- منع البيع عندما تتطلب القاعدة وردية مفتوحة.
- إغلاق وردية.
- ربط البيع والمرتجع بالوردية.
- Recovery بعد Crash.

### Product list

- تعرض أول 20 منتجًا افتراضيًا.
- Pagination أوinfinite load منضبط.
- Search سريع ويعيد الحالة الفارغة بوضوح.
- لا تبقى القائمة فارغة حتى يكتب المستخدم.

### Status UX

- Online/offline.
- Last successful sync.
- Pending operation count.
- Failed operation count.
- Terminal identity.
- حالة واضحة لا تعتمد على نقطة ملونة فقط.

### Errors

الصيغة:

```
ماذا حدث
ما الذي تم حفظه
ما الذي لا يجب فعله
ما الخطوة التالية
Reference ID عند الحاجة
```

### Printing

- Arabic receipt.
- English receipt.
- Bilingual receipt عند اعتماده.
- Thermal widths المستهدفة.
- Font fallback لا ينتج مربعات أوصفحات غير صحيحة.
- Preview وreal printer smoke test.
- Reprint لا يغير البيانات أوينشئ Invoice.

### Packaging

- Installer قابل للتكرار.
- App data path موثق.
- Update channel.
- Logs وdiagnostics export.
- Version visible.
- Uninstall لا يحذف بيانات pending بلا تحذير أوسياسة.

### Gate

- Cashier جديد يكمل login وshift وsale وprint بدون مساعدة مطور.
- Offline status مفهومة.
- Restart لا يفقد pending sale.
- Printing مقبولة على Hardware فعلي مستهدف.

## 10. W6 — Hard Performance and Resilience

### الهدف

تحويل Hard suite إلى قياس ثابت، لا Test يتأثر بCold DB أوNetwork عشوائي بلا تفسير.

### مستويات الاختبار

#### Smoke

```bash
npm run test:hard:smoke
```

- Dataset preflight.
- Auth.
- Products page 1 وdeep page.
- Sales listing.
- Sync pull initial snapshot.
- Requests قليلة وسريعة في كل PR أوGate مهم.

#### Full

```bash
npm run test:hard
```

- Concurrency أعلى.
- Requests أكثر.
- Read/write mix.
- Sync workload.
- Error rate.
- Server timing وclient timing.
- Memory/CPU عند توفر instrumentation.

### تحسينات مطلوبة

- فصل DB connection latency عنAPI processing latency.
- Warmup محدد ومسجل.
- Dataset size داخل التقرير.
- عدم مقارنة Windows remote database مباشرة بـLinux local/nearby database دون Context.
- Threshold profiles حسب Environment، مع Production target واحد واضح.
- Payment requests في الاختبار تُعد وتظهر صراحة في Summary بدل الغموض.
- كل endpoint يعلن request count وconcurrency.
- حفظ Baseline artifact ومقارنة regression.

### Targets الأولية

- Error rate أقل أويساوي `0.5%` في Full suite، و`0%` في Smoke الصغير ما لم يكن Fault injection.
- Read p95 target الأساسي أقل أويساوي `1000ms` في البيئة المحلية البطيئة الحالية، مع Target تشغيلي أكثر صرامة في Staging.
- لا يعتمد النجاح على رفع timeout فقط.
- Sync pull 500 يعتبر Gate blocker حتى يُفهم سببه ويُضاف Regression test.

### Resilience scenarios

- DB transient failure.
- API restart.
- Duplicate client retries.
- Slow query.
- Expired auth.
- Network interruption.
- Large product pages.
- Outbox backlog.

### Gate

- Smoke مستقرة في CI.
- Full suite تصدر تقريرًا قابلًا للمقارنة.
- لا 500 غير مفسرة.
- Regression threshold يفشل البناء عند تدهور حقيقي.

## 11. W7 — Build, Packaging and Deployment

### Build gate

- Prisma generate.
- Typecheck.
- Lint.
- Backend build.
- Web build عند ارتباطه بالمسارات الحالية.
- POS Electron build/package.
- Soft tests.
- Hard smoke.
- E2E sync.

### CI structure

```
preflight
→ install locked dependencies
→ prisma generate
→ isolated database provision
→ migrate deploy
→ seed:test
→ soft tests
→ build
→ E2E
→ hard smoke
→ package artifacts
```

### Release artifacts

- Backend artifact أوcontainer immutable.
- POS installer versioned.
- Checksums.
- Migration list.
- Release notes.
- Known issues.
- Rollback instructions.

### Deployment

- Staging أولًا.
- Migration preflight.
- Backup/snapshot وفق البيئة.
- Deploy backend.
- Smoke verification.
- Canary terminal أوtenant.
- Observe.
- Expand.

### Gate

- Fresh CI run من Commit نظيف.
- Artifacts مبنية مرة واحدة وتُرقّى، لا يعاد بناؤها لكل بيئة.
- Rollback command وdecision owner واضحان.

## 12. W8 — Canary and Production Verification

### Canary scope

- Tenant/Test store محددة.
- Terminal محددة.
- Version محددة.
- Monitoring window محددة بالـrelease runbook، لا تخمين أثناء الحادث.

### Verification checklist

- Login.
- Terminal enrollment/session.
- Open shift.
- Product load بدون Search.
- Online sale.
- Print.
- Stock decrement.
- Invoice visibility.
- Offline sale.
- Restart POS.
- Reconnect.
- Exactly-once sync.
- Last sync/status.
- Return ضمن Scope.
- Logs وrequest IDs.

### Rollback triggers

- Data loss.
- Duplicate invoice أوstock movement.
- Cross-tenant exposure.
- Migration corruption.
- Sale path unavailable.
- Unbounded sync failures.

### Stage 1 Final Gate

Stage 1 تعتبر Closed فقط عند وجود Evidence مرتبطة بالـcommit والـrelease:

- Fresh migration pass.
- Upgrade migration pass.
- Seed safety pass.
- Soft suite pass.
- Full build pass.
- POS package pass.
- SQLite → API → PostgreSQL E2E pass.
- Replay/idempotency pass.
- Hard smoke pass.
- Canary pass.
- Production verification pass.
- Rollback rehearsal pass.
- README وrunbooks محدثة.

## 13. ترتيب التنفيذ العملي

### Batch 1 — Unblock

- Environment preflight.
- Prisma DLL lock runbook/script.
- `pg_trgm` prerequisite.
- Migration inventory.
- Test database isolation.

### Batch 2 — Restore correctness gates

- Transfer migration contract.
- Safe seed.
- Shared test identity.
- Soft suite closure.
- Full build closure.

### Batch 3 — Prove sale and sync

- Pending invoice fixes.
- Idempotency/replay coverage.
- Stock decrement verification.
- SQLite/API/PostgreSQL E2E.
- Sync 500 root cause.

### Batch 4 — Close POS operation

- Login/enrollment.
- Shift.
- Product default list.
- Status and last sync.
- Error UX.
- Printing.
- Packaging.

### Batch 5 — Performance and release

- Hard smoke stabilization.
- Full hard baseline.
- Staging deploy.
- Canary.
- Production verification.
- Final gate report.

لا يبدأ Batch لاحق بكل عناصره إذا كان Batch سابق ما زال يحتوي P0/P1، لكن يمكن تنفيذ مهام مستقلة بالتوازي عندما لا تخفي Gate مكسورة.

## 14. Backlog IDs

- `REL-001` Environment and Prisma process control.
- `REL-002` Test database isolation guard.
- `REL-003` pg_trgm migration prerequisite.
- `REL-004` Transfer migration reconciliation.
- `REL-005` Transfer contract regression test.
- `REL-006` Safe deterministic test seed.
- `REL-007` CI authentication fixture.
- `REL-008` Soft suite full closure.
- `REL-009` Sync pull 500 root cause.
- `REL-010` Pending invoice state and recovery.
- `REL-011` Sale idempotency and replay suite.
- `REL-012` Inventory decrement exactly-once verification.
- `REL-013` SQLite–API–Postgres E2E.
- `REL-014` POS login and enrollment.
- `REL-015` Shift lifecycle.
- `REL-016` Default product pagination.
- `REL-017` Connectivity and last-sync UX.
- `REL-018` User-facing error contract.
- `REL-019` Arabic/English receipt verification.
- `REL-020` Electron packaging and diagnostics.
- `REL-021` Hard smoke stabilization.
- `REL-022` Full performance baseline.
- `REL-023` CI consolidated release gate.
- `REL-024` Canary deployment runbook.
- `REL-025` Stage 1 final validation report.

## 15. Definition of Done لكل REL Item

- Problem موثقة.
- Root cause مثبتة، أوAssumption معلنة إذا لم تكن قابلة للإثبات بعد.
- Fix محدودة النطاق.
- Regression test.
- Local verification.
- CI verification.
- User-facing behavior عند الحاجة.
- Observability أوlog مناسب.
- Documentation/runbook update.
- Rollback/recovery consideration.
- Evidence مرتبطة بالـPR أوcommit.

## 16. Final Validation Report

عند الإغلاق، يصدر تقرير واحد يحتوي على:

- Commit وrelease versions.
- Environment matrix.
- Migration results.
- Test commands والنتائج.
- E2E evidence.
- Performance summary.
- Canary result.
- Production checks.
- Known residual risks.
- Deferred items مع سبب واضح.
- قرار: `PASS` أو`FAIL` فقط.

لا تستخدم `PASS WITH ASSUMPTIONS` لخلل يؤثر على البيع أوالمخزون أوالمزامنة أوالعزل.

## 17. القرار النهائي

- أول عنصر تنفيذي: `REL-001` ثم `REL-002` و`REL-003`.
- Prisma وMigration state تُغلق قبل الاعتماد على أي Test result لاحق.
- Soft tests تسبق Hard tests.
- Hard tests لا تستبدل E2E correctness.
- POS لا تعتبر جاهزة بدون Login وShift وStatus وPrinting وRecovery.
- Stage 1 لا تغلق بMerge أونجاح محلي؛ تغلق بعد Canary وProduction verification وRollback evidence.

---

# ATHR Execution Roadmap & Operating Plan — v1.0

الحالة: **Approved**

## 1. الهدف

تحويل قرارات المنتج والعلامة والسوق إلى برنامج تنفيذ واحد يمنع ثلاثة أخطاء:

- بناء واجهات فوق أساس غير مستقر.
- إطلاق مبيعات قبل جاهزية التشغيل والدعم.
- فتح Workstreams كثيرة بلا Owner أوGate واضح.

قاعدة التنفيذ:

> **لا نتحرك حسب ما يبدو جاهزًا بصريًا؛ نتحرك حسب أخطر اعتماد لم يُغلق بعد.**
> 

## 2. مسارات العمل

### Product Reliability

- Backend correctness.
- POS Electron reliability.
- Sync وOffline وIdempotency.
- Inventory ledger وreconciliation.
- Migrations وtests وdeployment.

### Product Architecture

- Multi-tenancy.
- Identity وMembership.
- Locations وWarehouses.
- Permissions وEntitlements.
- Platform boundary.
- Billing architecture.

### Product Experience

- ATHR Operations.
- Cashier Workspace.
- Warehouse Workspace.
- Supervisor Workspace.
- ATHR Control.
- Design system وTrace Interface.

### Market & Revenue

- Interviews.
- Design Partners.
- Pilot pipeline.
- Pricing validation.
- Sales materials.
- Website.

### Company Operations

- Support.
- Incident response.
- Billing operations.
- Legal وprivacy.
- Backup وrestore.
- Onboarding وdata migration.

كل Workstream له Owner واحد مسؤول عن النتيجة، حتى لو شارك أكثر من شخص في التنفيذ.

## 3. التسلسل التنفيذي المعتمد

```
Stage 0A — Architecture Input Lock
Stage 1 — Reliability Closure
Stage 2 — SaaS Foundation
Stage 3 — ATHR Operations MVP
Stage 4 — Private Pilot Readiness
Stage 5 — Private Pilot
Stage 6 — Paid Beta
Stage 7 — Public Launch Readiness
Stage 8 — Egypt Public Launch
```

Stage 0B — Market Validation تعمل بالتوازي ولا توقف Reliability، لكنها تغذي قرارات التسعير والـICP والـPilot.

## 4. Stage 0A — Architecture Input Lock

### الهدف

تثبيت القرارات التي لا يجوز تركها ضمنية قبل بناء SaaS foundation.

### المخرجات

- ADR: Tenant and Data Ownership.
- ADR: Identity and Membership.
- ADR: Location and Warehouse Model.
- ADR: Authorization and Entitlements.
- ADR: Platform Boundary.
- ADR: Migration, Backfill and Rollback.
- Identifier classification matrix: Global مقابل Tenant-scoped.
- Product boundary: ATHR Operations منتج واحد، والـWorkspaces تجارب داخله.

### Gate

لا يبدأ Stage 2 قبل:

- اعتماد ADRs الستة.
- عدم وجود تعريف متعارض للـTenant أوLocation أوWarehouse.
- تحديد Global IDs وTenant-scoped uniqueness.
- فصل Permission عنEntitlement في التصميم.

## 5. Stage 0B — Market Validation

### يعمل بالتوازي

- 15–20 مقابلة سوق.
- 10 مقابلات من القطاع الأول نفسه.
- اختبار ICP.
- اختبار الرسالة.
- Pricing interviews.
- Hardware وpayment preferences.
- Domain وtrademark checks.
- قائمة Design Partners.

### Owner

Founder / Product Lead.

### Gate إلى Design Partners

- مشكلة متكررة بدون تلقين.
- استعداد واضح للدفع.
- 5 متاجر مناسبة على الأقل.
- اعتراضات وبدائل موثقة.

## 6. Stage 1 — Reliability Closure

### الهدف

إغلاق المنتج الحالي كمنظومة قابلة للبناء فوقها، لا مجرد Demo يعمل أحيانًا.

### Backend

- حل Prisma migration failures جذريًا.
- إصلاح `gin_trgm_ops` في migrations وshadow DB.
- إصلاح transfer migration ordering contract.
- تثبيت safe seed process للـlocal والـCI.
- منع destructive reset على أي DB غير معزولة.
- lint وbuild وtypecheck نظيفة.

### Tests

- Soft suite كاملة.
- Hard smoke suite مستقرة.
- Full hard suite في بيئة ممثلة.
- Sync pull/push coverage.
- Pending invoice coverage.
- Replay وidempotency tests.
- POS SQLite → API → Postgres E2E.
- Offline sale → reconnect → exactly-once confirmation.
- Performance baselines محفوظة ومقارنة تلقائيًا.

### POS Electron

- Login وenrollment.
- Shift lifecycle.
- Online/offline indicator.
- Last sync.
- Outbox visibility.
- Clear user-facing errors.
- Printing verification بالعربية والإنجليزية.
- Update وdiagnostics flow.

### Deployment

- README تشغيل واضح.
- Environment contract.
- Canary deployment.
- Rollback path.
- Production verification checklist.
- Monitoring وrequest IDs.

### Gate

لا يبدأ Stage 2 قبل:

- كل Soft tests خضراء.
- Hard smoke خضراء باستمرار.
- لا P0 أوP1 مفتوح في البيع أوالمخزون أوالمزامنة.
- نجاح E2E الحقيقي.
- Migration من قاعدة نظيفة ومن نسخة قديمة تجريبية.
- Canary ناجح وRollback مجرب.

## 7. Stage 2 — SaaS Foundation

### الهدف

بناء أساس Multi-tenant صحيح قبل توسيع الواجهات.

### Domains

- Tenant provisioning.
- Global Identity.
- Tenant Membership.
- Roles وPermissions وScopes.
- Locations وWarehouses.
- Terminal identity وleases.
- PlanVersion وEntitlements وLimits.
- Platform operators.
- Audit boundaries.

### Non-negotiables

- `tenant_id` enforcement من الـBackend.
- لا اعتماد على UI لإخفاء البيانات.
- كل unique constraint مصنف Global أوTenant-scoped.
- Support access مؤقت ومسجل.
- Platform Admin منفصل عن Tenant Admin.
- BillingInvoice منفصلة عن SalesInvoice.

### Gate

- Tenant isolation tests.
- Cross-tenant negative tests.
- Permission matrix tests.
- Entitlement enforcement tests.
- Provisioning وsuspension وreactivation flows.
- Audit trail لكل platform action حساس.
- لا Manual SQL مطلوب لإنشاء Tenant سليم.

## 8. Stage 3 — ATHR Operations MVP

### الهدف

تحويل المنتج إلى تجربة تشغيل موحدة ومفهومة.

### Design System Foundation

- Tokens.
- Typography بعد اختيار خطوط أصلية ومراجعة الترخيص.
- Heavy smooth icon system.
- Curved modern buttons.
- Status language.
- Trace Rail.
- Scope Anchor.
- Sync Beacon.
- Proof Sheet.
- RTL وLTR.

### Cashier Workspace

- Login وshift.
- Product search وscan.
- Cart وpricing.
- Payments المسجلة.
- Offline sale.
- Pending states.
- Returns المسموحة.
- Printing.
- Sync وdiagnostics.

### Warehouse Workspace

- Products وVariants.
- Suppliers.
- Purchasing وreceiving.
- Transfers.
- Partial receiving.
- Stock count.
- Adjustments.
- Damaged/Lost quantities.
- Barcode وlabels.

### Supervisor Workspace

- Exceptions.
- Pending sync.
- Approval queue.
- Device health.
- Recovery actions.
- Shift oversight.

### ATHR Control

- Operational narrative.
- Reports.
- Users وroles.
- Locations وwarehouses وterminals.
- Audit وalerts.
- Plan وusage view.

### Gate

- جميع الـWorkspaces تستخدم API contracts نفسها.
- لا business logic مكررة بين Electron والWeb.
- Scope واضح في كل عملية.
- كل critical state لها: ماذا حدث، ما المحفوظ، وما التالي.
- usability tests بالعربية مع مستخدمين حقيقيين.
- Cashier critical path سريع تحت ضغط العمل.

## 9. Stage 4 — Private Pilot Readiness

### Product

- Stable release channel.
- Installer وupdates.
- Demo dataset.
- Data import template.
- Hardware compatibility list.
- Backup وrestore runbook.
- Incident severity model.
- Support tools بدون direct DB editing.

### Commercial

- Pilot agreement.
- Proposal template.
- Pricing sheet.
- Scope and exclusions.
- Onboarding checklist.
- Training materials.
- Demo script.
- CRM pipeline.

### Website Phase 1

- Landing page.
- Why ATHR.
- Pilot page.
- About.
- Privacy.
- Qualified lead form.

### Gate

- يمكن Onboard متجر بدون مطور يغير الكود.
- يمكن استعادة Backup تجريبية.
- Support response path معروف.
- Pilot success criteria متفق عليها.
- لا Feature وهمية في Demo أوWebsite.

## 10. Stage 5 — Private Pilot

### النطاق

- 3–5 متاجر.
- 1 Location لكل Pilot كبداية.
- 1–2 Terminals.
- 2–4 أسابيع تشغيل.

### Operating Rhythm

- Daily health review في أول أسبوع.
- Weekly customer review.
- Incident log.
- Product feedback log.
- No silent fixes: كل تعديل Production له Issue وRelease note.

### المقاييس

- Time to first sale.
- Sync success rate.
- Outbox age.
- Duplicate prevention events.
- Crash-free sessions.
- Stock differences.
- Support incidents.
- User confidence.

### Gate إلى Paid Beta

- 3 Pilots مكتملة.
- لا Data loss.
- لا duplication غير محلولة.
- عميلان على الأقل مستعدان للدفع الكامل.
- Onboarding قابل للتكرار.
- Top support issues لها Product fixes أوRunbooks.

## 11. Stage 6 — Paid Beta

### الهدف

إثبات أن أثر يمكن تشغيلها كخدمة مدفوعة، لا كمشروع Pilot.

### المطلوب

- 10–25 Tenants.
- Monthly وAnnual billing.
- Price Books وPlan Versions.
- Renewals.
- Failed payment handling.
- Customer support process.
- Product analytics.
- Status communication.
- Case studies موثقة.
- Website Phase 2 و3.

### Gate

- دورة Billing كاملة ناجحة.
- Renewal واحدة على الأقل.
- لا تدخل يدوي متكرر في provisioning أوbilling.
- Support volume مفهوم وقابل للإدارة.
- Gross margin assumptions قابلة للقياس.
- Top churn reasons موثقة.

## 12. Stage 7 — Public Launch Readiness

### المنتج

- P0 وP1 backlog مغلق.
- Monitoring وalerts.
- Disaster recovery exercise.
- Security review.
- Tenant isolation review.
- Capacity test.
- Public release process.

### الشركة

- Terms وPrivacy وData Processing.
- Refund وcancellation policy.
- Support hours وSLA language.
- Billing and tax operations.
- Customer success ownership.
- Incident communication owner.

### العلامة والموقع

- Final vector logo masters.
- Design system assets.
- Public pricing أوsales-assisted pricing واضح.
- Case studies.
- Product pages.
- Trust page.
- Help وstatus.
- Website performance gates.

### Gate

- 10 Tenants مدفوعين أوإثبات مكافئ قوي.
- Renewal مثبتة.
- Recovery drill ناجح.
- Legal وsupport وbilling جاهزة.
- لا Claim عام بلا دليل.
- End-to-end flow منLead حتىPaid active tenant مجرب.

## 13. Stage 8 — Egypt Public Launch

### Launch scope

- مصر أولًا.
- Specialty Retail فقط.
- Sales-assisted onboarding في البداية.
- Controlled acquisition بدل إنفاق إعلاني واسع.

### أول 90 يومًا

- تحسين activation.
- تقليل onboarding time.
- تقليل incidents لكل متجر.
- توثيق lost reasons.
- تحسين conversion منDemo إلىPaid.
- تقييم الأسعار بعد بيانات حقيقية.
- عدم فتح قطاع جديد قبل ثبات القطاع الأول.

## 14. ترتيب الأولويات

نستخدم هذا الترتيب:

1. Data loss أوtenant isolation.
2. Duplicate financial/inventory operations.
3. Broken sale أوsync path.
4. Migration وdeployment safety.
5. Incorrect stock.
6. User-blocking UX.
7. Supportability.
8. Performance.
9. Commercial enablement.
10. Cosmetic improvements.

الشعار أوالموقع لا يسبق إصلاح عملية يمكن أن تفقد بيعًا.

## 15. تعريف Done

أي Feature لا تعتبر Done إلا إذا شملت:

- Requirements.
- UX states.
- Authorization.
- Tenant scope.
- Validation.
- Audit/event behavior.
- Tests.
- Error messages.
- Observability.
- Documentation.
- Rollback أوrecovery path.
- Release verification.

`Code merged` لا يساوي `Done`.

## 16. إدارة الـBacklog

كل Item يحتوي على:

- Problem.
- User/role.
- Business rule.
- Acceptance criteria.
- Dependencies.
- Risk.
- Owner.
- Target stage.
- Test plan.
- Rollout plan.

لا يدخل Item إلى التنفيذ إذا كان Scope غامضًا أوبدون Owner.

## 17. Operating Cadence

### يوميًا أثناء التنفيذ النشط

- Blockers.
- Production risks.
- Test failures.
- Decisions needed.

### أسبوعيًا

- Reliability scorecard.
- Product progress.
- Market interviews.
- Pipeline.
- Incidents.
- Stage gate status.

### شهريًا

- Architecture review.
- Security review.
- Pricing evidence.
- Customer feedback themes.
- Roadmap changes.
- Cost and capacity review.

الاجتماع لا يستخدم لقراءة Status؛ يستخدم لاتخاذ قرار أوإزالة Blocker.

## 18. Decision Log

كل قرار يغير واحدًا من الآتي يوثق كـADR أوقرار Product:

- Data ownership.
- Security boundary.
- Business invariant.
- Plan entitlement.
- Public contract/API.
- Migration strategy.
- Product boundary.
- Pricing model.

القرار يجب أن يحتوي على:

- Context.
- Decision.
- Alternatives.
- Consequences.
- Reversal cost.
- Owner.
- Date.

## 19. Change Control

أي طلب جديد يصنف:

- Reliability fix.
- Required for current stage gate.
- Validated market requirement.
- Strategic future item.
- Customer-specific request.

لا يدخل Customer-specific request إلى الـCore إلا إذا:

- تكرر في السوق.
- يطابق ICP.
- لا يكسر architecture.
- يمكن دعمه لكل العملاء.

## 20. مؤشرات الإدارة

### Reliability

- Test pass rate.
- Deployment success.
- Sync success.
- Crash-free sessions.
- Data incidents.
- Mean recovery time.

### Delivery

- Cycle time.
- Blocked days.
- Reopened work.
- Scope changes.
- Stage gate completion.

### Market

- Interviews.
- Qualified design partners.
- Pilot conversion.
- Paid conversion.
- Lost reasons.

### Operations

- Onboarding time.
- Support incidents per tenant.
- Time to resolution.
- Manual interventions.
- Backup and restore success.

## 21. المسؤوليات المبدئية

### Founder / Product Lead

- Vision وscope.
- Market interviews.
- Pricing validation.
- Product decisions.
- Pilot relationships.

### Engineering Lead

- Architecture.
- Reliability.
- Security boundaries.
- Delivery quality.
- Release gates.

### Product Design

- Trace Interface.
- Design system.
- User testing.
- Arabic-first UX.
- Product evidence للموقع.

### Operations / Customer Success

- Onboarding.
- Training.
- Support.
- Incident coordination.
- Renewal feedback.

قد يحمل شخص واحد أكثر من دور في البداية، لكن المسؤوليات لا تختفي.

## 22. ما لا نفعله الآن

- لا ندخل المطاعم.
- لا نبني ERP شاملًا.
- لا نبني e-commerce platform.
- لا نفتح Marketplace.
- لا نضيف AI لمجرد التسويق.
- لا نبني Mobile apps كاملة قبل إثبات الحاجة.
- لا نعيد كتابة كل النظام لمجرد تغيير الاسم.
- لا نوسع دوليًا قبل ثبات مصر.

## 23. القرار النهائي

- Stage 1 Reliability Closure هو الأولوية التنفيذية الحالية.
- Stage 0A يجب أن يُغلق قبل SaaS Foundation.
- Market Validation تعمل بالتوازي ولا تنتظر اكتمال المنتج.
- لا يبدأ Pilot قبل Reliability وOnboarding وSupport readiness.
- لا يبدأ Public Launch قبل Paid Beta وRenewal وRecovery drill.
- كل Stage لها Gate يمنع الانتقال بناءً على الانطباع.
- النجاح التنفيذي هو متجر يعمل ويدفع ويجدد، مع نظام يمكن فهمه وتشغيله واستعادته بدون بطولة فردية.

---

# ATHR Marketing Website Blueprint — v1.0

الحالة: **Approved**

## 1. وظيفة الموقع

موقع أثر ليس Brochure لعرض Features، وليس نسخة مصغرة من التطبيق.

وظيفته أن ينقل الزائر خلال رحلة فهم واحدة:

```
أشعر بالمشكلة
→ أفهم الفرق
→ أرى الدليل
→ أجد نفسي في المنتج
→ أثق أن الانتقال آمن
→ أحجز الخطوة التالية
```

النتيجة المطلوبة ليست Page View؛ بل:

- Market interview مؤهلة قبل الـPilot.
- Demo مع صاحب قرار مناسب.
- Pilot application مكتملة.
- Lead يفهم ما تفعله أثر وما لا تفعله قبل التواصل.

## 2. فكرة الموقع المركزية

اسم التجربة:

> **اتبع الأثر — Follow the Trace**
> 

الزائر لا يرى مجموعة Sections منفصلة؛ بل يتبع عملية Retail واحدة تتحرك في الصفحة وتكشف أثرها.

القصة الأساسية:

```
منتج دخل المخزن
→ انتقل إلى الفرع
→ بيع أثناء ضعف الإنترنت
→ حُفظ محليًا
→ تزامن بأمان
→ خُصم المخزون مرة واحدة
→ أصبح لكل خطوة دليل
```

`Trace Rail` يمتد بصريًا ووظيفيًا عبر الصفحة، ويتغير مع كل Section ليشرح مرحلة حقيقية، وليس Animation للزينة.

## 3. الرسالة الأساسية

### Primary Headline

> **تعرف رقم مخزونك. أثر تريك لماذا أصبح هكذا.**
> 

### Supporting Copy

> منصة تشغيل للمتاجر المتخصصة تحفظ البيع عند انقطاع الإنترنت، وتربط كل حركة مخزون بمصدرها ووقتها ومنفذها، حتى تفهم ما حدث بدل أن تبحث عنه بين الجداول والأسئلة.
> 

### Primary CTA

> **احجز مراجعة تشغيل**
> 

### Secondary CTA

> **شاهد رحلة عملية**
> 

قبل الـPublic Launch لا نستخدم:

- ابدأ مجانًا.
- أنشئ حسابك الآن.
- جرّب بدون بطاقة.

لأن رحلة البيع في هذه المرحلة Sales-assisted وتهدف إلى Qualification حقيقي.

## 4. الرسائل المساندة

### Brand Line

> **كل حركة لها أثر.**
> 

### Simple Promise

> **بيعك محفوظ. مخزونك مفهوم.**
> 

### Competitive Line

> **ليست مجرد نقطة بيع، وليست ERP يثقل متجرك.**
> 

### Trust Line

> **حتى عندما يتوقف الإنترنت، لا يتوقف الدليل.**
> 

### Inventory Line

> **لا تعرض أثر الرصيد فقط؛ تعرض الحركات التي صنعته.**
> 

لا تُعرض كل الرسائل في Hero واحد. كل رسالة تظهر عندما تصبح منطقية داخل رحلة الصفحة.

## 5. الجمهور

الموقع الأساسي يتحدث أولًا إلى:

- صاحب متجر Specialty Retail.
- مدير عمليات Retail.
- صاحب نشاط لديه 1–3 فروع ومخزن.

المستخدمون الآخرون، مثل الكاشير ومسؤول المخزن، يظهرون داخل قصص الاستخدام لإثبات سهولة التشغيل، لكنهم ليسوا Decision-maker الأساسي في الصفحة الرئيسية.

## 6. خريطة الموقع قبل الـPublic Launch

```
الرئيسية
المنتج
├── التشغيل
├── نقطة البيع
├── المخزن
└── الإشراف
لماذا أثر
├── العمل دون اتصال
├── أثر المخزون
└── الأمان والموثوقية
لمن أثر
├── الملابس
├── الأحذية
├── الإكسسوارات
└── مستحضرات التجميل
الأسعار
Pilot
المصادر
عن أثر
تسجيل الدخول
```

لا ننشئ عشرات الصفحات في البداية. الصفحة لا تُنشأ إلا إذا كان لها Search intent أوSales question أوDecision واضح.

## 7. Navigation

### Desktop

- الشعار.
- المنتج.
- لماذا أثر.
- لمن أثر.
- الأسعار.
- المصادر.
- تسجيل الدخول.
- CTA: احجز مراجعة تشغيل.

### Mobile

- Menu بسيط.
- CTA ثابت وواضح دون تغطية المحتوى.
- لا Mega Menu.
- لا Carousels داخل التنقل.

### قواعد

- العربية هي النسخة الأصلية.
- تبديل اللغة واضح: العربية / English.
- لا تظهر صفحة ATHR Platform في الموقع العام.
- ATHR Control تشرح كجزء من تجربة العميل، لا كمنتج تقني منفصل في التنقل الرئيسي.

## 8. الصفحة الرئيسية — Narrative Structure

### Section 1 — السؤال

لا يبدأ الموقع بصورة Laptop أوDashboard.

يبدأ بمساحة هادئة تحتوي على:

> **تعرف رقم مخزونك. أثر تريك لماذا أصبح هكذا.**
> 

أسفلها مثال مصغر لحركة واحدة:

```
قميص أسود — مقاس M
24 قطعة الآن
```

ثم يظهر سؤال صغير قابل للتفاعل:

> من أين جاءت الـ24؟
> 

عند التقدم، يبدأ Trace Rail في كشف الإجابة.

### Section 2 — المشكلة

عنوان:

> **الرقم وحده لا يكفي.**
> 

النص:

> البيع، الاستلام، التحويل، المرتجع، الجرد والتسوية قد تغيّر نفس الرصيد. عندما تكون هذه الحركات منفصلة أوغامضة، يتحول المخزون إلى رقم لا يمكن الدفاع عنه.
> 

العرض البصري:

- Ledger حقيقي مبسط.
- قبل وبعد.
- كل Movement لها Reference.
- لا تستخدم Illustrations عامة.

### Section 3 — رحلة الأثر

يعرض Trace Rail قصة كاملة:

1. استلام 30 قطعة.
2. تحويل 10 إلى فرع المعادي.
3. بيع 4 أثناء انقطاع الإنترنت.
4. حفظ الفاتورة على الجهاز.
5. عودة الاتصال.
6. إرسال العملية مرة واحدة.
7. تأكيد الرصيد: 16 قطعة.

كل خطوة تكشف:

- ماذا حدث؟
- من نفذ؟
- أين؟
- متى؟
- ما أثرها على الكمية؟

CTA داخل القصة:

> **افتح دليل العملية**
> 

### Section 4 — العمل دون اتصال

عنوان:

> **الإنترنت انقطع. البيع لم يضع.**
> 

بدل رسم Cloud وWi-Fi، نعرض حالة حقيقية:

```
الفاتورة 1048
محفوظة على هذا الجهاز
في انتظار الإرسال
لا تعِد تسجيلها
```

ثم تتحول الحالة عند عودة الاتصال:

```
تم الإرسال والتأكيد
خُصم المخزون مرة واحدة
```

### Section 5 — المنتج الموحد

عنوان:

> **نفس الحقيقة، لكل دور واجهته.**
> 

نعرض Workspaces الثلاثة كمسار عمل، لا كثلاث Cards تسويقية:

```
الكاشير يبيع
→ المخزن ينفذ الحركة
→ المشرف يرى الاستثناء
→ الإدارة ترى الأثر الكامل
```

لكل Workspace لقطة Product UI حقيقية أوPrototype عالي الدقة، مع جملة واحدة فقط:

- نقطة البيع: أسرع طريق لبيع محفوظ.
- المخزن: كل استلام وتحويل وجرد في مساره الصحيح.
- الإشراف: ما يحتاج قرارك يظهر أولًا.

### Section 6 — لماذا تختلف أثر

ليس Feature grid.

نستخدم Comparison Narrative:

```
POS بسيط
يسجل النتيجة

ATHR
تربط النتيجة بسببها ودليلها

ERP عام
يغطي كل شيء بتعقيد أكبر
```

الرسالة:

> **سهولة POS، بعمق تتبع تشغيلي أقرب للأنظمة المؤسسية.**
> 

### Section 7 — لمن أثر

عنوان:

> **مصممة للمنتج الذي له مقاس ولون ومكان وحركة.**
> 

نذكر القطاعات بنص مباشر:

- الملابس.
- الأحذية.
- الإكسسوارات.
- مستحضرات التجميل.

لا نستخدم صور Stock لكل قطاع. يمكن استخدام Product specimens حقيقية، مثل Label أوVariant matrix أوShelf detail، عندما تضيف معنى.

### Section 8 — الدليل الاجتماعي

قبل وجود عملاء:

- لا نعرض Logos وهمية.
- لا نكتب “موثوق من آلاف المتاجر”.
- لا ننشئ Testimonials مزيفة.

نستخدم بدلًا منها:

- مراحل الـPilot.
- معايير الموثوقية.
- شرح Architecture principles بلغة مفهومة.
- دعوة واضحة للـFounding stores.

بعد الـPilot يظهر:

- نتيجة قابلة للقياس.
- اقتباس موثق.
- قصة قبل وبعد.
- اسم العميل فقط بموافقته.

### Section 9 — الأسعار

عنوان:

> **سعر يتوسع مع تشغيلك، لا مع كل فاتورة.**
> 

نوضح:

- لا عمولة على المبيعات.
- لا رسوم على عدد الفواتير.
- الأمان والـOffline ليسا Add-ons.
- الاشتراك يتوسع حسب Locations وTerminals وSeats.

قبل تثبيت الأسعار العامة:

CTA:

> **راجع الخطة المناسبة لمتجرك**
> 

بعد الاعتماد تُعرض الباقات بدون جدول مقارنة ضخم؛ يبدأ كل Plan بمن هو مناسب له، ثم حدود واضحة.

### Section 10 — Final CTA

لا نستخدم “Ready to transform your business?”.

النهاية:

> **لو اختلف مخزونك غدًا، هل ستعرف السبب؟**
> 

النص:

> في مراجعة تشغيل قصيرة، نتتبع رحلة منتج واحد داخل متجرك ونحدد أين يضيع الأثر اليوم، وهل أثر مناسبة لحل المشكلة.
> 

CTA:

> **احجز مراجعة تشغيل**
> 

Secondary text:

> 30 دقيقة — بدون عرض بيع عام — مع صاحب القرار التشغيلي.
> 

## 9. صفحة المنتج

الصفحة تشرح ATHR Operations كمنتج موحد.

الترتيب:

1. رحلة التشغيل الكاملة.
2. Workspaces والأدوار.
3. البيانات المشتركة.
4. Trace Rail وProof Sheet.
5. Offline وSync.
6. ATHR Control.
7. Integrations وExports عند جاهزيتها.
8. CTA للـDemo.

لا يتم فصل Workspaces بطريقة توحي بأنها Products أوAdd-ons منفصلة.

## 10. صفحات Workspaces

### نقطة البيع

تجيب عن:

- هل البيع سريع؟
- ماذا يحدث عند ضعف الإنترنت؟
- كيف أعرف أن الفاتورة محفوظة؟
- هل يمكن أن تتكرر؟
- كيف تعمل الوردية والطباعة والمرتجع؟

القصة الرئيسية:

> **من Scan إلى فاتورة محفوظة، بأقل عدد من الخطوات.**
> 

### المخزن

تجيب عن:

- كيف تُدار Variants وBarcodes؟
- كيف يتم الاستلام والتحويل والجرد؟
- ماذا يحدث عند الاستلام الجزئي؟
- كيف يُشرح اختلاف الكمية؟

القصة الرئيسية:

> **الحركة لا تختفي داخل الرصيد.**
> 

### الإشراف

تجيب عن:

- ماذا يحتاج تدخلًا الآن؟
- أين توجد عمليات معلقة؟
- ما الجهاز الذي لم يزامن؟
- كيف تتم الموافقات وRecovery؟

القصة الرئيسية:

> **لا تراجع كل شيء؛ راجع ما خرج عن مساره.**
> 

## 11. صفحة “لماذا أثر”

الصفحة ليست About Us.

تشرح أربعة مبادئ:

### محفوظ

العملية لا تضيع عند ضعف الاتصال.

### مرة واحدة

إعادة المحاولة لا تعني تسجيل العملية مرتين.

### مفهوم

كل تغيير يعرض سببه وحالته.

### مثبت

لكل حركة مرجع ومنفذ ووقت ودليل.

كل مبدأ يحتوي على Product evidence، وليس Claim فقط.

## 12. صفحة Trust & Reliability

اللغة بسيطة، مع رابط إلى Security detail للمختصين.

تشرح:

- عزل بيانات المؤسسات.
- Offline storage.
- Idempotency.
- Sync recovery.
- Backups.
- Audit.
- Support access leases.
- Data export.
- Incident communication.

نقول بوضوح ما هو متاح وما هو مخطط، ولا نستخدم Badges أوCertifications غير حقيقية.

## 13. صفحات القطاعات

كل صفحة قطاع تُبنى حول Workflow مختلف، لا حول تغيير اسم القطاع فقط.

### الملابس

- Sizes وColors.
- Seasonal stock.
- Transfers.
- Exchanges.

### الأحذية

- Size matrices.
- Pair consistency.
- Store availability.

### الإكسسوارات

- High SKU variety.
- Small items.
- Barcode and count accuracy.

### مستحضرات التجميل

- Variants.
- Batch/expiry عندما تصبح جاهزة فعليًا.
- Returns and damaged stock.

لا نذكر Feature غير موجودة فقط لأنها متوقعة في القطاع.

## 14. صفحة الأسعار

قبل Validation:

- تشرح نموذج التسعير.
- تعرض الباقات كـ“فرضية Pilot” فقط في المواد الخاصة، وليس السعر العام.
- تستخدم CTA لمراجعة التشغيل.

بعد الاعتماد:

- شهري / سنوي.
- ما هو مشمول.
- Limits واضحة.
- Extras واضحة.
- Onboarding وMigration منفصلان.
- Taxes وشروط الدفع.
- FAQ.

لا يوجد:

- Most Popular badge بلا دليل.
- عداد خصم وهمي.
- سعر مشطوب دائم.
- Hidden fees.
- Enterprise “Contact us” بلا تفسير لما يختلف.

## 15. صفحة Pilot

عنوان:

> **شغّل أثر في نطاق صغير، وقِس النتيجة قبل التوسع.**
> 

تشرح:

- لمن يصلح الـPilot.
- مدة التشغيل.
- ما المطلوب من العميل.
- ما الذي يُقاس.
- Success criteria.
- السعر أوالخصم.
- ماذا يحدث بعده.

النموذج يجمع:

- القطاع.
- عدد Locations.
- عدد Terminals.
- النظام الحالي.
- المشكلة الرئيسية.
- صاحب القرار.
- توقيت التغيير.
- وسيلة التواصل.

لا يسمح Form بإرسال فارغ ثم يطلب فريق المبيعات المعلومات نفسها لاحقًا.

## 16. صفحة About

لا تبدأ بقصة Founder طويلة.

الترتيب:

1. المشكلة التي بُنيت أثر لحلها.
2. المبدأ: كل حركة لها أثر.
3. ما نختار التركيز عليه.
4. ما لا نحاول أن نكونه.
5. طريقة بناء المنتج مع المتاجر.
6. الفريق عند وجود معلومات حقيقية.

الرسالة:

> **نبني طبقة تشغيل يمكن الوثوق بها عندما يصبح الواقع أكثر تعقيدًا من الجدول.**
> 

## 17. Content Strategy

المحتوى لا يكون “10 نصائح لزيادة مبيعاتك”.

المحاور:

### فهم المخزون

- لماذا لا يساوي الرصيد الحقيقة وحده؟
- الفرق بين Stock balance وMovement ledger.
- أسباب اختلاف الجرد.

### Offline Operations

- ماذا يجب أن يحدث للفواتير عند انقطاع الإنترنت؟
- كيف تمنع إعادة الإرسال من تكرار البيع؟

### Retail Workflows

- الاستلام الجزئي.
- التحويل بين الفروع.
- المرتجعات.
- الجرد والتسويات.

### Buying Guides

- أسئلة قبل اختيار POS.
- الفرق بين POS وRetail Operations Platform وERP.
- كيف تقارن تكلفة النظام بتكلفة الخطأ؟

كل مقال ينتهي بخطوة منطقية، وليس CTA بيع عام مكرر.

## 18. لغة الـCopy

### Tone

- واضحة.
- هادئة.
- واثقة دون مبالغة.
- عملية.
- تحترم ذكاء القارئ.

### نستخدم

- ما حدث.
- ما تغير.
- محفوظ.
- متزامن.
- يحتاج تدخلًا.
- مصدر الحركة.
- قبل وبعد.

### لا نستخدم

- ثورة في عالم الأعمال.
- حوّل أعمالك اليوم.
- قوة لا حدود لها.
- حل ذكي شامل.
- مدعوم بالذكاء الاصطناعي، دون وظيفة حقيقية.
- أفضل منصة في السوق.
- Seamless وEffortless بلا إثبات.

## 19. الاتجاه البصري للموقع

الموقع يستخدم:

- Trace Green وInk وPaper وSand.
- مساحات دافئة.
- Borders وخطوط مسار.
- Product UI حقيقية.
- Ledger وTimeline وBefore/After.
- Motion يوضح السبب والنتيجة.

لا يستخدم:

- Hero تقليدي بنص وصورة Laptop عائمة.
- Purple gradients.
- Glass cards.
- شبكة Features من 12 Card.
- أشخاص مولدين أوStock photos عامة.
- Dashboard mockups غير قابلة للقراءة.
- Decorative 3D objects.
- Logos وهمية.

عندما لا توجد صورة حقيقية مفيدة، نستخدم النص والمنتج والبيانات بدل ملء المساحة بصورة.

## 20. الصور والـProduct Media

الأولوية:

1. Product capture حقيقية.
2. Motion demo قصير.
3. Diagram مبني على بيانات حقيقية.
4. تصوير ميداني حقيقي عند توفره.
5. لا صورة على الإطلاق عندما لا تضيف معنى.

كل Product capture:

- تعرض حالة قابلة للقراءة.
- تستخدم بيانات Retail واقعية.
- لا تحتوي بيانات عميل حقيقية دون تصريح.
- لها Mobile fallback.
- لا تعتمد على Autoplay video لشرح المعنى الأساسي.

## 21. التحويل والـForms

### CTA Hierarchy

Primary:

> احجز مراجعة تشغيل
> 

Secondary:

> شاهد رحلة عملية
> 

Tertiary:

> تقدم للـPilot
> 

لا نغير CTA في كل Section دون سبب.

### Demo Form

- الاسم.
- اسم المتجر.
- الهاتف أوWhatsApp.
- البريد اختياري حسب السوق.
- القطاع.
- Locations.
- النظام الحالي.
- المشكلة الرئيسية.
- الوقت المفضل.

بعد الإرسال:

- Confirmation واضح.
- ما الذي سيحدث بعد ذلك.
- متى يتوقع الرد وفق قدرة الفريق الفعلية.
- خيار إضافة الموعد عند وجود Scheduling integration.

## 22. SEO

الصفحات الأساسية تستهدف Intent حقيقي، مثل:

- برنامج نقاط بيع للملابس.
- برنامج مخازن وفروع.
- POS يعمل بدون إنترنت.
- إدارة مقاسات وألوان.
- تتبع حركة المخزون.
- جرد مخزون المتاجر.

القواعد:

- لا Keyword stuffing.
- لا صفحات مدن متكررة آليًا.
- العربية لها URLs وMetadata مستقلة.
- English ليست ترجمة آلية ضعيفة.
- Schema markup للـSoftwareApplication وFAQ عند انطباقه.
- كل Claim تقني قابل للتدقيق.

## 23. Performance & Accessibility

### Performance Gates

- LCP أقل من 2.5s على Mobile في ظروف واقعية.
- CLS أقل من 0.1.
- INP أقل من 200ms.
- لا Hero video ثقيل.
- الصور Responsive ومحسنة.
- الخطوط Self-hosted ومحدودة الأوزان بعد مراجعة الترخيص.
- Motion لا يؤخر التفاعل.

### Accessibility

- RTL أصلي.
- Keyboard navigation.
- Visible focus.
- Contrast واضح.
- Labels كاملة للـForms.
- Error summary مفهوم.
- Reduced Motion.
- Product demos لها شرح نصي.
- اللغة محددة في الصفحة وعند المقاطع ثنائية اللغة.

## 24. Analytics

نقيس رحلة القرار، لا كل Click بلا هدف.

الأحداث الأساسية:

- Hero CTA.
- Start Trace Story.
- Complete Trace Story.
- Open Product Proof.
- Pricing view.
- Pilot view.
- Demo form start.
- Demo form submit.
- Qualified lead.
- Demo booked.
- Pilot accepted.

القواعد:

- Consent وPrivacy واضحان.
- لا نسجل بيانات حساسة داخل Analytics events.
- UTM محفوظة مع الـLead.
- المصدر يرتبط بالـCRM.
- Conversion quality أهم من Conversion volume.

## 25. مراحل بناء الموقع

### Phase 1 — Interview Site

- Home landing page.
- Why ATHR.
- Pilot form.
- About.
- Privacy.

الهدف: مقابلات وتصميم الشراكات.

### Phase 2 — Pilot Site

- Product page.
- Workspace sections.
- Trust page.
- Pricing model.
- Demo booking.
- Resources الأساسية.

الهدف: تحويل المتاجر المؤهلة إلى Pilot.

### Phase 3 — Paid Beta Site

- Sector pages.
- Case studies.
- Detailed pricing.
- Help وStatus links.
- Login.
- Onboarding content.

### Phase 4 — Public Launch Site

- Self-serve flows عند الجاهزية.
- Checkout.
- Integrations.
- Full resource center.
- Partner pages.
- Legal and support coverage المكتملة.

## 26. بوابة الاعتماد

لا يُطلق الموقع قبل:

1. اختبار الرسالة مع 5 أصحاب متاجر على الأقل.
2. قدرة الزائر على شرح أثر بجملة بعد رؤية الصفحة.
3. فهمه أن أثر ليست للمطاعم أوERP عامًا.
4. فهمه لقيمة Offline وTrace بدون شرح شفهي.
5. وضوح CTA والخطوة التالية.
6. نجاح RTL وMobile وKeyboard.
7. اجتياز Performance gates.
8. عدم وجود Testimonials أوClaims غير مثبتة.
9. اتصال Forms بالـCRM أومسار Follow-up موثوق.
10. اختبار كامل من Landing حتى Demo booking.

## 27. القرار النهائي

- تجربة الموقع المعتمدة هي **اتبع الأثر — Follow the Trace**.
- الصفحة الرئيسية تتبع عملية حقيقية بدل عرض Feature grid.
- الرسالة الرئيسية: **تعرف رقم مخزونك. أثر تريك لماذا أصبح هكذا.**
- الـCTA الأساسي قبل الإطلاق العام: **احجز مراجعة تشغيل**.
- Product evidence يسبق الادعاءات.
- لا صور أوMockups أوAnimation لا تضيف معنى.
- لا Public checkout قبل جاهزية التشغيل والدعم والفوترة.
- الموقع يتطور مع مراحل السوق: Interviews ثم Pilot ثم Paid Beta ثم Public Launch.

---

# ATHR Launch & Sales Plan — v1.0

الحالة: **Approved**

## 1. مبدأ الإطلاق

أثر لا تبدأ بإطلاق عام واسع.

تبدأ بهذا التسلسل:

```
Market Interviews
→ Design Partners
→ Private Pilot
→ Paid Beta
→ Egypt Public Launch
```

الهدف ليس جمع Signups كثيرة، بل إثبات أن أثر:

- تحل مشكلة مدفوعة.
- تعمل في متجر حقيقي.
- تمنع فقد أوتكرار العمليات.
- تجعل المخزون مفهومًا وقابلًا للتتبع.
- يمكن بيعها وتشغيلها ودعمها بدون تدخل مطور في كل مرة.

## 2. العميل الأول المثالي

أول عميل مناسب لأثر:

- متجر ملابس أوأحذية أوإكسسوارات أومستحضرات تجميل.
- لديه 1–3 Locations.
- لديه مخزن فعلي أوحركة بضاعة منتظمة.
- يستخدم Variants مثل المقاس واللون.
- لديه على الأقل جهاز POS واحد.
- يعاني من اختلاف المخزون أوضعف الجرد أوتأخر معرفة ما حدث.
- صاحب القرار قريب من التشغيل ويمكن مقابلته أسبوعيًا.
- يقبل تغيير خطوات العمل السيئة بدل طلب نسخ نظامه القديم بالكامل.
- لديه استعداد للدفع مقابل حل موثوق.

نرفض أو نؤجل:

- متجر يريد برنامجًا مجانيًا فقط.
- نشاط مطاعم أوخدمات لا يطابق الـICP.
- عميل يطلب محاسبة عامة أوHR كاملة قبل التشغيل الأساسي.
- عميل لا يملك بيانات أوفريقًا يستطيع الالتزام بالـPilot.
- عميل يريد Custom development خاصًا به كشرط للدخول.
- متجر عالي الخطورة لا يسمح بCanary أوRollback أوTesting منظم.

## 3. المشكلة التي نبيعها

لا نبيع قائمة Features.

نبدأ بالمشكلة:

> أنت تعرف رقم المخزون، لكن هل تعرف لماذا أصبح هذا الرقم؟
> 

ثم نثبت أثر:

- كل بيع محفوظ.
- إعادة المحاولة لا تنشئ فاتورة ثانية بلا كشف.
- كل حركة مخزون لها مصدر ووقت ومنفذ ومرجع.
- العمل يستمر عند انقطاع الإنترنت.
- الإدارة ترى ما يحتاج تدخلًا بدل مراجعة جداول طويلة.

الرسالة البيعية الأساسية:

> **أثر لا تسجل المخزون فقط؛ تثبت ما حدث له.**
> 

الرسالة المبسطة:

> **بيعك محفوظ، ومخزونك مفهوم.**
> 

## 4. عرض القيمة حسب الشخص

### صاحب المتجر

- يعرف أين توجد الخسارة أوالاختلاف.
- يراقب الفروع والأجهزة من مكان واحد.
- يقل اعتماده على سؤال كل موظف عما حدث.
- يحصل على دليل بدل التخمين.

### مدير العمليات

- يرى الاستثناءات والعمليات المعلقة.
- يتابع الاستلام والتحويل والجرد.
- يعرف المسؤول والوقت والحالة.
- يستخدم Recovery commands بدل SQL أوتعديل عشوائي.

### الكاشير

- يبيع بسرعة.
- يفهم حالة الاتصال والمزامنة.
- لا يعيد تسجيل فاتورة محفوظة.
- يحصل على رسائل واضحة عند المشكلة.

### مسؤول المخزن

- يستلم ويمسح ويتابع البضاعة بخطوات واضحة.
- يعرف ما تم شحنه وما تم استلامه وما اختلف.
- ينفذ الجرد والتسوية بسجل مثبت.

## 5. مراحل الذهاب إلى السوق

### المرحلة A — Market Interviews

**الهدف:** فهم المشكلة والسعر والاعتراضات قبل البيع.

**العدد:** 15–20 مقابلة.

**المطلوب:**

- 10 مقابلات على الأقل من القطاع الأول نفسه.
- مقابلات مع Owner وOperations/Warehouse roles.
- تسجيل النظام الحالي والتكلفة والبدائل.
- قياس تكلفة الخطأ أوالفقد أوالتعطل.
- اختبار الرسالة والأسعار والباقات.

**المخرج:**

- Validated ICP.
- Top three paid pains.
- Feature expectations.
- Pricing range.
- Objection map.
- أول قائمة Design Partners محتملين.

### المرحلة B — Design Partners

**العدد:** 5–8 متاجر.

Design Partner لا يستخدم المنتج في التشغيل الحي بعد؛ بل يساعد على مراجعة:

- رحلة البيع.
- إدخال المنتجات والـVariants.
- الاستلام والتحويل والجرد.
- رسائل الخطأ.
- التسعير والعقد والدعم.

المقابل الممكن:

- أولوية للـPilot.
- سعر Founding customer.
- تأثير حقيقي على العمليات الأساسية.

لا نعد بتنفيذ كل طلب.

### المرحلة C — Private Pilot

**العدد:** 3–5 متاجر.

**المدة:** أسبوعان على الأقل لكل متجر، والأفضل 4 أسابيع.

**الشروط:**

- استخدام فعلي.
- اتفاق Pilot مكتوب.
- دفع رمزي أوخصم واضح، وليس مجانيًا بالكامل.
- جهاز وLocation محددان كبداية.
- Weekly review.
- قياس Offline events وSync وInventory differences.

### المرحلة D — Paid Beta

**العدد:** 10–25 Tenant.

**المطلوب:**

- أسعار فعلية.
- Monthly وAnnual options.
- Onboarding process قابل للتكرار.
- Support workflow.
- Monitoring وBackups.
- Billing cycle وتجديد حقيقي.

### المرحلة E — Egypt Public Launch

لا يبدأ قبل نجاح الـPaid Beta Gates.

يتضمن:

- موقع عام.
- Pricing معتمد أوSales-assisted pricing واضح.
- Trial أوDemo flow.
- عقود وشروط وسياسات.
- دعم وتدريب.
- Partner strategy.
- Customer success process.

## 6. استراتيجية الوصول لأول العملاء

الترتيب المعتمد:

### 1. Warm Network

- أصحاب متاجر معروفون مباشرة أوعن طريق معارف موثوقين.
- موردو أجهزة POS وطابعات وBarcode scanners.
- محاسبون ومستشارو Retail.
- مطورو متاجر سابقة أوشركات تنفيذ محلية.

هذا أسرع مصدر للمقابلات والـPilot لأن الثقة موجودة.

### 2. Field Outreach

زيارة مناطق ومحلات مستهدفة بعد إعداد قائمة مسبقة.

لا ندخل برسالة “عندي برنامج كاشير”.

نبدأ بسؤال:

> لما رقم المخزون يختلف، بتعرفوا السبب إزاي؟
> 

### 3. Targeted WhatsApp and Phone

رسائل قصيرة شخصية، لا Bulk spam.

المطلوب:

- اسم المتجر.
- سبب واضح لاختياره.
- سؤال مرتبط بالمشكلة.
- طلب مقابلة قصيرة، لا طلب شراء مباشر.

### 4. Referral Loop

بعد نجاح أول Store:

- نطلب ترشيح متجر مشابه.
- نقدم شهرًا أوCredit محدودًا بعد تحويل ناجح.
- لا ندفع عمولة قبل تحقق العميل ودفعه.

### 5. Hardware and Service Partners

الشركاء المحتملون:

- مورّدو POS hardware.
- شركات Barcode وlabels.
- محاسبون ومستشارو مخزون.
- شركات تنفيذ Retail صغيرة.

لا نفتح Partner program عام قبل وجود:

- Demo ثابت.
- Pricing واضح.
- Margin policy.
- Support boundaries.
- Lead attribution.

## 7. رحلة البيع

```
Qualified Lead
→ Discovery
→ Workflow Review
→ Tailored Demo
→ Pilot Fit
→ Proposal
→ Pilot
→ Review
→ Paid Subscription
→ Onboarding
→ Activation
```

### Qualification

الأسئلة الأساسية:

- القطاع؟
- عدد الفروع والمخازن والأجهزة؟
- النظام الحالي؟
- أكبر مشكلة في البيع أوالمخزون؟
- من صاحب القرار؟
- لماذا يبحث الآن؟
- هل لديه استعداد لتغيير النظام؟
- هل الميزانية موجودة؟

### Discovery

لا نقدم Demo أولًا.

نفهم:

- رحلة المنتج من الشراء حتى البيع.
- أين تُكتب البيانات مرتين؟
- أين تحدث الفروق؟
- ماذا يحدث عند انقطاع الإنترنت؟
- كيف يجري الجرد؟
- كيف تُعالج الفاتورة أوالحركة المعلقة؟

### Demo

الـDemo يركز على 3 قصص فقط:

1. بيع Offline ثم Sync آمن.
2. تتبع حركة منتج ومعرفة سبب الرصيد.
3. تحويل أو استلام يظهر أثر كل خطوة.

لا نستعرض كل القوائم والـSettings.

### Proposal

يشمل:

- المشكلة المتفق عليها.
- Scope واضح.
- Plan وLimits.
- Onboarding وMigration.
- Hardware إن وجد كبند منفصل.
- Pilot criteria.
- السعر والدفع.
- Support boundaries.
- ما هو Deferred أوOut of scope.

## 8. شكل الـDemo

مدة الـDemo الموصى بها: 25–35 دقيقة.

```
5 دقائق: إعادة صياغة المشكلة
15 دقيقة: قصة تشغيل حقيقية
5 دقائق: Control وTrace/Audit
5 دقائق: خطة Pilot والخطوة التالية
```

قواعد:

- نستخدم بيانات تشبه قطاع العميل.
- لا نستخدم Lorem Ipsum.
- لا نفتح شاشات غير جاهزة.
- لا نخفي Offline أوPending states.
- لا ندعي Feature غير موجودة.
- نوضح بصدق ما هو Pilot وما هو Roadmap.

## 9. عرض الـPilot

### Founding Pilot

- Plan مخفض 50% لمدة 3 أشهر.
- Onboarding أساسي بدون رسوم.
- 1 Location و1–2 Terminals كبداية.
- Weekly feedback session.
- Support قريب خلال ساعات العمل المتفق عليها.
- قياس واضح للنجاح.

### Pilot Success Criteria

- أول بيع Online ناجح.
- بيع Offline ثم Sync ناجح.
- لا Duplicate invoices في سيناريوهات الاختبار والتشغيل.
- كل Inventory movement لها مرجع.
- استلام وتحويل أوجرد حقيقي حسب Scope.
- المستخدمون الأساسيون يستطيعون العمل دون المطور.
- لا Data loss.
- اختلافات المخزون يمكن تفسيرها أوتسجيلها كCase واضح.
- العميل يوافق على الانتقال إلى اشتراك مدفوع كامل.

### Pilot Exit

ثلاث نتائج فقط:

- **Convert:** الانتقال إلى اشتراك.
- **Extend once:** تمديد محدود بسبب سبب موثق.
- **Stop:** إيقاف منظم وتصدير البيانات.

لا يبقى Pilot مفتوحًا بلا نهاية.

## 10. الاعتراضات والردود

### “برنامج الكاشير الحالي أرخص”

> صحيح، أثر ليست مجرد تسجيل بيع. قيمتها تظهر عندما تحتاج تعرف لماذا اختلف المخزون، ماذا حدث أثناء انقطاع الإنترنت، وهل تكررت العملية أم لا.
> 

### “عايز محاسبة كاملة”

> أثر تركز على تشغيل الـRetail وسلامة البيع والمخزون. يمكن التكامل أوالتصدير للمحاسبة، لكننا لا نحول المنتج إلى ERP عام في هذه المرحلة.
> 

### “الموظفين مش هيفهموه”

> كل Workspace تعرض ما يحتاجه الدور فقط، ورسائل الحالة توضح ما حدث وما الخطوة التالية. الـPilot يقيس ذلك مع فريقك قبل الالتزام الكامل.
> 

### “الإنترنت عندنا ضعيف”

> هذا أحد أسباب تصميم أثر. البيع يُحفظ محليًا ويزامن بأمان عند عودة الاتصال، مع حالة واضحة تمنع إعادة تسجيله.
> 

### “بياناتي هتبقى عندكم”

> بيانات كل مؤسسة معزولة، والدخول للدعم مؤقت ومسجل، ولديك حق التصدير وفق السياسة المعتمدة.
> 

### “نفذوا Feature خاصة وبعدين نشتري”

> نراجع هل الطلب يخدم السوق الأساسي. الـPilot لا يتحول إلى مشروع Custom؛ نعتمد فقط ما يطابق المنتج ويمنع خطرًا تشغيليًا حقيقيًا.
> 

### “مش هدفع Setup”

> الاشتراك للمنتج، أما تنظيف البيانات والاستيراد والتدريب فهي خدمة منفصلة. يمكن استخدام Template قياسي لتقليل التكلفة عندما تكون البيانات جاهزة.
> 

## 11. المواد البيعية المطلوبة

قبل أول Pilot:

- One-page product overview.
- Discovery questionnaire.
- Demo script.
- Pilot agreement.
- Pricing sheet.
- Scope and exclusions sheet.
- Data import template.
- Hardware compatibility list.
- Onboarding checklist.
- Support expectations.
- Security and data handling summary.
- ROI worksheet بسيط.

قبل Paid Beta:

- Case study واحدة على الأقل.
- Customer quote موثق.
- Objection handling guide.
- Sales CRM pipeline.
- Proposal template.
- Renewal and expansion playbook.

## 12. حساب القيمة للعميل

لا نعتمد على ROI مبالغ فيه.

نحسب مع العميل:

```
تكلفة اختلاف المخزون
+ وقت الجرد والتصحيح
+ خسارة توقف البيع
+ وقت الإدارة في التتبع اليدوي
+ خطر الفواتير المكررة أوالمفقودة
```

ثم نقارنها بتكلفة أثر.

لا ندعي توفير رقم إلا إذا أعطى العميل بياناته أوتم قياسه في Pilot.

## 13. Pipeline ومراحل الـCRM

المراحل المعتمدة:

- Target.
- Contacted.
- Discovery Booked.
- Qualified.
- Demo Completed.
- Pilot Proposed.
- Pilot Active.
- Commercial Review.
- Won.
- Lost.
- Nurture.

كل Opportunity تسجل:

- ICP fit.
- Pain.
- Current system.
- Locations/Terminals/Seats.
- Decision maker.
- Budget range.
- Timing.
- Objections.
- Next step وتاريخه.
- Lost reason عند الإغلاق.

## 14. مقاييس الإطلاق

### Market Validation

- عدد المقابلات.
- نسبة من يذكرون نفس المشكلة بدون تلقين.
- Willingness to pay.
- Current solution and switching reason.
- عدد Design Partners المؤهلين.

### Sales

- Discovery-to-demo rate.
- Demo-to-pilot rate.
- Pilot-to-paid conversion.
- Sales cycle length.
- Average first contract value.
- Lost reasons.

### Activation

- Time to first product import.
- Time to terminal enrollment.
- Time to first shift.
- Time to first sale.
- Time to first successful sync.
- المستخدمون النشطون حسب الدور.

### Product Reliability

- Sync success rate.
- Duplicate prevention events.
- Outbox age.
- Crash-free sessions.
- Negative stock cases.
- Reconciliation differences.
- Support incidents per store.

### Retention

- Weekly active stores.
- Renewal intent.
- Paid renewal.
- Expansion to extra terminal/location.
- Churn reason.

## 15. Gates الانتقال

### من Interviews إلى Design Partners

- 15 مقابلة على الأقل.
- مشكلة متكررة وقابلة للدفع.
- 5 متاجر مناسبة مستعدة للاستمرار.

### من Design Partners إلى Private Pilot

- Stage 1 reliability مغلقة.
- Pilot workflow جاهز.
- Onboarding وSupport plan جاهزان.
- عقد وScope واضحان.

### من Private Pilot إلى Paid Beta

- 3 متاجر فعلية على الأقل.
- أسبوعان أوأكثر من التشغيل لكل Pilot.
- لا Data loss أوDuplication غير محلولة.
- عميلان على الأقل مستعدان للدفع الكامل.
- Onboarding قابل للتكرار.

### من Paid Beta إلى Public Launch

- 10 Tenants مدفوعين أوما يعادلها من دليل قوي.
- دورة Renewal واحدة على الأقل.
- Billing وSupport وBackups وMonitoring جاهزة.
- Case studies.
- Public legal/pricing/support content جاهز.
- لا P0 مفتوح يؤثر على البيع أوالعزل أوالمزامنة.

## 16. قواعد تمنع الإطلاق الوهمي

لا نعلن Public Launch بسبب:

- اكتمال الموقع فقط.
- اكتمال الشعار.
- وجود زر Signup.
- نجاح Demo داخلي.
- عدد Followers.
- وجود Features كثيرة.

الإطلاق الحقيقي يعني:

- عميل يدخل.
- يتم Onboarding.
- يشغل جهازًا.
- يبيع ويزامن.
- يدفع.
- يحصل على دعم.
- يجدد أويوسع.

## 17. دور الموقع في كل مرحلة

### قبل Pilot

Landing page بسيطة:

- المشكلة.
- لمن أثر.
- كيف تختلف.
- طلب مقابلة أوDemo.

لا نحتاج Public checkout.

### أثناء Paid Beta

- Product pages.
- Use cases.
- Pricing أوRequest pricing.
- Demo booking.
- Help and status.
- Login.

### Public Launch

- Signup أوSales-assisted onboarding.
- Checkout عند الجاهزية.
- Legal pages.
- Case studies.
- Integrations.
- SEO content.

## 18. القرار النهائي

- نبدأ بمقابلات السوق، لا بإعلانات واسعة.
- أول Channel هو العلاقات الدافئة والزيارات والشركاء المحليون.
- نبيع مشكلة اختلاف المخزون وسلامة التشغيل، لا Feature list.
- الـDemo مبني على 3 قصص تشغيل حقيقية.
- الـPilot مدفوع أوذو التزام مالي واضح، وله بداية ونهاية وSuccess criteria.
- لا Public Launch قبل نجاح Paid Beta ودورة دفع وتجديد وتشغيل حقيقية.
- النجاح ليس عدد التسجيلات؛ النجاح هو متجر يبيع ويزامن ويفهم مخزونه ويدفع ويجدد.

---

# ATHR Pricing Architecture — v1.0

الحالة: **Architecture Approved — Public Price Points Require Market Validation**

الهيكل التجاري معتمد، أما الأرقام التالية فهي **فرضية تسعير للـPilot والمقابلات** وليست سعر إطلاق نهائيًا. لا تُحوّل إلى أسعار عامة أوتُثبت داخل الكود قبل Pricing Interviews والـPrivate Pilot.

## 1. فلسفة التسعير

أثر لا تنافس باعتبارها الأرخص، ولا تفرض سعر ERP عام.

المبدأ:

> يدفع العميل مقابل حجم تشغيله وتعقيده، وليس مقابل كل عملية بيع.
> 

معادلة الاشتراك:

```
Plan Base
+ Extra Locations
+ Extra Terminals
+ Extra Active Seats
+ Optional Onboarding or Migration Services
```

لا توجد:

- عمولة على المبيعات.
- رسوم على عدد الفواتير.
- رسوم على كل مزامنة.
- رسوم منفصلة على الأمان أوالـOffline.
- رسوم مخفية لاسترجاع بيانات العميل.

## 2. لماذا لا نسعّر لكل مستخدم فقط؟

المتجر قد يحتاج عددًا من الكاشير والعاملين مع هامش منخفض، والتسعير الكامل لكل مستخدم يعاقب العميل على تنظيم صلاحياته.

لذلك:

- الخطة تتضمن عددًا مناسبًا من Active Seats.
- الزيادة تُباع في Bundles بسيطة.
- Location وTerminal هما محورا التوسع الأساسيان.
- عدد المنتجات والفواتير لا يستخدم كعقوبة تسعيرية في البداية.

## 3. ما الذي لا يُحجب عن أي خطة مدفوعة؟

العناصر التالية جزء من وعد أثر ولا تتحول إلى Upsell:

- Tenant isolation.
- Sale idempotency ومنع التكرار.
- Offline sale والحفظ المحلي الآمن.
- Sync safety وreplay protection.
- Security updates.
- Backup الأساسي وسياسة الاستعادة.
- Audit أساسي للعمليات الحرجة.
- تصدير بيانات العميل عند الإلغاء.
- رسائل حالة واضحة بدل الأخطاء التقنية المجردة.

نبيع التوسع والعمق التشغيلي، ولا نبيع السلامة كإضافة.

## 4. الباقات المقترحة

### بداية

**العميل:** متجر واحد يبدأ ضبط البيع والمخزون.

**فرضية السعر:**

- `1,490 EGP / month`
- `14,900 EGP / year` عند الدفع مقدمًا.

**المشمول:**

- 1 Location.
- 1 Warehouse.
- 1 POS Terminal.
- 3 Active Seats.
- Cashier Workspace.
- Warehouse Workspace الأساسية.
- ATHR Control الأساسي.
- المنتجات والـVariants والـBarcode.
- البيع والمرتجعات الأساسية.
- الموردون والاستلام الأساسي.
- حركة المخزون وسجلها.
- Offline وSync وTrace Rail.
- التقارير التشغيلية الأساسية.

**غير المشمول:**

- تشغيل عدة Locations.
- سياسات موافقات متقدمة.
- API access.
- Support priority.

### تشغيل

**العميل:** متجر مستقر لديه فريق ومخزن وعمليات يومية أكثر عمقًا.

**فرضية السعر:**

- `2,490 EGP / month`
- `24,900 EGP / year` عند الدفع مقدمًا.

**المشمول:**

- 1 Location.
- 2 Warehouses.
- 2 POS Terminals.
- 8 Active Seats.
- جميع Workspaces: Cashier وWarehouse وSupervisor.
- المشتريات والاستلام ومرتجعات الموردين.
- التحويلات بين المخازن.
- الجرد والتسويات والمطابقة.
- صلاحيات وScopes أعمق.
- Audit وتشخيص وتنبيهات تشغيلية.
- تقارير أكثر تفصيلًا.
- دعم عادي بقنوات العمل المعتمدة.

هذه هي الخطة التي نوصي بها لمعظم العملاء المستهدفين.

### امتداد

**العميل:** نشاط متعدد الفروع يحتاج تحكمًا مركزيًا.

**فرضية السعر:**

- `4,490 EGP / month`
- `44,900 EGP / year` عند الدفع مقدمًا.

**المشمول:**

- 3 Locations.
- 5 Warehouses.
- 5 POS Terminals.
- 20 Active Seats.
- جميع Workspaces وATHR Control الكامل.
- التحويلات متعددة الفروع والاستلام الجزئي.
- سياسات موافقات وتشغيل متقدمة.
- تقارير موحدة بين الفروع.
- Advanced Audit وExports.
- API access عند جاهزيته.
- تنبيهات صحة الأجهزة والمزامنة.
- Priority support وفق SLA يتم اعتماده لاحقًا.

## 5. الإضافات المقترحة

الأسعار التالية فرضيات اختبار:

- Extra Location: `900 EGP / month`.
- Extra POS Terminal: `350 EGP / month`.
- Extra Warehouse: `300 EGP / month`.
- 5 Extra Active Seats: `500 EGP / month`.

القواعد:

- لا نبيع Seat واحدة كل مرة؛ نستخدم Bundles لتبسيط الفاتورة.
- يمكن شراء Extras بدون الانتقال لخطة أعلى ما لم يحتج العميل Entitlement خاصًا بالخطة.
- النظام يقترح الترقية عندما تصبح الخطة الأعلى أوفر للعميل.
- لا يحدث Upgrade تلقائيًا دون موافقة واضحة.

## 6. تعريف وحدات الفوترة

### Location

مكان تجاري فعلي يبيع أويدير عمليات مستقلة، وله Code وScope وتقارير خاصة.

### Warehouse

موقع مخزون مستقل يحتاج رصيدًا وحركات وجردًا منفصلًا. قد يكون داخل Location أومخزنًا مركزيًا.

### Terminal

جهاز POS مسجل وله Device Identity وTerminal Lease فعال.

- الجهاز الملغى أوالمستبدل لا يظل محسوبًا بعد تطبيق سياسة الإلغاء.
- إعادة تثبيت التطبيق على الجهاز نفسه لا تنشئ فوترة مزدوجة.

### Active Seat

Tenant Membership نشطة تسمح بالدخول إلى منتج من منتجات العميل.

- المستخدم الذي ينتمي لأكثر من Location داخل نفس Tenant يُحسب Seat واحدة.
- Platform operators لا يُحسبون على العميل.
- Support access المؤقت لا يُحسب Seat.
- Pending invitation تحجز Seat مؤقتًا وفق مدة يحددها Plan policy.
- الحساب Deactivated لا يُحسب مع الحفاظ على الـAudit history.

## 7. التجربة والـPilot

### Guided Trial

- 14 يومًا.
- تبدأ بعد اكتمال الإعداد الأساسي وTerminal enrollment، وليس عند إنشاء الحساب فقط.
- تشمل 1 Location و1 Terminal و3 Seats.
- لا تتطلب بطاقة في أول مرحلة، لكن تتطلب بيانات عميل حقيقية واتفاق استخدام.
- يتوقف إنشاء عمليات جديدة بعد انتهاء التجربة وفق Grace policy، دون إتلاف البيانات أوإيقاف عملية بدأت بالفعل.

### Founding Pilot Offer

للـ3–5 متاجر الأولى:

- خصم 50% لمدة 3 أشهر على الخطة المختارة.
- إعفاء من رسوم الإعداد القياسي.
- التزام بجلسة Feedback أسبوعية ومشاركة البيانات التشغيلية المتفق عليها.
- لا نقدم Pilot مجانيًا بالكامل؛ يجب اختبار استعداد العميل للدفع.
- لا يتحول خصم الـPilot إلى سعر عام دائم.

## 8. Onboarding والخدمات

الاشتراك لا يشمل تلقائيًا أي مشروع Migration غير محدود.

### Guided Setup

**فرضية:** `3,500 EGP` مرة واحدة.

يشمل:

- إعداد المؤسسة وأول Location وWarehouse.
- إعداد الضرائب والإيصال وفق المتاح.
- استيراد Catalog قياسي من Template معتمد.
- Enrollment لأول Terminal.
- Printer test.
- تدريب أساسي وجلسة Go-live.

### Data Migration

**يبدأ من:** `6,500 EGP`.

يتحدد حسب:

- جودة البيانات.
- عدد المنتجات والـVariants.
- عدد العملاء والموردين.
- التاريخ المطلوب نقله.
- عدد الفروع.
- الحاجة إلى تنظيف أوMapping خاص.

### Hardware

- يباع منفصلًا أوعن طريق Partner.
- لا يختلط سعر الأجهزة بالاشتراك.
- الضمان والصيانة والتوصيل تُوضح كبنود مستقلة.

## 9. الدفع السنوي والشهري

- الشهري يعطي مرونة أكبر.
- السنوي مقدمًا يعادل شهرين مجانيين تقريبًا.
- لا نقدم خصمًا سنويًا أكبر في البداية حتى نفهم تكلفة الدعم.
- الأسعار المعروضة لا تشمل الضرائب المطبقة إلا بعد اعتماد الصياغة المالية والقانونية.
- لا توجد عقود طويلة مخفية؛ شروط الإلغاء والاسترداد توضح قبل الدفع.

## 10. Upgrade وDowngrade

### Upgrade

- فوري بعد موافقة العميل والدفع أوتسوية الفرق.
- Limits الجديدة تطبق فورًا.
- لا تحتاج Deploy أوتعديل يدوي في قاعدة البيانات.

### Downgrade

- يطبق في دورة الفوترة التالية غالبًا.
- لا نحذف Locations أوUsers أوبيانات تتجاوز Limits الجديدة.
- نطلب من العميل خفض الاستخدام أوتحديد العناصر التي تصبح Read-only.
- تظل البيانات قابلة للتصدير.

### Failed Payment

- لا نوقف Sale بدأت بالفعل.
- نستخدم Grace period وتحذيرات واضحة.
- نقيّد الميزات غير الحرجة تدريجيًا وفق سياسة مكتوبة.
- لا نفقد Outbox أوعمليات غير متزامنة بسبب الفوترة.

## 11. استراتيجية السعر

أثر تتمركز بين:

- POS مجاني أومنخفض السعر يبيع Advanced Inventory والصلاحيات كإضافات.
- حلول دولية تُسعّر لكل Location أوUser بأسعار أعلى.
- منصات إقليمية قوية تبدأ من عدة آلاف من الجنيهات شهريًا.

لقطة السوق الرسمية بتاريخ 2026-07-29:

- Loyverse: POS مجاني، وUnlimited History بسعر 5 USD، وإدارة الموظفين والمخزون المتقدم بسعر 25 USD لكل إضافة لكل متجر شهريًا.
- Shopify: Basic بسعر 39 USD شهريًا، وPOS Pro إضافة بسعر 89 USD لكل Location شهريًا.
- Odoo: Standard بسعر 24.90 USD لكل مستخدم شهريًا عند الدفع السنوي في العرض المعلن.
- Foodics Egypt: Basic Bundle بسعر 2,848.95 EGP شهريًا عند الدفع السنوي، وAdvanced بسعر 3,733.67 EGP.

لا تُنسخ أسعار المنافسين؛ تستخدم فقط للتحقق من أن أثر ليست منخفضة لدرجة تضعف الدعم، ولا مرتفعة قبل إثبات القيمة.

## 12. ما يجب اختباره في مقابلات السوق

لكل عميل محتمل نسجل:

- ما النظام الحالي وتكلفته الكاملة؟
- عدد Locations وTerminals والمستخدمين.
- تكلفة اختلاف المخزون أوتعطل البيع.
- هل يفضل شهريًا أم سنويًا؟
- هل يقبل رسوم Onboarding؟
- هل يفهم الفرق بين Terminal وSeat وLocation؟
- أي خطة يختار بدون خصم؟
- عند أي سعر يبدأ التردد؟
- عند أي سعر يشك أن المنتج ضعيف؟
- ما الخدمة التي يتوقعها داخل الاشتراك؟

لا نعتمد Public Pricing قبل 10 مقابلات تسعير على الأقل، ولا نعتبر الفرضية قوية قبل 15–20 مقابلة ونتائج الـPilot.

## 13. قواعد التنفيذ البرمجي

- الأسعار تُخزّن في Price Books وPlan Versions، لا Constants داخل الكود.
- كل Market له Currency وTax behavior وPrice Book مستقل.
- PlanVersion غير قابلة للتعديل بعد استخدامها؛ ينشأ Version جديد.
- الاشتراكات الحالية لا تتغير دون Migration أوGrandfathering policy صريحة.
- Permission وEntitlement وLimit كيانات منفصلة.
- Limits تُفرض Transactionally من الـBackend.
- كل Webhook Billing يُعالج Idempotently.
- SalesInvoice لا تختلط بـBillingInvoice.

## 14. القرار النهائي

- نموذج الفوترة المعتمد: Plan + Locations + Terminals + Seat Bundles + Services.
- لا عمولة على المبيعات.
- لا Free Forever plan في الإطلاق الأول.
- الباقات المقترحة: بداية، تشغيل، امتداد.
- خطة تشغيل هي الباقة الأساسية الموصى بها.
- الأمان والـOffline ومنع التكرار ليست Extras.
- أرقام الأسعار فرضية قابلة للتغيير بعد المقابلات والـPilot.
- لا يبدأ Billing implementation بافتراض أن هذه الأرقام نهائية؛ يبدأ من PlanVersion وPrice Book architecture.

---

# ATHR Visual Identity System — v1.0

الحالة: **Direction Approved — Final Vector Masters Pending**

هذه الوثيقة تعتمد النظام البصري، لكنها لا تعتمد أي شعار مولّد كملف نهائي. كل Logo Master وIcon Master يجب أن يُرسم Vector يدويًا، ويُختبر بالعربية والإنجليزية وبالأحجام الصغيرة قبل الإنتاج.

## 1. الفكرة البصرية

الهوية تُبنى على ثلاث لحظات:

```
نقطة بداية
→ مسار حركة
→ أثر مثبت
```

المعنى:

- كل عملية تبدأ من مصدر واضح.
- كل عملية تتحرك عبر مراحل يمكن تتبعها.
- كل عملية تترك نتيجة ودليلًا.

لا نستخدم أثر قدم أوFingerprint أوBarcode كرمز مباشر؛ لأنها حلول حرفية ومستهلكة. الرمز يجب أن يكون تجريديًا وبسيطًا ويُفهم كمسار ونتيجة حتى لو لم يقرأ المستخدم الاسم.

## 2. نظام الشعار

### Primary Arabic Wordmark

الكلمة الأساسية:

> **أثر**
> 

تُرسم بحروف عربية مخصصة وليست كتابة بخط جاهز.

المطلوب:

- وضوح كامل عند الأحجام الصغيرة.
- توازن بين الألف والهمزة والثاء والراء.
- استخدام الهمزة والنقاط كجزء من مفهوم البداية والمسار.
- عدم تحويل الحروف إلى شكل زخرفي يصعب قراءته.
- عدم تقليد الخط الكوفي التقليدي أوالخطوط التقنية الهندسية الجاهزة.

### Latin Wordmark

> **ATHR**
> 

يُرسم بحروف بسيطة وقوية مع مسافات محسوبة، ويظل تابعًا للهوية العربية لا بديلًا عنها.

### Trace Mark

الرمز المستقل يسمى:

> **Trace Mark**
> 

يتكون بصريًا من:

- نقطة أومصدر.
- مسار قصير واضح.
- نهاية مثبتة أوعلامة وصول.

يجب أن يعمل:

- داخل مربع App Icon.
- بلون واحد.
- بحجم 16px.
- على Hardware sticker.
- على الفاتورة الحرارية.
- كـFavicon.
- في الحركة بدون الاعتماد على النص.

### Lockups

النسخ المعتمدة:

- Arabic primary: أثر.
- English primary: ATHR.
- Bilingual horizontal lockup.
- Symbol-only.
- Monochrome positive.
- Monochrome reversed.

لا تُنشأ نسخة مختلفة لكل Product؛ المنتجات تستخدم اسمها بجانب العلامة الأم وفق نظام ثابت.

## 3. قاعدة الأصالة

أي ملف مولّد بالـAI أوصورة Concept:

- يستخدم للاستكشاف فقط.
- لا يُستخدم كشعار نهائي.
- لا يُسلّم كـSVG أوMaster asset.
- لا يُنسخ حرفيًا دون إعادة بناء هندسية واعية.

النسخة النهائية يجب أن تحتوي على:

- Construction grid.
- Optical corrections.
- Safe area.
- Minimum size.
- Pixel fitting للأيقونات الصغيرة.
- Arabic readability review.
- Similarity review ضد علامات موجودة.

## 4. الألوان الأساسية

### Trace Green

`#0E3B2E`

اللون الأساسي للعلامة، ويعبر عن الثبات والثقة والاستمرارية.

### Ink

`#1A1F23`

للنصوص والهيكل والمعلومات عالية الأهمية.

### Sand

`#E7D5B5`

لون دافئ للخلفيات والمواد المطبوعة والعناصر الهادئة.

### Paper

`#FAF7F2`

الخلفية الأساسية الفاتحة بدل الأبيض البارد.

### Olive

`#8A8F6A`

لون مساعد للسياقات الهادئة والبيانات الثانوية.

### Terracotta

`#C56A4A`

لون مساعد محدود يعبّر عن الأثر المادي والحركة، ولا يستخدم كلون خط صغير على الخلفيات الفاتحة.

### Slate

`#6B6F76`

للنصوص الثانوية والحدود والعناصر المحايدة.

## 5. قواعد استخدام اللون

- Trace Green وInk هما اللونان المسيطران.
- Sand وPaper يصنعان المساحة الدافئة.
- Terracotta Accent محدود، وليس Gradient دائمًا.
- ألوان النجاح والتحذير والخطأ وظيفية ومنفصلة عن ألوان الهوية.
- لا يعتمد معنى الحالة على اللون وحده؛ يجب وجود نص أوIcon.
- لا تستخدم Gold effects أوMetallic gradients لإظهار الفخامة.
- لا تستخدم Purple/Blue AI gradients.

## 6. الخطوط

### Product UI Arabic

**Alexandria**

- واضحة على الشاشات.
- مناسبة للعربية الحديثة.
- تعمل بأوزان محدودة.

### Product UI Latin and Numbers

**Inter**

- واضحة في الجداول والأرقام.
- تدعم Tabular Numerals.
- مناسبة للواجهات التشغيلية الكثيفة.

### Technical IDs

يُستخدم Mono font فقط عند عرض:

- Reference IDs.
- Device codes.
- Hashes.
- Logs أوdiagnostic values.

لا يستخدم الخط الأحادي في الرسائل اليومية أوالواجهات الرئيسية.

### Typography Rules

- ثلاثة أوأربعة مستويات Hierarchy كحد أقصى.
- لا تستخدم أكثر من 3 أوزان في الشاشة الواحدة.
- العربية والإنجليزية متساويتان بصريًا.
- الأرقام المالية والكميات بمحاذاة واضحة.
- العناوين قصيرة، والشرح في سطر منفصل.

## 7. نظام الأيقونات

الأيقونات:

- Line-based.
- بسمك موحد.
- نهايات واضحة وغير شديدة الاستدارة.
- تعمل في 16px و20px و24px.
- يصاحب الأيقونة نص في التنقل والإجراءات الحرجة.

اللغة الشكلية للأيقونات تستلهم:

- نقطة البداية.
- المسار.
- التحول.
- التأكيد.
- الارتباط بين العناصر.

ممنوع:

- 3D icons.
- Emojis كواجهة أساسية.
- Sparkles.
- Brain أوAI network.
- أيقونات Shopping عامة عند وجود فعل أدق.

## 8. العناصر الرسومية

### Trace Line

خط وظيفي أوتوضيحي يربط مراحل أوعناصر حقيقية.

### Trace Field

Pattern هادئ مبني من نقاط ومسارات غير متكررة ميكانيكيًا، ويستخدم في:

- أغلفة الوثائق.
- التغليف.
- Hardware stickers.
- صفحات التسويق المحدودة.

لا يوضع خلف الجداول أوالشاشات التشغيلية الكثيفة.

### Evidence Frame

إطار رفيع يحيط بالمعلومة التي تمثل دليلًا أوBefore/After أوAudit reference.

### Trace Cut

قطع صغير أوانقطاع مقصود في خط أوBorder يرمز إلى انتقال الحالة، ويستخدم باعتدال ليعطي شخصية للنظام بدون التأثير على القراءة.

## 9. الصور

الصور المعتمدة تكون:

- حقيقية.
- من بيئات Retail فعلية.
- تركز على المنتج والحركة واليد والجهاز والمخزن.
- بإضاءة طبيعية أودافئة.
- منظمة لكن غير مصطنعة.

نصور:

- Barcode scan حقيقي.
- استلام بضاعة.
- ترتيب منتجات وVariants.
- استخدام POS أثناء العمل.
- انتقال صنف بين موقعين.
- تفاصيل Hardware وreceipt وlabel.

لا نستخدم:

- موظفين يبتسمون أمام Laptop كصورة Stock.
- صور مكاتب تقنية عامة.
- Robots أوAI visual metaphors.
- صور شديدة التنظيف لا تشبه العمل الحقيقي.
- Mockups خيالية تخفي تفاصيل المنتج.

## 10. الرسوم التوضيحية

عند الحاجة إلى Illustration:

- تستخدم مسارات ونقاط ووحدات حقيقية من النظام.
- تشرح Flow أوState أوRelationship.
- لا تستخدم شخصيات كرتونية عامة.
- لا تستخدم مكتبات SaaS الجاهزة.
- لا تستخدم Isometric scenes للزينة.

الرسم يجب أن يشرح شيئًا لا تستطيع الصورة أوالواجهة شرحه بسهولة.

## 11. Motion Identity

الحركة الأساسية:

```
Point appears
→ Path moves
→ State resolves
→ Evidence remains
```

الاستخدامات:

- Logo reveal.
- Sync progress.
- Operation confirmation.
- Trace Rail transitions.
- Product onboarding.

القواعد:

- مدة الحركات المعتادة: 160–240ms.
- الحركات التوضيحية: حتى 400ms عند الحاجة.
- لا Bounce.
- لا Glow.
- لا حركة مستمرة في الخلفية.
- لا Confetti في عمليات مالية أومخزنية.
- دعم Reduced Motion إلزامي.

## 12. التطبيقات

النظام يجب أن يعمل على:

- ATHR Operations.
- ATHR Control.
- ATHR Platform.
- Marketing website.
- App icons.
- Desktop installer.
- Login and enrollment screens.
- Receipts.
- Labels.
- Hardware stickers.
- Packaging.
- Training materials.
- Social media.
- Status and help pages.

### Receipts

- Monochrome first.
- وضوح الاسم والمرجع.
- لا تعتمد على درجات رمادية ضعيفة.
- الرمز لا يستهلك مساحة على حساب بيانات الفاتورة.

### Hardware Stickers

- Symbol + device reference.
- Support or enrollment information عند الحاجة.
- مقاومة للطباعة الرديئة والأحجام الصغيرة.

### App Icons

- Trace Mark فقط.
- لا نص صغير داخل الأيقونة.
- اختلاف المنتجات يكون عبر Label أوContext، وليس بإعادة اختراع الرمز.

## 13. قواعد الـLayout

- Grid أساسي 8pt.
- Alignment صارم.
- Borders أوضح من Shadows.
- Radius معتدل، وليس كل شيء Pill.
- لا تستخدم Cards إلا عندما تمثل وحدة مستقلة فعلًا.
- المساحات البيضاء والدافئة جزء من الهوية، وليست مساحة مهدرة.
- التفاصيل التقنية لا تزاحم الرسالة الأساسية.

## 14. الممنوعات

- تغيير ألوان الشعار عشوائيًا.
- تمديد أوضغط الشعار.
- استخدام Shadow أوBevel أوEmboss.
- وضع الشعار فوق صورة مزدحمة.
- استخدام Gradient داخل الشعار الأساسي.
- إعادة رسم الحروف بخط جاهز.
- فصل نقاط الحروف أوالهمزة بطريقة تضر القراءة.
- استخدام أثر قدم أوFingerprint.
- تحويل الشعار إلى حرف A داخل مربع.
- إضافة كلمة AI أوSmart إلى الهوية.
- توليد نسخ كثيرة غير منضبطة لكل Product.

## 15. بوابة اعتماد الـLogo Master

لا يعتبر الشعار النهائي Done قبل:

1. رسم 3 اتجاهات Vector حقيقية.
2. اختبار القراءة بالعربية مع مستخدمين.
3. اختبار 16px و24px و32px.
4. اختبار Thermal receipt.
5. اختبار App icon وFavicon.
6. اختبار monochrome وreversed.
7. Similarity search وTrademark screening.
8. اختيار اتجاه واحد وإجراء Optical refinement.
9. تسليم SVG وPDF وPNG exports وقواعد الاستخدام.
10. تخزين Master files في مصدر تصميم رسمي، لا داخل صور Chat أوملفات عشوائية.

## 16. القرار النهائي

- الهوية دافئة، مادية، هادئة وواثقة.
- Arabic wordmark هو الأصل.
- Trace Mark هو الرمز التوقيعي.
- الألوان الرئيسية: Trace Green وInk مع Sand وPaper.
- النظام البصري يشرح الحركة والأثر والدليل.
- أي ناتج AI مرجع استكشاف فقط، ولا يصبح أصلًا نهائيًا.
- الخطوة التنفيذية التالية للهوية هي تصميم 3 Logo Directions يدويًا ثم اختبارها واختيار Master واحد.

---

# ATHR UX & Design Direction — v1.0

الحالة: **Approved**

## 1. الفكرة المركزية

اسم الاتجاه التصميمي:

> **واجهة الأثر — The Trace Interface**
> 

الواجهة لا تكتفي بعرض النتيجة؛ بل تجعل المستخدم يفهم بسرعة:

1. ماذا حدث؟
2. لماذا حدث؟
3. ما أثره؟
4. ما حالته الآن؟
5. ما الخطوة التالية؟

رسالة التصميم:

> **كل حركة لها أثر، وكل أثر يمكن فهمه.**
> 

الهدف أن يفهم المستخدم الخبير التفاصيل، ويفهم المستخدم غير التقني الحالة بدون معرفة المصطلحات الداخلية.

## 2. معيار النجاح

كل شاشة مهمة يجب أن تحقق:

- **يفهم خلال 3 ثوانٍ** ما الحالة الحالية.
- **يعرف خلال خطوة واحدة** ماذا يفعل بعدها.
- **يصل خلال ضغطة واحدة** إلى دليل ما حدث.

الترتيب المعتمد للمعلومة:

```
الحالة الآن
→ الأثر الناتج
→ الإجراء التالي
→ التفاصيل والدليل
```

لا تبدأ الشاشة بالتفاصيل التقنية أوالجداول الكبيرة قبل توضيح الحالة.

## 3. مستويات الفهم الثلاثة

### المستوى الأول — افهم

يظهر فورًا:

- اسم العملية أوالعنصر.
- حالتها بلغة بشرية.
- النتيجة الأساسية.
- هل يوجد خطر أوإجراء مطلوب؟

مثال:

> البيع محفوظ على الجهاز ولم يصل إلى السحابة بعد.
> 

### المستوى الثاني — تصرف

يظهر الإجراء الأنسب فقط:

- إعادة المحاولة.
- مراجعة الحركة.
- استكمال الاستلام.
- طلب موافقة.
- حل التعارض.

لا نعرض خمسة أزرار متساوية الأهمية.

### المستوى الثالث — أثبت

عند فتح التفاصيل، يظهر السجل الكامل:

- من نفذ؟
- متى؟
- من أي جهاز؟
- ما القيمة قبل وبعد؟
- ما المرجع؟
- هل تمت المزامنة؟
- ما الأحداث المرتبطة؟

هذا هو مستوى التدقيق والـAudit، ولا يفرض على المستخدم العادي في كل شاشة.

## 4. المكوّن المميز — Trace Rail

`Trace Rail` هو العنصر البصري والوظيفي الأساسي لأثر.

هو خط واضح يربط مراحل العملية بنقاط حالة، مثل:

```
تم إنشاء البيع
→ حُفظ على الجهاز
→ خُصم المخزون محليًا
→ أُرسل إلى السحابة
→ تم التأكيد
```

كل نقطة تعرض:

- الحالة.
- الوقت.
- الجهة المنفذة.
- النتيجة.
- سبب التعطل إن وجد.

يُستخدم في:

- المبيعات.
- المزامنة.
- التحويلات.
- الاستلام.
- المرتجعات.
- الجرد.
- الاشتراكات.
- Onboarding.
- Support access.

لا يُستخدم كزخرفة؛ يجب أن يعرض بيانات حقيقية دائمًا.

## 5. المكوّنات المميزة الأخرى

### Scope Anchor

شريط ثابت يوضح دائمًا نطاق العمل الحالي:

- المؤسسة.
- الفرع أوالموقع.
- المخزن.
- الوردية.
- الجهاز.

المستخدم لا ينفذ عملية داخل نطاق غير واضح.

### Sync Beacon

مؤشر حالة بسيط ودائم للمزامنة:

- متصل ومتزامن.
- متصل وهناك عمليات قيد الإرسال.
- غير متصل والعمليات محفوظة.
- يحتاج تدخلًا.

لا يستخدم كلمة `Online` وحدها؛ يوضح أثر الاتصال على العمل.

### Proof Sheet

لوحة جانبية أوصفحة تفاصيل تعرض دليل العملية بدون إخراج المستخدم من سياقه:

- Timeline.
- Before/After.
- Actor.
- Device.
- References.
- Related movements.

### Exception Stack

قائمة مرتبة للاستثناءات التي تحتاج تدخلًا، وفق:

1. ما يهدد البيع أوالبيانات.
2. ما يهدد المخزون.
3. ما يمنع المزامنة.
4. ما يحتاج موافقة.
5. ما هو مجرد تنبيه.

### Action Dock

منطقة إجراءات ثابتة تحتوي على:

- الإجراء الأساسي الواضح.
- إجراء ثانوي واحد أواثنين فقط.
- باقي الخيارات داخل قائمة إضافية.

## 6. بنية الشاشة

كل شاشة تشغيلية تتكون من:

```
Scope Anchor
Page Anchor: الاسم + الحالة + النتيجة
Primary Work Surface
Context / Proof Panel عند الحاجة
Action Dock
```

### Page Anchor

يجيب مباشرة عن:

- أين أنا؟
- ما الذي أتعامل معه؟
- ما حالته؟
- ما أهم رقم أوأثر؟

مثال فاتورة:

> فاتورة 1048 — محفوظة ومتزامنة — خُصم 4 قطع من فرع المعادي.
> 

## 7. التنقل

- التنقل حسب دور المستخدم، لا حسب كل Modules النظام.
- لا يظهر للمستخدم ما لا يستطيع أو لا يحتاج استخدامه.
- الحد الأقصى للعناصر الأساسية في التنقل اليومي: 5–7.
- Scope الحالي يظهر دائمًا ولا يختبئ داخل Settings.
- البحث الشامل يصل إلى فاتورة، منتج، عميل، حركة، جهاز، أوتحويل.
- التنقل لا يعتمد على أيقونات بلا نص.

### Cashier Workspace

لا تبدأ بـDashboard.

تبدأ مباشرة بسطح البيع:

- البحث والمسح.
- السلة.
- الإجمالي.
- حالة الوردية والاتصال والمزامنة.

كل ما لا يخدم البيع الحالي يبقى ثانويًا.

### Warehouse Workspace

تبدأ بـTask Queue واضحة:

- استلام منتظر.
- تحويل مطلوب شحنه.
- جرد مفتوح.
- مسودة غير مكتملة.
- تعارض يحتاج مراجعة.

الواجهة Scan-first وKeyboard-friendly، وليست Admin forms طويلة.

### Supervisor Workspace

تبدأ بالاستثناءات، لا بالمؤشرات العامة:

- ماذا يحتاج قرارًا الآن؟
- أين توجد عمليات معلقة؟
- ما الجهاز الذي لم يزامن؟
- ما الرصيد السلبي الذي يحتاج مراجعة؟

### ATHR Control

لا تكون شبكة Cards تقليدية.

تبدأ بـOperational Narrative:

```
ما حدث اليوم
ما يحتاج تدخلًا
أين يوجد اختلاف
ما الذي تغير عن المعتاد
```

ثم تسمح بالتعمق في التقارير والأرقام.

### ATHR Platform

واجهة كثيفة لكن هادئة، مرتبة حسب المخاطر التشغيلية:

- Billing failures.
- Provisioning failures.
- Sync incidents.
- Tenant risks.
- Support leases.

## 8. اللغة البصرية

اسم اللغة البصرية:

> **Ink, Sand & Trace**
> 

مستوحاة من الأثر الذي يظهر على سطح مادي، وليس من واجهات التقنية اللامعة.

### المبادئ

- خلفيات هادئة ودافئة بدل الأبيض الأزرق البارد.
- نص داكن قوي يشبه الحبر.
- لون مميز واحد للـTrace والحركة.
- ألوان الحالة تستخدم وظيفيًا فقط.
- الحدود والخطوط أهم من الظلال.
- المساحات واضحة ومقصودة.
- الزوايا متوسطة؛ لا تكون كل العناصر Pills أوCards دائرية.

### اتجاه الألوان

- **Ink:** فحمي داكن للنص والهيكل.
- **Sand:** درجات دافئة محايدة للخلفيات.
- **Trace:** درجة معدنية دافئة بين النحاس والطين تستخدم لتحديد المسار والهوية.
- **Status colors:** أخضر، أصفر، أحمر، وأزرق وظيفي فقط، ولا تصبح ألوان الهوية الرئيسية.

يتم تثبيت القيم النهائية في مرحلة Visual Identity، وليس باختيار Gradient جاهز.

## 9. الخطوط والأرقام

- العربية هي لغة أصلية في التصميم وليست ترجمة لاحقة.
- الخط العربي يجب أن يكون واضحًا ومهنيًا وغير زخرفي.
- الإنجليزية تتوافق بصريًا مع العربية بدون أن تطغى عليها.
- الأرقام المالية والكميات تستخدم Tabular Numerals.
- الأرقام المهمة أكبر وأوضح، لكن لا تتحول الصفحة إلى KPI poster.
- لا تستخدم أوزان خطوط كثيرة؛ Hierarchy واضحة بثلاثة أوأربعة مستويات كحد أقصى.

## 10. الأيقونات

- Line icons بسيطة بسمك موحد.
- الأيقونة تشرح الفعل أوالحالة، ولا تستخدم للزينة.
- كل أيقونة مهمة يصاحبها نص.
- يمكن أن تستلهم بعض الأيقونات فكرة المسار والنقطة والأثر.

ممنوع:

- Shopping cart كرمز للعلامة.
- Barcode كهوية رئيسية.
- Sparkles أوAI stars.
- Brain/network icons.
- أيقونات ثلاثية الأبعاد جاهزة.
- Emojis كبديل لنظام أيقونات المنتج.

## 11. الحركة والـMotion

الحركة توضح السبب والنتيجة:

- عند تسجيل عملية، يظهر انتقالها إلى حالتها التالية.
- عند المزامنة، تتحرك نقطة على Trace Rail نحو التأكيد.
- عند تغير كمية، يظهر الرقم السابق ثم الناتج الجديد بوضوح.
- عند فشل إجراء، لا تهتز الشاشة بلا معنى؛ يظهر مكان الفشل والخطوة التالية.

القواعد:

- الحركة قصيرة وهادئة.
- لا توجد عناصر طافية أوخلفيات متحركة.
- لا تستخدم Parallax أوGlow.
- يمكن إيقاف الحركة للمستخدمين الذين يفضلون Reduced Motion.

## 12. عرض البيانات

أثر لا تستخدم Dashboard Cards كحل افتراضي.

نختار العرض حسب السؤال:

- Timeline لمعرفة ماذا حدث.
- Ledger للحركات والكميات.
- Delta لمعرفة ما تغير.
- Comparison للمقارنة بين الفروع أوالفترات.
- Exception list لمعرفة ما يحتاج تدخلًا.
- Summary sentence لتفسير الرقم.

كل رسم أوMetric يجب أن يجيب عن سؤال عملي، مثل:

- لماذا نقص المخزون؟
- أين توقفت المزامنة؟
- أي فرع يحتاج تدخلًا؟
- ما الذي تغير عن الأسبوع الماضي؟

## 13. حالات النظام والرسائل

كل حالة خطأ أوتعطل تتبع الصيغة:

```
ماذا حدث
ما الذي تم حفظه أوحمايته
ما الذي لا يجب فعله
ما الخطوة التالية
```

مثال:

> تعذر إرسال الفاتورة إلى السحابة. البيع محفوظ على هذا الجهاز والمخزون لن يُخصم مرة أخرى. لا تعِد تسجيل الفاتورة. سيحاول أثر الإرسال تلقائيًا، ويمكنك فتح تفاصيل المزامنة.
> 

لا نعرض:

- Error codes وحدها.
- Stack traces.
- رسائل عامة مثل “Something went wrong”.
- نجاحًا شكليًا عندما تكون العملية معلقة.

## 14. البساطة بدون إخفاء الحقيقة

البساطة لا تعني حذف التفاصيل؛ بل وضعها في المستوى الصحيح.

- المستخدم العادي يرى الحالة والإجراء.
- المدير يرى الأثر والنتيجة.
- المراجع يرى الدليل الكامل.
- الدعم يرى التشخيص دون كشف غير مصرح للبيانات.

نستخدم Progressive Disclosure بدل عرض كل شيء للجميع.

## 15. قواعد منع شكل AI Template

ممنوع في المنتج والموقع:

- Purple/blue gradients كهوية افتراضية.
- Glassmorphism.
- Glowing cards.
- Cards داخل Cards بلا سبب.
- شبكة 3 أو4 KPI Cards في كل Dashboard.
- Hero يحتوي على نص يسار وMockup عائم يمين كقالب ثابت لكل صفحة.
- Rounded rectangles لكل عنصر.
- نصوص عامة مثل “Unlock the power of your business”.
- زخارف Dots وBlobs وGrids التقنية الجاهزة.
- Fake AI assistants أوchat bubbles بلا وظيفة.
- صور Stock عامة لموظفين يبتسمون أمام لابتوب.
- Illustration style مكرر من مكتبات SaaS.
- إخفاء ضعف الـUX خلف Animation أوGradient.

كل عنصر بصري يجب أن يأتي من واحد من:

- أثر حقيقي.
- حركة حقيقية.
- حالة حقيقية.
- علاقة حقيقية بين بيانات.

## 16. الوصول وسهولة الاستخدام

- RTL أصلي كامل، وليس قلبًا آليًا للواجهة.
- LTR كامل للإنجليزية.
- دعم Keyboard وBarcode scanner.
- Touch targets مناسبة لأجهزة POS.
- Contrast واضح.
- لا يعتمد معنى الحالة على اللون فقط.
- Focus states ظاهرة.
- Empty states تشرح كيف يبدأ المستخدم.
- Loading states توضح ما الذي يتم تحميله.
- Offline states لا تبدو كأن التطبيق تعطل.

## 17. اختبار التصميم

أي شاشة أوComponent لا يعتمد قبل نجاحه في الأسئلة التالية:

1. هل يفهم غير التقني ما حدث؟
2. هل يعرف المستخدم الإجراء التالي؟
3. هل يمكن الوصول إلى الدليل بسهولة؟
4. هل Scope العملية واضح؟
5. هل الحالة صادقة، أم تخفي التعليق أوالفشل؟
6. هل الشكل ناتج من وظيفة أثر، أم من قالب SaaS عام؟
7. هل يعمل بالعربية بنفس جودة الإنجليزية؟
8. هل يمكن استخدامه بسرعة تحت ضغط العمل؟

## 18. القرار النهائي

- الاتجاه المعتمد هو **واجهة الأثر — The Trace Interface**.
- الـTrace Rail هو العنصر التوقيعي المشترك بين المنتجات.
- التصميم يبنى على: افهم، تصرف، أثبت.
- الواجهة تشرح الحالة قبل التفاصيل.
- الهوية البصرية دافئة ومادية وهادئة، لا تقنية لامعة.
- لا توجد Dashboard أوCards أوAnimation بلا سؤال عملي أوبيانات حقيقية.
- البساطة ناتجة عن ترتيب المعلومات، لا عن إخفاء الحقيقة.

---

# ATHR Product Family & Naming System — v1.0

الحالة: **Approved**

هذا القرار يستبدل أي تقسيم قديم يعتبر الـPOS والـWarehouse منتجين منفصلين.

## 1. بنية عائلة المنتج

```
ATHR
├── ATHR Operations
│   ├── Cashier Workspace
│   ├── Warehouse Workspace
│   └── Supervisor Workspace
├── ATHR Control
└── ATHR Platform
```

`ATHR Trust Layer` اسم معماري داخلي، وليس منتجًا مستقلًا أو باقة تباع للعميل.

## 2. العلامة الأم — ATHR

**الاسم العربي:** أثر  

**الاسم الإنجليزي:** ATHR

تستخدم العلامة الأم في:

- الموقع والهوية والشعار.
- العقود والفواتير والمواد التسويقية.
- تسجيل الدخول الموحد.
- أسماء التطبيقات والمنتجات.
- التواصل مع العملاء.

لا تُستخدم تهجئات بديلة مثل:

- Athar.
- Atharh.
- ATHAR.
- ATHER.

التهجئة الرسمية الوحيدة: `ATHR`.

## 3. ATHR Operations

**الاسم العربي التسويقي:** أثر للتشغيل  

**الاسم الرسمي التقني:** ATHR Operations

هو المنتج التشغيلي الموحد للعاملين داخل المتجر والمخزن والفرع.

ليس ثلاثة منتجات منفصلة؛ بل منتج واحد يعرض Workspace مناسبة وفق:

- دور المستخدم.
- الصلاحيات.
- Location/Warehouse scope.
- Plan entitlements.
- نوع الجهاز والقدرات المتاحة.

يمكن أن تختلف الـRuntime أوطريقة التوزيع بسبب Electron والطباعة والـOffline والـHardware، لكن تظل جميعها أجزاء من ATHR Operations، مع:

- هوية موحدة.
- Design system موحد.
- Auth وAPI contracts مشتركة.
- Backend business logic واحدة.
- Permission وEntitlement enforcement من الـBackend.

### Cashier Workspace

**الاسم العربي داخل الواجهة:** نقطة البيع  

**الاسم التقني:** Cashier Workspace

مسؤولة عن:

- Enrollment وLogin.
- الوردية.
- البيع والدفع المسجل.
- الخصومات المسموحة.
- العملاء أثناء البيع.
- التعليق والاستعادة.
- المرتجعات المسموح بها.
- الطباعة.
- Offline database وOutbox وSync.
- حالة الاتصال وآخر مزامنة.
- Diagnostics وUpdates وTerminal Lease.

لا تدير المشتريات أوالموردين أوالجرد الكامل أوإدارة المؤسسة.

### Warehouse Workspace

**الاسم العربي داخل الواجهة:** المخزن  

**الاسم التقني:** Warehouse Workspace

مسؤولة عن:

- المنتجات والـVariants.
- المقاسات والألوان وSKU وBarcode وLabels.
- الموردين.
- المشتريات والاستلام.
- مرتجعات الموردين.
- التحويلات والشحن والاستلام الجزئي.
- الجرد والتسويات والمطابقة.
- Damaged/Lost quantities.
- المسودات المحلية وIdempotent posting.

لا تتحول إلى منتج باسم `ATHR Warehouse` إلا بقرار استراتيجي جديد؛ الاسم الحالي Workspace داخل ATHR Operations.

### Supervisor Workspace

**الاسم العربي داخل الواجهة:** الإشراف  

**الاسم التقني:** Supervisor Workspace

مسؤولة عن:

- مراقبة الوردية والفرع.
- الاستثناءات والتنبيهات.
- العمليات المعلقة أوالمرفوضة.
- الموافقات التشغيلية المصرح بها.
- التسويات الحساسة.
- حالة الأجهزة والمزامنة.
- إجراءات Recovery المسجلة.

لا تستبدل ATHR Control؛ هي واجهة تشغيل يومية للمشرف داخل نطاقه فقط.

## 4. ATHR Control

**الاسم العربي التسويقي:** لوحة تحكم أثر  

**الاسم الرسمي التقني:** ATHR Control

هي بوابة العميل الإدارية والإشرافية، وتستخدم بواسطة:

- Tenant Owner.
- الإدارة.
- المديرين المصرح لهم.
- المحاسبين أوالمراجعين حسب الصلاحيات.

مسؤولة عن:

- Dashboard والتقارير.
- رؤية المبيعات والفواتير والمخزون والمشتريات والتحويلات.
- Locations وWarehouses وTerminals وUsers.
- Roles وPermissions وScopes.
- Audit وOperational health وAlerts.
- Plan وUsage وBilling.
- Onboarding وSettings وIntegrations وExports.

بعد اكتمال Warehouse Workspace، لا تُستخدم كواجهة يومية لإدخال المنتجات أوالاستلام أوشحن التحويلات أوالتسويات المخزنية.

## 5. ATHR Platform

**الاسم العربي الداخلي:** إدارة منصة أثر  

**الاسم الرسمي التقني:** ATHR Platform

منتج داخلي خاص بفريق أثر، وله Authentication وAuthorization boundary منفصلة عن عملاء المنصة.

مسؤول عن:

- Tenants وTrials وSubscriptions.
- Plans وPlan Versions وEntitlements وLimits وOverrides.
- Billing وPayments وPrice Books.
- Provisioning وOnboarding failures.
- Terminal وSync health.
- Support access leases.
- Incidents وOperational audit.
- Suspend/Reactivate وOffboarding.
- Backup وRestore status.

لا يظهر كمنتج متاح للعميل، ولا يحصل Tenant Owner على صلاحيات داخله.

## 6. ATHR Trust Layer

**الاسم:** ATHR Trust Layer  

**التصنيف:** Internal Architecture Concept

يشمل:

- Sale integrity.
- Idempotency.
- Offline confidence.
- Inventory movement traceability.
- Auditability.
- Replay safety.
- Tenant isolation.
- Recovery commands.

يمكن استخدامه في الرسائل التسويقية لتفسير ميزة أثر، لكنه:

- ليس تطبيقًا.
- ليس Module يباع منفصلًا.
- ليس Add-on يمكن تعطيله.
- لا يُستخدم كاسم Repository أوواجهة مستقلة دون سبب معماري.

## 7. الفرق بين Product وWorkspace وModule وFeature

### Product

سطح مستقل له مستخدمون ورحلة استخدام وحدود أمنية أوتشغيلية واضحة.

المنتجات المعتمدة فقط:

- ATHR Operations.
- ATHR Control.
- ATHR Platform.

### Workspace

تجربة داخل Product تتغير حسب الدور والنطاق.

الـWorkspaces المعتمدة:

- Cashier Workspace.
- Warehouse Workspace.
- Supervisor Workspace.

### Module

مجال وظيفي داخل Product، مثل:

- Sales.
- Inventory.
- Purchasing.
- Transfers.
- Users.
- Billing.
- Reports.

الـModule لا تحصل تلقائيًا على اسم Branding مستقل.

### Feature

قدرة محددة داخل Module، مثل:

- Partial receiving.
- Offline sale.
- Stock count.
- Terminal lease.

لا يُنشأ اسم منتج لكل Feature.

## 8. قواعد التسمية

- كل اسم منتج يبدأ بـ`ATHR`.
- اسم المنتج كلمة واحدة واضحة بعد ATHR.
- الـWorkspaces لا تبدأ بـATHR لأنها أجزاء من ATHR Operations.
- أسماء الـModules وظيفية ومباشرة، وليست أسماء تسويقية مبتكرة.
- لا تستخدم كلمات: Pro، Plus، Max، Smart، AI، Cloud كجزء من اسم المنتج دون قرار Pricing/Brand واضح.
- لا يُسمى أي منتج جديد قبل إثبات أنه يحتاج مستخدمين أوLifecycle أوSecurity boundary مختلفة.
- أسماء الكود والـpackages والـroutes تُختار حسب الوظيفة والمعمارية، لا حسب الحملات التسويقية المؤقتة.
- تغيير الاسم التسويقي لا يجب أن يفرض إعادة تسمية جداول أوMigration history بلا فائدة تقنية.

## 9. أسماء الـRepositories والـPackages أثناء الانتقال

إعادة التسمية من BOLD إلى ATHR تتم تدريجيًا وبخطة آمنة.

- لا يعاد تسمية كل شيء دفعة واحدة.
- لا تعدل Migration history القديمة.
- يمكن إبقاء identifiers داخلية قديمة مؤقتًا عندما تكون إعادة تسميتها عالية الخطورة أوبلا قيمة للمستخدم.
- تبدأ الأولوية من النصوص والواجهة والوثائق وpackage metadata والإصدارات الجديدة.
- أي Rename تقني يجب أن يمر عبر tests وbuild وrelease verification.

## 10. القرار النهائي

- ATHR هي العلامة الأم.
- ATHR Operations هو تطبيق التشغيل الموحد.
- Cashier وWarehouse وSupervisor هي Workspaces وليست منتجات.
- ATHR Control هو Customer Control Dashboard.
- ATHR Platform هو Platform Owner Admin الداخلي.
- ATHR Trust Layer مفهوم معماري وتسويقي، وليس منتجًا مستقلًا.

---

# ATHR Competitive Positioning — v1.0

الحالة: **Approved**

## 1. الفئة التي ننتمي إليها

ATHR ليست مجرد POS وليست ERP عامًا.

الفئة المعتمدة:

> Retail Operations Platform for Specialty Retail
> 

الترجمة التسويقية:

> منصة تشغيل موحدة للمتاجر المتخصصة.
> 

## 2. السوق الأول

- الملابس.
- الأحذية.
- الإكسسوارات.
- مستحضرات التجميل.
- المتاجر ذات المقاسات والألوان والـVariants.
- المتاجر التي لديها مخزن أو أكثر من فرع.

لا نستهدف في البداية:

- المطاعم والكافيهات.
- الشركات الخدمية.
- التصنيع.
- المحاسبة العامة الكاملة.
- التجارة الإلكترونية كمنتج مستقل.

## 3. خريطة المنافسين

### Loyverse

**قوته:**

- POS أساسي مجاني.
- إعداد واستخدام سهل.
- إدارة متاجر متعددة.
- إضافات مدفوعة للموظفين والمخزون المتقدم.

**تسعيره الحالي:**

- POS أساسي مجاني.
- تاريخ مبيعات غير محدود: 5 دولار شهريًا لكل متجر.
- إدارة الموظفين: 25 دولارًا شهريًا لكل متجر.
- المخزون المتقدم: 25 دولارًا شهريًا لكل متجر.

**لا ننافسه في:** المجانية والبدء السريع جدًا.

**ننافسه في:** سلامة المزامنة، عمق تتبع المخزون، إدارة الحالات الاستثنائية، وضوح حالة الأجهزة والعمليات.

### Shopify POS

**قوته:**

- ربط قوي بين المتجر الإلكتروني والبيع داخل الفروع.
- منظومة تطبيقات وتكاملات واسعة.
- إدارة مواقع متعددة وخصائص Omnichannel.

**تسعيره الحالي:**

- الخطة الأساسية تبدأ من 39 دولارًا شهريًا في السوق الأمريكي.
- POS Pro يضاف مقابل 89 دولارًا شهريًا لكل Location.

**لا ننافسه في:** التجارة الإلكترونية والـOmnichannel في الإصدار الأول.

**ننافسه في:** Retail Operations المحلية، العمل Offline، وضوح التتبع بين الكاشير والمخزن والفروع.

### Odoo

**قوته:**

- ERP واسع يشمل POS والمخزون والمحاسبة وCRM وHR وتطبيقات أخرى.
- قابلية تخصيص وتوسع كبيرة.

**تسعيره الحالي:**

- One App Free.
- Standard يبدأ من 24.90 دولارًا لكل مستخدم شهريًا عند الدفع السنوي.
- Custom يبدأ من 49 دولارًا لكل مستخدم شهريًا عند الدفع السنوي.

**لا ننافسه في:** عدد التطبيقات أو التحول إلى ERP عام.

**ننافسه في:** البساطة، سرعة التشغيل، عمق Specialty Retail، وتجربة أدوار واضحة بدون مشروع تنفيذ ERP ثقيل.

### Daftra

**قوته:**

- نظام عربي واسع يجمع الفواتير والمبيعات والمخزون ونقاط البيع والمحاسبة.
- حضور محلي وفهم للاحتياجات الإدارية العربية.
- يدعم البيع والمخزون والمرتجعات وإدارة المستودعات.

**لا ننافسه في:** الاتساع المحاسبي وعدد الوحدات.

**ننافسه في:** سلامة العمليات Offline، تتبع الحركة، بساطة الأدوار، وربط الكاشير والمخزن والأجهزة كمنظومة تشغيل واحدة.

### Foodics

**قوته:**

- تخصص قوي في المطاعم.
- منظومة متكاملة للكاشير والمطبخ والطلبات والولاء والتوصيل.
- علامة قوية في المنطقة.

**تسعيره المعلن في مصر:**

- الباقة الأساسية تبدأ من 2,848.95 جنيه شهريًا عند الدفع السنوي.
- الباقة المطورة تبدأ من 3,733.67 جنيه شهريًا عند الدفع السنوي.

**لا ننافسه:** أثر ليست للمطاعم.

**الدروس المستفادة:** التخصص الواضح، منظومة المنتجات، البيع بالحزمة، وقوة الـOnboarding والدعم.

### Geidea

**قوته:**

- دمج الدفع مع أجهزة POS والحلول التشغيلية.
- Offline mode وتقارير فورية وأجهزة متكاملة.
- حضور قوي في المدفوعات.

**لا ننافسه في:** معالجة المدفوعات أو البنية البنكية.

**ننافسه في:** إدارة Specialty Retail والمخزون والتتبع، مع التكامل مع مزودي الدفع بدل التحول إلى مزود دفع.

## 4. الفراغ السوقي

السوق يحتوي غالبًا على ثلاثة أنواع:

1. POS بسيط ورخيص يسجل البيع والمخزون الأساسي.
2. ERP واسع يحتاج إعدادًا وتخصيصًا وتدريبًا أكبر.
3. منصات متخصصة في المطاعم أو التجارة الإلكترونية.

الفرصة:

> منصة عربية الأصل، متخصصة في Retail، سهلة مثل POS، لكن موثوقيتها وعمق تتبعها أقرب إلى الأنظمة المؤسسية.
> 

## 5. محور التميز

ATHR يجب أن تمتلك المساحة التالية:

- تخصص Retail واضح.
- قوة Offline ومزامنة آمنة.
- Inventory Movement Ledger قابل للتتبع.
- تطبيق تشغيل موحد للكاشير والمخزن والمشرف.
- وضوح حالة العملية والجهاز والمزامنة.
- إدارة فروع ومخازن وصلاحيات بدون تعقيد ERP.
- تجربة عربية ممتازة وليست ترجمة ثانوية.

## 6. Positioning Statement

> للمتاجر المتخصصة التي تحتاج إلى بيع سريع ومخزون موثوق بين الكاشير والمخزن والفروع، أثر هي منصة تشغيل موحدة تحفظ العمليات وتوضح حالة المزامنة وتوثق كل حركة. بخلاف برامج الكاشير البسيطة أو أنظمة ERP العامة، أثر تجمع سهولة الاستخدام مع تتبع تشغيلي عميق مصمم للـRetail.
> 

## 7. الرسائل التنافسية

### أمام POS رخيص أو مجاني

> السعر الأقل يسجل الفاتورة. أثر يحمي ما بعدها: الخصم، المزامنة، حركة المخزون، والتتبع.
> 

### أمام ERP عام

> لا تحتاج إلى مشروع ERP كامل لتضبط متجرك. أثر تعطيك ما يحتاجه الـRetail بوضوح وبدون وحدات لا تستخدمها.
> 

### أمام Shopify

> Shopify يبدأ من التجارة الإلكترونية. أثر تبدأ من أرض المتجر والمخزن وحقيقة المخزون الفعلي.
> 

### أمام أنظمة المطاعم

> أثر مبنية للمنتجات والـVariants والمخازن والفروع، لا للمنيو والطاولات والمطبخ.
> 

## 8. ما لا ندّعيه

- لسنا الأرخص.
- لسنا ERP شاملًا.
- لسنا منصة تجارة إلكترونية.
- لسنا مزود دفع.
- لسنا مناسبين لكل القطاعات.
- لا نستخدم AI كشعار تسويقي بلا قيمة حقيقية.

## 9. معايير الفوز

ATHR تفوز عندما يختارها العميل بسبب:

1. ثقته أن البيع لن يضيع أو يتكرر.
2. قدرته على معرفة سبب أي اختلاف مخزون.
3. وضوح حالة كل جهاز ومزامنة.
4. فصل الصلاحيات والأدوار بدون تعقيد.
5. سهولة التشغيل مقارنة بالـERP.
6. عمق العمليات مقارنة بالـPOS البسيط.

## 10. القرار النهائي

تمركز ATHR المعتمد:

> ليست الأرخص، وليست الأوسع. هي الأوضح والأوثق لتشغيل Specialty Retail.
> 

---

# ATHR Brand Foundation — v1.0

الحالة: **Approved**

## 1. جوهر العلامة

**أثر** هو نظام تشغيل للمتاجر يجعل كل عملية بيع، وكل حركة مخزون، وكل تعديل قابلًا للتتبع والفهم والإثبات.

**Brand Essence:**

> وضوح يمكن الاعتماد عليه.
> 

**Core Idea:**

> كل حركة لها أثر.
> 

## 2. الغرض

مساعدة أصحاب المتاجر على تشغيل البيع والمخزون والفروع بثقة، بدون فقد عمليات، أو اختلاف أرقام، أو غموض حول ما حدث.

## 3. الرؤية

أن تصبح أثر طبقة التشغيل الموثوقة للمتاجر المتخصصة في المنطقة، ثم منصة عالمية لإدارة العمليات التي تعتمد على مخزون فعلي.

## 4. المهمة

بناء نظام بسيط في الاستخدام، عميق في التتبع، ويستمر في العمل بأمان حتى عند انقطاع الإنترنت أو حدوث أخطاء أو إعادة مزامنة.

## 5. الوعد الأساسي

> بيعك محفوظ. مخزونك مفهوم. وكل تغيير له أثر.
> 

الوعد لا يعني أن الخطأ مستحيل؛ بل يعني أن النظام يمنع الفقد والتكرار قدر الإمكان، ويشرح الحالة بوضوح، ويحفظ سجلًا لما حدث.

## 6. التمركز

**لمن؟**

المتاجر التي تعتمد على مخزون فعلي ومتغيرات منتجات وفروع أو مخازن، خصوصًا الملابس، الأحذية، الإكسسوارات، مستحضرات التجميل، والـSpecialty Retail.

**المشكلة؟**

الأنظمة المعتادة تسجل النتيجة، لكنها لا تشرح دائمًا كيف حدثت، ومن غيّرها، وهل تمت المزامنة، ولماذا اختلف المخزون.

**ما الذي تقدمه أثر؟**

منصة تشغيل موحدة تربط الكاشير والمخزن والإدارة، وتحافظ على سلامة البيع، وتوثق حركة المخزون، وتعمل بثقة Online وOffline.

**الفارق؟**

> أثر لا يكتفي بتسجيل المخزون؛ أثر يثبت ما حدث له.
> 

## 7. أعمدة العلامة

### الثقة

العمليات المهمة لا تضيع، ولا تتكرر بلا كشف، ولا تختفي خلف رسائل تقنية غامضة.

### التتبع

كل حركة مرتبطة بمصدر ومستخدم ووقت ومرجع وحالة واضحة.

### الوضوح

لغة مباشرة، حالات مفهومة، وقرارات تظهر للمستخدم بدون تعقيد محاسبي أو تقني.

### الاستمرارية

النظام مصمم ليستمر أثناء انقطاع الإنترنت، ثم يعيد المزامنة بأمان.

### السيطرة

صاحب النشاط يعرف ما يحدث في الفروع والمخازن والأجهزة والمستخدمين من مكان واحد.

## 8. شخصية العلامة

أثر:

- واثقة بدون غرور.
- قوية بدون صخب.
- دقيقة بدون تعقيد.
- حديثة بدون مظهر تقني مستهلك.
- عملية بدون جفاف.
- عربية الأصل وعالمية التنفيذ.
- هادئة عند المشاكل، ولا تستخدم التخويف.

أثر ليست:

- مرحة زيادة عن اللزوم.
- شبابية مصطنعة.
- محاسبية ثقيلة.
- Cyberpunk.
- مبهرة بصريًا على حساب الاستخدام.
- قائمة على كلمة AI كأداة تسويق.
- منصة تدّعي أنها تفعل كل شيء.

## 9. نبرة الصوت

### القاعدة

اكتب كما يتحدث مدير عمليات خبير: واضح، هادئ، مسؤول، ويقول للمستخدم ماذا حدث وما الخطوة التالية.

### نستخدم

- جمل قصيرة.
- فعل واضح.
- حالة العملية أولًا.
- الخطوة التالية ثانيًا.
- المصطلح التقني فقط عند الحاجة.
- العربية الطبيعية، لا الترجمة الحرفية.

### لا نستخدم

- مبالغات مثل: الأفضل على الإطلاق، ثوري، خارق.
- وعود غير قابلة للإثبات.
- رسائل خطأ مجردة.
- لغة تخويف.
- مصطلحات محاسبية أو تقنية أمام الكاشير دون شرح.
- نبرة روبوتية أو AI-generated.

## 10. أمثلة النبرة

بدلًا من:

`SYNC_FAILED`

نقول:

> البيع محفوظ على الجهاز، لكنه لم يصل إلى السحابة بعد. لا تعِد تسجيل الفاتورة. سيحاول أثر إرسالها تلقائيًا عند عودة الاتصال.
> 

بدلًا من:

`Insufficient permissions`

نقول:

> ليس لديك صلاحية تنفيذ هذا الإجراء. اطلب من مدير الفرع تعديل دورك أو تنفيذ العملية.
> 

بدلًا من:

`Inventory mismatch`

نقول:

> الكمية المسجلة لا تطابق آخر حركة مخزون مؤكدة. راجع الحركات قبل اعتماد التسوية.
> 

## 11. الرسائل الأساسية

### الرسالة الرئيسية

> كل حركة لها أثر.
> 

### رسالة المنتج

> منصة تشغيل موحدة تحفظ البيع، وتربط المخزون، وتوضح ما حدث في كل فرع وجهاز.
> 

### رسالة الثقة

> بيعك لا يضيع، وإعادة المحاولة لا تنشئ عملية ثانية بلا كشف.
> 

### رسالة المخزون

> اعرف أين تحركت كل قطعة، ومن غيّر الكمية، ولماذا.
> 

### رسالة الـOffline

> استمر في البيع عند انقطاع الإنترنت، ثم زامن بأمان عند عودته.
> 

### رسالة الإدارة

> راقب الفروع والمخازن والأجهزة والمستخدمين من مكان واحد.
> 

## 12. الجمل المعتمدة

**Primary Tagline:**

> كل حركة لها أثر.
> 

**English Tagline:**

> Every move leaves a trace.
> 

**Product Line:**

> تشغيل أوضح. مخزون أدق. قرارات أثبت.
> 

**Trust Line:**

> أثر لا يسجل ما حدث فقط؛ يثبت كيف حدث.
> 

## 13. نظام التسمية

العلامة الأم:

- **أثر**
- **ATHR**

أسماء المنتجات تستخدم الإنجليزية تقنيًا والعربية في الواجهة التسويقية:

- **ATHR Operations** — تطبيق التشغيل الموحد.
- **ATHR Control** — لوحة تحكم العميل.
- **ATHR Platform** — لوحة إدارة المنصة.
- **ATHR Trust Layer** — الاسم الداخلي لطبقة سلامة البيع والتتبع والمزامنة.

داخل ATHR Operations:

- Cashier Workspace.
- Warehouse Workspace.
- Supervisor Workspace.

لا يتم إنشاء أسماء منتجات منفصلة للكاشير والمخزن؛ هما Workspaces داخل تطبيق واحد.

## 14. المبادئ البصرية

- الهوية تبنى على فكرة الأثر، المسار، الحركة، الاتصال، والتتابع.
- الشكل يجب أن يبدو مؤسسيًا وحديثًا، لا تقليديًا ولا قالب SaaS جاهزًا.
- التباين واضح، المساحات محسوبة، والواجهة لا تعتمد على الزخرفة.
- الحركة البصرية تستخدم لإظهار الانتقال والتتبع والحالة، لا للاستعراض.
- النظام البصري يجب أن يعمل بالعربية والإنجليزية دون أن تبدو العربية نسخة ثانوية.

ممنوع:

- Shopping cart icon.
- Barcode كرمز رئيسي.
- Cash register icon.
- حرف A داخل مربع كحل وحيد.
- AI sparkles.
- Network brain.
- Gradient تقني مستهلك.
- واجهات Dashboard عامة بلا شخصية.

## 15. اختبار أي قرار جديد

أي اسم أو تصميم أو رسالة أو Feature Presentation يجب أن ينجح في الأسئلة التالية:

1. هل يزيد الثقة؟
2. هل يوضح ما حدث؟
3. هل يربط الفعل بأثر قابل للتتبع؟
4. هل يخدم المتجر المتخصص فعلًا؟
5. هل هو بسيط للمستخدم وعميق في النظام؟
6. هل يبدو كأثر، أم كقالب SaaS عام؟

---

# قرار الاسم النهائي

- الاسم العربي: **أثر**
- الاسم الإنجليزي: **ATHR**
- النطق: **Athr**
- الحالة: **Approved**
- المعنى: كل عملية بيع، وكل حركة مخزون، وكل تعديل يترك أثرًا يمكن تتبعه وإثباته.
- الاسم القديم **BOLD** يظل اسمًا داخليًا مؤقتًا داخل الكود حتى ينفذ شات الـWork خطة إعادة التسمية بشكل آمن دون كسر الـbuild أو الـmigrations أو الـintegrations.

---

# لغة التفكير والتنفيذ

- التحليل والتخطيط والبحث الداخلي وكتابة الكود والتعليقات التقنية تكون بالإنجليزية لتحقيق أفضل دقة واتساق.
- الردود الموجهة لصاحب المشروع تكون بالعربية الواضحة والمباشرة.
- أسماء الملفات والأوامر والـAPIs والـErrors والمصطلحات التقنية تظل بالإنجليزية عند الحاجة.

---

# قوانين العمل الملزمة

هذه القواعد صارمة وتُطبق على شات التخطيط وشات الـWork.

## 1. اقتصاد الكلام والـTokens

- كل رسالة يجب أن تضيف قرارًا، نتيجة، تحليلًا، أو خطوة تنفيذية.
- ممنوع المقدمات، التكرار، إعادة شرح ما تم حسمه، أو توليد أفكار خارج المطلوب.
- الردود تكون مباشرة وقصيرة ما لم تتطلب المهمة توثيقًا كاملًا.
- عند وجود قرار سابق، يُستخدم بدل إعادة فتح النقاش.
- لا يُطلب توضيح يمكن حسمه من الكود أو الوثائق أو القرارات السابقة.

## 2. جودة الكود

- ممنوع تسليم سطر كود يحتوي على Syntax Error أو Type Error معروف.
- ممنوع إضافة كود بلا استخدام فعلي، Dead Code، Dependencies غير لازمة، أو Abstractions بلا حاجة.
- الكود يجب أن يكون مقروءًا، مرنًا، قابلًا للاختبار والتوسع، ومتوافقًا مع المعمارية المعتمدة.
- لا يُكرر Business Logic بين التطبيقات أو الطبقات.
- أي تغيير يحافظ على Backward Compatibility أو يوثق سبب كسرها وخطة الهجرة.

## 3. معالجة الأخطاء والـBugs

- ممنوع الحل المؤقت أو الخاص بعرض واحد للمشكلة.
- قبل الإصلاح يجب تحديد Root Cause ونطاق تأثيره.
- الإصلاح يجب أن يمنع تكرار الفئة نفسها من الخطأ، لا الحالة الحالية فقط.
- كل Bug Fix يحتاج Regression Test يثبت أن المشكلة لن تعود.
- عند اكتشاف Pattern أوسع، يُراجع كل موضع مشابه في المشروع.
- لا تُخفى الأخطاء أو تُبتلع Exceptions لتنجح الاختبارات شكليًا.

## 4. الاختبارات وبوابة الـPR

- كل تعديل يُختبر على النطاق المتأثر، ثم تُشغل بوابة الاختبارات الكاملة المعتمدة قبل الـPR.
- يجب تشغيل: lint، typecheck، unit/integration tests، build، وأي smoke أو contract tests مرتبطة بالتغيير.
- لا يُفتح PR مع اختبارات فاشلة أو أخطاء معلومة غير موثقة وموافق عليها.
- أي تعديل في migrations أو sync أو permissions أو billing أو inventory يحتاج اختبارات فشل وIdempotency وRegression مناسبة.
- نتيجة الاختبارات والأوامر المستخدمة تُذكر في تقرير التسليم.

## 5. التوثيق

- أي تغيير يؤثر على التشغيل، الإعداد، البيئة، الأوامر، المعمارية، API، migration، أو workflow يجب أن يحدّث README أو الوثيقة المختصة في نفس التغيير.
- ممنوع ترك التوثيق مخالفًا للكود.
- القرارات المعمارية المهمة تُسجل في Notion كمصدر مركزي.

## 6. قواعد التنفيذ

- افهم الموجود قبل التعديل؛ لا Refactor كبير بلا Audit واضح.
- اختر أبسط حل شامل، لا أسرع Patch.
- لا تغير Scope المهمة إلا لو ظهر خطر بيانات أو أمان أو عيب معماري مباشر.
- أي تغيير كبير يُقسم إلى وحدات قابلة للمراجعة والاختبار.
- لا تُعلن المهمة Done دون دليل: Tests، Build، تشغيل، PR، Release، أو تقرير تحقق.

## 7. صيغة تقرير كل مهمة في شات الـWork

1. Root cause أو الهدف.
2. الملفات والمكونات المتأثرة.
3. الحل النهائي ولماذا يمنع التكرار.
4. الاختبارات والأوامر ونتائجها.
5. التوثيق الذي تم تحديثه.
6. المخاطر أو البنود المتبقية فقط إن وجدت.

---

# مركز العمل المشترك

هذه الصفحة هي **المصدر المركزي الوحيد** لخطة مشروع الـSaaS والقرارات والتقارير والحالة التنفيذية بين:

- شات التخطيط والتسويق.
- شات الـWork المسؤول عن الكود.
- صاحب المشروع.

## قواعد التحديث

- أي قرار نهائي يُضاف هنا قبل اعتباره معتمدًا.
- أي مرحلة تبدأ أو تنتهي يتم تحديث حالتها هنا.
- أي تقرير مراجعة أو Gap Analysis أو Competitive Research يُضاف هنا أو كصفحة فرعية.
- أي تغيير معماري من شات الـWork يجب أن ينعكس هنا.
- لا تُنشأ Roadmap بديلة خارج هذه الصفحة؛ عند ظهور مشكلة نحدّث المرحلة والبند المتأثر فقط.
- حالة البنود تستخدم: `Planned`، `In Progress`، `Blocked`، `Done`، `Deferred`.
- عند إغلاق بند، يضاف دليل الإغلاق: اختبار، تقرير، رابط PR، Release، أو نتيجة تشغيل.

## توزيع المسؤوليات

**شات الـWork:** الكود، مراجعة المستودع، الـBackend، تطبيق التشغيل الموحد، الـDashboard، الاختبارات، المهاجرات، الاعتمادية والأمان.

**شات التخطيط:** الاسم، الهوية، السوق، المنافسون، التمركز، التسعير، تجربة المنتج، التصميم، المحتوى وخطة الإطلاق.

---

# BOLD SaaS MASTER BLUEPRINT — v1.0

## حالة الوثيقة

هذه الوثيقة هي المرجع الأعلى لمشروع Bold.

أي Roadmap أو Feature Plan أو Bug Fix Plan يجب أن يتفرع منها، ولا يجوز أن يناقضها.

الـRoadmap القديمة لا تُلغى بالكامل، لكنها تتحول من خطة المشروع كله إلى **خطة تطوير الـOperational Core** داخل منتج SaaS أكبر.

---

# 1. تعريف Bold النهائي

## ما هو Bold؟

Bold هو منصة تشغيل وإدارة للمتاجر التي تعتمد على مخزون فعلي، ومتغيرات منتجات، ومستودعات، وأجهزة POS، وفروع متعددة.

Bold ليس:

- برنامج كاشير بسيطًا.
- ERP عامًا لكل أنواع الشركات.
- نظام مطاعم.
- برنامج محاسبة شاملًا.
- متجرًا إلكترونيًا.
- بوابة دفع.
- مشروعًا مخصصًا لمحل واحد.

Bold هو:

> نظام تشغيل موثوق للـSpecialty Retail يحافظ على صحة المبيعات والمخزون بين الكاشير والمخزن والفروع، حتى مع انقطاع الإنترنت والأعطال وإعادة المزامنة.
> 

## السوق الأول المستهدف

القطاع الأول:

- الملابس.
- الأحذية.
- الإكسسوارات.
- مستحضرات التجميل.
- المنتجات ذات المقاسات والألوان والـVariants.
- المتاجر التي تستخدم مخزنًا أو عدة فروع.
- المتاجر التي تعاني من اختلاف المخزون، صعوبة الجرد، أو ضعف تتبع انتقال البضاعة.

لا نستهدف في الإصدار الأول:

- المطاعم والكافيهات.
- الفنادق.
- العيادات.
- الشركات الخدمية.
- التصنيع.
- الرواتب والموارد البشرية الكاملة.
- المحاسبة العامة الكاملة.
- المتاجر الإلكترونية كمنتج مستقل.

التركيز يمنعنا من منافسة Foodics في المطاعم أو Odoo وDaftra كأنظمة ERP عامة. Foodics يركز أساسًا على تشغيل المطاعم، بينما Odoo وDaftra يقدمان نطاق تطبيقات واسعًا يشمل المحاسبة والمخزون وCRM ووظائف أخرى. 

---

# 2. المشكلة التي يحلها Bold

صاحب المتجر لا يعاني فقط من تسجيل البيع.

هو يعاني من:

- كمية في النظام لا تطابق الموجود فعليًا.
- بضاعة استُلمت ولم تُسجل بشكل صحيح.
- بيع Offline وصل إلى السيرفر مرتين.
- فرع يقول إنه أرسل كمية وفرع آخر يقول إنه لم يستلمها.
- اختلاف بين الكاشير والمخزن والإدارة.
- عدم القدرة على معرفة سبب نقص صنف.
- أجهزة POS غير محدثة أو غير متزامنة.
- صعوبة الجرد.
- تعديلات لا يمكن معرفة من قام بها.
- نظام يتوقف عندما ينقطع الإنترنت.
- أخطاء تقنية تظهر للمستخدم دون تفسير لحالة العملية.

## وعد Bold الأساسي

> كل عملية بيع محفوظة، وكل حركة مخزون قابلة للتتبع، وكل جهاز يمكن معرفة حالته.
> 

---

# 3. ميزة Bold التنافسية

## Bold Trust Layer

ميزة Bold ليست Feature واحدة.

هي طبقة ثقة تشمل النظام كله:

### Sale Integrity

- الفاتورة المكتملة محليًا لا تضيع.
- إعادة الإرسال لا تنشئ فاتورتين.
- المخزون لا يُخصم مرتين.
- تغير السعر في الـCloud لا يبطل بيعًا اكتمل بالفعل.
- فقد تأكيد السيرفر لا يعني تكرار العملية.

### Inventory Traceability

كل تغيير في المخزون له:

- نوع حركة.
- مصدر.
- مستخدم.
- جهاز أو تطبيق.
- وقت.
- كمية قبل وبعد.
- مرجع.
- Idempotency key.
- Audit trail.

### Offline Confidence

ليس مجرد عبارة “يعمل Offline”.

يجب أن يعرف النظام:

- ما الذي حُفظ محليًا؟
- ما الذي وصل إلى الـCloud؟
- ما الذي ينتظر الإرسال؟
- ما الآمن لإعادة المحاولة؟
- هل يوجد خطر تكرار؟
- ما الذي يحتاج تدخلًا بشريًا؟

### Role Separation

- الـPOS يبيع.
- Warehouse App يدير البضاعة.
- Customer Admin يراقب ويدير المؤسسة.
- Platform Admin يدير منصة Bold.
- Backend هو مصدر الحقيقة.

### Operational Clarity

عند الخطأ، لا نعرض فقط:

```
SYNC_FAILED
```

بل نعرض:

```
البيع محفوظ على الجهاز.
لم يصل إلى السحابة حتى الآن.
لا تعِد تسجيل الفاتورة.
سيحاول Bold إرسالها تلقائيًا عند عودة الاتصال.
```

## الجملة التي ننافس بها

> Bold doesn’t just record stock. It proves what happened to it.
> 

---

# 4. مقارنة التمركز مع المنافسين

## الأنظمة المحلية منخفضة السعر

تركز غالبًا على:

- الكاشير.
- المخزون.
- الفواتير.
- التقارير.
- سعر اشتراك منخفض.
- خدمة قطاعات كثيرة.

بعض الأسعار المعلنة في مصر تبدأ من مئات الجنيهات شهريًا؛ Optify مثلًا يعلن خططًا سنوية تبدأ بما يعادل 414 جنيهًا شهريًا، بينما توجد تقديرات سوقية عامة تضع نطاقًا شائعًا يقارب 300–1,500 جنيه شهريًا حسب الإمكانات. citeturn978863search2turn978863search1

لا نحاول الفوز باعتبارنا الأرخص.

## Loyverse

تميزه:

- POS أساسي مجاني.
- تشغيل سهل على الهواتف والأجهزة اللوحية.
- إضافات مدفوعة للمخزون المتقدم والموظفين وسجل المبيعات.
- تسعير لكل متجر لبعض الإضافات. citeturn978863search5turn978863search13turn978863search21

Bold لن يفوز أمامه في “مجاني وسهل”، بل في عمق التحكم التشغيلي والتتبع.

## Shopify POS

تميزه:

- الربط بين البيع Online وداخل المتجر.
- Inventory موحد.
- Ship-to-customer.
- Returns بين القنوات.
- POS Pro لكل Location. citeturn978863search6turn978863search30

Bold لن يبدأ كمنافس e-commerce omnichannel.

## Foodics

تميزه:

- تخصص واضح في المطاعم.
- الطلبات والمطبخ والتوصيل والولاء.
- منظومة متكاملة للـF&B.
- باقات شهرية وسنوية. citeturn978863search4turn978863search12

Bold يتخصص في Specialty Retail، وليس المطاعم.

## Geidea

تميزها:

- دمج المدفوعات والأجهزة والإدارة.
- Offline.
- Tax reporting.
- تقارير وتشغيل. citeturn302233search1turn302233search13

Bold لن يصبح مزود دفع؛ يمكنه التكامل مع مزودي الدفع مع بقاء الدفع خارج قلب النظام.

## Daftra وOdoo

تميزهما:

- اتساع الوظائف.
- المحاسبة.
- CRM.
- المخزون.
- POS.
- ERP شامل. citeturn302233search12turn302233search6

Bold يتفوق بالتركيز وبساطة الأدوار وعمق سلامة عمليات الـRetail، وليس بعدد Modules أكثر.

---

# 5. هوية المنتج

## الاسم

الاسم العامل:

```
BOLD
```

يجب إجراء:

- Domain availability check.
- Trademark search في الأسواق المستهدفة.
- فحص تشابه الاسم مع شركات وبرامج قائمة.
- حجز أسماء الشبكات الاجتماعية.
- اختبار نطق الاسم بالعربية والإنجليزية.

قبل تثبيت العلامة التجارية قانونيًا.

## بنية العلامة

```
BOLD
├── Bold POS
├── Bold Warehouse
├── Bold Control
├── Bold Platform
└── Bold Trust
```

الأسماء النهائية يمكن تعديلها، لكن يجب وجود نظام تسمية موحد.

## شخصية العلامة

- واثقة.
- عملية.
- واضحة.
- قوية من غير صخب.
- حديثة من غير Cyberpunk.
- محلية الفهم وعالمية التنفيذ.
- لا تستخدم لغة محاسبية معقدة أمام الكاشير.
- لا تعد العميل بـ“الذكاء الاصطناعي” كزينة.

## Logo Brief

الشعار يجب أن يعبر عن واحد أو أكثر من:

- الحركة المتصلة.
- التتبع.
- الاستمرارية.
- نقطة تتحول إلى مسار.
- وحدات مستقلة تُكوّن نظامًا.
- حرف B يمكن أن يحتوي على مسارين أو تدفقين.

ممنوع:

- Shopping cart تقليدي.
- Barcode كليشيه.
- Cash register icon.
- حرف B داخل مربع فقط.
- Gradient تقني متكرر.
- رمز AI أو شبكة عصبية.

## Brand Deliverables

- Primary logo.
- Symbol.
- Wordmark.
- Arabic wordmark إن استُخدم.
- Light/dark variants.
- Monochrome version.
- App icons.
- POS icon.
- Warehouse icon.
- Favicon.
- Social avatar.
- Logo motion.
- Usage and exclusion rules.
- Minimum size.
- Safe area.
- Brand colors.
- Typography.
- Iconography.
- Illustration rules.
- Screenshot style.
- Hardware sticker and packaging rules.

---

# 6. تطبيقات Bold

## 6.1 Bold POS

مسؤول عن:

- Enrollment.
- Login.
- فتح وإغلاق الوردية.
- البيع.
- الخصومات المسموحة.
- العملاء أثناء البيع.
- طرق الدفع الخارجية المسجلة.
- تعليق واستعادة السلة.
- المرتجعات المسموح بها.
- الطباعة.
- Offline database.
- Outbox.
- Sync.
- حالة الاتصال.
- آخر مزامنة.
- Diagnostics.
- Updates.
- Terminal lease.

لا يدير:

- المشتريات.
- الموردين.
- الجرد الكامل.
- التحويلات.
- إنشاء المنتجات المعقدة.
- إدارة الاشتراك.
- إدارة المؤسسة.

## 6.2 Bold Warehouse

مسؤول عن:

- المنتجات.
- Variants.
- المقاسات.
- الألوان.
- SKU.
- Barcode.
- Labels.
- الموردين.
- Purchase orders.
- Purchase invoices.
- Receiving.
- Supplier returns.
- Transfers.
- Shipping.
- Partial receiving.
- Damaged/lost quantities.
- Stock counts.
- Adjustments.
- Reconciliation commands.
- Drafts المحلية.
- Idempotent posting.

## 6.3 Bold Control — Customer Admin

مسؤول عن:

- Dashboard.
- المبيعات.
- المخزون.
- المشتريات.
- الموردين.
- التحويلات.
- الفروع.
- الأجهزة.
- المستخدمين.
- الصلاحيات.
- Audit.
- تقارير.
- Alerts.
- Billing.
- Plan and usage.
- Onboarding.
- Settings.
- Integrations.

لا يُستخدم كواجهة إدخال عمليات مخزنية يومية بعد اكتمال Warehouse App.

## 6.4 Bold Platform Admin

خاص بفريق Bold:

- Tenants.
- Subscriptions.
- Trials.
- Plans.
- Price books.
- Payments.
- Failed renewals.
- Devices.
- Sync health.
- Provisioning.
- Support access.
- Feature overrides.
- Usage.
- Incidents.
- Audit.
- Data exports.
- Account suspension.
- Offboarding.

---

# 7. المعمارية العليا

## Modular Monolith

يستمر Bold كـModular Monolith.

لا ننتقل إلى Microservices لمجرد التحول إلى SaaS.

```
Backend
├── Identity
├── Tenancy
├── Catalog
├── Sales
├── Inventory
├── Purchasing
├── Transfers
├── Returns
├── Shifts
├── Devices
├── Sync
├── Reporting
├── Audit
├── Entitlements
├── Subscriptions
├── Billing
├── Provisioning
├── Notifications
└── Platform Operations
```

## التطبيق المشترك

```
Marketing Web
Customer Web
Platform Admin
POS Electron
Warehouse App
        │
        ▼
Bold Backend
        │
        ▼
PostgreSQL + queues/jobs + object storage
```

## مبدأ ثابت

Business Logic في الـBackend.

التطبيقات ترسل Commands وتعرض Results، ولا تعيد تنفيذ قواعد المخزون أو الاشتراك محليًا، باستثناء قواعد Offline المحددة والموقعة.

---

# 8. Multi-Tenancy

## الكيانات

```
Tenant
├── Legal/business profile
├── Subscription
├── Memberships
├── Locations
├── Terminals
├── Settings
├── Integrations
└── Business data
```

```
Tenant = الشركة أو النشاط
Location = الفرع
Terminal = جهاز POS
Warehouse = مخزن تابع للـTenant
```

## استراتيجية البداية

```
Shared application
Shared PostgreSQL
Shared schema
Strict tenant partitioning
```

## الاستراتيجية المستقبلية

```
Standard customers:
Shared infrastructure

Enterprise:
Dedicated database or deployment stamp
```

## شروط العزل

- لا Query تجارية دون Tenant Context.
- لا نأخذ `tenant_id` من Body ونثق به.
- يتم اشتقاق الـTenant من الجلسة أو الـterminal identity.
- كل Unique Constraint تجاري يُراجع هل يجب أن يكون داخل Tenant.
- كل Cache key يحتوي على Tenant.
- كل Job يحمل Tenant context.
- كل File path يحتوي على Tenant namespace.
- كل Export خاص بـTenant واحد.
- اختبارات Tenant A/Tenant B لكل Endpoint حساس.
- Platform support access مؤقت ومسجل.

---

# 9. الاشتراكات والباقات

## المفاهيم

### Permission

هل المستخدم داخل الشركة يستطيع تنفيذ العملية؟

### Entitlement

هل اشتراك الشركة يحتوي على الميزة؟

### Limit

كم موردًا مسموحًا؟

مثال:

```
Permission:
user.can_create_transfer = true

Entitlement:
subscription.inventory_transfers = false

Result:
Transfer is unavailable.
```

## الكيانات

```
Plan
PlanVersion
Entitlement
PlanEntitlement
PlanLimit
Market
PriceBook
Price
Subscription
SubscriptionItem
SubscriptionOverride
Coupon
Trial
UsageRecord
BillingCustomer
BillingInvoice
BillingPayment
```

## Plan Versioning

لا يتم تعديل باقة العملاء القدامى مباشرة.

```
Grow v1
Grow v2
```

كل اشتراك مرتبط بإصدار محدد.

---

# 10. الباقات الأولية

الأسماء والأسعار تعتبر hypotheses حتى انتهاء مقابلات العملاء والـPilot.

## Start

مناسب لمتجر صغير:

- Tenant واحد.
- Location واحد.
- POS terminal واحد.
- Warehouse user واحد.
- المبيعات.
- Offline.
- Basic inventory.
- المنتجات والـvariants.
- ورديات.
- فواتير.
- تقارير أساسية.
- دعم قياسي.

## Grow

- Location أساسي.
- عدة Terminals.
- مشتريات.
- موردون.
- صلاحيات متقدمة.
- Inventory history.
- Stock counts.
- Device monitoring.
- تقارير متقدمة.
- Data export.
- Alerts.

## Scale

- عدة Locations.
- Transfers.
- In-transit inventory.
- Partial receiving.
- Centralized management.
- Reconciliation.
- Advanced audit.
- Consolidated reporting.
- API access.
- Priority support.

## Enterprise

- Custom limits.
- Dedicated environment عند الحاجة.
- SLA.
- Migration.
- Custom integrations.
- تدريب.
- Account manager.
- Contract pricing.

---

# 11. التسعير المرن حسب السوق

## ممنوع

تحويل السعر المصري يوميًا من EGP إلى USD أو العكس.

## النموذج

```
Market
├── Egypt
├── GCC
├── Europe
└── Global

PriceBook
├── Currency
├── Billing provider
├── Monthly prices
├── Annual prices
├── Add-on prices
├── Tax policy
├── Availability
├── Effective dates
└── Grandfathering policy
```

## مثال هيكلي

```
Grow v1

Egypt Price Book:
EGP
Local payment provider
Egyptian tax behavior

Global Price Book:
USD
Global payment provider
International tax behavior
```

## وحدات التسعير

السعر يتكوّن من:

```
Base tenant subscription
+ locations
+ terminals
+ selected add-ons
+ onboarding
+ migration
+ hardware
+ premium support
```

لا نجعل التسعير لكل مستخدم فقط.

## نقطة اختبار أولية في مصر

ليست أسعارًا نهائية:

```
Start:
EGP 699–899 / month

Grow:
EGP 1,499–1,999 / month

Scale:
Starting from EGP 2,999 / month

Enterprise:
Custom
```

يجب اختبارها عبر مقابلات وعروض فعلية.

## التسعير الخارجي

لا نطلق “تسعير العالم كله”.

نختار سوقًا ثانيًا محددًا، ثم نبني Price Book خاصة به.

فرضية مبدئية فقط:

```
Start:
$19–$29 / month

Grow:
$49–$79 / month

Scale:
$129–$199 / month
```

Shopify POS Pro يضيف حاليًا $89 شهريًا لكل Location فوق خطة Shopify، بينما Loyverse يتبع نموذج POS مجاني مع إضافات مدفوعة لكل متجر، ما يوضح أن السوق العالمي يقبل نماذج تسعير مختلفة حسب قيمة المنتج ووحدة الاستخدام. citeturn978863search6turn978863search5

---

# 12. دورة الاشتراك

```
INCOMPLETE
→ TRIALING
→ ACTIVE
→ PAST_DUE
→ GRACE_PERIOD
→ RESTRICTED
→ CANCELED
→ ARCHIVED
```

## سياسة فشل الدفع

### PAST_DUE

- النظام يعمل.
- Owner يرى تحذيرًا.
- تبدأ محاولات استرداد الدفع.

### GRACE_PERIOD

- البيع مستمر.
- المزامنة مستمرة.
- الوظائف الحرجة مستمرة.
- تزداد التنبيهات.

### RESTRICTED

- لا نوقف كاشيرًا وسط وردية.
- يمكن تقييد إنشاء فروع أو أجهزة جديدة.
- يمكن تقييد تقارير أو وظائف إدارية.
- البيانات تبقى قابلة للعرض والتصدير.

### CANCELED

- سياسة Read-only محددة.
- Export متاح.
- Retention period واضح.
- لا حذف فوري.

---

# 13. ترخيص أجهزة POS

## Terminal Lease

الـBackend يصدر ترخيصًا موقعًا يحتوي على:

```
tenant_id
location_id
terminal_id
plan_version
entitlements
limits
issued_at
refresh_after
expires_at
offline_grace_until
signature
```

## التشغيل

### Online

- يجدد الجهاز الترخيص دوريًا.
- يتلقى تحديثات الباقة.

### Offline

- يستمر داخل Offline grace.
- لا يحتاج الاتصال بمزود الدفع.
- لا يسأل Billing API عند كل Sale.

### Expired

- تحذير واضح.
- Safe restricted mode.
- لا حذف بيانات.
- لا توقف مفاجئ لعملية بيع بدأت بالفعل.

---

# 14. Billing Architecture

## Billing Provider Interface

```
createCustomer
createCheckoutSession
createPortalSession
createSubscription
changeSubscription
cancelSubscription
fetchInvoices
verifyWebhook
parseWebhook
refundBillingPayment
```

Adapters:

```
EgyptBillingProvider
GlobalBillingProvider
FutureRegionalProvider
```

## فصل الفواتير

```
SalesInvoice
```

فاتورة يخرجها متجر العميل لعميله.

```
BillingInvoice
```

فاتورة تصدرها Bold للمشترك.

لا نخلط بينهما في الجداول أو الخدمات أو التقارير.

## Webhooks

كل Webhook يحتاج:

- Signature verification.
- Event inbox.
- Unique provider event ID.
- Idempotent processing.
- Retry.
- Dead-letter handling.
- Audit.
- Reconciliation job.

---

# 15. الدفع داخل المتجر

نظام الدفع التجاري لعملاء المحل يظل خارج Bold في المرحلة الأولى.

Bold يسجل:

- Cash.
- Card.
- Wallet.
- Bank transfer.
- External payment reference.
- Split payment عند دعمه.

لا يعالج بيانات البطاقات بنفسه.

لاحقًا يمكن عمل Integrations مع:

- Payment terminals.
- QR payments.
- Online payment links.
- SoftPOS providers.

لكن Sales Acceptance لا يتوقف على اتصال مباشر بمزود الدفع إلا في Workflow محدد وواضح.

---

# 16. التكامل الضريبي في مصر

يجب بناء:

```
Compliance Adapter
└── Egypt ETA eReceipt
```

مصلحة الضرائب المصرية توفر APIs رسمية لتكامل أنظمة ERP وPOS مع الإيصال والفاتورة الإلكترونية، بما يشمل إرسال الإيصالات والاستعلام عنها والإشعارات المتعلقة بالأجهزة والوثائق. citeturn302233search3turn302233search22turn302233search34

المطلوب:

- POS registration.
- Credentials lifecycle.
- UUID generation.
- QR.
- Receipt normalization.
- Signing requirements.
- Submission queue.
- Batch submission.
- Polling/callback handling.
- Rejected receipt reasons.
- Return references.
- Credential expiration alerts.
- Audit.
- Reconciliation.

الـCore لا يعتمد على مصر.

```
ComplianceAdapter
├── EgyptETA
├── FutureCountryA
└── FutureCountryB
```

---

# 17. موقع Bold التسويقي

## الهدف

الموقع مسؤول عن:

- تعريف المشكلة.
- إظهار المنتج.
- بناء الثقة.
- مقارنة الباقات.
- بدء Trial.
- حجز Demo.
- إنشاء الحساب.
- بدء Checkout.
- توفير المحتوى والمساعدة.
- جذب Leads.
- SEO.
- تحويل الزائر إلى عميل.

## Sitemap

```
/
├── Product
│   ├── Point of Sale
│   ├── Inventory
│   ├── Warehouse
│   ├── Purchasing
│   ├── Multi-location
│   ├── Offline
│   ├── Reporting
│   ├── Devices
│   └── Trust Layer
│
├── Solutions
│   ├── Fashion
│   ├── Footwear
│   ├── Accessories
│   ├── Cosmetics
│   └── Multi-branch Retail
│
├── Pricing
├── Compare
├── Demo
├── Signup
├── Login
├── Checkout
├── Checkout Success
├── Customers
├── Security
├── Status
├── Help
├── Documentation
├── Partners
├── Contact
├── Privacy
├── Terms
├── Subscription Terms
├── Refund Policy
├── Data Processing Terms
└── Acceptable Use
```

## الصفحة الرئيسية

```
Hero:
السيطرة على البيع والمخزون من الكاشير إلى المخزن والفروع.

Problem:
لماذا تختلف الكمية؟

How Bold works:
POS + Warehouse + Control.

Trust proof:
Offline, idempotency, audit, device status.

Use cases:
Fashion, footwear, variants.

Product demonstration.

Pricing preview.

Customer proof.

Security and compliance.

CTA:
Start trial / Book demo.
```

## Pricing Page

- Monthly/annual toggle.
- Plans.
- Included limits.
- Add-ons.
- Extra terminal cost.
- Extra location cost.
- Onboarding.
- Hardware.
- Taxes.
- Billing FAQ.
- Cancellation.
- Trial.
- Upgrade/downgrade rules.
- Enterprise CTA.

---

# 18. رحلة العميل

```
Marketing website
→ Pricing or demo
→ Signup
→ Email/phone verification
→ Create tenant
→ Select market
→ Trial or checkout
→ Create location
→ Configure business
→ Import catalog
→ Invite users
→ Enroll terminal
→ Test printer
→ Open first shift
→ Make first sale
→ First sync
→ Activation complete
```

## Onboarding Wizard

1. Business name.
2. Country.
3. Currency.
4. Timezone.
5. Tax settings.
6. Business category.
7. First location.
8. Warehouse.
9. Product import.
10. Receipt settings.
11. User invitations.
12. POS enrollment.
13. Printer test.
14. Test sale.
15. Go live.

---

# 19. Platform Operations

## دعم العميل

لا يدخل موظف Bold إلى Tenant بطريقة غير مسجلة.

Support access يحتاج:

- Reason.
- Expiration.
- Requested permissions.
- Operator identity.
- Tenant identity.
- Audit events.
- Optional customer approval.

## مراقبة المنصة

- API availability.
- Database.
- Queue depth.
- Sync backlog.
- Oldest outbox age.
- Device last seen.
- Crash-free sessions.
- Failed sales.
- Duplicate prevention alerts.
- ETA submissions.
- Billing webhooks.
- Failed renewals.
- Provisioning failures.
- Backup status.
- Restore test status.

---

# 20. الأمن

## Identity

- Owner MFA.
- Secure sessions.
- Refresh token policy.
- Session revocation.
- Password policy.
- Rate limiting.
- Lockout.
- Login alerts.
- Device enrollment.
- Device revocation.

## Data

- Tenant isolation.
- Encryption in transit.
- Encryption at rest where applicable.
- Secrets management.
- Signed terminal leases.
- Audit logs.
- Data export.
- Retention policy.
- Deletion workflow.
- Backup.
- Restore testing.

## Development

- Dependency scanning.
- Secret scanning.
- Static analysis.
- Migration gate.
- CI gates.
- Security tests.
- Cross-tenant tests.
- Release signing.
- Electron update integrity.

---

# 21. Analytics

## Product Funnel

```
Website visit
Pricing viewed
Signup started
Signup completed
Tenant created
Location created
Products imported
Terminal enrolled
First shift
First sale
First sync
Trial activated
Paid conversion
Renewal
Expansion
Cancellation
```

## SaaS Metrics

- MRR.
- ARR.
- Trial conversion.
- Activation rate.
- Time to first sale.
- Churn.
- Expansion revenue.
- ARPA.
- CAC.
- Payback period.
- Failed payment recovery.
- Active tenants.
- Active locations.
- Active terminals.

## Operational Metrics

- Sales sync success.
- Sync latency.
- Duplicate prevention.
- POS crashes.
- API p95.
- Database latency.
- Negative stock.
- Reconciliation differences.
- Oldest pending operation.
- Migration health.

---

# 22. ماذا يحدث للـRoadmap القديمة؟

الـRoadmap الحالية تحتوي على أعمال صحيحة ومهمة، خصوصًا P0 الخاص بثبات البيع والـOffline والـidempotency، ثم Warehouse App والـinventory ledger والمزامنة والأمان. fileciteturn1file0

لكن ترتيبها يتغير.

## ما يبقى

### P0

يبقى بوابة الثبات الأساسية.

### P1

نأخذ منه Warehouse MVP أولًا، ثم نوسع الوظائف.

### P2

نأخذ Inventory Ledger والمطابقة الأساسية قبل الإطلاق.

### P3

نأخذ متطلبات الاعتمادية الضرورية للـPilot.

### P4

ندمج الأمن والتشغيل مع SaaS Foundation.

### P5

يتحول إلى Growth Roadmap بعد السوق.

## ما يتغير

- إضافة Tenant في كل التصميم.
- فصل Platform Admin.
- إضافة Plans وEntitlements.
- إضافة Terminal licensing.
- إضافة Billing.
- إضافة Market price books.
- إضافة Onboarding.
- إضافة Marketing site.
- إضافة Compliance adapters.
- إضافة SaaS analytics.
- إضافة Customer lifecycle.

---

# 23. الخطة التنفيذية النهائية

## Stage 0 — Product and Market Lock

### المخرجات

- تثبيت الـICP.
- تثبيت القطاع الأول.
- 15–20 مقابلة مع تجار.
- Competitive matrix.
- Feature expectations.
- Pricing interviews.
- Support expectations.
- Hardware expectations.
- Payment preferences.
- ETA requirements.
- Brand name validation.

### Gate

نعرف بالضبط:

- لمن نبيع؟
- ما المشكلة المدفوعة؟
- لماذا يترك نظامه الحالي؟
- كم يدفع؟
- ما الذي يمنعه من الشراء؟

---

## Stage 1 — Stabilize Existing Core

### المخرجات

- إغلاق P0 الحقيقي.
- POS 1.4.0 canary.
- Pending invoice resolved.
- Offline test.
- Migration gate.
- CI concurrency.
- Production observation.

### Gate

لا فقد ولا تكرار لفواتير أو مخزون في سيناريوهات الاختبار الأساسية.

---

## Stage 2 — SaaS Tenant Foundation

### المخرجات

- Tenant model.
- Memberships.
- Tenant context.
- Data backfill.
- Isolation enforcement.
- Composite constraints.
- Tenant-aware jobs and files.
- Cross-tenant tests.
- Platform authentication boundary.

### Gate

Tenant A لا يمكنه قراءة أو تعديل Tenant B.

---

## Stage 3 — Warehouse MVP

### المخرجات

- Products and variants.
- Barcode.
- Suppliers.
- Purchase receiving.
- Cost and stock transaction.
- Labels.
- Basic supplier returns.
- Inventory history.

### Gate

متجر Pilot يستطيع إدخال بضاعته وتشغيل البيع دون Admin operational entry.

---

## Stage 4 — Inventory Integrity

### المخرجات

- Unified movement ledger.
- Stock counts.
- Adjustments.
- Reconciliation.
- Negative-stock policy.
- Audit.
- Recovery commands.

### Gate

يمكن تفسير كل كمية من خلال حركات موثقة.

---

## Stage 5 — Plans and Entitlements

### المخرجات

- Plans.
- Versions.
- Entitlements.
- Limits.
- Overrides.
- Backend enforcement.
- Upgrade-required responses.
- Usage counters.

### Gate

تغيير Plan لا يحتاج Deploy.

---

## Stage 6 — Subscription and Billing

### المخرجات

- Billing provider abstraction.
- Egypt provider integration.
- Global provider-ready interface.
- Checkout.
- Webhooks.
- Invoices.
- Payment retries.
- Subscription lifecycle.
- Customer billing portal.

### Gate

يمكن بدء وتجديد وترقية وإلغاء اشتراك دون تعديل يدوي في قاعدة البيانات.

---

## Stage 7 — POS SaaS Licensing

### المخرجات

- Terminal lease.
- Offline grace.
- Device limits.
- Plan snapshot.
- Expiry warnings.
- Restricted-mode policy.
- Lease sync.

### Gate

فشل الدفع أو الإنترنت لا يوقف عملية بيع آمنة، ولا يسمح باستخدام أجهزة غير مرخصة بلا حدود.

---

## Stage 8 — Customer Onboarding

### المخرجات

- Signup.
- Verification.
- Provisioning.
- Setup wizard.
- Import.
- Enrollment.
- First-sale checklist.
- Trial countdown.
- Lifecycle emails.

### Gate

عميل جديد يصل لأول عملية بيع دون مطور.

---

## Stage 9 — Platform Admin and Operations

### المخرجات

- Tenant management.
- Plans.
- Subscriptions.
- Trials.
- Payments.
- Support access.
- Terminal health.
- Sync health.
- Audit.
- Exports.
- Suspend/reactivate.
- Offboarding.

### Gate

يمكن تشغيل عشرات العملاء دون الدخول المباشر لقاعدة البيانات.

---

## Stage 10 — Brand and Marketing Website

يمكن بدء التصميم بعد Stage 0، لكن الربط النهائي مع المنتج يتم بعد Stage 6 وStage 8.

### المخرجات

- Brand system.
- Logo.
- Website.
- Pricing.
- Product pages.
- Demo.
- Signup.
- Checkout.
- Legal.
- SEO.
- Analytics.
- Content.
- Open Graph.
- Status and help.

### Gate

رحلة كاملة من زيارة الموقع إلى Trial أو Demo أو اشتراك.

---

## Stage 11 — Egypt Compliance

### المخرجات

- ETA adapter.
- POS registration.
- eReceipt pipeline.
- Queue.
- Submission.
- Status.
- Returns.
- Error handling.
- Audit.
- Credentials monitoring.

### Gate

إرسال واسترجاع ومطابقة الإيصالات وفق البيئة الرسمية.

---

## Stage 12 — Private Pilot

### العدد

3–5 متاجر من القطاع المستهدف.

### المطلوب

- استخدام فعلي.
- Billing حقيقي أو اتفاق Pilot واضح.
- Support logs.
- Activation tracking.
- أسبوعان أو أكثر من التشغيل.
- Offline events.
- Device updates.
- Inventory reconciliation.

### Gate

لا توسيع قبل حل مشكلات البيانات والتشغيل المتكررة.

---

## Stage 13 — Paid Beta

10–25 Tenant.

### المطلوب

- أسعار فعلية.
- Renewals.
- Annual/monthly.
- Support processes.
- Monitoring.
- Backups.
- ETA عند الحاجة.
- Documentation.
- Training materials.

### Gate

نجاح دورة اشتراك وتجديد كاملة.

---

## Stage 14 — Egypt Public Launch

- Public website.
- Public pricing.
- Self-service or sales-assisted onboarding.
- Support SLAs.
- Partner program.
- Hardware compatibility.
- Sales playbook.
- Customer success.
- Referral program.

---

## Stage 15 — Internationalization

لا يبدأ بمجرد ترجمة الموقع.

### المطلوب

- اختيار دولة واحدة.
- Local research.
- Price book.
- Currency.
- Tax adapter.
- Payment provider.
- Legal documents.
- Data residency review.
- Support hours.
- Language.
- Hardware.
- Compliance.
- Pilot customers.

---

# 24. نظام إدارة العمل

## لا نكتب Roadmap جديدة لكل مشكلة

أي اكتشاف يوضع في واحد من:

```
Strategic change
Architecture requirement
Stage backlog
Bug
Security issue
Operational incident
Commercial hypothesis
```

## ترتيب الأولوية

```
P0:
Data loss, duplication, security, cross-tenant access, blocked sales.

P1:
Activation, core operations, subscription, billing, onboarding.

P2:
Retention, productivity, reporting, advanced operations.

P3:
Growth enhancements and experiments.
```

## عند ظهور Bug

نسأل:

1. هل يهدد البيانات؟
2. هل يهدد عزل العملاء؟
3. هل يمنع البيع؟
4. هل يمنع المزامنة؟
5. هل يمنع الاشتراك؟
6. هل يمنع الـPilot؟
7. إلى أي Stage ينتمي؟
8. هل هو Root cause أم عرض؟
9. ما اختبار عدم التكرار؟
10. هل يغير الـMaster Blueprint؟

لو لا يغير المنتج أو المعمارية، لا نعيد كتابة الخطة.

---

# 25. تعريف النجاح

Bold لا يصبح SaaS ناجحًا عندما نضيف زر Subscribe.

يصبح SaaS ناجحًا عندما:

- يدخل عميل جديد دون تعديل في الكود.
- بياناته معزولة.
- يشغل أول جهاز.
- يجري أول بيع.
- يزامن بدون تكرار.
- يدير مخزونه.
- يدفع اشتراكه.
- يجدد اشتراكه.
- يغير باقته.
- يحصل على دعم دون كشف غير منضبط لبياناته.
- يخرج بياناته عند الإلغاء.
- ويمكن إضافة العميل التالي دون زيادة مماثلة في مجهود التشغيل.

---

# القرار النهائي

نوقف تنفيذ Features جديدة مؤقتًا، لكن لا نرمي الكود القديم.

الخطوة التالية ليست العودة إلى P0 فورًا.

الخطوة التالية هي:

```
Stage 0 — Product and Market Lock
```

ثم نعمل Audit على الكود والـRoadmap الحالية مقابل هذه الوثيقة ونقسم كل الموجود إلى:

```
Keep
Modify
Remove
Defer
Build New
```

بعدها فقط نستأنف التنفيذ حسب Stage واضحة، وكل مرحلة لها Gate تمنعنا من الدوران في دوامة Bugs بلا نهاية.

[تقارير SaaS](%D8%AA%D9%82%D8%A7%D8%B1%D9%8A%D8%B1%20SaaS%203abf9447e5ca81bfb695f39269cffb9c.md)

[ATHR Product & System Design Hub](ATHR%20Product%20&%20System%20Design%20Hub%203acf9447e5ca81e99375d5714f1a75f5.md)