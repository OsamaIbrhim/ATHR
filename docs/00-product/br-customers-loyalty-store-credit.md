# ATHR Customer, Loyalty & Store Credit Business Rules v1.0

**Planning Baseline — Customer Identity, Consent, Loyalty and Customer Liability**

## 1. وظيفة الوثيقة

هذه الوثيقة هي المرجع التفصيلي لقواعد:

- ملف العميل داخل Tenant.
- العملاء الأفراد والشركات.
- بيانات الاتصال والعناوين والمعرفات الضريبية.
- منع التكرار والدمج وفك الدمج.
- ربط العميل بالمبيعات والمدفوعات والمرتجعات.
- الخصوصية والموافقات والتواصل التسويقي.
- البيع الآجل وحدود الائتمان.
- Store Credit.
- Loyalty Points.
- العضويات والمستويات والمكافآت.
- القسائم والعروض المرتبطة بالعميل.
- الاستيراد والتصدير والحذف والاحتفاظ.
- العمل دون اتصال ومنع الاحتيال والتدقيق.

لا تخلط الوثيقة بين العميل كممثل تجاري، والمستخدم الذي يدخل النظام، والمورد، وTenant membership.

## 2. المصطلحات

### Customer

جهة تشتري من Tenant وقد تكون فردًا أوشركة.

### Walk-in Customer

بيع غير مرتبط بملف عميل محدد، وليس Customer record وهمية مشتركة لكل الأشخاص.

### Customer Contact

وسيلة اتصال أوشخص اتصال مرتبط بعميل، مثل الهاتف أوالبريد أوContact لشركة.

### Customer Identity Evidence

معرف موثوق يستخدم للتحقق أوالمطابقة، مثل رقم هاتف مؤكد أوTax ID أوExternal ID.

### Customer Merge

عملية تربط سجلًا أساسيًا بسجلات مكررة مع الحفاظ على التاريخ والمصادر.

### Accounts Receivable

مبلغ مستحق للمتجر على العميل نتيجة بيع آجل أومطالبة مالية.

### Store Credit

مبلغ مستحق للعميل على المتجر يمكن استخدامه وفق قواعد محددة.

### Loyalty Points

وحدات مكافأة غير نقدية لا تساوي المال تلقائيًا، وتخضع لبرنامج وقواعد إصدار واستخدام وانتهاء.

### Loyalty Account

حساب برنامج ولاء مرتبط بعميل واحد داخل Tenant.

### Coupon

استحقاق أوCode يمنح Benefit وفق شروط، ولا يساوي Store Credit أوPoints.

## 3. المبادئ غير القابلة للتفاوض

### BR-CUS-200 — العميل مملوك لـTenant واحد

**التصنيف:** Invariant

Customer operational record لا تشارك بين Tenants، حتى لو كان الشخص نفسه يتعامل مع أكثر من نشاط.

### BR-CUS-201 — Customer ليست User Identity

**التصنيف:** Invariant

وجود ملف عميل لا يمنحه دخولًا للنظام، ووجود User account لا ينشئ Customer record تلقائيًا.

### BR-CUS-202 — Walk-in ليست عميلًا موحدًا قابلًا للتعديل

**التصنيف:** Invariant

المبيعات المجهولة تحفظ بدون Customer محددة أوباستخدام Sentinel داخلي غير قابل لامتلاك رصيد أونقاط أوبيانات شخصية.

### BR-CUS-203 — الرصيد لا يعدل مباشرة

**التصنيف:** Invariant

لا يوجد حقل Balance حر لكل من:

- Accounts receivable.
- Store credit.
- Loyalty points.
- Gift card liability مستقبلًا.

كل رصيد مشتق من Ledger خاص به.

### BR-CUS-204 — الدمج لا يحذف التاريخ

**التصنيف:** Invariant

Customer merge تحفظ السجلات الأصلية والمصادر والقرارات، وتعيد توجيه القراءة للسجل الأساسي دون كسر المراجع القديمة.

### BR-CUS-205 — الموافقة التسويقية ليست موافقة عامة للبيانات

**التصنيف:** Invariant

Consent للتسويق منفصلة عن ضرورة معالجة البيانات لإتمام البيع أوالالتزامات القانونية.

## 4. أنواع العملاء

### BR-CTY-100 — نوع العميل مثبت

**التصنيف:** Invariant

الأنواع المبدئية:

- individual.
- business.

### BR-CTY-101 — الفرد والشركة لهما متطلبات مختلفة

**التصنيف:** Invariant

الفرد قد يملك:

- name.
- phone/email.
- birth date اختياريًا وبموافقة مناسبة.

الشركة قد تملك:

- legal/trading name.
- tax identifier.
- registration data.
- billing address.
- contacts.
- credit terms.

### BR-CTY-102 — التحويل بين Individual وBusiness ليس تعديل Label فقط

**التصنيف:** Invariant

يحتاج تحققًا من الحقول والعلاقات والوثائق والآثار المالية.

### BR-CTY-103 — مجموعة/Household ليست Customer بسيطة

**التصنيف:** Deferred Capability

تحتاج نموذج علاقات مستقل، ولا تنفذ بدمج أفراد مختلفين في ملف واحد.

## 5. إنشاء العميل

### BR-CRT-100 — أقل بيانات ممكنة

**التصنيف:** Privacy Invariant

لا يطلب النظام بيانات لا يحتاجها السيناريو التجاري أوالقانوني أوالبرنامج المفعّل.

### BR-CRT-101 — إنشاء العميل ليس إلزاميًا للبيع النقدي العادي

**التصنيف:** Tenant Policy

الافتراضي المقترح:

- يسمح Walk-in sale.
- يصبح Customer مطلوبًا للبيع الآجل، Store credit، Loyalty، مستندات ضريبية محددة، أوطلبات مرتبطة بالعميل.

### BR-CRT-102 — مصدر الإنشاء محفوظ

**التصنيف:** Invariant

مثل:

- POS.
- Admin web.
- Import.
- API integration.
- E-commerce مستقبلًا.
- Support-assisted correction.

### BR-CRT-103 — المنشئ لا يثبت هوية العميل تلقائيًا

**التصنيف:** Invariant

حالة Verification لكل Contact أوIdentifier مستقلة عن إدخال الموظف لها.

### BR-CRT-104 — الحقول الإلزامية تعتمد على الغرض

**التصنيف:** Tenant/Legal Policy

مثال:

- Loyalty enrollment قد يتطلب Phone مؤكدًا.
- Credit sale يتطلب هوية وعنوانًا وApproval.
- Tax invoice قد تتطلب بيانات قانونية.

### BR-CRT-105 — الاسم لا يستخدم وحده لمنع التكرار

**التصنيف:** Invariant

تشابه الاسم يولد Suggestion فقط، لا Merge أوBlock قطعيًا.

## 6. بيانات الاتصال

### BR-CON-100 — العميل قد يملك أكثر من Contact method

**التصنيف:** Invariant

لكل وسيلة:

- type.
- value normalized.
- label.
- primary flag.
- verification status.
- consent relevance.
- validity status.

### BR-CON-101 — التطبيع لا يمحو القيمة الأصلية

**التصنيف:** Invariant

يحفظ النظام Representation مناسبة للعرض مع Normalized form للمطابقة.

### BR-CON-102 — Primary contact واحدة لكل نوع عند الحاجة

**التصنيف:** Invariant

لا يعني Primary أن باقي القيم محذوفة أوغير صالحة.

### BR-CON-103 — التحقق Event مستقل

**التصنيف:** Invariant

Phone/Email verification تحفظ:

- method.
- time.
- result.
- actor أوchannel.

### BR-CON-104 — تغيير Contact المؤكدة لا يرث Verification

**التصنيف:** Invariant

القيمة الجديدة تبدأ Unverified حتى تحققها.

### BR-CON-105 — Contact المشتركة لا تثبت أن السجلات مكررة

**التصنيف:** Invariant

رقم عائلة أوشركة يمكن أن يرتبط بأكثر من شخص؛ يستخدم كRisk/Match signal فقط.

## 7. العناوين

### BR-ADR-100 — العنوان كيان متعدد الاستخدام

**التصنيف:** Invariant

قد يكون:

- billing.
- shipping.
- legal.
- preferred.

### BR-ADR-101 — الفاتورة تحفظ Address snapshot عند الحاجة

**التصنيف:** Invariant

تغيير عنوان العميل لاحقًا لا يغير المستندات السابقة.

### BR-ADR-102 — حذف العنوان من الملف لا يحذف Snapshots التاريخية

**التصنيف:** Invariant

### BR-ADR-103 — Geo data ليست إلزامية

**التصنيف:** Privacy Policy

لا تجمع الإحداثيات إلا لغرض واضح وموافقة/أساس مشروع.

## 8. المعرفات القانونية والخارجية

### BR-IDN-100 — كل Identifier لها Type ونطاق

**التصنيف:** Invariant

مثل:

- tax ID.
- commercial registration.
- national ID عند الضرورة القانونية فقط.
- external CRM ID.
- loyalty card ID.

### BR-IDN-101 — المعرف الحساس مشفر ومقيد

**التصنيف:** Security Invariant

لا يظهر كاملًا لكل المستخدمين ولا يسجل كاملًا في Logs.

### BR-IDN-102 — uniqueness تعتمد على نوع ونطاق المعرف

**التصنيف:** Invariant

Tax ID قد يكون Unique داخل Country/Tenant، بينما External ID فريد داخل Integration source.

### BR-IDN-103 — المعرف المنتهي أوالمصحح يحتفظ بالتاريخ

**التصنيف:** Invariant

لا يستبدل دون أثر زمني.

## 9. منع التكرار

### BR-DUP-100 — Duplicate detection متعددة الإشارات

**التصنيف:** Invariant

قد تستخدم:

- verified phone.
- verified email.
- tax ID.
- name similarity.
- address.
- external IDs.

### BR-DUP-101 — لا Auto-merge بناءً على Similarity فقط

**التصنيف:** Invariant

Auto-link يسمح فقط لمعرف قوي ومؤكد وفق Policy، وإلا يحتاج مراجعة.

### BR-DUP-102 — إنشاء Duplicate ممكن كاستثناء موثق

**التصنيف:** Permission Bound

عند وجود سبب مشروع مثل أفراد يتشاركون Contact، يسجل السبب.

### BR-DUP-103 — Suggestions لا تكشف بيانات خارج Scope

**التصنيف:** Security Invariant

المستخدم يرى فقط القدر اللازم لتحديد التطابق ضمن صلاحياته.

## 10. دمج العملاء

### BR-MRG-100 — Merge لها سجل أساسي وAliases

**التصنيف:** Invariant

يحدد:

- survivor customer.
- merged customers.
- actor/approver.
- reason.
- field decisions.
- timestamp.

### BR-MRG-101 — المستندات التاريخية لا يعاد كتابتها صامتًا

**التصنيف:** Invariant

تبقى Original customer references قابلة للتدقيق، مع Resolution للسجل الأساسي في العرض الحالي.

### BR-MRG-102 — Ledgers لا تجمع بحقل مباشر

**التصنيف:** Invariant

Accounts receivable وStore credit وPoints تنتقل أوتربط عبر Transactions موثقة وفق كل Ledger.

### BR-MRG-103 — Conflict fields تحتاج قرارًا

**التصنيف:** Invariant

مثل:

- names.
- contacts.
- tax IDs.
- consent.
- credit limits.

لا يختار النظام الأحدث دائمًا بلا Rule.

### BR-MRG-104 — Consent الأكثر تحفظًا هو الافتراضي عند التعارض

**التصنيف:** Privacy Invariant

لا يتحول العميل إلى Marketing opted-in بسبب Merge غير واضحة.

### BR-MRG-105 — Unmerge ليست مضمونة

**التصنيف:** Invariant

يمكن دعمها فقط إذا كانت كل إعادة التوجيه والتحويلات قابلة للعكس دون فساد؛ وإلا يتم Corrective split workflow.

### BR-MRG-106 — Merge لعملاء عليهم التزامات عالية تحتاج Approval

**التصنيف:** Approval Bound

خاصة عند وجود Credit أوStore credit أوDisputes.

## 11. تعطيل وحالة العميل

### BR-STA-100 — Customer لها حالة

**التصنيف:** Invariant

الحالات المبدئية:

- active.
- restricted.
- blocked.
- inactive.
- merged.
- anonymized عند السماح.

### BR-STA-101 — Inactive لا تحذف التاريخ

**التصنيف:** Invariant

### BR-STA-102 — Block scope محدد

**التصنيف:** Invariant

يمكن أن يمنع:

- Credit sales.
- Returns without approval.
- Loyalty redemption.
- كل معاملات جديدة.

### BR-STA-103 — أسباب التقييد لا تظهر لكل الموظفين

**التصنيف:** Permission Bound

تعرض POS رسالة تشغيلية مناسبة دون تفاصيل حساسة.

## 12. ربط العميل بالمبيعات

### BR-SLN-100 — Customer assignment قبل Completion

**التصنيف:** Invariant

ربط العميل أوتغييره بعد اكتمال Sale لا يتم بتعديل مباشر، بل Corrective workflow مع Audit عند الحاجة القانونية أوالتشغيلية.

### BR-SLN-101 — Invoice تحفظ Customer snapshot المناسب

**التصنيف:** Invariant

يشمل فقط البيانات اللازمة للمستند.

### BR-SLN-102 — Walk-in sale لا تمنح نقاطًا تلقائيًا لاحقًا

**التصنيف:** Tenant Policy

إضافة Sale قديمة لحساب Loyalty تحتاج Claim workflow بحد زمني وإثبات، لا تعديلًا صامتًا.

### BR-SLN-103 — Sales history مرئية حسب Scope

**التصنيف:** Permission Bound

الكاشير يرى ما يحتاجه للمرتجع أوالخدمة، ولا يحصل بالضرورة على كل تاريخ وتحليلات العميل.

## 13. الخصوصية وأساس المعالجة

### BR-PRV-100 — كل فئة بيانات لها غرض

**التصنيف:** Privacy Invariant

تصنف البيانات وفق أغراض مثل:

- transaction fulfillment.
- legal/tax obligation.
- customer support.
- credit risk.
- loyalty program.
- marketing.

### BR-PRV-101 — Consent قابلة للإثبات

**التصنيف:** Invariant

تحفظ:

- purpose/channel.
- granted/withdrawn.
- timestamp.
- source.
- policy version.
- actor عند الإدخال المساعد.

### BR-PRV-102 — سحب Marketing consent لا يمحو المعاملات

**التصنيف:** Invariant

يوقف التواصل المستقبلي للقناة والغرض، بينما يبقى ما يلزم قانونيًا وتشغيليًا.

### BR-PRV-103 — Consent ليست شرطًا قسريًا للبيع غير المرتبط

**التصنيف:** Privacy Invariant

لا يجبر العميل على التسويق لإتمام شراء عادي.

### BR-PRV-104 — القنوات مستقلة

**التصنيف:** Invariant

Email وSMS وWhatsApp وPush لكل منها Preference وConsent منفصلة حسب القانون والسياسة.

### BR-PRV-105 — البيانات الحساسة لا تستخدم للتقسيم التسويقي بلا أساس

**التصنيف:** Security/Privacy Invariant

## 14. طلبات الخصوصية

### BR-DSR-100 — طلب الوصول له Verification

**التصنيف:** Invariant

لا تسلم بيانات العميل دون التحقق المناسب.

### BR-DSR-101 — التصدير يميز المصدر والتاريخ

**التصنيف:** Invariant

ويستبعد أسرار النظام وبيانات أطراف أخرى غير لازمة.

### BR-DSR-102 — الحذف لا يتغلب على الاحتفاظ القانوني

**التصنيف:** Legal Boundary

يستخدم:

- deletion.
- anonymization.
- restriction.
- legal hold.

وفق نوع البيانات والالتزام.

### BR-DSR-103 — Anonymization لا تكسر الحسابات المالية

**التصنيف:** Invariant

تبقى المستندات والأرقام والتجميعات، مع إزالة أوتقليل PII حيث يسمح القانون.

### BR-DSR-104 — كل Privacy request لها حالة وموعد

**التصنيف:** Invariant

الحالات:

- received.
- identity verification pending.
- under review.
- fulfilled.
- partially fulfilled.
- rejected with basis.

## 15. Accounts Receivable والبيع الآجل

### BR-AR-100 — Receivable ليست Store Credit

**التصنيف:** Invariant

- Receivable: العميل مدين للمتجر.
- Store credit: المتجر مدين للعميل.

لا يستخدم Sign واحد لتمثيل الاثنين.

### BR-AR-101 — البيع الآجل يحتاج Customer مؤكدة

**التصنيف:** Invariant

لا Credit sale لـWalk-in أوCustomer غير مؤهلة.

### BR-AR-102 — Credit account لها حالة

**التصنيف:** Invariant

- inactive.
- active.
- suspended.
- blocked.
- closed.

### BR-AR-103 — Credit limit ليست Balance

**التصنيف:** Invariant

الحد Policy، والرصيد مشتق من Invoices وPayments وCredits وAllocations.

### BR-AR-104 — Available credit قابل للتفسير

**التصنيف:** Invariant

```
Approved credit limit
- eligible outstanding exposure
- authorized pending exposure
= available credit
```

### BR-AR-105 — تجاوز الحد يحتاج Approval

**التصنيف:** Approval Bound

يسجل الحد والتعرض والزيادة والسبب والموافق.

### BR-AR-106 — Overdue policy مستقلة

**التصنيف:** Tenant Policy

قد:

- تحذر.
- تمنع Credit sales فقط.
- تحتاج Supervisor override.
- تمنع كل معاملات محددة.

### BR-AR-107 — السداد اللاحق Ledger transaction

**التصنيف:** Invariant

يرتبط بPayment وAllocation، ولا يعدل Invoice total.

### BR-AR-108 — Write-off ليست حذفًا

**التصنيف:** Approval/Accounting Bound

تحتاج سببًا ومستندًا وأثرًا محاسبيًا لاحقًا.

## 16. Store Credit

### BR-SCR-200 — Store Credit لها Ledger مستقلة

**التصنيف:** Invariant

Transactions المبدئية:

- issue.
- redeem.
- reverse redemption.
- expire عند السماح.
- adjust by approved correction.
- transfer during customer merge.

### BR-SCR-201 — كل إصدار له Source

**التصنيف:** Invariant

مثل:

- return/refund alternative.
- service recovery.
- promotional grant مع Liability policy.
- manual approved adjustment.

### BR-SCR-202 — الرصيد لا يصبح سالبًا

**التصنيف:** Invariant

Redemption لا تتجاوز Available balance.

### BR-SCR-203 — Currency واحدة لكل Credit account

**التصنيف:** Invariant

Multi-currency تحتاج حسابات منفصلة، ولا تحول تلقائيًا.

### BR-SCR-204 — الاستخدام Payment method مستقلة

**التصنيف:** Invariant

تظهر ضمن Tender breakdown ولا تعامل كDiscount.

### BR-SCR-205 — Expiry سياسة قانونية وتجارية

**التصنيف:** Tenant/Legal Policy

عند السماح:

- تاريخ الانتهاء معروف عند الإصدار.
- التنبيه اختياري حسب Notification policy.
- الانتهاء Transaction مستقلة.

### BR-SCR-206 — Store credit لا تستبدل بالنقد افتراضيًا

**التصنيف:** Tenant/Legal Policy

### BR-SCR-207 — Store credit لا تنقل بين العملاء افتراضيًا

**التصنيف:** Planning Decision

الاستثناء الوحيد المبدئي هو Merge موثقة أوCorrection مع Approval.

### BR-SCR-208 — Offline redemption ممنوعة في MVP

**التصنيف:** Planning Decision

لأن الرصيد مركزي وقد يستخدم في جهاز آخر.

### BR-SCR-209 — Duplicate redemption تمنع Server-side

**التصنيف:** Invariant

كل Redemption لها Idempotency identity وAtomic balance check.

## 17. برنامج الولاء

### BR-LOY-100 — Loyalty قابلة للتفعيل لكل Tenant

**التصنيف:** Tenant Policy

تعطيل البرنامج لا يحذف التاريخ أوالالتزامات السابقة.

### BR-LOY-101 — حساب ولاء واحد للعميل داخل البرنامج

**التصنيف:** Invariant

Customer merge تتبع قواعد نقل/دمج Ledger.

### BR-LOY-102 — Points ليست عملة

**التصنيف:** Invariant

لا تعرض كقيمة نقدية ثابتة إلا عند Redemption rule معلنة، ولا تدخل Cash reports.

### BR-LOY-103 — Ledger النقاط مستقلة

**التصنيف:** Invariant

Transactions:

- earn pending.
- earn available.
- redeem.
- reverse earn.
- reverse redeem.
- expire.
- approved adjustment.
- transfer during merge.

### BR-LOY-104 — الرصيد مشتق من Transactions

**التصنيف:** Invariant

لا تعديل مباشر.

### BR-LOY-105 — النقاط قد تكون Pending

**التصنيف:** Tenant Policy

لتغطية Return window أوFraud checks قبل الإتاحة.

## 18. كسب النقاط

### BR-EARN-100 — Earn rule لها Version

**التصنيف:** Invariant

تحفظ Sale القاعدة المستخدمة وقت الحساب.

### BR-EARN-101 — أساس الكسب محدد

**التصنيف:** Tenant Policy

مثل:

- net merchandise value.
- قبل أوبعد tax.
- بعد discounts.
- استبعاد فئات أوطرق دفع.

### BR-EARN-102 — لا نقاط على قيمة لم يدفعها العميل حسب Policy

**التصنيف:** Tenant Policy

يحدد أثر:

- Store credit redemption.
- coupons.
- gift cards مستقبلًا.
- refunds.
- credit sales غير المسددة.

### BR-EARN-103 — Earn rounding موحدة

**التصنيف:** Invariant

تحدد Precision ونقطة التقريب ولا تختلف بين POS وBackend.

### BR-EARN-104 — نفس Sale لا تكسب مرتين

**التصنيف:** Invariant

Retry أوCustomer claim لا تكرر Transaction.

### BR-EARN-105 — Walk-in sale claim مقيدة

**التصنيف:** Tenant Policy

عند دعمها تحتاج:

- proof of purchase.
- time limit.
- عدم سبق ربطها.
- Server validation.

### BR-EARN-106 — Return تعكس النقاط المرتبطة

**التصنيف:** Invariant

Partial return تعكس Portion محسوبًا من Earn الأصلية، لا قاعدة حالية جديدة.

### BR-EARN-107 — الرصيد قد يصبح سالبًا بسبب Return بعد Redemption

**التصنيف:** Open Decision

الخيارات:

- allow negative loyalty balance.
- deduct from Refund value وفق Legal policy.
- block return until settlement غير مفضل.
- record debt in loyalty account.

## 19. استخدام النقاط

### BR-RED-100 — Redemption لها Rate وRules مثبتة

**التصنيف:** Invariant

تحفظ:

- points used.
- benefit amount.
- currency.
- rule version.
- eligible lines.

### BR-RED-101 — Points available فقط قابلة للاستخدام

**التصنيف:** Invariant

Pending أوExpired لا تستخدم.

### BR-RED-102 — Redemption لا تتجاوز حدود البيع

**التصنيف:** Tenant Policy

قد تحدد:

- minimum points.
- maximum percentage of invoice.
- eligible products/categories.
- excluded promotions.

### BR-RED-103 — Loyalty redemption ليست Payment مالية

**التصنيف:** Product/Accounting Decision

يجب حسم عرضها محاسبيًا كDiscount أوLoyalty liability settlement، لكنها تبقى Tender/Benefit type مستقلة في الـDomain.

### BR-RED-104 — Offline redemption ممنوعة افتراضيًا

**التصنيف:** Planning Decision

### BR-RED-105 — فشل Sale يعكس Reservation/Redemption

**التصنيف:** Invariant

لا تضيع النقاط بسبب Attempt غير مكتملة.

### BR-RED-106 — Refund Sale استخدمت نقاطًا تتبع Allocation الأصلية

**التصنيف:** Invariant

تحدد السياسة هل تعاد النقاط أوتقل قيمة Refund النقدية، مع Snapshot معلنة وقت البيع.

## 20. انتهاء النقاط

### BR-EXP-100 — Expiry rule معلنة ومثبتة

**التصنيف:** Tenant/Legal Policy

قد تكون:

- لا تنتهي.
- fixed period from earn.
- inactivity-based.
- campaign-specific.

### BR-EXP-101 — الانتهاء Transaction لا Delete

**التصنيف:** Invariant

### BR-EXP-102 — FIFO consumption افتراضيًا

**التصنيف:** Tenant Policy

الاقتراح: استخدام أقدم Points المتاحة أولًا لتقليل الفقد، مع Traceability للدفعات.

### BR-EXP-103 — تغيير سياسة الانتهاء لا يطبق رجعيًا بلا قرار

**التصنيف:** Invariant

كل Earn batch تحتفظ بالPolicy المعمول بها أوMigration rule معلنة.

## 21. المستويات والعضويات

### BR-TIER-100 — Tier status مشتقة من Rules

**التصنيف:** Invariant

لا يعدل الموظف المستوى مباشرة إلا Adjustment موثق.

### BR-TIER-101 — Qualification window محددة

**التصنيف:** Tenant Policy

مثل spend أوvisits أوpoints earned خلال فترة.

### BR-TIER-102 — Benefits لها Version وفترة

**التصنيف:** Invariant

تغيير مزايا المستوى لا يغير مبيعات سابقة.

### BR-TIER-103 — Downgrade وGrace period سياسة

**التصنيف:** Tenant Policy

### BR-TIER-104 — Return قد تؤثر على Qualification

**التصنيف:** Tenant Policy

يجب حسم هل تستخدم Net spend بعد المرتجعات.

### BR-TIER-105 — Manual tier grant يحتاج Expiry وReason

**التصنيف:** Approval Bound

## 22. القسائم والأكواد

### BR-CPN-100 — Coupon ليست Points أوCredit

**التصنيف:** Invariant

لها Lifecycle واستخدام مستقل.

### BR-CPN-101 — Coupon تحدد Owner scope

**التصنيف:** Tenant Policy

- public reusable code.
- single-use code.
- customer-bound.
- campaign-bound.

### BR-CPN-102 — الاستخدام Idempotent

**التصنيف:** Invariant

لا تُستهلك مرتين لنفس Sale أوRetry.

### BR-CPN-103 — الاستخدام النهائي عند Completion

**التصنيف:** Invariant

إضافة Coupon للسلة قد تحجزها، لكن الفشل أوالإلغاء يحررها وفق Timeout.

### BR-CPN-104 — Return behavior مثبتة

**التصنيف:** Invariant

تحدد هل:

- Coupon تعاد.
- Benefit لا تعاد.
- Refund تخصم Benefit.

### BR-CPN-105 — Codes الحساسة لا تظهر كاملة في Logs

**التصنيف:** Security Invariant

## 23. Segmentation والتخصيص

### BR-SEG-100 — Segment ليست Source of Truth للهوية

**التصنيف:** Invariant

هي Classification مشتقة أويدوية لأغراض محددة.

### BR-SEG-101 — القواعد قابلة للتفسير

**التصنيف:** Invariant

يجب معرفة لماذا دخل العميل Segment، خصوصًا للائتمان والمخاطر.

### BR-SEG-102 — Sensitive segmentation مقيدة

**التصنيف:** Privacy Invariant

### BR-SEG-103 — خروج العميل من Segment لا يغير مستندات سابقة

**التصنيف:** Invariant

### BR-SEG-104 — Automated decisions عالية الأثر تحتاج مراجعة

**التصنيف:** Governance Policy

لا يرفض Credit أوReturn نهائيًا بناءً على Score غير قابل للتفسير وحده.

## 24. التواصل والتفضيلات

### BR-COM-100 — Transactional messages منفصلة عن Marketing

**التصنيف:** Invariant

إيصال أوحالة Refund قد تُرسل كأساس تشغيلي، بينما العروض تحتاج Consent المناسب.

### BR-COM-101 — Channel preference لا تتغلب على ضرورة حرجة بلا Policy

**التصنيف:** Invariant

### BR-COM-102 — Quiet hours وFrequency caps قابلة للتهيئة

**التصنيف:** Tenant/Legal Policy

### BR-COM-103 — Unsubscribe يطبق بسرعة وبشكل قابل للإثبات

**التصنيف:** Invariant

### BR-COM-104 — فشل التسليم لا يعيد تفعيل قناة أخرى تلقائيًا

**التصنيف:** Privacy Invariant

## 25. Offline behavior

### BR-COFF-100 — Customer lookup يمكن أن تعمل من Cache محدودة

**التصنيف:** Location Policy

تحتوي أقل قدر لازم، مثل الاسم المختصر وCustomer ID وeligibility flags غير الحساسة.

### BR-COFF-101 — إنشاء Customer Offline حالة Pending

**التصنيف:** Deferred/Controlled Capability

عند دعمها:

- Client-generated ID.
- minimal data.
- duplicate check عند Sync.
- لا Credit أوStore credit أوPoints redemption قبل Server confirmation.

### BR-COFF-102 — Loyalty earn قد تسجل Pending Offline

**التصنيف:** Planning Decision

تؤكد عند مزامنة Sale، ولا تظهر Available قبل Server processing.

### BR-COFF-103 — Store credit وPoints redemption Online-required

**التصنيف:** Planning Decision

### BR-COFF-104 — Credit sale Online-required في MVP

**التصنيف:** Planning Decision

### BR-COFF-105 — Cache تحترم revocation وexpiry

**التصنيف:** Security Invariant

الـOffline lease لها مدة، ولا تبقي بيانات عميل حساسة بلا حدود.

## 26. الاحتيال والمخاطر

### BR-RSK-100 — Risk flags منفصلة عن Customer status

**التصنيف:** Invariant

لا يتحول العميل تلقائيًا إلى Blocked دون Rule أوReview.

### BR-RSK-101 — Sources موثقة

**التصنيف:** Invariant

مثل:

- repeated no-receipt attempts.
- chargeback history.
- credit delinquency.
- identity mismatch.
- suspicious loyalty redemption.

### BR-RSK-102 — الموظف يرى Action لا تفاصيل غير لازمة

**التصنيف:** Security Invariant

مثال: `Supervisor approval required` بدل كشف بيانات حساسة.

### BR-RSK-103 — Loyalty abuse تمنع Transaction لا تمحو Ledger

**التصنيف:** Invariant

التصحيح عبر Reversal/Adjustment.

### BR-RSK-104 — Manual block يحتاج Reason وReview date

**التصنيف:** Approval Bound

## 27. الاستيراد والتصدير

### BR-IMP-100 — Import لا يتجاوز Duplicate detection

**التصنيف:** Invariant

يعرض:

- create.
- update matched.
- ambiguous.
- rejected.

### BR-IMP-101 — External IDs تحفظ Source

**التصنيف:** Invariant

### BR-IMP-102 — Null لا يمحو بيانات موجودة افتراضيًا

**التصنيف:** Import Policy

يحتاج Explicit clear instruction.

### BR-IMP-103 — Consent لا تستورد كـGranted بلا Evidence

**التصنيف:** Privacy Invariant

### BR-IMP-104 — Import المالية وLedgers لها مسار منفصل

**التصنيف:** Invariant

لا يستورد Store credit أوPoints كحقل Balance؛ يستخدم Opening/Adjustment transactions مع Approval.

### BR-EXP-200 — Export يخضع للصلاحيات والغرض

**التصنيف:** Security Invariant

- PII masked حسب Role.
- Audit للExports الحساسة.
- Scope وfilters واضحة.

## 28. الحذف والاحتفاظ

### BR-DEL-100 — العميل المستخدم ماليًا لا يحذف Hard delete

**التصنيف:** Invariant

يستخدم Deactivate أوAnonymize حسب Legal policy.

### BR-DEL-101 — Ledgers تحتفظ بالمرجع المطلوب

**التصنيف:** Invariant

حتى عند تقليل PII.

### BR-DEL-102 — Merge record لا يحذف أثناء الاحتفاظ

**التصنيف:** Invariant

### BR-DEL-103 — Legal hold يمنع الإزالة

**التصنيف:** Legal Boundary

### BR-DEL-104 — Retention تختلف حسب Data class

**التصنيف:** Privacy/Legal Policy

المعاملات والConsent والSupport notes لا يلزم أن تتشارك نفس المدة.

## 29. الصلاحيات

### BR-CAU-100 — الصلاحيات منفصلة

**التصنيف:** Invariant

تشمل:

- create customer.
- edit basic profile.
- view sensitive identifiers.
- verify contact.
- merge customers.
- block/restrict customer.
- manage consent.
- approve credit account.
- change credit limit.
- issue Store credit.
- adjust Loyalty points.
- export customer data.
- fulfill privacy request.

### BR-CAU-101 — Merge وCredit وStore credit تحتاج Approval حسب الحدود

**التصنيف:** Approval Bound

### BR-CAU-102 — Support access مؤقت ومبرر

**التصنيف:** Invariant

### BR-CAU-103 — POS edit scope محدود

**التصنيف:** Tenant Policy

الكاشير قد يعدل الاسم وContact ضمن شروط، لكن لا يغير Tax ID أوCredit limit أوConsent history الحساسة بلا صلاحية.

## 30. Audit وEvents

### BR-CAUD-100 — الأحداث الحرجة مسجلة

**التصنيف:** Invariant

تشمل:

- Customer created/updated/deactivated.
- Contact verified/changed.
- Consent granted/withdrawn.
- Duplicate suggested/overridden.
- Merge requested/completed/corrected.
- Credit account activated/suspended/limit changed.
- Store credit issued/redeemed/reversed/expired.
- Points earned/redeemed/reversed/expired/adjusted.
- Tier changed.
- Privacy request received/fulfilled.
- Sensitive export generated.

### BR-CAUD-101 — Audit تخزن ما يكفي دون تسريب PII

**التصنيف:** Security Invariant

### BR-CAUD-102 — Ledger event تربط Source transaction

**التصنيف:** Invariant

## 31. الأخطاء والاسترداد

### BR-CERR-100 — Duplicate ambiguity لا تحسم بصمت

**التصنيف:** Invariant

تنتقل للمراجعة أوتسمح بإنشاء موثق حسب Permission.

### BR-CERR-101 — فشل Merge لا يترك نصف تحويل

**التصنيف:** Invariant

العملية ذرية منطقيًا أوتدخل Recovery state واضحة.

### BR-CERR-102 — Unknown redemption لا يعاد يدويًا

**التصنيف:** Invariant

Points وStore credit تستخدم Idempotency وInquiry.

### BR-CERR-103 — Correction عبر Transactions

**التصنيف:** Invariant

لا Direct balance edit أوSQL recovery.

### BR-CERR-104 — Privacy failure تصعد دون كشف زائد

**التصنيف:** Invariant

## 32. التقارير

### BR-CREP-100 — Customer sales لا تخلط Walk-in بعميل مصطنع

**التصنيف:** Invariant

### BR-CREP-101 — Receivable وStore credit وPoints أرصدة منفصلة

**التصنيف:** Invariant

### BR-CREP-102 — Loyalty liability قابلة للتقدير

**التصنيف:** Reporting/Accounting Boundary

تقارير تشمل:

- points issued.
- pending.
- available.
- redeemed.
- expired.
- estimated liability وفق نموذج لاحق.

### BR-CREP-103 — Consent reporting حسب قناة وVersion

**التصنيف:** Invariant

### BR-CREP-104 — Customer lifetime metrics تفرق Gross وNet

**التصنيف:** Invariant

بعد Returns/Refunds وبدون خلط Payments بالتسوق.

### BR-CREP-105 — Merge لا يضاعف العميل في التجميع

**التصنيف:** Invariant

مع إمكان تتبع المعرّفات التاريخية.

## 33. السيناريوهات الإلزامية للاختبار لاحقًا

1. Walk-in cash sale بلا Customer.
2. إنشاء Individual من POS.
3. إنشاء Business بTax ID.
4. Duplicate phone suggestion.
5. Shared family phone دون Merge.
6. Customer merge بسجلات مبيعات.
7. Merge مع Store credit وPoints.
8. Consent conflict أثناء Merge.
9. تغيير Phone مؤكدة.
10. Deactivate customer مع تاريخ مالي.
11. Credit sale داخل الحد.
12. Credit sale فوق الحد.
13. Overdue customer restriction.
14. Later payment وAllocation.
15. Store credit issue من Return.
16. Partial Store credit redemption.
17. Duplicate redemption retry.
18. Store credit expiry عند السماح.
19. Loyalty earn من Sale.
20. Partial Return تعكس جزءًا من Points.
21. Redeem points ثم Return.
22. Pending points تصبح Available.
23. Points expiry FIFO.
24. Tier upgrade/downgrade.
25. Coupon reservation ثم Sale failure.
26. Withdraw marketing consent.
27. Privacy export بعد verification.
28. Anonymize customer مع الحفاظ على الفواتير.
29. Import duplicate ambiguity.
30. Import Opening loyalty balance كTransaction.
31. Offline customer draft ثم duplicate عند Sync.
32. Offline Sale تكسب Pending points.
33. منع Offline Store credit redemption.
34. Cross-tenant customer access rejection.
35. Sensitive export permission denial.

## 34. القرارات المفتوحة

### OD-CUS-001 — Minimum customer fields

**الاقتراح:** Name + وسيلة اتصال واحدة عند الحاجة، دون حقول إجبارية غير لازمة للبيع النقدي.

### OD-CUS-002 — Phone uniqueness

**الاقتراح:** ليست Unique قطعيًا؛ verified phone إشارة قوية مع دعم Shared contact.

### OD-CUS-003 — Business customers في MVP

**الاقتراح:** دعم Basic business profile وTax fields، وتأجيل hierarchy والعقود المعقدة.

### OD-CUS-004 — Credit sales في MVP

**الاقتراح:** خارج Pilot الأول أوتُفعّل لعملاء مختارين فقط بعد AR State Machine وPermission Matrix.

### OD-CUS-005 — Store Credit في MVP

**الاقتراح:** لا تبدأ قبل Ledger مكتملة وOnline-only redemption؛ يمكن تأجيلها بعد Returns الأساسية.

### OD-CUS-006 — Loyalty في MVP

**الاقتراح:** Earn-only بسيط أولًا أوتأجيل البرنامج كاملًا حتى ثبات البيع والمرتجعات؛ Redemption تزيد مخاطر الـOffline والتسوية.

### OD-CUS-007 — Points after return when already spent

**الاقتراح:** يسمح Loyalty balance سالبًا مع منع Redemption إضافية حتى التسوية، دون تقليل Refund النقدية تلقائيًا قبل مراجعة قانونية وتجارية.

### OD-CUS-008 — Points expiry

**الاقتراح:** No expiry افتراضيًا للنسخة الأولى لتقليل التعقيد، أوFixed expiry واضحة إن أثبت السوق ضرورتها.

### OD-CUS-009 — Customer claim of old Walk-in sale

**الاقتراح:** خارج MVP أوضمن نافذة قصيرة وبإثبات قوي وموافقة.

### OD-CUS-010 — Customer merge approval

**الاقتراح:** Supervisor/Data steward، وإلزام Approval إضافي عند وجود Credit أوStore credit أوTax identifiers متعارضة.

### OD-CUS-011 — Marketing channels

تُحسم حسب Integrations والقانون؛ Consent لكل قناة وغرض.

### OD-CUS-012 — Customer self-service portal

**القرار:** خارج MVP؛ Domain يستوعبه لاحقًا دون ربط Customer مباشرة بـUser الآن.

## 35. خارج النطاق حاليًا

- Customer social network profiles.
- Household accounts.
- Shared family wallets.
- AI-based autonomous credit denial.
- Automated personalized pricing غير القابل للتفسير.
- Gift cards قبل Liability Blueprint.
- Coalition loyalty بين Tenants.
- Point transfer بين العملاء.
- Cash-out of Store credit.
- Customer portal/mobile app.
- Advanced CRM pipelines.
- Marketing automation platform كامل.

## 36. Dependencies

هذه الوثيقة تغذي:

- Customer Domain Model.
- Customer Merge State Machine.
- Credit Account State Machine.
- Store Credit Ledger and State Machine.
- Loyalty Ledger and Program rules.
- Sales and Returns workflows.
- Permission Matrix.
- Data Classification.
- Privacy and Security Blueprints.
- Event and Audit Catalogs.
- API and Error Contracts.
- Sync/Offline Protocols.
- Database Blueprint.
- Reporting and Notification Models.

## 37. Acceptance Gate

لا تعتبر Customer planning مكتملة قبل:

1. اعتماد Individual وBusiness scope.
2. اعتماد minimum fields وduplicate signals.
3. اعتماد Merge policy وconflict resolution.
4. اعتماد Privacy purposes وConsent channels.
5. حسم Credit sales scope.
6. حسم Store credit timing وexpiry وredemption rules.
7. حسم Loyalty MVP: earn-only أوearn/redeem أوdeferred.
8. اعتماد Return effects على Points وStore credit.
9. اعتماد Offline matrix.
10. اعتماد Retention وAnonymization boundaries.
11. تحويل كل Rule حرجة إلى State transition أوLedger transaction أوPermission أوConstraint أوTest requirement.

## 38. القرار التخطيطي الحالي

- Customer وUser وSupplier كيانات مختلفة.
- Walk-in sale لا تنشئ ملف عميل وهميًا.
- Phone ليست Unique قطعيًا، والدمج لا يتم آليًا بالتشابه.
- Receivable وStore credit وLoyalty points ثلاثة Ledgers منفصلة.
- Store credit وPoints redemption Online-required.
- Credit sale Online-required وتحتاج Customer مؤكدة وحدًا وموافقة.
- No-receipt returns لا تستخدم Store credit كاختصار قبل بناء Ledger.
- Loyalty يمكن أن تبدأ Earn-only أوتؤجل؛ Redemption لا تدخل Pilot قبل ثبات Returns وOffline sync.
- Consent لكل غرض وقناة، وسحب التسويق لا يمحو التاريخ القانوني.
- Customer merge تحفظ Aliases والتاريخ وتستخدم السياسة الأكثر تحفظًا للConsent.