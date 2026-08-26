# ATHR Inventory & Stock Business Rules v1.0

**Planning Baseline — Inventory Truth Must Be Explainable**

## 1. وظيفة الوثيقة

هذه الوثيقة هي المرجع التفصيلي لقواعد المخزون في أثر.

تغطي:

- معنى الرصيد وحالات الكمية.
- Inventory Ledger وحركات المخزون.
- البيع والمرتجع وتأثيرهما المخزني.
- الاستلام من المورد.
- التحويل بين المخازن والفروع.
- المخزون أثناء النقل.
- الاستلام الجزئي والفروق.
- الحجز.
- التالف والمفقود والحجر.
- الجرد والتسويات.
- الرصيد الافتتاحي وترحيل البيانات.
- العمل دون اتصال.
- التكلفة والتقييم على مستوى القواعد التجارية.
- الصلاحيات والتدقيق والتقارير والاسترداد.

لا تحدد الوثيقة الجداول أوالـAPI، لكنها Contract أعلى يجب أن يطابقه Domain Model والـState Machines والـDatabase Blueprint.

## 2. تصنيف القرارات

- **Invariant:** قاعدة لا يجوز كسرها أوتهيئتها لكل عميل.
- **Tenant Policy:** خيار يمكن ضبطه للمؤسسة ضمن حدود المنتج.
- **Warehouse Policy:** خيار خاص بمخزن أونقطة بيع.
- **Permission Bound:** إجراء يحتاج صلاحية.
- **Approval Bound:** إجراء يحتاج موافقة إضافية.
- **Open Decision:** قرار غير محسوم ولا يتحول إلى افتراض في الكود.
- **Deferred Capability:** محفوظ في التصميم لكنه خارج الإصدار الأول.

## 3. المصطلحات

### Inventory Item

Variant قابلة للتخزين والعد والحركة.

### Warehouse

نطاق حفظ مخزون مستقل. قد يكون مخزنًا مركزيًا، مخزن فرع، مخزن مرتجعات، أوحجرًا عند دعمها.

### Stock Ledger

سجل Append-only للحركات المعتمدة التي تفسر تغير الرصيد.

### Stock Movement

أثر كمي موثق على Variant داخل Warehouse أوعبر Warehouseين.

### On-hand

الكمية الموجودة فعليًا والمملوكة داخل Warehouse وفق الحركات المعتمدة.

### Reserved

كمية محجوزة لالتزام معتمد ولم تخرج فعليًا بعد.

### Available

الكمية المتاحة لالتزام جديد بعد خصم الحجوزات والقيود المعتمدة.

### In-transit

كمية خرجت من مصدرها ولم تُستلم بعد في وجهتها.

### Quarantined

كمية موجودة لكنها ممنوعة مؤقتًا من البيع أوالصرف لحين قرار.

### Damaged

كمية مصنفة كتالف ولا تُعامل كمخزون قابل للبيع.

### Count Session

عملية جرد تسجل الكمية المعدودة قبل اعتماد أي تسوية.

### Adjustment

حركة تصحيح معتمدة تفسر فرقًا بين الرصيد المسجل والواقع المثبت.

### Transfer

مستند تشغيلي ينقل كمية بين Warehouse مصدر وWarehouse وجهة.

### Shipment

مرحلة خروج فعلية من المصدر وتحول الكمية إلى In-transit.

### Receipt

مرحلة إثبات ما وصل فعليًا إلى الوجهة.

## 4. المبادئ غير القابلة للتفاوض

### BR-INV-100 — الرصيد نتيجة وليس سجلًا مستقلًا

**التصنيف:** Invariant

كل رصيد حالي يجب أن يكون قابلًا للتفسير من حركات معتمدة.

لا يقبل النظام تعديل `quantity` مباشرة دون Stock Movement أوإجراء Rebuild موثق لا يغير التاريخ.

### BR-INV-101 — كل حركة لها مصدر

**التصنيف:** Invariant

كل Movement ترتبط بـSource واضح، مثل:

- Sale.
- Customer return.
- Purchase receipt.
- Supplier return.
- Transfer shipment.
- Transfer receipt.
- Stock count adjustment.
- Damage/loss.
- Opening balance.
- Correction/reversal.

### BR-INV-102 — الحركة المعتمدة Immutable

**التصنيف:** Invariant

بعد اعتماد Movement لا يتغير:

- Variant.
- Warehouse.
- Quantity.
- Direction.
- Source identity.
- Effective time.

التصحيح يتم بحركة عكس أومكملة مرتبطة بالأصل.

### BR-INV-103 — الأثر الكمي يحدث مرة واحدة

**التصنيف:** Invariant

Retry أوانقطاع شبكة أوضغط زر متكرر لا ينشئ Movement مكررة لنفس Business action.

### BR-INV-104 — لا كمية بلا Scope

**التصنيف:** Invariant

كل كمية تُقاس على الأقل حسب:

- Tenant.
- Variant.
- Warehouse.
- Stock status عند تطبيقه.
- Batch/serial عند تفعيلها.

لا يوجد رصيد تشغيلي عام غير محدد المكان.

### BR-INV-105 — التاريخ لا يُعاد كتابته

**التصنيف:** Invariant

لا تستخدم Backdate أومحو حركات لإخفاء فرق. أي تصحيح يحتفظ بوقت الاكتشاف وEffective date وفق سياسة واضحة.

## 5. Scope والمخازن

### BR-WHS-100 — Location ليست Warehouse

**التصنيف:** Invariant

- Location تمثل وحدة تشغيل تجارية.
- Warehouse تمثل نطاق حفظ مخزون.
- قد يحتوي الفرع على أكثر من Warehouse.
- قد يوجد Warehouse لا يبيع مباشرة.

### BR-WHS-101 — كل عملية مخزون تحدد Warehouse

**التصنيف:** Invariant

البيع، الاستلام، التحويل، الجرد، التالف والتسوية لا تُقبل بدون Warehouse محددة.

### BR-WHS-102 — Warehouse لها Capabilities

**التصنيف:** Warehouse Policy

يمكن تصنيف Warehouse حسب قدرتها على:

- البيع.
- الاستلام من المورد.
- الشحن للتحويل.
- استلام التحويل.
- الاحتفاظ بالتالف.
- الاحتفاظ بالحجر.

### BR-WHS-103 — تعطيل Warehouse لا يحذف رصيدها

**التصنيف:** Invariant

قبل التعطيل النهائي يجب:

- منع عمليات جديدة.
- معالجة الرصيد المتبقي أوتوثيق سبب بقائه.
- إبقاء التاريخ والتقارير.

### BR-WHS-104 — تغيير تبعية Warehouse لا ينقل مخزونها

**التصنيف:** Invariant

تغيير ارتباط Warehouse بـLocation لا ينشئ حركة مخزون ولا يعيد تفسير التاريخ.

## 6. نموذج الكميات

### BR-QTY-100 — On-hand منفصلة عن Available

**التصنيف:** Invariant

```
Available = On-hand - Reserved - Blocked quantities حسب السياسة
```

In-transit ليست On-hand في الوجهة قبل الاستلام.

### BR-QTY-101 — الحالات لا تُجمع مرتين

**التصنيف:** Invariant

الكمية الواحدة لا تُحسب في الوقت نفسه كـ:

- On-hand قابلة للبيع.
- In-transit.
- Damaged.
- Quarantined.

إلا إذا كان النموذج يستخدم Dimensions منفصلة تمنع Double counting بوضوح.

### BR-QTY-102 — الدقة تتبع وحدة القياس

**التصنيف:** Invariant

- العناصر القطعية لا تقبل كسورًا.
- العناصر الموزونة تقبل Precision محددة.
- لا تُقرب Quantity بطريقة تغير الأثر الفعلي بلا Movement تفسيرية.

### BR-QTY-103 — الرصيد لا يصبح غير قابل للحساب

**التصنيف:** Invariant

أي حالة Pending أوConflict يجب أن تبقي:

- الرصيد المؤكد.
- الأثر المعلق.
- السبب.

ولا تستبدل الرصيد بقيمة غامضة.

## 7. Inventory Ledger

### BR-LED-100 — Ledger Append-only

**التصنيف:** Invariant

لا تُحذف الحركات المعتمدة ضمن التشغيل الطبيعي.

### BR-LED-101 — كل Movement لها Direction

**التصنيف:** Invariant

الحركة تحدد بوضوح:

- Increase.
- Decrease.
- أوPair مترابط لتحويل بين الحالات/المخازن.

### BR-LED-102 — المصدر والمرجع إلزاميان

**التصنيف:** Invariant

كل Movement تحفظ:

- Source type.
- Source ID.
- Source line ID عند الحاجة.
- Actor.
- Warehouse.
- Variant.
- Quantity.
- Unit.
- Reason.
- Idempotency identity.
- Occurred/effective timestamps.

### BR-LED-103 — Transfer لا تُختصر إلى تعديلين غير مرتبطين

**التصنيف:** Invariant

خروج المصدر ودخول الوجهة يجب أن يرتبطا بنفس Transfer وشحنته واستلامه، حتى عند اختلاف الوقت والكمية.

### BR-LED-104 — الرصيد المادي يمكن أن يكون Projection

**التصنيف:** Invariant

يمكن تخزين Balance محسوبة لتحسين الأداء، لكنها:

- ليست بديلًا عن Ledger.
- قابلة لإعادة البناء.
- لها Reconciliation مع Ledger.

### BR-LED-105 — Rebuild لا يغير Business history

**التصنيف:** Invariant

إعادة بناء Balance projection لا تنشئ Movement جديدة ولا تغير Source documents.

## 8. سياسة المخزون السالب

### BR-NEG-100 — Negative stock ليست نتيجة ضمنية

**التصنيف:** Warehouse Policy + Permission Bound

السياسات:

- Forbid.
- Allow with warning.
- Allow by permission.

### BR-NEG-101 — السماح بالسالب يسجل Exception

**التصنيف:** Invariant

عند السماح:

- السبب إلزامي.
- Actor مسجل.
- الرصيد قبل وبعد ظاهر.
- يظهر في Exception queue.

### BR-NEG-102 — السالب لا يُخفى بالاستلام اللاحق

**التصنيف:** Invariant

عند وصول مخزون لاحق، يبقى تاريخ الفترة السالبة قابلًا للتقرير والتحليل.

### BR-NEG-103 — البيع Offline لا يضمن رصيد Server الحالي

**التصنيف:** Invariant

يسجل النظام أن Validation تمت على Snapshot محلية، ويطبق Offline limits بدل ادعاء تحقق لحظي غير موجود.

## 9. الحجز

### BR-RES-100 — Reservation التزام مستقل

**التصنيف:** Invariant عند تفعيلها

الحجز لا يغير On-hand، لكنه يقلل Available.

### BR-RES-101 — لا حجز بلا Source وExpiry policy

**التصنيف:** Invariant

كل Reservation لها:

- Source.
- Quantity.
- Warehouse.
- Status.
- Created time.
- Expiry أوسبب عدم الانتهاء.

### BR-RES-102 — Suspended cart لا تحجز افتراضيًا

**التصنيف:** Tenant Policy

الحجز للسلة العادية خارج Scope الإصدار الأول المقترح، إلا لسيناريو Orders معتمد.

### BR-RES-103 — الحجز لا يتجاوز Available دون صلاحية

**التصنيف:** Tenant Policy + Permission Bound

إذا سمحت المؤسسة Over-reservation، تسجل Exception منفصلة.

### BR-RES-104 — Release وConsume عمليات صريحة

**التصنيف:** Invariant

الحجز ينتهي بإحدى:

- Consumed.
- Released.
- Expired.
- Cancelled.

ولا يختفي من السجل.

### BR-RES-105 — حجز التحويل يحتاج قرار توقيت

**التصنيف:** Open Decision

الخيارات:

- عند Approval.
- عند Shipment فقط.
- بدون Reservation قبل الشحن.

الاقتراح الأولي: الحجز عند Approval، والخصم من On-hand عند Shipment.

## 10. أثر البيع على المخزون

### BR-SST-100 — Draft sale لا تغير المخزون

**التصنيف:** Invariant

### BR-SST-101 — Sale المكتملة تنشئ Decrease واحدة

**التصنيف:** Invariant

كل Sale line مخزنية تنشئ Movement واحدة معتمدة أوترتبط بنتيجة موجودة عند Retry.

### BR-SST-102 — Warehouse البيع ثابتة داخل السطر

**التصنيف:** Invariant

لا يُعاد اختيار Warehouse بعد اكتمال البيع.

### BR-SST-103 — Service/non-stock items لا تنشئ Movement

**التصنيف:** Invariant

Product type تحدد هل السطر مخزني أمغير مخزني.

### BR-SST-104 — Void تعكس أثر البيع وفق حالته

**التصنيف:** Invariant

الحركة الأصلية لا تُحذف؛ تنشأ Reversal مرتبطة بها إذا كانت البضاعة تعود فعليًا للحالة القابلة للبيع.

### BR-SST-105 — Refund وحدها لا تعيد مخزونًا

**التصنيف:** Invariant

عودة المخزون تحتاج Return disposition معتمدة.

## 11. مرتجعات العميل وحالة البضاعة

### BR-RET-INV-100 — كل Return line تحدد Disposition

**التصنيف:** Invariant

الخيارات المبدئية:

- Return to sellable stock.
- Return to quarantine.
- Damaged.
- Lost/not received.
- Supplier return pending.

### BR-RET-INV-101 — Sellable return تزيد الرصيد بعد الاستلام الفعلي

**التصنيف:** Invariant

لا تزيد الكمية بمجرد طلب المرتجع قبل استلام المنتج وفحصه.

### BR-RET-INV-102 — Quarantine ليست Sellable

**التصنيف:** Invariant

الكمية المحجورة تبقى منفصلة حتى Release أوReclassification معتمد.

### BR-RET-INV-103 — قيمة Refund لا تحدد حالة المخزون

**التصنيف:** Invariant

يمكن Refund لعميل مع بقاء المنتج تالفًا، ولا يعني ذلك عودته للمخزون القابل للبيع.

## 12. الاستلام من المورد

### BR-RCV-100 — Purchase order لا تزيد المخزون

**التصنيف:** Invariant

إنشاء أوApproval أمر شراء لا يغير On-hand.

### BR-RCV-101 — الاستلام الفعلي هو مصدر الزيادة

**التصنيف:** Invariant

كل Receipt معتمدة تنشئ Increase مرتبطة بـPurchase order/line أوUnplanned receipt بصلاحية خاصة.

### BR-RCV-102 — الاستلام الجزئي مسموح

**التصنيف:** Invariant

لكل Purchase line يُفصل:

- Ordered.
- Previously received.
- Current received.
- Rejected.
- Remaining.

### BR-RCV-103 — لا استلام يتجاوز المطلوب دون Policy

**التصنيف:** Tenant Policy + Approval Bound

الخيارات:

- Forbid over-receipt.
- Allow tolerance percentage.
- Supervisor approval.

### BR-RCV-104 — الاستلام يحدد Warehouse الوجهة

**التصنيف:** Invariant

لا يستنتج النظام الوجهة بعد الاعتماد من إعداد قابل للتغيير.

### BR-RCV-105 — Accepted وRejected منفصلتان

**التصنيف:** Invariant

الكمية المرفوضة لا تدخل Sellable on-hand.

### BR-RCV-106 — Receipt المعتمدة لا تعدل

**التصنيف:** Invariant

التصحيح يتم بـSupplier return أوCorrection movement، لا تعديل Receipt القديمة.

### BR-RCV-107 — التكلفة المستلمة تحفظ Snapshot

**التصنيف:** Invariant

كل Receipt line تحفظ تكلفة الوحدة وشروطها المرجعية بما يكفي لتقييم المخزون لاحقًا.

## 13. التحويل بين المخازن

### BR-TRF-100 — المصدر والوجهة مختلفان

**التصنيف:** Invariant

لا ينشأ Transfer بين Warehouse ونفسها.

### BR-TRF-101 — Transfer line موجبة وثابتة بعد Approval

**التصنيف:** Invariant

بعد Approval لا تتغير Variant أوRequested quantity. التعديل يتطلب إلغاء الجزء غير المنفذ أومستند جديد.

### BR-TRF-102 — حالات التحويل منفصلة عن الحركات

**التصنيف:** Invariant

الحالات المبدئية:

```
Draft
→ Approved
→ Shipped / Partially Shipped
→ Received / Partially Received
→ Closed
```

مع حالات Cancelled ضمن القيود.

### BR-TRF-103 — Approval لا يعني خروجًا فعليًا

**التصنيف:** Invariant

Approval قد تنشئ Reservation وفق السياسة، لكنها لا تقلل On-hand حتى Shipment.

### BR-TRF-104 — Shipment تقلل المصدر

**التصنيف:** Invariant

عند الشحن المعتمد:

- تقل On-hand في المصدر.
- تزيد In-transit المرتبطة بالتحويل.
- لا تزيد On-hand في الوجهة.

### BR-TRF-105 — Receipt تقلل In-transit وتزيد الوجهة

**التصنيف:** Invariant

الاستلام الفعلي:

- يقلل الكمية In-transit.
- يزيد الحالة المقبولة في Warehouse الوجهة.
- يسجل الفروق وحالة المنتج.

### BR-TRF-106 — الشحن الجزئي مسموح

**التصنيف:** Tenant Policy

الافتراضي المقترح: مسموح مع تتبع Requested وReserved وShipped وRemaining.

### BR-TRF-107 — الاستلام الجزئي مسموح

**التصنيف:** Invariant

الوجهة تسجل ما وصل فعليًا دون إجبارها على مساواة الشحنة.

### BR-TRF-108 — Duplicate receipt ممنوع

**التصنيف:** Invariant

نفس Receipt attempt أوShipment line لا تزيد الوجهة مرتين.

## 14. المخزون أثناء النقل

### BR-ITR-100 — In-transit مملوكة ومحددة المصدر والوجهة

**التصنيف:** Invariant

كل كمية In-transit مرتبطة بـ:

- Transfer.
- Shipment.
- Source warehouse.
- Destination warehouse.
- Variant.
- Quantity remaining.

### BR-ITR-101 — In-transit لا تُباع

**التصنيف:** Invariant

لا تدخل Available في المصدر أوالوجهة.

### BR-ITR-102 — لا تغلق الشحنة وفروقها مجهولة

**التصنيف:** Invariant

أي Short أوOver أوDamaged in transit يحتاج Discrepancy resolution قبل Closure النهائية.

### BR-ITR-103 — فقد أثناء النقل يحتاج Movement وLiability record

**التصنيف:** Invariant

لا يتحول الفرق تلقائيًا إلى Adjustment عامة؛ يسجل كـTransit loss مرتبط بالتحويل والمسؤولية.

## 15. الفروق في التحويل والاستلام

### BR-DSP-100 — كل فرق له نوع

**التصنيف:** Invariant

الأنواع المبدئية:

- Short received.
- Over received.
- Wrong variant.
- Damaged.
- Not shipped.
- Lost in transit.
- Counting error.

### BR-DSP-101 — الوجهة لا تجبر على قبول الكمية المسجلة من المصدر

**التصنيف:** Invariant

المستلم يسجل ما رآه فعليًا، ويظهر الفرق للمراجعة.

### BR-DSP-102 — Over receipt لا يخلق مخزونًا بلا مصدر

**التصنيف:** Invariant

الزيادة غير المفسرة تدخل Quarantine أوPending discrepancy، ولا تصبح Sellable تلقائيًا.

### BR-DSP-103 — حل الفرق يحتاج قرارًا صريحًا

**التصنيف:** Approval Bound

الحلول الممكنة:

- تصحيح خطأ المصدر بحركة موثقة.
- قبول فرق كGain/Loss مع Approval.
- إعادة شحن المتبقي.
- Supplier/carrier claim reference.
- Reclassify damaged/quarantine.

### BR-DSP-104 — إغلاق التحويل يحفظ الفروق

**التصنيف:** Invariant

Resolution لا يمحو Original shipped/received quantities.

## 16. إلغاء التحويل

### BR-TRC-100 — Draft يمكن إلغاؤها دون Movement

**التصنيف:** Invariant

### BR-TRC-101 — Approved قبل Shipment تلغي Reservation

**التصنيف:** Invariant عند وجود Reservation

### BR-TRC-102 — Shipped transfer لا تُلغى كأنها لم تحدث

**التصنيف:** Invariant

بعد الشحن، الحل يكون:

- Return transfer.
- Recall/return shipment workflow.
- Receipt ثم transfer عكسي.

وفق الحالة الفعلية.

### BR-TRC-103 — الإلغاء الجزئي يتعلق بالمتبقي فقط

**التصنيف:** Invariant

لا يلغي ما تم شحنه أواستلامه بالفعل.

## 17. التالف والمفقود والحجر

### BR-DMG-100 — Damaged stock حالة منفصلة

**التصنيف:** Invariant

نقل كمية إلى Damaged لا يحذفها؛ يسجل Reclassification أوMovement حسب النموذج.

### BR-DMG-101 — Damage يحتاج Reason وEvidence

**التصنيف:** Permission Bound

يحفظ:

- السبب.
- Actor.
- Quantity.
- Warehouse.
- Source event.
- مرفق/صورة عند السياسة.

### BR-DMG-102 — Loss تقلل الملكية المتاحة

**التصنيف:** Approval Bound

حركة Loss تحتاج Permission أقوى من Reclassification العادية، وتظهر في تقرير خسائر.

### BR-DMG-103 — Quarantine لا تُباع أوتُنقل كعادية

**التصنيف:** Invariant

تحتاج Release أوDisposition معتمد.

### BR-DMG-104 — إتلاف فعلي يحتاج Closure

**التصنيف:** Deferred Capability / Approval Bound

عند دعم Disposal، يسجل:

- Approval.
- Method.
- Time.
- Witness/evidence.
- Financial impact reference.

## 18. الجرد

### BR-CNT-100 — بدء الجرد يثبت Scope

**التصنيف:** Invariant

Count Session تحدد:

- Warehouse.
- Variants/categories/zones.
- Cutoff أوSnapshot reference.
- Counters.
- Count method.

### BR-CNT-101 — العد لا يغير الرصيد

**التصنيف:** Invariant

الكمية المعدودة تسجل كObservation حتى اعتماد Adjustment.

### BR-CNT-102 — Blind count خيار معتمد

**التصنيف:** Tenant Policy

يمكن إخفاء Expected quantity عن العداد لتقليل الانحياز.

### BR-CNT-103 — لا تعاد كتابة نتيجة عد أصلية

**التصنيف:** Invariant

Recount تسجل كمحاولة جديدة مع سبب، ولا تمحو العد الأول.

### BR-CNT-104 — الحركات أثناء الجرد تحتاج Cutoff policy

**التصنيف:** Warehouse Policy

الخيارات:

- Freeze movements.
- Allow movements معSnapshot وحساب فروق زمني.
- Count by zones معLocks جزئية.

### BR-CNT-105 — فرق الجرد يحتاج Approval حسب الحد

**التصنيف:** Approval Bound

الحد يمكن أن يعتمد على:

- Quantity.
- Value.
- Percentage.
- Product sensitivity.

### BR-CNT-106 — اعتماد الجرد ينشئ Adjustment فقط للفروق

**التصنيف:** Invariant

لا يعيد كتابة Opening balance أوكل الرصيد.

### BR-CNT-107 — Count session لا تغلق بسطور غير محسومة

**التصنيف:** Tenant Policy

يجب تعريف كيفية معالجة:

- Missing counts.
- Unexpected items.
- Duplicate scans.
- Unidentified barcodes.

## 19. التسويات

### BR-ADJ-100 — Adjustment ليست وسيلة تشغيل يومية

**التصنيف:** Invariant

تستخدم فقط لتفسير فرق مثبت لا يغطيه Source workflow طبيعي.

### BR-ADJ-101 — السبب إلزامي ومقنن

**التصنيف:** Invariant

Reason codes مثل:

- Count variance.
- Data migration correction.
- Damage.
- Loss.
- Found stock.
- Unit conversion correction.

### BR-ADJ-102 — Manual adjustment تحتاج صلاحية وموافقة حسب الحد

**التصنيف:** Permission/Approval Bound

### BR-ADJ-103 — Adjustment لا تغير مستند المصدر

**التصنيف:** Invariant

إذا كان الفرق سببه Receipt أوTransfer، يُربط Adjustment بالمصدر دون تعديل المستند القديم.

### BR-ADJ-104 — Backdated adjustment لها سياسة

**التصنيف:** Tenant Policy + Approval Bound

يجب حفظ:

- Recorded at.
- Effective at.
- سبب التأخير.
- أثرها على تقارير الفترات المغلقة.

## 20. الرصيد الافتتاحي وترحيل البيانات

### BR-OPN-100 — Opening balance حركة معتمدة

**التصنيف:** Invariant

لا تدخل كقيمة مباشرة بلا Ledger source.

### BR-OPN-101 — Opening balance لها Cutover time

**التصنيف:** Invariant

كل Warehouse وVariant لها نقطة زمنية واضحة يبدأ بعدها التشغيل في أثر.

### BR-OPN-102 — لا Migration مزدوجة

**التصنيف:** Invariant

إعادة استيراد نفس Batch لا تكرر الرصيد الافتتاحي.

### BR-OPN-103 — فروق ما بعد الترحيل تصحح ولا تعاد كتابة الاستيراد

**التصنيف:** Invariant

إلا إذا كان Cutover لم يعتمد بعد، وفي هذه الحالة يجوز إلغاء Batch كاملة وإعادة بنائها وفق Runbook.

## 21. وحدات القياس والتحويل

### BR-UOM-100 — Base stock unit واحدة لكل Variant

**التصنيف:** Invariant

كل الرصيد وLedger يُقاسان بوحدة أساسية موحدة.

### BR-UOM-101 — التحويلات تحفظ Factor المستخدم

**التصنيف:** Invariant

بيع أوشراء بوحدة بديلة يحفظ Conversion factor وقت العملية.

### BR-UOM-102 — Factor لا يتغير على التاريخ

**التصنيف:** Invariant

تغيير Pack size مستقبلًا لا يغير الحركات السابقة.

### BR-UOM-103 — الكسر غير القابل للتمثيل ممنوع

**التصنيف:** Invariant

لا تقبل عملية تنتج Base quantity بدقة أعلى من المسموح دون Rule صريحة.

## 22. Batch وExpiry وSerial

### BR-BAT-100 — التتبع التفصيلي Capability على مستوى Variant

**التصنيف:** Deferred Capability

الأنواع:

- None.
- Batch tracked.
- Expiry tracked.
- Serial tracked.

### BR-BAT-101 — لا تخلط كميات متتبعة وغير متتبعة

**التصنيف:** Invariant عند التفعيل

### BR-BAT-102 — Serial quantity تساوي وحدة واحدة

**التصنيف:** Invariant عند التفعيل

### BR-BAT-103 — Expired stock لا تُباع حسب Policy

**التصنيف:** Tenant/Legal Policy

هذه القواعد لا تدخل الإصدار الأول قبل اعتماد قطاع يتطلبها، لكنها يجب ألا تُمنع معماريًا.

## 23. تكلفة المخزون

### BR-CST-100 — Quantity ledger منفصلة منطقيًا عن Valuation

**التصنيف:** Invariant

لا يتعطل تفسير الكمية بسبب تأخر حساب التكلفة.

### BR-CST-101 — كل Receipt تحفظ Cost basis

**التصنيف:** Invariant

تشمل حسب النطاق:

- Unit purchase cost.
- Currency.
- Exchange rate reference عند دعم multi-currency purchasing.
- Allocated landed cost لاحقًا.

### BR-CST-102 — طريقة التقييم قرار مؤسسي ثابت داخل الفترة

**التصنيف:** Open Decision

الخيارات الأساسية:

- Weighted average.
- FIFO.

الاقتراح الأولي: Moving weighted average للإصدار الأول، مع تصميم يسمح بـFIFO لاحقًا إذا ثبتت الحاجة.

### BR-CST-103 — Negative stock يعقد التكلفة

**التصنيف:** Invariant

عند السماح بالسالب يجب تعريف Cost fallback وRevaluation behavior، ولا يُترك للحساب الضمني.

### BR-CST-104 — Landed cost لا يغير Quantity

**التصنيف:** Invariant

توزيع شحن أوجمارك يعدل التقييم فقط عبر Cost adjustment موثق.

### BR-CST-105 — إعادة التقييم لا تعيد كتابة Movement الكمية

**التصنيف:** Invariant

Valuation entries تحفظ منفصلة ومرتبطة بالمصادر.

## 24. Offline Inventory Operations

### BR-IOF-100 — Snapshot المحلية ليست الحقيقة النهائية

**التصنيف:** Invariant

POS تعرض آخر رصيد مؤكد محليًا مع وقت آخر Sync، ولا تدعي أنه Live عند Offline.

### BR-IOF-101 — Offline sale تسجل أثرًا Pending محليًا

**التصنيف:** Invariant

الأثر المحلي يمنع تكرار نفس البيع على الجهاز، ثم يُثبت Server-side مرة واحدة عند Sync.

### BR-IOF-102 — الاستلام والتحويل Offline ليست مفعلة افتراضيًا

**التصنيف:** Tenant Policy

الاقتراح للإصدار الأول:

- البيع النقدي فقط له Offline support كامل.
- Receipt وShipment وStock adjustment تحتاج اتصالًا.
- Count observations قد تعمل Offline إذا صُمم Sync آمن لها لاحقًا.

### BR-IOF-103 — Conflict لا يحذف العملية

**التصنيف:** Invariant

أي Conflict بعد Sync يتحول إلى Exception موثقة مع Recovery path.

### BR-IOF-104 — لا يتم Rebase صامت للرصيد المحلي

**التصنيف:** Invariant

عند وصول Snapshot جديدة، تحتفظ POS بالعمليات المحلية Pending وتعيد حساب العرض دون فقدها.

## 25. التزامن والتوازي

### BR-CON-100 — كل Command مخزنية لها Idempotency identity

**التصنيف:** Invariant

ينطبق على:

- Sale movement.
- Receipt.
- Shipment.
- Transfer receipt.
- Return.
- Adjustment.

### BR-CON-101 — التحقق والكتابة وحدة منطقية

**التصنيف:** Invariant

لا يتحقق النظام من Available ثم يكتب لاحقًا دون حماية من Race condition.

### BR-CON-102 — التنافس لا ينتج رصيدًا مزدوجًا

**التصنيف:** Invariant

عمليتان متزامنتان لنفس Variant/Warehouse تطبقان وفق ترتيب متسق أوتفشل إحداهما بسياسة واضحة.

### BR-CON-103 — Duplicate scan لا تعني Duplicate receipt

**التصنيف:** Invariant

واجهة المسح قد تزيد Count intent، لكن اعتماد Movement يتم حسب line identity وCommand identity الموثقتين.

## 26. الصلاحيات والموافقات

### BR-IAU-100 — عرض الرصيد لا يساوي تعديل الرصيد

**التصنيف:** Invariant

Permissions منفصلة لـ:

- View stock.
- View cost.
- Create transfer.
- Approve transfer.
- Ship.
- Receive.
- Count.
- Approve adjustment.
- Mark damage/loss.
- Override negative stock.

### BR-IAU-101 — المنشئ لا يوافق دائمًا على عمليته

**التصنيف:** Tenant Policy

للعمليات الحساسة يمكن تطبيق Separation of duties.

### BR-IAU-102 — Loss وlarge adjustment تحتاج موافقة أقوى

**التصنيف:** Approval Bound

الحدود تُضبط بالقيمة والكمية والنسبة.

### BR-IAU-103 — Support لا تعدل المخزون بصلاحية دائمة

**التصنيف:** Invariant

أي تدخل دعم يحتاج Access lease وسبب وAudit وCommand معتمد.

## 27. Audit وEvents

### BR-IAU-110 — كل أثر مخزني له Evidence

**التصنيف:** Invariant

يسجل:

- Actor.
- Source.
- Before/after projection عند الحاجة.
- Quantity.
- Warehouse.
- Variant.
- Reason.
- Approval.
- Client/server identities.

### BR-EVT-INV-100 — الأحداث تعكس حقيقة معتمدة

**التصنيف:** Invariant

أحداث مبدئية:

- StockMovementPosted.
- StockReserved.
- ReservationReleased.
- TransferApproved.
- TransferShipped.
- TransferPartiallyReceived.
- TransferReceived.
- TransferDiscrepancyRaised.
- PurchaseReceiptPosted.
- StockCountStarted.
- StockCountSubmitted.
- StockAdjustmentPosted.
- StockMarkedDamaged.
- InventoryConflictRaised.

### BR-EVT-INV-101 — Event لا تسبق Commit

**التصنيف:** Invariant

لا يُعلن النظام Movement ناجحة قبل تثبيت الحقيقة المرتبطة بها.

## 28. التقارير والمطابقة

### BR-IREP-100 — Stock on date يحسب زمنيًا

**التصنيف:** Invariant

التقرير التاريخي يستخدم Effective movements حتى التاريخ، لا الرصيد الحالي.

### BR-IREP-101 — الرصيد يعرض بمكوناته

**التصنيف:** Invariant

التقارير تفرق بين:

- On-hand.
- Reserved.
- Available.
- In-transit.
- Quarantined.
- Damaged.

### BR-IREP-102 — Movement report لا يخفي Reversals

**التصنيف:** Invariant

يعرض الأصل والتصحيح والربط بينهما.

### BR-IREP-103 — Reconciliation تقارن Projection بالـLedger

**التصنيف:** Invariant

أي فرق تقني يظهر كIncident، ولا يصحح آليًا بحركة تجارية مزيفة.

### BR-IREP-104 — Aging يعتمد على Cost method وReceipt history

**التصنيف:** Deferred Capability

لا يُستنتج Aging من آخر تعديل للمنتج.

## 29. الأخطاء والاسترداد

### BR-IERR-100 — الخطأ يحدد ما حدث للكمية

**التصنيف:** Invariant

الرسالة توضح:

- هل Movement تم اعتمادها؟
- هل العملية Pending؟
- هل يمكن Retry بنفس الهوية؟
- هل يحتاج المستخدم تجنب إعادة المسح أواستلام الكمية؟
- Reference ID.

### BR-IERR-101 — Unknown outcome لا يعاد يدويًا دون Inquiry

**التصنيف:** Invariant

ينطبق خصوصًا على Receipt وShipment وAdjustment بعد Timeout.

### BR-IERR-102 — Recovery عبر Commands معتمدة

**التصنيف:** Invariant

المسارات تشمل:

- Retry idempotently.
- Reconcile source and movements.
- Raise discrepancy.
- Post reversal/correction.
- Rebuild projection.
- Escalate incident.

لا يستخدم تعديل SQL مباشر كإجراء تشغيلي طبيعي.

## 30. السيناريوهات الإلزامية للاختبار لاحقًا

1. Sale تقلل Warehouse الصحيحة مرة واحدة.
2. Retry لنفس Sale لا يكرر الحركة.
3. Negative stock forbidden.
4. Negative stock override مع Audit.
5. Purchase receipt كاملة.
6. Purchase receipt جزئية.
7. Over-receipt داخل وخارج tolerance.
8. Receipt rejected quantity.
9. Transfer Draft ثم Approval.
10. Transfer shipment كاملة.
11. Partial shipment.
12. Partial receipt.
13. Duplicate receipt retry.
14. Short receipt discrepancy.
15. Over receipt discrepancy.
16. Damaged in transit.
17. Cancel transfer قبل الشحن.
18. محاولة إلغاء بعد الشحن.
19. Customer return إلى Sellable.
20. Customer return إلى Quarantine/Damaged.
21. Blind count.
22. Count مع حركات أثناء الجرد.
23. Recount وحفظ المحاولتين.
24. Adjustment approval فوق الحد.
25. Opening balance import retry.
26. Unit conversion precision.
27. Projection rebuild ومطابقة Ledger.
28. Offline sale ثم Sync مع رصيد Server تغير.
29. Concurrent sales على آخر كمية.
30. Timeout بعد Receipt commit ثم Retry.
31. Reservation consume/release عند تفعيلها.
32. In-transit quantity لا تظهر Available.
33. Cost revaluation لا تغير Quantity.
34. Quarantined stock ممنوعة من البيع.
35. Warehouse deactivation مع رصيد متبقٍ.

## 31. القرارات المفتوحة المطلوب حسمها

### OD-INV-001 — سياسة Negative stock الافتراضية

**الاقتراح:** Forbid، مع Supervisor override وسبب إلزامي للضرورة.

### OD-INV-002 — هل Reservations تدخل الإصدار الأول؟

**الاقتراح:** نعم للتحويل عند Approval فقط؛ لا حجز للسلال أوطلبات العملاء في البداية.

### OD-INV-003 — توقيت حجز التحويل

**الاقتراح:** عند Approval، مع Release عند الإلغاء، وConsume عند Shipment.

### OD-INV-004 — هل يسمح Partial shipment؟

**الاقتراح:** نعم، لأن الواقع التشغيلي يتطلبه، مع Immutable approved lines وتتبع remaining.

### OD-INV-005 — Over-receipt tolerance

تحتاج Tenant policy بنسبة وحد أقصى مطلق وموافقة فوقهما.

### OD-INV-006 — Count freeze strategy

**الاقتراح:** الإصدار الأول يدعم Freeze للـWarehouse أوZone المحددة أثناء الجرد المعتمد؛ Snapshot count أثناء استمرار الحركة يؤجل لاحقًا.

### OD-INV-007 — طريقة تقييم المخزون

**الاقتراح:** Moving weighted average أولًا، بعد مراجعة المتطلبات المحاسبية والتقارير المطلوبة.

### OD-INV-008 — Warehouse statuses model

هل Damaged وQuarantine Warehouses مستقلة أمStock-status dimensions داخل نفس Warehouse؟

**الاقتراح:** Status dimension داخل Warehouse منطقيًا، مع Views/virtual areas، لتجنب تحويلات مكانية مزيفة؛ يحسم في Domain Model.

### OD-INV-009 — العمليات Offline

**الاقتراح:** البيع فقط في الإصدار الأول. الاستلام والشحن والتسوية Online-required. Count capture Offline قدرة لاحقة.

### OD-INV-010 — Batch وExpiry

تؤجل حتى اختيار قطاع تجميل/دواء يتطلبها فعليًا، مع الحفاظ على extensibility.

### OD-INV-011 — Transfer ownership during transit

**الاقتراح:** تبقى مملوكة للمؤسسة وتظهر In-transit خارج On-hand للمصدر والوجهة، مع Source/Destination liability واضحة.

### OD-INV-012 — Backdated movements

**الاقتراح:** ممنوعة افتراضيًا بعد إغلاق فترة تشغيلية، وتحتاج Approval وسببًا في الفترات المفتوحة.

## 32. خارج النطاق حاليًا

- Manufacturing وBill of Materials.
- Kitting/assembly المعقد.
- Consignment stock.
- Vendor-managed inventory.
- Customer reservations وe-commerce allocation.
- Lot genealogy.
- Serial warranty lifecycle.
- Automated replenishment بالذكاء الاصطناعي.
- Multi-company intercompany transfers.
- Customs bonded inventory.
- Full warehouse management مثل wave picking وroute optimization.

## 33. Dependencies

هذه الوثيقة تغذي مباشرة:

- Inventory Domain Model.
- Warehouse وTransfer State Machines.
- Purchase Receipt State Machine.
- Stock Count State Machine.
- Return disposition rules.
- Permission Matrix.
- Event وAudit Catalogs.
- Sync وOffline Protocols.
- API Contract.
- Error Catalog.
- Database Blueprint.
- Costing and Reporting Model.
- Test Strategy.

## 34. Acceptance Gate

لا تعتبر Inventory planning مكتملة قبل:

1. اعتماد نموذج الكميات الخمس الأساسي.
2. حسم Negative stock policy الافتراضية.
3. حسم Reservation scope وتوقيت حجز التحويل.
4. اعتماد Transfer lifecycle بما يشمل partial shipment/receipt والفروق.
5. اعتماد Count freeze strategy.
6. حسم Cost method المبدئية.
7. حسم Damaged/Quarantine representation في Domain Model.
8. تحويل كل Movement إلى Source وState transition وPermission وEvent وTest requirement.
9. إثبات عدم وجود تعديل مباشر للرصيد كـBusiness workflow.
10. توافق القواعد مع Sales & Payments Rules وFoundation Bible.

## 35. القرار التخطيطي الحالي

- Stock Ledger هو مرجع تفسير الرصيد.
- On-hand وReserved وAvailable وIn-transit وBlocked quantities مفاهيم منفصلة.
- Transfer Approval لا تحرك المخزون؛ Shipment تخرج من المصدر وReceipt تدخل الوجهة.
- Partial shipment وpartial receipt مدعومتان تخطيطيًا.
- كل فرق يتحول إلى Discrepancy واضحة، لا Adjustment صامتة.
- Count observations لا تغير الرصيد حتى Approval.
- الإصدار الأول يقترح منع Negative stock افتراضيًا.
- العمليات المخزنية المعقدة Online-required أولًا، مع Offline sale فقط.
- التكلفة والتقييم لا يغيران تاريخ الكميات.