# ATHR Shift, Cash Drawer & Terminal Operations Business Rules v1.0

**Planning Baseline — POS Operational Identity, Shifts, Cash Control and Terminal Health**

## 1. وظيفة الوثيقة

هذه الوثيقة هي المرجع التفصيلي لقواعد:

- تسجيل وربط أجهزة الـPOS.
- Terminal enrollment والتفعيل والتعطيل.
- User sessions على الجهاز.
- فتح وإدارة وإغلاق الورديات.
- Cash drawer sessions والعهدة الافتتاحية.
- Cash sales وRefunds وCash in/out.
- المتوقع مقابل المعدود وفروق الخزنة.
- Handover بين الموظفين.
- العمليات المعلقة وOffline sales.
- Crash recovery واستعادة الوردية.
- Business day وEnd-of-day.
- حالة الجهاز والمزامنة والمراقبة.
- الصلاحيات والموافقات والتدقيق والتقارير.

لا تخلط الوثيقة بين User session وShift وCash drawer وTerminal وBusiness day؛ كل واحد كيان تشغيلي مستقل بعلاقات واضحة.

## 2. المصطلحات

### Terminal

جهاز POS مسجل داخل Tenant ومربوط بنطاق تشغيلي محدد.

### Terminal Enrollment

عملية ربط Installation فعلية بهوية Terminal موثوقة وإصدار Credentials أوLease آمنة.

### User Session

جلسة دخول مستخدم إلى الجهاز أوالتطبيق. قد تبدأ وتنتهي دون فتح أوإغلاق Shift.

### Shift

فترة مسؤولية تشغيلية مرتبطة بمستخدم أوفريق وLocation وTerminal policy، تحتوي معاملات ومراقبة وأحداثًا.

### Cash Drawer

وحدة حفظ النقد الفعلية أوالمنطقية. قد تكون مدمجة بجهاز أوتستخدمها عدة محطات وفق Policy.

### Cash Drawer Session

فترة محاسبة نقدية تبدأ بعهدة افتتاحية وتنتهي بعد العد والتسوية.

### Float / Opening Cash

النقد المخصص لبدء العمل وإرجاع الباقي، وليس إيرادًا من المبيعات.

### Cash Movement

أي زيادة أونقص نقدي موثق في الدرج، مثل Sale وRefund وCash in وCash out وSafe drop.

### Tender Summary

تجميع المدفوعات حسب الطريقة والحالة، منفصل عن Drawer cash balance.

### Business Day

فترة تشغيلية/تقريرية للفرع قد تعبر منتصف الليل، ولا تساوي Calendar date بالضرورة.

### Handover

نقل مسؤولية تشغيلية أوعهدة من مستخدم إلى آخر وفق Workflow موثقة.

## 3. المبادئ غير القابلة للتفاوض

### BR-OPS-100 — كل معاملة لها Actor وTerminal وScope

**التصنيف:** Invariant

أي عملية POS حرجة تسجل:

- Tenant.
- Location.
- Terminal.
- User/Actor.
- Shift عند وجوبها.
- Cash drawer session عند وجود أثر نقدي.

### BR-OPS-101 — Shift لا تساوي User Session

**التصنيف:** Invariant

تسجيل الخروج لا يغلق الوردية تلقائيًا، وتغيير المستخدم لا ينقل المسؤولية النقدية صامتًا.

### BR-OPS-102 — Cash Drawer Session لا تساوي Shift دائمًا

**التصنيف:** Invariant

يمكن للمنتج دعم:

- Shift واحدة وDrawer session واحدة.
- عدة Users داخل Shift فريق.
- Handover لعهدة واحدة.

لكن العلاقة المختارة لكل Tenant يجب أن تكون صريحة وغير قابلة للتأويل.

### BR-OPS-103 — كل حركة نقد لها Source

**التصنيف:** Invariant

لا يعدل Expected cash balance بحقل يدوي؛ يُشتق من Opening float وحركات نقد موثقة.

### BR-OPS-104 — الفرق النقدي لا يغير المبيعات

**التصنيف:** Invariant

Cash over/short يسجل كتسوية وردية مستقلة، ولا يعدل Invoice أوPayment التاريخية.

### BR-OPS-105 — Retry أوCrash لا يكرر حركة نقدية

**التصنيف:** Invariant

كل Cash movement حرجة لها Idempotency identity.

### BR-OPS-106 — Offline لا يزيل المسؤولية

**التصنيف:** Invariant

العمليات Offline تظل مرتبطة بالوردية والجهاز والمستخدم، وتظهر Pending حتى تأكيد الخادم.

## 4. Terminal identity

### BR-TRM-100 — كل Installation فعالة لها Terminal identity

**التصنيف:** Invariant

لا يسمح لجهاز غير مسجل بإنشاء معاملات نهائية.

### BR-TRM-101 — Terminal مملوكة لـTenant واحد

**التصنيف:** Invariant

لا تنتقل بين Tenants بمجرد تغيير Config محلي.

### BR-TRM-102 — Terminal مرتبطة بـLocation

**التصنيف:** Invariant

تغيير Location يحتاج Reassignment أوRe-enrollment مصرحًا، مع إغلاق أوتسوية العمليات المفتوحة.

### BR-TRM-103 — Terminal لها حالة

**التصنيف:** Invariant

الحالات المبدئية:

- pending enrollment.
- active.
- suspended.
- revoked.
- retired.
- replacement pending.

### BR-TRM-104 — Revocation تمنع عمليات جديدة

**التصنيف:** Invariant

- تظل البيانات المحلية قابلة للاستخراج/الاسترداد وفق Runbook.
- لا يسمح ببيع جديد بعد انتهاء Offline lease.

### BR-TRM-105 — Terminal credentials ليست User credentials

**التصنيف:** Security Invariant

الجهاز يثبت هويته، والمستخدم يثبت هويته بصورة منفصلة.

### BR-TRM-106 — نسخ ملفات التطبيق لا ينسخ Terminal شرعية

**التصنيف:** Security Invariant

الهوية مرتبطة بمفاتيح/أسرار ونطاق آمن، وليس ID داخل ملف نصي قابل للنسخ.

### BR-TRM-107 — إعادة التثبيت لها Recovery workflow

**التصنيف:** Invariant

تحدد هل:

- تستعيد نفس Terminal.
- تنشئ Replacement terminal.
- تسحب القديمة.

ويجب معالجة Outbox والوردية المفتوحة قبل القرار.

## 5. Enrollment

### BR-ENR-100 — Enrollment تحتاج Authorization

**التصنيف:** Permission Bound

الطرق الممكنة:

- one-time enrollment code.
- admin approval.
- signed provisioning package.

### BR-ENR-101 — Enrollment code قصيرة العمر وأحادية الاستخدام

**التصنيف:** Security Invariant

### BR-ENR-102 — Enrollment تثبت Scope

**التصنيف:** Invariant

تحدد:

- Tenant.
- Location.
- terminal name/number.
- allowed capabilities.
- offline lease policy.

### BR-ENR-103 — إعادة Enrollment لا تمحو التاريخ

**التصنيف:** Invariant

تحفظ علاقة الجهاز القديم والجديد وسبب الاستبدال.

### BR-ENR-104 — تفعيل الجهاز Event قابلة للتدقيق

**التصنيف:** Invariant

تسجل Administrator ووقت ومصدر ونطاق التفعيل.

## 6. Terminal capabilities

### BR-CAP-100 — capabilities صريحة

**التصنيف:** Tenant/Location Policy

مثل:

- sale.
- return.
- cash drawer.
- external card terminal.
- label/receipt printing.
- stock lookup.
- stock count draft.

### BR-CAP-101 — capability لا تمنح User permission

**التصنيف:** Invariant

يجب تحقق الجهاز والمستخدم معًا.

### BR-CAP-102 — Hardware dependencies لها حالة

**التصنيف:** Invariant

مثل:

- printer.
- scanner.
- customer display.
- drawer.
- payment terminal.

تعطلها لا يعني دائمًا تعطيل الجهاز كله؛ تحدد Impact policy لكل Capability.

## 7. User Session

### BR-USS-100 — كل مستخدم يدخل بهويته

**التصنيف:** Invariant

Shared cashier accounts ممنوعة.

### BR-USS-101 — الجلسة مرتبطة بـMembership فعالة

**التصنيف:** Invariant

Suspension أوrevocation تمنع Session جديدة، وتطبق على الحالية وفق Security policy وOffline lease.

### BR-USS-102 — Lock لا يساوي Logout

**التصنيف:** Invariant

- Lock يحمي الشاشة ويحافظ على Context.
- Unlock يحتاج نفس المستخدم أوSupervisor takeover workflow.

### BR-USS-103 — Session timeout Policy

**التصنيف:** Tenant/Location Policy

تراعي سرعة POS مع منع بقاء الجهاز مفتوحًا دون رقابة.

### BR-USS-104 — المستخدم الحالي ظاهر دائمًا

**التصنيف:** UX Invariant

اسم المستخدم والوردية والـTerminal واضحة في شاشة البيع.

### BR-USS-105 — تغيير المستخدم لا ينسب Cart سابقة للثاني صامتًا

**التصنيف:** Invariant

Suspended/open carts تحفظ منشئها وأي من أكملها.

## 8. فتح الوردية

### BR-SHF-200 — الوردية تبدأ بأمر صريح

**التصنيف:** Invariant

لا تنشأ تلقائيًا بمجرد Login إلا إذا كانت Policy معلنة وتظل عملية موثقة.

### BR-SHF-201 — الوردية لها Scope

**التصنيف:** Invariant

تحفظ:

- Tenant.
- Location.
- Terminal أوterminal group.
- owner/operator.
- opened at.
- business day.
- drawer session إن وجدت.

### BR-SHF-202 — لا أكثر من وردية نقدية فعالة لنفس Drawer

**التصنيف:** Invariant

إلا إذا كان المنتج يدعم Compartments مستقلة، وهو خارج MVP.

### BR-SHF-203 — المستخدم لا يفتح ورديتين متعارضتين

**التصنيف:** Tenant Policy

يمكن منعه أوالسماح بورديات غير نقدية حسب Role والنموذج التشغيلي.

### BR-SHF-204 — فتح وردية يحتاج Terminal صالحة

**التصنيف:** Invariant

Terminal active، Scope صحيح، وLocal time ضمن tolerance المقبولة.

### BR-SHF-205 — Opening float تسجل ولا تفترض

**التصنيف:** Invariant

إذا كانت Cash drawer مستخدمة، تحفظ:

- amount counted/assigned.
- source.
- currency.
- user.
- verification/approval عند الحاجة.

### BR-SHF-206 — Blind opening count Policy

**التصنيف:** Tenant Policy

يمكن إخفاء Expected float عن الكاشير أثناء العد لمنع المطابقة الشكلية.

### BR-SHF-207 — اختلاف العهدة الافتتاحية Exception

**التصنيف:** Invariant

لا يبدأ العمل بصمت عند فرق غير محلول؛ يحتاج Accept variance أوRecount أوSupervisor.

## 9. نماذج ملكية الوردية

### BR-OWN-100 — نموذج المسؤولية معلن

**التصنيف:** Tenant Policy

النماذج الممكنة:

- cashier-owned shift.
- terminal-owned shift.
- shared team shift.
- drawer-owned shift.

### BR-OWN-101 — MVP يختار نموذجًا أساسيًا واحدًا

**التصنيف:** Planning Decision

الاقتراح: **Cashier-owned drawer session على Terminal واحدة**، مع Supervisor handover موثق.

### BR-OWN-102 — Shared drawer تزيد متطلبات التدقيق

**التصنيف:** Invariant عند دعمها

كل Cash movement تنسب لمنفذها الفعلي، بينما الفرق النهائي مسؤولية مشتركة وفق Policy.

### BR-OWN-103 — المستخدم المساعد لا يصبح Owner تلقائيًا

**التصنيف:** Invariant

Supervisor approval أوتدخل فني لا ينقل عهدة الوردية.

## 10. Opening Float والعهدة

### BR-FLT-100 — Float ليست Sale أوRevenue

**التصنيف:** Invariant

تظهر كOpening cash source منفصل.

### BR-FLT-101 — مصدر العهدة معروف

**التصنيف:** Invariant

مثل:

- safe transfer.
- previous handover.
- fixed till allocation.

### BR-FLT-102 — تغيير Float بعد الفتح Cash movement

**التصنيف:** Invariant

لا يعدل opening amount مباشرة؛ ينشأ Cash in/out مناسب.

### BR-FLT-103 — العملات منفصلة

**التصنيف:** Invariant

كل Drawer session لها أرصدة حسب Currency، ولا تجمع قيمًا دون Conversion موثق.

### BR-FLT-104 — Denomination count قدرة قابلة للتهيئة

**التصنيف:** Tenant Policy

يمكن حفظ عدد الفئات لتحسين العد، دون فرضها على كل الأنشطة.

## 11. أثر المبيعات والمدفوعات

### BR-TND-100 — Cash Payment تزيد Expected drawer

**التصنيف:** Invariant

بصافي المبلغ المحتفظ به بعد Change.

### BR-TND-101 — Card وWallet لا تزيد Cash drawer

**التصنيف:** Invariant

تظهر في Tender summary والتسوية الإلكترونية فقط.

### BR-TND-102 — Split tender توزع آثارها

**التصنيف:** Invariant

الجزء النقدي فقط يؤثر على Drawer.

### BR-TND-103 — Cash Refund تنقص Drawer الحالية

**التصنيف:** Invariant

حتى إذا كانت Sale الأصلية في وردية أوفرع آخر.

### BR-TND-104 — Store Credit وLoyalty لا تعد نقدًا

**التصنيف:** Invariant

### BR-TND-105 — Failed أوPending Payment لا تدخل Expected collected

**التصنيف:** Invariant

Unknown electronic outcome تظهر في Reconciliation منفصلة.

## 12. Cash In

### BR-CIN-100 — Cash In حركة مستقلة

**التصنيف:** Invariant

تحتاج:

- amount.
- currency.
- reason code.
- source.
- actor.
- approval حسب الحد.

### BR-CIN-101 — Cash In لا تستخدم لتغطية فرق المبيعات

**التصنيف:** Invariant

الفرق يسجل كVariance، بينما Cash In تمثل نقدًا دخل فعليًا من مصدر معلوم.

### BR-CIN-102 — Reason catalog موحدة

**التصنيف:** Tenant Policy

مثل:

- additional float.
- safe transfer in.
- petty cash return.
- correction of prior authorized movement.

### BR-CIN-103 — Cash In الكبيرة تحتاج Approval

**التصنيف:** Approval Bound

## 13. Cash Out

### BR-COUT-100 — Cash Out حركة مستقلة

**التصنيف:** Invariant

### BR-COUT-101 — الأسباب مقيدة

**التصنيف:** Tenant Policy

مثل:

- safe drop.
- petty cash.
- bank deposit preparation.
- change fund transfer.
- approved expense.

### BR-COUT-102 — Cash Out لا تجعل الرصيد المتوقع غير منطقي دون Warning

**التصنيف:** Invariant

تتحقق من Expected cash مع السماح باستثناء مصرح إن كان هناك Count mismatch معلوم.

### BR-COUT-103 — Safe drop تربط بتسليم/استلام

**التصنيف:** Invariant

تسجل:

- من سلّم.
- من استلم أوContainer/reference.
- amount.
- time.
- status.

### BR-COUT-104 — Petty cash لا تسجل كRefund

**التصنيف:** Invariant

لها Source ونموذج مصروف مستقل.

### BR-COUT-105 — Cash Out الحساسة تحتاج موافقة

**التصنيف:** Approval Bound

## 14. No-Sale Drawer Open

### BR-NSD-100 — فتح الدرج دون حركة يحتاج Permission

**التصنيف:** Permission Bound

### BR-NSD-101 — Reason إلزامي

**التصنيف:** Invariant

مثل:

- making change.
- inspection/count.
- supervisor check.
- hardware test.

### BR-NSD-102 — كل Open event تسجل

**التصنيف:** Invariant

خصوصًا التكرار والنمط الزمني.

### BR-NSD-103 — Printer command لا تفتح Drawer بلا Context مصرح

**التصنيف:** Security Invariant

## 15. Suspended Carts والعمليات غير المكتملة

### BR-PND-100 — Suspended Cart لا تحرك النقد

**التصنيف:** Invariant

### BR-PND-101 — Payment initiated قد تمنع Handover

**التصنيف:** Invariant

إذا كانت نتيجة Payment Pending/Unknown، تدخل Exception واضحة قبل إغلاق أوتسليم المسؤولية.

### BR-PND-102 — Cart ownership محفوظة

**التصنيف:** Invariant

تسجل من أنشأ، ومن استأنف، ومن أكمل.

### BR-PND-103 — Abandoned payment attempt لا تحذف

**التصنيف:** Invariant

## 16. Handover

### BR-HND-100 — Handover عملية صريحة

**التصنيف:** Invariant

لا تتم بمجرد Logout أوتبديل المستخدم.

### BR-HND-101 — نوعا Handover منفصلان

**التصنيف:** Invariant

- Operational handover دون نقل Drawer ownership.
- Cash responsibility handover مع Count وتوقيع/قبول.

### BR-HND-102 — Cash handover تحتاج Count

**التصنيف:** Invariant

يمكن أن يكون Blind للطرف المستلم وفق Policy.

### BR-HND-103 — الطرفان معروفان

**التصنيف:** Invariant

تسجل:

- outgoing owner.
- incoming owner.
- counted amount.
- expected amount policy.
- variance.
- time.
- approvals.

### BR-HND-104 — Handover لا تغلق Business day

**التصنيف:** Invariant

### BR-HND-105 — Pending offline operations تنتقل بمسؤولية واضحة

**التصنيف:** Invariant

يبقى Origin actor والShift الأصلية، مع تسجيل من تابع Recovery.

### BR-HND-106 — رفض الاستلام يبقي العهدة على السابق

**التصنيف:** Invariant

حتى Resolution أوSupervisor takeover.

## 17. إغلاق الوردية

### BR-CLS-100 — الإغلاق أمر صريح

**التصنيف:** Invariant

### BR-CLS-101 — لا معاملات جديدة بعد بدء الإغلاق

**التصنيف:** Invariant

Terminal/Shift تدخل `closing` لمنع Race conditions.

### BR-CLS-102 — الإغلاق يحسب Tender summary

**التصنيف:** Invariant

يشمل:

- Cash sales.
- Cash refunds.
- Cash in/out.
- Card/wallet totals.
- Store credit/loyalty usage عند الدعم.
- Pending/failed/unknown payments منفصلة.

### BR-CLS-103 — Cash count فعلية

**التصنيف:** Invariant

لا يستخدم Expected amount كبديل عن العد.

### BR-CLS-104 — Blind close count Policy

**التصنيف:** Tenant Policy

الاقتراح: Blind count للكاشير، ثم عرض الفرق بعد Submission.

### BR-CLS-105 — Recount لا يمحو Count الأولى

**التصنيف:** Invariant

تحفظ المحاولات والمستخدم والسبب.

### BR-CLS-106 — الإغلاق لا يعدل الحركات الأصلية

**التصنيف:** Invariant

ينشئ Variance/Settlement records فقط.

### BR-CLS-107 — Closed shift Immutable

**التصنيف:** Invariant

لا تعاد فتحها بتغيير Status مباشر؛ تستخدم Reopen exception workflow محدود أوPost-close adjustments.

## 18. Expected Cash

### BR-EXP-300 — Expected cash مشتقة

**التصنيف:** Invariant

```
Opening float
+ successful cash collections
+ approved cash in
- cash change returned
- successful cash refunds
- approved cash out
= expected closing cash
```

يجب منع العد المزدوج إذا كانت Cash collection مخزنة بالفعل بصافي المبلغ.

### BR-EXP-301 — Voids وReversals تتبع الحالة المالية

**التصنيف:** Invariant

لا تؤثر مرتين.

### BR-EXP-302 — Late synchronized sale تنسب للوردية الأصلية

**التصنيف:** Invariant

حتى إذا وصلت بعد إغلاقها، وتظهر كPost-close exception/adjustment لا كمعاملة في وردية الاستلام التقنية.

### BR-EXP-303 — Timezone وBusiness day مثبتتان

**التصنيف:** Invariant

تستخدم Location timezone، لا Device clock وحدها.

## 19. Count وVariance

### BR-VAR-100 — Variance محسوبة لكل Currency

**التصنيف:** Invariant

```
Counted cash - Expected cash = Variance
```

### BR-VAR-101 — Over وShort مصنفتان

**التصنيف:** Invariant

- positive = over.
- negative = short.

### BR-VAR-102 — Tolerance Policy صريحة

**التصنيف:** Tenant/Location Policy

قد تعتمد على قيمة مطلقة أوPercentage أوRole.

### BR-VAR-103 — داخل tolerance لا يعني حذف الفرق

**التصنيف:** Invariant

يسجل الفرق، وقد يغلق تلقائيًا دون Approval.

### BR-VAR-104 — فوق tolerance يحتاج Reason وApproval

**التصنيف:** Approval Bound

### BR-VAR-105 — الفرق لا يُنسب آليًا إلى سرقة أوخطأ

**التصنيف:** Governance Invariant

يسجل كحقيقة مالية تحتاج Investigation عند اللزوم.

### BR-VAR-106 — التسوية المحاسبية مستقلة

**التصنيف:** Accounting Boundary

إغلاق Shift تشغيليًا لا يفترض Posting محاسبي كامل قبل Accounting Blueprint.

## 20. Pending operations عند الإغلاق

### BR-PCL-100 — أنواع Pending معروفة

**التصنيف:** Invariant

مثل:

- Offline sales not synced.
- Outbox events awaiting acknowledgement.
- Electronic payments pending/unknown.
- Refunds pending.
- Printer jobs لا تمنع الإغلاق.
- Suspended carts.

### BR-PCL-101 — Pending مالية ومخزنية تختلف

**التصنيف:** Invariant

Printer failure لا تساوي Payment unknown.

### BR-PCL-102 — سياسة الإغلاق مع Pending صريحة

**التصنيف:** Tenant Policy

الخيارات:

- block close.
- conditional close with supervisor.
- close and transfer exception ownership.

### BR-PCL-103 — المبدأ المقترح للـMVP

**التصنيف:** Planning Decision

- Payment unknown تمنع الإغلاق العادي.
- Offline saved sales تسمح بإغلاق مشروط بواسطة Supervisor إذا كانت محفوظة محليًا وسليمة.
- كل Pending تبقى مرتبطة بالShift الأصلية.

### BR-PCL-104 — Late sync لا تعيد فتح الوردية تلقائيًا

**التصنيف:** Invariant

تنشئ Post-close reconciliation entry.

## 21. Business Day

### BR-BDY-100 — Business day مستقلة عن Shift

**التصنيف:** Invariant

قد تشمل عدة Shifts وTerminals.

### BR-BDY-101 — Business day لها Location timezone

**التصنيف:** Invariant

### BR-BDY-102 — عبور منتصف الليل مسموح

**التصنيف:** Tenant/Location Policy

### BR-BDY-103 — إغلاق اليوم لا يغير المستندات

**التصنيف:** Invariant

يثبت Cutoff وتقريرًا وحالة Operational lock وفق Policy.

### BR-BDY-104 — لا إغلاق يوم مع Shifts حرجة مفتوحة دون Override

**التصنيف:** Approval Bound

### BR-BDY-105 — Post-close transactions تظهر كLate adjustments

**التصنيف:** Invariant

## 22. Terminal connectivity status

### BR-HLT-100 — Online/Offline حالة قابلة للتفسير

**التصنيف:** UX Invariant

تظهر للمستخدم:

- server reachable.
- authenticated.
- last successful sync.
- pending count.
- failed/action-required count.

### BR-HLT-101 — Network reachable لا تعني Sync healthy

**التصنيف:** Invariant

### BR-HLT-102 — Last sync لا تستخدم Device time وحده

**التصنيف:** Invariant

تحفظ server acknowledgement وlocal attempt times.

### BR-HLT-103 — الحالة الإدارية منفصلة عن الحالة التقنية

**التصنيف:** Invariant

مثل:

- Active but offline.
- Suspended but connected.
- Active with sync errors.

### BR-HLT-104 — Stale status معلّمة

**التصنيف:** Invariant

Admin لا ترى جهازًا Online بناءً على Heartbeat قديمة.

## 23. Terminal monitoring

### BR-MON-100 — Admin ترى أقل معلومات لازمة

**التصنيف:** Invariant

مثل:

- terminal name/id.
- location.
- app version.
- last heartbeat.
- last sync.
- active shift.
- pending/failed counts.
- health flags.

### BR-MON-101 — المراقبة لا تعرض بيانات عملاء أوPasswords

**التصنيف:** Security Invariant

### BR-MON-102 — Remote actions مقيدة

**التصنيف:** Permission Bound

مثل:

- revoke terminal.
- request sync.
- request logs.
- lock app.
- rotate credentials.

### BR-MON-103 — Remote wipe ليست افتراضية

**التصنيف:** Deferred Security Capability

تحتاج ضمان عدم فقد Outbox غير متزامنة وخطة Recovery.

## 24. Offline shifts

### BR-OFS-100 — فتح Shift Offline يحتاج Lease صالحة

**التصنيف:** Location Policy

الافتراضي المقترح:

- يسمح فقط إذا كانت Terminal وMembership وPolicy cached وغير منتهية.
- يمكن منع فتح Shift جديدة Offline مع السماح باستمرار المفتوحة.

### BR-OFS-101 — Shift identity مولدة محليًا وثابتة

**التصنيف:** Invariant

لا تتغير عند Sync أوRestart.

### BR-OFS-102 — Opening float تحفظ ذريًا محليًا

**التصنيف:** Invariant

مع Outbox event في نفس Transaction.

### BR-OFS-103 — Close Offline حالة Pending confirmation

**التصنيف:** Planning Decision

يمكن حفظ Count والإغلاق محليًا، لكن تظل `closed locally / pending server reconciliation` حتى Sync.

### BR-OFS-104 — لا فتح Shift تالية متعارضة قبل حل السابقة

**التصنيف:** Tenant Policy

الاقتراح: منع Drawer session جديدة على نفس Terminal/Drawer حتى رفع الإغلاق السابق أوSupervisor recovery.

### BR-OFS-105 — Offline lease لها حد زمني

**التصنيف:** Security Invariant

بعد انتهائها يمنع بدء عمليات جديدة، مع الحفاظ على القدرة على عرض/تصدير البيانات المحلية.

## 25. Crash recovery

### BR-CRS-100 — Restart لا ينشئ Shift جديدة

**التصنيف:** Invariant

يستعيد الجهاز Shift وDrawer session المفتوحة من التخزين المحلي.

### BR-CRS-101 — Recovery تتحقق من Server state عند الاتصال

**التصنيف:** Invariant

### BR-CRS-102 — الحالة المتعارضة لا تحسم بالأحدث فقط

**التصنيف:** Invariant

مثل Local open وServer closed؛ تدخل Reconciliation workflow.

### BR-CRS-103 — فقد Local database حادث P0/P1 حسب Pending data

**التصنيف:** Operational Invariant

لا يُحل بإعادة Enrollment مباشرة قبل محاولة استعادة Outbox والوردية.

### BR-CRS-104 — Safe mode يمنع معاملات جديدة

**التصنيف:** Invariant

إذا تعذر إثبات سلامة Shift أوLedger المحلية، يسمح بالتشخيص والتصدير فقط.

## 26. Device replacement

### BR-RPL-100 — Replacement لا ترث Pending data تلقائيًا

**التصنيف:** Invariant

يجب Sync أوMigration آمنة وموقعة للبيانات المحلية.

### BR-RPL-101 — Terminal القديمة تسحب بعد Verification

**التصنيف:** Invariant

### BR-RPL-102 — Shift مفتوحة تحتاج إغلاقًا أوRecovery assignment

**التصنيف:** Invariant

### BR-RPL-103 — رقم Terminal الظاهر يمكن الاحتفاظ به مع هوية تقنية جديدة

**التصنيف:** Tenant Policy

مع سجل Replacement chain.

## 27. Multiple currencies

### BR-MCY-100 — Drawer balance لكل Currency

**التصنيف:** Invariant

### BR-MCY-101 — Change بعملة أخرى ليست افتراضية

**التصنيف:** Tenant Policy

تحتاج Conversion rate وMovement موثقة.

### BR-MCY-102 — Count وVariance منفصلة لكل Currency

**التصنيف:** Invariant

### BR-MCY-103 — MVP يبدأ بعملة تشغيل واحدة لكل Drawer

**التصنيف:** Planning Decision

مع استيعاب التصميم للتعدد لاحقًا.

## 28. الصلاحيات

### BR-OAU-100 — الصلاحيات منفصلة

**التصنيف:** Invariant

تشمل:

- enroll terminal.
- reassign/revoke terminal.
- open shift.
- enter/approve opening float.
- cash in.
- cash out.
- safe drop.
- no-sale drawer open.
- handover shift/drawer.
- close shift.
- approve variance.
- force/conditional close.
- reopen exception.
- request diagnostics.
- resolve terminal conflict.

### BR-OAU-101 — Cashier لا يوافق فرقًا فوق حده

**التصنيف:** Approval Bound

### BR-OAU-102 — من يعد لا يغير Expected history

**التصنيف:** Segregation Invariant

### BR-OAU-103 — Admin remote action تسجل

**التصنيف:** Security Invariant

## 29. Audit وEvents

### BR-OAD-100 — الأحداث الحرجة مسجلة

**التصنيف:** Invariant

تشمل:

- Terminal enrolled/activated/suspended/revoked/replaced.
- User login/logout/lock/unlock.
- Shift opened/closing/closed/conditionally closed.
- Opening float recorded/recounted.
- Cash in/out/safe drop.
- No-sale drawer open.
- Handover requested/accepted/rejected.
- Count submitted/recounted.
- Variance detected/approved.
- Offline close saved/confirmed.
- Late transaction reconciled.
- Recovery/safe mode entered/resolved.

### BR-OAD-101 — Cash event تحفظ القيم قبل وبعد المشتقة

**التصنيف:** Invariant

دون السماح بتعديلها يدويًا.

### BR-OAD-102 — Audit time تستخدم Client وServer timestamps

**التصنيف:** Invariant

مع تمييز موثوقية كل منهما.

## 30. الأخطاء والاسترداد

### BR-OER-100 — الخطأ يوضح حالة الوردية

**التصنيف:** Invariant

يجب أن يعرف المستخدم:

- هل Shift مفتوحة؟
- هل Sale محفوظة؟
- هل Cash movement سجلت؟
- هل Close محلية أممؤكدة؟
- ما الذي لا يجب تكراره؟
- Reference ID.

### BR-OER-101 — Unknown movement لا يعاد يدويًا

**التصنيف:** Invariant

يستخدم Inquiry/Idempotency.

### BR-OER-102 — Recovery لا تعدل DB مباشرة

**التصنيف:** Invariant

Workflows مطلوبة لـ:

- resume shift.
- conditional close.
- reconcile late sale.
- reverse erroneous cash movement.
- replace terminal safely.
- export local diagnostics.

### BR-OER-103 — عكس Cash movement بمستند عكسي

**التصنيف:** Invariant

لا Delete أوEdit للمبلغ الأصلي.

## 31. التقارير

### BR-ORP-100 — Shift report منفصلة عن Sales report

**التصنيف:** Invariant

تحتوي:

- opening float.
- cash collections/refunds.
- cash in/out.
- expected/count.
- variance.
- tender totals.
- pending/late operations.

### BR-ORP-101 — Terminal report منفصلة عن User report

**التصنيف:** Invariant

### BR-ORP-102 — Handover تقسم المسؤولية زمنيًا

**التصنيف:** Invariant

حتى إذا بقيت Drawer session واحدة.

### BR-ORP-103 — Late sync لا تضيع من تقرير الوردية

**التصنيف:** Invariant

تظهر في Original shift وفي Reconciliation report.

### BR-ORP-104 — Business day تجمع Shifts دون دمج فروقها

**التصنيف:** Invariant

### BR-ORP-105 — Electronic tender reconciliation مستقلة

**التصنيف:** Invariant

لا تدخل Cash variance.

## 32. السيناريوهات الإلزامية للاختبار لاحقًا

1. Enrollment جهاز جديد.
2. استخدام Enrollment code مرتين.
3. Revoked terminal تحاول البيع Online وOffline.
4. Login ثمفتح Shift.
5. فتح Shift بعهدة صحيحة.
6. فرق في Opening float.
7. منع Shift ثانية لنفس Drawer.
8. Cash sale وتحديث Expected.
9. Cash change calculation.
10. Card sale لا تغير Drawer.
11. Split Cash/Card.
12. Cash refund من Sale قديمة.
13. Cash in مع Approval.
14. Cash out/Safe drop.
15. No-sale drawer open.
16. Suspended Cart ثمتغيير User.
17. Handover بعهدة مطابقة.
18. Handover بفرق ورفض المستلم.
19. Blind closing count.
20. Recount مع حفظ Count الأولى.
21. فرق داخل tolerance.
22. فرق فوق tolerance.
23. Close مع Payment unknown.
24. Close مع Offline sales محفوظة.
25. Late sync بعد Close.
26. Restart أثناء Shift مفتوحة.
27. Restart بعد Local close قبل Sync.
28. Local/Server shift conflict.
29. انتهاء Offline lease.
30. إعادة تثبيت مع Outbox pending.
31. Replacement terminal.
32. Admin last heartbeat stale.
33. Sync reachable لكن failed queue موجودة.
34. Business day يعبر منتصف الليل.
35. End-of-day مع Shift مفتوحة.
36. Duplicate Cash movement retry.
37. عكس Cash out خاطئة.
38. Printer failure لا يؤثر على Shift.
39. User suspended أثناء Offline shift.
40. Cross-tenant terminal credential rejection.

## 33. القرارات المفتوحة

### OD-OPS-001 — نموذج ملكية الوردية

**الاقتراح:** Cashier-owned Shift + Drawer session واحدة على Terminal واحدة في MVP.

### OD-OPS-002 — هل يسمح بأكثر من مستخدم على نفس Shift؟

**الاقتراح:** Supervisor interventions مسموحة مع Actor مستقل، لكن نقل المسؤولية يحتاج Handover.

### OD-OPS-003 — فتح Shift Offline

**الاقتراح:** استمرار Shift مفتوحة مسموح ضمن Lease؛ فتح Shift جديدة Offline قابل للتعطيل وممنوع افتراضيًا في Pilot الأول.

### OD-OPS-004 — إغلاق Shift مع Offline sales

**الاقتراح:** Conditional close بواسطة Supervisor إذا كانت كل العمليات محفوظة ذريًا محليًا، مع Reconciliation إلزامية لاحقًا.

### OD-OPS-005 — Payment unknown عند الإغلاق

**الاقتراح:** تمنع الإغلاق العادي وتحتاج Resolution أوSupervisor conditional close عالي الخطورة.

### OD-OPS-006 — Blind count

**الاقتراح:** Blind closing count افتراضيًا، وOpening blind configurable.

### OD-OPS-007 — Variance tolerance

تحدد لكل Tenant/Location وCurrency؛ لا رقم عالمي في Core.

### OD-OPS-008 — Business day

**الاقتراح:** Location-defined cutoff مع دعم عبور منتصف الليل، وتأجيل Hard lock المحاسبي إلى Accounting Blueprint.

### OD-OPS-009 — Shared drawers

**الاقتراح:** خارج MVP؛ Handover موثق بدل المشاركة المتزامنة.

### OD-OPS-010 — Multiple currencies

**الاقتراح:** Currency واحدة لكل Drawer في MVP.

### OD-OPS-011 — Remote terminal actions

**الاقتراح:** Revoke، request sync، وrequest diagnostics فقط أولًا؛ Remote wipe مؤجلة.

### OD-OPS-012 — Shift reopening

**الاقتراح:** لا Reopen عادي؛ Post-close adjustments وLate reconciliation، مع Recovery استثنائي محدود قبل أي downstream settlement.

## 34. خارج النطاق حاليًا

- Shared simultaneous cash drawer بين عدة Cashiers.
- Cash recycler integrations.
- Direct bank deposit processing.
- Full accounting journal posting.
- Workforce attendance/payroll.
- Employee scheduling.
- Biometric login.
- Remote screen control.
- Remote destructive wipe.
- Multi-currency change exchange.
- Automated theft accusation/scoring.
- Cash vault management الكامل.

## 35. Dependencies

هذه الوثيقة تغذي:

- Terminal Domain Model.
- Enrollment State Machine.
- User Session rules.
- Shift State Machine.
- Cash Drawer Session State Machine.
- Cash Movement Ledger.
- Business Day State Machine.
- Sales/Payments/Refund rules.
- Sync and Offline Protocols.
- Permission Matrix.
- Event and Audit Catalogs.
- API and Error Contracts.
- Database Blueprint.
- Terminal monitoring and Observability.
- Reporting Model.
- Deployment and Recovery runbooks.

## 36. Acceptance Gate

لا تعتبر Shift/Terminal planning مكتملة قبل:

1. اعتماد نموذج ملكية Shift وDrawer.
2. اعتماد Terminal enrollment وreplacement model.
3. اعتماد Opening/Closing count policies.
4. اعتماد Cash movement reason catalogs.
5. اعتماد Handover workflow.
6. اعتماد Pending/Unknown close matrix.
7. اعتماد Offline opening/closing policy.
8. اعتماد Variance tolerances وApproval model.
9. اعتماد Business day cutoff rules.
10. اعتماد Terminal monitoring fields وremote actions.
11. ربط كل Cash effect بـPayment/Refund source أوCash movement مستقلة.
12. تحويل كل Rule حرجة إلى State transition أوLedger transaction أوPermission أوConstraint أوTest requirement.

## 37. القرار التخطيطي الحالي

- User Session وShift وDrawer Session وTerminal وBusiness Day كيانات مستقلة.
- MVP يستخدم Cashier-owned Shift وDrawer session واحدة لكل Terminal.
- Shared simultaneous drawer خارج MVP؛ Handover هو المسار المعتمد.
- Expected cash مشتقة من Ledger ولا تعدل يدويًا.
- Blind closing count هو الافتراضي المقترح.
- الفروق تسجل ولا تغير المبيعات.
- Late Offline sale تبقى مرتبطة بالوردية الأصلية بعد الإغلاق.
- Payment unknown تمنع الإغلاق العادي.
- Offline close يمكن أن تكون محلية Pending confirmation فقط وفق Policy.
- App restart يستعيد Shift نفسها ولا ينشئ واحدة جديدة.
- Admin monitoring تفرق بين connectivity وsync health والحالة الإدارية.