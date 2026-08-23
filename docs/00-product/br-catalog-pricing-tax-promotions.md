# ATHR Product Catalog, Pricing, Taxes & Promotions Business Rules v1.0

**Planning Baseline — Product Identity, Sellability, Pricing, Tax and Promotion Evaluation**

## 1. وظيفة الوثيقة

هذه الوثيقة هي المرجع التفصيلي لقواعد:

- المنتجات والـVariants.
- التصنيفات والعلامات التجارية والخصائص.
- SKU والـBarcodes.
- وحدات القياس والتحويل.
- المنتجات المخزنية والخدمية وغير المخزنية.
- التفعيل والأرشفة وإتاحة البيع والشراء.
- Price Books والأسعار الفعالة.
- الأسعار الخاصة بالفروع والعملاء.
- الضرائب والإعفاءات.
- الخصومات والعروض والكوبونات والباقات.
- التغيير التاريخي والنسخ.
- Offline catalog snapshots.
- الاستيراد والتصدير والصلاحيات والتدقيق.

لا تحدد الوثيقة شكل الجداول أوواجهات الاستخدام، لكنها تمثل Business contract يجب أن تلتزم به أنظمة POS والمبيعات والمشتريات والمخزون والتقارير.

## 2. المصطلحات

### Product

التعريف التجاري العام لسلعة أوخدمة، مثل اسم المنتج وعلامته وتصنيفه ووصفه.

### Variant

الوحدة القابلة للبيع أوالشراء أوالتخزين فعليًا، مثل مقاس أولون محدد من Product.

### SKU

معرف داخلي ثابت للـVariant داخل Tenant.

### Barcode

معرف قابل للمسح يشير إلى Variant ووحدة بيع محددة، وقد يكون مصدره داخليًا أوخارجيًا.

### Unit of Measure

وحدة قياس الكمية، مثل قطعة أوعلبة أوكيلوجرام.

### Price Book

مجموعة أسعار محددة بعملة ونطاق وفترة أولوية.

### Price Rule

قاعدة تنتج سعرًا أوتعدله بناءً على المنتج والعميل والفرع والكمية والزمن.

### Tax Code

تصنيف ضريبي يحدد طريقة الحساب والمعدل والإعفاء والنطاق القانوني.

### Promotion

قاعدة مؤقتة أوشرطية تمنح خصمًا أوBenefit عند تحقق شروط معلنة.

### Bundle

عرض أومنتج يتكون من مجموعة Components بعلاقة بيع وتسعير محددة.

### Kit

مجموعة Components قد تمثل وحدة مخزنية أوتجميعًا تشغيليًا، وتختلف عن Promotion bundle.

## 3. المبادئ غير القابلة للتفاوض

### BR-CAT-100 — Product وVariant كيانان مختلفان

**التصنيف:** Invariant

- Product يحمل الهوية التجارية المشتركة.
- Variant تحمل SKU وBarcode ووحدة المخزون والسعر والتوافر.
- لا تنشأ Sale line على Product عامة إذا كانت لها Variants.

### BR-CAT-101 — المعرفات لا يعاد استخدامها

**التصنيف:** Invariant

لا يعاد استخدام:

- Product ID.
- Variant ID.
- SKU المتقاعد داخل نطاقه.
- Barcode المحذوف تاريخيًا دون سياسة تحقق واضحة.

### BR-CAT-102 — تغيير الـCatalog لا يغير التاريخ

**التصنيف:** Invariant

المستندات المكتملة تحفظ Snapshot للقيم المستخدمة وقت العملية، بما يشمل الاسم والوصف المختصر والـSKU والوحدة والسعر والضريبة.

### BR-CAT-103 — السعر والضريبة والعرض ليست خصائص ثابتة للمنتج

**التصنيف:** Invariant

قد يحمل المنتج Default references، لكن القيمة المطبقة تنتج من Rules ذات Version وEffective period.

### BR-CAT-104 — الأرشفة ليست حذفًا

**التصنيف:** Invariant

العنصر المستخدم تاريخيًا لا يُحذف Hard delete؛ يمنع من معاملات جديدة مع بقاء المراجع.

### BR-CAT-105 — كل حساب مالي قابل للتفسير

**التصنيف:** Invariant

يجب أن يوضح النظام:

- مصدر السعر.
- قواعد الخصم المطبقة والمرفوضة.
- Tax code والمعدل والأساس.
- ترتيب الحساب.
- التقريب.

## 4. أنواع عناصر الكتالوج

### BR-TYP-100 — نوع العنصر مثبت

**التصنيف:** Invariant

الأنواع المبدئية:

- stocked product.
- non-stock product.
- service.
- bundle/kit وفق Capability مستقلة.

### BR-TYP-101 — Stocked product تحتاج Inventory unit

**التصنيف:** Invariant

لا يمكن تفعيل التتبع المخزني دون Base stock UOM وPrecision معتمدتين.

### BR-TYP-102 — Service لا تنشئ Inventory movement

**التصنيف:** Invariant

إلا إذا كان لها Components مستهلكة عبر Workflow منفصل لاحقًا.

### BR-TYP-103 — تغيير النوع بعد وجود معاملات مقيد

**التصنيف:** Invariant

لا تتحول Variant مستخدمة من Stocked إلىService أوالعكس بتعديل مباشر؛ تحتاج Variant جديدة أومسار Migration موثق.

### BR-TYP-104 — Non-stock لا تعني Service

**التصنيف:** Invariant

قد تكون سلعة لا يتتبع النظام رصيدها، لكنها تظل منتجًا ماديًا لأغراض الضرائب والمرتجعات.

## 5. Product والـVariant

### BR-PROD-100 — Product لها Tenant واحد

**التصنيف:** Invariant

لا تشارك Product operational record بين Tenants.

### BR-PROD-101 — Product قد تكون Simple أوVariant-based

**التصنيف:** Tenant/Product Policy

- Simple product تمثلها Variant افتراضية واحدة داخليًا.
- Variant-based product تحتاج اختيار Combination صالحة.

### BR-PROD-102 — Variant combination فريدة

**التصنيف:** Invariant

لا توجد Variantان نشطتان لنفس Product بنفس مجموعة Attribute values.

### BR-PROD-103 — الخصائص التجارية لا تستخدم كمعرف دائم

**التصنيف:** Invariant

تغيير اسم لون أومقاس لا يغير Variant ID ولا يكسر التاريخ.

### BR-PROD-104 — Product title يمكن أن يتغير مع Version/Audit

**التصنيف:** Invariant

الفواتير والتقارير التاريخية تستخدم Snapshot أوCurrent-view mode بصورة صريحة.

### BR-PROD-105 — Variant يمكن إيقافها مستقلًا

**التصنيف:** Invariant

إيقاف Variant لا يوقف باقي Variants أوProduct بالضرورة.

### BR-PROD-106 — إيقاف كل Variants يجعل Product غير قابلة للبيع

**التصنيف:** Derived Rule

مع استمرار ظهورها تاريخيًا وإداريًا.

## 6. حالات الكتالوج

### BR-STA-200 — الحالة متعددة الأبعاد

**التصنيف:** Invariant

يفضل الفصل بين:

- lifecycle: draft, active, archived.
- sellability: sellable, blocked, discontinued.
- purchasability: purchasable, blocked, discontinued.
- inventory tracking: enabled/disabled وفق النوع.

### BR-STA-201 — Draft لا تظهر في POS

**التصنيف:** Invariant

ولا تستخدم في PO أوSale مكتملة.

### BR-STA-202 — Active لا تعني Sellable بكل الفروع

**التصنيف:** Invariant

التوافر قد يكون مقيدًا بـLocation assortment.

### BR-STA-203 — Discontinued تمنع معاملات جديدة حسب السياسة

**التصنيف:** Tenant Policy

يمكن السماح بـ:

- بيع المخزون المتبقي فقط.
- Returns للماضي.
- Supplier returns.
- منع Purchases الجديدة.

### BR-STA-204 — Archive تحتاج فحص Dependencies

**التصنيف:** Invariant

لا تمنع عمليات تصحيح أوReturn أوReporting مرتبطة بالتاريخ.

## 7. SKU

### BR-SKU-100 — SKU فريدة داخل Tenant

**التصنيف:** Invariant

تطبق على Normalized form مع الحفاظ على شكل العرض.

### BR-SKU-101 — SKU غير قابلة للتغيير بعد معاملات إلا بصلاحية

**التصنيف:** Permission Bound

عند التغيير تحفظ Alias أوhistory لمنع كسر Integrations والبحث.

### BR-SKU-102 — SKU القديمة لا تخصص لعنصر آخر

**التصنيف:** Invariant

### BR-SKU-103 — Auto-generation لها قاعدة معلنة

**التصنيف:** Tenant Policy

لا تعتمد على الاسم وحده، وتمنع Collisions تحت Concurrency.

### BR-SKU-104 — Supplier SKU ليست Tenant SKU

**التصنيف:** Invariant

يحفظ لكل Supplier/Product relationship معرف المورد منفصلًا.

## 8. Barcodes

### BR-BAR-100 — Barcode ترتبط بـVariant ووحدة

**التصنيف:** Invariant

قد تشير نفس Variant إلى:

- قطعة.
- عبوة.
- كرتونة.

مع Conversion محددة.

### BR-BAR-101 — Barcode فريدة داخل Tenant افتراضيًا

**التصنيف:** Invariant

لا تشير نفس القيمة إلى Variantين نشطتين في نفس Tenant.

### BR-BAR-102 — Barcode لها نوع ومصدر

**التصنيف:** Invariant

مثل:

- EAN/UPC.
- internal.
- supplier.
- weighted barcode.
- price-embedded barcode لاحقًا.

### BR-BAR-103 — Barcode الأساسية ليست المعرف الوحيد

**التصنيف:** Invariant

يمكن وجود عدة Barcodes، وتغيير Primary لا يكسر البحث بالقيم السابقة النشطة.

### BR-BAR-104 — تعطيل Barcode يحتفظ بالتاريخ

**التصنيف:** Invariant

إعادة استخدامها تحتاج Policy تمنع التداخل مع Data offline القديمة.

### BR-BAR-105 — Barcodes الموزونة تحتاج Parser Version

**التصنيف:** Deferred Capability

تحدد Prefix والمنتج والوزن أوالسعر والدقة والتحقق.

### BR-BAR-106 — Scan ambiguity ممنوعة

**التصنيف:** Invariant

إذا نتج أكثر من Match، لا تختار POS عشوائيًا.

## 9. وحدات القياس

### BR-UOM-100 — لكل Variant Base stock UOM واحدة

**التصنيف:** Invariant للمنتجات المخزنية

كل Inventory quantity تحول إليها بصورة حتمية.

### BR-UOM-101 — وحدات البيع والشراء قد تختلف

**التصنيف:** Invariant

مع Conversion factors مثبتة لكل علاقة.

### BR-UOM-102 — Conversion factor موجبة وثابتة تاريخيًا

**التصنيف:** Invariant

تغييرها لا يعيد حساب مستندات سابقة؛ تستخدم Version جديدة.

### BR-UOM-103 — Precision محددة لكل وحدة

**التصنيف:** Invariant

- القطعة قد تقبل أعدادًا صحيحة فقط.
- الوزن قد يقبل كسورًا.
- النظام يمنع Precision أعلى من المسموح.

### BR-UOM-104 — Conversion غير الصحيحة لا تصحح بتعديل صامت

**التصنيف:** Invariant

تحتاج Correction/Inventory reconciliation للماضي وVersion جديدة للمستقبل.

### BR-UOM-105 — نفس Barcode لا تمثل وحدتين

**التصنيف:** Invariant

### BR-UOM-106 — Fractional packaging policy صريحة

**التصنيف:** Tenant/Product Policy

يحدد هل يمكن فتح العبوة وبيع جزء منها، وتأثير ذلك على المخزون.

## 10. التصنيفات والعلامات والخصائص

### BR-CLS-100 — Category hierarchy لا تملك المنتج

**التصنيف:** Invariant

Product مملوكة لـTenant، والتصنيف تنظيم وعرض وتقارير.

### BR-CLS-101 — Product لها Primary category ويمكن Tags إضافية

**التصنيف:** Tenant Policy

### BR-CLS-102 — تغيير التصنيف لا يغير المستندات السابقة

**التصنيف:** Invariant

التقارير توضح هل تستخدم Current classification أوHistorical snapshot.

### BR-CLS-103 — Brand كيان مستقل قابل للأرشفة

**التصنيف:** Invariant

### BR-CLS-104 — Attribute definition منفصلة عن Value

**التصنيف:** Invariant

مثل Attribute `Color` وقيم `Black`, `Blue`.

### BR-CLS-105 — Attribute values لا تحذف إذا استخدمت في Variant

**التصنيف:** Invariant

تؤرشف أوتعاد تسميتها مع حفظ التاريخ.

## 11. أوصاف وصور المنتج

### BR-MED-100 — المحتوى متعدد اللغة عند التفعيل

**التصنيف:** Tenant Policy

كل لغة لها Title/Description مع Fallback معلن.

### BR-MED-101 — الصور لها ترتيب وPrimary image

**التصنيف:** Invariant

### BR-MED-102 — حذف الصورة لا يمحو المرفق التاريخي عند الاحتياج القانوني

**التصنيف:** Retention Policy

### BR-MED-103 — محتوى المورد لا ينشر تلقائيًا

**التصنيف:** Permission Bound

يحتاج مراجعة وتحديد Source/licensing عند الاستيراد.

## 12. Assortment والتوافر حسب الفرع

### BR-AST-100 — Product active لا تعني متاحة بكل Location

**التصنيف:** Invariant

Location assortment تحدد:

- sellable.
- purchasable.
- displayable.
- default warehouse.

### BR-AST-101 — إلغاء التوافر لا يغير المخزون

**التصنيف:** Invariant

قد يبقى Stock يحتاج Transfer أوMarkdown أوDisposal workflow.

### BR-AST-102 — بيع عنصر خارج Assortment يحتاج Override

**التصنيف:** Permission Bound

### BR-AST-103 — التفعيل الجماعي قابل للتدقيق

**التصنيف:** Invariant

### BR-AST-104 — Offline catalog تحترم Assortment الخاصة بالجهاز

**التصنيف:** Security/Scope Invariant

## 13. Price Books

### BR-PRB-100 — Price Book لها عملة واحدة

**التصنيف:** Invariant

### BR-PRB-101 — Price Book لها Scope وحالة

**التصنيف:** Invariant

مثل:

- Tenant default.
- Location-specific.
- Customer group.
- Contract/customer-specific.
- wholesale.

وحالات draft, active, expired, archived.

### BR-PRB-102 — كل Price entry لها Effective period

**التصنيف:** Invariant

قد تكون Open-ended، لكن لا تتداخل Entries بنفس الأولوية والنطاق دون Rule حسم.

### BR-PRB-103 — السعر لا يعدل رجعيًا صامتًا

**التصنيف:** Invariant

تعديل سعر فعال ينشئ Version/Entry جديدة أوCorrection موثقة.

### BR-PRB-104 — Price Book الافتراضية واحدة لكل Currency/Scope

**التصنيف:** Invariant

### BR-PRB-105 — حذف Price Book المستخدمة ممنوع

**التصنيف:** Invariant

تؤرشف مع بقاء Snapshots والمراجع.

## 14. اختيار السعر

### BR-PSL-100 — ترتيب المصادر حتمي

**التصنيف:** Invariant

الترتيب المبدئي المقترح:

1. Customer contract price.
2. Customer group price.
3. Location Price Book.
4. Tenant default Price Book.
5. Explicit fallback policy.

### BR-PSL-101 — لا سعر يعني منع البيع افتراضيًا

**التصنيف:** Tenant Policy

يمكن السماح Manual price بصلاحية وسبب، لكن لا يستخدم صفر تلقائيًا.

### BR-PSL-102 — السعر صفر يحتاج Allowance صريحة

**التصنيف:** Permission/Product Policy

للعينات أوالهدايا أوالخدمات المجانية، مع Reason وتصنيف يمنع الخطأ.

### BR-PSL-103 — السعر السالب ممنوع

**التصنيف:** Invariant

### BR-PSL-104 — Quantity breaks تستخدم الكمية المؤهلة

**التصنيف:** Invariant

يحدد هل تحسب على Line واحدة أوإجمالي Variant أوCategory داخل Cart.

### BR-PSL-105 — Price selection تحفظ Evidence

**التصنيف:** Invariant

تسجل Price Book/Entry/Rule version والقيمة قبل وبعد أي Override.

## 15. تغيير السعر والـOverrides

### BR-OVP-100 — Manual override منفصلة عن Discount

**التصنيف:** Invariant

تغيير Unit price ليس Discount تلقائيًا؛ يحفظ كPrice override بمصدر وسبب.

### BR-OVP-101 — حدود override حسب Role

**التصنيف:** Permission Bound

يمكن تحديد:

- نسبة تخفيض قصوى.
- حد مبلغ.
- منع الزيادة أوالسماح بها.
- Approval تحت التكلفة.

### BR-OVP-102 — السعر تحت Minimum يحتاج Approval

**التصنيف:** Approval Bound

Minimum يمكن أن يكون:

- floor price.
- cost-based floor.
- MAP/contract restriction عند الحاجة.

### BR-OVP-103 — Override لا تغير Price Book

**التصنيف:** Invariant

تؤثر على Sale الحالية فقط.

### BR-OVP-104 — Batch price update لها Preview

**التصنيف:** Invariant

تعرض العناصر والتعارضات وتاريخ التفعيل قبل الاعتماد.

## 16. Cost مقابل Price

### BR-CST-100 — Cost ليست Selling price

**التصنيف:** Invariant

Cost تنتج من Inventory costing، ولا تستخدم مباشرة كسعر بيع إلا Rule معلنة.

### BR-CST-101 — المستخدم غير المخول لا يرى Cost

**التصنيف:** Permission Bound

### BR-CST-102 — Margin calculation تحدد Cost basis

**التصنيف:** Reporting Policy

مثل Average cost أوآخر تكلفة، مع توضيح أن القيمة قد تكون تقديرية.

### BR-CST-103 — عدم توفر Cost لا ينتج Margin مزيفة

**التصنيف:** Invariant

تظهر Unknown أوIncomplete.

## 17. الضرائب

### BR-TAX-200 — Tax Code كيان Versioned

**التصنيف:** Invariant

تحتوي:

- jurisdiction scope.
- category.
- rate أوcalculation method.
- inclusive/exclusive behavior.
- effective period.
- exemption rules.
- rounding policy reference.

### BR-TAX-201 — Product تحمل Tax category لا معدلًا أبديًا

**التصنيف:** Invariant

المعدل ينتج من Tax rule الفعالة وفق المكان والتاريخ والعميل.

### BR-TAX-202 — Tax snapshot تحفظ في المستند

**التصنيف:** Invariant

تتضمن code/rate/base/amount/mode/version.

### BR-TAX-203 — تغير المعدل لا يغير الماضي

**التصنيف:** Invariant

### BR-TAX-204 — Inclusive وExclusive معرفة لكل Price context

**التصنيف:** Invariant

لا يمكن لنفس السعر أن يكون شاملًا وغير شامل دون Scope صريحة.

### BR-TAX-205 — Tax exemption تحتاج Evidence

**التصنيف:** Permission/Legal Bound

تحفظ Customer/status/reason/reference/expiry عند الحاجة.

### BR-TAX-206 — Tax override اليدوي ممنوع افتراضيًا

**التصنيف:** Planning Decision

التصحيح يتم بتغيير Tax eligibility أووثيقة تصحيح مصرح بها، لا مبلغ ضريبة حر.

### BR-TAX-207 — منتجات متعددة الضرائب مدعومة في النموذج

**التصنيف:** Architecture Requirement

حتى لو بدأ MVP بضريبة واحدة، يجب ألا يمنع Domain وجود Components متعددة لاحقًا.

### BR-TAX-208 — المتطلبات القانونية الخاصة بالدولة منفصلة

**التصنيف:** Legal Boundary

الـCore لا يفترض ترقيمًا أوE-invoicing أوحقولًا قانونية عالمية دون Country Blueprint.

## 18. التقريب الضريبي والسعري

### BR-RND-200 — Currency precision صريحة

**التصنيف:** Invariant

### BR-RND-201 — نقطة التقريب موحدة

**التصنيف:** Invariant

يحدد هل Tax تقرب على Line أوDocument وفق Legal policy، ولا تختلف بين POS والخادم.

### BR-RND-202 — Allocation differences حتمية

**التصنيف:** Invariant

فرق أصغر وحدة يوزع بقاعدة ثابتة قابلة لإعادة الحساب.

### BR-RND-203 — Price display precision لا تغير Stored precision

**التصنيف:** Invariant

### BR-RND-204 — Cash rounding منفصلة

**التصنيف:** Invariant

ليست Tax أوDiscount، وتطبق فقط على Tender مؤهلة.

## 19. الخصومات

### BR-DSC-200 — Discount لها Source ونوع

**التصنيف:** Invariant

- automatic promotion.
- coupon.
- manual line discount.
- manual order discount.
- customer entitlement.
- loyalty benefit لاحقًا.

### BR-DSC-201 — Discount basis واضح

**التصنيف:** Invariant

نسبة أوFixed amount وعلى أي Base ومتى تطبق.

### BR-DSC-202 — الخصم لا يجعل القيمة سالبة

**التصنيف:** Invariant

### BR-DSC-203 — Manual discount لها Limits

**التصنيف:** Permission Bound

### BR-DSC-204 — Invoice discount توزع على السطور

**التصنيف:** Invariant

لأغراض الضرائب والمرتجعات والتقارير.

### BR-DSC-205 — الخصومات لا تعدل Price Book

**التصنيف:** Invariant

### BR-DSC-206 — كل Discount تحفظ Rule version

**التصنيف:** Invariant

## 20. Promotion lifecycle

### BR-PMT-100 — Promotion لها حالة وفترة

**التصنيف:** Invariant

الحالات:

- draft.
- scheduled.
- active.
- paused.
- ended.
- cancelled.
- archived.

### BR-PMT-101 — Draft قابلة للتعديل

**التصنيف:** Invariant

بعد التفعيل، التغيير الجوهري ينشئ Version جديدة أوينهي القديمة.

### BR-PMT-102 — Start/end تستخدم Timezone معلنة

**التصنيف:** Invariant

ويحدد سلوك الفروع ذات المناطق الزمنية المختلفة لاحقًا.

### BR-PMT-103 — التفعيل لا يعيد تسعير Sales مكتملة

**التصنيف:** Invariant

### BR-PMT-104 — Pause تمنع الاستخدام الجديد

**التصنيف:** Invariant

ولا تغير Sales اكتملت أوBenefits حجزت وفق سياسة محددة.

### BR-PMT-105 — Promotion priority صريحة

**التصنيف:** Invariant

لا يعتمد الاختيار على ترتيب Database عشوائي.

## 21. شروط العروض

### BR-CND-100 — شروط الأهلية قابلة للتفسير

**التصنيف:** Invariant

قد تشمل:

- products/variants/categories.
- customer/group/tier.
- location/channel.
- date/time.
- minimum quantity.
- minimum spend.
- payment method.
- coupon.
- first purchase لاحقًا.

### BR-CND-101 — Exclusions تتغلب وفق ترتيب معلن

**التصنيف:** Invariant

### BR-CND-102 — الحد الأدنى يحسب من Base محددة

**التصنيف:** Invariant

قبل أوبعد الخصومات والضريبة حسب Rule.

### BR-CND-103 — Criteria تعتمد Snapshot أوCurrent data بوضوح

**التصنيف:** Invariant

مثل Customer tier أوProduct category وقت البيع.

### BR-CND-104 — Server-only condition لا تدعي العمل Offline

**التصنيف:** Invariant

## 22. أنواع Benefits

### BR-BEN-100 — أنواع Benefit المبدئية

**التصنيف:** Product Capability

- percentage discount.
- fixed discount.
- fixed price.
- buy X get Y.
- free item.
- quantity-tier price.
- order-level discount.

### BR-BEN-101 — Benefit تحدد Target

**التصنيف:** Invariant

لا تطبق على سطور غير مؤهلة.

### BR-BEN-102 — Fixed price لا تجمع مع Price override بلا Policy

**التصنيف:** Invariant

### BR-BEN-103 — Free item لها Line موثقة

**التصنيف:** Invariant

بكمية وسعر مرجعي وDiscount/Benefit value، ولا تختفي من الفاتورة والمخزون.

### BR-BEN-104 — Buy X Get Y لها Allocation

**التصنيف:** Invariant

لأغراض Partial returns وحساب القيمة والضريبة.

### BR-BEN-105 — Benefit caps صريحة

**التصنيف:** Tenant Policy

مثل Max units أوMax discount per Sale/Customer/Period.

## 23. Stacking والتعارض

### BR-STK-100 — كل Promotion تحدد Stackability

**التصنيف:** Invariant

- exclusive.
- stackable within group.
- stackable with manual discounts أوغيرها.

### BR-STK-101 — Promotion groups لها Priority

**التصنيف:** Invariant

### BR-STK-102 — Best-price strategy قابلة للتفسير

**التصنيف:** Tenant Policy

إذا اختار النظام أفضل Benefit، يسجل البدائل ولماذا اختيرت النتيجة.

### BR-STK-103 — لا Combinatorial explosion غير محدود

**التصنيف:** Performance/Business Constraint

يحدد محرك العروض عدد القواعد والبدائل المسموح تقييمها، مع نتيجة حتمية.

### BR-STK-104 — Manual override بعد Promotion سياسة صريحة

**التصنيف:** Tenant Policy

قد يمنع أويلغي Promotion أويتطلب Approval.

## 24. Coupons

### BR-CPN-200 — Coupon كيان مستقل عن Promotion

**التصنيف:** Invariant

يربط Promotion أوBenefit لكنه يملك Code وحالة وحدود استخدام.

### BR-CPN-201 — Code normalized وفريدة داخل نطاقها

**التصنيف:** Invariant

### BR-CPN-202 — Coupon قد تكون Public أوSingle-use أوCustomer-bound

**التصنيف:** Tenant Policy

### BR-CPN-203 — الاستخدام النهائي عند Sale completion

**التصنيف:** Invariant

الحجز المؤقت يتحرر عند فشل أوانتهاء Cart.

### BR-CPN-204 — الاستخدام Idempotent

**التصنيف:** Invariant

### BR-CPN-205 — Limits مركزية

**التصنيف:** Invariant

مثل total uses, per customer, per day، ولا تعتمد على Cache فقط.

### BR-CPN-206 — Coupon السرية لا تظهر في Logs

**التصنيف:** Security Invariant

## 25. Bundles وKits

### BR-BND-100 — Bundle type صريح

**التصنيف:** Invariant

- sales bundle: Components تباع معًا مع سعر عرض.
- stock kit: قد يكون له تجميع أوتفكيك وحركة مخزون مستقلة.
- virtual bundle: لا يملك Stock مستقلًا.

### BR-BND-101 — Components وQuantities مثبتة بـVersion

**التصنيف:** Invariant

تغيير التركيبة لا يغير Sales سابقة.

### BR-BND-102 — Virtual bundle تخصم Components

**التصنيف:** Invariant

لا تخصم Bundle وهمية ومكوناتها معًا.

### BR-BND-103 — Bundle price توزع على Components

**التصنيف:** Invariant

لأغراض Tax وReturn وMargin، بطريقة حتمية.

### BR-BND-104 — Component availability تحدد Sellability

**التصنيف:** Inventory Policy

### BR-BND-105 — Partial return policy مطلوبة

**التصنيف:** Open Decision

هل تعاد المجموعة كاملة أوComponents بقيم موزعة.

### BR-BND-106 — Kit assembly خارج MVP ما لم يعتمد

**التصنيف:** Planning Decision

لا يخلط مع Promotion bundle البسيطة.

## 26. المنتجات الموزونة والمتغيرة الكمية

### BR-WGT-100 — Variable quantity تحتاج Precision وScale source

**التصنيف:** Product Policy

### BR-WGT-101 — الوزن لا يكون سالبًا أوصفرًا للبيع

**التصنيف:** Invariant

### BR-WGT-102 — Manual weight override مسجلة

**التصنيف:** Permission Bound

### BR-WGT-103 — Scale integration لا تثق بالقيمة دون Device evidence

**التصنيف:** Security/Integration Rule

### BR-WGT-104 — Embedded-price barcode تحتاج Tax/price validation

**التصنيف:** Deferred Capability

لا تستخدم القيمة دون Parser وlimits وCatalog match.

## 27. Batch وExpiry وSerial

### BR-TRK-100 — Tracking policy على Variant

**التصنيف:** Product Policy

- none.
- batch.
- batch + expiry.
- serial.

### BR-TRK-101 — تغيير Tracking بعد Stock مقيد

**التصنيف:** Invariant

يحتاج Migration وجردًا، لا Toggle مباشرًا.

### BR-TRK-102 — Expiry sale policy مستقلة

**التصنيف:** Tenant/Location Policy

تحذير أومنع قبل انتهاء محدد.

### BR-TRK-103 — FEFO allocation لاحقًا لا تغير التاريخ

**التصنيف:** Inventory Capability

### BR-TRK-104 — Serial uniqueness داخل Tenant

**التصنيف:** Invariant عند التفعيل

## 28. Offline catalog

### BR-OFC-100 — Snapshot لها Version وGenerated time

**التصنيف:** Invariant

### BR-OFC-101 — تحتوي Scope الجهاز فقط

**التصنيف:** Security Invariant

### BR-OFC-102 — Stale threshold منفصل لكل Data class

**التصنيف:** Location Policy

قد تختلف مدة صلاحية:

- product identity.
- prices.
- taxes.
- promotions.
- barcodes.

### BR-OFC-103 — Price/Tax/Promotion snapshots لها Effective windows

**التصنيف:** Invariant

### BR-OFC-104 — Offline لا تستخدم Server-only promotions

**التصنيف:** Invariant

### BR-OFC-105 — مزامنة التغيير Incremental وIdempotent

**التصنيف:** Architecture Requirement

### BR-OFC-106 — Revoked item تمنع البيع عند وصول Revocation

**التصنيف:** Invariant

والبيع الذي حدث قبل وصولها يعالج وفق Offline conflict policy، لا يحذف.

## 29. الاستيراد والتحديث الجماعي

### BR-IMP-200 — Import لها Dry run

**التصنيف:** Invariant

تعرض Creates, Updates, Conflicts, Rejects قبل Commit.

### BR-IMP-201 — المطابقة تعتمد معرفات صريحة

**التصنيف:** Invariant

SKU أوExternal ID أوProduct ID، ولا تعتمد الاسم فقط.

### BR-IMP-202 — Null لا يمحو افتراضيًا

**التصنيف:** Import Policy

### BR-IMP-203 — Import لا تتجاوز Uniqueness

**التصنيف:** Invariant

SKU/Barcode/Variant combinations.

### BR-IMP-204 — الأسعار والتكاليف والضرائب تستورد كVersions

**التصنيف:** Invariant

لا تعدل التاريخ مباشرة.

### BR-IMP-205 — Partial failure موثقة

**التصنيف:** Tenant Policy

إما Atomic batch أوRow-level results حسب نوع الملف، مع Recovery واضح.

## 30. الصلاحيات والموافقات

### BR-PAU-200 — الصلاحيات منفصلة

**التصنيف:** Invariant

تشمل:

- create/edit product.
- activate/archive product.
- manage SKU/barcodes.
- manage UOM/conversions.
- manage assortment.
- view cost.
- manage Price Books.
- approve price changes.
- manage Tax codes.
- manage promotions/coupons.
- override sale price/discount.
- bulk import/export.

### BR-PAU-201 — Price approval حسب نطاق التغيير

**التصنيف:** Approval Bound

يمكن ربطها بنسبة التغيير، عدد العناصر، Margin floor، وتاريخ التفعيل.

### BR-PAU-202 — Tax configuration عالية الحساسية

**التصنيف:** Approval Bound

تحتاج صلاحية منفصلة وAudit موسع.

### BR-PAU-203 — Import لا يمنح صلاحيات إضافية

**التصنيف:** Invariant

### BR-PAU-204 — POS لا تعدل الكتالوج المركزي افتراضيًا

**التصنيف:** Planning Decision

يمكنها طلب إنشاء/تصحيح Draft لاحقًا فقط.

## 31. Audit وEvents

### BR-CAUD-200 — الأحداث الحرجة مسجلة

**التصنيف:** Invariant

تشمل:

- Product/Variant created, activated, archived.
- SKU/Barcode added, changed, retired.
- UOM conversion changed.
- Assortment changed.
- Price entry created/activated/ended.
- Price override approved.
- Tax code/version changed.
- Promotion scheduled/activated/paused/ended.
- Coupon issued/redeemed/released.
- Bundle composition changed.
- Bulk import committed.

### BR-CAUD-201 — Before/after للقيم الحساسة

**التصنيف:** Invariant

خصوصًا الأسعار والضرائب والتحويلات والوحدات.

### BR-CAUD-202 — Event تحتوي Effective time وRecorded time

**التصنيف:** Invariant

لفصل القرار المستقبلي عن وقت إدخاله.

## 32. الأخطاء والاسترداد

### BR-CERR-200 — Missing price لا يتحول إلى صفر

**التصنيف:** Invariant

### BR-CERR-201 — Ambiguous barcode تمنع الإضافة

**التصنيف:** Invariant

### BR-CERR-202 — Promotion evaluation failure لا تخفي السعر الأساسي

**التصنيف:** Invariant

يحدد هل تمنع البيع أوتستخدم Base price مع Warning وفق نوع الفشل والسياسة.

### BR-CERR-203 — Tax calculation failure تمنع Completion

**التصنيف:** Invariant للمنتجات الخاضعة

لا تسجل ضريبة تقديرية مجهولة.

### BR-CERR-204 — Recovery عبر Version/Correction

**التصنيف:** Invariant

لا Direct SQL لتغيير Price أوTax أوBarcode history.

### BR-CERR-205 — Failed bulk update قابلة للإعادة بنفس Batch ID

**التصنيف:** Invariant

دون تكرار Rows نجحت سابقًا.

## 33. التقارير

### BR-CREP-200 — Sales by Product تحافظ على الهوية التاريخية

**التصنيف:** Invariant

مع إمكان Group by Current category بصورة معلنة.

### BR-CREP-201 — Price realization تفرق المصادر

**التصنيف:** Invariant

- list price.
- promotion discount.
- manual discount.
- manual price override.
- net realized price.

### BR-CREP-202 — Tax reports من Snapshots المستندات

**التصنيف:** Invariant

لا من Tax code الحالية.

### BR-CREP-203 — Promotion performance تربط Cost وBenefit

**التصنيف:** Reporting Policy

تفرق بين Sales influenced وDiscount granted وMargin effect، دون ادعاء Causality غير مثبتة.

### BR-CREP-204 — Archived products تبقى في التقارير

**التصنيف:** Invariant

### BR-CREP-205 — Barcode وSKU history قابلة للبحث

**التصنيف:** Invariant

## 34. السيناريوهات الإلزامية للاختبار لاحقًا

1. Simple product بVariant افتراضية.
2. Product متعددة المقاسات والألوان.
3. منع Variant combination مكررة.
4. منع SKU مكررة.
5. عدة Barcodes لنفس Variant.
6. Barcode لوحدة كرتونة وتحويلها للقطع.
7. تعطيل Barcode مع Offline device قديم.
8. Fractional weighted sale.
9. Product active وغير متاحة بفرع.
10. Archive مع مبيعات سابقة ومخزون قائم.
11. Default Price Book.
12. Location price تتغلب على Default.
13. Customer price تتغلب على Location.
14. Price effective في تاريخ مستقبلي.
15. Overlapping price conflict.
16. Missing price.
17. Manual override داخل وخارج الحد.
18. Sell below cost approval.
19. Tax inclusive.
20. Tax exclusive.
21. Tax exemption.
22. Tax rate change مع حفظ الماضي.
23. Line discount وInvoice discount.
24. Promotion scheduled activation.
25. Exclusive promotions conflict.
26. Best-price selection.
27. Coupon reservation ثم Cart cancellation.
28. Duplicate coupon redemption retry.
29. Buy X Get Y مع Partial return.
30. Free item وتأثير المخزون.
31. Bundle price allocation.
32. Bundle component out of stock.
33. Offline sale بسعر Snapshot صالح.
34. Offline sale بسعر Stale.
35. Server-only Promotion أثناء Offline.
36. Bulk import مع SKU/Barcode conflicts.
37. Tax import كVersion جديدة.
38. Rename Product دون تغيير الفاتورة القديمة.
39. UOM conversion correction بعد معاملات.
40. Cross-tenant SKU/Barcode isolation.

## 35. القرارات المفتوحة

### OD-CAT-001 — نموذج Simple products

**الاقتراح:** كل Product لها Variant واحدة على الأقل داخليًا؛ يقلل الاستثناءات في البيع والمخزون.

### OD-CAT-002 — SKU case sensitivity

**الاقتراح:** Uniqueness على Normalized uppercase/trimmed form مع حفظ Display value.

### OD-CAT-003 — إعادة استخدام Barcode

**الاقتراح:** ممنوعة افتراضيًا طوال Retention وOffline safety window، مع مسار استثنائي موثق لاحقًا.

### OD-CAT-004 — Multi-language catalog في MVP

**الاقتراح:** Name عربي وإنجليزي اختياريان مع لغة أساسية وFallback، دون نظام ترجمة عام معقد.

### OD-CAT-005 — Multi-currency Price Books

**الاقتراح:** كل Price Book بعملة واحدة، وPilot يبدأ بعملة تشغيل أساسية واحدة.

### OD-CAT-006 — Tax engine في MVP

**الاقتراح:** Tax codes Versioned ودعم inclusive/exclusive، مع تأجيل محرك Jurisdiction معقد حتى Legal Blueprint.

### OD-CAT-007 — Promotion engine في MVP

**الاقتراح:** Percentage/fixed discounts وfixed price وBuy-X-Get-Y بسيطة، وتأجيل Rules المركبة جدًا.

### OD-CAT-008 — Coupon support

**الاقتراح:** Single-use وPublic codes Online-first؛ Offline coupon redemption تؤجل.

### OD-CAT-009 — Bundles في MVP

**الاقتراح:** Virtual sales bundles فقط، وتأجيل stock kits وassembly/disassembly.

### OD-CAT-010 — Price change approval

**الاقتراح:** Approval للتخفيضات الجماعية أوتحت Floor، بينما التغييرات الصغيرة المستقبلية يمكنها Self-approval حسب Role.

### OD-CAT-011 — Price stale threshold Offline

يُحسم حسب القطاع؛ يجب أن يكون أقصر من Product identity snapshot، وقابلًا للضبط لكل Location.

### OD-CAT-012 — Promotion return behavior

**القرار:** كل Promotion type يجب أن توفر Allocation وReturn policy قبل تفعيلها.

### OD-CAT-013 — Weighted/embedded barcodes

**الاقتراح:** Barcodes الموزونة تُدعم بعد ثبات Core scanning؛ السعر المضمّن يؤجل لصالح الوزن المضمّن الأكثر أمانًا.

### OD-CAT-014 — Product-level vs Variant-level taxes

**الاقتراح:** Default tax category على Product مع Override مصرح على Variant.

## 36. خارج النطاق حاليًا

- AI dynamic pricing.
- Marketplace catalog syndication.
- Full PIM workflow.
- Manufacturing BOM وMRP.
- Stock kit assembly في MVP.
- Global tax determination engine.
- Automatic competitor-price scraping.
- Complex rebate settlements.
- Personalized hidden pricing غير القابل للتفسير.
- Cross-Tenant shared catalog.
- Digital asset licensing.
- Subscription products المتكررة قبل Billing Blueprint.

## 37. Dependencies

هذه الوثيقة تغذي:

- Product and Variant Domain Model.
- Pricing Domain and evaluation contract.
- Tax calculation contract.
- Promotion and Coupon State Machines.
- Sales and Returns calculations.
- Inventory UOM and tracking model.
- Purchasing supplier-product relationships.
- Permission Matrix.
- Event and Audit Catalogs.
- API and Error Contracts.
- Sync/Offline Protocols.
- Database Blueprint.
- Reporting Model.
- Legal/Fiscal Blueprint.

## 38. Acceptance Gate

لا تعتبر Catalog/Pricing planning مكتملة قبل:

1. اعتماد Product/Variant model.
2. اعتماد SKU وBarcode uniqueness/reuse rules.
3. اعتماد UOM وConversion model.
4. اعتماد Assortment by Location.
5. اعتماد Price Book priority وeffective dating.
6. اعتماد Price override وfloor approval rules.
7. اعتماد Tax code/version/inclusive-exclusive model.
8. اعتماد Promotion MVP types وstacking.
9. اعتماد Coupon scope.
10. اعتماد Bundle scope وReturn allocation.
11. اعتماد Offline snapshot/staleness matrix.
12. تحويل كل Rule حرجة إلى Constraint أوState transition أوEvaluation step أوPermission أوTest requirement.

## 39. القرار التخطيطي الحالي

- كل Product تمثلها Variant واحدة على الأقل.
- SKU فريدة داخل Tenant، والقديمة لا يعاد استخدامها.
- Barcode ترتبط بـVariant ووحدة، ولا يسمح بتطابق غامض.
- Product active لا تعني متاحة بكل الفروع؛ Assortment مستقلة.
- Price Books أحادية العملة وVersioned وEffective-dated.
- اختيار السعر حتمي ويحفظ Evidence.
- Tax category ليست معدلًا ثابتًا؛ Tax rule الفعالة تحفظ كSnapshot.
- Promotions Versioned، وكل Rule تحدد Priority وStackability وReturn behavior.
- Coupons واستخدام Benefits المركزية Online-first.
- MVP يدعم Virtual bundles فقط، وليس Manufacturing kits.
- Offline catalog له Versions وأعمار صلاحية منفصلة للهوية والسعر والضريبة والعروض.
- لا تعديل رجعي صامت للأسعار أوالضرائب أوالوحدات أوتركيبة Bundle.