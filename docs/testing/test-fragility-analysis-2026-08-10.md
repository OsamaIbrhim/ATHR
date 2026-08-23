# تحليل هشاشة الاختبارات — لماذا تنكسر الاختبارات مع كل تغيير

**التاريخ:** 2026-08-10
**الحالة:** نتائج فحص — تحتاج قرارك واعتمادك
**السياق:** WP-008 Phase A مدموج (`38c102e`). هذا الملف يوثّق ما وجدته عند فحص بنية الاختبارات قبل تقسيم العمل على ثلاثة مسارات متوازية.
**الأثر على التوازي:** بندان من هذا الملف (F1، F2) يجعلان العمل المتوازي مستحيلاً عملياً حتى تُعالَج. البقية تُبطئه فقط.

> هذا الملف **نتائج فحص وليس قراراً**. أي تعديل فعلي على الاختبارات ينتظر مراجعتك بعد إغلاق WP-008.

---

## 0. الخلاصة في سطرين

انكسار الاختبارات المتكرر ليس عشوائياً وليس "سوء حظ". له **سببان جذريان محددان**:

1. **اختبارات تؤكّد على النص الحرفي للكود المصدري** (`readFileSync` + `toContain` / `toEqual` على قوائم ملفات دقيقة) — تنكسر عند أي refactor أو إعادة تسمية أو إضافة مستهلك جديد شرعي، حتى والسلوك سليم 100%.
2. **`fakePrisma` هو إعادة تنفيذ يدوية لمحرك استعلامات Prisma** — وكل ميزة لا يدعمها إما تُسقِط الاختبار فوراً أو، وهو الأسوأ، **تجعله ينجح كذباً**.

والأخطر: بعض هذه الاختبارات **تنجح بينما الكود مكسور** — وهذه أخطر من الاختبارات التي تنكسر.

---

## 1. الاختبارات الهشّة بحكم التصميم — Source-Text Contract Tests

### F1 — 🔴 حرجة: اختبار في `backend` يقرأ ملفات `admin-web` و`pos-electron`

**الملف:** `backend/src/common/money-contract.spec.ts`

```
backend/src/common/money-contract.spec.ts:30  → ../pos-electron/electron/main.ts
backend/src/common/money-contract.spec.ts:31  → ../pos-electron/src/utils.ts
backend/src/common/money-contract.spec.ts:32  → ../pos-electron/src/screens/RegisterScreen.tsx
backend/src/common/money-contract.spec.ts:44  → ../admin-web/app/sales/[id]/page.tsx
```

**ما يحدث:** أي تعديل على صفحة `admin-web/app/sales/[id]/page.tsx` أو على شاشة الكاشير في POS **يُسقِط job الـ backend في CI**.

**لماذا هذا قاتل للعمل المتوازي:** زميلك في Track B (Admin) سيعدّل هذه الصفحة بالضبط في WP-020. سيرى job الـ backend أحمر، ولن يفهم لماذا — لأنه لم يلمس أي سطر backend. هذا يكسر أيضاً **CLAUDE.md §2 (Modular Independence)** و**قاعدة الاتجاه الصريح للاعتماديات**: `check-workspace.mjs` يمنع اعتماد تطبيق على تطبيق آخر في `package.json` — لكن هذا الاختبار يتجاوز الحارس تماماً عبر قراءة الملفات بالمسار النسبي.

**الإصلاح المقترح (يحتاج اعتمادك):** تقسيم الاختبار إلى ثلاثة، كلٌّ في تطبيقه:

| الجزء | ينتقل إلى |
|---|---|
| `reports.service.ts` + `sales.service.ts` | يبقى في `backend/src/common/money-contract.spec.ts` |
| POS (`main.ts`, `utils.ts`, `RegisterScreen.tsx`) | `pos-electron/src/money-contract.test.ts` |
| Admin (`app/sales/[id]/page.tsx`) | `admin-web/app/sales/money-contract.test.ts` |

وإضافة قاعدة في `scripts/check-workspace.mjs` تمنع أي ملف اختبار من قراءة `../` خارج حدود الـ workspace الخاص به — حتى لا تتكرر المشكلة.

---

### F2 — 🔴 حرجة: قائمة ملفات دقيقة ستنكسر في كل WP قادمة

**الملف:** `backend/src/inventory/inventory-ledger-contract.spec.ts:25`

```ts
expect(writers).toEqual([
  'purchasing/purchasing.service.ts',
  'sales/sales.service.ts',
  'transfers/transfers.service.ts',
]);
```

الاختبار يمسح كل ملفات `src` بحثاً عن أي كاتب على `InventoryStock`، ويؤكد أن القائمة تساوي هذه الثلاثة **بالضبط**.

**لماذا سينكسر حتماً:**

| WP | ماذا ستضيف | النتيجة |
|---|---|---|
| WP-009 | `Add reservations and availability` + `stock count/reconciliation states` | كاتب جديد على `InventoryStock` |
| WP-010 | `Sale aggregate` يستبدل `SalesInvoice-as-command` | تغيير اسم/موقع الكاتب |
| WP-011 | فصل Return posting عن Refund | كاتب جديد |
| WP-013 | in-transit ledger + partial receipt | كاتب جديد |

يعني **أربع WPs متتالية، كل واحدة تكسر هذا الاختبار** — والفشل في كل مرة سيبدو "الاختبارات ضربت تاني" بينما هو في الحقيقة يعمل كما صُمِّم.

**النية سليمة والتنفيذ خاطئ.** المطلوب هو: "لا أحد يكتب على المخزون خارج السطح المُدقَّق". القائمة الحرفية طريقة سيئة للتعبير عن ذلك.

**الإصلاح المقترح:** استبدال قائمة الملفات بـ **allowlist معلنة صراحة** في ملف واحد (`inventory/audited-stock-writers.ts`) يستوردها الاختبار. عندها إضافة كاتب جديد شرعي تصبح **تعديلاً واعياً مقصوداً في سطر واحد** مع مراجعة، بدل أن تكون فشلاً مفاجئاً في CI. وتُضاف ملاحظة في كل من WP-009/010/011/013: «تحديث `audited-stock-writers.ts` جزء من نطاق هذه الـ WP».

---

### F3 — 🟡 متوسطة: باقي اختبارات النص المصدري

أحد عشر ملفاً يقرأ الكود المصدري كنص:

```
common/money-contract.spec.ts                     ← F1
config/athr-identity-contract.spec.ts
config/development-seed-contract.spec.ts
config/environment.spec.ts
inventory/inventory-ledger-contract.spec.ts       ← F2
prisma/migration-ci-contract.spec.ts
prisma/migration-policy.spec.ts
purchasing/purchasing-accounting-contract.spec.ts
transfers/transfer-perf-contract.spec.ts
transfers/transfer-state-contract.spec.ts
updates/updates.cross-tenant.spec.ts
```

منها ما هو **مشروع تماماً** ويجب أن يبقى: `migration-policy.spec.ts` و`migration-ci-contract.spec.ts` يقرآن ملفات `.sql` وملفات CI — وهذه ملفات لا يمكن اختبارها إلا كنص. لا تغيير مطلوب.

المشكلة في التي تؤكّد على نص ملفات `.ts` (`money-contract`, `purchasing-accounting-contract`, `transfer-state-contract`). القاعدة المقترحة:

> **اختبار النص المصدري مسموح فقط للملفات غير القابلة للتنفيذ** (`.sql`, `.yml`, `.json`, `Dockerfile`). أي شرط على كود TypeScript يُثبَت سلوكياً أو عبر قاعدة ESLint، لا بـ `toContain` على النص.

سبب ذلك: قاعدة ESLint تفشل **في محرر المطور فوراً** برسالة مفهومة، بينما `toContain` تفشل بعد عشر دقائق في CI برسالة مثل `expected string to contain "sumMoney("` لا تقول للمطور ماذا يفعل.

---

## 2. `fakePrisma` — المصدر الثاني، والأخطر

**الملف:** `backend/src/identity/testing/cross-tenant-harness.ts` (310 سطراً)
**المستخدمون:** 25 ملف اختبار (كل `*.cross-tenant.spec.ts` وأكثر)

الفكرة ممتازة: بدل تأكيد أن الـ repository "يذكر" `tenant_id`، الـ harness **ينفّذ فعلياً** شرط الـ `where` — فالـ repository الذي ينسى شرط الـ tenant يُرجع صف Tenant B ويفشل الاختبار بحق. هذا إثبات حقيقي لـ Blueprint §120، لا ادّعاء. أحسنت.

**لكن:** بنينا محرك استعلامات Prisma بأيدينا. وهذه أخطاؤه المحددة:

### F4 — 🔴 حرجة: `$queryRaw` و`$executeRaw` تُرجع فراغاً بصمت

`cross-tenant-harness.ts:299-300`

```ts
$queryRaw: async () => [],
$executeRaw: async () => 0,
```

**تسعة ملفات إنتاجية تستخدم SQL خام:**

```
inventory/inventory.repository.ts
offers/offers.service.ts
products/products.repository.ts
purchasing/purchasing.service.ts
sales/sales.service.ts
shifts/shifts.service.ts
transfers/transfers.service.ts
health/health.controller.ts
prisma/prisma.service.ts
```

**النتيجة:** كل مسار SQL خام في هذه الملفات **غير مختبَر إطلاقاً** في اختبارات الـ cross-tenant — ومع ذلك الاختبار **أخضر**.

وهذا يمسّ الأمن مباشرة: سِجل التسليم الخاص بـ WP-007 يذكر بالنص إصلاح ثغرة عبر-tenant في `inventory` كانت في **SQL خام** يقارن مخزون tenant بسجل كل الـ tenants. تلك الفئة من الثغرات بالتحديد هي ما لا يستطيع هذا الـ harness رؤيته. الاختبار الأخضر هنا **لا يعني شيئاً** لهذه المسارات.

**الإصلاح المقترح:** جعل `$queryRaw`/`$executeRaw` **ترمي استثناءً افتراضياً** برسالة صريحة:

```
fakePrisma: $queryRaw called but no stub registered.
Raw SQL cannot be verified by the in-memory fake — either register an
explicit stub for this call site, or cover this path with a real-database
integration test.
```

هذا يحوّل تسعة أخضر كاذب إلى تسعة فشل صادق — وهو ما نريده بالضبط. **ملاحظة: تنفيذ هذا سيُظهر إخفاقات فوراً. هذا هو المقصود، وليس ارتداداً.** وأي مسار SQL خام يمسّ بيانات tenant يجب أن يُغطّى بـ integration test على قاعدة بيانات حقيقية، لا بالـ fake.

---

### F5 — 🔴 حرجة: `groupBy` مكسور — يُنتج بيانات مغلوطة بصمت

`cross-tenant-harness.ts` (نهاية `FakeTable`)

```ts
const key = by.map((field: string) => row[field]).join('');   // ← يدمج بلا فاصل
...
grouped[field] = key.split('')[index];                        // ← يقسّم حرفاً حرفاً
```

`join('')` ثم `split('')` عمليتان **غير متعاكستين**. المفتاح يُدمج بلا فاصل ثم يُقسَّم إلى حروف مفردة.

**مثال:** `groupBy({ by: ['tenant_id', 'product_id'] })` مع UUIDs → المفتاح سلسلة من 72 حرفاً → `split('')` يعطي 72 عنصراً → `grouped.tenant_id` يساوي **حرفاً واحداً**، و`grouped.product_id` حرفاً واحداً آخر. والأسوأ: تجميع صفوف من tenants مختلفة قد ينتج نفس المفتاح.

**المستخدمون:** `purchasing/purchasing.service.ts`, `sales/sales-read.service.ts`

**كان المقصود على الأرجح:** `join(' ')` و`key.split(' ')`.

**الإصلاح المقترح:** تصحيح الفاصل، وإضافة اختبار وحدة **للـ harness نفسه** يثبت أن `groupBy` بحقلين يعطي المفاتيح الصحيحة. (انظر F9.)

---

### F6 — 🟠 عالية: `findFirstOrThrow` و`findUniqueOrThrow` غير منفَّذتين

الـ `FakeTable` ينفّذ: `findFirst`, `findUnique`, `findMany`, `count`, `create`, `createMany`, `upsert`, `update`, `updateMany`, `delete`, `deleteMany`, `aggregate`, `groupBy`.

**غير موجودتين:** `findFirstOrThrow`, `findUniqueOrThrow`.

**خمسة مواضع إنتاجية تستخدمهما:**

```
purchasing/purchasing.service.ts   ×4
transfers/transfers.service.ts     ×1
```

أي اختبار يلمس هذه المسارات ينهار بـ `TypeError: ...findFirstOrThrow is not a function` — وهو خطأ مُربِك لا يشير للسبب الحقيقي. هذا مرشّح قوي لتفسير جزء من "الاختبارات ضربت فجأة".

**الإصلاح المقترح:** إضافة الدالتين مع رمي `NotFoundError` مطابق لسلوك Prisma.

---

### F7 — 🟠 عالية: فجوات صامتة أخرى في الـ fake

| # | الفجوة | الأثر |
|---|---|---|
| a | `findMany`/`findFirst` لا تدعمان `include` أو `select` (فقط `upsert` تعمل hydrate) | العلاقات المتداخلة تُرجع `undefined` — يبدو كخطأ في كود الإنتاج وهو ليس كذلك |
| b | `create` لا يدعم الكتابة المتداخلة (`data: { items: { create: [...] } }`) | الكائن المتداخل يُخزَّن كحقل حرفي؛ الصفوف الأبناء لا تُنشَأ أبداً |
| c | لا يوجد فرض لقيود الـ unique | منطق منع التكرار (فواتير مكررة، استلام مكرر في WP-013) **غير قابل للاختبار** بهذا الـ harness |
| d | `aggregate._count` يُرجع عدد الصفوف بغضّ النظر عن الحقول المطلوبة؛ `_avg` غير منفَّذة | تجميعات مالية خاطئة بصمت |
| e | صفوف الاختبار تستخدم `number` (`cost_price: 10`) بينما الإنتاج يستخدم `Prisma.Decimal` | الـ harness يُغذّي floats بينما `money-contract.spec.ts` يمنع حساب floats في الإنتاج — تناقض مباشر |
| f | `$transaction` لا يدعم الـ rollback (`arg(prisma)` على نفس الكائن) | فشل جزئي داخل معاملة يترك بيانات مُعدَّلة — عكس سلوك قاعدة البيانات |

البند (c) يستحق انتباهاً خاصاً: **WP-013 بند صريح فيها "duplicate-receipt protection"، و WP-011 "prevent over-return and duplicate refund"**. لا يمكن إثبات أيٍّ منهما بهذا الـ harness. لا بد من integration test على قاعدة بيانات حقيقية لهذين البندين.

---

### F8 — 🟡 متوسطة: بيانات البذرة مكرَّرة في 25 ملفاً

كل `*.cross-tenant.spec.ts` يبني صفوفه يدوياً:

```ts
fakePrisma({
  product: [{ id, tenant_id, name_en, is_active }, ...],
  productVariant: [{ id, tenant_id, product_id, sku, cost_price, item_type, ... }],
  ...
})
```

أي حقل **إلزامي جديد** في `schema.prisma` — وسيأتي الكثير منها في WP-009/010/011/012/013 — يتطلب تعديل عشرات الملفات يدوياً. وإن نسيت واحداً، الحقل يكون `undefined` وينكسر الاختبار برسالة لا صلة لها بالسبب.

**هذا بالضبط ما يجعل الشعور بأن "كل تغيير يكسر الاختبارات" شعوراً صحيحاً.**

**الإصلاح المقترح:** builders لكل كيان في `identity/testing/` مع قيم افتراضية معقولة:

```ts
const variant = aProductVariant({ tenant_id: TENANT_A });  // الباقي افتراضي
```

عندها إضافة حقل إلزامي = تعديل ملف واحد.

---

### F9 — 🟡 متوسطة: لا يوجد اختبار للـ harness نفسه

310 سطراً من منطق مطابقة الاستعلامات تعتمد عليها 25 ملف اختبار — **بلا اختبار واحد يغطيها**. لهذا مرّ خطأ `groupBy` (F5) دون أن يلاحظه أحد.

**الإصلاح المقترح:** `cross-tenant-harness.spec.ts` يغطي كل عامل (`in`, `notIn`, `contains`, `gt/gte/lt/lte`, `not`)، والعلاقات المتداخلة، و`groupBy` بحقلين، و`aggregate`.

---

## 3. لماذا الشعور بأن "الاختبارات تضرب كل مرة" — التلخيص

| السبب | الفئة | النتيجة عند تغيير الكود |
|---|---|---|
| اختبارات نص مصدري بقوائم ملفات دقيقة | F1, F2, F3 | فشل **مؤكَّد** مع كل WP تضيف مستهلكاً شرعياً |
| اختبار backend يقرأ ملفات admin/pos | F1 | مطوّر يكسر job فريق آخر بلا سبب مفهوم |
| بذرة بيانات مكرَّرة في 25 ملفاً | F8 | كل حقل إلزامي جديد = 25 تعديلاً يدوياً |
| fake ناقص (`findFirstOrThrow`, `include`, nested writes) | F6, F7 | انهيار مربك لا يشير للسبب |
| fake مكسور بصمت (`groupBy`, raw SQL, unique) | F4, F5, F7c | **أسوأ من الفشل — نجاح كاذب** |

الفئتان الأخيرتان معاً تفسّران النمط بالكامل: تغيير سليم في الكود يصطدم بحدود الـ fake، فيفشل الاختبار لسبب لا علاقة له بالسلوك — فيبدو الأمر عشوائياً.

---

## 4. ترتيب التنفيذ المقترح (بعد إغلاق WP-008)

**WP-T1 — قبل بدء أي عمل متوازي** (نصف يوم تقريباً، بلا تعديل schema):
- F1: تقسيم `money-contract.spec.ts` على الثلاثة تطبيقات + قاعدة في `check-workspace.mjs` تمنع تجاوز حدود الـ workspace في الاختبارات.
- F2: `audited-stock-writers.ts` كـ allowlist معلنة.
- F6: إضافة `findFirstOrThrow` / `findUniqueOrThrow`.
- F5: تصحيح فاصل `groupBy`.

بعد هذه الأربعة **فقط** يصبح العمل الموازي آمناً: لن يكسر Track B الـ backend، ولن تكسر WP-009 اختبار المخزون.

**WP-T2 — بالتوازي مع WP-009** (بلا تعديل schema، مناسب لمسار منفصل):
- F9: اختبار الـ harness.
- F4: جعل SQL الخام يرمي بدل الفراغ الصامت + integration tests للمسارات المكشوفة.
- F8: builders للكيانات.

**WP-T3 — قبل WP-011 و WP-013 مباشرة** (بوابة صارمة):
- F7c: فرض قيود الـ unique — أو، إن تعذّر، integration tests على قاعدة حقيقية لبنود «duplicate-receipt protection» و«duplicate refund». **لا تُغلَق WP-011 أو WP-013 دون أحد الخيارين.**
- F7a/b/d/e/f: باقي فجوات الـ fake.

---

## 5. القاعدة التي أوصي بإضافتها إلى `CLAUDE.md`

بعد §0.7 («Never claim success without evidence»):

> **الاختبار الأخضر ليس دليلاً إن كان المسار مُستبدَلاً بـ stub.** أي fake أو mock يستبدل حدوداً حقيقية (SQL خام، معاملة قاعدة بيانات، قيد unique) يجب أن **يفشل بصوت عالٍ** عند استدعاء مسار لا يدعمه — لا أن يُرجع قيمة فارغة. النجاح الصامت على مسار غير مُنفَّذ هو **دليل زائف**، وهو أخطر من الفشل.

وقاعدة ثانية في §2 (Modular Independence):

> ملف الاختبار لا يقرأ ملفات خارج حدود الـ workspace الخاص به. اعتماديات التطبيقات على بعضها ممنوعة في وقت التشغيل ووقت الاختبار على السواء.

---

## 6. ما لم أفعله

- لم أعدّل أي اختبار أو كود إنتاجي — هذا الملف نتائج فحص فقط، بانتظار مراجعتك بعد WP-008.
- لم أشغّل مجموعة الاختبارات (لا قاعدة بيانات ولا Docker في بيئة الفحص). كل ما ورد أعلاه **مستنتَج من قراءة الكود، لا من تشغيل مُلاحَظ** — وفق §0.7، يُعامَل كـ **غير مُتحقَّق منه بالتشغيل** حتى يُشغَّل فعلياً. الأرقام والمسارات مأخوذة حرفياً من الملفات.
- لم أفحص اختبارات `admin-web` (13 ملفاً) و`pos-electron` (17 ملفاً) بنفس العمق — لا يوجد فيها `readFileSync` على مصدر، لذا خطر F1/F2 لا ينطبق عليها. تستحق فحصاً منفصلاً.
