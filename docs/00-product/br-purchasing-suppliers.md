# ATHR Purchasing & Supplier Business Rules v1.0

**Planning Baseline — Purchasing, Receiving and Supplier Liability**

## 1. وظيفة الوثيقة

هذه الوثيقة هي المرجع التفصيلي لقواعد الموردين والمشتريات والاستلام وفواتير المورد والمدفوعات والمرتجعات إلى المورد.

تغطي:

- ملف المورد وحالته.
- طلبات الشراء الداخلية.
- عروض الأسعار والمقارنة.
- أوامر الشراء والموافقات.
- الأسعار والتكاليف والعملات.
- الشحن والرسوم والمصاريف الإضافية.
- الاستلام الكامل والجزئي.
- الفروق والتالف والرفض.
- فواتير المورد.
- Three-way matching.
- الالتزامات والمدفوعات.
- مرتجعات المورد.
- الإلغاء والإغلاق.
- الـOffline والصلاحيات والتدقيق.

لا تحدد هذه الوثيقة الجداول أوEndpoints، لكنها تمثل Business contract ملزمًا للتصميمات اللاحقة.

## 2. المصطلحات

### Supplier

جهة خارجية تزود Tenant بمنتجات أوخدمات أومصاريف مرتبطة بالشراء.

### Purchase Requisition

طلب داخلي للشراء يعبّر عن حاجة، ولا يمثل التزامًا مع المورد.

### Request for Quotation

طلب عروض أسعار من مورد أوأكثر قبل اختيار العرض.

### Supplier Quote

عرض مورد بتاريخ صلاحية وشروط وأسعار، ولا يعتبر أمر شراء معتمدًا.

### Purchase Order

تعهد شراء معتمد يحدد المورد والكميات والأسعار والشروط ومكان التسليم.

### Goods Receipt

مستند تشغيلي يثبت ما تم استلامه فعليًا في Warehouse محددة.

### Supplier Invoice

مطالبة مالية من المورد، منفصلة عن أمر الشراء والاستلام.

### Three-way Match

مطابقة بين:

- Purchase Order.
- Goods Receipt.
- Supplier Invoice.

### Landed Cost

تكلفة المخزون بعد توزيع مصاريف الشحن والجمارك والتأمين والمصاريف المؤهلة.

### Supplier Return

إرجاع بضائع للمورد بحركة مخزون والتزام مالي مرتبطين لكن منفصلين.

## 3. المبادئ غير القابلة للتفاوض

### BR-PUR-100 — الحاجة والالتزام والاستلام والفاتورة حقائق منفصلة

**التصنيف:** Invariant

لا تستخدم وثيقة واحدة بديلًا عن الأخرى:

```
Purchase Requisition
≠ Purchase Order
≠ Goods Receipt
≠ Supplier Invoice
≠ Supplier Payment
```

### BR-PUR-101 — لا مخزون من أمر شراء فقط

**التصنيف:** Invariant

اعتماد أوإرسال Purchase Order لا يزيد On-hand.

المخزون يزيد فقط عبر Goods Receipt معتمدة أوOpening/Adjustment source مصرح.

### BR-PUR-102 — لا التزام مالي نهائي من الاستلام وحده افتراضيًا

**التصنيف:** Invariant

Goods Receipt تثبت استلام البضاعة، لكن Supplier payable يتبع Supplier Invoice أوAccrual policy مستقلة.

### BR-PUR-103 — المستندات المعتمدة لا تُعدّل صامتًا

**التصنيف:** Invariant

بعد الاعتماد أوالإرسال:

- لا تتغير السطور الجوهرية مباشرة.
- التغيير يتم Revision أوAmendment أوCancel/replace.
- التاريخ السابق يبقى ظاهرًا.

### BR-PUR-104 — كل أثر مالي أومخزني يحدث مرة واحدة

**التصنيف:** Invariant

Retries أوduplicate uploads لا تكرر:

- Goods receipt movements.
- Supplier invoice liability.
- Supplier payments.
- Returns.
- Landed cost allocation.

### BR-PUR-105 — العملة والتكلفة والسعر التجاري منفصلة

**التصنيف:** Invariant

يجب الفصل بين:

- Supplier unit price.
- Discounts.
- Tax.
- Freight/charges.
- Accounting cost.
- Inventory valuation cost.
- Payment currency.

## 4. المورد

### BR-SUP-100 — المورد مملوك لـTenant واحد

**التصنيف:** Invariant

لا يشارك Supplier record تشغيليًا بين Tenants، حتى لو تشابه الاسم أوالمعرف الضريبي.

### BR-SUP-101 — المورد له حالة

**التصنيف:** Invariant

الحالات المبدئية:

- draft.
- active.
- on-hold.
- blocked.
- inactive.

### BR-SUP-102 — المورد غير النشط لا يستخدم في معاملات جديدة

**التصنيف:** Invariant

- يبقى ظاهرًا في التاريخ.
- لا ينشأ له PO أوInvoice أوPayment جديدة إلا بإعادة تنشيط مصرح.

### BR-SUP-103 — Blocking أقوى من Inactive

**التصنيف:** Invariant

Blocked supplier يمنع معاملات جديدة وقد يمنع الدفع أوالاستلام حسب سبب الحظر، مع Exception workflow واضح.

### BR-SUP-104 — أسباب الحظر موثقة

**التصنيف:** Permission Bound

الحظر يسجل:

- reason code.
- comment.
- actor.
- effective time.
- هل يمنع الشراء فقط أمكل العمليات.

### BR-SUP-105 — بيانات المورد الحساسة تخضع لصلاحيات

**التصنيف:** Permission Bound

تشمل:

- Bank details.
- Tax identifiers.
- Contracts.
- Payment terms.
- Credit limits.

### BR-SUP-106 — تغيير الحساب البنكي عالي الخطورة

**التصنيف:** Approval Bound

أي تغيير في Bank details يحتاج:

- maker-checker approval.
- تسجيل القيم القديمة والجديدة بصورة آمنة.
- فترة تحقق أوverification خارجية حسب السياسة.

### BR-SUP-107 — المورد المكرر لا يُدمج صامتًا

**التصنيف:** Invariant

الدمج لاحقًا يحتاج Workflow يحافظ على:

- كل المراجع.
- التاريخ.
- المسؤولية القانونية.
- External IDs.

## 5. عناوين وشروط المورد

### BR-SUP-110 — المورد قد يملك أكثر من عنوان

**التصنيف:** Invariant

مثل:

- Registered address.
- Remittance address.
- Pickup/return address.
- Warehouse address.

### BR-SUP-111 — شروط الدفع لها Snapshot

**التصنيف:** Invariant

Payment terms المستخدمة في PO أوInvoice تحفظ وقت إنشاء المستند، ولا تتغير بتعديل ملف المورد لاحقًا.

### BR-SUP-112 — العملة الافتراضية لا تمنع عملات أخرى مصرح بها

**التصنيف:** Tenant Policy

Supplier قد تكون له Default currency، لكن كل PO وInvoice تثبت عملتها صراحة.

### BR-SUP-113 — Tax profile لها Version

**التصنيف:** Invariant

أي Tax treatment للمورد أوالمشتريات يجب أن يحتفظ بالقاعدة المستخدمة وقت المستند.

## 6. طلب الشراء الداخلي

### BR-REQ-100 — Purchase Requisition لا تنشئ التزامًا خارجيًا

**التصنيف:** Invariant

هي طلب داخلي فقط، ولا ترسل للمورد كأمر ملزم.

### BR-REQ-101 — الطلب له طالب وسبب وScope

**التصنيف:** Invariant

يشمل:

- Requester.
- Tenant.
- Receiving location/warehouse المتوقع.
- Need-by date.
- Business reason.
- Items أوfree-text service lines.

### BR-REQ-102 — الطلب قد يبدأ بدون مورد

**التصنيف:** Invariant

يسمح بطلب الحاجة أولًا ثم اختيار المورد في Sourcing/PO stage.

### BR-REQ-103 — الكميات والأسعار في الطلب تقديرية

**التصنيف:** Invariant

لا تُستخدم كتكلفة نهائية أوحركة مخزون.

### BR-REQ-104 — الموافقة حسب القيمة والفئة

**التصنيف:** Tenant Policy + Approval Bound

Approval matrix قد تعتمد على:

- Estimated amount.
- Product category.
- Location.
- Requester role.
- Budget center لاحقًا.

### BR-REQ-105 — الطلب المعتمد يمكن تحويله جزئيًا

**التصنيف:** Invariant

قد ينشأ أكثر من PO من Requisition واحدة، مع تتبع الكمية المحولة والمتبقية.

### BR-REQ-106 — إغلاق الطلب لا يلغي أوامر الشراء الناتجة

**التصنيف:** Invariant

إغلاق المتبقي قرار مستقل ولا يعكس المستندات اللاحقة تلقائيًا.

## 7. عروض الأسعار والمقارنة

### BR-RFQ-100 — RFQ لا تمثل التزام شراء

**التصنيف:** Invariant

طلب السعر مرحلة Sourcing فقط.

### BR-RFQ-101 — العرض له فترة صلاحية

**التصنيف:** Invariant

Supplier Quote تحفظ:

- valid from/to.
- currency.
- quantities.
- unit prices.
- discounts.
- delivery terms.
- payment terms.
- freight/charges.

### BR-RFQ-102 — العرض المختار لا يعدل أصل العروض الأخرى

**التصنيف:** Invariant

تحفظ نتيجة المقارنة وسبب الاختيار.

### BR-RFQ-103 — الاختيار قد لا يكون الأرخص

**التصنيف:** Tenant Policy

يمكن التقييم حسب:

- السعر.
- وقت التسليم.
- الجودة.
- شروط الدفع.
- الحد الأدنى.
- موثوقية المورد.

### BR-RFQ-104 — اختيار عرض أعلى سعرًا يحتاج سببًا عند تجاوز حد

**التصنيف:** Approval Bound

يسجل reason وapprover عند تطبيق سياسة Best-value control.

## 8. أمر الشراء

### BR-PO-100 — PO لها مورد واحد وعملة واحدة

**التصنيف:** Invariant

لا تجمع Purchase Order بين أكثر من Supplier أوCurrency.

### BR-PO-101 — PO لها Receiving scope واضح

**التصنيف:** Invariant

يجب تحديد:

- Receiving warehouse أوdestination.
- Expected delivery date أوschedule.
- Buyer/requester.
- Legal entity عند دعمها.

### BR-PO-102 — السطر يثبت المنتج ووحدة الشراء

**التصنيف:** Invariant

كل سطر يحتوي:

- Product/Variant أوservice description.
- Purchase UOM.
- Conversion to stock UOM إن وجدت.
- Ordered quantity.
- Unit price.
- Tax/discount basis.

### BR-PO-103 — Draft لا يمثل التزامًا

**التصنيف:** Invariant

يمكن تعديله أوحذفه منطقيًا قبل Submission وفق الصلاحيات، دون أثر مخزني أومالي.

### BR-PO-104 — Approval يجمد السطور التجارية

**التصنيف:** Invariant

بعد Approval:

- لا تعديل مباشر للمورد أوالكمية أوالسعر أوالعملة.
- التغيير يحتاج Amendment/Revision.

### BR-PO-105 — الإرسال للمورد حدث مستقل

**التصنيف:** Invariant

الحالات المبدئية تفرق بين:

- approved.
- issued/sent.
- acknowledged عند دعمها.

### BR-PO-106 — Approval limits تحسب على Total واضح

**التصنيف:** Tenant Policy

يحدد إن كانت الحدود تعتمد على:

- Net before tax.
- Gross including tax.
- Base currency equivalent.
- Total committed including charges.

### BR-PO-107 — PO لا تُعتمد من منشئها وحده فوق الحدود

**التصنيف:** Approval Bound

يدعم Segregation of Duties حسب حجم العميل.

### BR-PO-108 — Self-approval سياسة صريحة

**التصنيف:** Tenant Policy

الافتراضي المقترح:

- ممنوع فوق حد معين.
- ممكن للقيم الصغيرة عند تفعيلها.

### BR-PO-109 — رقم PO لا يعاد استخدامه

**التصنيف:** Invariant

الملغي أوالمنتهي يحتفظ برقمه وحالته.

## 9. تعديلات أمر الشراء

### BR-POA-100 — Amendment تنشئ Revision

**التصنيف:** Invariant

يحفظ النظام:

- Previous revision.
- New revision.
- Changed fields.
- reason.
- actor.
- approval.

### BR-POA-101 — لا تخفيض تحت المستلم

**التصنيف:** Invariant

لا يمكن تعديل Ordered quantity إلى أقل من Received quantity المعتمدة.

### BR-POA-102 — لا تخفيض تحت المفوتر عند تطبيق matching

**التصنيف:** Invariant

لا يمكن خفض Commit إلى أقل من كمية/قيمة Supplier invoices المعتمدة دون Credit note أوCorrection workflow.

### BR-POA-103 — تغيير السعر بعد الاستلام لا يعيد تقييم الماضي صامتًا

**التصنيف:** Invariant

أي أثر على التكلفة أوالفاتورة يعالج Adjustment أوInvoice variance، ولا يغير Receipt القديمة بلا أثر.

### BR-POA-104 — تعديل المورد يحتاج PO جديدة

**التصنيف:** Invariant

لا يبدل Supplier داخل PO معتمدة؛ تلغى المتبقي ويصدر مستند جديد.

## 10. حالات أمر الشراء

### BR-POST-100 — الحالة مشتقة من Lifecycle حقيقي

**التصنيف:** Invariant

الحالات المقترحة:

- draft.
- submitted.
- approved.
- issued.
- partially received.
- fully received.
- partially invoiced.
- fully invoiced.
- closed.
- cancelled.

قد تستخدم أبعاد حالة منفصلة بدل Enum واحد لتجنب التضارب:

- Approval status.
- Receipt status.
- Invoice status.
- Closure status.

### BR-POST-101 — الإغلاق يختلف عن الاكتمال

**التصنيف:** Invariant

- Fully received لا يعني Fully invoiced.
- Fully invoiced لا يعني Fully paid.
- Closed يعني عدم توقع نشاط إضافي بعد معالجة الفروق.

### BR-POST-102 — إغلاق المتبقي يحتاج سببًا

**التصنيف:** Permission Bound

عند Short close تسجل الكميات/القيم غير المنفذة والسبب.

## 11. الأسعار والخصومات والضرائب

### BR-PP-100 — سعر المورد يثبت داخل سطر PO

**التصنيف:** Invariant

تغيير Supplier catalog لاحقًا لا يغير PO المعتمدة.

### BR-PP-101 — الخصم له نوع وأساس

**التصنيف:** Invariant

مثل:

- percentage.
- fixed line discount.
- order-level discount موزع حتميًا.
- rebate مؤجل خارج تكلفة الاستلام حتى اعتماده.

### BR-PP-102 — Free goods لا تُخزن كسعر سلبي

**التصنيف:** Invariant

السلعة المجانية تسجل بكمية وسعر/تكلفة معالجة صريحة وفق valuation policy، لا بسطر عشوائي سالب.

### BR-PP-103 — Tax snapshot مستقلة عن سعر المورد

**التصنيف:** Invariant

يجب حفظ Tax code/rate/base/version وقت المستند.

### BR-PP-104 — شروط السعر قد تعتمد على الكمية

**التصنيف:** Tenant Policy

Quantity breaks تحفظ كRule أوQuote source، لكن PO تثبت السعر النهائي المستخدم.

## 12. العملات وأسعار الصرف

### BR-FX-100 — PO وSupplier Invoice لكل منهما Currency ثابتة

**التصنيف:** Invariant

لا تتغير Currency بعد اعتماد المستند.

### BR-FX-101 — Base currency equivalent محفوظ

**التصنيف:** Invariant عند Multi-currency

يحفظ:

- document currency.
- exchange rate.
- rate source.
- rate date.
- base currency amounts.

### BR-FX-102 — فروق العملة لا تعدل كمية المخزون

**التصنيف:** Invariant

تعالج في التكلفة أوالحسابات المالية حسب policy، وليس كMovement quantity.

### BR-FX-103 — Rate override يحتاج صلاحية

**التصنيف:** Permission Bound

يسجل السعر القياسي والمستخدم والسبب.

## 13. الشحن والرسوم والتكلفة الواصلة

### BR-LC-100 — المصاريف الإضافية منفصلة عن سعر الوحدة

**التصنيف:** Invariant

مثل:

- freight.
- insurance.
- customs.
- handling.
- inspection.
- brokerage.

### BR-LC-101 — المصروف يحدد هل هو Inventory cost أمPeriod expense

**التصنيف:** Accounting Policy

لا تضاف كل Charge تلقائيًا إلى تكلفة المخزون.

### BR-LC-102 — Landed cost allocation حتمية

**التصنيف:** Invariant

طرق التوزيع الممكنة:

- quantity.
- weight.
- volume.
- line value.
- manual controlled allocation.

### BR-LC-103 — لا توزيع على سطور غير مؤهلة

**التصنيف:** Invariant

كل Charge تحدد scope والسطور المستفيدة.

### BR-LC-104 — التوزيع المتأخر لا يمحو التكلفة السابقة

**التصنيف:** Invariant

ينشأ Cost adjustment مع أثر زمني واضح، خصوصًا إن بيع جزء من المخزون.

### BR-LC-105 — Manual allocation تحتاج تحقق إجمالي

**التصنيف:** Invariant

مجموع التوزيعات يجب أن يساوي قيمة Charge ضمن فرق التقريب المسموح.

## 14. إشعار الشحن

### BR-ASN-100 — Advance Shipment Notice لا يزيد المخزون

**التصنيف:** Invariant

هو توقع للشحنة فقط.

### BR-ASN-101 — ASN يمكن أن تغطي PO واحدة أوأكثر وفق التصميم

**التصنيف:** Open Decision

الافتراضي الأبسط للإصدار الأول: ASN مرتبطة بـPO واحدة.

### BR-ASN-102 — الكميات المشحونة لا تعني مستلمة

**التصنيف:** Invariant

تظهر Expected/In-transit supplier quantities منفصلة عن On-hand.

## 15. الاستلام

### BR-GR-100 — Receipt تحدث في Warehouse محددة

**التصنيف:** Invariant

لا توجد Receipt عامة بلا Destination stock scope.

### BR-GR-101 — الاستلام يثبت ما وصل فعليًا

**التصنيف:** Invariant

لا ينسخ Ordered quantity تلقائيًا دون تأكيد المستخدم أوScan/Count.

### BR-GR-102 — Receipt المعتمدة تنشئ Inventory movements مرة واحدة

**التصنيف:** Invariant

Retry لا يكرر الزيادة.

### BR-GR-103 — Draft receipt لا تزيد On-hand

**التصنيف:** Invariant

الحركة تنشأ عند Confirm/Post، لا أثناء العد.

### BR-GR-104 — الاستلام الجزئي مدعوم

**التصنيف:** Invariant

PO line تتتبع:

- ordered.
- received accepted.
- rejected.
- returned.
- remaining open.

### BR-GR-105 — لا تجاوز للكمية بدون Policy

**التصنيف:** Tenant Policy + Approval Bound

Over-receipt options:

- forbid.
- allow within tolerance.
- require approval فوق tolerance.

### BR-GR-106 — الاستلام غير المرتبط بـPO مقيد

**التصنيف:** Tenant Policy + Permission Bound

الافتراضي المقترح:

- منع Blind receipt.
- السماح Emergency receipt مع سبب وموافقة، ثم إنشاء matching exception.

### BR-GR-107 — هوية المستلم الفعلية محفوظة

**التصنيف:** Invariant

تسجل:

- receiver.
- warehouse.
- time.
- device/session.
- supplier delivery reference.

### BR-GR-108 — Supplier delivery reference لا تتكرر صامتًا

**التصنيف:** Invariant

يظهر تحذير أوBlock عند تكرار نفس Delivery note للمورد وفق Policy.

## 16. جودة الاستلام

### BR-QC-100 — المستلم والمقبول قد يختلفان

**التصنيف:** Invariant

يتم الفصل بين:

- quantity received physically.
- quantity accepted to available stock.
- quantity rejected.
- quantity quarantined.

### BR-QC-101 — Quarantined ليست Available

**التصنيف:** Invariant

لا تباع أوتستهلك حتى Release.

### BR-QC-102 — الرفض يحتاج Reason

**التصنيف:** Invariant

أمثلة:

- damaged.
- wrong item.
- wrong quantity.
- expired/near expiry.
- quality failure.
- packaging issue.

### BR-QC-103 — القرار بعد الحجر موثق

**التصنيف:** Permission Bound

المخرجات:

- release to available.
- return to supplier.
- scrap/damage.
- rework عند دعمها.

### BR-QC-104 — المنتج المسلسل أوBatch يحتاج Capture قبل الاعتماد

**التصنيف:** Capability Policy

عند تفعيل Serial/Batch tracking، لا تعتمد Receipt ناقصة بيانات التتبع المطلوبة.

## 17. فروق الاستلام

### BR-RCV-100 — الفرق لا يُخفى بتعديل PO

**التصنيف:** Invariant

Shortage أوOverage أوWrong item يسجل Discrepancy مستقلة.

### BR-RCV-101 — الفروق لها Owner وحالة

**التصنيف:** Invariant

الحالات المقترحة:

- open.
- under review.
- supplier accepted.
- internally accepted.
- credit expected.
- replacement expected.
- resolved.

### BR-RCV-102 — الاستلام الخطأ لا يصحح Delete

**التصنيف:** Invariant

التصحيح يتم:

- receipt reversal إن لم يتحرك المخزون لاحقًا.
- supplier return.
- inventory adjustment مرتبط.

### BR-RCV-103 — Reversal لا تتجاوز المتاح للعكس

**التصنيف:** Invariant

لا يمكن عكس Quantity سبق بيعها أوتحويلها دون Recovery workflow.

## 18. فاتورة المورد

### BR-AP-100 — Supplier Invoice منفصلة عن PO وReceipt

**التصنيف:** Invariant

قد تصل:

- قبل الاستلام.
- بعده.
- جزئية.
- مجمعة.

لكن حالتها ومطابقتها تبقيان مستقلتين.

### BR-AP-101 — رقم فاتورة المورد فريد ضمن Supplier ونطاق قانوني

**التصنيف:** Invariant

Duplicate invoice detection يجب أن يستخدم أكثر من رقم فقط عند الحاجة:

- Supplier.
- Invoice number.
- date.
- amount.
- currency.

### BR-AP-102 — Draft invoice لا تنشئ Liability نهائية

**التصنيف:** Invariant

الالتزام ينشأ عند Posting/Approval حسب Accounting policy.

### BR-AP-103 — Invoice lines تحدد Source

**التصنيف:** Invariant

يمكن أن ترتبط بـ:

- PO line.
- Receipt line.
- Charge/service.
- Non-PO expense مصرح.

### BR-AP-104 — الفاتورة المعتمدة Immutable

**التصنيف:** Invariant

التصحيح عبر:

- Supplier credit note.
- Debit note.
- cancellation/reversal وفق الفترة والحالة.

### BR-AP-105 — Due date مشتقة وقابلة للتفسير

**التصنيف:** Invariant

تحسب من:

- Invoice date أوreceipt date حسب terms.
- Payment terms snapshot.
- approved override مع reason.

### BR-AP-106 — Non-PO invoice مقيدة

**التصنيف:** Tenant Policy + Approval Bound

تحتاج:

- Expense category.
- cost center لاحقًا.
- approval.
- reason for no PO.

## 19. Three-way matching

### BR-MAT-100 — المطابقة تقارن حقائق مختلفة

**التصنيف:** Invariant

تقارن:

- Ordered quantity/price.
- Accepted received quantity.
- Invoiced quantity/price.

### BR-MAT-101 — Tolerances صريحة

**التصنيف:** Tenant Policy

قد تشمل:

- quantity tolerance.
- unit price tolerance.
- total amount tolerance.
- freight/tax tolerance.

### BR-MAT-102 — داخل tolerance لا يعني بلا Audit

**التصنيف:** Invariant

تسجل نتيجة المطابقة حتى لو Auto-approved.

### BR-MAT-103 — خارج tolerance يدخل Exception

**التصنيف:** Invariant

لا يُدفع تلقائيًا قبل Resolution أوApproval.

### BR-MAT-104 — Quantity match تعتمد المقبول لا الفيزيائي فقط

**التصنيف:** Invariant

Rejected/Quarantined quantity لا تعتبر مستلمة نهائيًا للدفع إلا وفق Contract وسياسة.

### BR-MAT-105 — Price variance لا تعدل PO القديمة

**التصنيف:** Invariant

تعالج ك:

- supplier correction.
- approved variance.
- PO amendment قبل posting إن كان مسموحًا.

### BR-MAT-106 — Invoice قبل Receipt تبقى Pending match

**التصنيف:** Invariant

لا تعامل كخطأ نهائي ما دام التسلسل التجاري يسمح بها.

### BR-MAT-107 — Partial invoice تطابق جزئيًا

**التصنيف:** Invariant

يحفظ matched والمتبقي لكل Line.

## 20. Credit Notes وDebit Notes

### BR-CN-100 — Supplier Credit Note لها Source

**التصنيف:** Invariant

ترتبط بـ:

- Supplier Invoice.
- Return.
- Price correction.
- Rebate approved.

### BR-CN-101 — Credit لا تحذف Liability الأصلية

**التصنيف:** Invariant

تسجل حركة عكس/تخفيض مستقلة.

### BR-CN-102 — Unapplied credit تظهر منفصلة

**التصنيف:** Invariant

لا تختفي داخل Supplier balance دون Allocation واضح.

### BR-DN-100 — Debit note مطالبة على المورد وليست Payment

**التصنيف:** Invariant

تستخدم عند نقص أوتالف أوتكاليف مستردة حسب السياسة القانونية.

## 21. التزام المورد

### BR-LIA-100 — Liability تتبع المستند المالي

**التصنيف:** Invariant

Supplier payable ينشأ من Invoice posted أوAccrual معتمد، لا من PO فقط.

### BR-LIA-101 — Supplier balance قابل للتفسير

**التصنيف:** Invariant

يتكون من:

- Posted invoices.
- Credit/debit notes.
- Payments.
- Allocations.
- Adjustments المصرح بها.

### BR-LIA-102 — لا تعديل مباشر للرصيد

**التصنيف:** Invariant

أي تصحيح يتم بمستند مالي مرتبط.

## 22. مدفوعات المورد

### BR-SPAY-100 — Payment للمورد لها هوية مستقلة

**التصنيف:** Invariant

تحفظ:

- Supplier.
- amount.
- currency.
- method.
- bank/cash account reference.
- status.
- actor/approver.
- external reference.
- idempotency identity.

### BR-SPAY-101 — Approval وExecution مرحلتان منفصلتان عند الحاجة

**التصنيف:** Tenant Policy + Approval Bound

يمكن أن تكون الحالات:

- draft.
- submitted.
- approved.
- scheduled.
- processing.
- completed.
- failed.
- cancelled.
- reversed.

### BR-SPAY-102 — من ينشئ الدفع لا ينفذه منفردًا فوق الحدود

**التصنيف:** Approval Bound

Maker-checker للمدفوعات الحساسة.

### BR-SPAY-103 — الدفع لا يثبت الفاتورة تلقائيًا بلا Allocation

**التصنيف:** Invariant

قد يكون:

- allocated to invoices.
- advance payment.
- unapplied payment.

### BR-SPAY-104 — مجموع Allocation لا يتجاوز Payment

**التصنيف:** Invariant

والفاتورة لا تُخصص بأكثر من Outstanding amount.

### BR-SPAY-105 — Advance payment قدرة صريحة

**التصنيف:** Tenant Policy

لا تعامل الدفعة المقدمة كمصروف أوتكلفة مخزون حتى تخصيصها وفق السياسة.

### BR-SPAY-106 — Failed/Unknown bank outcome يحتاج Reconciliation

**التصنيف:** Invariant

لا يعاد الدفع مباشرة عند Unknown outcome دون تحقق.

### BR-SPAY-107 — تغيير Bank details قبل الدفع يولد Warning

**التصنيف:** Invariant

يتطلب تحققًا إضافيًا عند التغيير الحديث أوغير الموافق عليه.

## 23. مرتجع المورد

### BR-SRT-100 — Supplier Return عملية مستقلة

**التصنيف:** Invariant

لا تعدل Receipt الأصلية صامتًا.

### BR-SRT-101 — المرتجع يحتاج Source

**التصنيف:** Invariant

يرتبط بـ:

- Goods receipt.
- Quarantine decision.
- Inventory batch/serial عند التفعيل.
- Discrepancy.

### BR-SRT-102 — الكمية المرتجعة لا تتجاوز القابلة للإرجاع

**التصنيف:** Invariant

تحسب بعد:

- الكمية المستلمة والمقبولة.
- السابق إرجاعه.
- المتاح في المخزن.
- أي قيود Serial/Batch.

### BR-SRT-103 — Approval لا يحرك المخزون

**التصنيف:** Invariant

الحركة تحدث عند Shipment/Dispatch للمورد.

### BR-SRT-104 — الشحن للمورد يخرج المخزون مرة واحدة

**التصنيف:** Invariant

وقد ينتقل إلى Return-in-transit إذا احتاج النموذج.

### BR-SRT-105 — الأثر المالي منفصل

**التصنيف:** Invariant

Supplier return قد ينتج:

- Credit note.
- Replacement.
- Repair.
- No-credit write-off باتفاق خاص.

### BR-SRT-106 — Replacement لا يزيد المخزون قبل وصوله

**التصنيف:** Invariant

يعالج كShipment/Receipt جديدة مرتبطة بالمرتجع.

### BR-SRT-107 — المرتجع من Quarantine لا يدخل Available أولًا

**التصنيف:** Invariant

يمكن شحنه مباشرة من حالة Quarantined وفق Workflow مصرح.

## 24. الإلغاء والإغلاق

### BR-PCAN-100 — Draft يمكن إلغاؤها دون أثر نهائي

**التصنيف:** Invariant

مع الاحتفاظ بـAudit عند وجود Submission أوApproval history.

### BR-PCAN-101 — PO مع Receipt لا تُلغى بالكامل

**التصنيف:** Invariant

يمكن Close/Cancel remaining quantity فقط.

### BR-PCAN-102 — PO مع Invoice لا تُلغى دون معالجة مالية

**التصنيف:** Invariant

تحتاج Credit/Correction أوإغلاق متبقٍ حسب الحالة.

### BR-PCAN-103 — Receipt posted لا تُحذف

**التصنيف:** Invariant

تُعكس أويُنشأ Supplier return وفق حالة المخزون.

### BR-PCAN-104 — Supplier Invoice posted لا تُحذف

**التصنيف:** Invariant

تُعكس قانونيًا وماليًا بمستند مناسب.

## 25. Offline behavior

### BR-POFF-100 — إنشاء Draft داخلي قد يعمل Offline لاحقًا

**التصنيف:** Deferred Capability

لكن لا Approval أوإرسال للمورد دون Server confirmation في الإصدار الأول.

### BR-POFF-101 — الاستلام المعقد Online-required أولًا

**التصنيف:** Planning Decision

الإصدار الأول يجعل:

- PO approval.
- Goods receipt posting.
- Supplier invoice posting.
- Payments.
- Supplier returns dispatch.

عمليات Online-required.

### BR-POFF-102 — Offline scan mode لا يساوي Receipt posted

**التصنيف:** Deferred Capability

يمكن جمع counts محليًا ثم مراجعتها وإرسالها، لكن المخزون لا يزيد قبل Server validation/posting.

### BR-POFF-103 — Retry لا يكرر Receipt أوInvoice

**التصنيف:** Invariant

كل Posting command لها Idempotency identity.

## 26. الصلاحيات والفصل بين الواجبات

### BR-PRA-100 — الصلاحيات منفصلة حسب المرحلة

**التصنيف:** Invariant

مثل:

- create requisition.
- approve requisition.
- create PO.
- approve PO.
- receive goods.
- approve quality release.
- enter supplier invoice.
- approve variance.
- create payment.
- approve payment.
- execute payment.
- return to supplier.

### BR-PRA-101 — Buyer لا يغير Receipt فعلية دون صلاحية

**التصنيف:** Invariant

المستلم يسجل الحقيقة الفيزيائية، ولا تُعدل لتطابق PO شكليًا.

### BR-PRA-102 — Receiver لا يعتمد Payment

**التصنيف:** Segregation Policy

تطبق حسب حجم Tenant وخطته.

### BR-PRA-103 — Override يحتاج سببًا

**التصنيف:** Invariant

يشمل:

- over-receipt.
- price variance.
- quantity variance.
- non-PO invoice.
- blocked supplier exception.
- alternate bank details.

## 27. Audit وEvents

### BR-PAUD-100 — الأحداث الحرجة مسجلة

**التصنيف:** Invariant

تشمل:

- Supplier created/blocked/bank details changed.
- Requisition submitted/approved/rejected.
- PO approved/issued/amended/closed/cancelled.
- Receipt drafted/posted/reversed.
- Quality accepted/rejected/quarantined/released.
- Discrepancy opened/resolved.
- Supplier invoice posted/matched/blocked.
- Payment approved/executed/failed/reversed.
- Supplier return approved/dispatched/resolved.

### BR-PAUD-101 — Snapshot القيم التجارية محفوظة

**التصنيف:** Invariant

الأحداث والمستندات تحفظ ما يلزم لإثبات السعر والكمية والعملات والشروط وقت القرار.

### BR-PAUD-102 — البيانات البنكية الحساسة لا تظهر كاملة في Audit

**التصنيف:** Invariant

يستخدم Masking وsecure access.

## 28. الأخطاء والاسترداد

### BR-PERR-100 — فشل الاستلام يوضح ما تم Postه

**التصنيف:** Invariant

لا يطلب من المستخدم إعادة العملية بلا معرفة هل المخزون تحرك.

### BR-PERR-101 — Unknown payment outcome يدخل Reconciliation

**التصنيف:** Invariant

لا ينشأ Payment ثانية تلقائيًا.

### BR-PERR-102 — Matching exception لها Queue

**التصنيف:** Invariant

تظهر:

- سبب الفرق.
- المستندات المرتبطة.
- القيم المتوقعة والفعلية.
- Owner.
- خيارات الحل.

### BR-PERR-103 — لا Recovery عبر Direct SQL

**التصنيف:** Invariant

توفر Workflows لـ:

- reverse receipt.
- reopen matching.
- reallocate payment.
- issue credit/debit note.
- close remaining quantity.
- resolve duplicate invoice.

## 29. التقارير

### BR-PREP-100 — الالتزامات تختلف عن الالتزام الشرائي

**التصنيف:** Invariant

تقارير منفصلة لـ:

- Open PO commitments.
- Goods received not invoiced.
- Invoices pending receipt.
- Posted supplier liabilities.
- Payments due.

### BR-PREP-101 — Open PO quantity قابلة للتفسير

**التصنيف:** Invariant

```
Ordered
- cancelled/closed remaining
- accepted received
= open quantity
```

مع معالجة rejected/replacement وفق السياسة.

### BR-PREP-102 — Supplier performance تعتمد أحداثًا فعلية

**التصنيف:** Invariant

مثل:

- on-time delivery.
- fill rate.
- quality rejection rate.
- price variance.
- invoice accuracy.
- dispute resolution time.

### BR-PREP-103 — Purchase spend لا يساوي Cash paid

**التصنيف:** Invariant

التقارير تفرق بين Ordered وReceived وInvoiced وPaid.

## 30. السيناريوهات الإلزامية للاختبار لاحقًا

1. Requisition → approval → PO.
2. PO approval فوق وتحت حد السلطة.
3. PO amendment قبل الاستلام.
4. منع تخفيض الكمية تحت المستلم.
5. Partial receipt.
6. Over-receipt داخل tolerance.
7. Over-receipt فوق tolerance.
8. Rejected وQuarantined quantities.
9. Release من Quarantine.
10. Duplicate delivery reference.
11. Retry لنفس Receipt posting.
12. Supplier invoice قبل Receipt.
13. Partial invoice.
14. Duplicate supplier invoice.
15. Price variance داخل tolerance.
16. Price variance خارج tolerance.
17. Quantity variance.
18. Non-PO invoice.
19. Landed cost allocation.
20. Late landed cost بعد بيع جزء من المخزون.
21. Supplier payment allocated.
22. Advance payment.
23. Unknown bank payment outcome.
24. Supplier return ثمCredit note.
25. Replacement بعد return.
26. Short close PO.
27. Blocked supplier exception.
28. Bank details change قبل Payment.
29. Receipt reversal مع مخزون ما زال متاحًا.
30. منع reversal بعد بيع المخزون.

## 31. القرارات المفتوحة

### OD-PUR-001 — هل Purchase Requisition ضمن الإصدار الأول؟

**الاقتراح:** نعم بشكل بسيط للمتاجر التي تحتاج Approval، مع إمكانية تعطيله للمتاجر الصغيرة.

### OD-PUR-002 — هل RFQ والمقارنة ضمن MVP؟

**الاقتراح:** تؤجل إلى ما بعد Pilot؛ يبدأ MVP بـPO مباشرة مع Supplier quote attachment/reference.

### OD-PUR-003 — Three-way matching مستوى الإطلاق

**الاقتراح:** Matching أساسي بالكمية والسعر مع tolerances، دون Accounting automation معقدة في البداية.

### OD-PUR-004 — Non-PO invoices

**الاقتراح:** السماح بها للخدمات والمصاريف فقط، بصلاحية وموافقة؛ المنتجات المخزنية تحتاج PO أوEmergency receipt workflow.

### OD-PUR-005 — Over-receipt tolerance

**الاقتراح:** صفر افتراضيًا، مع Tenant policy تسمح بنسبة صغيرة واعتماد لما فوقها.

### OD-PUR-006 — Costing method

يُحسم في Inventory Costing Blueprint؛ الاقتراح الأول Weighted Average لكل Variant/Warehouse أوTenant حسب النموذج المختار.

### OD-PUR-007 — Landed cost في MVP

**الاقتراح:** دعم Charges وتوزيع بالقيمة أوالكمية، وتأجيل الجمارك المعقدة والتوزيع متعدد الشحنات.

### OD-PUR-008 — Supplier payments داخل أثر

**الاقتراح:** تسجيل وإدارة الحالة في الإصدار الأول، دون تنفيذ تحويل بنكي مباشر حتى Security/Bank integration blueprint.

### OD-PUR-009 — Goods received not invoiced accrual

تحتاج Accounting Blueprint؛ لا تُفترض كقيد محاسبي كامل قبل تصميم دفتر الأستاذ.

### OD-PUR-010 — Multi-currency purchasing

**الاقتراح:** التصميم يستوعبها، لكن Pilot يبدأ بعملة تشغيل أساسية واحدة إن أمكن.

### OD-PUR-011 — Quality inspection

**الاقتراح:** Accept/Reject/Quarantine أساسي، وتأجيل خطط فحص تفصيلية ومعايير مخبرية.

### OD-PUR-012 — Supplier portal

**القرار:** خارج MVP؛ التواصل خارجي مع حفظ References وattachments لاحقًا.

## 32. خارج النطاق حاليًا

- Supplier marketplace.
- Automated procurement bidding.
- Manufacturing MRP.
- Contract lifecycle management كامل.
- Global trade compliance engine.
- Customs declaration automation.
- Direct bank payment execution.
- Dynamic supplier financing.
- Complex rebate programs.
- Consignment inventory قبل Blueprint مستقل.
- Drop-shipping قبل Order/Fulfillment Blueprint.

## 33. Dependencies

هذه الوثيقة تغذي:

- Supplier Domain Model.
- Purchasing State Machines.
- Receiving State Machine.
- Supplier Invoice and Payment State Machines.
- Inventory movements.
- Costing model.
- Permission Matrix.
- Event and Audit Catalogs.
- API and Error Contracts.
- Database Blueprint.
- Reporting Model.
- Accounting integration boundary.

## 34. Acceptance Gate

لا تعتبر Purchasing planning مكتملة قبل:

1. اعتماد Scope الـMVP بين Requisition وRFQ وPO.
2. اعتماد Approval matrix model.
3. اعتماد Over/under receipt tolerances.
4. اعتماد Three-way matching policy.
5. اعتماد Supplier invoice وNon-PO rules.
6. اعتماد Supplier payment scope.
7. اعتماد Costing وLanded cost boundaries.
8. ربط كل Stock effect بـInventory Rule ID.
9. عدم وجود تعديل مباشر لمستندات Posted/Approved.
10. تحويل كل Rule حرجة إلى State transition أوPermission أوConstraint أوTest requirement لاحقًا.

## 35. القرار التخطيطي الحالي

- PO والاستلام والفاتورة والدفع كيانات منفصلة.
- PO لا تزيد المخزون ولا تنشئ Liability نهائية وحدها.
- الاستلام الجزئي والرفض والحجر مدعومة.
- Three-way matching أساسية مطلوبة، مع Tolerances قابلة للتهيئة.
- Supplier return لا تعدل Receipt القديمة، والأثر المالي ينتظر Credit/Resolution مستقلًا.
- العمليات الحرجة للمشتريات Online-required في الإصدار الأول.
- Supplier payments تسجل وتراجع داخل أثر أولًا، بينما تنفيذ التحويل البنكي المباشر مؤجل.
- RFQ وSupplier portal خارج MVP ما لم تثبت المقابلات أولوية مختلفة.