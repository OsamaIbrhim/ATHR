# ATHR Warehouse App (Mobile) — Master Plan v1.0

**Planning Baseline — Android-first Warehouse Client, iOS-ready**

الحالة: مسودة للاعتماد — لم يُكتب أي كود بعد.
تاريخ التأليف: 2026-08-09.
المؤلف: طبقة التخطيط. جلسة الكود (Claude Code CLI) تنفّذ كودًا فقط ولا تؤلف وثائق.

---

## 0. موقع هذه الوثيقة من الحوكمة القائمة

هذه الوثيقة **تابعة** لـ `ATHR Work Mode Execution Plan v1.0`، ولا تنافسها ولا تعدّلها.

**التصحيح الجوهري:** تطبيق المخزن **ليس مشروعًا جديدًا** — هو عميل معتمد أصلًا في معمارية ATHR:

- `ATHR SaaS` §«التطبيق المشترك» يدرج `Warehouse App` كأحد خمسة عملاء رسميين للـ Backend.
- `BOLD_FINAL_ROADMAP` §«القرار المعماري النهائي» يعطيه مسؤولية **كل إدخال المخزن**، ويحوّل Admin Web إلى Read-only تشغيليًا مقابله.
- `BOLD_FINAL_ROADMAP` P1 §3–5 يحدد المرحلة الأولى منه ببنود مرقّمة.

وكل الأساس الخلفي الذي يحتاجه **مجدول بالفعل** في Waves 4–5. لذلك هذه الوثيقة:

1. تربط كل قدرة في التطبيق بالـ WP الخلفي الذي يوفّرها — **بلا تكرار**.
2. تحدد الدلتا الحقيقية الخاصة بالموبايل فقط.
3. تضع WPs جديدة **مرقّمة داخل التسلسل القائم** لا في مسار موازٍ.
4. ترفع تعارضًا واحدًا حقيقيًا يحتاج قرارك (§4).

**قاعدة حاكمة:** لا يبدأ أي `WP-M` قبل إغلاق الـ WP الخلفي الذي يعتمد عليه، بموجب نفس بوابات §6 من خطة التنفيذ.

---

## 1. مصفوفة الاعتماد — ما هو مجدول بالفعل

| ما يحتاجه التطبيق | الـ WP القائم الذي يوفّره | نص البند في خطة التنفيذ | الحالة |
|---|---|---|---|
| الجرد والتسويات | **WP-009 — Inventory and Stock** | بند 5: *«Add stock count/reconciliation states»* | مخطط، لم يُنفَّذ |
| تعميم المخزون على Location/Warehouse | **WP-009** | بند 1 | مخطط |
| الحجوزات والإتاحة | **WP-009** | بند 3 | مخطط |
| أمر الشراء وفصل الاستلام عن فاتورة المورد | **WP-012 — Purchasing and Suppliers** | بند 1: *«Add PurchaseOrder lifecycle»*، بند 2: *«Separate GoodsReceipt and SupplierInvoice»* | مخطط |
| مرتجعات الموردين والمطابقة | **WP-012** | بند 4 | مخطط |
| آلة حالة التحويلات الكاملة + الفروق + منع الاستلام المكرر | **WP-013 — Transfers** | القسم كامل (`Draft → Approved → Shipped → PartiallyReceived → Received`) | مخطط |
| المزامنة: bootstrap، snapshot، cursors، رفع دفعات العمليات، dedup، النزاعات، tombstones، الاسترداد | **WP-016 — Sync Protocol v1** | القسم كامل، **بما فيه** *«Migrate current POS without losing pending outbox operations»* | مخطط |
| الـ Offline: `OfflineAuthorizationLease` موقّع، capability levels، snapshot bindings، clock evidence، **device signing abstraction**، حالات pending/conflict للمستخدم | **WP-017 — Offline Protocol v1** | القسم كامل | مخطط |
| تعطيل/تسجيل الأجهزة | **WP-015** (بند 2) + **WP-017** (device signing) | — | مخطط |
| التقوية الأمنية | **WP-024 — Security Hardening** | — | مخطط |
| إزالة ازدواج نظامَي التفويض | نتيجة طبيعية لـ Waves 4–5 (كل موديول يُهاجر إلى `RequirePermission` + `TenantContext`) | — | جارٍ |

**الخلاصة:** ما كنت سمّيته «فجوات» هو في الحقيقة **جدول أعمالك القائم**. الفجوة الوحيدة الحقيقية هي أن التطبيق نفسه غير مذكور كـ WP في Wave 6.

---

## 2. الدلتا الحقيقية — ما هو خاص بالموبايل ولا يغطيه أي WP قائم

بعد طرح كل ما سبق، يتبقى **أربعة** بنود فقط:

| # | الدلتا | لماذا ليست ضمن WP قائم | أين تُعالَج |
|---|---|---|---|
| **D1** | التطبيق نفسه: workspace، بوابات جودة، طبقات، CI، إصدار Android | Wave 6 فيه `WP-019` Admin Shell و`WP-021` POS Experience، ولا شيء للموبايل | **WP-M1** جديد |
| **D2** | عميل Sync/Offline على React Native فوق عقود WP-016/017 | الـ WPs الخلفية تعرّف البروتوكول؛ لا تنفّذ عميلًا لكل منصة (تمامًا كما `WP-018` يخص عميل POS وحده) | **WP-M2** جديد |
| **D3** | شاشات الإدخال المخزني الأربعة | `WP-020` نطاقه **Admin workflows** حصرًا؛ و`BOLD_FINAL_ROADMAP` ينقل الإدخال من Admin إلى Warehouse App | **WP-M3 … WP-M6** |
| **D4** | طباعة ملصقات الباركود من الجهاز | مذكورة في `BOLD_FINAL_ROADMAP` P1 §3 ولا WP خلفي يغطيها | **WP-M6** أو تأجيل صريح |

هذا كل شيء. لا `WP-M01 Mobile Device Identity` (يوفّره WP-017)، ولا `WP-M02 Stock Count` (يوفّره WP-009)، ولا `WP-M03 Mobile Sync` (يوفّره WP-016).

---

## 3. الموضع في التسلسل

```
Wave 4 — Domain Migration
  WP-008 ✔ (Phase B مدموج)
  WP-009  Inventory & Stock        ← يفتح: الجرد والتسويات
  WP-012  Purchasing & Suppliers   ← يفتح: أمر الشراء والاستلام
  WP-013  Transfers                ← يفتح: التحويلات
Wave 5 — Sync & Offline Replacement
  WP-016  Sync Protocol v1         ← يفتح: عقد المزامنة
  WP-017  Offline Protocol v1      ← يفتح: الـ lease والتوقيع والأجهزة
Wave 6 — Admin and Product Experience
  WP-019  Admin Shell
  WP-020  Operational Modules UI
  WP-021  POS Experience
  WP-M1   Warehouse App Foundation      ← جديد
  WP-M2   Warehouse App Sync/Offline    ← جديد
  WP-M3   استلام المشتريات               ← جديد
  WP-M4   التحويلات                      ← جديد
  WP-M5   الجرد والتسويات                ← جديد
  WP-M6   المنتجات والموردون + الملصقات   ← جديد
Wave 8
  WP-M7   تقوية وإصدار Android           ← جديد، بمحاذاة WP-024/WP-026
```

**بوابة الدخول لـ WP-M1:** WP-016 وWP-017 مغلقتان. أي بدء أبكر يعني بناء عميل فوق بروتوكول غير مستقر — وإعادة كتابته لاحقًا.

**استثناء مسموح واحد:** يمكن بدء `WP-M1` (الهيكل والـ CI فقط، بلا أي شاشة تلمس بيانات) بالتوازي مع Wave 5، لأنه لا يستهلك أي عقد بعد. أي WP بعده ينتظر.

---

## 4. ⚠️ تعارض يحتاج قرارك — نموذج الـ Offline

أنت طلبت: «offline يشتغل زي الـPOS كده وكده».

لكن `BOLD_FINAL_ROADMAP` §«أسلوب اتصال Warehouse App» يقول حرفيًا:

> - يمكن حفظ Draft محليًا أثناء المسح والإدخال.
> - **الترحيل النهائي للمخزون يحتاج اتصالًا بالـBackend.**
> - **لا نسمح بعمليتي ترحيل متعارضتين Offline.**

هذا **ليس** نموذج POS. POS يرحّل البيع Offline ويزامن لاحقًا؛ الوثيقة المعتمدة تمنع ذلك على المخزن صراحةً.

المنطق خلف القرار المعتمد سليم: البيع يخصم صنفًا واحدًا معروفًا من رصيد الفرع، أما الاستلام والتحويل والجرد فتحرّك دفتر التكلفة المرجّح وأرصدة موقعين، وترحيلان متعارضان Offline يفسدان التكلفة بشكل لا يُصلَح آليًا.

**لا أحسم هذا من عندي.** الخيارات:

| الخيار | الأثر |
|---|---|
| **أ — التزام بالمعتمد (الافتراضي)** | مسح وعدّ وإدخال Draft بالكامل Offline (وهو 90% من زمن العامل)، والترحيل يحتاج اتصالًا. لا تغيير في الحوكمة، ولا مخاطرة على دفتر التكلفة. |
| **ب — توسيع الـ Offline ليشمل الترحيل** | يتطلب **تعديل `BOLD_FINAL_ROADMAP` بقرار موثَّق + ADR**، ويعتمد كليًا على `OfflineAuthorizationLease` وcapability levels من WP-017، ويضيف طبقة حل نزاعات للتكلفة المرجّحة. تكلفة عالية ومخاطرة مالية حقيقية. |

الخطة أدناه مكتوبة على **الخيار أ**. لو اخترت ب، أعيد كتابة WP-M2 وWP-M3/4/5 وأكتب الـ ADR والتعديل على الـ roadmap.

---

## 5. الأسئلة الأخرى قبل البدء

1. **الأدوار في الإصدار الأول:** `BOLD_FINAL_ROADMAP` P1 §3 يذكر `warehouse_manager` فقط. أنت طلبت تطبيقًا متعدد الأدوار. هل نضيف `location_manager` و`tenant_owner` (عرض + اعتماد) في الإصدار الأول، ونؤجل `cashier`/`seller` (لهم POS)؟
2. **الأجهزة:** أقل إصدار Android؟ وهل الماسح مدمج (Zebra/Honeywell) أم كاميرا؟ يحدد تصميم `core/scanner`.
3. **طباعة الملصقات (D4):** ضمن الإصدار الأول أم مؤجلة؟ تحتاج تكامل طابعة Bluetooth وقالب ملصق.
4. **العدّ الأعمى في الجرد:** هل يرى العادّ الكمية المتوقعة؟ (اقتراحي: لا)
5. **بوابة البدء:** هل تريد `WP-M1` بالتوازي مع Wave 5 (الاستثناء في §3)، أم بالتسلسل الصارم؟

---

## 6. القرارات المعمارية المطلوبة (ADRs)

ADRs موجودة حتى 0006. المطلوب **ثلاثة فقط** — الباقي محسوم في WP-016/017.

| ADR | العنوان | القرار المقترح | البدائل المرفوضة |
|---|---|---|---|
| **ADR-0007** | Warehouse App Client Platform | React Native + Expo، TypeScript strict، workspace رابع `mobile/` | Flutter (يفقد إعادة استخدام `packages/*` التي بُنيت في WP-002/003/004)، Kotlin native (يضاعف تكلفة iOS)، PWA (لا يلبي الباركود/Offline) |
| **ADR-0008** | Warehouse App Offline Boundary | يثبّت مخرج §4 كقاعدة معمارية ملزمة، ويعرّف بالضبط ما يُنشأ Offline | تركه ضمنيًا |
| **ADR-0009** | Warehouse App Release Channel | قناة توقيع وإصدار مستقلة عن POS، مع `min_supported_app_version` يفرضه الخادم | مشاركة قناة POS |

**ملاحظة حوكمة:** ADR-0007 قرار طويل الأمد ويحدد سقف iOS لاحقًا. يُكتب ويُعتمد قبل أول سطر كود.

---

## 7. معمارية التطبيق

```
mobile/
├─ app/                     # expo-router — شاشات فقط، صفر منطق عمل
├─ src/
│  ├─ features/             # receiving/ transfers/ counting/ catalog/
│  │   └─ <feature>/        # screens · hooks · mappers · __tests__
│  ├─ core/
│  │   ├─ auth/             # session، refresh، اختيار Tenant/Location
│  │   ├─ authz/            # can(key) — مصدره الخادم لا الكود
│  │   ├─ api/              # عميل HTTP: envelope + @athr/error-registry + idempotency
│  │   ├─ db/               # SQLite للمسودات والكتالوج، migrations للأمام فقط
│  │   ├─ outbox/           # طابور أوامر WP-016، إعادة المحاولة، النزاعات
│  │   ├─ sync/             # عميل WP-016: bootstrap/snapshot/cursor
│  │   ├─ lease/            # عميل WP-017: OfflineAuthorizationLease
│  │   ├─ scanner/          # تجريد الباركود خلف واجهة قابلة للـ mock
│  │   └─ telemetry/        # سجلات منقّحة — نمط diagnostic-redaction.ts
│  └─ ui/                   # مكوّنات pure، بلا شبكة أو DB
└─ e2e/                     # Maestro
```

**قواعد الطبقات — مفروضة آليًا بـ `scripts/check-workspace.mjs` + ESLint boundaries، لا بالتوثيق (CLAUDE.md §2):**

1. `app/` و`ui/` لا يستوردان `core/api|db|outbox` — فقط عبر hooks في `features/`.
2. `features/<a>` لا يستورد `features/<b>`.
3. `core/db|outbox` لا يستورد أي شيء من `features/`.
4. `mobile` يعتمد على `@athr/contracts`، `@athr/domain-core`، `@athr/error-registry`؛ والعكس ممنوع (يُضاف إلى `forbiddenReverseDependencies`).
5. `react-native` و`expo-*` تُضاف إلى `forbiddenDomainDependencies` في `check-workspace.mjs`.
6. **لا منطق عمل مكرر:** التحقق المحلي للتجربة فقط. القرار للـ Backend (`BOLD_FINAL_ROADMAP` §القواعد الثابتة).

---

## 8. الأمن والصلاحيات

1. **Default deny** — التطبيق لا يعرض إجراءً لم يصل مفتاح صلاحيته من الخادم.
2. **إخفاء UI ليس تحكّمًا أمنيًا** (`Permission Matrix` §3 بند 9). كل أمر يُعاد تفويضه server-side (بند 10).
3. `TenantContext` لا يُبنى أبدًا من حقل يرسله العميل — فقط من `tenant-context.resolver.ts`.
4. الأسرار والـ lease الموقّع في `expo-secure-store` (Keystore) حصرًا. ممنوع AsyncStorage أو SQLite أو ملف عادي.
5. لا تكلفة ولا هامش محليًا بلا `pricing.cost.view` / `inventory.position.view-cost` — **حذف من الـ payload، لا إخفاء في الواجهة**.
6. إبطال الجهاز أو تعليق العضوية → مسح القاعدة المحلية وحظر أي مسودات معلّقة.
7. `permissionPolicyVersion` mismatch → إعادة مزامنة إجبارية قبل أي كتابة.
8. Certificate pinning في بناء الإنتاج.
9. ممنوع `console.*` — يفشل الـ CI.

---

## 9. استراتيجية الاختبار

«لم يُشغَّل» = **غير متحقق منه** (CLAUDE.md §6.3). لا إغلاق WP بلا دليل مُشاهد.

| المستوى | الأداة | الحد الأدنى |
|---|---|---|
| Unit | Vitest (اتساقًا مع POS) | ≥ 85% على `src/core/`، و**100%** على `outbox` + `sync` + `authz` + `lease` |
| Component | React Native Testing Library | كل شاشة تختبر: loading / empty / error / **denied** / **offline** |
| Contract | Vitest مقابل `@athr/contracts` | كل endpoint مستهلَك، مع مطابقة الـ envelope وError Registry |
| Integration | Vitest + خادم mock + SQLite في الذاكرة | كل مسار مسودة → outbox → ترحيل → ack، وكل مسار رفض |
| E2E | Maestro على emulator **في CI** | المسارات الأربعة + الدخول واختيار الموقع |
| Backend | امتداد `test:hard` القائم | أي endpoint جديد: `*.cross-tenant.spec.ts` إلزامي (النمط قائم — 23 ملفًا في الريبو) |

**Anti-Gap Suite** — تُكتب في WP-M2، وتعمل في كل PR بعدها:

1. إعادة إرسال نفس `idempotency_key` مرتين → حركة مخزون واحدة.
2. مستخدم بلا `transfer.receive` يستدعي الـ API مباشرة → رفض، ولا أثر جانبي.
3. طلب عابر للمستأجرين → رفض بلا تسريب وجود.
4. جهاز مُبطَل بمسودات معلّقة → رفض شامل ومسح محلي.
5. `permissionPolicyVersion` قديم → الكتابة محظورة.
6. انقطاع في منتصف الترحيل → نتيجة واحدة، لا ازدواج ولا فقد.
7. التكلفة غائبة من الـ payload بلا صلاحية (تأكيد على مستوى الشبكة، لا الواجهة).
8. `OfflineAuthorizationLease` منتهٍ → التطبيق يمنع الترحيل ويوضّح السبب.

---

## 10. قواعد الكود الصارمة — خاصة بالموبايل

فوق `CLAUDE.md` كاملًا، ومفروضة بفشل CI لا بالمراجعة البشرية.

| # | القاعدة | الفرض |
|---|---|---|
| M-1 | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`؛ ممنوع `any`؛ `@ts-expect-error` بسبب مكتوب فقط | `tsc` + ESLint |
| M-2 | كل استجابة شبكة تمر عبر Zod قبل لمس الـ state | قاعدة lint مخصصة |
| M-3 | ممنوع استدعاء شبكة من مكوّن UI | ESLint boundaries |
| M-4 | ممنوع `console.*` في `src/` | `no-console: error` |
| M-5 | الأسرار في SecureStore حصرًا | lint + مراجعة PR |
| M-6 | النقود بأعداد صحيحة (minor units) — نمط `money-codec.ts` | اختبار وحدة |
| M-7 | كل migration لـ SQLite للأمام فقط وغير مدمِّرة، **ولها اختبار ترقية من الإصدار السابق** — النمط قائم: `local-state-migration.test.ts` | اختبار إلزامي |
| M-8 | لا نص واجهة مضمَّن — ملف ترجمة + RTL منذ اليوم الأول (`ATHR SaaS`: العربية هي النسخة الأصلية) | lint |
| M-9 | `idempotency_key` يُولَّد عند **إنشاء النية** لا عند الإرسال | اختبار outbox |
| M-10 | لا منطق عمل مكرر من الـ Backend | Compliance Checklist |
| M-11 | حجم الحزمة ووقت الإقلاع البارد مقيسان بحد أقصى يفشل البناء | job CI |
| M-12 | صفر تحذيرات — `--max-warnings 0` | CI |

---

## 11. المراحل

> **Pre-Flight لكل جلسة كود:** اقرأ `CLAUDE.md`، اقرأ وثيقة الـ WP، أكّد الفرع المتفرع من `master` المحدَّث، **لا تكتب أي وثيقة**.

### WP-M0 — اعتماد القرارات

- المخرَج: `docs/adr/0007..0009-*.md` — أكتبها أنا.
- لا فرع كود. الإغلاق: موافقتك + إجابات §4 و§5.
- **Skill:** `engineering:architecture`.

---

### WP-M1 — أساس التطبيق وبوابات الجودة

- **الفرع:** `feat/wp-m1-warehouse-app-foundation`
- **البوابة:** الوحيد المسموح ببدئه بالتوازي مع Wave 5 (لا يستهلك أي عقد).
- **Scope In:** `mobile/` كـ workspace رابع؛ Expo + TS strict + expo-router + Vitest + RNTL + Maestro؛ ESLint boundaries تنفّذ §7؛ قواعد M-1..M-12 كأخطاء؛ توسيع `check-workspace.mjs` (`applicationDirectories`، `forbiddenDomainDependencies`، `forbiddenReverseDependencies`)؛ job `mobile` في `.github/workflows/ci.yml`؛ شاشة واحدة «صحة النظام».
- **Scope Out:** أي شاشة ميزة، أي بيانات حقيقية، أي استهلاك API.
- **Testing:** اختبار يثبت أن انتهاك حدود الطبقات **يفشل** الـ lint؛ اختبار مكوّن للشاشة الوحيدة؛ `workspace:validate` أخضر.
- **Acceptance:** `npm ci && npm run test:soft` نظيف من الصفر، مُثبت على **الأربع** consumers: backend، admin-web، pos-electron، mobile (CLAUDE.md §6.4)؛ APK debug يُبنى **ويُشغَّل** على emulator بدليل.
- **Skill:** `engineering:testing-strategy` + `engineering:deploy-checklist`.

---

### WP-M2 — عميل المزامنة والـ Offline والصلاحيات

- **الفرع:** `feat/wp-m2-warehouse-app-sync`
- **البوابة الصارمة:** WP-016 وWP-017 مغلقتان.
- **Scope In:** الدخول واختيار Tenant/Location ضمن النطاق؛ تسجيل الجهاز عبر آلية WP-017؛ `core/lease` يستهلك `OfflineAuthorizationLease` الموقّع ويحترم capability levels؛ `core/sync` يستهلك عقد WP-016 (bootstrap، snapshot، cursors، tombstones، resync)؛ `core/outbox` يستهلك رفع الدفعات وسجل النتائج وdedup من WP-016؛ `core/authz` بـ `can(key)` مصدره الخادم؛ SQLite v1 + إطار migrations؛ «صندوق المشاكل» للنزاعات؛ شاشة تشخيص منقّحة.
- **Scope Out:** أي عملية عمل حقيقية — تُختبر بعملية `noop` عبر نفس المسار.
- **Testing (أثقل مرحلة):** آلة حالة outbox بكل الانتقالات؛ الرد الضائع (الخادم نفّذ والعميل لم يستلم) → نتيجة واحدة؛ إعادة تشغيل التطبيق بطابور غير فارغ؛ انتهاء الـ lease أثناء العمل؛ ترقية SQLite v1→v2 ببيانات؛ ساعة الجهاز مُغيَّرة للخلف (clock evidence من WP-017)؛ الـ Anti-Gap Suite كاملة.
- **Acceptance:** سيناريو «طيران»: 50 مسودة بلا شبكة، إعادة تشغيل، عودة الشبكة → 50 نتيجة بالضبط. **مُثبت باختبار تكامل آلي، لا يدويًا.**
- **Skill:** `engineering:testing-strategy` ثم `engineering:code-review` ثم `security-review`.

---

### WP-M3 — استلام المشتريات

- **الفرع:** `feat/wp-m3-receiving`
- **البوابة:** WP-012 مغلقة (`PurchaseOrder lifecycle` و`GoodsReceipt/SupplierInvoice` منفصلان).
- **Scope In:** قائمة أوامر الشراء المفتوحة (مصفَّحة)؛ التفاصيل؛ مسح باركود → مطابقة سطر؛ إدخال يدوي عند فشل المسح؛ استلام جزئي؛ **مسودة محلية أثناء المسح، ترحيل أونلاين** (§4)؛ مرتجعات الموردين مقابل الفاتورة الأصلية بحدود `BOLD_FINAL_ROADMAP` P1 §4 (منع تجاوز المستلم، إلزام السبب، Audit).
- **Testing:** باركود غير معروف؛ كمية صفر/سالبة/تتجاوز المطلوب؛ أمر أُغلق من مستخدم آخر أثناء العمل؛ استلام نفس الأمر من جهازين؛ مسح مكرر؛ صلاحية ناقصة؛ فقد الشبكة عند الترحيل → المسودة محفوظة ورسالة واضحة؛ E2E كامل.
- **Acceptance:** استلام 20 بندًا → حركات مخزون وتكلفة مطابقة تمامًا لما يعرضه Admin Web.
- **Skill:** `design:ux-copy` (نصوص الأخطاء) + `engineering:code-review`.

---

### WP-M4 — التحويلات

- **الفرع:** `feat/wp-m4-transfers`
- **البوابة:** WP-013 مغلقة.
- **Scope In:** القائمة حسب الحالة؛ مسودة؛ اعتماد؛ شحن؛ استلام (كامل/جزئي)؛ تسجيل التالف والفاقد؛ إلغاء قبل الشحن؛ عرض «بالطريق» — بالضبط حسب آلة حالة WP-013 و`BOLD_FINAL_ROADMAP` P1 §5.
- **Testing:** استلام تحويل غير مشحون؛ شحن مشحون؛ مستلم > مشحون؛ تحويل لنفس الموقع؛ موقع خارج النطاق؛ الاستلام المكرر (يجب أن يمنعه WP-013 — يُختبر من العميل أيضًا)؛ E2E دورة كاملة عبر مستخدمَين وجهازين.
- **Acceptance:** دورة كاملة بفروق (تالف + فاقد + متبقٍ بالطريق) بين موقعين، والفروق مطابقة في تقرير المطابقة.
- **Skill:** `engineering:code-review`.

---

### WP-M5 — الجرد والتسويات

- **الفرع:** `feat/wp-m5-stock-count`
- **البوابة:** WP-009 مغلقة (`stock count/reconciliation states` موجودة).
- **Scope In:** بدء جلسة بنطاق (موقع/مخزن/تصنيف)؛ **العدّ بالمسح Offline بالكامل** (المسودة محلية — مسموح صراحةً)؛ عدّ أعمى (رهن قرار §5.4)؛ عرض الفروق؛ التقديم (`inventory.adjustment.request`)؛ الاعتماد (`.approve`) والترحيل (`.post`) **أونلاين حصرًا**؛ استئناف جلسة بعد إغلاق التطبيق.
- **ملاحظة:** مفاتيح `inventory.adjustment.*` موجودة في `permission-catalog.ts` وغير مستخدمة في أي controller اليوم — WP-009 هو من يربطها. لو أغلقت WP-009 بلا ربطها، هذه الـ WP **محجوبة**.
- **Testing:** استئناف بعد قتل التطبيق أثناء العدّ؛ عدّ نفس الصنف مرتين؛ صنف خارج النطاق؛ فرق صفري (لا حركة)؛ صنف مؤرشف أثناء الجرد؛ **محاولة اعتماد ذاتي (SoD) → رفض من الخادم**؛ ترحيل بلا اعتماد؛ ترحيل مزدوج؛ عدّ 500 صنف Offline ثم مزامنة؛ E2E عبر عادّ ومعتمِد.
- **Acceptance:** جرد 200 صنف Offline، إعادة تشغيل الجهاز، تقديم، اعتماد من مستخدم آخر، ترحيل → حركات `stock_count` مطابقة، وSoD لا تُخترق من الـ API مباشرة.
- **Skill:** `security-review` إلزامي — أخطر مرحلة ماليًا.

---

### WP-M6 — المنتجات والموردون وملصقات الباركود

- **الفرع:** `feat/wp-m6-catalog-suppliers`
- **البوابة:** WP-008 (مغلقة) + WP-012.
- **Scope In (أونلاين حصرًا):** بحث المنتجات؛ إنشاء منتج/متغير/مقاس/لون/باركود؛ تعديل؛ أرشفة؛ CRUD الموردين؛ **حذف حقول التكلفة من الـ payload** بلا `catalog.product.view-cost-sensitive`؛ طباعة ملصقات الباركود (رهن قرار §5.3).
- **Scope Out:** إدارة الأسعار وPrice Books — اختصاص Admin Web (WP-020).
- **Testing:** حقول إلزامية ناقصة؛ باركود مكرر؛ صلاحية ناقصة لكل عملية؛ تعديل متزامن؛ محاولة الحفظ بلا اتصال → رسالة واضحة **لا طابور صامت**؛ اختبار مستوى payload لغياب التكلفة.
- **Acceptance:** مستخدم بلا صلاحية التكلفة لا يراها حتى باعتراض حركة الشبكة.
- **Skill:** `engineering:code-review` + `security-review`.

---

### WP-M7 — التقوية والإصدار

- **الفرع:** `feat/wp-m7-hardening`
- **التزامن:** بمحاذاة WP-024 (Security Hardening) وWP-026 (Deployment and Recovery).
- **Scope In:** E2E كامل في CI على emulator؛ قياس الأداء (إقلاع بارد، مزامنة 10k صنف، 100 مسح متتالٍ)؛ مراجعة أمنية؛ certificate pinning؛ R8/ProGuard؛ فرض `min_supported_app_version`؛ AAB موقّع؛ runbook التثبيت والتحديث والإبطال؛ خطة الرجوع.
- **Acceptance:** كل بند في §8 و§10 مُثبت بدليل؛ Compliance Checklist مكتملة؛ نسخة موقّعة على جهاز حقيقي في المخزن تعمل يومًا كاملًا بلا فقد عملية.
- **بوابة إغلاق P1 من `BOLD_FINAL_ROADMAP`:** «كل إدخال مخزني ممكن من Warehouse App» و«إخفاء أزرار الإدخال من Admin Web بعد التكافؤ الوظيفي» — تُغلق هنا بالتنسيق مع WP-020.
- **Skill:** `security-review` + `engineering:deploy-checklist` + `operations:runbook`.

---

## 12. CI/CD

| Job | متى | يفشل عند |
|---|---|---|
| `mobile-quality` | كل PR | typecheck / lint (0 تحذيرات) / اختبارات / نقص التغطية |
| `mobile-build` | كل PR | فشل بناء APK أو تجاوز حد الحجم |
| `mobile-e2e` | PR على `mobile/**` + ليليًا | فشل أي مسار Maestro |
| `workspace` (قائم) | كل PR | انتهاك حدود التبعية أو دورة |
| `backend` (قائم) | كل PR | كما هو |
| `mobile-release` | يدوي | يبني AAB موقّعًا بقناة مستقلة عن POS |

---

## 13. Compliance Checklist

كل `WP-M` تُغلق بجدول يغطي `CLAUDE.md` §1–6، كل بند «تم — مع الدليل» أو «N/A — مع السبب»، بنفس معيار WP-008. بنود تحتاج انتباهًا خاصًا:

| بند | التطبيق هنا |
|---|---|
| 1.1 Zero-Trust | تحقق مزدوج: Zod على الاستجابة في العميل، وschema validation على الطلب في الخادم. العميل لا يُوثق به |
| 1.2 Auth/RBAC | كل مفتاح من `permission-catalog.ts`. ممنوع `@Roles`/`@RequireCapabilities` القديم في أي كود جديد |
| 1.3 الأسرار | Keystore حصرًا؛ لا تكلفة محليًا بلا صلاحية؛ تنقيح السجلات |
| 3.2 التصفيح | كل قائمة مصفَّحة — على شبكة ضعيفة هذا حرج لا تحسيني |
| 4.3 لا فشل صامت | كل عملية outbox مرفوضة **يجب** أن تظهر للمستخدم |
| 6.3 لا ادعاء نجاح | «بُني APK» لا تكفي — يجب تشغيله على emulator/جهاز بدليل |
| 6.4 كل مستهلك | أي تغيير في `packages/*` يُثبت على backend + admin-web + pos-electron + mobile بتثبيت نظيف |
| 6.6 Migrations | تنطبق على **قاعدتين**: Postgres، وSQLite على الجهاز. الثانية أخطر — الجهاز قد يتأخر عدة إصدارات |
| 6.7 التوثيق المتعمَّد | التعارض في §4 مرفوع لك ولم يُحسم من طرفي — بموجب هذا البند |

---

## 14. المخاطر

| الخطر | الأثر | التخفيف |
|---|---|---|
| بدء عميل الموبايل قبل استقرار WP-016/017 | إعادة كتابة كاملة لـ `core/sync` و`core/outbox` | بوابة صارمة على WP-M2؛ WP-M1 فقط هو المسموح بالتوازي |
| WP-009 يُغلق بلا ربط `inventory.adjustment.*` بأي controller | WP-M5 محجوبة وتُكتشف متأخرًا | مذكور صراحةً كشرط قبول في WP-M5، ويجب التحقق منه عند إغلاق WP-009 |
| حسم §4 لصالح الخيار (ب) بعد بدء الكود | إعادة تصميم WP-M2..M5 | القرار مطلوب في WP-M0 قبل أي سطر |
| توسّع النطاق إلى كل الأدوار | لا يُسلَّم شيء | مرهون بجواب §5.1 |
| تباعد إصدارات التطبيق في الميدان | ترقيات SQLite تنكسر | `min_supported_app_version` + اختبار ترقية إلزامي (M-7) |
| ازدواج التفويض القديم/الجديد أثناء Waves 4–5 | ثغرة صامتة | منع مطلق للنظام القديم في كود الموبايل، مفروض في مراجعة PR وCompliance |

---

**نهاية الوثيقة.** لا يبدأ كود قبل: (أ) حسم التعارض في §4، (ب) إجابات §5، (ج) اعتماد ADR-0007..0009 في WP-M0.
