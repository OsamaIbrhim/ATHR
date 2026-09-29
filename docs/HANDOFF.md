# ATHR — Handoff (للاستكمال من أي جلسة أو محليًا)

> اقرأ أولًا: `docs/ATHR_MASTER_PLAN.md` (القرارات والموجات) ثم `docs/design/W1-W2-data-core.md` (التصميم التقني).
> الفرع: `claude/sleepy-bardeen-gulfgg`.

## ما تم ودُمج

| الموجة | المحتوى |
|---|---|
| W0 | Baseline migration واحدة، CI مخفف، إصلاحات POS/admin/backend، 0 ثغرات npm |
| W1a | نظام صلاحيات واحد (`@RequirePermission`)، الـUser هوية فقط، الصلاحيات على Membership، RefreshToken يحفظ الـtenant |
| W1b | `InventoryService` الكاتب الوحيد للمخزون (3 statements لأي عدد سطور)، مخزون بمفتاح المخزن، كميات Decimal(14,3)، حذف Location |
| W4a | الـPOS على better-sqlite3 + WAL، migrations بإصدار، بحث مفهرس، main.ts مقسم لموديولات |
| W5a | Plans/Subscription/Entitlements/Limits، signup عام، APIs لوحة المنصة، `npm run platform:admin -- <email|phone>` |

## W2a — دُمج بالكامل (backend + POS 1.6.0 + admin)

الـbackend: ProductType/attributes/label، `ProductBarcode`، `Tenant.settings` (باركود الميزان)، parser في `@athr/domain-core`،
presets في `backend/src/catalog/presets/` (إضافة نوع تجارة = ملف preset + تسجيله في `index.ts`)، مزامنة بـcursor `txid:sequence`
و delta بالكيان و snapshot مقسم (`catalog_version: 3`، `/sync/pull` يتطلب POS protocol 3)، compaction عبر `POST /platform/sync/compact`.

**POS 1.6.0 (protocol 3):** migration محلية v4 (`products` مُعاد بناؤه بـ`label/attributes/uom_*`، جدول `barcodes`، `stock.qty` عشري؛ لا تلمس outbox/sales_local/held_sales) ·
pull بـsnapshot مقسم قابل للاستئناف (`sync_cursor` وformat version يُكتبان بعد آخر صفحة فقط) ويتبع `mode` الخادم · scan: باركود (`pack_qty`) ← SKU ← ميزان ← بحث (`electron/db/scan.ts`) ·
كميات عشرية حسب `uom_precision` مع تقريب half-up لكل سطر مطابق للـbackend (`electron/quantity.ts`, `money.ts`) · `variant_label_snapshot` بدل المقاس/اللون ·
رفض رفع بيع بـ`POS_UPDATE_REQUIRED`/`POS_PROTOCOL_UNSUPPORTED` يُبقيه **pending** (لا quarantine).
**Admin:** صفحة `/product-types` (محرر خصائص) · `/products/new` و`/products/[id]` (matrix للـvariants، باركود متعدد، وحدة، SKU مقترح ASCII) · عمود `label` في كل القوائم.

**قرارات/ملاحظات:**
- `POS_MIN_APP_VERSION` يبقى 1.4.0 مؤقتًا: الـPOS يرفع المبيعات قبل فحص التوافق، و1.5.1 يعزل (quarantine) أي بيع يُرفض بـ426. ارفعه إلى 1.6.0 **بعد** تحديث كل الأجهزة.
  عند الـdeploy: `POS_PROTOCOL_MIN=2`, `POS_PROTOCOL_MAX=3` في بيئة الإنتاج (1.5.1 يرفع مبيعاته، ولا يستطيع سحب الكتالوج حتى يُحدَّث).
- مبيعات 1.5.1 الموجودة في الـoutbox تُرسل كما هي (بدون label) لأن `variant_label_snapshot` داخل fingerprint الـidempotency.
- باركود الميزان بالسعر: الكمية = سعر الملصق ÷ (السعر + الضريبة)، مقربة لـ`uom_precision` (اختيار الـPOS؛ الـbackend لا يحلل ملصقات الميزان في البيع).
- فجوات API للـadmin (مهمة صغيرة قادمة): لا يوجد إعادة تفعيل variant · `product_type_id` غير قابل للتعديل · لا `GET /product-types/:id` ولا عدد الاستخدام · reconciliation المشتريات بدون label.
- الـmigration الخاصة بـW2a (backend) لم تُختبر على بيانات موجودة (فقط قواعد فارغة + seed).

## W1c — دُمج

البيع 16 statement ثابتة (كان 24؛ الوصول لـ14 يحتاج Prisma preview `relationJoins` — قرار مؤجل)، التقارير GROUP BY في SQL بمدى تاريخ إلزامي (≤366 يوم)،
pagination موحد (`common/pagination.ts`) لكل القوائم، حذف 47 index زائد وإضافة 9 tenant-prefixed.

## الخطوات التالية بالترتيب

1. **W2b:** التتبع `serial`/`batch` (خلف مفاتيح المزايا `tracking.serial`/`tracking.batch`).
2. **W3 — البيع:** جدول Payments ودفع مقسم · خصومات سطر/فاتورة · تطبيق promotions/coupons في البيع (مع فحص الميزة `promotions`) · ترقيم مسلسل لكل فرع · إعدادات بيع لكل tenant (مدة الاسترجاع، طرق الدفع، العملة) · الاستبدال.
3. **W4 باقي الـPOS:** طباعة صامتة ودرج النقدية (+ اسم المتجر/الفرع في رأس الإيصال بدل "ATHR" الثابت) · مرتجعات/شفت/عملاء Offline · شاشة الفواتير المرفوضة · قراءة حالة الاشتراك من heartbeat وإيقاف البيع عند `suspended`.
4. **W6 التصميم (بدون توقف — قرار D8):** design system احترافي للـadmin والـPOS · React Query · route groups `(public)/(app)/(platform)` · Landing + صفحة أسعار (`GET /public/plans`) + تسجيل (`POST /public/signup`) · لوحة المنصة (`/platform/*`) · صفحات مزايا الـbackend (Price Books، الضرائب، العروض، الوحدات، أنواع المنتجات، الجرد).
5. **W7:** rate limit للدخول، backups، E2E.

## تشغيل محلي

```bash
npm ci
cp backend/.env.example backend/.env   # DATABASE_URL + JWT_SECRET (openssl rand -hex 32)
npm run prisma:migrate:deploy --workspace athr-operations-api
ALLOW_DEVELOPMENT_ACCOUNTING_RESET=reset-development-accounting npm run prisma:seed --workspace athr-operations-api
npm run test:soft          # كل الاختبارات
npm run test:db --workspace athr-operations-api   # فحوص Postgres حقيقية (بعد seed على قاعدة نظيفة)
```

### Windows محليًا

- Node 24 (الـprebuild الخاص بـbetter-sqlite3 v13 على Windows لا يعمل على 22.12). التثبيت:
  `npm ci --ignore-scripts && npm rebuild @prisma/engines prisma @prisma/client electron esbuild && npm run build:shared`
  (السبب: `binding.gyp` يجعل npm يحاول الـcompile بدون MSVC، والـprebuild مضمن في الحزمة).
- `test:db` يحتاج قاعدة **جديدة** كل مرة (drop/create → migrate → seed → test:db). الـmigration runner يقرأ `DIRECT_URL` من البيئة (`set -a; . backend/.env`).

## قواعد العمل

- كل تغيير schema = migration جديدة (لا تعديل على migrations قديمة) + `prisma migrate diff --exit-code` نظيف.
- كود نظيف بدون over-engineering، الملف مسؤولية واحدة، TypeScript strict للكود الجديد.
- لا TEMP DRILL commits؛ أي تحقق يصبح test دائم.
