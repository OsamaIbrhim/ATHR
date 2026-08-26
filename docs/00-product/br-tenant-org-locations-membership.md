# ATHR Tenant, Organization, Locations & User Membership Business Rules v1.0

**Planning Baseline — Tenant Ownership, Organizational Scope and Workforce Access**

## 1. وظيفة الوثيقة

هذه الوثيقة هي المرجع التفصيلي لقواعد:

- Tenant lifecycle وملكية البيانات.
- بيانات المؤسسة والكيان القانوني.
- الفروع ومواقع التشغيل.
- المخازن وعلاقتها بالفروع.
- أجهزة POS والـTerminals.
- الهوية العالمية للمستخدم.
- عضوية المستخدم داخل Tenant.
- الدعوات والانضمام والتعليق والتعطيل.
- الأدوار ونطاقات الوصول.
- الوصول إلى أكثر من Location أوWarehouse.
- الفصل بين مستخدمي العميل وفريق منصة أثر.
- Support access والوصول المؤقت.
- نقل الملكية وإغلاق المؤسسة.
- Offline access وcached authorization.
- التدقيق والتقارير والاسترداد.

لا تصمم الوثيقة جداول المستخدمين أونظام الـRBAC النهائي؛ بل تثبت حقائق الـDomain التي سيبنى عليها Permission Matrix وSecurity Blueprint لاحقًا.

## 2. المصطلحات

### Platform Identity

هوية شخص عالمية داخل منصة أثر، يمكن أن ترتبط بعضوية في Tenant واحدة أوأكثر دون مشاركة صلاحيات أوبيانات الأعمال بينها.

### Tenant

حد ملكية وعزل بيانات مستقل يمثل عميلًا مشتركًا في أثر.

### Organization Profile

البيانات التجارية المعروضة للمؤسسة داخل Tenant، مثل الاسم والعلامة وبيانات الاتصال.

### Legal Entity

الجهة القانونية المسؤولة عن الضرائب والفواتير والعقود والالتزامات المالية.

### Business Unit

تقسيم إداري داخلي يمكن إضافته لاحقًا، ولا يساوي Tenant أوLocation.

### Location

موقع تشغيل تجاري مثل فرع أومتجر أومكتب، وله إعدادات تشغيل وساعات عمل وTimezone ونطاق مستخدمين.

### Warehouse

وحدة حفظ ومحاسبة مخزون، وقد ترتبط بـLocation أوتكون مركزية مستقلة.

### Terminal

جهاز أوتثبيت POS مسجل له هوية وLease وحالة وLocation افتراضية.

### Membership

العلاقة التي تسمح لـPlatform Identity بالعمل داخل Tenant محددة.

### Role Assignment

تعيين Role إلى Membership ضمن Scope محدد.

### Access Scope

النطاق الذي تطبق داخله الصلاحية، مثل Tenant أوLocation أوWarehouse أوTerminal.

### Invitation

طلب زمني لانضمام شخص إلى Tenant بعضوية وأدوار أولية.

### Tenant Owner

مسؤول تجاري أعلى داخل Tenant، وليس مالك بيانات المنصة أوSuper Admin عالميًا.

### Platform Operator

هوية تشغيلية داخل شركة أثر لها صلاحيات منصة محددة، ولا تحصل تلقائيًا على عضوية العميل.

## 3. المبادئ غير القابلة للتفاوض

### BR-TEN-100 — Tenant هي حد ملكية البيانات الأساسي

**التصنيف:** Invariant

كل سجل تشغيلي يخص عميلًا يجب أن يرتبط بـTenant واحدة فقط، مباشرة أوعبر سلسلة ملكية غير قابلة للالتباس.

### BR-TEN-101 — الهوية العالمية لا تمنح وصولًا تلقائيًا

**التصنيف:** Invariant

وجود Platform Identity أوتسجيل الدخول الناجح لا يسمح بقراءة أوتنفيذ أي شيء داخل Tenant دون Membership فعالة ونطاق مصرح.

### BR-TEN-102 — العضويات بين Tenants مستقلة

**التصنيف:** Invariant

تعليق المستخدم في Tenant لا يعلقه عالميًا ولا يغير عضوياته الأخرى، إلا إذا عطلت Platform Identity لأسباب أمنية عامة.

### BR-TEN-103 — لا استعلام تشغيلي بلا Tenant context

**التصنيف:** Security Invariant

أي Command أوQuery على بيانات العميل تحتاج Tenant context موثوقًا مشتقًا من الجلسة أوالمورد، لا من قيمة يرسلها المستخدم وحدها.

### BR-TEN-104 — لا نقل صامت للبيانات بين Tenants

**التصنيف:** Invariant

النقل أوالنسخ يحتاج Workflow تصدير/استيراد أوMigration مصرح، مع Audit وValidation، ولا يتم بتغيير tenant_id مباشرة.

### BR-TEN-105 — التعطيل لا يحذف التاريخ

**التصنيف:** Invariant

تعطيل Tenant أوLocation أوWarehouse أوMembership أوTerminal يمنع العمليات الجديدة وفق السياسة، لكنه لا يمحو المراجع التاريخية.

### BR-TEN-106 — Legal Entity وLocation وWarehouse كيانات مختلفة

**التصنيف:** Invariant

- Legal Entity مسؤولة قانونيًا وماليًا.
- Location تمثل موقع التشغيل التجاري.
- Warehouse تمثل عهدة المخزون.
- يمكن ربطها لكن لا تستخدم إحداها بديلًا عن الأخرى.

## 4. إنشاء Tenant

### BR-TPR-100 — Provisioning عملية ذات هوية

**التصنيف:** Invariant

إعادة محاولة إنشاء Tenant لا تنشئ مؤسستين عند تكرار نفس الطلب.

### BR-TPR-101 — المنشئ لا يصبح Owner بلا قبول واضح

**التصنيف:** Product Policy

المسار الافتراضي:

- ينشئ المستخدم Tenant.
- تنشأ Membership فعالة له.
- يمنح Tenant Owner role ضمن Audit واضح.

أي Provisioning بواسطة Support يحتاج تحديد المالك الفعلي ودعوة موثقة.

### BR-TPR-102 — الاسم التجاري لا يحدد الهوية التقنية

**التصنيف:** Invariant

تغيير اسم المؤسسة أوالعلامة لا يغير Tenant ID ولا روابط البيانات.

### BR-TPR-103 — Subdomain أوSlug ليس مفتاح ملكية

**التصنيف:** Invariant

يمكن تغييره أوحجزه، ولا يستخدم بدل Tenant ID في القيود الأمنية.

### BR-TPR-104 — الإعداد الأولي يحدد Defaults قابلة للتفسير

**التصنيف:** Invariant

مثل:

- country.
- base currency.
- default locale.
- timezone الافتراضية.
- tax profile المبدئي.
- أول Location وWarehouse عند اختيار Quick setup.

### BR-TPR-105 — Templates لا تنشئ بيانات مالية نهائية

**التصنيف:** Invariant

قوالب الإعداد قد تنشئ Catalog أوRoles أوSettings، لكنها لا تنشئ أرصدة مخزون أوCash أوReceivables دون Opening workflows مصرح.

## 5. حالات Tenant

### BR-TST-100 — Tenant لها Lifecycle صريح

**التصنيف:** Invariant

الحالات المبدئية:

- provisioning.
- trial.
- active.
- payment_grace عند اعتماد Billing.
- restricted.
- suspended.
- read_only.
- closure_requested.
- closed.
- deletion_pending.

### BR-TST-101 — الحالة المالية للاشتراك لا تمحو البيانات

**التصنيف:** Invariant

فشل الدفع قد يقيد قدرات محددة أويدخل Grace period، لكنه لا يحذف البيانات أويفسد العمليات المكتملة.

### BR-TST-102 — Suspension تحدد قدرات مسموحة

**التصنيف:** Product Policy

يجب تحديد هل يسمح بـ:

- login.
- read/export.
- إتمام Pending sync.
- إغلاق shifts.
- إنشاء معاملات جديدة.
- support access.

### BR-TST-103 — Read-only لا تمنع Recovery الضروري

**التصنيف:** Invariant

يمكن السماح بعمليات محددة مثل Export، Sync reconciliation، أوإغلاق آمن دون السماح ببيع جديد.

### BR-TST-104 — إعادة التنشيط لا تعيد كل شيء تلقائيًا

**التصنيف:** Invariant

Terminals أوMemberships أوIntegrations المعطلة أمنيًا تحتاج مراجعتها منفصلة.

## 6. بيانات المؤسسة

### BR-ORG-100 — Organization Profile لها Snapshot في المستندات عند الحاجة

**التصنيف:** Invariant

تغيير الاسم أوالعنوان أوالشعار لا يغير الفواتير والإيصالات التاريخية.

### BR-ORG-101 — الاسم التجاري والاسم القانوني منفصلان

**التصنيف:** Invariant

### BR-ORG-102 — بيانات الاتصال العامة لا تمنح Login

**التصنيف:** Invariant

Email المؤسسة أوالهاتف لا ينشئ Platform Identity أوOwner تلقائيًا.

### BR-ORG-103 — تغيير Country أوBase Currency عالي الأثر

**التصنيف:** Approval/Architecture Bound

لا يعامل كإعداد بسيط بعد وجود معاملات؛ يحتاج Migration assessment وربما يمنع.

### BR-ORG-104 — Settings لها Effective scope

**التصنيف:** Invariant

كل إعداد يحدد هل هو:

- Platform default.
- Tenant default.
- Location override.
- Terminal-local preference.

ولا يسمح Override إلا للإعدادات المصنفة بذلك.

## 7. الكيانات القانونية

### BR-LEG-100 — كل مستند مالي يحدد Legal Entity عند تعددها

**التصنيف:** Invariant عند Multi-entity

### BR-LEG-101 — MVP يبدأ بكيان قانوني واحد لكل Tenant

**التصنيف:** Planning Decision

التصميم لا يغلق الباب أمام التعدد، لكن العمليات الأولى تفترض Legal Entity أساسية واحدة لتقليل تعقيد الضرائب والترقيم والتقارير.

### BR-LEG-102 — نقل Location بين Legal Entities ليس تعديلًا بسيطًا

**التصنيف:** Invariant

يحتاج تاريخ سريان، معالجة تسلسلات المستندات، Tax profile، المخزون، والعقود.

### BR-LEG-103 — البيانات القانونية المقيدة تحتاج صلاحية

**التصنيف:** Permission Bound

تشمل Tax IDs، registration data، bank details، وlegal addresses.

### BR-LEG-104 — إلغاء Legal Entity لا يلغي مستنداتها

**التصنيف:** Invariant

## 8. Locations

### BR-LOC-200 — Location مملوكة لـTenant واحدة

**التصنيف:** Invariant

### BR-LOC-201 — Location لها حالة تشغيل

**التصنيف:** Invariant

- draft.
- active.
- temporarily_closed.
- restricted.
- inactive.
- closed.

### BR-LOC-202 — Location لها Timezone صريحة

**التصنيف:** Invariant

تستخدم لحساب Business day والعرض والتقارير، مع حفظ كل timestamps في صيغة موثوقة.

### BR-LOC-203 — Location لها إعدادات تشغيل Snapshot/Version

**التصنيف:** Invariant

مثل:

- receipt header.
- tax profile.
- allowed payment methods.
- negative stock policy.
- return policy.
- shift policy.
- default price book.

### BR-LOC-204 — Location ليست مخزنًا تلقائيًا

**التصنيف:** Invariant

يجب ربط Warehouse واحدة أوأكثر صراحة، وتحديد Default selling warehouse عند الحاجة.

### BR-LOC-205 — إغلاق الفرع لا يغلق المخزن تلقائيًا

**التصنيف:** Invariant

قد يستمر Warehouse مركزي أوتحتاج تصفية مستقلة.

### BR-LOC-206 — Temporary closure تمنع عمليات محددة فقط

**التصنيف:** Location Policy

يمكن السماح بالاستلام أوالجرد أوالمزامنة مع منع البيع العام.

### BR-LOC-207 — تغيير Timezone بعد وجود معاملات يحتاج Effective date

**التصنيف:** Invariant

لا يعيد تفسير Business dates التاريخية.

## 9. Warehouses

### BR-WHS-200 — Warehouse لها Scope مخزون مستقل

**التصنيف:** Invariant

الرصيد يقاس لكل Variant وWarehouse، لا لكل Location فقط.

### BR-WHS-201 — Warehouse قد تكون مرتبطة بـLocation أومركزية

**التصنيف:** Invariant

### BR-WHS-202 — كل Selling Location تحتاج مصدر مخزون واضحًا

**التصنيف:** Invariant

لا يعتمد البيع على اختيار Warehouse عشوائي أومخفي.

### BR-WHS-203 — تعطيل Warehouse يتطلب معالجة الحالات المفتوحة

**التصنيف:** Invariant

مثل:

- stock on-hand.
- reservations.
- transfers in transit.
- open counts.
- pending receipts.

### BR-WHS-204 — نقل Warehouse إلى Location أخرى ليس مسموحًا بعد التاريخ بلا Migration

**التصنيف:** Invariant

### BR-WHS-205 — User access إلى Location لا يمنح كل Warehouses تلقائيًا

**التصنيف:** Tenant Policy

يمكن الربط الافتراضي، لكن الـScope النهائي صريح وقابل للمراجعة.

## 10. Terminals

### BR-TRM-200 — Terminal مملوكة لـTenant واحدة

**التصنيف:** Invariant

### BR-TRM-201 — Terminal مرتبطة بـLocation افتراضية

**التصنيف:** Invariant

لا تبدل Tenant أوLocation أثناء جلسة/Shift فعالة دون Re-enrollment أوWorkflow مصرح.

### BR-TRM-202 — Terminal لها حالة وLease

**التصنيف:** Invariant

الحالات المبدئية:

- pending_enrollment.
- active.
- restricted.
- revoked.
- retired.
- lost/stolen.

### BR-TRM-203 — Revocation تتغلب على Cache عند أول اتصال

**التصنيف:** Security Invariant

ويجب أن تكون Offline lease محدودة بحيث لا يستمر الجهاز إلى أجل غير معلوم.

### BR-TRM-204 — Device replacement لا يرث الهوية التقنية

**التصنيف:** Invariant

ينشأ Terminal enrollment جديد مع ربط تاريخ الاستبدال عند الحاجة.

### BR-TRM-205 — Terminal credentials لا تنقل يدويًا

**التصنيف:** Security Invariant

### BR-TRM-206 — Terminal status لا تساوي User status

**التصنيف:** Invariant

تعطيل الجهاز لا يعطل الموظف، والعكس.

## 11. Platform Identity

### BR-PID-100 — لكل شخص هوية عالمية واحدة قدر الإمكان

**التصنيف:** Identity Policy

يمكن أن تنضم لأكثر من Tenant بعضويات منفصلة.

### BR-PID-101 — Email أوPhone Login identifier لا تساوي Membership

**التصنيف:** Invariant

### BR-PID-102 — تعطيل Platform Identity قرار أمني عالمي

**التصنيف:** Security Invariant

يستخدم للحساب المخترق أومتطلبات المنصة، ويمنع كل العضويات حتى الاستعادة.

### BR-PID-103 — تغيير Login identifier يحتاج Verification

**التصنيف:** Invariant

ولا يغير Actor IDs التاريخية.

### BR-PID-104 — حذف الهوية يخضع لوجود تاريخ والتزامات

**التصنيف:** Privacy/Legal Boundary

قد تصبح anonymized أوdisabled بدل Hard delete.

### BR-PID-105 — Shared credentials ممنوعة

**التصنيف:** Security Invariant

كل مستخدم بشري يحتاج هوية فعلية؛ الحساب العام `cashier` غير مقبول للعمليات الحساسة.

## 12. Membership

### BR-MEM-100 — Membership تربط Identity واحدة بـTenant واحدة

**التصنيف:** Invariant

يمكن منع أكثر من Membership فعالة لنفس الزوج Identity/Tenant.

### BR-MEM-101 — Membership لها حالة مستقلة

**التصنيف:** Invariant

الحالات:

- invited.
- pending_verification.
- active.
- suspended.
- deactivated.
- expired للتعاقد المؤقت.

### BR-MEM-102 — Membership الفعالة شرط للعمليات الجديدة

**التصنيف:** Invariant

### BR-MEM-103 — التعليق يحافظ على Actor history

**التصنيف:** Invariant

### BR-MEM-104 — تاريخ البداية والنهاية صريح

**التصنيف:** Invariant

يسمح بعمالة مؤقتة ووصول محدد المدة.

### BR-MEM-105 — عضوية واحدة قد تملك أكثر من Role/Scope

**التصنيف:** Invariant

لكن Effective permissions تحسب من تعيينات واضحة، لا من Job title نصي.

### BR-MEM-106 — إعادة التفعيل لا تعيد الصلاحيات القديمة تلقائيًا عند خطر

**التصنيف:** Tenant Policy

يمكن طلب مراجعة Role assignments وTerminals والجلسات.

## 13. الدعوات

### BR-INVIT-100 — Invitation مرتبطة بـTenant وRecipient ونطاق

**التصنيف:** Invariant

تحفظ:

- inviter.
- recipient identifier.
- initial roles/scopes.
- expiry.
- status.
- purpose.

### BR-INVIT-101 — الدعوة لها Token أحادية الاستخدام

**التصنيف:** Security Invariant

### BR-INVIT-102 — إعادة الإرسال لا تنشئ عضويات متعددة

**التصنيف:** Invariant

### BR-INVIT-103 — تغيير الأدوار بعد إرسال الدعوة ينسخ Version جديدة

**التصنيف:** Invariant

يجب أن يقبل المدعو ما هو ساري وقت القبول أوتُلغى الدعوة السابقة.

### BR-INVIT-104 — الدعوة المنتهية لا تقبل

**التصنيف:** Invariant

### BR-INVIT-105 — قبول الدعوة لهوية موجودة لا ينشئ Identity مكررة

**التصنيف:** Invariant

### BR-INVIT-106 — الدعوة إلى Tenant معلقة أوغير مؤهلة ممنوعة

**التصنيف:** Product Policy

إلا فريق استعادة مصرح.

## 14. Tenant Owner

### BR-OWN-100 — يجب وجود Owner فعالة واحدة على الأقل

**التصنيف:** Invariant

لا يسمح بتعطيل أوإزالة آخر Owner دون نقل ملكية مكتمل.

### BR-OWN-101 — Owner ليست صلاحية منصة

**التصنيف:** Invariant

لا ترى Tenants أخرى أوإعدادات Platform الداخلية.

### BR-OWN-102 — نقل الملكية Workflow عالي الخطورة

**التصنيف:** Approval/Security Bound

يتطلب:

- هوية المالك الحالي أوRecovery path.
- موافقة/تحقق للمالك الجديد.
- MFA أوخطوة قوية عند دعمها.
- Audit وإشعار.

### BR-OWN-103 — Owner لا تتغلب على قيود Legal/Platform Security

**التصنيف:** Invariant

### BR-OWN-104 — يمكن وجود Co-owners وفق Plan

**التصنيف:** Tenant Policy

مع قاعدة تمنع فقدان آخر مسؤول.

## 15. Roles والتعيينات

### BR-ROL-100 — Role مجموعة صلاحيات وليست Scope

**التصنيف:** Invariant

التعيين يجمع:

- Role.
- Membership.
- Scope.
- effective dates.
- grant source.

### BR-ROL-101 — Job title لا يمنح Permission

**التصنيف:** Invariant

### BR-ROL-102 — الأدوار النظامية محمية

**التصنيف:** Product Policy

يمكن تخصيصها ضمن حدود، لكن لا حذف متطلبات الأمان الجوهرية.

### BR-ROL-103 — Custom roles لها Version

**التصنيف:** Invariant

تغيير Role يؤثر على التعيينات المستقبلية/الحالية وفق Effective behavior معلن، مع Audit.

### BR-ROL-104 — Deny مقابل Allow يحتاج قرارًا موحدًا

**التصنيف:** Open Decision

الاقتراح: نموذج Allow-only مع Scopes واضحة في MVP لتقليل التعارض، وتأجيل Explicit deny.

### BR-ROL-105 — الصلاحيات الحساسة لا تجمع في Role افتراضية واسعة

**التصنيف:** Security Invariant

مثل:

- owner transfer.
- payment approval.
- refunds عالية القيمة.
- data export.
- support access grant.
- destructive configuration.

## 16. Access Scopes

### BR-SCP-100 — Scope لها نوع ومرجع

**التصنيف:** Invariant

الأنواع الأولية:

- tenant-wide.
- location.
- warehouse.
- terminal عند الحاجة.
- own-record/self-service في المستقبل.

### BR-SCP-101 — Tenant-wide صريحة وليست غياب Scope

**التصنيف:** Invariant

القيمة الفارغة لا تفسر كصلاحية شاملة.

### BR-SCP-102 — Location scope لا تمنح Warehouse خارجها تلقائيًا

**التصنيف:** Tenant Policy

### BR-SCP-103 — Warehouse scope لا تمنح صلاحية البيع بالفرع

**التصنيف:** Invariant

### BR-SCP-104 — Terminal scope للأجهزة وليست بديلًا عن Membership

**التصنيف:** Invariant

### BR-SCP-105 — Multiple scopes تجمع بصورة حتمية

**التصنيف:** Invariant

Effective access قابلة للتفسير وإعادة الحساب.

### BR-SCP-106 — Scope change لا تعيد كتابة العمليات السابقة

**التصنيف:** Invariant

## 17. الوصول إلى أكثر من فرع

### BR-MLC-100 — المستخدم يمكن أن يعمل في أكثر من Location

**التصنيف:** Tenant Policy

عبر Scope assignments واضحة.

### BR-MLC-101 — Location الحالية جزء من Session context

**التصنيف:** Invariant

يختار المستخدم Location مصرح بها، وتظهر بوضوح قبل تنفيذ العملية.

### BR-MLC-102 — تبديل Location لا ينقل Cart أوShift أوسياق المخزون تلقائيًا

**التصنيف:** Invariant

### BR-MLC-103 — العمليات المركزية تحتاج Tenant-wide أوScopes متعددة

**التصنيف:** Invariant

### BR-MLC-104 — التقارير تحترم Scope المنفذ

**التصنيف:** Security Invariant

لا تعرض إجماليات فروع غير مصرح بها عبر Aggregation أوExport.

## 18. Session context

### BR-SES-100 — الجلسة تثبت Identity وMembership وTenant

**التصنيف:** Invariant

### BR-SES-101 — Location/Terminal/Shift contexts لا تثبت الصلاحيات وحدها

**التصنيف:** Invariant

يجب التحقق من Membership وRole/Scope أيضًا.

### BR-SES-102 — تبديل Tenant عملية صريحة

**التصنيف:** Security Invariant

لا تحمل بيانات أوCache أوSearch results من Tenant السابقة.

### BR-SES-103 — الصلاحيات يعاد تقييمها دوريًا

**التصنيف:** Security Policy

ولا تعتمد جلسة طويلة على Claims قديمة بلا Expiry/refresh.

### BR-SES-104 — Sensitive permission step-up ممكنة

**التصنيف:** Deferred/Security Capability

مثل إعادة إدخال PIN أوMFA لعمليات عالية الخطورة.

## 19. التعليق والتعطيل

### BR-SUS-100 — Suspension فورية للعمليات الجديدة Online

**التصنيف:** Security Invariant

### BR-SUS-101 — Offline revocation تحدها Lease

**التصنيف:** Security Invariant

لا يمكن ضمان إبطال فوري لجهاز منفصل، لذلك يجب تحديد مدة Offline authorization وحدود العمليات.

### BR-SUS-102 — التعطيل لا يلغي العمليات المكتملة

**التصنيف:** Invariant

### BR-SUS-103 — العمليات Pending تحت المستخدم المعطل تبقى قابلة للتسوية

**التصنيف:** Invariant

لا تنسب لمستخدم آخر؛ تعالج بواسطة Recovery actor منفصل.

### BR-SUS-104 — سبب التعليق مقيد

**التصنيف:** Permission Bound

يظهر للمستخدم ما يلزم فقط، مع تفاصيل للمسؤولين المخولين.

### BR-SUS-105 — إنهاء الموظف يلغي Sessions وTokens وAssignments

**التصنيف:** Security Invariant

مع الحفاظ على التاريخ.

## 20. Platform Operators وفريق أثر

### BR-PLT-100 — Platform Operator ليست Tenant Membership

**التصنيف:** Invariant

### BR-PLT-101 — لا وصول افتراضي لبيانات العميل

**التصنيف:** Security Invariant

فريق أثر يرى Metadata تشغيلية محدودة حسب دوره، ولا يدخل بيانات Tenant دون Support access مصرح.

### BR-PLT-102 — صلاحيات المنصة منفصلة عن صلاحيات العميل

**التصنيف:** Invariant

مثل:

- manage tenant billing state.
- investigate infrastructure.
- manage platform incidents.
- approve emergency access.

### BR-PLT-103 — Impersonation الصامتة ممنوعة

**التصنيف:** Security Invariant

أي عرض أوتصرف نيابة عن مستخدم يجب أن يكون واضحًا ومسجلًا، ويفضل Support session بدل انتحال كامل.

## 21. Support access

### BR-SUPA-100 — Support access مؤقتة ومحددة الغرض

**التصنيف:** Invariant

تحفظ:

- tenant.
- requester.
- approver.
- support actor.
- reason/ticket.
- scopes.
- start/end.
- actions performed.

### BR-SUPA-101 — موافقة العميل مطلوبة افتراضيًا

**التصنيف:** Security Policy

إلا Break-glass incident محدد قانونيًا وتشغيليًا.

### BR-SUPA-102 — Break-glass أعلى تدقيقًا

**التصنيف:** Security Invariant

يحتاج سببًا عاجلًا، مدة قصيرة، إشعارات ومراجعة لاحقة.

### BR-SUPA-103 — Support لا ترى Secrets أوPayment data الحساسة

**التصنيف:** Invariant

### BR-SUPA-104 — انتهاء الجلسة يلغي كل Tokens التابعة

**التصنيف:** Security Invariant

### BR-SUPA-105 — تعديلات الدعم تنسب لفريق الدعم والعميل السياقي

**التصنيف:** Invariant

لا تظهر كأن موظف العميل نفذها.

## 22. Service Accounts وIntegrations

### BR-SVC-100 — Service identity ليست مستخدمًا بشريًا

**التصنيف:** Invariant

### BR-SVC-101 — كل Integration لها Credentials وScopes مستقلة

**التصنيف:** Security Invariant

### BR-SVC-102 — لا مشاركة API keys بين Tenants

**التصنيف:** Invariant

### BR-SVC-103 — Rotation لا تغير Actor history

**التصنيف:** Invariant

### BR-SVC-104 — تعطيل Integration يلغي وصولها دون حذف تاريخها

**التصنيف:** Invariant

### BR-SVC-105 — Service account لا تستخدم UI login افتراضيًا

**التصنيف:** Security Policy

## 23. Offline authorization

### BR-OFA-100 — Offline access عقد مؤقت

**التصنيف:** Security Invariant

يحفظ الجهاز Snapshot موقعة أوموثوقة من:

- identity/membership.
- allowed location.
- terminal binding.
- limited permissions.
- expiry.
- policy version.

### BR-OFA-101 — ليست كل Permission قابلة Offline

**التصنيف:** Invariant

الممنوع افتراضيًا:

- owner transfer.
- user invitation.
- role changes.
- high-value refunds.
- Store credit/Points redemption.
- credit limit override.
- sensitive export.

### BR-OFA-102 — صلاحيات Offline أقل أوتساوي Online

**التصنيف:** Security Invariant

لا تمنح Cache قدرة أوسع.

### BR-OFA-103 — انتهاء Lease يمنع العمليات الجديدة

**التصنيف:** Invariant

مع السماح بإرسال العمليات المحلية السابقة واستعادة آمنة.

### BR-OFA-104 — تغيير Role Online لا يعيد كتابة العمليات Offline السابقة

**التصنيف:** Invariant

لكن Sync تتحقق من صلاحية العقد وقت التنفيذ وتدخل Exceptions عند المخالفة.

## 24. نقل المستخدم بين الفروع

### BR-TRF-100 — النقل يغير Assignments بتاريخ سريان

**التصنيف:** Invariant

لا يعدل Scope القديمة دون تاريخ.

### BR-TRF-101 — Shifts المفتوحة تعالج قبل إزالة Scope

**التصنيف:** Invariant

### BR-TRF-102 — نقل الموظف لا ينقل عهدة نقدية أوTerminal ownership تلقائيًا

**التصنيف:** Invariant

### BR-TRF-103 — الوصول المؤقت له Expiry

**التصنيف:** Invariant

## 25. إغلاق Location

### BR-LCL-100 — Closure لها Checklist

**التصنيف:** Invariant

تشمل:

- open shifts/drawers.
- pending offline sales.
- inventory on-hand.
- open transfers.
- open purchase receipts.
- active terminals.
- memberships scoped only to location.
- numbering/tax obligations.

### BR-LCL-101 — الإغلاق لا يعيد توزيع المخزون تلقائيًا

**التصنيف:** Invariant

يحتاج Transfers أوAdjustments موثقة.

### BR-LCL-102 — الأجهزة تلغى أوتعاد Enrollment

**التصنيف:** Invariant

### BR-LCL-103 — التقارير التاريخية تحتفظ بالفرع المغلق

**التصنيف:** Invariant

## 26. إغلاق Tenant ونقل الملكية

### BR-CLS-100 — Closure request ليست Delete فوريًا

**التصنيف:** Invariant

تمر بمراحل تحقق وExport وRetention وBilling settlement.

### BR-CLS-101 — Pending operations تعالج أوتوثق

**التصنيف:** Invariant

### BR-CLS-102 — العميل يستطيع Export وفق العقد والسياسة

**التصنيف:** Product/Legal Policy

### BR-CLS-103 — Retention تعتمد على Data class والقانون

**التصنيف:** Legal Boundary

### BR-CLS-104 — Platform deletion لا تكسر Audit والالتزامات

**التصنيف:** Invariant

يستخدم anonymization أوarchival عند الحاجة.

### BR-CLS-105 — إعادة فتح Tenant مغلقة ليست مضمونة

**التصنيف:** Product Policy

قد تتطلب Tenant جديدة وMigration بدل تغيير Status فقط.

## 27. الصلاحيات الإدارية الحساسة

### BR-ADM-100 — العمليات التالية مستقلة الصلاحية

**التصنيف:** Invariant

- invite user.
- activate/suspend/deactivate membership.
- assign role.
- assign tenant-wide scope.
- create/close location.
- create/disable warehouse.
- enroll/revoke terminal.
- transfer ownership.
- grant support access.
- export all tenant data.
- request tenant closure.

### BR-ADM-101 — لا Self-approval للعمليات عالية الخطورة حسب الخطة

**التصنيف:** Approval Policy

### BR-ADM-102 — آخر Owner محمية من الحذف

**التصنيف:** Invariant

### BR-ADM-103 — Tenant-wide grants تحتاج تحذيرًا واضحًا

**التصنيف:** Security Invariant

### BR-ADM-104 — Bulk changes لها Preview ونتيجة تفصيلية

**التصنيف:** Invariant

## 28. Audit وEvents

### BR-TAUD-100 — كل تغيير في الوصول يسجل

**التصنيف:** Invariant

يشمل:

- Tenant provisioned/status changed/closure requested.
- Organization/legal data changed.
- Location/Warehouse created/updated/closed.
- Terminal enrolled/revoked/retired.
- Invitation issued/accepted/revoked/expired.
- Membership activated/suspended/deactivated.
- Role/scope granted/revoked.
- Owner transfer requested/completed.
- Support access granted/used/expired.
- Service credential rotated/revoked.

### BR-TAUD-101 — Grantor وApprover وEffective actor محفوظون

**التصنيف:** Invariant

### BR-TAUD-102 — Audit لا تخزن Secrets

**التصنيف:** Security Invariant

### BR-TAUD-103 — Permission snapshot أوVersion قابلة للاسترجاع

**التصنيف:** Invariant

يجب تفسير لماذا سمح النظام بعملية تاريخية.

## 29. الأخطاء والاسترداد

### BR-TERR-100 — فشل Provisioning لا يترك Tenant نصف قابلة للعمل

**التصنيف:** Invariant

تدخل provisioning_failed أوRecovery state بدل active زائفة.

### BR-TERR-101 — قبول دعوة متكرر Idempotent

**التصنيف:** Invariant

### BR-TERR-102 — Bulk role update لا يخفي Partial failure

**التصنيف:** Invariant

### BR-TERR-103 — فقدان آخر Owner له Recovery رسمي

**التصنيف:** Security Invariant

لا يستخدم Direct SQL؛ يحتاج Identity verification وPlatform approval وAudit.

### BR-TERR-104 — Terminal lost/stolen لها Revocation workflow

**التصنيف:** Invariant

مع تقييم Pending offline data قبل إعادة التسجيل.

### BR-TERR-105 — Tenant context mismatch يفشل مغلقًا

**التصنيف:** Security Invariant

لا يحاول النظام تصحيح Tenant تلقائيًا أوإرجاع بيانات جزئية.

## 30. التقارير والمراقبة

### BR-TREP-100 — Active users تحسب من Memberships لاIdentities

**التصنيف:** Invariant

### BR-TREP-101 — التقارير تفرق invited وactive وsuspended

**التصنيف:** Invariant

### BR-TREP-102 — Access report تعرض Role + Scope + dates

**التصنيف:** Invariant

### BR-TREP-103 — Terminal fleet report تعرض

**التصنيف:** Invariant

- tenant/location.
- state.
- last seen.
- app version.
- last sync.
- pending operations.
- security/revocation status.

### BR-TREP-104 — Location reports لا تختفي بعد الإغلاق

**التصنيف:** Invariant

### BR-TREP-105 — Support access report قابلة للمراجعة

**التصنيف:** Invariant

## 31. السيناريوهات الإلزامية للاختبار لاحقًا

1. إنشاء Tenant مع Owner أولى.
2. Retry لنفس Provisioning.
3. مستخدم واحد عضو في Tenant متعددة.
4. تعليق عضوية في Tenant دون تأثير الأخرى.
5. دعوة مستخدم جديد وقبولها.
6. قبول دعوة بهوية موجودة.
7. دعوة منتهية أوملغاة.
8. محاولة إنشاء Membership مكررة.
9. تعيين Role لفرع واحد.
10. تعيين مستخدم لعدة فروع.
11. منع الوصول إلى فرع غير مصرح.
12. Location scope لا تكشف Warehouse خارجها.
13. Tenant-wide role وتحذيرها.
14. إزالة Scope أثناء وجود Shift مفتوحة.
15. تعطيل Membership مع Pending offline sales.
16. إلغاء Terminal مفقودة.
17. محاولة الجهاز الملغى Sync عمليات جديدة.
18. انتهاء Offline authorization lease.
19. نقل موظف بين Location بتاريخ سريان.
20. تغيير Role أثناء جلسة فعالة.
21. منع حذف آخر Owner.
22. نقل الملكية الناجح والفاشل.
23. Grant Support access مؤقتة.
24. انتهاء Support session وإلغاء Tokens.
25. Break-glass access ومراجعتها.
26. إغلاق Location بها مخزون وتحويلات مفتوحة.
27. إغلاق Tenant مع Pending operations.
28. Read-only tenant تسمح Export وتمنع Sale.
29. Cross-tenant query rejection.
30. Platform operator بلا Support grant.
31. Service credential rotation.
32. Bulk suspension مع Partial failure ظاهر.
33. تغيير Timezone مع Effective date.
34. تعطيل Warehouse بها Reservations.
35. منع نقل بيانات مباشرة بين Tenants.

## 32. القرارات المفتوحة

### OD-TEN-001 — نموذج Legal Entities

**الاقتراح:** Legal Entity واحدة لكل Tenant في MVP، مع تصميم IDs وعلاقات يسمح بالتعدد مستقبلًا.

### OD-TEN-002 — عدد Locations في الخطط

يحدد في Billing/Entitlements، ولا يثبت كقيد Domain عالمي.

### OD-TEN-003 — Owner متعددة

**الاقتراح:** دعم أكثر من Owner لتقليل خطر فقد الحساب، مع حماية آخر Owner.

### OD-TEN-004 — Custom Roles في MVP

**الاقتراح:** Roles نظامية أولًا مع Scopes، ثم Custom roles بعد استقرار Permission catalog.

### OD-TEN-005 — Explicit deny permissions

**الاقتراح:** Allow-only في MVP؛ الـdeny تزيد صعوبة تفسير Effective permissions.

### OD-TEN-006 — Warehouse access inheritance

**الاقتراح:** Location access تمنح Warehouses المرتبطة افتراضيًا فقط في Roles التشغيلية البسيطة، مع إمكان فصلها للأدوار المركزية؛ يحسم في Permission Matrix.

### OD-TEN-007 — Cross-location working

**القرار المبدئي:** مدعوم بتعيينات واضحة؛ المستخدم يختار Location الحالية قبل بدء Shift أوعملية محلية.

### OD-TEN-008 — Support consent

**الاقتراح:** موافقة Tenant Owner/Admin لكل جلسة، مع Break-glass محدود للحوادث الحرجة.

### OD-TEN-009 — Offline authorization duration

تحدد في Security/Offline Blueprint حسب المخاطر ونمط السوق، ولا تثبت عالميًا هنا.

### OD-TEN-010 — Tenant suspension behavior

**الاقتراح:** Grace ثم Read-only؛ السماح بإرسال Pending sync وإغلاق آمن وExport، ومنع معاملات جديدة.

### OD-TEN-011 — Platform Identity login identifiers

يُحسم في Identity Architecture؛ يدعم Email وPhone مع Verification، دون اعتماد أيهما كمعرف Business.

### OD-TEN-012 — Business Units

**القرار:** خارج MVP، ولا تستخدم Locations بديلًا إداريًا عنها في التصميم طويل الأجل.

## 33. خارج النطاق حاليًا

- Hierarchical corporate groups بين Tenants.
- Franchise revenue sharing.
- Cross-tenant shared inventory.
- Shared customer loyalty بين مؤسسات مختلفة.
- Multiple legal entities في MVP.
- Enterprise SCIM provisioning.
- Full SSO/SAML administration قبل Security Blueprint.
- Business Unit hierarchy.
- Delegated administration المعقدة.
- Permanent support impersonation.
- نقل Tenant بين مناطق استضافة دون Migration Blueprint.

## 34. Dependencies

هذه الوثيقة تغذي:

- Tenant and Organization Domain Model.
- Identity and Membership Domain Model.
- Location/Warehouse/Terminal models.
- Permission Matrix.
- Entitlement and Billing Model.
- Multi-tenancy Blueprint.
- Security and Threat Model.
- Session and Authentication architecture.
- Offline authorization protocol.
- Event and Audit Catalogs.
- API and Error Contracts.
- Database ownership and isolation constraints.
- Support Operations Blueprint.
- Reporting Model.

## 35. Acceptance Gate

لا تعتبر هذه المرحلة مكتملة قبل:

1. اعتماد Tenant lifecycle وحالات التقييد.
2. اعتماد نموذج Legal Entity للـMVP.
3. تثبيت الفرق بين Location وWarehouse وTerminal.
4. اعتماد Membership lifecycle.
5. اعتماد Invitation وOwner transfer workflows.
6. اعتماد أنواع Access Scope.
7. حسم System roles مقابل Custom roles.
8. اعتماد Cross-location working model.
9. اعتماد Support access وBreak-glass principles.
10. اعتماد Offline authorization boundaries.
11. ربط كل كيان تشغيلي بـTenant ownership واضحة.
12. تحويل كل Rule حرجة إلى Constraint أوState transition أوPermission أوSecurity test لاحقًا.

## 36. القرار التخطيطي الحالي

- Tenant هي حد ملكية وعزل البيانات.
- Platform Identity عالمية، لكن Membership وRoles وScopes مستقلة لكل Tenant.
- Tenant وLegal Entity وLocation وWarehouse وTerminal كيانات منفصلة.
- MVP يبدأ بـLegal Entity واحدة لكل Tenant.
- المستخدم يمكن أن يعمل في عدة Locations بتعيينات صريحة واختيار Context حالي.
- Roles لا تمنح Tenant-wide access ضمنيًا، والـScope الفارغة ليست صلاحية شاملة.
- آخر Tenant Owner لا يمكن تعطيلها قبل نقل الملكية.
- Support access مؤقتة، محددة الغرض، وموافق عليها افتراضيًا.
- Offline authorization أقل من Online ومحدودة المدة والقدرات.
- Platform Operators لا يملكون وصولًا افتراضيًا لبيانات العملاء.
- تعطيل أي كيان يمنع الجديد ويحافظ على التاريخ، ولا توجد عمليات إدارية حرجة عبر Direct SQL.