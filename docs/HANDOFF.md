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

## قيد التنفيذ عند كتابة هذا الملف

- **W1c** (أداء): مسار البيع ~12–14 query، التقارير في SQL، pagination للقوائم، تنظيف indexes.
- **W2a** (كتالوج عام + مزامنة): ProductType/attributes/label، جدول `ProductBarcode`، باركود الميزان، presets لأنواع التجارة، SyncChange بـ`xid8` و delta بالكيان و snapshot مقسم، تكييف الـPOS والـadmin.

إن لم تظهر هذه في سجل الفرع فهي لم تُدمج — أعد تنفيذها من وصفها أعلاه والتصميم في `docs/design`.

## الخطوات التالية بالترتيب

1. إكمال/دمج W1c و W2a (إن لم تكن دُمجت).
2. **W2b:** التتبع `serial`/`batch` (خلف مفاتيح المزايا `tracking.serial`/`tracking.batch`).
3. **W3 — البيع:** جدول Payments ودفع مقسم · خصومات سطر/فاتورة · تطبيق promotions/coupons في البيع (مع فحص الميزة `promotions`) · ترقيم مسلسل لكل فرع · إعدادات بيع لكل tenant (مدة الاسترجاع، طرق الدفع، العملة) · الاستبدال.
4. **W4 باقي الـPOS:** طباعة صامتة ودرج النقدية · مرتجعات/شفت/عملاء Offline · شاشة الفواتير المرفوضة · قراءة حالة الاشتراك من heartbeat وإيقاف البيع عند `suspended`.
5. **W6 التصميم (بدون توقف — قرار D8):** design system احترافي للـadmin والـPOS · React Query · route groups `(public)/(app)/(platform)` · Landing + صفحة أسعار (`GET /public/plans`) + تسجيل (`POST /public/signup`) · لوحة المنصة (`/platform/*`) · صفحات مزايا الـbackend (Price Books، الضرائب، العروض، الوحدات، أنواع المنتجات، الجرد).
6. **W7:** rate limit للدخول، backups، E2E.

## تشغيل محلي

```bash
npm ci
cp backend/.env.example backend/.env   # DATABASE_URL + JWT_SECRET (openssl rand -hex 32)
npm run prisma:migrate:deploy --workspace athr-operations-api
ALLOW_DEVELOPMENT_ACCOUNTING_RESET=reset-development-accounting npm run prisma:seed --workspace athr-operations-api
npm run test:soft          # كل الاختبارات
npm run test:db --workspace athr-operations-api   # فحوص Postgres حقيقية (بعد seed على قاعدة نظيفة)
```

## قواعد العمل

- كل تغيير schema = migration جديدة (لا تعديل على migrations قديمة) + `prisma migrate diff --exit-code` نظيف.
- كود نظيف بدون over-engineering، الملف مسؤولية واحدة، TypeScript strict للكود الجديد.
- لا TEMP DRILL commits؛ أي تحقق يصبح test دائم.
