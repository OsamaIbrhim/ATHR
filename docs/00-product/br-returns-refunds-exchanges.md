# ATHR Returns, Refunds & Exchanges Business Rules v1.0

**Planning Baseline — Customer Returns, Financial Refunds and Exchanges**

## 1. وظيفة الوثيقة

هذه الوثيقة هي المرجع التفصيلي لقواعد:

- مرتجعات العملاء.
- رد الأموال.
- الاستبدال.
- الإلغاء والـVoid.
- المرتجع الجزئي.
- Refund الجزئي.
- Store credit عند اعتماده.
- المرتجع بدون فاتورة.
- الفحص وحالة البضاعة المرتجعة.
- إعادة البضاعة إلى Available أوQuarantine أوDamaged.
- منع تكرار المرتجع والاحتيال.
- العمل دون اتصال.
- الصلاحيات والموافقات والتدقيق.

هذه الوثيقة تربط قواعد البيع والمدفوعات والمخزون دون دمج كياناتها أوطمس اختلاف آثارها.

## 2. المصطلحات

### Return Request

طلب أوعملية أولية لفحص أهلية إعادة منتج سبق بيعه.

### Customer Return

مستند يثبت أن كمية محددة من سطر بيع أصلي أعيدت أوتم قبول مسؤولية المتجر عنها.

### Return Line

سطر يرتبط بسطر بيع أصلي ويحدد الكمية، سبب الإرجاع، حالة المنتج، وقيمة الاسترداد المؤهلة.

### Refund

عملية مالية مستقلة تعيد قيمة سبق تحصيلها أوتسوي التزامًا تجاه العميل.

### Exchange

معاملة مركبة منطقيًا من:

- Return للمنتج القديم.
- Sale للمنتج الجديد.
- Settlement للفرق.

### Void

إبطال عملية بيع مكتملة ضمن شروط ضيقة، مع عكس آثارها دون حذف التاريخ.

### Store Credit

التزام مالي على المتجر لصالح عميل، يحتاج Ledger مستقلًا ولا يساوي Discount أوPayment سالبة.

### Return Disposition

قرار حالة المنتج المرتجع:

- restock available.
- quarantine.
- damaged.
- scrap.
- return to supplier.
- repair/rework لاحقًا.

## 3. المبادئ غير القابلة للتفاوض

### BR-RET-100 — Return وRefund عمليتان مختلفتان

**التصنيف:** Invariant

- Return تؤثر على المنتج والمخزون.
- Refund تؤثر على المال.
- يمكن حدوث واحدة دون الأخرى وفق سبب مشروع.
- يجب أن يظل الربط بينهما واضحًا.

### BR-RET-101 — Exchange ليست تعديلًا للفاتورة الأصلية

**التصنيف:** Invariant

الاستبدال لا يغير سطور البيع القديم، بل ينشئ Return وSale جديدتين مع Settlement للفرق.

### BR-RET-102 — Void ليست Return

**التصنيف:** Invariant

Void تستخدم عندما تنطبق شروط إبطال البيع، بينما Return تستخدم عندما عاد المنتج بعد البيع أوتغيرت حيازته فعليًا.

### BR-RET-103 — لا حذف للتاريخ

**التصنيف:** Invariant

كل Return أوRefund أوExchange أوVoid يحتفظ بـ:

- المستند الأصلي.
- العملية التصحيحية.
- السبب.
- هوية المنفذ والموافق.
- التوقيت.
- الأثر المالي والمخزني.

### BR-RET-104 — كل أثر يحدث مرة واحدة

**التصنيف:** Invariant

Retries أوانقطاع الشبكة لا تكرر:

- Returned quantity.
- Inventory movement.
- Refund.
- Store credit.
- Exchange settlement.

### BR-RET-105 — الكمية والقيمة المستردتان محدودتان بالأصل

**التصنيف:** Invariant

لا يمكن إعادة أوRefund أكثر مما يسمح به التاريخ المتبقي بعد خصم العمليات السابقة.

## 4. أهلية المرتجع

### BR-ELG-100 — كل Return لها Policy مصدر

**التصنيف:** Tenant/Location Policy

الأهلية قد تعتمد على:

- مدة منذ البيع.
- القطاع أوالفئة.
- حالة المنتج.
- وجود الإيصال.
- طريقة الدفع.
- نوع السعر أوPromotion.
- Customer identity.
- Location.

### BR-ELG-101 — تاريخ الأهلية يقاس من تاريخ محدد

**التصنيف:** Tenant Policy

يجب تحديد هل النافذة تبدأ من:

- Sale completion.
- Delivery date عند دعم fulfillment.
- Exchange date لمنتج مستبدل.

### BR-ELG-102 — انتهاء النافذة لا يغير التاريخ

**التصنيف:** Invariant

يمكن Supervisor override عند السماح، لكن يسجل السبب والسلطة المستخدمة.

### BR-ELG-103 — الفئات غير القابلة للإرجاع معرفة مسبقًا

**التصنيف:** Tenant Policy

مثل:

- منتجات صحية مفتوحة.
- منتجات شخصية.
- منتجات مخصصة.
- منتجات تالفة بسبب العميل.
- Final-sale items.

### BR-ELG-104 — Final sale لا تمنع حقوقًا إلزامية

**التصنيف:** Legal Policy Boundary

أي قواعد قانونية واجبة تتغلب على سياسة النشاط، وتوثق في Legal Blueprint حسب الدولة.

### BR-ELG-105 — المرتجع يحتاج سببًا

**التصنيف:** Invariant

Reason codes المبدئية:

- customer changed mind.
- wrong size/color.
- defective.
- damaged on sale/delivery.
- wrong item sold.
- duplicate sale.
- pricing error.
- service recovery.
- other مع تعليق.

## 5. الربط بالبيع الأصلي

### BR-LNK-100 — المرتجع المربوط هو المسار الافتراضي

**التصنيف:** Invariant

Return line ترتبط بـSale line أصلية متى كان ذلك ممكنًا.

### BR-LNK-101 — الربط يحدد الحد القابل للإرجاع

**التصنيف:** Invariant

```
Sold quantity
- previously returned quantity
- previously voided quantity
= remaining returnable quantity
```

### BR-LNK-102 — لا يكفي رقم الفاتورة وحده

**التصنيف:** Invariant

يجب تحديد السطر والـVariant والكمية والسعر التاريخي والخصومات والضرائب.

### BR-LNK-103 — البيع من Tenant آخر غير مؤهل

**التصنيف:** Invariant

لا يعالج Tenant مرتجعًا لبيع لا يملكه.

### BR-LNK-104 — المرتجع في فرع مختلف سياسة صريحة

**التصنيف:** Tenant Policy

الخيارات:

- same location only.
- any location within tenant.
- selected return locations.

عند اختلاف الفرع، تسجل Location البيع وLocation الاستلام منفصلتين.

## 6. المرتجع بدون فاتورة

### BR-NOR-100 — No-receipt return ليس افتراضيًا

**التصنيف:** Tenant Policy + Permission Bound

الافتراضي المقترح للإصدار الأول: ممنوع، إلا Supervisor exception محددة.

### BR-NOR-101 — No-receipt return يحتاج هوية العميل

**التصنيف:** Invariant عند السماح

لا يقبل مرتجع مجهول بلا مستند وبدون Customer identity قابلة للتتبع.

### BR-NOR-102 — القيمة لا تعتمد على ادعاء العميل

**التصنيف:** Invariant

تحدد القيمة وفق Policy مثل:

- أقل سعر بيع موثوق خلال فترة.
- السعر الحالي الأدنى.
- Store credit فقط.
- مراجعة يدوية.

### BR-NOR-103 — No-receipt return لا ينتج Cash refund افتراضيًا

**التصنيف:** Planning Decision

الاقتراح: Store credit فقط بعد بناء Ledger الخاص بها، أورفض العملية في MVP.

### BR-NOR-104 — تكرار No-receipt returns يرفع Risk flag

**التصنيف:** Invariant عند دعمها

يحسب على العميل والجهاز والفرع والمنتج دون قرارات آلية غير قابلة للمراجعة.

## 7. إنشاء طلب المرتجع

### BR-RRQ-100 — Draft return لا تحرك المخزون أوالمال

**التصنيف:** Invariant

يمكن جمع وفحص البيانات قبل الاعتماد دون أثر نهائي.

### BR-RRQ-101 — الطلب له هوية Idempotency

**التصنيف:** Invariant

نفس محاولة الاعتماد لا تنشئ Return ثانية.

### BR-RRQ-102 — السطر يثبت Snapshot

**التصنيف:** Invariant

يحفظ:

- Original sale line reference.
- Variant.
- sold quantity.
- previously returned quantity.
- requested quantity.
- original net unit value.
- allocated discount.
- tax components.
- return reason.
- condition.

### BR-RRQ-103 — لا اعتماد بدون Destination disposition أولية

**التصنيف:** Invariant

يحدد هل المنتج:

- available.
- quarantine.
- damaged.
- pending inspection.

يمكن تعديل القرار لاحقًا عبر Movement موثقة، لا بتغيير صامت.

## 8. فحص المنتج المرتجع

### BR-INS-100 — الحالة الفيزيائية منفصلة عن سبب العميل

**التصنيف:** Invariant

Reason يشرح لماذا عاد المنتج، وCondition تشرح حالته الفعلية.

### BR-INS-101 — فئات الحالة موحدة

**التصنيف:** Tenant Policy ضمن Catalog موحد

مثل:

- unopened/new.
- opened but resellable.
- defective.
- damaged.
- incomplete.
- used.
- unknown/pending inspection.

### BR-INS-102 — إعادة البيع تحتاج قرارًا صريحًا

**التصنيف:** Permission Bound

لا تدخل الكمية إلى Available لمجرد قبول Return.

### BR-INS-103 — Defective لا تدخل Available

**التصنيف:** Invariant

تذهب إلى Quarantine أوDamaged أوSupplier claim workflow.

### BR-INS-104 — الفحص قد يتطلب صورًا أوEvidence

**التصنيف:** Tenant Policy

خاصة للمنتجات ذات القيمة العالية أوالعيوب المتكررة.

### BR-INS-105 — تغيير Disposition ينشئ Movement

**التصنيف:** Invariant

الانتقال من Quarantine إلى Available أوDamaged لا يتم بتعديل Status فقط، بل بحركة مخزون موثقة.

## 9. الكميات الجزئية

### BR-QTY-100 — Partial return مدعومة

**التصنيف:** Invariant

يمكن إعادة جزء من كمية السطر مع بقاء المتبقي مؤهلًا ضمن السياسة.

### BR-QTY-101 — مجموع المرتجعات لا يتجاوز المباع

**التصنيف:** Invariant

يحسب عبر كل الفروع والأجهزة والعمليات السابقة داخل Tenant.

### BR-QTY-102 — الوحدات العشرية تتبع دقة المنتج

**التصنيف:** Invariant

لا يسمح بدقة أعلى من Sale الأصلية أوUOM المعتمدة.

### BR-QTY-103 — Serial-tracked item يعاد بالـSerial نفسه

**التصنيف:** Capability Rule

عند تفعيل Serial tracking، لا يكفي Variant والكمية فقط.

### BR-QTY-104 — Bundle/kit return تحتاج سياسة تفكيك

**التصنيف:** Open Decision

يجب تحديد هل:

- تعاد المجموعة كاملة فقط.
- يسمح بإرجاع Components وتوزيع القيمة.

## 10. حساب قيمة المرتجع

### BR-VAL-100 — الأساس هو القيمة التاريخية الصافية

**التصنيف:** Invariant

لا يستخدم السعر الحالي افتراضيًا، بل قيمة السطر الأصلية بعد توزيع الخصومات والضرائب وفق السياسة.

### BR-VAL-101 — Invoice-level discount توزع حتميًا

**التصنيف:** Invariant

قيمة المرتجع تستخدم نفس Allocation المثبتة في البيع، لا إعادة توزيع جديدة على السطور المتبقية.

### BR-VAL-102 — الضريبة تعكس القاعدة الأصلية

**التصنيف:** Invariant

يحسب Tax reversal وفق Snapshot البيع والقواعد القانونية.

### BR-VAL-103 — قيمة المرتجع لا تتجاوز المتبقي القابل للاسترداد

**التصنيف:** Invariant

```
Original refundable line value
- prior approved return values
- prior refunds/credits allocated
= remaining refundable value
```

### BR-VAL-104 — Restocking fee ليست خصمًا مخفيًا

**التصنيف:** Tenant/Legal Policy

عند السماح بها:

- تظهر كبند واضح.
- لها سبب وقاعدة.
- لا تتجاوز حدودًا قانونية أوتجارية.

### BR-VAL-105 — تغير السعر الحالي لا يرفع قيمة الاسترداد

**التصنيف:** Invariant

إلا إذا كانت سياسة ضمان السعر أوتعويض خدمة مستقلة ومصرح بها.

### BR-VAL-106 — Promotion eligibility لا يعاد تقييمها بلا قاعدة

**التصنيف:** Invariant

إذا أدى المرتجع إلى كسر شرط Promotion، يجب أن تحدد السياسة مسبقًا هل:

- يحتفظ العميل بالخصم الأصلي.
- يعاد حساب Benefit المفقودة.
- تخصم قيمة Gift/free item.

## 11. العروض والهدايا

### BR-PRO-100 — المرتجع من عرض له Policy محفوظة

**التصنيف:** Invariant

Promotion snapshot تحدد Return behavior وقت البيع.

### BR-PRO-101 — Buy-X-Get-Y لا يعالج عشوائيًا

**التصنيف:** Tenant Policy

الخيارات:

- إعادة كل العناصر المرتبطة.
- الاحتفاظ بالهدية مع خصم قيمتها.
- منع المرتجع الجزئي.

### BR-PRO-102 — Gift item لها قيمة Refund محددة

**التصنيف:** Invariant

لا تفترض القيمة صفرًا إذا كانت ستؤثر على تسوية العرض؛ تحفظ Allocation واضحة.

### BR-PRO-103 — Coupon لا يعاد إصداره تلقائيًا

**التصنيف:** Tenant Policy

إعادة تفعيل Coupon أوBenefit قرار مستقل حسب نوعها وحالتها.

## 12. اعتماد المرتجع

### BR-APR-100 — حدود الاعتماد تعتمد على المخاطر

**التصنيف:** Tenant Policy + Approval Bound

قد تعتمد على:

- قيمة المرتجع.
- انتهاء النافذة.
- عدم وجود فاتورة.
- حالة المنتج.
- طريقة Refund مختلفة.
- معدل مرتجعات العميل.
- Role المنفذ.

### BR-APR-101 — Cashier limits واضحة

**التصنيف:** Permission Bound

يمكن للكاشير تنفيذ مرتجع عادي مرتبط بفاتورة وداخل السياسة ضمن حد، وما عداه يحتاج Supervisor.

### BR-APR-102 — الموافق والمنفذ شخصان مختلفان عند الحدود العليا

**التصنيف:** Segregation Policy

يحفظ maker وapprover وexecutor عند الحاجة.

### BR-APR-103 — Override يحتاج Reason وEvidence

**التصنيف:** Invariant

لا يكفي إدخال PIN بدون سبب قابل للمراجعة.

## 13. اعتماد Return وأثر المخزون

### BR-POST-100 — Posting الذري منطقيًا

**التصنيف:** Invariant

اعتماد Return ينتج كوحدة مترابطة:

- Return document confirmed.
- Lines frozen.
- Returnable balances consumed.
- Inventory movements created حسب disposition.
- Financial entitlement calculated.
- Events/Audit emitted.

### BR-POST-101 — Pending inspection لا تدخل On-hand available

**التصنيف:** Invariant

يمكن أن تدخل Physical custody/Quarantine دون Available.

### BR-POST-102 — Return accepted دون استلام منتج حالة صريحة

**التصنيف:** Invariant

مثل Refund لخدمة أوتعويض أوLost shipment؛ لا تنشأ Inventory movement وهمية.

### BR-POST-103 — إعادة نفس Posting تعيد نفس النتيجة

**التصنيف:** Invariant

لا تكرر Quantity أوEntitlement.

## 14. Refund

### BR-RFD-200 — Refund تحتاج Financial source

**التصنيف:** Invariant

ترتبط بـ:

- Return.
- Void.
- Service recovery.
- Overcharge correction.
- Failed fulfillment.

### BR-RFD-201 — Refund لا تتجاوز التحصيل القابل للاسترداد

**التصنيف:** Invariant

تحسب لكل Payment أصلية بعد خصم Refunds وReversals السابقة.

### BR-RFD-202 — Refund method تتبع الأصل افتراضيًا

**التصنيف:** Tenant Policy + Provider Constraint

الافتراضي:

- Card إلى البطاقة/المعاملة الأصلية.
- Cash نقدًا ضمن الوردية الحالية.
- Wallet إلى المصدر نفسه عند الدعم.

### BR-RFD-203 — Alternate refund method تحتاج صلاحية

**التصنيف:** Approval Bound

يجب تسجيل:

- Original method.
- New method.
- reason.
- approver.
- legal/provider constraints.

### BR-RFD-204 — Partial refund مدعومة

**التصنيف:** Invariant

يمكن رد جزء من استحقاق Return مع بقاء Liability واضحة حتى التسوية.

### BR-RFD-205 — فشل Refund لا يلغي Return

**التصنيف:** Invariant

- المخزون يبقى وفق Return المعتمدة.
- Financial state تصبح pending/failed.
- Liability تجاه العميل تبقى ظاهرة.

### BR-RFD-206 — Unknown provider outcome أخطر من Failed

**التصنيف:** Invariant

تدخل Reconciliation ولا يسمح بمحاولة ثانية عمياء.

### BR-RFD-207 — Refund النقدية تؤثر على Drawer الحالية

**التصنيف:** Invariant عند تفعيل Shifts

لا تعاد كتابتها في وردية البيع الأصلية.

### BR-RFD-208 — Refund بعد إغلاق الوردية مسموحة في وردية جديدة

**التصنيف:** Invariant

مع ربطها بالبيع والReturn الأصلية وبيان اختلاف الوردية.

## 15. Store Credit

### BR-SCR-100 — Store credit Ledger مستقلة

**التصنيف:** Invariant عند دعمها

لا تنفذ كحقل Balance قابل للتعديل المباشر.

### BR-SCR-101 — الإصدار له Source وExpiry policy

**التصنيف:** Tenant/Legal Policy

يحفظ:

- customer.
- source return.
- amount.
- currency.
- issued at.
- expiry عند السماح.
- status.

### BR-SCR-102 — الاستخدام Payment method مستقلة

**التصنيف:** Invariant

يخصم الرصيد مرة واحدة ويرتبط بSale جديدة.

### BR-SCR-103 — No-receipt return لا تستخدم Store credit قبل جاهزية Ledger

**التصنيف:** Planning Decision

لا تُبنى كحل مؤقت غير محاسبي.

### BR-SCR-104 — Store credit لا تحول نقدًا افتراضيًا

**التصنيف:** Tenant/Legal Policy

أي Cash-out يحتاج قاعدة قانونية وصلاحية واضحة.

## 16. Exchange

### BR-EXC-200 — Exchange عملية مركبة لا مستند غامض

**التصنيف:** Invariant

تحتوي على روابط صريحة بين:

- Original sale.
- Return.
- New sale.
- Settlement.

### BR-EXC-201 — المنتج القديم يستخدم القيمة التاريخية

**التصنيف:** Invariant

والمنتج الجديد يستخدم السعر والقواعد الحالية وقت Exchange، إلا Policy موثقة خلاف ذلك.

### BR-EXC-202 — الفرق الموجب يُحصّل

**التصنيف:** Invariant

إذا كانت قيمة الجديد أعلى، ينشأ Payment للفرق.

### BR-EXC-203 — الفرق السالب يُرد أويسجل Credit

**التصنيف:** Tenant Policy

حسب Refund method policy وStore credit readiness.

### BR-EXC-204 — لا نجاح جزئي مخفي

**التصنيف:** Invariant

إذا نجحت Return وفشل New sale أوSettlement:

- تظهر حالة Exception صريحة.
- لا تختفي Liability أوالبضاعة.
- يتوفر Recovery workflow.

### BR-EXC-205 — Exchange receipt تعرض طرفي العملية

**التصنيف:** Invariant

توضح المرتجع والجديد والفرق وطرق التسوية.

### BR-EXC-206 — الاستبدال بمنتج مماثل ليس Quantity swap صامتًا

**التصنيف:** Invariant

حتى لو كانت القيمة متساوية، تبقى Return وSale منفصلتين لأثر المخزون والضمان والتاريخ.

## 17. Void

### BR-VOID-200 — Void لها نافذة ضيقة

**التصنيف:** Tenant/Location Policy

قد تشترط:

- نفس الوردية.
- عدم وجود Return سابقة.
- عدم اكتمال settlement الخارجي.
- عدم انتقال المنتج أوتغير حيازته.
- صلاحية Supervisor.

### BR-VOID-201 — Void تعكس البيع كاملًا افتراضيًا

**التصنيف:** Planning Decision

Partial void بعد Completion لا تستخدم؛ يعالج الجزء المطلوب عبر Return/Refund.

### BR-VOID-202 — Void تعكس المخزون والمدفوعات حسب حالتها

**التصنيف:** Invariant

- Inventory reversal.
- Payment void/cancel أوRefund حسب Provider.
- Audit كامل.

### BR-VOID-203 — فشل عكس Payment يمنع إظهار Void مكتملة ماليًا

**التصنيف:** Invariant

يمكن أن تصبح Operationally voided وFinancial reversal pending بحالة واضحة، لا Completed زائفة.

### BR-VOID-204 — Void Offline لبيع مؤكد من الخادم ممنوعة افتراضيًا

**التصنيف:** Planning Decision

تحتاج اتصالًا للتحقق من تاريخ المرتجعات والمدفوعات والتسوية.

## 18. الضمان والعيوب

### BR-WAR-100 — Warranty claim ليست Return دائمًا

**التصنيف:** Invariant

قد تنتج:

- repair.
- replacement.
- supplier claim.
- refund.
- rejection.

### BR-WAR-101 — Warranty لها Policy ومدة مستقلة

**التصنيف:** Tenant/Product Policy

لا تستخدم Return window بديلًا عنها.

### BR-WAR-102 — العيب يحتاج Classification

**التصنيف:** Invariant

لفصل:

- manufacturing defect.
- handling damage.
- customer misuse.
- unknown pending inspection.

### BR-WAR-103 — Replacement warranty تربط الأصل والجديد

**التصنيف:** Open Decision

يجب تحديد هل تبدأ مدة ضمان جديدة أميرث الجديد المدة المتبقية.

## 19. منع الاحتيال وإساءة الاستخدام

### BR-FRD-100 — النظام يمنع تكرار الكمية

**التصنيف:** Invariant

التحقق Server-side عبر كل العمليات، لا اعتمادًا على شاشة الجهاز فقط.

### BR-FRD-101 — Duplicate receipt use يكتشف

**التصنيف:** Invariant

لا يمكن استخدام نفس Sale line لأكثر من الكمية المتبقية.

### BR-FRD-102 — Risk signals لا تعني رفضًا آليًا بلا مراجعة

**التصنيف:** Invariant

قد تشمل:

- مرتجعات متكررة.
- No-receipt attempts.
- فروع متعددة.
- قيمة مرتفعة.
- نفس الجهاز أوالموظف.
- Refund methods مختلفة.

### BR-FRD-103 — الموظف لا يعتمد مرتجعه الشخصي

**التصنيف:** Segregation Policy

عند تطابق Customer/Employee identity أووجود تعارض مصالح، يحتاج موافقة مستقلة.

### BR-FRD-104 — Cash refund العالية تحتاج موافقة

**التصنيف:** Approval Bound

الحدود قابلة للتهيئة وتخضع لسعة الوردية والخزنة.

### BR-FRD-105 — تعديل التاريخ المحلي لا يغير الأهلية

**التصنيف:** Invariant

الخادم يستخدم وقتًا موثوقًا وقواعد مزامنة، ولا يعتمد على Device clock وحده.

## 20. Offline behavior

### BR-ROFF-100 — Return وRefund ليستا Offline-first

**التصنيف:** Planning Decision

الإصدار الأول يجعل العمليات المالية والمخزنية النهائية Online-required، لأن الأهلية تعتمد على تاريخ مركزي.

### BR-ROFF-101 — Lookup cached لا يساوي Eligibility نهائية

**التصنيف:** Invariant

يمكن عرض بيانات مرجعية محلية، لكن اعتماد Return يحتاج Server validation.

### BR-ROFF-102 — Offline intake يمكن أن يكون Draft فقط لاحقًا

**التصنيف:** Deferred Capability

يمكن تسجيل المنتج والسبب والصور محليًا، دون:

- زيادة Available.
- إصدار Refund.
- استهلاك Returnable balance نهائيًا.

### BR-ROFF-103 — External card refund تحتاج اتصالًا

**التصنيف:** Invariant

لا توصف ناجحة دون Provider confirmation.

### BR-ROFF-104 — Retry ثابت الهوية

**التصنيف:** Invariant

لا يكرر Return أوRefund أوExchange.

## 21. الفروع والمخازن

### BR-LOC-100 — Return location وRestock warehouse مستقلتان

**التصنيف:** Invariant

قد يستلم الفرع المنتج ثم يوجه إلى Warehouse أوQuarantine مختلفة وفق السياسة.

### BR-LOC-101 — Cross-location return لا تغير تاريخ البيع

**التصنيف:** Invariant

التقارير تحفظ:

- selling location.
- return location.
- stock destination.
- refund shift/location.

### BR-LOC-102 — Return إلى مخزن غير مخول ممنوعة

**التصنيف:** Permission/Scope Bound

المستخدم لا يختار Warehouse خارج Scope المسموح.

## 22. الصلاحيات

### BR-RAU-100 — الصلاحيات منفصلة

**التصنيف:** Invariant

تشمل:

- create return draft.
- approve standard return.
- override return window.
- approve no-receipt return.
- choose disposition.
- release quarantine.
- execute refund.
- alternate refund method.
- void sale.
- issue store credit.
- approve high-value exchange.

### BR-RAU-101 — Approval لا تنسب للكاشير

**التصنيف:** Invariant

تسجل هوية طالب الإجراء والموافق والمنفذ.

### BR-RAU-102 — Cached supervisor PIN ليس موافقة مجهولة

**التصنيف:** Open Decision

إن دعم Offline approval لاحقًا، يجب أن تكون credential محدودة المدة والنطاق ومربوطة بهوية حقيقية.

## 23. Audit وEvents

### BR-RAUD-100 — كل Transition حرجة تسجل

**التصنيف:** Invariant

تشمل:

- Return requested.
- Eligibility passed/failed/overridden.
- Inspection completed.
- Return approved/rejected.
- Inventory disposition posted.
- Refund initiated/pending/completed/failed/reconciled.
- Exchange started/completed/exception.
- Void requested/approved/completed/partial failure.
- Store credit issued/redeemed/expired عند دعمها.

### BR-RAUD-101 — السبب والقيم قبل وبعد محفوظة

**التصنيف:** Invariant

خاصة للـOverrides والـalternate refund method وتغيير disposition.

### BR-RAUD-102 — Provider references تربط بأصلها

**التصنيف:** Invariant

Payment وRefund وReversal references قابلة للتتبع دون تخزين بيانات حساسة.

## 24. الأخطاء والاسترداد

### BR-RERR-100 — الخطأ يوضح وضع المنتج والمال

**التصنيف:** Invariant

تظهر للمستخدم حقائق منفصلة:

- هل Return اعتمدت؟
- أين دخل المنتج؟
- هل Refund نجحت؟
- هل بقي مبلغ مستحق؟
- هل Exchange sale اكتملت؟
- ما الخطوة التالية؟

### BR-RERR-101 — لا تكرار يدوي عند Unknown outcome

**التصنيف:** Invariant

يستخدم Inquiry/Reconciliation وReference ID.

### BR-RERR-102 — Recovery لا يعتمد Direct SQL

**التصنيف:** Invariant

Workflows مطلوبة لـ:

- retry refund.
- reconcile provider outcome.
- correct disposition.
- complete exchange settlement.
- reverse erroneous return إذا كان ممكنًا.
- issue compensating document.

### BR-RERR-103 — عكس Return مقيد بالحركات اللاحقة

**التصنيف:** Invariant

لا تعكس Return إذا تم بيع أوتحويل الكمية المعادة دون معالجة Dependencies.

## 25. التقارير

### BR-RREP-100 — Returns وRefunds تقارير منفصلة

**التصنيف:** Invariant

التقارير تفرق بين:

- returned units.
- returned merchandise value.
- refunded cash/card value.
- outstanding customer liability.
- store credit issued.
- exchange value.

### BR-RREP-101 — Return rate لها أكثر من مقام

**التصنيف:** Invariant

يمكن قياسها حسب:

- units.
- gross value.
- net value.
- orders.
- customers.

### BR-RREP-102 — الأسباب والحالة قابلة للتحليل

**التصنيف:** Invariant

حسب المنتج والVariant والفرع والموظف والسبب والDisposition والمورد.

### BR-RREP-103 — Net sales لا تحسب من Delete

**التصنيف:** Invariant

تحسب من Sales وReturns وVoids والخصومات وفق المستندات المرتبطة.

### BR-RREP-104 — Cash drawer report يشمل Refunds الحالية

**التصنيف:** Invariant

حتى لو كانت Sale الأصلية في يوم أوفرع آخر.

## 26. السيناريوهات الإلزامية للاختبار لاحقًا

1. Full return لفاتورة نقدية.
2. Partial quantity return.
3. Returns متعددة لنفس السطر حتى الحد.
4. محاولة تجاوز الكمية المباعة.
5. Return داخل وخارج النافذة.
6. Supervisor override للنافذة.
7. Return في فرع مختلف.
8. منتج صالح يعاد إلى Available.
9. منتج defective إلى Quarantine.
10. Release من Quarantine إلى Available.
11. Disposition إلى Damaged.
12. Partial refund.
13. Refund إلى طريقة الدفع الأصلية.
14. Alternate refund method.
15. Card refund timeout/unknown.
16. Refund failure بعد Return ناجحة.
17. Split-payment refund موزعة على أكثر من Payment.
18. Exchange بفرق موجب.
19. Exchange بفرق سالب.
20. Exchange بقيمة متساوية.
21. فشل Sale الجديدة بعد Return في Exchange.
22. Promotion Buy-X-Get-Y partial return.
23. Final-sale item.
24. No-receipt attempt.
25. Duplicate retry لنفس Return.
26. Duplicate provider refund reference.
27. Void داخل نفس الوردية.
28. Void بعد settlement.
29. Return بعد إغلاق الوردية.
30. Cash refund في وردية جديدة.
31. Return لمنتج Serial-tracked.
32. محاولة عكس Return بعد بيع الكمية المعادة.
33. Printer failure بعد اكتمال Return/Refund.
34. Cross-tenant return rejection.
35. Device clock manipulation لا يغير eligibility.

## 27. القرارات المفتوحة

### OD-RET-001 — Return window الافتراضية

تُحسم بعد مقابلات السوق والقطاع؛ لا تثبت كرقم عالمي في Core.

### OD-RET-002 — No-receipt returns في MVP

**الاقتراح:** ممنوعة في MVP، مع Supervisor service-recovery workflow منفصل لا يدعي وجود Sale أصلية.

### OD-RET-003 — Cross-location returns

**الاقتراح:** مسموحة داخل Tenant للخطط متعددة الفروع، مع توجيه المخزون ومحاسبة الفرع بصورة واضحة.

### OD-RET-004 — Default disposition

**الاقتراح:** `pending inspection` أو`quarantine` للعيوب، و`available` فقط بعد تأكيد condition القابلة للبيع.

### OD-RET-005 — Refund timing

**الاقتراح:** Return وRefund يمكن أن تكونا منفصلتين في الحالة، لكن المسار العادي يحاول إتمامهما في Workflow واحد ويظهر أي Partial failure.

### OD-RET-006 — Alternate refund methods

**الاقتراح:** ممنوعة افتراضيًا، وتحتاج Supervisor approval وسبب.

### OD-RET-007 — Store credit في MVP

**الاقتراح:** مؤجلة حتى تصميم Customer Liability Ledger؛ لا تستخدم كحل سريع.

### OD-RET-008 — Exchanges في MVP

**الاقتراح:** مدعومة كReturn + New Sale + Settlement، لا ككيان مالي مختصر.

### OD-RET-009 — Promotions and free gifts

تحتاج Return behavior في Promotion Rule نفسها قبل إطلاق Promotion engine.

### OD-RET-010 — Restocking fees

**الاقتراح:** غير مفعلة افتراضيًا، وتحتاج مراجعة قانونية ورسالة شفافة عند دعمها.

### OD-RET-011 — Offline returns

**القرار المبدئي:** Online-required؛ Offline intake draft تؤجل.

### OD-RET-012 — Warranty workflow

تُفصل لاحقًا عن Standard returns مع إمكان الربط بينهما.

## 28. خارج النطاق حاليًا

- Automated fraud scoring يرفض العملاء تلقائيًا.
- Marketplace seller returns.
- Home pickup logistics.
- Carrier label generation.
- Repair center management الكامل.
- Insurance claims.
- Store credit قبل Ledger مستقل.
- Loyalty points reversals قبل Loyalty Blueprint.
- Cross-border tax reclaim.
- Return merchandise authorization portal عام.

## 29. Dependencies

هذه الوثيقة تغذي:

- Return State Machine.
- Refund State Machine.
- Exchange orchestration.
- Void State Machine.
- Inventory movements and dispositions.
- Payment reconciliation.
- Shift and drawer rules.
- Permission Matrix.
- Event and Audit Catalogs.
- API and Error Contracts.
- Sync/Offline Protocols.
- Database Blueprint.
- Reporting Model.
- Customer risk signals.

## 30. Acceptance Gate

لا تعتبر Returns planning مكتملة قبل:

1. اعتماد Return window model والفئات المستثناة.
2. اعتماد Cross-location policy.
3. اعتماد Condition وDisposition catalogs.
4. اعتماد Refund method matrix.
5. اعتماد Void مقابل Return criteria.
6. اعتماد Exchange orchestration.
7. حسم No-receipt وStore credit scope.
8. اعتماد Promotion return behavior contract.
9. ربط كل Inventory effect بقواعد المخزون.
10. ربط كل Financial effect بقواعد المدفوعات.
11. تحويل كل Rule حرجة إلى State transition أوPermission أوConstraint أوTest requirement لاحقًا.

## 31. القرار التخطيطي الحالي

- المرتجع وRefund منفصلان لكن مرتبطان.
- الاستبدال ينفذ كReturn + New Sale + Settlement.
- Partial returns وPartial refunds مدعومة.
- الكمية والقيمة لا تتجاوزان الأصل المتبقي.
- No-receipt returns وStore credit خارج MVP مبدئيًا.
- Return المعقدة وRefund الإلكترونية Online-required في الإصدار الأول.
- المنتج المرتجع لا يدخل Available تلقائيًا؛ Disposition قرار موثق.
- فشل Refund لا يلغي Return، بل ينشئ Liability وRecovery queue واضحة.
- Void كاملة فقط ضمن نافذة وشروط ضيقة؛ التصحيح الجزئي يتم عبر Return/Refund.