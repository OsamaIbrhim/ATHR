# WP-T — Test and Foundation Hardening

**الحالة:** مسودة للمراجعة — كتبها الـ CLI بطلب صريح. اعتمدها أو عدّلها قبل التنفيذ.
**التاريخ:** 2026-08-10
**Depends on:** WP-008 Phase B مدموجة ومنشورة و health-verified.
**Blocks:** بدء العمل المتوازي على ثلاثة مسارات (Track A/B/C). WP-T1 تحديداً بوابة إلزامية.
**المرجع:** `docs/testing/test-fragility-analysis-2026-08-10.md` (البنود F1–F9). هذه الوثيقة تضيف البنود N1–N7 المكتشفة لاحقاً.

---

## 0. Mandatory Pre-Flight — كل جلسة، كل مرحلة

1. اقرأ `CLAUDE.md` كاملاً، وآخر مدخل في `docs/delivery/delivery-log.md`.
2. اقرأ `docs/testing/test-fragility-analysis-2026-08-10.md`.
3. تأكد أن WP-008 Phase B مدموجة ومنشورة و`GET /api/v1/health/ready` = `ok`.
4. تأكد أن `master` أخضر قبل التفريع. لا تبدأ فوق CI أحمر.
5. **لا تُعدَّل `prisma/schema.prisma` في أي مرحلة من WP-T.** أي بند يتطلب تعديل schema يُرفَع كاكتشاف ويُؤجَّل — لا يُنفَّذ هنا.

---

## 1. لماذا هذه الـ WP موجودة

المشكلة المُبلَّغ عنها: «كل ما نعمل حاجة جديدة الاختبارات بتضرب».

الفحص أثبت أن هذا ليس انطباعاً بل نتيجة حتمية لأربعة أسباب متراكبة:

| # | السبب | الأثر |
|---|---|---|
| 1 | **لا توجد طبقة lint في المستودع إطلاقاً** (N1) | استُخدمت اختبارات Jest كبديل عن الـ linter عبر قراءة النص المصدري → هشاشة بنيوية |
| 2 | **`strict` مُعطَّلة في backend و admin-web** (N2) | المُصرِّف لا يمسك أخطاء null/undefined → تتسرب لوقت التشغيل وتظهر كفشل اختبار غامض |
| 3 | **`fakePrisma` محرك استعلامات يدوي ناقص ومكسور جزئياً** (F4–F9) | إما انهيار مربك أو — الأسوأ — **نجاح كاذب** |
| 4 | **بذرة بيانات مكرَّرة في 25 ملفاً** (F8) | كل حقل إلزامي جديد = 25 تعديلاً يدوياً |

المشكلة الجذرية الحقيقية هي **(1) و(2)**: غياب الـ lint و الـ strict mode دفع الفريق لاستخدام الاختبارات كشبكة أمان لأشياء ليست وظيفتها. WP-T تعيد كل مسؤولية إلى طبقتها الصحيحة:

> الـ **compiler** يمسك الأنواع والـ null. الـ **linter** يمسك القواعد البنيوية والمعمارية. الـ **tests** تمسك السلوك. لا خلط.

---

## 2. الاكتشافات الجديدة (N1–N7)

### N1 — 🔴 حرجة: لا يوجد ESLint في المستودع

```
.eslintrc*        → غير موجود
eslint.config.*   → غير موجود
"lint" script     → غير موجود في أي package.json
lint job في CI    → غير موجود
```

**الأثر:** `CLAUDE.md §5` يفرض «Strict Type Safety»، «Self-Documenting Code»، و«Consistent Naming Conventions» (camelCase / PascalCase / UPPER_SNAKE_CASE / kebab-case) — **ولا شيء يفرض أياً منها آلياً**. الاعتماد كله على المراجعة البشرية.

وهذا هو السبب المباشر لـ F1/F2/F3: بلا linter، عبّر الفريق عن القواعد المعمارية (مثل «لا أحد يكتب على المخزون خارج السطح المُدقَّق») بالأداة الوحيدة المتاحة — وهي `toContain` على النص المصدري. الأداة خاطئة، والنية سليمة.

**فرق حاسم في التجربة:** قاعدة ESLint تفشل **في محرر المطور فوراً** برسالة تقول ماذا يفعل. اختبار `toContain` يفشل بعد عشر دقائق في CI برسالة `expected string to contain "sumMoney("`.

---

### N2 — 🔴 حرجة: `strict` مفعّلة في الأساس ومُعطَّلة في التطبيقات

`tsconfig.base.json` يعلن النية:

```json
{ "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true }
```

ثم تُلغيها التطبيقات:

| workspace | strict | strictNullChecks | noImplicitAny | noUncheckedIndexedAccess | exactOptional |
|---|---|---|---|---|---|
| `packages/*` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **`backend`** | ❌ **false** | ❌ false | ❌ false | ❌ | ❌ false |
| **`admin-web`** | ❌ **false** | ❌ | ❌ | ❌ false | ❌ false |
| `pos-electron` (src) | ✅ true | ✅ | ✅ | ❌ false | ❌ false |
| `pos-electron` (electron) | ✅ true | ✅ | ✅ | ❌ false | ❌ false |

**هذا يعني أن الـ backend — وهو كامل سطح العزل بين المستأجرين — يُصرَّف بلا فحص null.**

**مخالفة موثَّقة:** خطة التنفيذ، WP-002 البند 3: *«Establish strict TypeScript settings»* — والـ WP مُغلقة كـ `Closed / Passed`. القبول لم يتحقق فعلياً للـ backend و admin-web؛ تحقق لـ `packages/*` فقط. هذه ثغرة قابلة للإغلاق وتستحق تصحيحاً في سجل التسليم.

**حجم المشكلة — مقيس فعلياً** (شُغِّل `tsc` بـ `strict: true` على `backend/src`):

```
المجموع: 161 خطأ
```

| كود | العدد | الطبيعة | الجهد |
|---|---|---|---|
| `TS2564` property has no initializer | **99** | حقول DTO تحتاج `!` أو `?` | ميكانيكي بحت |
| `TS18046` implicit any (غالباً `catch (e)`) | 19 | معظمها في ملفات spec | ميكانيكي |
| `TS2307` cannot find module | 18 | مسارات في ملفات spec | ميكانيكي |
| **`TS2532`/`TS18048` possibly undefined** | **19** | **عيوب null حقيقية محتملة** | يحتاج تفكير |
| `TS2322`/`TS2345`/`TS2538`/`TS2769` | 6 | عدم تطابق أنواع حقيقي | يحتاج تفكير |

**العيوب الحقيقية المكتشفة في كود الإنتاج** (ليست ملفات اختبار):

```
src/transfers/transfers.service.ts:410   'remaining' is possibly undefined
src/transfers/transfers.service.ts:585   'row' is possibly undefined
src/transfers/transfers.service.ts:664   'owned' is possibly undefined
src/sync/sync.service.ts:86              Object is possibly undefined
src/auth/auth.service.ts:118             'undefined' cannot be used as an index type
src/common/api-error.filter.ts:116/197/205  FriendlyError type mismatch ×3
src/common/business-time.ts:25/26        overload mismatch + 'values.month' possibly undefined
src/sales/invoice-pdf.service.ts:54      'string | undefined' passed as 'string'
src/updates/pos-compatibility.ts:31      Object is possibly undefined ×2
```

**ثلاثة عشر موضعاً في كود إنتاجي حيّ** — بينها `transfers` و`sync` و`auth`. لا أدّعي أن كلاً منها ثغرة مستغَلّة، لكن كلاً منها مسار لم يتحقق منه المُصرِّف ولا الاختبارات.

**الخلاصة: 161 خطأ، ~136 منها ميكانيكي بحت. هذا شغل يوم إلى يومين، وليس مشروعاً.** لا مبرر لبقاء الوضع.

---

### N3 — 🟠 عالية: لا توجد بوابة تغطية في أي مكان

لا `coverageThreshold` في Jest، ولا `coverage.thresholds` في أي `vitest.config`، ولا `--coverage` في CI.

**الأثر على العمل المتوازي:** ثلاثة مطورين يضيفون كوداً بلا أي حد أدنى مفروض للاختبار. الانحدار سيكون تدريجياً وغير مرئي حتى يتأخر الوقت.

**ملاحظة مهمة:** لا أوصي بعتبة عالية عامة (تنتج اختبارات صورية لإرضاء الرقم). الصحيح هو **عتبة على الكود الجديد/المتغيّر فقط** في الـ PR، وأرضية منخفضة عامة تمنع الانحدار.

---

### N4 — 🟠 عالية: `electron/main.ts` — 2,249 سطراً بلا أي اختبار مباشر

```
pos-electron/electron/main.ts    2,249 سطر
اختبارات تستورد main.ts          صفر
```

الملفات السبعة المُختبَرة في `electron/` تغطي المساعِدات المستخرَجة (`api-base`, `money-codec`, `resource-path`, `local-state-migration`, `device-tenant-migration`, `money-column-migration`, `update-policy`) — لا `main.ts` نفسه.

**التصادم مع الخطة:** WP-018 تنص حرفياً: *«Behavior remains covered by tests through incremental extraction»*. هذا مستحيل — **لا يوجد سلوك مُغطّى أصلاً ليُحافَظ عليه**. Track C سيعيد هيكلة 2,249 سطراً تدير الـ IPC والمخزن المحلي وبيانات الاعتماد ومحرك المزامنة وطابور العمليات — **بلا شبكة أمان**.

**الإصلاح المقترح:** اختبارات توصيف (characterization tests) للسلوك القائم **قبل** أي استخراج. تُكتب لتوثيق السلوك الحالي كما هو (بما فيه ما قد يبدو خاطئاً)، ثم تعمل كشبكة أمان أثناء الاستخراج.

---

### N5 — 🟡 متوسطة: `admin-web` شبه غير مختبَر — و Track B داخل عليه

13 ملف اختبار، منها **صفحتان فقط** (`app/login`, `app/reports`) مقابل ~20 مساراً في `app/`. الباقي كله في `lib/` (منطق مساعد).

**الأثر:** Track B سيبني WP-019 (Admin Shell) ثم يعيد كتابة كل صفحة في WP-020، فوق قاعدة بلا تغطية. أي انحدار لن يظهر إلا في `admin-e2e-smoke` — وهو smoke لا يغطي المسارات.

---

### N6 — 🟢 منخفضة: ملفات اختبار Electron خارج نطاق الـ typecheck

`pos-electron/tsconfig.electron.json`:

```json
"exclude": ["electron/**/*.test.ts", "electron/**/*.spec.ts"]
```

ملفات الاختبار تعمل عبر vitest لكنها **لا تُصرَّف أبداً** في `npm run typecheck`. أخطاء الأنواع فيها لا تظهر حتى وقت التشغيل.

---

### N7 — 🟢 منخفضة: تباين إعداد vitest بين التطبيقات

`admin-web/vitest.config.ts` فيه `restoreMocks: true` و`clearMocks: true`.
`pos-electron` **لا يملك بلوك `test:` إطلاقاً** (يعتمد على الافتراضيات في `vite.config.ts`).

تسرّب حالة الـ mock داخل الملف الواحد مصدر معروف للـ flakiness. التوحيد رخيص.

---

## 3. المراحل

### الترتيب والمنطق

```
WP-008 Phase B  ✔ (مدموجة)
      ↓
WP-T1  ← بوابة إلزامية: بدونها العمل المتوازي يفشل
      ↓
      ├─ WP-008 Phase C/D  (Track A يكمل)
      └─ WP-T2 / WP-T3 / WP-T4  (بالتوازي — كلها schema-free)
```

**تحذير تسلسل حاسم:** WP-T2 (تفعيل `strict`) يلمس كل ملف DTO في الـ backend. **لا يجوز تنفيذها بالتوازي مع WP-008 Phase C/D**، لأن Phase C/D تضيف DTOs جديدة → تعارضات دمج ضخمة. إما WP-T2 قبل Phase C مباشرة، أو بعد Phase D. لا بينهما.

---

---

> ## ⚠️ تصحيح لاحق — 2026-08-21
>
> **ترقيم المراحل في هذه الوثيقة عُدّل بالتنفيذ.** ما نُفّذ فعلاً أولاً هو تصحيح الـharness (البند F4، وكان هنا داخل WP-T3)، وسُلّم تحت اسم **WP-T2** في الفرع والـPR وسجل التسليم. قرار أسامة (2026-08-21): **يُثبّت WP-T2 = أمانة الـharness (F4/F7c)**، وشغل `strict`+lint المذكور أدناه تحت WP-T2 **يُعاد ترقيمه ولا يزال غير منفّذ** — مخالفة WP-002 البند 3 لا تزال مفتوحة.
>
> **ثلاث مخالفات متعمّدة لما ورد أدناه، أسبابها في `docs/wp/WP-T2-raw-sql-harness-honesty.md`:**
>
> 1. **`registerRawStub()` رُفضت.** التسجيل وقت التشغيل يجعل الإسكات الصامت المستقبلي غير مرئي للمراجعة — وهو العطب نفسه. استُبدلت بقائمة سماح **ساكنة معلَنة** من خمسة مداخل.
> 2. **«تسعة ملفات إنتاجية» صار عشرة، 45 موقع استدعاء.** `promotions/coupon.repository.ts` أضافته WP-008 Phase D بعد كتابة هذه الوثيقة.
> 3. **F7c أُغلق داخل WP-T2 لا WP-T4.** ذاب في اتجاه «التوجيه إلى Postgres حقيقي». ثغرة متبقية: حارس F4 لا يغطي تفرّد مستوى الـORM — تُفحص WP-011 و WP-013 استدعاءً باستدعاء.
>
> **الفرضية الجوهرية أدناه صحّحها القياس:** قلب الافتراضي إلى الفشل الصاخب كسر 8 اختبارات فقط، لا «إخفاقات عبر تسعة ملفات». السبب أن ~15 موقعاً كان لها بدائل صامتة مكتوبة يدوياً داخل الـspecs. تدقيق كل override قائم هو العمل الحقيقي، ولم يكن في تصوّر هذه الوثيقة.

## WP-T1 — فك القفل عن العمل المتوازي

**الهدف:** إزالة كل ما يجعل مطوّراً يكسر شغل مطوّر آخر. **بوابة إلزامية قبل بدء Track B و Track C.**

**Branch:** `fix/wp-t1-parallel-unblock`

### Scope In

1. **F1 — تفكيك `money-contract.spec.ts` عبر حدود الـ workspaces.**

   | الجزء | الوجهة الجديدة |
   |---|---|
   | `reports.service.ts`, `sales.service.ts` | يبقى في `backend/src/common/money-contract.spec.ts` |
   | `electron/main.ts`, `src/utils.ts`, `src/screens/RegisterScreen.tsx` | `pos-electron/src/money-contract.test.ts` |
   | `admin-web/app/sales/[id]/page.tsx` | `admin-web/app/sales/money-contract.test.ts` |

2. **F1-guard — قاعدة في `scripts/check-workspace.mjs`:** يُرفَض أي ملف اختبار يقرأ مساراً يخرج عن حدود الـ workspace الخاص به. تُضاف حالة اختبار في `scripts/check-workspace.test.mjs`.

3. **F2 — `backend/src/inventory/audited-stock-writers.ts`:** allowlist معلنة صراحة يستوردها `inventory-ledger-contract.spec.ts` بدل قائمة الملفات الحرفية. الاختبار يبقى يمسح المصدر ويقارن بالـ allowlist — يظل يمسك الكاتب غير المصرَّح به، لكن إضافة كاتب شرعي تصبح سطراً واعياً مع مراجعة.

4. **F6 — `findFirstOrThrow` و`findUniqueOrThrow`** في `FakeTable`، برمي خطأ مطابق لسلوك Prisma.

5. **F5 — تصحيح `groupBy`:** `join(' ')` و`split(' ')` (فاصل لا يظهر في بيانات حقيقية) بدل `join('')`/`split('')`.

### Scope Out

- لا تفعيل لـ `strict` — WP-T2.
- لا ESLint — WP-T2.
- لا تعديل على سلوك أي خدمة إنتاجية.

### Testing Requirements

- المجموعة الكاملة خضراء قبل وبعد، **بنفس عدد الاختبارات** عدا الجديد الصريح.
- حالة اختبار جديدة في `check-workspace.test.mjs` تثبت رفض تجاوز حدود الـ workspace.
- اختبار وحدة لـ `groupBy` بحقلين يثبت صحة المفاتيح (بذرة لـ F9).
- تحقق يدوي موثَّق: تعديل تافه في `admin-web/app/sales/[id]/page.tsx` **لا** يُسقِط job الـ backend.

### Acceptance Criteria

- صفر ملفات اختبار تقرأ خارج حدود الـ workspace الخاص بها.
- `inventory-ledger-contract.spec.ts` لا يحتوي قائمة ملفات حرفية.
- `FakeTable` يغطي كل دالة Prisma تستخدمها الشيفرة الإنتاجية اليوم.
- كل بوابات CI خضراء.

### Stop Condition

PR واحد. يُدمَج ويُنشَر ويُتحقَّق من `/health/ready` **قبل** أي عمل متوازي.

---

## WP-T2 — طبقة المُصرِّف والـ Lint

**الهدف:** إعادة القواعد إلى طبقتها الصحيحة، وإغلاق مخالفة WP-002 البند 3.
**⚠️ لا يُنفَّذ بالتوازي مع WP-008 Phase C/D.**

**Branch:** `fix/wp-t2-strict-and-lint`

### Scope In

1. **تفعيل `strict` في `backend/tsconfig.json`** — حذف كل من `strict: false`, `strictNullChecks: false`, `noImplicitAny: false`, `strictBindCallApply: false`, `noImplicitOverride: false`, `exactOptionalPropertyTypes: false`, `forceConsistentCasingInFileNames: false` والاعتماد على `tsconfig.base.json`.

   - **إصلاح 161 خطأ.** الـ 99 خطأ `TS2564` ميكانيكية.
   - **الـ 13 عيباً الحقيقية (§N2) تُصلَح بوعي، كل واحد بفهم سببه** — لا `!` ولا `as any` لإسكات المُصرِّف. أي موضع لا يُفهَم يُرفَع بدل أن يُخمَّن، طبقاً لـ `CLAUDE.md §6` (Root-cause before patching).
   - `noUncheckedIndexedAccess` و`exactOptionalPropertyTypes` قد تُبقَيان معطَّلتين مؤقتاً **بقرار موثَّق ونطاق زمني**، لكن `strict` و`strictNullChecks` و`noImplicitAny` **لا تفاوض عليها**.

2. **تفعيل `strict` في `admin-web/tsconfig.json`** — نفس المنهج. يُقاس حجمه أولاً بنفس الطريقة قبل الالتزام؛ إن تجاوز ~200 خطأ يُفصَل إلى PR مستقل.

3. **إدخال ESLint** (`eslint.config.mjs` مسطح على الجذر + امتدادات لكل workspace):
   - `@typescript-eslint` مع type-aware rules.
   - `eslint-plugin-import` / `eslint-plugin-boundaries` لفرض `CLAUDE.md §2` واتجاه الاعتماديات — نفس ما يخطط له `docs/mobile` §7 لاحقاً.
   - قواعد التسمية (`@typescript-eslint/naming-convention`) طبقاً لـ `CLAUDE.md §5`.
   - منع `any` صريحة، ومنع `catch` صامت (`CLAUDE.md §4` — No Silent Failures).
   - `npm run lint` في كل workspace + job `lint` في CI + إضافته إلى `needs` في `release-gate`.

4. **ترحيل F3:** تحويل شروط `money-contract` و`purchasing-accounting-contract` و`transfer-state-contract` من `toContain` على النص إلى قواعد ESLint حيثما أمكن. **تبقى** الاختبارات النصية على `.sql` و`.yml` كما هي (`migration-policy`, `migration-ci-contract`) — مشروعة ولا تُمَس.

5. **N6:** رفع استثناء ملفات الاختبار من `tsconfig.electron.json` (أو `tsconfig` مخصص للاختبارات) بحيث تُصرَّف.

6. **N7:** توحيد إعداد vitest — إضافة بلوك `test` بـ `restoreMocks`/`clearMocks` لـ `pos-electron`.

### Testing Requirements

- `npm run typecheck` أخضر في كل workspace بلا أي تعطيل للقواعد.
- `npm run lint` أخضر، صفر تحذيرات مسموحة (`--max-warnings=0`).
- المجموعة الكاملة خضراء.
- **بند صريح:** كل موضع من الـ 13 عيباً في §N2 يُذكَر في وصف الـ PR: ما كان، لماذا حدث، وكيف أُصلِح. لا إسكات صامت.

### Acceptance Criteria

- لا `strict: false` ولا `noImplicitAny: false` في أي `tsconfig` في المستودع.
- job `lint` ضمن `needs` في `release-gate`.
- الادعاء المنصوص في خطة التنفيذ WP-002 البند 3 صار صحيحاً فعلياً — مع تصحيح في سجل التسليم.

---

## WP-T3 — تصحيح الـ Test Harness

**الهدف:** إنهاء النجاح الكاذب. **schema-free — صالحة لمسار متوازٍ.**

**Branch:** `fix/wp-t3-harness-integrity`

### Scope In

1. **F4 — SQL الخام يفشل بصوت عالٍ.** `$queryRaw`/`$executeRaw` ترمي افتراضياً برسالة صريحة تشرح البديل. تُضاف آلية `registerRawStub()` للمواضع التي يكفيها stub معلَن.

   > **متوقَّع: ستظهر إخفاقات فور التنفيذ عبر تسعة ملفات إنتاجية.** هذا هو المقصود. كل موضع يُعالَج إما بـ stub معلَن أو بـ integration test على قاعدة حقيقية. **أي مسار SQL خام يمسّ بيانات tenant يجب أن يُغطّى باختبار حقيقي، لا بـ stub** — سجل WP-007 يوثّق ثغرة عبر-tenant وُجدت في SQL خام بـ `inventory`، وهي الفئة العمياء تماماً هنا.

2. **F9 — `cross-tenant-harness.spec.ts`:** تغطية كل عامل (`in`, `notIn`, `contains`, `gt/gte/lt/lte`, `not`, `equals`)، العلاقات المتداخلة، `groupBy` بحقلين، `aggregate` بكل مُجمِّعاته. 310 سطراً يعتمد عليها 25 ملفاً لا يجوز أن تبقى بلا اختبار.

3. **F7 — سدّ فجوات الـ fake:** `include`/`select` في `findMany`/`findFirst`؛ الكتابة المتداخلة في `create`؛ `aggregate._count` لكل حقل و`_avg`؛ `$transaction` برجوع فعلي عند الفشل.

4. **F7e — الأرقام العشرية:** توحيد صفوف الاختبار على `Prisma.Decimal` بدل `number`، اتساقاً مع عقد الدقة المالية.

5. **F8 — builders للكيانات** في `identity/testing/`: `aProduct()`, `aProductVariant()`, `aSale()` … بقيم افتراضية معقولة. ترحيل الـ 25 ملفاً إليها.

### Scope Out

- **فرض قيود الـ unique — يُؤجَّل إلى WP-T4** (قد يتطلب قراراً معمارياً).

### Acceptance Criteria

- صفر مسارات تُرجع نجاحاً صامتاً على شيفرة غير منفَّذة في الـ fake.
- `cross-tenant-harness.ts` مغطّى باختباراته الخاصة.
- إضافة حقل إلزامي جديد في الـ schema = تعديل ملف builders واحد.

---

## WP-T4 — شبكات الأمان قبل الموجات القادمة

**الهدف:** بناء التغطية الغائبة **قبل** أن تحتاجها WPs بعينها. **schema-free.**

**Branch:** `fix/wp-t4-safety-nets`

### Scope In

1. **N4 — اختبارات توصيف لـ `electron/main.ts`** — بوابة إلزامية قبل WP-018. تُوثّق السلوك القائم كما هو. الأولوية: طابور العمليات، المخزن المحلي، حدود الـ IPC، جلسة المصادقة.

2. **F7c — منع التكرار.** فرض قيود الـ unique في الـ fake، **أو** — إن تعذَّر بنظافة — integration tests على قاعدة بيانات حقيقية.

   > **بوابة صارمة: لا تُغلَق WP-011 (منع الاسترداد المكرر) ولا WP-013 (منع الاستلام المكرر) قبل توفر أحد الخيارين.** كلاهما بند قبول صريح في خطة التنفيذ ولا يمكن إثباته بالـ harness الحالي.

3. **N3 — بوابة تغطية:**
   - أرضية عامة منخفضة تمنع الانحدار (تُضبط على الرقم الحالي المقيس، لا على رقم طموح).
   - **عتبة أعلى على الكود الجديد/المتغيّر في الـ PR** — هذه هي البوابة الحقيقية.
   - `--coverage` في CI مع نشر التقرير كـ artifact.

4. **N5 — أرضية اختبار لـ `admin-web`** — بوابة قبل WP-020: اختبار مسار واحد على الأقل لكل صفحة قائمة قبل إعادة كتابتها، وإلا فإعادة الكتابة بلا مرجع.

### Acceptance Criteria

- `electron/main.ts` له تغطية توصيف موثَّقة على المسارات الحرجة الأربعة.
- منع التكرار مُثبَت باختبار حقيقي.
- بوابة التغطية فعّالة في CI وضمن `needs` في `release-gate`.

---

## 4. التعديلات المطلوبة على `CLAUDE.md`

### إضافة إلى §0.7 (Never claim success without evidence)

> **الاختبار الأخضر ليس دليلاً إن كان المسار مُستبدَلاً بـ stub.** أي fake أو mock يستبدل حدوداً حقيقية (SQL خام، معاملة قاعدة بيانات، قيد unique) يجب أن **يفشل بصوت عالٍ** عند استدعاء مسار لا يدعمه — لا أن يُرجع قيمة فارغة. النجاح الصامت على مسار غير مُنفَّذ **دليل زائف**، وهو أخطر من الفشل.

### إضافة إلى §2 (Modular Independence)

> ملف الاختبار لا يقرأ ملفات خارج حدود الـ workspace الخاص به. اعتماديات التطبيقات على بعضها ممنوعة في وقت التشغيل ووقت الاختبار على السواء، ويُفرَض ذلك بأداة لا بالمراجعة.

### إضافة إلى §5 (Code Quality)

> كل قاعدة تُفرَض في طبقتها الصحيحة: **المُصرِّف** للأنواع والـ null، **الـ linter** للقواعد البنيوية والمعمارية، **الاختبارات** للسلوك. التأكيد على النص المصدري (`toContain` على ملف `.ts`) ممنوع — إن لم تستطع قاعدة lint التعبير عنه، فالشرط على الأرجح سلوكي ويُختبَر سلوكياً. الاستثناء الوحيد: الملفات غير القابلة للتنفيذ (`.sql`, `.yml`, `Dockerfile`).

---

## 5. Compliance Checklist (طبقاً لمعيار WP-008 فما بعد)

| بند `CLAUDE.md` | الحالة في WP-T | الدليل / السبب |
|---|---|---|
| §1 Zero-Trust Input Validation | **N/A** | لا مسارات إدخال جديدة. لكن تفعيل `strict` يقوّي DTOs قائمة. |
| §1 Strict Auth & RBAC | **N/A** | لا تغيير على التفويض. `auth.service.ts:118` يُصلَح كعيب أنواع فقط. |
| §1 Secret Isolation | **N/A** | لا أسرار في النطاق. |
| §1 Injection Prevention | **يُعالَج** | WP-T3/F4 يكشف تسعة مسارات SQL خام كانت غير مُختبَرة. |
| §2 SOLID / Clean Architecture | **يُعالَج** | WP-T2 يضيف `eslint-plugin-boundaries` لفرض الحدود بأداة. |
| §2 Modular Independence | **يُعالَج** | WP-T1/F1 يزيل تجاوز الحدود؛ حارس في `check-workspace.mjs`. |
| §3 Performance | **N/A** | لا تغيير على الاستعلامات الإنتاجية. |
| §4 No Silent Failures | **يُعالَج** | WP-T3/F4 (SQL الصامت) + قاعدة lint لمنع `catch` الصامت. |
| §4 Edge Case Coverage | **يُعالَج** | WP-T2 يكشف 19 موضع `possibly undefined`. |
| §5 Strict Type Safety | **يُعالَج** | WP-T2 — إغلاق مخالفة WP-002 البند 3. |
| §5 Naming Conventions | **يُعالَج** | WP-T2 — `@typescript-eslint/naming-convention`. |
| §6 Stable deployable state | **مطلوب** | كل مرحلة PR واحد، CI أخضر بالكامل، نشر وتحقق صحة. |
| §6 Branch discipline | **مطلوب** | فرع لكل مرحلة من `master`. لا خلط. |
| §6 Never claim success without evidence | **مطلوب** | لا تُعلَن مرحلة ناجحة إلا بمخرجات مُلاحَظة. |
| §6 Prove across every consumer | **مطلوب** | `npm ci` نظيف + بناء الثلاثة + بناء Docker وتشغيله. |
| §6 Root-cause before patching | **مطلوب** | الـ 13 عيباً في §N2 تُصلَح بفهم لا بإسكات. |
| §6 Migrations forward-only | **N/A** | **WP-T لا تعدّل الـ schema إطلاقاً في أي مرحلة.** |
| §6 Fail loud on ambiguous data | **N/A** | لا ترحيل بيانات. |

---

## 6. ما لم يُنفَّذ ويحتاج قرارك

1. **اعتماد هذه الوثيقة** — كُتبت بطلب صريح؛ عادةً تؤلّف وثائق التخطيط بنفسك.
2. **حدود `admin-web`:** هل تُفعَّل `strict` عليه في WP-T2 أم يُفصَل؟ يُقاس أولاً كما قِيس الـ backend.
3. **`noUncheckedIndexedAccess` و`exactOptionalPropertyTypes`:** تُفعَّلان الآن أم تُؤجَّلان بقرار موثَّق؟
4. **أرقام بوابة التغطية** (N3) — تُضبط بعد قياس الوضع الحالي.
5. **تصحيح سجل التسليم** بخصوص ادعاء WP-002 البند 3.

---

## 7. تحفّظ منهجي

كل ما ورد هنا **مستنتَج من قراءة الكود**، عدا قياس `strict` في §N2 الذي **شُغِّل فعلياً** (`tsc` على `backend/src`، 161 خطأ، التوزيع مُلاحَظ). لم تُشغَّل مجموعة الاختبارات (لا قاعدة بيانات ولا Docker في بيئة الفحص). طبقاً لـ `CLAUDE.md §6`، كل ما عدا قياس `strict` يُعامَل **غير مُتحقَّق منه بالتشغيل** حتى يُشغَّل.
