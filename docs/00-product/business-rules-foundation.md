# ATHR Business Rules Bible — Foundation v1.0

**Draft for Structured Expansion**

## 1. وظيفة الوثيقة

هذه الوثيقة هي المرجع الأعلى لقواعد العمل في أثر.

أي Workflow أوState Machine أوAPI أوDatabase constraint يجب أن يطابق هذه القواعد. عند التعارض، لا يُصلح الكود مباشرة؛ يُراجع القرار التجاري أولًا ثم تُحدّث الوثائق والعقود التابعة.

## 2. صيغة كل Rule

كل قاعدة لاحقة يجب أن تحتوي على:

- Rule ID.
- Domain.
- Statement.
- Trigger.
- Preconditions.
- Allowed action.
- Forbidden action.
- Resulting state.
- Inventory effect.
- Financial effect.
- Audit effect.
- Offline behavior.
- Required permission.
- Failure behavior.
- Recovery path.
- Exceptions.
- Evidence required.

## 3. المبادئ العليا

### BR-GEN-001 — الحقيقة التشغيلية واحدة

لا توجد نسخ مستقلة متعارضة من حقيقة البيع أوالمخزون بين POS وBackend وReports.

- الجهاز قد يحتفظ بحالة محلية مؤقتة.
- الخادم هو المرجع النهائي بعد التأكيد.
- أي اختلاف يجب أن يظهر كحالة Pending أوConflict، لا أن يُخفى.

### BR-GEN-002 — كل أثر مالي أو مخزني يحدث مرة واحدة

إعادة المحاولة أوانقطاع الشبكة لا يسمحان بإنشاء أثر مكرر.

ينطبق ذلك على:

- الفواتير.
- المدفوعات.
- خصم المخزون.
- المرتجعات.
- الاستلام.
- التحويل.
- التسويات.

### BR-GEN-003 — لا تعديل صامت للتاريخ

بعد اعتماد عملية تؤثر على المال أوالمخزون:

- لا تُعدّل صفوفها الجوهرية مباشرة.
- التصحيح يتم بعملية عكس أوتسوية أومستند مرتبط.
- يبقى التاريخ الأصلي ظاهرًا.

### BR-GEN-004 — كل عملية لها Scope واضح

كل عملية يجب أن ترتبط، حسب نوعها، بـ:

- Tenant.
- Location.
- Warehouse.
- Terminal.
- Shift.
- User/Actor.

لا تُقبل عملية حرجة بدون Scope مكتمل.

### BR-GEN-005 — المنع أفضل من التصحيح الغامض

عند عدم تحقق شرط جوهري، يمنع النظام العملية برسالة واضحة بدل قبولها ثم محاولة تصحيحها لاحقًا.

### BR-GEN-006 — Offline لا يعني قواعد أضعف

البيع Offline يخضع لنفس Business invariants قدر الإمكان.

أي Rule لا يمكن التحقق منها Offline يجب أن تُصنف مسبقًا كواحدة من:

- ممنوعة Offline.
- مسموحة بحدود محلية.
- مسموحة Pending server validation.

## 4. قواعد المؤسسة والـScope

### BR-TEN-001 — كل بيانات العميل مملوكة لـTenant واحد

لا يجوز أن تنتمي فاتورة أوحركة مخزون أوعضوية أوجهاز إلى أكثر من Tenant.

### BR-TEN-002 — المستخدم العالمي لا يمنح صلاحية تلقائية

وجود Global Identity لا يسمح بالدخول لأي Tenant دون Membership فعالة.

### BR-TEN-003 — كل Membership لها حالة

الحالات المبدئية:

- invited.
- active.
- suspended.
- deactivated.

الحالة غير الفعالة تمنع العمليات الجديدة مع الحفاظ على التاريخ.

### BR-TEN-004 — Location ليست Warehouse

- Location تمثل وحدة تشغيل تجارية.
- Warehouse تمثل وحدة حفظ مخزون.
- قد يحتوي Location على Warehouse واحد أوأكثر.
- قد يوجد Warehouse مركزي غير مرتبط ببيع مباشر.

### BR-TEN-005 — إلغاء الكيان لا يحذف التاريخ

إلغاء Location أوWarehouse أوTerminal أوUser يجعلها غير متاحة للعمليات الجديدة، لكنه لا يحذف مراجع العمليات السابقة.

## 5. قواعد الهوية والجلسة

### BR-ID-001 — كل عملية بشرية لها Actor

أي عملية ينفذها مستخدم يجب أن تسجل هوية المستخدم الفعلية، لا مجرد اسم Role.

### BR-ID-002 — كل عملية POS لها Terminal Identity

لا تُقبل عملية POS حرجة من جهاز غير مسجل أوملغى.

### BR-ID-003 — Terminal مرتبط بـTenant وLocation

لا يجوز للجهاز تبديل Tenant أوLocation ضمن جلسة فعالة دون إعادة Enrollment أوسياسة معتمدة.

### BR-ID-004 — Support access مؤقت

وصول فريق الدعم إلى بيانات العميل:

- يحتاج سببًا.
- له بداية ونهاية.
- يسجل في Audit.
- لا يمنح بشكل دائم افتراضيًا.

## 6. قواعد المنتج والـCatalog

### BR-CAT-001 — البيع يتم على Variant قابلة للبيع

Product الأب لا يُباع مباشرة عندما يحتوي Variants فعلية.

### BR-CAT-002 — Barcode لا يحدد أكثر من Variant فعالة داخل نفس Tenant

يمكن الاحتفاظ بتاريخ Barcode قديمة، لكن لا يجوز أن تشير Barcode فعالة واحدة إلى أكثر من Variant قابلة للبيع داخل نفس Tenant.

### BR-CAT-003 — تعطيل Variant لا يمحو التاريخ

التعطيل يمنع إضافتها لعمليات جديدة، مع استمرار ظهورها في الفواتير والحركات القديمة.

### BR-CAT-004 — السعر المستخدم يُثبت داخل سطر البيع

تغيير قائمة الأسعار لاحقًا لا يغير أسعار الفواتير السابقة.

### BR-CAT-005 — التكلفة والسعر قيمتان منفصلتان

سعر البيع لا يُستخدم بديلًا عن تكلفة المخزون، والعكس.

## 7. قواعد المخزون

### BR-INV-001 — Ledger هو مصدر تفسير الرصيد

الرصيد الحالي يجب أن يكون قابلًا للاشتقاق أوالمطابقة مع الحركات المعتمدة.

### BR-INV-002 — لا حركة مخزون بلا Source

كل Movement ترتبط بمصدر مثل:

- purchase receipt.
- sale.
- return.
- transfer shipment.
- transfer receipt.
- stock count adjustment.
- damage/loss.
- opening balance.

### BR-INV-003 — الحركة المعتمدة Immutable

لا يتم تعديل quantity أوsource أوwarehouse لحركة معتمدة. التصحيح يتم بحركة عكس أومكملة.

### BR-INV-004 — الرصيد يُقاس لكل Variant وWarehouse

لا يوجد رصيد عام غير محدد الموقع في العمليات اليومية.

### BR-INV-005 — Negative stock سياسة، لا حادثة ضمنية

لكل Tenant أوLocation سياسة محددة:

- forbid.
- allow with warning.
- allow by permission.

يجب ألا ينتج Negative stock بدون تسجيل سبب وهوية المنفذ.

### BR-INV-006 — Available ليست On-hand دائمًا

عند وجود Reservations أوIn-transit quantities، يجب الفصل بين:

- on-hand.
- reserved.
- available.
- in-transit.
- damaged/quarantined عند تطبيقها.

### BR-INV-007 — الجرد لا يغير الرصيد مباشرة أثناء العد

جلسة الجرد تسجل counted quantity أولًا. التغيير الفعلي يحدث عند اعتماد Adjustment.

## 8. قواعد البيع

### BR-SAL-001 — البيع يحتاج Context صالحًا

قبل إتمام البيع:

- Tenant فعال.
- Location فعال.
- Terminal فعال.
- User Membership فعالة.
- Shift مفتوحة إذا كانت سياسة النشاط تتطلب ذلك.

### BR-SAL-002 — الفاتورة لا تؤثر على المخزون وهي Draft

إضافة سطور أوتعديلها داخل Draft لا ينشئ Movement نهائية.

### BR-SAL-003 — Completion عملية ذرية منطقيًا

إتمام البيع يجب أن ينتج كوحدة واحدة:

- Invoice confirmed.
- Lines fixed.
- Payment state recorded.
- Inventory movements created.
- Audit/event emitted.

إذا تعذر جزء جوهري، لا تظهر العملية Completed زائفًا.

### BR-SAL-004 — كل Sale لها Idempotency identity

نفس محاولة البيع من نفس الجهاز لا تُنشئ أكثر من Sale واحدة عند إعادة الإرسال.

### BR-SAL-005 — تغيير السعر يحتاج سلطة

الخصم أوManual price override يحتاج Permission، وقد يحتاج سببًا أوApproval حسب الحدود.

### BR-SAL-006 — لا حذف لفاتورة مكتملة

المسموح:

- void وفق سياسة محددة قبل التسوية النهائية.
- return.
- correction document.

### BR-SAL-007 — حالة الدفع مستقلة عن حالة المستند

لا يُفترض أن كل Invoice مكتملة مدفوعة بالكامل. الحالات المالية قد تشمل:

- unpaid.
- partially paid.
- paid.
- overpaid عند دعمها.
- refunded/partially refunded.

### BR-SAL-008 — الطباعة لا تغير العملية

إعادة طباعة الفاتورة لا تنشئ بيعًا جديدًا ولا تغير حالته.

## 9. قواعد الدفع

### BR-PAY-001 — كل Payment لها Method ومبلغ وعملة ومرجع

المرجع قد يكون داخليًا أوخارجيًا حسب طريقة الدفع.

### BR-PAY-002 — مجموع المدفوعات لا يُفترض مساواته تلقائيًا بالإجمالي

يجب دعم الحالات المؤقتة أوالمسموح بها وفق سياسة البيع.

### BR-PAY-003 — Refund عملية مستقلة

الـRefund لا يعدل Payment الأصلية صامتًا؛ ينشئ سجلًا مرتبطًا بها.

### BR-PAY-004 — Payment retry لا تكرر التحصيل

عند التكامل مع مزود دفع، تستخدم Idempotency identity مستقلة عن Sale identity عند الحاجة.

## 10. قواعد المرتجعات والاستبدال

### BR-RET-001 — المرتجع يرتبط ببيع أصلي كلما أمكن

المرتجع بدون فاتورة أصلية يكون Policy منفصلة وPermission أعلى.

### BR-RET-002 — لا يمكن إرجاع كمية أكبر من الصافي القابل للإرجاع

```
Returnable Quantity
= Sold Quantity
- Previously Returned Quantity
- Exchanged-out Quantity حسب النموذج المعتمد
```

### BR-RET-003 — عودة المخزون تعتمد على حالة السلعة

الصنف المرتجع قد يذهب إلى:

- sellable stock.
- damaged.
- quarantine/inspection.

لا يُعاد تلقائيًا للمخزون القابل للبيع دون قرار الحالة.

### BR-RET-004 — Refund والعودة للمخزون أثران منفصلان

قد يحدث أحدهما دون الآخر وفق الحالة والسياسة، ويجب ألا يفترض النظام تلازمهما دائمًا.

### BR-RET-005 — Exchange ليس حذفًا وبيعًا صامتين

الاستبدال يجب أن يترك سلسلة مرجعية واضحة بين المرتجع والبيع الجديد وأي فرق مالي.

## 11. قواعد الوردية

### BR-SHF-001 — الوردية تخص Terminal وUser رئيسيًا

كل Shift ترتبط بجهاز وموقع ومستخدم مسؤول عند الفتح.

### BR-SHF-002 — لا توجد ورديتان مفتوحتان متعارضتان على نفس Terminal

يحدد التصميم لاحقًا ما إذا كان مسموحًا بأكثر من User داخل الوردية، لكن ملكية الوردية الأساسية يجب أن تكون واضحة.

### BR-SHF-003 — الرصيد الافتتاحي والختامي مثبتان

أي Cash variance يجب أن تسجل، لا أن تُعدل لتساوي المتوقع.

### BR-SHF-004 — إغلاق الوردية لا يمحو العمليات Pending

إذا وجدت عمليات Local أوSync pending، يظهر ذلك كاستثناء واضح ويُطبق Policy محددة للإغلاق.

### BR-SHF-005 — لا تعديل مباشر لوردية مغلقة

التصحيح يتم عبر Adjustment أوSupervisor action مسجلة.

## 12. قواعد الشراء والاستلام

### BR-PUR-001 — أمر الشراء لا يزيد المخزون

الزيادة تحدث عند Receipt معتمدة، لا عند إنشاء أوApproval أمر الشراء.

### BR-PUR-002 — الاستلام الجزئي مسموح

يجب تتبع ordered وreceived وremaining لكل Line.

### BR-PUR-003 — لا استلام يتجاوز المتبقي دون Policy

Over-receipt يحتاج سماحًا صريحًا وحدودًا وسببًا.

### BR-PUR-004 — تكلفة الاستلام تثبت وفق سياسة التكلفة

تغيّر التكلفة بعد الاستلام يحتاج مستند تصحيح، لا تعديلًا صامتًا.

### BR-PUR-005 — Supplier return حركة مستقلة

تعكس المخزون وتحتفظ بمرجع إلى Receipt أوPurchase source.

## 13. قواعد التحويل

### BR-TRF-001 — المصدر والوجهة مختلفان

لا يجوز تحويل المخزون من Warehouse إلى نفسها.

### BR-TRF-002 — Draft لا تحجز أوتخصم إلا وفق Policy معلنة

السياسة الافتراضية المقترحة:

- Draft: لا أثر مخزني.
- Approved: Reservation في المصدر.
- Shipped: خصم On-hand من المصدر وزيادة In-transit.
- Received: خفض In-transit وزيادة On-hand في الوجهة.

### BR-TRF-003 — السطور تصبح Immutable بعد Approval

أي تغيير يحتاج إلغاء وإعادة إنشاء أونسخة Revision معتمدة.

### BR-TRF-004 — الاستلام الجزئي لا يغلق التحويل تلقائيًا

يبقى التحويل Partially received حتى استلام المتبقي أوإغلاقه بقرار discrepancy/cancellation.

### BR-TRF-005 — الاستلام المكرر ممنوع

نفس Receipt command لا تزيد مخزون الوجهة أكثر من مرة.

### BR-TRF-006 — الفروقات تسجل

Shortage أوexcess أوdamage أثناء التحويل تحتاج Reason وActor وقرار معالجة.

## 14. قواعد المزامنة والعمل دون اتصال

### BR-SYN-001 — كل Command محلية لها Stable ID

الهوية لا تتغير عند إعادة التشغيل أوإعادة المحاولة.

### BR-SYN-002 — الحفظ المحلي يسبق رسالة النجاح المحلية

لا تظهر POS أن البيع محفوظ إلا بعد Commit محلي ناجح للفواتير والسطور والـOutbox.

### BR-SYN-003 — Acknowledgement لا يسبق Server commit

لا تُحذف أوتُعلّم Outbox كمنتهية قبل تأكيد الخادم.

### BR-SYN-004 — Conflict لا يُحل بصمت

عند اختلاف لا يمكن حله تلقائيًا:

- تسجل الحالة.
- تمنع الأثر المكرر.
- تعرض الإجراء المطلوب.

### BR-SYN-005 — ترتيب الأحداث يُحفظ حيث يكون مهمًا

العمليات التي تعتمد على سابقة، مثل فتح الوردية ثم البيع، تحتاج Ordering أوقاعدة تحقق تمنع التطبيق الخاطئ.

### BR-SYN-006 — بيانات المرجع لها Version أوCursor

Sync pull يجب أن يستطيع الاستكمال دون Snapshot كامل في كل مرة.

## 15. قواعد الصلاحيات

### BR-AUT-001 — Permission وEntitlement مختلفتان

- Permission: ماذا يسمح لهذا المستخدم أن يفعل؟
- Entitlement: ماذا تسمح خطة العميل باستخدامه؟

يجب تحقق الاثنين عند الحاجة.

### BR-AUT-002 — Scope جزء من السماح

امتلاك Permission عامة لا يعني التنفيذ على كل Location أوWarehouse.

### BR-AUT-003 — العمليات الحساسة تحتاج Reason

مثل:

- price override.
- negative stock override.
- manual adjustment.
- no-receipt return.
- shift correction.
- support access.

### BR-AUT-004 — الموافقة لا ينفذها مقدم الطلب عند فصل الواجبات

عندما تفعّل Policy الفصل، لا يجوز للشخص نفسه طلب العملية واعتمادها.

## 16. قواعد التدقيق

### BR-AUD-001 — Audit append-only منطقيًا

لا يعدّل المستخدم سجل Audit قديمًا.

### BR-AUD-002 — Audit تسجل من فعل ماذا وأين ومتى

وتشمل قبل/بعد عندما يكون ذلك آمنًا ومفيدًا، دون تسريب أسرار.

### BR-AUD-003 — القراءة الحساسة قد تحتاج Audit

مثل دخول Support أوتصدير بيانات شامل.

### BR-AUD-004 — فشل العملية الحرجة قابل للتتبع

يسجل Request/Correlation ID وسبب الفشل التقني، مع رسالة مستخدم منفصلة.

## 17. قواعد التقارير

### BR-RPT-001 — التقارير لا تعيد تعريف الحقيقة

التقرير يقرأ من مصادر معتمدة أوProjections قابلة للمطابقة، ولا يبتكر قواعد حساب منفصلة عن الـDomain.

### BR-RPT-002 — كل Metric لها Definition

تحدد:

- Formula.
- Time zone.
- Included states.
- Excluded states.
- Currency behavior.
- Refund behavior.

### BR-RPT-003 — التقرير يوضح حداثة البيانات

خاصة عند وجود Sync أوProjection delay.

## 18. قواعد الحذف والاحتفاظ

### BR-DAT-001 — العمليات المالية والمخزنية لا تُحذف Hard delete في التشغيل العادي

تُلغى أوتُؤرشف وفق نوعها.

### BR-DAT-002 — حذف البيانات الشخصية منفصل عن حفظ السجل التجاري

عند تطبيق طلبات الخصوصية، قد تُخفى أوتُعمى بيانات شخصية مع الحفاظ على السجل المطلوب قانونيًا وتشغيليًا.

### BR-DAT-003 — Export حق تشغيلي

يستطيع العميل تصدير بياناته وفق الصلاحيات والسياسة المعتمدة.

## 19. ترتيب التوسع التالي

سيتم توسيع هذه الوثيقة إلى أقسام تفصيلية مستقلة بالترتيب:

1. Sales and Payments Rules.
2. Inventory and Stock Count Rules.
3. Returns, Refunds and Exchanges Rules.
4. Shift and Cash Management Rules.
5. Purchasing and Supplier Rules.
6. Transfer and In-transit Rules.
7. Catalog, Pricing and Promotions Rules.
8. Identity, Tenant and Access Rules.
9. Sync and Offline Rules.
10. Billing and Subscription Rules.
11. Reporting and Audit Rules.
12. Data Lifecycle and Compliance Rules.

## 20. القرارات المفتوحة

لا تُحل بالكود قبل التخطيط:

- هل Negative stock ممنوعة افتراضيًا أمPolicy لكل Tenant؟
- هل Sale يمكن أن تكتمل مع Payment ناقصة؟
- ما سياسة البيع Offline عند معلومات سعر قديمة؟
- هل يلزم Shift لكل أنواع العملاء؟
- كيف يعالج إغلاق Shift مع Outbox pending؟
- هل Approval تحجز المخزون في Transfer أمShipment فقط؟
- ما سياسة Returns بدون Receipt؟
- ما Costing method في الإصدار الأول؟
- هل Customer credit داخل النطاق الأول؟
- ما تعريف Business day والـtimezone؟

## 21. بوابة الاعتماد

Foundation تعتبر معتمدة عندما:

- لا توجد قاعدة عليا متعارضة.
- كل Domain رئيسي ممثل.
- القرارات المفتوحة ظاهرة وليست مخفية داخل Assumptions.
- يمكن استخدام Rule IDs في State Machines وAPIs والاختبارات لاحقًا.

---