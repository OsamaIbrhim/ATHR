# ATHR Notifications, Documents, Reporting & Data Retention Business Rules v1.0

**Planning Baseline — Immutable Documents, Reliable Delivery, Explainable Reporting and Governed Retention**

## 1. وظيفة الوثيقة

هذه الوثيقة هي المرجع التفصيلي لقواعد:

- الإيصالات والفواتير والمستندات التجارية.
- أرقام المستندات وتسلسلها.
- إنشاء نسخ العرض والطباعة وPDF.
- إعادة الطباعة وإعادة الإرسال.
- المرفقات والأدلة.
- الإشعارات التشغيلية والتسويقية.
- قنوات Email وSMS وWhatsApp وPush وIn-app عند دعمها.
- محاولات التسليم وإعادة المحاولة والتسوية.
- التقارير ولوحات المتابعة والمؤشرات.
- التقارير المجدولة والـExports.
- تعريف المقاييس ونطاق البيانات وتوقيت التحديث.
- الاحتفاظ بالبيانات والأرشفة والحذف والـAnonymization.
- Legal Hold والقيود القانونية.
- الصلاحيات والتدقيق والأخطاء والاسترداد.

هذه الوثيقة لا تجعل ملف PDF أوDashboard مصدر الحقيقة؛ مصدر الحقيقة يظل المستند التجاري والـLedgers والأحداث المعتمدة في الـDomains الأصلية.

## 2. المصطلحات

### Business Document

تمثيل ثابت لواقعة تجارية معتمدة، مثل Sales Invoice أوReturn Document أوGoods Receipt.

### Document Snapshot

القيم التجارية والقانونية المحفوظة وقت إصدار المستند، ولا تتغير بتعديل البيانات الرئيسية لاحقًا.

### Document Render

نسخة عرض ناتجة من المستند، مثل HTML أوPDF أوصيغة طباعة حرارية.

### Print Attempt

محاولة إرسال Render إلى طابعة محددة، ولها نتيجة مستقلة.

### Delivery Attempt

محاولة إرسال مستند أوإشعار عبر قناة محددة إلى Recipient محدد.

### Notification

رسالة ناتجة عن حدث أوطلب أوحملة، لها غرض وقناة ومحتوى وحالة.

### Report Definition

تعريف ثابت للمقياس والمصدر والفلاتر والحساب والدقة والزمن.

### Report Run

تنفيذ محدد لتعريف تقرير باستخدام Scope وفترة ومعايير ومستخدم وتوقيت معين.

### Export

ملف بيانات ناتج عن Report Run أوQuery مصرح بها.

### Retention Policy

قاعدة تحدد مدة الاحتفاظ والإجراء بعد المدة لكل Data class.

### Legal Hold

قيد يمنع حذف أوإتلاف بيانات محددة بسبب التزام قانوني أوتحقيق أونزاع.

### Anonymization

إزالة أوتعمية الهوية الشخصية مع الحفاظ على الحقائق الضرورية والتجميعات والمستندات القانونية.

## 3. المبادئ غير القابلة للتفاوض

### BR-DOC-100 — المستند التجاري ونسخة العرض منفصلان

**التصنيف:** Invariant

- Business Document هي الحقيقة.
- PDF أوHTML أوPrint payload نسخة مشتقة.
- حذف Render أوفشل إنشائها لا يحذف المستند.
- يمكن إعادة إنشاء Render من Snapshot والقالب المعتمد.

### BR-DOC-101 — الطباعة والإرسال لا يحددان نجاح المعاملة

**التصنيف:** Invariant

نجاح Sale أوReturn أوPayment لا يعتمد على نجاح الطابعة أوEmail، إلا إذا فرض قانون خاص تسليمًا فوريًا كشرط مستقل تتم متابعته بحالة واضحة.

### BR-DOC-102 — المستندات المعتمدة لا تعدل صامتًا

**التصنيف:** Invariant

التصحيح يكون عبر:

- Credit note.
- Debit note.
- Void/Reversal.
- Replacement document.
- Correction document.

وفق قواعد الـDomain والقانون، مع بقاء الأصل.

### BR-DOC-103 — التقارير ليست مصدرًا لتعديل الحقيقة

**التصنيف:** Invariant

Dashboard أوExport لا تستخدم كبديل لتعديل Ledgers أوالمستندات الأصلية.

### BR-DOC-104 — كل رقم ومقياس قابل للتفسير

**التصنيف:** Invariant

يجب معرفة:

- مصدر البيانات.
- تعريف المقياس.
- نطاق Tenant/Location.
- المنطقة الزمنية.
- العملة.
- تاريخ التحديث.
- ما تم استبعاده.

### BR-DOC-105 — الاحتفاظ والحذف حسب Data class

**التصنيف:** Invariant

لا توجد مدة عالمية واحدة لكل البيانات، ولا Hard delete عام لكل Tenant.

### BR-DOC-106 — Legal Hold تتغلب على الحذف المجدول

**التصنيف:** Invariant

ولا تتغلب تلقائيًا على ضوابط الوصول والسرية.

## 4. أنواع المستندات

### BR-DTY-100 — لكل مستند Type ثابت

**التصنيف:** Invariant

الأنواع المبدئية تشمل:

- sales receipt.
- sales invoice.
- simplified tax invoice عند الحاجة القانونية.
- return document.
- refund receipt.
- exchange receipt.
- credit note.
- debit note.
- payment receipt.
- purchase order.
- goods receipt.
- supplier return.
- supplier invoice reference/copy عند إدخالها.
- transfer document.
- stock adjustment document.
- stock count result.
- shift opening/closing report.
- cash movement receipt.

### BR-DTY-101 — Type لا يتغير بعد الإصدار

**التصنيف:** Invariant

لا تتحول Receipt إلىTax Invoice بتغيير Label فقط؛ ينشأ المستند الصحيح أوCorrection workflow حسب القانون.

### BR-DTY-102 — المستند يحدد مصدره

**التصنيف:** Invariant

كل Document ترتبط بـSource aggregate أوTransaction موثوقة.

### BR-DTY-103 — المستند المركب يوضح مكوناته

**التصنيف:** Invariant

Exchange receipt مثلًا تعرض Return وNew Sale وSettlement دون دمج هوياتها.

## 5. Snapshot المستند

### BR-SNP-100 — Snapshot تحفظ القيم اللازمة لإثبات الواقعة

**التصنيف:** Invariant

قد تشمل:

- Tenant وLegal Entity وLocation snapshots.
- document number and issue time.
- customer/supplier snapshot عند الحاجة.
- line descriptions, SKU, barcode reference, UOM.
- quantities.
- list price, discounts, net price.
- taxes and rounding.
- tenders and payment references الآمنة.
- return/refund links.
- actor, terminal, shift.
- currency and exchange rate عند الحاجة.
- legal fields and template version.

### BR-SNP-101 — Snapshot لا تعتمد على Current master data للعرض القانوني

**التصنيف:** Invariant

تغيير اسم العميل أوالمنتج أوالفرع لاحقًا لا يغير المستند المصدر.

### BR-SNP-102 — Current-view تقارير إدارية فقط

**التصنيف:** Reporting Policy

يمكن عرض تصنيف أواسم حالي بجانب Snapshot، لكن يجب تمييزه صراحة.

### BR-SNP-103 — البيانات الحساسة تقلل إلى الضروري

**التصنيف:** Privacy Invariant

لا يوضع في المستند أوRender ما لا يحتاجه الغرض القانوني أوالتشغيلي.

## 6. ترقيم المستندات

### BR-NUM-100 — الرقم فريد داخل نطاق معلوم

**التصنيف:** Invariant

النطاق قد يكون:

- Tenant.
- Legal Entity.
- Location.
- Document type.
- Fiscal period.

ويجب تثبيته لكل نوع.

### BR-NUM-101 — الرقم لا يعاد استخدامه

**التصنيف:** Invariant

حتى بعد Void أوCancel أوفشل الطباعة.

### BR-NUM-102 — حجز الرقم لا يعني اكتمال المستند

**التصنيف:** Invariant

إذا حجز رقم ثم فشل الإصدار، تحتفظ المنظومة بسجل Gap أوCancelled reservation وفق السياسة القانونية.

### BR-NUM-103 — Offline numbering لها Namespace آمنة

**التصنيف:** Architecture/Legal Decision

يجب أن تمنع التصادم وتتيح تتبع الجهاز والفترة، أوتمنع إصدار أنواع قانونية Offline إذا تعذر ذلك.

### BR-NUM-104 — تغيير Sequence لا يعيد ترقيم الماضي

**التصنيف:** Invariant

### BR-NUM-105 — Manual number override ممنوع افتراضيًا

**التصنيف:** Planning Decision

الاستيراد أوMigration تستخدم External document reference منفصلًا، لا كسر sequence الداخلية.

## 7. إصدار المستند

### BR-ISS-100 — الإصدار Idempotent

**التصنيف:** Invariant

نفس Source والنسخة ونوع المستند لا تنشئ مستندات مكررة بسبب Retry.

### BR-ISS-101 — Issued time وBusiness event time منفصلان

**التصنيف:** Invariant

قد يتأخر الإصدار التقني، لكن تحفظ أوقات:

- business occurrence.
- recorded.
- issued.

### BR-ISS-102 — الإصدار يثبت Template version القانونية

**التصنيف:** Invariant

### BR-ISS-103 — فشل إنشاء Render لا يعيد Posting المالي

**التصنيف:** Invariant

يعاد Render فقط باستخدام Document ID نفسها.

### BR-ISS-104 — المستند القانوني يحتاج Validation قبل Issued

**التصنيف:** Legal Boundary

يفشل الإصدار إذا نقص Field قانوني إلزامي، ويظهر Recovery دون إنشاء مستند زائف مكتمل.

## 8. القوالب والعرض

### BR-TPL-100 — Template لها Version وScope

**التصنيف:** Invariant

قد تختلف حسب:

- Tenant.
- Legal Entity.
- Location.
- Document type.
- language.
- paper size/channel.

### BR-TPL-101 — التغيير يطبق على الإصدارات الجديدة

**التصنيف:** Invariant

إعادة طباعة مستند تاريخي تستخدم القالب التاريخي افتراضيًا، مع إمكانية `current presentation copy` إدارية مميزة وليست نسخة قانونية بديلة.

### BR-TPL-102 — القالب لا يحسب الحقائق المالية

**التصنيف:** Invariant

القيم والحسابات تأتي من Document Snapshot، والقالب مسؤول عن العرض فقط.

### BR-TPL-103 — الحقول الاختيارية لا تترك Labels مضللة

**التصنيف:** Invariant

### BR-TPL-104 — اللغة واتجاه الكتابة مدعومان

**التصنيف:** Tenant Policy

خصوصًا Arabic RTL وEnglish LTR، مع Fallback واضح.

### BR-TPL-105 — Logo والتنسيق لا يطغيان على البيانات القانونية

**التصنيف:** Legal/UX Constraint

## 9. PDF والنسخ الرقمية

### BR-PDF-100 — كل Render لها هوية

**التصنيف:** Invariant

تحفظ:

- document ID.
- template version.
- format.
- locale.
- generated time.
- checksum/hash عند الحاجة.
- generator version.

### BR-PDF-101 — Render المتطابقة قابلة لإعادة الاستخدام

**التصنيف:** Performance Policy

مع عدم اعتبار الـCache مصدر الحقيقة.

### BR-PDF-102 — إعادة التوليد لا تغير المستند

**التصنيف:** Invariant

### BR-PDF-103 — رابط المستند مؤقت ومصرح

**التصنيف:** Security Invariant

لا تستخدم Public permanent URLs للمستندات الحساسة افتراضيًا.

### BR-PDF-104 — تنزيل المستند يسجل عند الحساسية

**التصنيف:** Audit Policy

## 10. الطباعة وإعادة الطباعة

### BR-PRN-100 — Print Attempt كيان مستقل

**التصنيف:** Invariant

تحفظ:

- document/render.
- printer/terminal.
- requested by.
- requested time.
- status.
- error code.
- copy type.

### BR-PRN-101 — إعادة الطباعة لا تنشئ مستندًا جديدًا

**التصنيف:** Invariant

### BR-PRN-102 — النسخة المعادة تميز عند السياسة

**التصنيف:** Tenant/Legal Policy

يمكن وضع `COPY` أو`REPRINT` وعدد النسخ ووقت إعادة الطباعة إذا تطلب التشغيل أوالقانون.

### BR-PRN-103 — Auto-print failure تظهر دون تعطيل البيع المكتمل

**التصنيف:** Invariant

### BR-PRN-104 — اختيار Printer ضمن Scope الجهاز

**التصنيف:** Security/Operations Rule

### BR-PRN-105 — Print retry لا تكرر أي أثر مالي

**التصنيف:** Invariant

### BR-PRN-106 — No-paper وOffline-printer أخطاء تشغيلية مختلفة

**التصنيف:** Error Contract Requirement

## 11. إرسال المستندات للعملاء والموردين

### BR-DLV-100 — Delivery منفصلة عن Document

**التصنيف:** Invariant

يمكن إرسال نفس المستند أكثر من مرة أوأكثر من قناة، مع محاولة مستقلة لكل إرسال.

### BR-DLV-101 — Recipient snapshot محفوظة

**التصنيف:** Invariant

تغيير Email/Phone لاحقًا لا يغير من استلم المحاولة السابقة.

### BR-DLV-102 — الإرسال يحتاج غرضًا وقناة

**التصنيف:** Invariant

مثل Receipt transactional delivery وليس Marketing.

### BR-DLV-103 — Resend لا تعيد إصدار Document

**التصنيف:** Invariant

### BR-DLV-104 — بيانات الدفع الحساسة لا ترسل

**التصنيف:** Security Invariant

تستخدم References masked فقط.

### BR-DLV-105 — المستند الرقمي لا يرسل لعنوان غير مؤكد دون Policy

**التصنيف:** Tenant/Privacy Policy

### BR-DLV-106 — Delivery proof لا يساوي قراءة المستلم دائمًا

**التصنيف:** Invariant

يفرق بين queued, accepted by provider, delivered, opened عند توفرها، bounced, failed.

## 12. المرفقات والأدلة

### BR-ATT-100 — Attachment لها Owner وSource

**التصنيف:** Invariant

مثل صورة عيب، Supplier invoice scan، توقيع، أوإثبات موافقة.

### BR-ATT-101 — المرفق لا يغير الواقعة الأصلية

**التصنيف:** Invariant

هو Evidence مرتبطة وليست بديلًا عن Structured fields.

### BR-ATT-102 — File type والحجم والفحص الأمني إلزامية

**التصنيف:** Security Invariant

### BR-ATT-103 — النسخ والاستبدال Versioned

**التصنيف:** Invariant

لا يستبدل ملف مستخدم كدليل دون الاحتفاظ بالتاريخ.

### BR-ATT-104 — الوصول للمرفق يتبع Scope المصدر

**التصنيف:** Security Invariant

### BR-ATT-105 — Retention المرفق قد تختلف عن المستند

**التصنيف:** Retention Policy

لكن Legal Hold على القضية قد تشمل الاثنين.

## 13. تصنيف الإشعارات

### BR-NTF-100 — كل Notification لها Purpose class

**التصنيف:** Invariant

الفئات المبدئية:

- transactional.
- operational.
- security.
- approval/request.
- compliance.
- marketing.
- system incident/service status.

### BR-NTF-101 — Transactional لا تصبح Marketing بإضافة عرض

**التصنيف:** Privacy Invariant

المحتوى التسويقي يحتاج Consent وسياسة مستقلة.

### BR-NTF-102 — Security notifications لا يمكن تعطيلها كلها

**التصنيف:** Security Policy

مثل تغيير كلمة مرور أوإضافة جهاز أوBank details، حسب نوع المستخدم.

### BR-NTF-103 — كل Event لا ينتج إشعارًا تلقائيًا

**التصنيف:** Product Policy

Event Catalog وNotification rules منفصلان لتجنب الضوضاء.

## 14. قواعد تشغيل الإشعار

### BR-NTR-100 — Trigger محدد وVersioned

**التصنيف:** Invariant

تحدد القاعدة:

- source event.
- conditions.
- audience.
- channel priority.
- template version.
- deduplication window.
- urgency.

### BR-NTR-101 — نفس الحدث لا يرسل مرتين بسبب Retry

**التصنيف:** Invariant

Deduplication identity تربط Source event وRule وRecipient.

### BR-NTR-102 — التغيير في Rule لا يعيد إرسال الماضي

**التصنيف:** Invariant

إلا Backfill مصرح ومعلن.

### BR-NTR-103 — Aggregation ممكنة للأحداث المتكررة

**التصنيف:** Tenant Policy

مثل Low-stock digest بدل رسالة لكل Item.

### BR-NTR-104 — Escalation لها مراحل وأزمنة

**التصنيف:** Operational Policy

مثل طلب Approval لم يُعالج، مع منع حلقات لا نهائية.

## 15. الجمهور والوجهة

### BR-AUD-100 — Audience تحسب من Membership وScope الحالية

**التصنيف:** Invariant

لا تستخدم Email محفوظة قديمة دون التأكد من العضوية والصلاحية عند الإرسال.

### BR-AUD-101 — Recipient الخارجي له أساس مشروع

**التصنيف:** Privacy Invariant

Customer/Supplier contact تستخدم للغرض المصرح فقط.

### BR-AUD-102 — تغيير Role قبل التنفيذ يعاد تقييمه

**التصنيف:** Security Invariant

الإشعار المجدول أوالمتأخر لا يرسل معلومات لمستخدم فقد Scope.

### BR-AUD-103 — الرسائل الجماعية تمنع كشف المستلمين

**التصنيف:** Security Invariant

### BR-AUD-104 — Fallback channel لا يستخدم دون Preference/Consent مناسب

**التصنيف:** Privacy Invariant

## 16. قنوات الإشعار

### BR-CHN-100 — القناة Capability مستقلة

**التصنيف:** Invariant

- in-app.
- email.
- SMS.
- WhatsApp عند التكامل.
- push notification مستقبلًا.

### BR-CHN-101 — كل قناة لها Limit ومحتوى مناسب

**التصنيف:** Invariant

لا يرسل PDF ضخم عبر SMS مثلًا، بل Link آمنة عند السماح.

### BR-CHN-102 — Provider ID محفوظ

**التصنيف:** Invariant

مع Masking للبيانات الحساسة.

### BR-CHN-103 — Channel outage لا يفقد Notification

**التصنيف:** Reliability Invariant

تظل Pending أوتنتقل Fallback وفق Policy.

### BR-CHN-104 — WhatsApp templates الخارجية Versioned

**التصنيف:** Integration Requirement

ولا يفترض قبول Provider لقالب غير معتمد.

## 17. تفضيلات الإشعار والـConsent

### BR-NPR-100 — Preference حسب Purpose وقناة

**التصنيف:** Invariant

### BR-NPR-101 — Marketing consent منفصلة

**التصنيف:** Privacy Invariant

### BR-NPR-102 — Transactional preference لا تمنع متطلبات قانونية

**التصنيف:** Legal Boundary

لكن تستخدم أقل قناة ضرورية ومناسبة.

### BR-NPR-103 — Quiet hours لا تؤخر Critical security alerts

**التصنيف:** Tenant Policy

### BR-NPR-104 — Frequency caps تطبق على Marketing والرسائل غير الحرجة

**التصنيف:** Tenant/Privacy Policy

### BR-NPR-105 — Unsubscribe يسجل ويطبق قبل الحملة التالية

**التصنيف:** Invariant

## 18. حالة التسليم

### BR-NST-100 — Notification وحالة Delivery منفصلتان

**التصنيف:** Invariant

Notification واحدة قد تملك عدة Attempts.

### BR-NST-101 — الحالات المبدئية

**التصنيف:** Invariant

- created.
- suppressed.
- queued.
- sending.
- provider accepted.
- delivered.
- failed temporary.
- failed permanent.
- bounced.
- expired.
- cancelled.

### BR-NST-102 — Delivered لا تعني Read

**التصنيف:** Invariant

### BR-NST-103 — Read receipt اختيارية وغير موثوقة بالكامل

**التصنيف:** Privacy/Product Policy

### BR-NST-104 — Permanent failure تحدث Contact validity signal

**التصنيف:** Invariant

دون حذف Contact تلقائيًا أوتغييرها دون مراجعة.

## 19. إعادة المحاولة والتعافي

### BR-RTY-100 — Retry حسب Error class

**التصنيف:** Invariant

- temporary provider error: retry with backoff.
- invalid destination: permanent failure.
- authentication/configuration error: operational incident.
- rate limit: delayed retry.

### BR-RTY-101 — Retry لا تنشئ Notification جديدة

**التصنيف:** Invariant

### BR-RTY-102 — الحد الأقصى والـExpiry محددان

**التصنيف:** Operational Policy

### BR-RTY-103 — Manual resend تسجل كمحاولة جديدة لنفس الغرض

**التصنيف:** Invariant

### BR-RTY-104 — Unknown provider outcome تدخل Reconciliation

**التصنيف:** Invariant

لا يعاد الإرسال الحساس عشوائيًا.

### BR-RTY-105 — Dead-letter queue قابلة للمراجعة

**التصنيف:** Architecture Requirement

مع أدوات Replay آمنة وIdempotent.

## 20. In-app Notifications

### BR-IAN-100 — In-app notification مملوكة لـMembership

**التصنيف:** Invariant

لا تظهر عبر Tenant آخر لنفس Platform Identity.

### BR-IAN-101 — Read/Archive لا تحذف الحدث المصدر

**التصنيف:** Invariant

### BR-IAN-102 — Action link يعيد فحص الصلاحيات

**التصنيف:** Security Invariant

رؤية Notification لا تضمن استمرار صلاحية فتح المصدر.

### BR-IAN-103 — Expiry لا تمحو Audit الضرورية

**التصنيف:** Invariant

## 21. نموذج التقارير

### BR-RPT-100 — كل Report لها Definition ID وVersion

**التصنيف:** Invariant

تشمل:

- business question.
- metrics.
- dimensions.
- source domains.
- filters.
- default period.
- currency policy.
- timezone policy.
- freshness.
- exclusions.

### BR-RPT-101 — اسم المقياس وحده غير كافٍ

**التصنيف:** Invariant

`Sales` مثلًا يجب أن تحدد هل هي Gross أوNet، تشمل Tax أملا، وموعد احتساب Returns وVoids.

### BR-RPT-102 — Live وSnapshot reports مميزتان

**التصنيف:** Invariant

- Live تستخدم الحقيقة الحالية حتى وقت التنفيذ.
- Snapshot تحفظ نتيجة ومعايير ووقتًا محددًا للتدقيق أوالإغلاق.

### BR-RPT-103 — Definition change لا تغير Snapshot قديمة

**التصنيف:** Invariant

### BR-RPT-104 — Dashboard tiles تشير إلى Definition معتمدة

**التصنيف:** Invariant

لا تنشئ كل شاشة معادلة خاصة غير موثقة.

## 22. مصادر البيانات والتجميع

### BR-SRC-100 — Ledgers والمستندات المعتمدة هي المصادر

**التصنيف:** Invariant

لا تستخدم UI cache أوPDF أوExport سابقة كمصدر أساسي.

### BR-SRC-101 — كل Metric تحدد Grain

**التصنيف:** Invariant

مثل:

- sale.
- sale line.
- payment.
- inventory movement.
- customer.
- day/location.

لتجنب Double counting.

### BR-SRC-102 — Join بين Domains له Contract

**التصنيف:** Architecture Requirement

مثل ربط Sale وPayment وReturn دون مضاعفة السطور.

### BR-SRC-103 — Late-arriving events تعيد المعالجة بصورة موثقة

**التصنيف:** Reporting Policy

تظهر Freshness وLast recalculated time.

### BR-SRC-104 — Archived master data تبقى قابلة للتجميع

**التصنيف:** Invariant

## 23. الوقت والمنطقة الزمنية

### BR-TIM-100 — كل Report تحدد Timezone

**التصنيف:** Invariant

قد تكون:

- Location local time.
- Tenant reporting timezone.
- UTC للتشغيل التقني.

### BR-TIM-101 — Business day لا يساوي Calendar UTC day

**التصنيف:** Invariant

### BR-TIM-102 — الفترات Half-open أوClosed بمعيار موحد

**التصنيف:** Invariant

لتجنب تكرار أوفقد العمليات عند حدود الوقت.

### BR-TIM-103 — DST وتغيير Timezone لا يعيدان كتابة timestamps

**التصنيف:** Invariant

### BR-TIM-104 — التاريخ الظاهر يوضح المنطقة الزمنية عند الالتباس

**التصنيف:** UX/Reporting Rule

## 24. العملة والتحويل

### BR-CUR-100 — Report تحدد Currency mode

**التصنيف:** Invariant

- document currency.
- tenant base currency.
- selected reporting currency مستقبلًا.

### BR-CUR-101 — Conversion rate لها Source وDate

**التصنيف:** Invariant

### BR-CUR-102 — لا تجمع عملات مختلفة كرقم واحد بلا تحويل

**التصنيف:** Invariant

### BR-CUR-103 — تغير سعر الصرف لا يغير Snapshot مالية مغلقة

**التصنيف:** Accounting/Reporting Policy

## 25. نطاق التقارير والصلاحيات

### BR-RSC-100 — Scope يطبق Server-side

**التصنيف:** Security Invariant

حسب Tenant وLegal Entity وLocation وWarehouse وRole وData class.

### BR-RSC-101 — Report aggregate لا تتجاوز Scope

**التصنيف:** Invariant

لا يجوز أن تكشف إجماليًا يمكن استنتاج بيانات فرع غير مصرح به.

### BR-RSC-102 — Cost وMargin وPII صلاحيات منفصلة

**التصنيف:** Permission Bound

### BR-RSC-103 — Drill-down يعيد فحص الصلاحيات

**التصنيف:** Security Invariant

### BR-RSC-104 — Scheduled report تعيد تقييم عضوية المستلم وقت التنفيذ

**التصنيف:** Security Invariant

### BR-RSC-105 — Shared link العامة ممنوعة افتراضيًا

**التصنيف:** Planning Decision

## 26. أنواع التقارير الأساسية

### BR-REP-100 — Sales reports

**التصنيف:** Product Requirement

تشمل:

- gross/net sales.
- taxes.
- discounts and overrides.
- returns/voids/refunds.
- average basket.
- sales by product/category/location/operator/channel.

### BR-REP-101 — Payment reports

**التصنيف:** Product Requirement

- tender mix.
- captured/refunded/failed/unknown.
- reconciliation exceptions.
- cash vs electronic.

### BR-REP-102 — Inventory reports

**التصنيف:** Product Requirement

- on-hand/reserved/available/in-transit/quarantine.
- movements.
- stock valuation.
- negative stock exceptions.
- counts and adjustments.
- ageing/expiry لاحقًا.

### BR-REP-103 — Purchasing reports

**التصنيف:** Product Requirement

- ordered/received/invoiced/paid.
- open POs.
- supplier performance.
- price/quantity variances.
- unmatched invoices.

### BR-REP-104 — Shift and cash reports

**التصنيف:** Product Requirement

- expected/counted cash.
- cash in/out.
- discrepancies.
- open shifts and terminal status.

### BR-REP-105 — Customer reports

**التصنيف:** Product Requirement

- net purchase behavior.
- receivables.
- store credit.
- loyalty balances.
- consent status.

### BR-REP-106 — Security and audit reports

**التصنيف:** Product Requirement

- access changes.
- overrides.
- sensitive exports.
- support access.
- failed login/device events.

## 27. Dashboards

### BR-DSH-100 — Dashboard تعرض Freshness

**التصنيف:** Invariant

### BR-DSH-101 — Tile يمكن تفسيرها وفتح تعريفها

**التصنيف:** Invariant

### BR-DSH-102 — Cache لا تعرض نفسها كReal-time إذا كانت متأخرة

**التصنيف:** Invariant

### BR-DSH-103 — ألوان الحالة لا تكون الدليل الوحيد

**التصنيف:** Accessibility Rule

### BR-DSH-104 — المقارنات تستخدم فترات متجانسة

**التصنيف:** Reporting Invariant

مثل مقارنة نفس عدد الأيام ونفس Timezone والسياسة.

### BR-DSH-105 — Empty وZero وUnavailable ثلاث حالات مختلفة

**التصنيف:** Invariant

## 28. تشغيل التقارير

### BR-RUN-100 — Report Run تحفظ المعايير

**التصنيف:** Invariant

- definition/version.
- requester.
- scope.
- filters.
- timezone.
- currency.
- requested/executed/completed time.
- freshness cutoff.
- result status.

### BR-RUN-101 — نفس الطلب قد يعاد دون Duplicate side effect

**التصنيف:** Invariant

### BR-RUN-102 — التقارير الثقيلة لا تحجب العمليات التشغيلية

**التصنيف:** Performance Requirement

تستخدم Isolation وlimits وread models مناسبة لاحقًا.

### BR-RUN-103 — Cancel لا يحذف Audit

**التصنيف:** Invariant

### BR-RUN-104 — Timeout يوضح هل يمكن Retry

**التصنيف:** Error Contract Requirement

## 29. التقارير المجدولة

### BR-SCH-100 — Schedule لها Owner وRecipients وScope

**التصنيف:** Invariant

### BR-SCH-101 — التنفيذ يعيد فحص الصلاحيات

**التصنيف:** Security Invariant

### BR-SCH-102 — المستخدم المعطل لا يستمر في استلام البيانات

**التصنيف:** Invariant

### BR-SCH-103 — الفشل له Retry وAlert

**التصنيف:** Reliability Invariant

### BR-SCH-104 — التوقيت يستخدم Timezone معلنة

**التصنيف:** Invariant

### BR-SCH-105 — Schedule المنتهية أوغير المستخدمة تؤرشف

**التصنيف:** Operations Policy

## 30. الـExports

### BR-EXP-100 — Export عملية مصرح ومسجلة

**التصنيف:** Security Invariant

تحفظ:

- requester.
- purpose عند الحساسية.
- definition/query.
- scope.
- filters.
- row count.
- data classes.
- generated time.
- expiry.
- downloads.

### BR-EXP-101 — الملفات مؤقتة

**التصنيف:** Security Invariant

تنتهي روابطها وتُحذف وفق سياسة أقصر من البيانات الأصلية.

### BR-EXP-102 — Columns تخضع للـPermission

**التصنيف:** Invariant

إخفاء شاشة حقل لا يكفي؛ الـExport نفسها تطبق Masking أوExclusion.

### BR-EXP-103 — Large export لها Limits

**التصنيف:** Performance/Security Policy

مثل عدد صفوف أوفترة أومعدل تنفيذ، مع تقسيم أوطلب موافقة عند الحاجة.

### BR-EXP-104 — CSV injection تمنع

**التصنيف:** Security Invariant

القيم التي قد تنفذ كFormula تعالج بأمان.

### BR-EXP-105 — Export لا تصبح Backup

**التصنيف:** Invariant

لا تضمن استعادة النظام أوالعلاقات أوالتاريخ الكامل.

### BR-EXP-106 — Download URL لا تكشف Tenant ID حساس أوToken دائم

**التصنيف:** Security Invariant

## 31. جودة البيانات والمصالحة

### BR-DQ-100 — كل Report حرجة لها Reconciliation source

**التصنيف:** Invariant

مثل Net sales مقابل Sales/Returns documents، وCash مقابل Shift ledger.

### BR-DQ-101 — اختلاف التقرير لا يصحح التقرير يدويًا

**التصنيف:** Invariant

يتم تحديد Source data أوDefinition أوPipeline المشكلة ثم Correction موثقة.

### BR-DQ-102 — Data completeness indicators ظاهرة

**التصنيف:** Reporting Invariant

مثل Offline operations pending أوImport incomplete.

### BR-DQ-103 — Backfill وRecompute مسجلان

**التصنيف:** Invariant

مع version وperiod وreason وbefore/after summary.

### BR-DQ-104 — التقارير المغلقة لها Freeze policy

**التصنيف:** Open Decision

يمكن Snapshot ثم Adjustment reports بدل تغيير صامت للماضي.

## 32. تصنيف البيانات للاحتفاظ

### BR-RET-200 — Data classes معرفة

**التصنيف:** Invariant

تشمل مبدئيًا:

- legal/fiscal documents.
- financial ledgers.
- inventory ledgers.
- audit/security logs.
- customer PII.
- supplier PII/business data.
- consent records.
- notifications and delivery logs.
- generated documents/renders.
- attachments/evidence.
- exports.
- operational telemetry.
- backups.
- temporary caches.

### BR-RET-201 — كل Class لها Owner وPolicy

**التصنيف:** Governance Requirement

### BR-RET-202 — مدة الاحتفاظ تبدأ من Event محدد

**التصنيف:** Invariant

مثل issue date أوclosure date أوlast activity أوcontract termination، لا افتراض عام.

### BR-RET-203 — النسخ المشتقة لا تحتفظ أطول بلا سبب

**التصنيف:** Privacy Invariant

PDF/Export/Cache قد تكون أقصر من المستند الأصلي.

## 33. إجراءات نهاية الاحتفاظ

### BR-END-100 — الإجراء صريح لكل Class

**التصنيف:** Invariant

- retain.
- archive.
- anonymize.
- delete.
- aggregate then delete.
- manual review.

### BR-END-101 — Financial/Audit history لا Hard delete إذا كان القانون يمنع

**التصنيف:** Legal Boundary

### BR-END-102 — الحذف Idempotent وقابل للإثبات

**التصنيف:** Invariant

### BR-END-103 — فشل الحذف يدخل Queue مراقبة

**التصنيف:** Reliability Invariant

### BR-END-104 — النسخ داخل Search index/Cache تتبع الحذف

**التصنيف:** Invariant

### BR-END-105 — الطرف الثالث يدخل Data deletion contract

**التصنيف:** Integration Requirement

مثل Email provider أوfile storage، مع حدود واقعية موثقة.

## 34. الأرشفة

### BR-ARC-100 — Archive لا تعني فقد الوصول القانوني

**التصنيف:** Invariant

البيانات المؤرشفة قابلة للبحث والاسترجاع للمصرح لهم وفق زمن خدمة معلن.

### BR-ARC-101 — Archive تحفظ Integrity والعلاقات

**التصنيف:** Invariant

### BR-ARC-102 — الاسترجاع لا يعيد تفعيل كيان تشغيلي

**التصنيف:** Invariant

فتح سجل تاريخي لا يجعل Product أوCustomer أوMembership نشطة.

### BR-ARC-103 — Archive tier مشفرة ومراقبة

**التصنيف:** Security Requirement

### BR-ARC-104 — Restore/rehydrate مسجلة

**التصنيف:** Audit Invariant

## 35. Legal Hold

### BR-LGH-100 — Hold لها Scope وReason وسلطة

**التصنيف:** Invariant

تشمل:

- case/reference.
- data subjects/entities.
- data classes.
- period.
- issuer.
- start/review/end.

### BR-LGH-101 — Hold تمنع الإتلاف لا الوصول غير المصرح

**التصنيف:** Security Invariant

### BR-LGH-102 — Hold لا تغير البيانات

**التصنيف:** Invariant

تحافظ عليها وتمنع حذفها، ولا تعدل التاريخ.

### BR-LGH-103 — رفع Hold يعيد تقييم Retention

**التصنيف:** Invariant

ولا يحذف فورًا بلا Job/Review موثق.

### BR-LGH-104 — تفاصيل Hold حساسة

**التصنيف:** Permission Bound

## 36. حذف وAnonymization العملاء

### BR-ANO-100 — الطلب لا يمحو المستندات القانونية تلقائيًا

**التصنيف:** Legal/Privacy Boundary

### BR-ANO-101 — PII تفصل عن facts قدر الإمكان

**التصنيف:** Architecture Requirement

لتسهيل Anonymization دون كسر Ledgers.

### BR-ANO-102 — Anonymization irreversible حيث يلزم

**التصنيف:** Invariant

لا تحتفظ Mapping سرية تعيد الهوية إلا إذا كان Pseudonymization مقصودًا ومصرحًا.

### BR-ANO-103 — Customer balance المفتوح يمنع حذفًا يفسد الالتزام

**التصنيف:** Invariant

تحتاج تسوية أوتقييدًا قانونيًا قبل الإجراء النهائي.

### BR-ANO-104 — Consent history تحتفظ بالحد الأدنى اللازم

**التصنيف:** Privacy/Legal Policy

لإثبات Grant/Withdrawal دون PII زائدة.

## 37. إغلاق Tenant

### BR-TCL-100 — إغلاق الاشتراك لا يعني حذفًا فوريًا

**التصنيف:** Invariant

تمر البيانات بمراحل:

- active.
- read-only/restricted.
- export window.
- retention grace period.
- archive/delete by class.

### BR-TCL-101 — Tenant يملك Export قبل الإزالة وفق Policy

**التصنيف:** Contract Policy

مع توضيح أن Export ليست Full system backup إلا إذا قدم منتجًا مخصصًا لذلك.

### BR-TCL-102 — الفواتير القانونية والـAudit قد تبقى بعد إغلاق Tenant

**التصنيف:** Legal Boundary

### BR-TCL-103 — Reactivation لا تعتمد على بيانات حذفت نهائيًا

**التصنيف:** Invariant

يجب توضيح نافذة الاستعادة وحدودها.

## 38. العلاقة بالنسخ الاحتياطية

### BR-BKP-100 — Backup وRetention وظيفتان مختلفتان

**التصنيف:** Invariant

Backup للاسترداد من الفشل، وليست أرشيفًا قانونيًا أوطريقة دائمة لتجاوز الحذف.

### BR-BKP-101 — البيانات المحذوفة قد تبقى مؤقتًا داخل Backup

**التصنيف:** Privacy/Operations Policy

مع مدة دوران محددة ومنع الاستعادة الانتقائية غير المنضبطة.

### BR-BKP-102 — Restore يعيد تطبيق Tombstones وDeletion logs

**التصنيف:** Architecture Requirement

حتى لا تعود بيانات محذوفة إلى التشغيل بعد Disaster recovery.

### BR-BKP-103 — Legal Hold والBackups تحتاج سياسة قابلة للتنفيذ

**التصنيف:** Open Legal/Architecture Decision

## 39. Offline behavior

### BR-DOF-100 — POS تحتفظ بأقل مستندات مطلوبة

**التصنيف:** Security/Operations Policy

مع TTL وتشفير ومسح عند إلغاء الجهاز.

### BR-DOF-101 — Print Offline تستخدم Snapshot محلية مؤكدة

**التصنيف:** Invariant

ولا تعيد Posting البيع.

### BR-DOF-102 — Delivery الخارجية Online-required

**التصنيف:** Planning Decision

يمكن Queue الطلب محليًا، لكن لا تظهر Delivered قبل Server/provider confirmation.

### BR-DOF-103 — Reports Offline محدودة

**التصنيف:** Planning Decision

تعرض Terminal/Shift local view مميزة بوضوح، لا تقارير Tenant نهائية.

### BR-DOF-104 — Offline data expiry تمنع الوصول بعد Lease

**التصنيف:** Security Invariant

### BR-DOF-105 — Deprovision يمسح Documents وCaches المحلية

**التصنيف:** Security Invariant

عند أول اتصال، مع Device encryption وremote revocation strategy.

## 40. الصلاحيات والموافقات

### BR-DPA-100 — الصلاحيات منفصلة

**التصنيف:** Invariant

تشمل:

- view/download/reprint document.
- resend document.
- manage templates.
- manage notification rules/templates.
- view delivery logs.
- run report.
- view cost/margin/PII reports.
- schedule report.
- export data.
- approve large/sensitive export.
- manage retention policy.
- issue/release legal hold.
- fulfill deletion/anonymization request.
- restore archived data.

### BR-DPA-101 — Reprint لا تعني Resend

**التصنيف:** Permission Bound

### BR-DPA-102 — Sensitive export تحتاج Step-up أوApproval

**التصنيف:** Tenant Policy

### BR-DPA-103 — Retention وLegal Hold أعلى صلاحيات الحوكمة

**التصنيف:** Approval Bound

### BR-DPA-104 — Support access لا يسمح Export تلقائيًا

**التصنيف:** Security Invariant

## 41. Audit وEvents

### BR-DAU-100 — الأحداث الحرجة مسجلة

**التصنيف:** Invariant

تشمل:

- document issued/corrected/voided.
- render generated/failed.
- print requested/succeeded/failed/reprinted.
- delivery queued/sent/delivered/failed/resend.
- notification rule/template changed.
- report run/scheduled/cancelled/failed.
- export generated/downloaded/expired.
- retention policy changed.
- archive/restore.
- deletion/anonymization started/completed/failed.
- legal hold issued/changed/released.

### BR-DAU-101 — Audit لا تخزن المحتوى الحساس كاملًا

**التصنيف:** Security Invariant

تحفظ IDs, hashes, masked destinations وbefore/after المناسب.

### BR-DAU-102 — Audit نفسها لها Retention وحماية

**التصنيف:** Invariant

ولا تعدل أوتحذف بواسطة نفس المستخدم الذي أنتج الحدث دون Policy مستقلة.

## 42. الأخطاء والاسترداد

### BR-DER-100 — الخطأ يحدد الحقيقة التي اكتملت

**التصنيف:** Invariant

مثال:

- Sale completed.
- Document issued.
- PDF generation failed.
- Print failed.
- Email pending.

ولا يعرض رسالة عامة تدفع المستخدم لإعادة البيع.

### BR-DER-101 — Document generation قابلة لإعادة المحاولة

**التصنيف:** Invariant

بنفس Document ID وSnapshot.

### BR-DER-102 — Delivery recovery لا يعيد Source event

**التصنيف:** Invariant

### BR-DER-103 — Report failure لا تنتج ملفًا ناقصًا كناجح

**التصنيف:** Invariant

### BR-DER-104 — Export partial output تميز أوتحذف

**التصنيف:** Invariant

لا تقدم كملف كامل.

### BR-DER-105 — Retention job failure تصعد وتراقب

**التصنيف:** Governance/Reliability Requirement

### BR-DER-106 — Recovery لا يعتمد Direct SQL

**التصنيف:** Invariant

تتوفر Commands آمنة لإعادة Render أوReplay delivery أوRecompute report أوإعادة retention step.

## 43. السيناريوهات الإلزامية للاختبار لاحقًا

1. Sale مكتملة والطابعة تفشل.
2. Retry للطباعة دون تكرار البيع.
3. Reprint مميزة كنسخة.
4. PDF generation failure ثمRetry.
5. تغيير اسم المنتج ثمإعادة طباعة فاتورة قديمة.
6. تغيير Template ثمإعادة طباعة تاريخية.
7. Duplicate document issuance retry.
8. Number reservation ثمفشل الإصدار.
9. Offline invoice numbering بدون collision.
10. إرسال Receipt إلى Email مؤكدة.
11. Resend بعد تغيير Email العميل.
12. Email bounce دائم.
13. Provider timeout unknown.
14. Notification duplicate event retry.
15. User يفقد Scope قبل إرسال Scheduled report.
16. Marketing unsubscribe قبل Campaign execution.
17. Security notification تتجاوز quiet hours.
18. Low-stock digest aggregation.
19. Report Live وSnapshot لنفس الفترة.
20. Net sales مع Returns وVoids.
21. Tender report دون مضاعفة Sales lines.
22. Report حسب Location timezone.
23. Multi-currency report يمنع الجمع المباشر.
24. Dashboard stale data indicator.
25. Drill-down يرفض Location غير مصرح بها.
26. Cost column مخفية لمستخدم غير مخول.
27. Scheduled report failure وRetry.
28. Large export approval.
29. Export URL expiry.
30. CSV injection value.
31. Export download audit.
32. Backfill يعيد حساب فترة مع Version جديدة.
33. Delete customer request مع فواتير قانونية.
34. Anonymization مع Receivable مفتوحة.
35. Legal Hold يمنع retention deletion.
36. Release Hold يعيد جدولة policy.
37. Tenant closure grace period.
38. Restore من Backup لا يعيد بيانات Tombstoned.
39. Device deprovision يمسح cached documents.
40. Cross-tenant document access rejection.
41. Archived document retrieval.
42. Attachment malware rejection.
43. Replaced evidence يحفظ version السابقة.
44. Failed retention job تظهر في monitoring.
45. Report `zero` مقابل `no data` مقابل `unavailable`.

## 44. القرارات المفتوحة

### OD-DOC-001 — نوع الإيصال القانوني في Pilot

يُحسم حسب Country/Fiscal Blueprint؛ الـCore يدعم Document types متعددة ولا يفترض نوعًا قانونيًا عالميًا.

### OD-DOC-002 — Offline fiscal numbering

**الاقتراح:** Namespace لكل Terminal مع Server reconciliation، ومنع أي نوع مستند لا يسمح القانون بترقيم موزع له.

### OD-DOC-003 — الاحتفاظ بالـPDF

**الاقتراح:** حفظ المستند وTemplate version بصورة دائمة حسب السياسة القانونية، مع Cache للـPDF قابلة لإعادة التوليد وفترة أقصر إلا إذا تطلب القانون النسخة البصرية الأصلية.

### OD-DOC-004 — Reprint watermark

**الاقتراح:** `COPY/REPRINT` قابل للتهيئة، وإلزامه للأنواع القانونية التي تحتاجه.

### OD-DOC-005 — قنوات MVP

**الاقتراح:** In-app وEmail أولًا، SMS/WhatsApp Integrations لاحقًا حسب السوق والتكلفة.

### OD-DOC-006 — Scheduled reports

**الاقتراح:** دعم Daily/Weekly محدد في الإصدار الأول، مع إعادة فحص الصلاحيات وقت التنفيذ وروابط تنزيل مؤقتة.

### OD-DOC-007 — Reporting freshness

**الاقتراح:** Operational screens near-real-time، بينما التقارير التحليلية قد تكون Delayed مع Last updated واضح.

### OD-DOC-008 — Snapshot period close

**الاقتراح:** Shift/Business-day closures لها Snapshots، والتقارير الطويلة Live مع إمكانية حفظ Certified snapshot لاحقًا.

### OD-DOC-009 — Export limits

تُحسم حسب الخطة والحمل والحساسية؛ يجب وجود hard limits وApproval للمحتوى الحساس.

### OD-DOC-010 — Customer data retention

تحتاج Country/Contract policy؛ الفصل بين Transactional legal history وMarketing profile وinactive PII إلزامي.

### OD-DOC-011 — Legal Hold في MVP

**الاقتراح:** نموذج أساسي داخلي لإيقاف الحذف على Customer/Tenant/Date range/Data class، وتأجيل Case management المتكامل.

### OD-DOC-012 — Tenant export on closure

**الاقتراح:** Standard business-data export، مع توضيح أنه ليس Clone كاملًا للنظام أوBackup قابلة للاستعادة.

### OD-DOC-013 — Read/open tracking

**الاقتراح:** عدم الاعتماد عليها كدليل قانوني افتراضيًا؛ تستخدم Delivery provider status فقط ما لم يوجد Signature/acknowledgement workflow مستقل.

### OD-DOC-014 — Report definition governance

**الاقتراح:** Catalog مركزي Versioned، وكل تغيير Metric حرجة يحتاج Review واختبارات مقارنة قبل التفعيل.

## 45. خارج النطاق حاليًا

- Full document management system عام.
- Qualified electronic signatures.
- Court e-discovery platform كامل.
- Public permanent document links.
- Arbitrary user-authored SQL reports.
- Embedded BI platform متعدد الأدوات.
- AI-generated metrics دون تعريف معتمد.
- Marketing automation platform كامل.
- Postal mail fulfillment.
- Cross-border legal retention engine عالمي.
- Immutable blockchain document storage.
- Full tenant backup download قابل للاستعادة ذاتيًا.

## 46. Dependencies

هذه الوثيقة تغذي:

- Document Domain Model.
- Notification and Delivery State Machines.
- Report Definition and Run models.
- Export Job model.
- Data Classification.
- Retention and Legal Hold models.
- Event and Audit Catalogs.
- Permission Matrix.
- API and Error Contracts.
- Sync/Offline Protocols.
- Database and Storage Blueprint.
- Security and Privacy Blueprints.
- Monitoring and Recovery.
- Country/Fiscal compliance packages.

## 47. Acceptance Gate

لا تعتبر المرحلة مكتملة قبل:

1. اعتماد أنواع المستندات ونطاق الترقيم.
2. اعتماد Snapshot والقالب التاريخي وسياسة Reprint.
3. اعتماد PDF storage/regeneration policy.
4. اعتماد قنوات الإشعار وتصنيف الأغراض والـConsent.
5. اعتماد Delivery states وRetry/Reconciliation.
6. اعتماد Report Definition governance.
7. اعتماد Timezone/Currency/Freshness rules.
8. اعتماد Scope وPII/Cost export permissions.
9. اعتماد Data classes وRetention actions.
10. اعتماد Legal Hold وAnonymization boundaries.
11. اعتماد Tenant closure/export/grace period.
12. تحويل كل Rule حرجة إلى State transition أوConstraint أوPermission أوScheduled policy أوTest requirement.

## 48. القرار التخطيطي الحالي

- Business Document هي الحقيقة؛ PDF والطباعة والإرسال نسخ ومحاولات مشتقة.
- فشل الطباعة أوالإرسال لا يلغي المعاملة المكتملة.
- إعادة الطباعة أوالإرسال لا تنشئ Document جديدة.
- المستندات تحفظ Snapshot وقالبًا Versioned ولا تتغير بتعديل Master data.
- Document numbering فريدة ولا يعاد استخدام الأرقام.
- In-app وEmail هما قنوات MVP المقترحة، والقنوات الأخرى Integrations لاحقة.
- Notifications تصنف حسب الغرض، والتسويق منفصل عن الرسائل التشغيلية.
- التقارير تعتمد Definitions مركزية Versioned وتعرض Scope وTimezone وCurrency وFreshness.
- الـExports مؤقتة ومصرح بها ومسجلة ولا تعتبر Backup.
- Retention حسب Data class، وLegal Hold تتغلب على الحذف.
- Anonymization لا تكسر المستندات والـLedgers القانونية.
- إغلاق Tenant يمر بـRead-only وExport window وGrace period، وليس حذفًا فوريًا.
- Backup للاسترداد من الفشل وليست بديلًا عن Retention أوArchive.