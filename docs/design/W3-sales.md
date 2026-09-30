# W3 — البيع (تصميم تنفيذي)

> نطاق الإطلاق الأول (`ATHR_MASTER_PLAN.md`). D9: لا توافق مع إصدارات dev — الأعمدة القديمة تُستبدل مباشرة.
> مسار البيع الحالي 16 statement ثابتة؛ الهدف ألا يزيد إلا بما يلزم ويبقى ثابتًا لأي عدد سطور.

## 0. قاعدة ثابتة (صفر فقد بيانات)

**أي أمر بيع قادم من الـPOS لا يُرفض أبدًا بسبب فحوص W3** — يُقبل مع warning: مدفوعات لا تساوي الإجمالي (`PAYMENT_TOTAL_MISMATCH`)، طريقة دفع معطلة في الإعدادات (`PAYMENT_METHOD_DISABLED`)، خصم فوق الحد (`DISCOUNT_ABOVE_LIMIT`)، تجاوز حد الائتمان (`CUSTOMER_CREDIT_LIMIT_EXCEEDED`)، تعارض رقم الفاتورة (§1). الفحوص الصارمة فقط في مسارات الإدارة الـonline.

## 1. الترقيم

**المشكلة:** رقم الفاتورة على الإيصال المطبوع (`LOCAL-T1-123`) غير الرقم في النظام (`B-{branch}-{timestamp}-{rand}`)، وترقيم التسويات/الجرد `nextval` على sequence عام لكل الـtenants (يكشف حجم عملاء آخرين ويترك فجوات).

**القرار:**
- **فاتورة الـPOS:** الرقم يُولَّد على الجهاز offline = `{terminal_code}-{terminal_sequence 6 أرقام}` (مثال `POS1-000123`). هو المطبوع وهو المخزن في `SalesInvoice.invoice_number` كما هو. مسلسل بلا فجوات لكل جهاز. **لو** كان `terminal_code` يمكن أن يُعاد استخدامه (factory reset / إعادة تسجيل مع تصفير الـsequence) فالتعارض ممكن: الخادم يخزن البيع برقم مميَّز (لاحقة) مع warning `INVOICE_NUMBER_REASSIGNED` — لا رفض أبدًا. التنفيذ يتحقق من هذا السيناريو ويغلقه من جهة التسجيل إن أمكن (sequence لا يبدأ من الصفر لجهاز بنفس الكود). (ترقيم مسلسل واحد لكل الفرع مستحيل مع أكثر من جهاز offline — القرار: مسلسل لكل جهاز، وكود الجهاز يوضح الفرع.)
- **مستندات الخادم** (مرتجع، تسوية، جرد، بيع من الإدارة لو وُجد): جدول `DocumentSequence (tenant_id, key, next_value)` — `key` مثل `return`, `adjustment`, `count`. الرقم التالي = `INSERT ... ON CONFLICT (tenant_id, key) DO UPDATE SET next_value = "DocumentSequence".next_value + 1 RETURNING` (statement واحد، قفل صف واحد لكل tenant+نوع). بادئة ثابتة لكل نوع (`R-`, `ADJ-`, `CNT-`). تُنقل تسويات وجرد L1 لهذا الجدول ويُحذف الـsequence العام (migration جديدة).

## 2. المدفوعات والدفع المقسم

- جدول `SalesPayment (tenant_id, sales_invoice_id, method, amount Decimal(14,2), reference?, sequence)`.
- `method`: `cash | card | wallet | bank_transfer | credit | other` (enum). الطرق المفعّلة لكل tenant في الإعدادات (§5).
- أمر البيع: `payments: [{ method, amount, reference? }]` (≥1). `SUM(amount) = total` بالضبط. الكاش المستلم والباقي: `tendered` اختياري على سطر الكاش (للإيصال فقط؛ `amount` = الصافي).
- يُحذف `SalesInvoice.payment_method` (D9)؛ التقارير تجمع من `SalesPayment`.
- **مسار البيع:** `createMany` للمدفوعات = +1 statement ثابت.
- **الشفت:** الكاش المتوقع = الافتتاحي + مدفوعات `cash` − مبالغ مرتجعة `cash` (نفس الحساب من الجدول بدل `payment_method`).

## 3. البيع الآجل ورصيد العميل

- `method = credit` يتطلب عميلًا (رقم الهاتف في أمر البيع كما اليوم).
- `Customer.balance Decimal(14,2)` رصيد جارٍ (موجب = على العميل) + `CustomerLedgerEntry` append-only `(customer_id, type: sale_credit | payment | refund_credit | adjustment, amount signed, reference, occurred_at, created_by)`.
- البيع الآجل: +1 statement (INSERT ledger + UPDATE balance في CTE واحد) **فقط** لو فيه مدفوع `credit`.
- **تحصيل دين:** `POST /customers/:id/payments { amount, method, idempotency_key }` (online، إدارة أو POS متصل). يدخل الكاش في الشفت المفتوح لو من POS.
- **حد الائتمان:** `Customer.credit_limit?` (null = بلا حد). البيع offline مقبول أولًا: تجاوز الحد = warning `CUSTOMER_CREDIT_LIMIT_EXCEEDED`، لا رفض.
- قائمة العملاء المدينين + كشف حساب العميل (paginated).

## 4. الخصومات

- **سطر:** `discount: { type: 'amount' | 'percent', value }` على سطر البيع. **فاتورة:** نفس الشكل على مستوى الأمر.
- خصم الفاتورة يُوزَّع على السطور بنسبة صافي كل سطر (آخر سطر يأخذ فرق التقريب) ويُخزَّن على السطر: `SalesInvoiceItem.discount_amount`. الضريبة تُحسب **بعد** الخصم لكل سطر.
- **لا حساب جديد:** يُنقل حساب السطر الموجود في الـbackend (مع `TaxMode` inclusive/exclusive و`TaxCalculationMethod` و`TaxRoundingPolicy`) إلى `@athr/domain-core` ويُضاف له الخصم، ويستخدمه الـPOS والـbackend معًا. الخصم على السعر الشامل vs غير الشامل للضريبة يُعالج صراحة.
- **مصدر الحقيقة للإجمالي:** يُوثَّق ويُختبر أيهما يُعتمد عند وصول البيع: سعر الـPOS المخزن (`price_issued_at`) أم تسعير الخادم الحالي — والإجابة الحالية في الكود هي المرجع (لا تغيير سلوك بدون قرار).
- الصلاحيات: `sales.discount.apply` حتى `max_discount_percent` (إعداد tenant، افتراضي 10%)؛ أعلى منه يتطلب `sales.discount.override`. على الـPOS offline: الواجهة تمنع؛ الخادم يقبل أولًا ويضع warning `DISCOUNT_ABOVE_LIMIT` (لا يُرفض بيع مكتمل).
- المرتجع يرد صافي ما دُفع (بعد الخصم) للكمية المرتجعة.
- promotions/coupons في البيع: **مؤجل** (خارج نطاق الإطلاق).

## 5. إعدادات البيع لكل tenant

في `Tenant.settings` عبر `catalog/tenant-settings.ts` (المكان الوحيد الذي يعرف الشكل)، وتصل للـPOS في `settings` بالمزامنة:
- `sales.payment_methods`: الطرق المفعلة (افتراضي `cash, card, wallet, credit`).
- `sales.return_window_days` (افتراضي 14؛ 0 = بلا مرتجع).
- `sales.max_discount_percent` (افتراضي 10).
- `receipt.store_name`, `receipt.footer`, `receipt.show_tax_breakdown` — اسم المتجر على الإيصال بدل الثابت.
- العملة = `Tenant.default_currency` (موجود).
- شاشة في `/settings` في الـadmin لهذه الإعدادات.

## 6. الاستبدال

- `POST /pos/exchange`: مرتجع + بيع جديد في transaction واحدة، مع `Return.new_invoice_id`. الفرق: العميل يدفع (مدفوعات عادية على البيع الجديد) أو يُرد له (نقدي أو رصيد آجل).
- online فقط في W3 (المرتجع online اليوم)؛ الاستبدال offline مع W4.
- المرتجع يسجل `refund_method` (`cash | credit | card | wallet | other`) ليحسب الشفت ورصيد العميل صحيحًا.

## 6.1 الـfingerprint

الـfingerprint يغطي `payments` والخصومات. D9: تُعاد توليد اختبارات الـgolden hash، لا حاجة لثبات إصدارات dev.

## 7. عدد الـstatements المستهدف (بيع)

الحالي 16. + المدفوعات 1 = **17 ثابتة**. + 1 فقط عند وجود دفع آجل. الخصم والترقيم بلا statements إضافية (الترقيم من الجهاز). اختبار عدّ يثبت ذلك لسطر واحد و30 سطرًا.

## 8. التقسيم

**الدمج:** استبدال `payment_method` بـ`payments[]` يكسر الـPOS الحالي؛ لذا W3-backend وW3-POS يُدمجان معًا في الفرع الرئيسي (لا يُدفع backend وحده).

1. **W3-backend:** §1–§7 + اختبارات (unit + real-Postgres) + الـcontract في `docs/design/W3-api.md`.
2. **W3-POS:** شاشة الدفع (مقسم + باقي + آجل)، الخصومات، الترقيم الجديد على الإيصال، الإعدادات من المزامنة، الاستبدال online.
3. **W3-admin:** إعدادات البيع، العملاء المدينون وكشف الحساب وتحصيل الدين، المدفوعات في تفاصيل الفاتورة والتقارير. (UX spec قبل البناء.)
