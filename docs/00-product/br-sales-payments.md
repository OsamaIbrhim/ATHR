# ATHR Sales & Payments Business Rules v1.0

**Planning Baseline — Open Decisions Are Explicit**

## 1. وظيفة الوثيقة

هذه الوثيقة هي المرجع التفصيلي لقواعد البيع والمدفوعات في أثر.

تغطي:

- إنشاء سلة البيع.
- اختيار المنتج والكمية والسعر.
- الخصومات والضرائب والتقريب.
- إتمام البيع وتثبيت المستند.
- الدفع النقدي والإلكتروني والدفع المختلط.
- البيع الجزئي أوالآجل عند اعتماده.
- العمل دون اتصال.
- الإلغاء والـVoid والتصحيح.
- رد المدفوعات المرتبط بالمرتجعات.
- الوردية والخزنة والتدقيق.

لا تحدد هذه الوثيقة تصميم الـAPI أوالجداول؛ لكنها تمثل الـBusiness contract الذي يجب أن يطابقه التصميم لاحقًا.

## 2. تصنيف القرارات

- **Invariant:** قاعدة لا يجوز كسرها أوتهيئتها لكل عميل.
- **Tenant Policy:** اختيار مسموح ضبطه للمؤسسة ضمن حدود المنتج.
- **Location Policy:** اختيار يختلف حسب الفرع.
- **Permission Bound:** إجراء مسموح فقط لصلاحية محددة.
- **Approval Bound:** إجراء يحتاج اعتمادًا إضافيًا بعد تجاوز حد.
- **Open Decision:** قرار لم يُعتمد ولا يتحول إلى كود افتراضي.
- **Deferred Capability:** خارج الإصدار الأول لكنه محفوظ في التصميم.

## 3. المصطلحات

### Cart

حالة عمل محلية قابلة للتعديل قبل إتمام البيع. لا تمثل حقيقة مالية أومخزنية نهائية.

### Sale

المعاملة التجارية المكتملة التي تربط المستند والسطور والمدفوعات والحركات المخزنية.

### Sales Invoice

المستند المالي الناتج عن البيع. لا يساوي Billing Invoice الخاصة باشتراك أثر.

### Payment

سجل قيمة مالية مرتبطة بعملية بيع أوسداد لاحق أوRefund.

### Payment Attempt

محاولة تنفيذ دفع قد تنتهي بنجاح أوفشل أوPending أوReversal.

### Tender

طريقة الدفع المستخدمة: نقدي، بطاقة، محفظة، تحويل، رصيد عميل، أوغيرها عند اعتمادها.

### Void

إبطال عملية وفق شروط زمنية وتشغيلية محددة، مع الحفاظ على السجل الأصلي.

### Refund

إرجاع قيمة مالية سبق تحصيلها. لا يُنشئ وحده عودة مخزون ما لم يكن مرتبطًا بعملية Return معتمدة.

## 4. المبادئ غير القابلة للتفاوض

### BR-SAL-100 — البيع حقيقة واحدة مركبة

**التصنيف:** Invariant

إتمام البيع يجب أن ينتج حقيقة مترابطة تشمل:

- المستند.
- السطور.
- الأسعار والخصومات والضرائب المثبتة.
- حالة الدفع.
- حركة المخزون.
- هوية المنفذ والوردية والجهاز.
- Event وAudit evidence.

لا يجوز نجاح جزء وظهور البيع Completed بينما أثر جوهري آخر مفقود.

### BR-SAL-101 — الأثر النهائي يحدث مرة واحدة

**التصنيف:** Invariant

إعادة الضغط أوانقطاع الشبكة أوإعادة الإرسال لا تنشئ:

- فاتورة ثانية.
- خصم مخزون ثانٍ.
- Payment ثانية.
- رقم مستند جديد لنفس المحاولة.

### BR-SAL-102 — التاريخ المالي لا يُعدّل صامتًا

**التصنيف:** Invariant

بعد اكتمال البيع:

- لا تُعدّل الكمية أوالسعر أوالضريبة أوالخصم مباشرة.
- التصحيح يتم بـVoid أوReturn أوRefund أوCorrection document حسب الحالة.
- يحتفظ النظام بالقيم الأصلية والروابط بين المستندات.

### BR-SAL-103 — حالة المستند وحالة الدفع منفصلتان

**التصنيف:** Invariant

Invoice status لا تُستخدم بديلًا عن Payment status.

قد تكون الفاتورة:

- مكتملة ومدفوعة.
- مكتملة ومدفوعة جزئيًا عند السماح.
- مكتملة وغير مدفوعة عند البيع الآجل.
- مكتملة ومستردة جزئيًا.
- مكتملة ومستردة بالكامل.

### BR-SAL-104 — كل رقم مالي قابل لإعادة الحساب

**التصنيف:** Invariant

يجب أن يكون إجمالي المستند قابلًا لإعادة الحساب من:

- قيم السطور المثبتة.
- الخصومات.
- الضرائب.
- الرسوم المعتمدة.
- التقريب.

لا يقبل Total حر غير قابل للتفسير.

## 5. Context وشروط بدء البيع

### BR-SAL-110 — البيع يحتاج Scope كاملًا

**التصنيف:** Invariant

قبل إتمام البيع يجب توفر:

- Tenant فعال.
- Location فعال.
- Selling warehouse أوstock source محدد.
- Terminal فعال ومسجل.
- Membership فعالة.
- User session صالحة.
- Shift مفتوحة إذا كانت سياسة الفرع تتطلب وردية.

### BR-SAL-111 — Cart مرتبطة بسياق واحد

**التصنيف:** Invariant

لا يجوز للسلة الواحدة أن تحتوي عناصر من:

- أكثر من Tenant.
- أكثر من Currency.
- أكثر من Location.
- أكثر من Selling warehouse إذا كان البيع لا يدعم Fulfillment متعدد المصدر.

### BR-SAL-112 — تغيير الـScope يبطل إعادة استخدام السلة

**التصنيف:** Invariant

عند تغيير Location أوTerminal أوShift:

- لا تنتقل Cart مفتوحة تلقائيًا.
- إما تُلغى أوتُحفظ كـSuspended cart مع Scope الأصلي.
- لا تُستكمل تحت Scope جديد دون عملية صريحة ومصرح بها.

### BR-SAL-113 — البيع من Terminal ملغاة ممنوع

**التصنيف:** Invariant

Terminal الملغاة أوالمنتهية الـLease لا تنشئ مبيعات جديدة، حتى لو بقيت بيانات الدخول محليًا.

## 6. Cart ودورة ما قبل الإتمام

### BR-SAL-120 — Cart لا تؤثر على المخزون النهائي

**التصنيف:** Invariant

إضافة أوحذف أوتعديل سطر داخل Cart لا تنشئ Inventory movement نهائية.

### BR-SAL-121 — Cart لها هوية محلية ثابتة

**التصنيف:** Invariant

كل Cart تحصل على Client-generated identity تستخدم لاحقًا كأساس للـIdempotency عند الإتمام.

### BR-SAL-122 — Cart قابلة للتعديل حتى بدء الإتمام

**التصنيف:** Invariant

بعد بدء Completion command:

- تمنع تعديلات متزامنة على نفس Cart.
- أي تغيير لاحق يحتاج الرجوع لحالة قابلة للتعديل أوإنشاء Cart جديدة.

### BR-SAL-123 — تعليق السلة لا يحجز مخزونًا افتراضيًا

**التصنيف:** Tenant Policy

الافتراضي المقترح:

- Suspended cart لا تنشئ Reservation.
- يمكن دعم Reservation لاحقًا لسيناريو Order أوLayaway كقدرة منفصلة.

### BR-SAL-124 — Cart المهجورة لها مدة احتفاظ

**التصنيف:** Tenant Policy

- تُحذف Cart المؤقتة أوتؤرشف بعد مدة سياسة.
- لا تُحذف Cart دخلت Completion أوأنتجت Sync event.

## 7. سطور البيع والكميات

### BR-SAL-130 — البيع يتم على Variant قابلة للبيع

**التصنيف:** Invariant

السطر يجب أن يشير إلى Variant فعالة وقابلة للبيع داخل Tenant وScope الصحيح.

### BR-SAL-131 — الكمية موجبة داخل البيع العادي

**التصنيف:** Invariant

Sale line العادية تستخدم Quantity أكبر من صفر.

- المرتجع لا يُمثل بكمية سالبة داخل نفس Sale.
- التصحيح له مستند مستقل.

### BR-SAL-132 — وحدة القياس مثبتة

**التصنيف:** Invariant

كل سطر يثبت:

- Unit of measure.
- Conversion factor إن وُجد.
- Precision المسموحة.

لا تتغير وحدة السطر بعد اكتمال البيع.

### BR-SAL-133 — الكمية العشرية حسب المنتج

**التصنيف:** Tenant Policy ضمن Product Rule

- المنتجات القطعية تقبل أعدادًا صحيحة فقط.
- المنتجات الموزونة قد تقبل كسورًا وفق Precision محددة.
- POS تمنع Precision أعلى من المسموح.

### BR-SAL-134 — لا بيع لعنصر غير نشط

**التصنيف:** Invariant

إذا تعطلت Variant بعد إضافتها للسلة وقبل الإتمام:

- Online: يعاد التحقق ويمنع الإتمام أوتطلب صلاحية استثنائية معللة.
- Offline: تطبق Snapshot policy وتُرسل Pending validation إذا لم يمكن التحقق.

### BR-SAL-135 — Negative stock قرار صريح

**التصنيف:** Location Policy + Permission Bound

السياسات الممكنة:

- Forbid.
- Allow with warning.
- Allow only by permission.

عند السماح:

- يسجل السبب.
- تسجل هوية المنفذ.
- يظهر Exception للمشرف.

## 8. السعر وقائمة الأسعار

### BR-PRC-100 — السعر النهائي يُثبت داخل السطر

**التصنيف:** Invariant

كل Sale line تحفظ:

- Base price.
- Price source.
- Applied price rule.
- Manual override إن وجد.
- Discount breakdown.
- Tax basis.
- Final unit price.

تغيير Price Book لاحقًا لا يغير الماضي.

### BR-PRC-101 — لكل بيع Price Book فعالة واحدة

**التصنيف:** Tenant Policy

اختيار Price Book يتم وفق ترتيب معلن، مثل:

1. Customer-specific contract.
2. Location price book.
3. Tenant default price book.

لا يختار النظام مصدرًا غامضًا عند تعارض أكثر من Rule.

### BR-PRC-102 — العملة واحدة لكل Sale

**التصنيف:** Invariant

- كل Invoice لها Currency واحدة.
- كل سطورها ومدفوعاتها المسجلة تُقاس بنفس Currency، إلا إذا دعم Conversion رسمي لاحقًا.

### BR-PRC-103 — Manual price override يحتاج صلاحية

**التصنيف:** Permission Bound

الـoverride يجب أن يسجل:

- السعر الأصلي.
- السعر الجديد.
- السبب.
- المنفذ.
- الموافق عند الحاجة.

### BR-PRC-104 — السعر لا يكون سالبًا

**التصنيف:** Invariant

- Final unit price لا تقل عن صفر.
- Coupon أوDiscount لا يحول السطر لقيمة سالبة.
- تعويض العميل يتم كCredit أوRefund، لا Sale line سالبة.

### BR-PRC-105 — البيع تحت التكلفة سياسة مستقلة

**التصنيف:** Tenant Policy + Approval Bound

الخيارات:

- Allow.
- Warn.
- Require permission.
- Forbid.

لا تعتمد القاعدة على Cost غير موثوقة دون إظهار أن التحقق غير متاح.

### BR-PRC-106 — Stale offline prices لها Policy

**التصنيف:** Open Decision / Location Policy

الخيارات المقترحة:

- السماح حتى عمر Snapshot محدد.
- السماح بحد زمني مع Warning.
- منع البيع لبيانات تجاوزت الحد.
- السماح Pending price validation لقطاعات محددة.

يجب اعتماد سياسة قبل تنفيذ Offline sales النهائي.

## 9. الخصومات والعروض

### BR-DSC-100 — الخصم له Source واضح

**التصنيف:** Invariant

مصدر الخصم يكون واحدًا من:

- Promotion rule.
- Coupon.
- Customer entitlement.
- Manual line discount.
- Manual invoice discount.
- Loyalty أوStore credit عند دعمها.

### BR-DSC-101 — الخصومات المثبتة لا تتغير لاحقًا

**التصنيف:** Invariant

كل Discount تحفظ كقيمة وسبب وRule version وقت البيع.

### BR-DSC-102 — نسبة الخصم بين صفر ومئة

**التصنيف:** Invariant

لا يسمح بخصم نسبة سالبة أوأكبر من 100%.

### BR-DSC-103 — الخصم الثابت لا يتجاوز أساسه

**التصنيف:** Invariant

- Line fixed discount لا تتجاوز قيمة السطر المؤهلة.
- Invoice discount لا تتجاوز مجموع القيم المؤهلة.

### BR-DSC-104 — Manual discount تحتاج Permission وحدًا

**التصنيف:** Permission Bound

كل Role لها:

- حد نسبة.
- حد قيمة.
- هل يحتاج سببًا.
- هل يحتاج Approval بعد حد معين.

### BR-DSC-105 — ترتيب الخصومات معلن

**التصنيف:** Tenant Policy ضمن حدود المنتج

يجب اعتماد ترتيب ثابت، مثل:

1. Price rule.
2. Line promotion.
3. Manual line discount.
4. Invoice promotion.
5. Manual invoice discount.

لا يختلف الترتيب بين POS وBackend.

### BR-DSC-106 — Stacking ليس افتراضيًا

**التصنيف:** Tenant Policy

كل Promotion تحدد:

- Stackable أوExclusive.
- Priority.
- Eligible products/customers/locations.
- Start/end time.
- Online/offline availability.

### BR-DSC-107 — توزيع خصم الفاتورة حتمي

**التصنيف:** Invariant

خصم مستوى الفاتورة يوزع على السطور المؤهلة بطريقة deterministic للحساب والمرتجع والضريبة.

أي فرق تقريبي يخصص وفق قاعدة ثابتة، مثل أكبر سطر مؤهل أوآخر سطر بالترتيب الحتمي.

### BR-DSC-108 — لا تعديل خصم بعد الدفع المكتمل

**التصنيف:** Invariant

التصحيح بعد الإتمام يتم بمستند تصحيح أوReturn، لا بتحرير السجل الأصلي.

## 10. الضرائب

### BR-TAX-100 — Tax configuration لها Version

**التصنيف:** Invariant

كل Sale تثبت:

- Tax code.
- Rate.
- Inclusive/exclusive mode.
- Taxable base.
- Exemption reason إن وجد.
- Tax rule version.

### BR-TAX-101 — الضريبة تحسب على أساس مثبت

**التصنيف:** Invariant

لا يكفي حفظ Total tax فقط؛ يجب حفظ ما يسمح بإعادة الحساب على مستوى السطر أوالتوزيع المعتمد.

### BR-TAX-102 — Inclusive وExclusive لا يختلطان غامضًا

**التصنيف:** Tenant Policy

- Price Book أوTax rule تحدد إن كان السعر شامل الضريبة.
- تعرض POS للمستخدم ما إذا كان السعر شاملًا أملا.
- لا تتغير الدلالة عند الطباعة.

### BR-TAX-103 — الإعفاء يحتاج سببًا وصلاحية

**التصنيف:** Permission Bound

أي Tax exemption تسجل:

- Customer أوdocument basis.
- Reason code.
- Evidence reference عند الحاجة.
- Actor.

### BR-TAX-104 — الخصومات والضريبة تتبع ترتيبًا واحدًا

**التصنيف:** Invariant

ترتيب تطبيق الخصم والضريبة يحدد في Tax policy ويطبق نفسه في:

- POS.
- Backend.
- Reports.
- Returns.

### BR-TAX-105 — القواعد القانونية ليست Hardcoded عالميًا

**التصنيف:** Invariant

متطلبات الفاتورة الضريبية والترقيم والإرسال الإلكتروني تُنفذ كConfiguration/Integration خاصة بالبلد والكيان القانوني، ولا تُفترض داخل Core بدون Blueprint قانوني منفصل.

## 11. الدقة والتقريب

### BR-RND-100 — تخزين المال بوحدة دقيقة معتمدة

**التصنيف:** Invariant

- القيم المالية لا تستخدم Floating point غير منضبط.
- تعتمد Currency minor units أوPrecision صريحة.

### BR-RND-101 — التقريب في نقاط محددة فقط

**التصنيف:** Invariant

يجب اعتماد نقطة التقريب لكل من:

- Unit calculation.
- Line subtotal.
- Discount allocation.
- Tax.
- Invoice total.
- Cash settlement عند الحاجة.

لا تُقرب نفس القيمة عدة مرات في طبقات مختلفة.

### BR-RND-102 — فرق التقريب ظاهر

**التصنيف:** Invariant

أي Rounding adjustment نهائي يسجل كبند محسوب واضح، ولا يختفي داخل Line عشوائية.

### BR-RND-103 — Cash rounding منفصل عن Accounting total

**التصنيف:** Tenant Policy / Currency Policy

إذا احتاج الدفع النقدي تقريبًا لفئات العملة:

- يبقى Invoice accounting total محفوظًا.
- يسجل Cash rounding adjustment منفصلًا.
- لا يطبق على طرق دفع أخرى دون سبب.

## 12. حساب الإجماليات

### BR-TOT-100 — معادلة الإجمالي ثابتة

**التصنيف:** Invariant

```
Gross line amounts
- line discounts
- allocated invoice discounts
+ taxes
+ approved fees
+ rounding adjustment
= invoice total
```

### BR-TOT-101 — Subtotal وTotal ليسا قيمة واحدة

**التصنيف:** Invariant

المستند يعرض ويفصل:

- Gross subtotal.
- Discounts.
- Net subtotal.
- Taxes.
- Fees.
- Rounding.
- Final total.

### BR-TOT-102 — إعادة الحساب تتم من Snapshot

**التصنيف:** Invariant

التحقق من Invoice مكتملة يستخدم القيم المثبتة وقت البيع، وليس Price Book أوTax configuration الحالية.

## 13. العميل والبيع المجهول

### BR-CUS-100 — العميل ليس إلزاميًا لكل Cash sale

**التصنيف:** Tenant Policy

الافتراضي المقترح:

- يسمح بـWalk-in customer للبيع النقدي العادي.
- يصبح العميل إلزاميًا عند البيع الآجل أوإصدار مستند قانوني يتطلب بياناته أوتطبيق Benefit خاصة.

### BR-CUS-101 — بيانات العميل المثبتة لا تعتمد على ملفه الحالي فقط

**التصنيف:** Invariant

عندما تكون بيانات العميل مطلوبة في المستند، تحفظ Snapshot مناسبة منها وقت البيع.

### BR-CUS-102 — لا إنشاء عملاء مكررين بلا تحذير

**التصنيف:** Tenant Policy

عند تكرار هاتف أوEmail أوTax identifier وفق قواعد Tenant، يظهر تحذير أومنع حسب قوة المعرف.

## 14. طرق الدفع

### BR-PAY-100 — Payment لها هوية مستقلة

**التصنيف:** Invariant

كل Payment تحفظ:

- Payment ID.
- Sale/Invoice reference.
- Method.
- Amount.
- Currency.
- Status.
- Terminal/Shift/User.
- External reference عند وجوده.
- Idempotency identity.
- Timestamps.

### BR-PAY-101 — طرق الدفع قابلة للتهيئة

**التصنيف:** Tenant/Location Policy

كل Location تحدد الطرق المتاحة، مثل:

- Cash.
- Card.
- Digital wallet.
- Bank transfer.
- Customer credit.
- Store credit.
- Gift card عند دعمها.

### BR-PAY-102 — تعطيل طريقة الدفع لا يغير التاريخ

**التصنيف:** Invariant

تعطيل Method يمنع استخدامها مستقبلًا، مع استمرار ظهورها في المستندات السابقة.

### BR-PAY-103 — طريقة الدفع تحدد إمكان Offline

**التصنيف:** Location Policy ضمن حدود آمنة

كل Method تصنف:

- Allowed offline.
- Allowed offline with limit.
- Online required.
- External terminal required.

### BR-PAY-104 — Payment amount موجبة

**التصنيف:** Invariant

- التحصيل يستخدم مبلغًا أكبر من صفر.
- Refund/Reversal لهما أنواع سجلات مستقلة، لا Payment سالبة غامضة.

## 15. الدفع النقدي

### BR-CASH-100 — النقدي يسجل المبلغ المستلم

**التصنيف:** Invariant

Cash payment تحفظ:

- Amount due.
- Tendered amount.
- Change returned.
- Cash rounding عند وجوده.

### BR-CASH-101 — الباقي لا يصبح إيرادًا

**التصنيف:** Invariant

قيمة Change لا تدخل في صافي التحصيل أوالمبيعات.

### BR-CASH-102 — المبلغ المستلم لا يقل عن المطلوب في Cash-only sale

**التصنيف:** Invariant، إلا عند Partial payment المعتمد

إذا كان البيع نقديًا بالكامل وغير آجل، يمنع الإتمام عندما Tendered أقل من المتبقي.

### BR-CASH-103 — Cash payment مرتبطة بالوردية والخزنة

**التصنيف:** Invariant عند تفعيل shifts

كل تحصيل أوRefund نقدي يؤثر على Expected drawer balance في الوردية الصحيحة.

### BR-CASH-104 — فتح درج النقد منفصل عن البيع

**التصنيف:** Permission Bound

No-sale drawer open يحتاج:

- Permission.
- Reason.
- Audit event.

## 16. البطاقة والمدفوعات الإلكترونية

### BR-EPAY-100 — محاولة الدفع لا تساوي نجاح الدفع

**التصنيف:** Invariant

Payment Attempt الحالات المبدئية:

- initiated.
- pending.
- authorized.
- captured.
- failed.
- cancelled.
- reversed.

لا تظهر Invoice مدفوعة بناءً على بدء المحاولة فقط.

### BR-EPAY-101 — المرجع الخارجي فريد ضمن Provider

**التصنيف:** Invariant

لا يسجل نفس Provider transaction كتحصيل ناجح لأكثر من Payment.

### BR-EPAY-102 — Unknown outcome لا يتحول إلى Failed مباشرة

**التصنيف:** Invariant

عند Timeout بعد إرسال طلب الدفع:

- تسجل الحالة Unknown/Pending reconciliation.
- لا يطلب من الكاشير إعادة التحصيل فورًا بلا تحقق.
- يوفر النظام مسار Inquiry/Reconciliation.

### BR-EPAY-103 — Manual card confirmation مقيدة

**التصنيف:** Permission Bound

إذا كان التكامل غير مباشر ويسجل الكاشير عملية تمت على Terminal خارجي:

- يحتاج اختيار Provider/Terminal.
- يسجل Reference أوآخر أرقام مرجعية مسموحة.
- يمنع إدخال بيانات بطاقات حساسة.
- يمكن طلب Supervisor approval فوق حد.

### BR-EPAY-104 — Authorization وCapture يظلان منفصلين عند دعمها

**التصنيف:** Deferred Capability

لا يفترض Core أن كل Provider يعمل بنموذج Capture فوري.

## 17. الدفع المختلط

### BR-SPLIT-100 — يسمح بأكثر من Tender عند تفعيله

**التصنيف:** Tenant Policy

Split payment يمكن أن يجمع طرقًا متعددة داخل Sale واحدة.

### BR-SPLIT-101 — مجموع التحصيل يطابق المطلوب قبل Paid

**التصنيف:** Invariant

تتحول Payment status إلى Paid فقط عندما:

```
Successful collections
- successful refunds
= current payable amount
```

### BR-SPLIT-102 — فشل جزء لا يمحو الأجزاء الناجحة

**التصنيف:** Invariant

إذا نجح Cash وفشلت Card:

- تبقى Payment الناجحة مسجلة.
- يظهر المتبقي.
- يمكن استكماله بطريقة أخرى أوإلغاء العملية وفق Void workflow.

### BR-SPLIT-103 — التغيير النقدي يحسب على الجزء النقدي المنطقي

**التصنيف:** Invariant

لا ينتج Change من Card أوWallet. أي Over-tender نقدي يحسب بعد مراعاة الطرق الأخرى والمتبقي الفعلي.

## 18. الدفع الجزئي والبيع الآجل

### BR-CREDIT-100 — البيع غير المدفوع ليس افتراضيًا

**التصنيف:** Tenant Policy + Permission Bound

الافتراضي المقترح للإصدار الأول:

- Cash retail sale يجب أن تُسدّد بالكامل قبل الإتمام.
- Credit sale قدرة مفعلة صراحة وليست سلوكًا ضمنيًا.

### BR-CREDIT-101 — البيع الآجل يحتاج Customer

**التصنيف:** Invariant

لا تنشأ Receivable على Walk-in customer مجهول.

### BR-CREDIT-102 — Credit limit يتحقق قبل الإتمام

**التصنيف:** Tenant Policy + Approval Bound

عند دعم الائتمان:

- يتحقق من الرصيد المستحق.
- Credit limit.
- Overdue status.
- Permission/approval للاستثناء.

### BR-CREDIT-103 — السداد اللاحق Payment مستقلة

**التصنيف:** Invariant

الدفع بعد يوم البيع:

- يرتبط بالعميل والفاتورة أوAllocation.
- يسجل في وردية التحصيل الحالية، لا وردية البيع القديمة.
- لا يغير تاريخ البيع.

### BR-CREDIT-104 — البيع الجزئي يثبت المتبقي

**التصنيف:** Invariant عند تفعيله

Invoice تعرض:

- Total.
- Paid.
- Outstanding.
- Due date عند الحاجة.

### BR-CREDIT-105 — البيع الآجل Offline قرار منفصل

**التصنيف:** Open Decision

الاقتراح الآمن:

- يمنع Offline افتراضيًا لعدم القدرة على التحقق من Credit exposure.
- يمكن السماح لاحقًا بحد محلي منخفض ومخاطر واضحة.

## 19. زيادة الدفع والرصيد

### BR-OVR-100 — Overpayment غير مسموح افتراضيًا

**التصنيف:** Tenant Policy

باستثناء Cash tender الذي ينتج Change، لا تسجل قيمة أعلى من المستحق دون Capability واضحة.

### BR-OVR-101 — تحويل الزيادة لرصيد عميل عملية صريحة

**التصنيف:** Deferred Capability

لا يتحول Overpayment تلقائيًا إلى Store credit دون:

- Customer معلوم.
- Consent/Policy.
- Ledger مستقل للرصيد.
- Audit.

## 20. إتمام البيع

### BR-COMP-100 — Completion command واحد

**التصنيف:** Invariant

الإتمام يستقبل Idempotency identity ثابتة من الجهاز ويعيد النتيجة نفسها عند التكرار.

### BR-COMP-101 — السطور تتجمد عند الإتمام

**التصنيف:** Invariant

بعد اكتمال Sale لا تتغير:

- Variant.
- Quantity.
- Unit.
- Prices.
- Discounts.
- Taxes.

### BR-COMP-102 — رقم المستند يخصص مرة واحدة

**التصنيف:** Invariant

لا يستهلك Retry رقم مستند جديد لنفس Sale.

### BR-COMP-103 — Completion لا تعتمد على الطباعة

**التصنيف:** Invariant

فشل Printer لا يعكس البيع المكتمل.

- تظهر حالة: البيع محفوظ والطباعة فشلت.
- يسمح بـReprint.

### BR-COMP-104 — Success response تشرح الحقيقة المحفوظة

**التصنيف:** Invariant

النتيجة يجب أن توضح:

- Sale identity.
- Invoice number.
- Payment state.
- Sync/server confirmation state.
- Printing state منفصلة.

## 21. Offline Sale

### BR-OFF-100 — Offline sale لها Idempotency key محلية دائمة

**التصنيف:** Invariant

لا تتغير Key عند:

- Restart.
- Retry.
- App update.
- Reconnect.

### BR-OFF-101 — Local commit ذرية

**التصنيف:** Invariant

حفظ Offline sale محليًا ينتج في Transaction واحدة:

- Sale snapshot.
- Lines.
- Payments المحلية.
- Outbox message.
- Status.

### BR-OFF-102 — الرسالة للمستخدم تفرق بين Saved وSynced

**التصنيف:** Invariant

الحالات الأساسية:

- محفوظة على الجهاز.
- في انتظار الإرسال.
- أُرسلت وتنتظر التأكيد.
- مؤكدة من الخادم.
- تحتاج تدخلًا.

### BR-OFF-103 — Cash مسموحة Offline ضمن Limits

**التصنيف:** Location Policy

يُسمح بالنقدي Offline عندما:

- Terminal وUser وShift cached وصالحون ضمن Offline lease.
- Catalog snapshot مقبولة.
- Stock policy تسمح.

### BR-OFF-104 — طرق الدفع الإلكترونية تتبع Capability فعلية

**التصنيف:** Invariant

لا تصف POS Card payment بأنها ناجحة Offline إلا إذا قدم Provider أوTerminal إثبات نجاح قابلًا للمطابقة.

### BR-OFF-105 — Offline validation conflicts لا تحذف البيع

**التصنيف:** Invariant

عند اكتشاف Conflict بعد Sync:

- لا تختفي العملية.
- تسجل الحالة والسبب.
- يحدد Recovery workflow: قبول استثناء، تعديل لاحق، أوتصحيح مرتبط.

### BR-OFF-106 — Offline limits قابلة للضبط

**التصنيف:** Location Policy

قد تشمل:

- أقصى مدة Offline.
- أقصى عدد مبيعات Pending.
- أقصى قيمة Sale.
- طرق الدفع المسموحة.
- أقصى عمر Catalog/price snapshot.

## 22. الإلغاء قبل الإتمام

### BR-CAN-100 — إلغاء Cart لا ينشئ أثرًا ماليًا

**التصنيف:** Invariant

Cart غير المكتملة يمكن إلغاؤها دون Invoice أوMovement، مع Audit عند الحاجة التشغيلية.

### BR-CAN-101 — إلغاء Payment Attempt لا يمحوها

**التصنيف:** Invariant

Attempt الملغاة تبقى في السجل بحالتها وسببها.

## 23. Void بعد الإتمام

### BR-VOID-100 — Void ليست Delete

**التصنيف:** Invariant

Void تحفظ:

- المستند الأصلي.
- من طلب الإبطال.
- السبب.
- وقت الإبطال.
- الموافقة عند الحاجة.
- الحركات العكسية.

### BR-VOID-101 — Void لها نافذة وسياسة

**التصنيف:** Tenant/Location Policy

قد تعتمد على:

- نفس الوردية.
- عدم إغلاق اليوم.
- عدم وجود Return لاحقة.
- حالة التسوية مع Provider.
- Permission.

### BR-VOID-102 — Void تعكس المخزون والمال بصورة مترابطة

**التصنيف:** Invariant

إذا كانت البضاعة لم تعد قابلة للإرجاع للمخزون، لا تستخدم Void عادية؛ تستخدم Return/Adjustment workflow مناسب.

### BR-VOID-103 — Void Payment إلكترونية تعتمد على Provider state

**التصنيف:** Invariant

- قبل settlement قد تكون Void/Cancel.
- بعد settlement تصبح Refund.
- لا يختار النظام المصطلح فقط؛ ينفذ العملية الصحيحة حسب Provider.

### BR-VOID-104 — Void Offline مكتملة الخادم ليست افتراضية

**التصنيف:** Open Decision

الاقتراح:

- لا يسمح بإبطال Server-confirmed sale Offline.
- يسمح بطلب Pending cancellation يراجع عند الاتصال فقط إذا كان نموذج العمل يحتاجه.

## 24. Refund والمدفوعات المرتجعة

### BR-RFD-100 — Refund لا تُنشأ بلا أصل

**التصنيف:** Invariant

Refund ترتبط بـ:

- Payment أصلية.
- Sale/Return/Correction source.
- مبلغ لا يتجاوز المتاح للاسترداد.

### BR-RFD-101 — مجموع Refund لا يتجاوز المحصل الصافي

**التصنيف:** Invariant

يحسب Refundable amount لكل Payment بعد خصم Refunds وReversals الناجحة السابقة.

### BR-RFD-102 — طريقة Refund تتبع الأصل افتراضيًا

**التصنيف:** Tenant Policy + Provider constraints

- Card تعاد إلى Card الأصلية عندما يتطلب Provider.
- Cash refund يؤثر على Drawer الحالي.
- التحويل لطريقة أخرى يحتاج Permission وReason وسياسة قانونية/تشغيلية واضحة.

### BR-RFD-103 — Refund وحركة المخزون منفصلتان لكن مرتبطتان

**التصنيف:** Invariant

قد توجد حالات:

- Return + Refund.
- Return + Store credit.
- Refund بدون عودة مخزون لخدمة أوتعويض.
- عودة مخزون بدون Refund فوري عند Exchange أوCredit.

لا يفترض أحدهما الآخر ضمنيًا.

### BR-RFD-104 — Refund failure لا تغير Return إلى مكتملة ماليًا

**التصنيف:** Invariant

إذا تم اعتماد Return وفشل Refund:

- تظهر Financial state pending/failed.
- لا تختفي Liability تجاه العميل.
- يوجد Recovery queue.

### BR-RFD-105 — Refund الإلكترونية قابلة للمطابقة

**التصنيف:** Invariant

تحفظ:

- Provider refund reference.
- Status.
- Attempt history.
- Reconciliation result.

## 25. Exchange

### BR-EXC-100 — الاستبدال ليس تعديلًا للفاتورة القديمة

**التصنيف:** Invariant

Exchange يتكون منطقيًا من:

- Return للمنتج القديم.
- Sale للمنتج الجديد.
- Settlement للفرق.

### BR-EXC-101 — فرق الاستبدال يعالج كتحصيل أوRefund

**التصنيف:** Invariant

- إذا الجديد أغلى: Payment للفرق.
- إذا الجديد أرخص: Refund أوCredit وفق السياسة.

### BR-EXC-102 — كل طرف يحتفظ بسعره التاريخي

**التصنيف:** Invariant

المرتجع يستخدم قواعد قيمة الاسترداد للمستند الأصلي، والجديد يستخدم سعره الحالي أوPolicy معتمدة.

## 26. الوردية والخزنة

### BR-SHF-100 — كل تحصيل نقدي يرتبط بالوردية الحالية

**التصنيف:** Invariant عند تفعيل shifts

يشمل:

- Sales cash.
- Later payment cash.
- Cash refund.
- Cash in/out.

### BR-SHF-101 — Payment إلكترونية تسجل في الوردية دون زيادة Drawer

**التصنيف:** Invariant

تظهر في Tender totals لكنها لا تدخل Cash expected balance.

### BR-SHF-102 — إغلاق الوردية يحتاج معالجة Pending

**التصنيف:** Open Decision

يجب اعتماد سياسة للحالات التالية:

- Offline sales غير متزامنة.
- Electronic payments Pending.
- Refund Pending.
- Unknown provider outcomes.

الخيارات:

- منع الإغلاق.
- السماح بإغلاق مشروط ونقل Exceptions.
- Supervisor override مع Audit.

### BR-SHF-103 — فروق الخزنة لا تعدل المبيعات

**التصنيف:** Invariant

Cash over/short تسجل كتسوية وردية مستقلة، ولا تغير قيم Invoices.

## 27. الأرقام والترقيم

### BR-NUM-100 — لكل Sale هوية تقنية عالمية

**التصنيف:** Invariant

الهوية التقنية لا تعتمد على رقم مطبوع قابل لإعادة التهيئة.

### BR-NUM-101 — رقم الفاتورة فريد داخل نطاق معتمد

**التصنيف:** Tenant Policy ضمن Legal Blueprint

يحدد النطاق مثل:

- Legal entity.
- Location.
- Fiscal device.
- Sequence/year.

### BR-NUM-102 — Offline numbering لا يسبب Collision

**التصنيف:** Invariant

التصميم يجب أن يستخدم:

- Allocated ranges.
- Terminal prefix.
- أوProvisional number ثمFiscal final number.

القرار النهائي يتبع المتطلبات القانونية والتشغيلية.

### BR-NUM-103 — الأرقام الملغاة لا يعاد استخدامها

**التصنيف:** Invariant

Gap في Sequence يُفسر بحالة Void/Cancelled أوAllocation record، ولا يعاد تدويره.

## 28. الإيصال والطباعة

### BR-RCP-100 — الإيصال يعكس Snapshot المستند

**التصنيف:** Invariant

Reprint تستخدم البيانات الأصلية، لا Product names أوTax names الحالية إذا تغيرت.

### BR-RCP-101 — Reprint لا تغير أي حالة

**التصنيف:** Invariant

الطباعة حدث Display/Output فقط، مع Audit اختياري لعدد النسخ.

### BR-RCP-102 — النسخة المعاد طباعتها يمكن تمييزها

**التصنيف:** Tenant/Legal Policy

عند الحاجة يظهر:

- Reprint.
- Copy number.
- Print timestamp.

### BR-RCP-103 — فشل الطباعة لا يكرر البيع

**التصنيف:** Invariant

الرسالة للمستخدم:

- البيع محفوظ.
- الطباعة فشلت.
- استخدم Reprint، ولا تعِد تسجيل البيع.

## 29. الصلاحيات والاعتمادات

### BR-AUTH-100 — Cashier لا يملك كل الاستثناءات افتراضيًا

**التصنيف:** Invariant

الصلاحيات الحساسة تشمل:

- Manual price override.
- Discount فوق الحد.
- Sell below cost.
- Negative stock override.
- Void.
- Refund.
- Alternate refund method.
- Credit sale.
- No-sale drawer open.

### BR-AUTH-101 — Approval لا تنسب للمستخدم الأصلي

**التصنيف:** Invariant

تسجل هوية:

- طالب الإجراء.
- الموافق.
- وقت الموافقة.
- السبب.

### BR-AUTH-102 — Offline approvals تحتاج نموذجًا صريحًا

**التصنيف:** Open Decision

الخيارات:

- منع الإجراءات التي تحتاج Approval Offline.
- Cached supervisor PIN بصلاحية محدودة ومدة قصيرة.
- Pre-authorized local limits.

لا تنفذ Override محلية غير قابلة للتتبع.

## 30. Audit وEvidence

### BR-AUD-100 — أحداث البيع الحرجة تُسجل

**التصنيف:** Invariant

تشمل:

- Cart completion initiated.
- Sale completed.
- Payment attempt.
- Payment succeeded/failed/pending/reversed.
- Manual price override.
- Discount override.
- Void requested/approved/completed.
- Refund requested/completed/failed.
- Reprint.
- Offline saved/sent/confirmed/conflicted.

### BR-AUD-101 — Audit لا تخزن بيانات دفع حساسة

**التصنيف:** Invariant

لا تخزن:

- Full card number.
- CVV.
- Secrets.
- Provider credentials.

### BR-AUD-102 — الدليل يربط Client وServer identities

**التصنيف:** Invariant

يجب ربط:

- Cart/client sale ID.
- Idempotency key.
- Server sale ID.
- Invoice number.
- Payment/provider references.

## 31. الأخطاء وسلوك الاسترداد

### BR-ERR-100 — الخطأ يوضح ما تم حفظه

**التصنيف:** Invariant

كل Failure حرجة تعرض:

- ماذا حدث.
- هل Sale محفوظة محليًا؟
- هل Payment ناجحة أوUnknown؟
- ما الذي لا يجب تكراره؟
- ما الخطوة التالية؟
- Reference ID.

### BR-ERR-101 — Unknown payment أعلى خطورة من Failed

**التصنيف:** Invariant

Unknown outcome يدخل Reconciliation queue ولا يسمح بتحصيل جديد دون Warning/Resolution.

### BR-ERR-102 — Recovery لا تستخدم تعديل Database مباشر

**التصنيف:** Invariant

يجب توفير Commands أوWorkflows معتمدة لـ:

- Retry sync.
- Reconcile payment.
- Reprint.
- Resume incomplete sale.
- Void/Refund.
- Escalate conflict.

## 32. التقارير والتسوية

### BR-REP-100 — Sales total وCollected total منفصلان

**التصنيف:** Invariant

التقارير تفرق بين:

- Gross sales.
- Discounts.
- Net sales.
- Taxes.
- Amount collected.
- Outstanding.
- Refunds.
- Net cash movement.

### BR-REP-101 — Tender report يعتمد على Payments

**التصنيف:** Invariant

لا يستنتج Cash/Card totals من Invoice total أوLabel يدوي.

### BR-REP-102 — Reconciliation تعرض الفروق

**التصنيف:** Invariant

تسوية Provider تقارن:

- Internal captured payments.
- Provider transactions.
- Refunds.
- Reversals.
- Fees عند دعمها.
- Missing/duplicate references.

### BR-REP-103 — وقت البيع ووقت التحصيل كلاهما محفوظ

**التصنيف:** Invariant

Later payments تظهر في فترة التحصيل الحالية مع الحفاظ على ارتباطها بفاتورة سابقة.

## 33. السيناريوهات الإلزامية للاختبار لاحقًا

1. Cash sale كاملة Online.
2. Cash sale Offline ثم Sync.
3. Retry لنفس Completion command.
4. Double-click على زر الدفع.
5. Printer failure بعد Completion.
6. Card success ثم Response timeout.
7. Card failed ثم Cash completion.
8. Split Cash + Card.
9. Discount line + invoice discount.
10. Discount يتجاوز الصلاحية.
11. Tax inclusive وexclusive.
12. Rounding allocation عبر عدة سطور.
13. Negative stock forbidden.
14. Negative stock override.
15. Void داخل الوردية.
16. Void بعد Provider settlement.
17. Partial return وpartial refund.
18. Refund failure بعد Return.
19. Exchange بقيمة أعلى وأقل.
20. Shift close مع Offline pending sales.
21. Duplicate provider reference.
22. POS restart قبل Sync acknowledgement.
23. Stale price snapshot Offline.
24. Credit sale فوق الحد عند دعمها.
25. Later payment في Shift مختلفة.

## 34. القرارات المفتوحة المطلوب حسمها

### OD-SAL-001 — هل البيع الكامل الدفع فقط هو Scope الإصدار الأول؟

**الاقتراح:** نعم. Credit sales وpartial receivables تؤجل حتى اعتماد Customer AR model.

### OD-SAL-002 — سياسة Negative stock الافتراضية

**الاقتراح:** Forbid، مع Override لصلاحية Supervisor وسبب إلزامي.

### OD-SAL-003 — أقصى عمر للأسعار Offline

يحدد بعد مقابلات السوق وتحليل نمط تغيير الأسعار.

### OD-SAL-004 — هل Promotions تعمل Offline؟

**الاقتراح:** فقط Rules محملة وموقعة ومحدودة التاريخ، دون Server-dependent coupons في الإصدار الأول.

### OD-SAL-005 — سياسة إغلاق الوردية مع Pending sales

**الاقتراح:** السماح بإغلاق مشروط بواسطة Supervisor، مع نقل Pending إلى Exception queue وعدم فقد ارتباطها بالوردية الأصلية.

### OD-SAL-006 — طرق الدفع الأولية

**الاقتراح:** Cash + Manual external card record أولًا، ثم Provider integrations تدريجيًا.

### OD-SAL-007 — Alternate refund method

**الاقتراح:** ممنوعة افتراضيًا، وتحتاج Supervisor permission وسبب عند الضرورة.

### OD-SAL-008 — Invoice numbering Offline

يُحسم بعد Legal/Fiscal Blueprint لمصر واختيار نموذج الأجهزة والفروع.

### OD-SAL-009 — Customer credit وStore credit

تؤجل إلى Ledger مالي مستقل، ولا تُبنى كحقل Balance بسيط.

### OD-SAL-010 — Cash rounding

غير مفعلة افتراضيًا، وتُضاف فقط إذا احتاجتها Currency أوسياسة العميل.

## 35. خارج النطاق حاليًا

- Recurring sales subscriptions داخل POS.
- Marketplace settlements.
- Multi-currency invoice واحدة.
- Cryptocurrency payments.
- Buy-now-pay-later integrations.
- Tips وgratuities.
- Complex loyalty points.
- Gift cards قبل تصميم Liability ledger.
- Fiscal integration خاصة بدولة قبل Legal Blueprint.
- Automatic dynamic pricing بالذكاء الاصطناعي.

## 36. Dependencies

هذه الوثيقة تغذي مباشرة:

- Sales State Machine.
- Payment State Machine.
- Return/Refund State Machine.
- Shift State Machine.
- Domain Model.
- Permission Matrix.
- Event Catalog.
- Audit Catalog.
- API Contract.
- Error Catalog.
- Sync وOffline Protocols.
- Database Blueprint.
- Reporting Model.

## 37. Acceptance Gate

لا تعتبر Sales & Payments planning مكتملة قبل:

1. حسم القرارات المفتوحة ذات الأولوية للإصدار الأول.
2. توافق قواعد الأسعار والخصومات والضرائب مع Product scope.
3. اعتماد طرق الدفع الأولية.
4. اعتماد Offline payment matrix.
5. اعتماد Void مقابل Return مقابل Refund.
6. اعتماد سياسة الوردية والـPending operations.
7. تحويل كل Rule حرجة إلى State transition أوConstraint أوPermission أوTest requirement لاحقًا.
8. عدم وجود Rule متعارضة مع Foundation Bible.

## 38. القرار التخطيطي الحالي

- Core البيع مبني على Full-payment retail sale أولًا.
- Offline لا تضعف Idempotency أوAudit.
- Price وDiscount وTax تحفظ كSnapshot كاملة.
- Payments لها Lifecycle مستقل عن Invoice.
- Unknown electronic payment تدخل Reconciliation ولا تعامل كفشل بسيط.
- Void وReturn وRefund عمليات مختلفة ولا تُستخدم كمترادفات.
- الائتمان وStore credit وGift cards لا تُنفذ كاختصارات قبل تصميم Ledgers الخاصة بها.