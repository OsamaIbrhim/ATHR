# ATHR Reporting Model v1.0

**Planning Baseline — Metric Semantics, Dimensions, Projections, Dashboards, Reports, Exports and Reconciliation**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة النموذج المعتمد للتقارير والتحليلات في ATHR، وتثبت:

- الفرق بين Operational Query وDashboard وReport وExport.
- مصدرالحقيقة لكلMetric.
- Grain لكلFact وReport dataset.
- Dimensions وSnapshots وSlowly changing attributes.
- تعريفRevenue وNet Sales وTax وDiscount وReturns وGross Profit.
- Inventory valuation والحركات والتوافر.
- Purchasing وSupplier وTransfer وShift وCash reporting.
- Customer وReceivables وStore Credit وLoyalty.
- SaaS subscription وUsage reporting.
- Timezones وBusiness dates وCurrencies وAs-of semantics.
- Data freshness وWatermarks وReconciliation.
- Projection design وRebuild behavior.
- Report definitions وVersioning وScheduled runs.
- Export security وAudit وRetention.
- Performance وTesting وAcceptance gates.

هذه الوثيقة لا تجعلالـDashboard أوCSV أوMaterialized View مصدرًا للحقيقة. المصدر يظل الـAggregates والـLedgers والـDocuments المعتمدة فيالـContexts المالكة.

## 2. المبادئ غيرالقابلة للتفاوض

1. كلMetric لهااسم ثابت وتعريف مكتوب وOwner.
2. كلرقم قابلللتفسير حتىSource records.
3. نفسالاسم لا يستخدملتعريفين مختلفين.
4. Report version قدتغيرالحساب؛ النتائجالتاريخية تحفظVersion المستخدمة.
5. Dashboard ليستمصدرًا للتعديل.
6. Projection قابلةلإعادةالبناء.
7. Ledger أوDocument posted هوالمرجع للحساباتالمالية والمخزنية.
8. Current master data لا تعيدكتابةالتاريخ.
9. كلReport تعلنTenant وScope وTimezone وCurrency وCutoff.
10. `occurred_at`, `recorded_at`, `business_date` لا تخلط.
11. Pending وUnknown وFailed وCompleted حالاتمختلفة فيالتجميع.
12. Returns لا تخصم منSales إلاوفقMetric definition واضحة.
13. Refund لا يساويReturn.
14. Payment collected لا يساويRevenue.
15. Sale completed لا تعنيCash settled أوDocument delivered.
16. Inventory on hand لا يساويAvailable.
17. Cost الحالي لا يستخدملحسابربحSale تاريخية.
18. Cancelled/Void/Correction records لا تختفي؛ تظهرحسبReport policy.
19. Approximate metric توسمبوضوح ولا تستخدمللتسوية.
20. Export هيSensitive data action مستقلة عنRead permission العادية.

# القسم الأول — Reporting Surfaces

## 3. Operational Query

استعلام قصيرلدعمإجراءتشغيلي آني، مثل:

- قائمةSales حديثة.
- Pending sync operations.
- Current stock availability.
- Open shifts.
- Transfers awaiting receipt.

خصائصها:

- تقرأAggregate state أوOperational projection.
- Freshness شبهفورية.
- Pagination إلزامية.
- ليستتقريرًا محاسبيًا مجمعًا.
- لا تسمحQuery عشوائيًا عبركلالجداول.

## 4. Dashboard

عرضMetrics وTrends مختصرة لاتخاذقرار سريع.

- تعتمدPre-aggregated projections عندالحاجة.
- تعرضLast refreshed/As of.
- توفرDrill-through إلىReport أوSource list.
- يمكنأن تحتويEstimated أوProvisional metrics بشرطLabel واضح.

## 5. Report

تعريفمستقر للحساب والـScope والـDimensions والفترة.

- له`report_definition_id` وVersion.
- يحددInput filters وOutput columns.
- قدينفذSynchronously أوAsynchronously.
- يحفظRun parameters وWatermark وResult checksum.

## 6. Export

ملف ناتج عنReport Run أوAuthorized dataset extraction.

- لهPermission مستقلة.
- Large exports asynchronous.
- File encrypted at rest.
- Expiry وDownload limit.
- Audit لكلإنشاءوتنزيل.
- لا يحتويحقولًا غيرمصرح بها لمجردأنالشاشة تعرضها.

## 7. Reconciliation Report

تقرير هدفه مقارنةمصدرين أوProjection بالمصدرالسلطوي وكشفالفرق، مثل:

- Payment provider vs Payment ledger.
- Cash expected vs counted.
- Inventory balance projection vs Movement ledger.
- Report aggregate vs source documents.

لا يخفىالفرق ولا يصلحهتلقائيًا دونWorkflow.

# القسم الثاني — Source of Truth and Lineage

## 8. Reporting Source Hierarchy

الأولوية:

1. Immutable ledger entry أوPosted document.
2. Aggregate completed/posted state معSnapshots.
3. Domain-owned transactional table.
4. Validated reporting projection.
5. Cached dashboard aggregate.

لا تستخدم:

- UI local state.
- POS unsynced cache كرقمTenant نهائي.
- Current product cost لربحHistory.
- Notification delivery status لإثباتBusiness transaction.

## 9. Data Lineage Contract

كلMetric definition تسجل:

- Metric key.
- Business title.
- Owner Context.
- Source entities/ledgers.
- Grain.
- Filter conditions.
- Inclusion/exclusion rules.
- Formula.
- Currency behavior.
- Time basis.
- Freshness class.
- Null/unknown handling.
- Correction handling.
- Drill-through target.
- Version andeffective date.

## 10. Source References in Projections

Reporting facts تحتفظعلىالأقل بـ:

- tenant_id.
- source_context.
- source_type.
- source_id.
- source_line_id عندالحاجة.
- source_version.
- source_event_id أوledger sequence.
- occurred_at.
- recorded_at.
- business_date.
- projection_version.

# القسم الثالث — Time Model

## 11. Time Dimensions

### Occurred Time

وقت الواقعةالتجارية.

### Recorded Time

وقتدخولها للنظامالسلطوي.

### Business Date

اليومالتشغيلي حسبLocation timezone وBusiness day policy.

### Effective Time

وقتبدءسريانPolicy أوPrice أوTax.

### Issued Time

وقتإصدارالمستند.

### Settled Time

وقتالتسويةالمالية أوالمصالحة النهائية.

## 12. Default Time Basis

- Sales operational reports: `business_date` وoccurred time.
- Audit/security: recorded time.
- Payment settlement: settled/recorded حسبالتقرير.
- Subscription billing: billing period/effective dates.
- Inventory movement: occurred + recorded visible.

كلReport تعرضTime basis ولا تفترضهضمنيًا.

## 13. Timezone Rules

- User timezone للعرض فقط، إلاإذاReport يختارهاصراحة.
- Location reports تستخدمLocation timezone.
- Tenant consolidated report يستخدمTenant reporting timezone أوUTC حسبDefinition.
- Cross-location daily aggregation لا تجمع`date` المحلية دونتحويل واضح.
- DST/business-day boundaries تستعملIANA timezone rules.

## 14. Late-arriving Data

عمليةOffline قدتحدثأمس وتسجلاليوم.

التقارير تميز:

- Occurrence-period restatement.
- Recording-period activity.
- Closed-period adjustments.

Dashboard الحديثة قدتعيدحسابالفترةالمفتوحة. Closed period correction تظهرAdjustment معPolicy محددة.

# القسم الرابع — Currency and Numeric Semantics

## 15. Currency Modes

### Transaction Currency

عملةالمعاملة الأصلية.

### Tenant Reporting Currency

عملة موحدة اختيارية للتجميع.

### Document Currency

العملة المثبتةفيالمستند.

## 16. Multi-currency Rules

- لا تجمععملات مختلفة فيرقمواحد دونConversion policy.
- Report قدتعرضGroup by currency بدلConversion.
- Conversion يستخدمExchange rate snapshot معsource/effective time.
- لا تستخدمLatest exchange rate لإعادةكتابةالتاريخ.
- Rounding differences تظهرMetric منفصلة عندالحاجة.

## 17. Numeric Precision

- Measures تستخدمdecimal-safe arithmetic.
- Output values ترسلdecimal strings فيAPI.
- Display rounding لا يغيرStored/report exact value.
- Percentage denominator zero ينتج`null/not_applicable`، لاInfinity أو0 مضلل.

# القسم الخامس — Core Sales Metrics

## 18. Gross Sales

**Metric key:** `sales.gross_sales_amount`

المجموعقبلخصوماتالمعاملة وبعدضبطLine quantity وفقSale completed lines.

Baseline formula:

```
SUM(line_list_or_base_amount × completed_quantity)
```

- Completed/posted sales فقط.
- Cancelled قبلcompletion مستبعدة.
- Returns لا تخصمفيهذاMetric.
- Taxes لا تدخل إلاإذاDefinition country-specific تقولTax-inclusive gross؛ Core يحتفظGross excluding tax وTax separately.

## 19. Discount Amount

**Metric key:** `sales.discount_amount`

- Line discounts + allocated order discounts.
- لا تشملRefund أوStore credit redemption.
- Promotion-funded components يمكنفصلها بعدتحديدFunding source.

## 20. Net Sales Before Returns

**Metric key:** `sales.net_sales_before_returns`

```
Gross Sales - Discounts
```

قبلTax وقبلReturns.

## 21. Return Sales Value

**Metric key:** `returns.posted_return_sales_value`

القيمةالبيعية للـReturn lines المنشورة وفقOriginal transaction valuation/correction policy.

- Return posted هوالمحدد، وليسRefund success.
- Rejected/intake-only returns مستبعدة.

## 22. Net Sales

**Metric key:** `sales.net_sales_amount`

```
Net Sales Before Returns - Posted Return Sales Value
```

- Tax منفصلة.
- Exchange replacement Sale تدخلSales؛ returned side تدخلReturns.
- Void/Correction تتبعCorrection documents/entries لاSilent mutation.

## 23. Tax Collected

**Metric key:** `sales.tax_amount`

- منTax snapshots فيCompleted sale documents.
- Return tax adjustment منPosted return/correction.
- Report يعرضGross tax, returned tax, net tax.
- ليسبديلًا عنCountry statutory tax report.

## 24. Sales Count

عدةMetrics منفصلة:

- `sales.completed_sale_count`
- `sales.completed_line_count`
- `sales.units_sold_quantity`
- `returns.posted_return_count`
- `returns.returned_units_quantity`

لا يستخدم لفظ`عددالمبيعات` دونتحديدهلDocuments أمLines أمUnits.

## 25. Average Order Value

```
Net Sales Before Returns / Completed Sale Count
```

Return-adjusted AOV Metric منفصلة إذااحتاجالمنتج.

## 26. Units per Transaction

```
Completed sold units / Completed Sale Count
```

Quantity conversion إلىBase UOM يجبأن تكونصالحة؛ وإلاGroup by UOM.

# القسم السادس — Profit and Cost Metrics

## 27. Cost of Goods Sold

**Metric key:** `sales.cogs_amount`

- مصدرهInventory Cost Ledger entries المرتبطةSale/Return.
- لا يستخدمProduct current cost.
- Negative-stock provisional cost تظهرحسبCost policy وreconciliation state.
- Return قدتعيدقيمةمخزون وفقOriginal/approved return cost policy.

## 28. Gross Profit

```
Net Sales Amount - Net COGS
```

حيث:

```
Net COGS = Sale COGS - Returned Inventory Cost Restored ± Cost Corrections
```

## 29. Gross Margin Percentage

```
Gross Profit / Net Sales Amount × 100
```

إذاNet Sales = 0 تظهر`not_applicable`.

## 30. Profit Completeness

Report يعلن:

- Complete: كلcost movements finalized.
- Provisional: توجدNegative inventory أوpending cost allocation.
- Reconciled: تمتصحيحالتكلفة.

لا تعرضProvisional profit كرقم نهائي بلاWarning.

## 31. خارج Gross Profit

لا تدخل تلقائيًا:

- Payment provider fees.
- Delivery expense.
- Payroll.
- Rent.
- General overhead.
- VAT payable.

هذه تحتاجContribution/Operating profit model مستقل أوAccounting blueprint.

# القسم السابع — Payment Metrics

## 32. Payment Authorized

قيمةPayment attempts المعتمدة Authorization فقط؛ لا تعنيCaptured.

## 33. Payment Collected

القيمةالمثبتةفيPayment Ledger كCollected/settled حسبMethod policy.

## 34. Payment Outcome Unknown

تظهرعددًا وقيمةمستقلين ولا تدخلCollected حتىالمصالحة.

## 35. Refund Metrics

- Refund requested.
- Refund approved.
- Refund completed.
- Refund outcome unknown.
- Refund failed.

Return value لا تساويRefund value، بسببExchange أوStore credit أوNo-refund disposition.

## 36. Tender Mix

Group by normalized payment method:

- Cash.
- Card/provider.
- Bank transfer.
- Store credit.
- Other approved methods.

Mixed tender allocation تعتمدPayment allocations لاSale header field.

## 37. Payment Reconciliation

تقارن:

- Internal payment ledger.
- Provider settlement/evidence.
- Bank/deposit record عندتوفره.

الفروقات لهاstatus وage وowner.

# القسم الثامن — Inventory Metrics

## 38. On-hand Quantity

مجموعInventory Movement Ledger حتىAs-of cutoff لكلInventory account.

## 39. Reserved Quantity

Active reservation quantities عندCutoff.

## 40. Available Quantity

```
On-hand - Active Reserved
```

قدتختلفعنSellable إذاهناكQuality/quarantine/blocked states.

## 41. In-transit Quantity

منTransfer Transit Ledger:

```
Shipped - Received - Damaged - Missing - Corrected
```

## 42. Inventory Valuation

- منInventory Cost Ledger/valuation projection.
- Group byLocation/Warehouse/Product/Category.
- As-of report يحتاجledger cutoff ثابت.
- Negative quantity/value policies تظهرصراحة.

## 43. Stock Movement Report

Grain = one inventory movement entry.

Dimensions:

- product/variant.
- location/warehouse.
- movement type.
- source type.
- actor.
- occurred/recorded time.
- batch/lot مستقبليًا.

## 44. Stock Aging

لا يحسبمن`updated_at` للرصيد. يحتاجReceipt/cost layers أوLot/FIFO age model. Baseline يوسم`Not available` حتىاعتمادvaluation layer المناسب.

## 45. Stockout and Low-stock

- Current operational indicators وليستHistorical fact تلقائيًا.
- Historical stockout duration يحتاجPeriodic snapshot/event capture.
- Threshold version تحفظمعalert/metric.

## 46. Inventory Accuracy

```
1 - ABS(counted - expected) / comparison basis
```

تحددby units/value/lines، ولا تخلط.

# القسم التاسع — Purchasing and Supplier Metrics

## 47. Purchase Order Metrics

- Ordered quantity/value.
- Approved quantity/value.
- Open commitment.
- Received quantity/value.
- Cancelled quantity/value.

## 48. Goods Receipt Metrics

Grain = receipt line.

- Received.
- Accepted.
- Rejected/damaged.
- Over/under receipt.
- Receipt lead time.

## 49. Supplier Invoice Metrics

- Invoiced amount.
- Matched amount.
- Unmatched variance.
- Approved override amount.
- Duplicate suspected count.

## 50. Supplier Performance

- On-time delivery rate.
- Fill rate.
- Defect/damage rate.
- Invoice match rate.
- Average lead time.

كلMetric تحددDenominator وExclusions، مثلCancelled POs.

## 51. Purchase Cost Variance

يقارنApproved/expected cost وactual net receipt/invoice cost حسبDefinition. لا يستخدمSelling price.

# القسم العاشر — Transfer Metrics

## 52. Transfer Pipeline

Counts/quantities bystate:

- Draft.
- Approved.
- Shipped.
- Partially received.
- Received.
- Cancelled.

## 53. Transfer Fulfillment

- Approved vs shipped.
- Shipped vs received.
- Missing/damaged.
- Time to approve/ship/receive.

## 54. Transfer Accuracy

```
1 - discrepancy quantity / shipped quantity
```

إذاshipped = 0 تكونNot applicable.

# القسم الحادي عشر — Returns and Exchanges Metrics

## 55. Return Rate

يجبوجودVariants محددة:

- Unit return rate.
- Sales-value return rate.
- Transaction return rate.

مثالUnit:

```
Returned units / Eligible sold units
```

الفترةقدتعتمدSale cohort أوReturn occurrence؛ Report يحددها.

## 56. Return Reasons

Reason code controlled dimension، معFree text منفصل لا يستخدمAggregation مباشر.

## 57. Disposition Metrics

- Restocked.
- Damaged.
- Quarantined.
- Scrapped.
- Returned to supplier.

## 58. Exchange Metrics

- Exchanges count.
- Return side value.
- Replacement sale value.
- Customer paid difference.
- Customer received difference.

لا تسجلExchange كSale واحدةصافية تفقدالتفسير.

# القسم الثاني عشر — Shift and Cash Metrics

## 59. Expected Cash

منCash Movement Ledger:

```
Opening float
+ Cash sales collections
+ Cash-ins
- Cash refunds
- Cash-outs
- Deposits/drops
± Corrections
```

## 60. Counted Cash

منFinal cash count session المعتمدة.

## 61. Cash Difference

```
Counted Cash - Expected Cash
```

- Provisional قبلFinal close.
- Approved/reconciled status مستقل.

## 62. Shift Metrics

- Open duration.
- Sales count/value.
- Cash/non-cash mix.
- Refunds.
- Reprints/voids.
- Pending offline operations atclose.
- Difference amount andapproval status.

## 63. Terminal Health Metrics

- Last contact.
- Last successful sync.
- Queue depth.
- Conflict count.
- Client/protocol version.
- Offline duration.

Telemetry metric ليستBusiness revenue metric.

# القسم الثالث عشر — Customer Metrics

## 64. Customer Activity

- Active customer definition must specifywindow andqualifying event.
- New customer bycreated time مختلفعنfirst purchase customer.
- Anonymous sales separated.

## 65. Customer Sales

- Gross/net sales.
- Orders.
- Units.
- Returns.
- Last purchase.
- Average order value.

PII filters/exports تحتاجPermissions خاصة.

## 66. Receivables

- Opening balance.
- Charges.
- Payments.
- Credits/write-offs.
- Closing balance.
- Aging buckets حسبdue date.

Ledger هوالمصدر.

## 67. Store Credit

- Issued.
- Redeemed.
- Expired.
- Adjusted.
- Current liability balance.
- Reserved balance.

## 68. Loyalty

- Points earned.
- Redeemed.
- Expired.
- Adjusted.
- Outstanding points.
- Estimated liability إذاعُرّفتPolicy مالية لاحقًا.

## 69. Cohorts and Retention

Customer cohort definition versioned:

- First purchase month.
- Signup month.
- Location/channel.

Retention لا تستخدمكلغةفضفاضة؛ تحددqualifying repeat event وwindow.

# القسم الرابع عشر — Catalog, Pricing and Promotion Metrics

## 70. Product Performance

- Net sales.
- Units.
- COGS.
- Gross profit/margin.
- Return rate.
- Stock availability.

Historical grouping يستخدمProduct/Category snapshot، معاختيارCurrent hierarchy اختياري وموسوم.

## 71. Price Realization

```
Net unit sales amount / sold quantity
```

يقارنList/Base price snapshot.

## 72. Discount Effectiveness

- Discount amount.
- Discounted sales.
- Units.
- Margin after discount.
- Promotion usage.

لا يدعيCausality تلقائيًا؛ هوPerformance attribution فقط.

## 73. Coupon Metrics

- Issued.
- Reserved.
- Redeemed.
- Expired.
- Rejected.
- Unique users/transactions حسبPrivacy policy.

# القسم الخامس عشر — SaaS Billing and Usage Metrics

## 74. Subscription Metrics

بعدBilling Model، تشمل:

- Active subscriptions.
- Trialing.
- Past due.
- Suspended/read-only.
- Cancelled/churned.
- Plan mix.

## 75. Revenue Metrics for ATHR SaaS

تفصلعنTenant retail sales تمامًا:

- Billed recurring amount.
- Collected subscription payments.
- MRR/ARR وفقBilling Model.
- Discounts/credits/refunds.
- Failed/unknown provider outcomes.

لا تسميRetail sales بـPlatform revenue.

## 76. Usage Metrics

- Active locations.
- Active terminals.
- Membership count.
- Transactions.
- Storage/export volume.
- API/sync usage.

Usage counter billing source يحتاجIdempotent authoritative records، لاDashboard estimates.

# القسم السادس عشر — Dimensions

## 77. Conformed Dimensions

- Date.
- Time.
- Tenant.
- Legal Entity.
- Location.
- Warehouse.
- Terminal.
- Shift.
- Membership/Actor masked.
- Product.
- Variant.
- Category.
- Brand.
- Customer masked.
- Supplier.
- Currency.
- UOM.
- Payment Method.
- Sale Channel.
- Promotion.
- Return Reason.
- Inventory Movement Type.
- Document Type.
- Plan/Subscription.

## 78. Historical Dimension Policy

### Transaction Snapshot

للتاريخ القانوني والربحية وقتالبيع.

### Current Master View

للإدارة الحالية، موسومة`current classification`.

### Effective-dated Dimension

للتحليل عبرالنسخ الزمنية عندالحاجة.

لا يدمجالأنواع دوناختيارصريح.

## 79. Unknown and Deleted Members

- Unknown/Not applicable مفاتيحمنظمة.
- حذف/anonymization لا يكسرFact rows.
- PII masked/anonymized dimension معstable surrogate عندالسماح.

# القسم السابع عشر — Fact Grain

## 80. Core Facts

- Sale fact: one completed sale.
- Sale line fact: one completed sale line.
- Payment ledger fact: one payment ledger entry.
- Return line fact: one posted return line.
- Inventory movement fact: one movement entry.
- Inventory valuation fact: one cost entry أوAs-of balance snapshot.
- Purchase receipt fact: one receipt line.
- Transfer movement fact: onetransit entry.
- Cash movement fact: one ledger entry.
- Customer value fact: one receivable/store-credit/loyalty entry.
- Subscription billing fact: onebilling ledger/event.

## 81. No Mixed Grain

جدول/Projection لا يخلطSale header وSale line وPayment allocations فيصف واحد يسببDouble counting.

# القسم الثامن عشر — Reporting Architecture

## 82. Baseline Architecture

```
Domain commit + Outbox
        ↓
Projection workers
        ↓
PostgreSQL reporting projections
        ↓
Operational APIs / Dashboards / Report Runs
        ↓
Exports in Object Storage
```

## 83. No External Warehouse Initially

- لاData warehouse مدفوعفيالبداية.
- PostgreSQL reporting schema يكفي للـDemo والعملاءالأوائل.
- التصميم يحافظEvent/Fact contracts تسمحبإضافةWarehouse لاحقًا.
- لا يتمبناءETL مزدوج غيرضروري.

## 84. Projection Types

### Current-state projection

لـOperational dashboard.

### Event/ledger fact projection

للتحليل والتاريخ.

### Daily aggregate

للرسوم السريعة.

### As-of snapshot

للمخزون أوAging حيثإعادةالحساب مكلفة.

### Search projection

للقوائم والبحث، وليستMetric source حرجة.

## 85. Projection Idempotency

كلProjection consumer:

- Inbox/dedupe byevent ID.
- تحفظlast applied sequence/checkpoint.
- Upsert deterministically.
- Detects gaps.
- Supports replay fromknown point.

## 86. Rebuild

- Projection definition versioned.
- Rebuild إلىnew tables/version ثمatomic switch.
- لا تمسحprojection الحالية قبلنجاحالبديلة.
- Rebuild لايعيدExternal side effects.
- نتائجالتقارير تحفظdefinition/projection version.

# القسم التاسع عشر — Freshness and Watermarks

## 87. Freshness Classes

### F0 — Transactional

نفسTransaction أوقراءةمباشرة؛ للحقائق الصغيرةالحرجة.

### F1 — Near real-time

هدفثوانٍ إلىدقيقة.

### F2 — Operational delayed

حتى15 دقيقة.

### F3 — Scheduled

ساعي/يومي.

### F4 — Historical rebuild

حسبطلب/دفعة.

## 88. Report Watermark

كلReport Run تسجل:

- source watermark/event sequence.
- data cutoff recorded time.
- max occurred time.
- projection version.
- started/completed time.
- freshness class.
- incomplete source warnings.

## 89. Freshness UI

تعرض:

- `As of` timestamp.
- `Last refreshed`.
- `Data through business date` عندالملائم.
- Pending/offline/unknown exclusions.

## 90. Stale Data

إذاprojection متأخرة عنSLA:

- Dashboard تظهرWarning.
- Critical settlement report قديرفضالتنفيذ أويسقطلـsource query.
- لا تعرضرقمقديم كأنهحديث.

# القسم العشرون — Report Definition and Run Model

## 91. Report Definition

يحفظ:

- key/name/version.
- owner.
- description.
- grain.
- metrics/dimensions.
- source/projection requirements.
- allowed filters.
- default sorting.
- timezone/currency policy.
- permission key.
- sensitive fields.
- max range/row limits.
- synchronous/asynchronous mode.
- freshness requirement.
- retention class.

## 92. Report Run

يحفظ:

- report definition version.
- tenant andscope.
- requested bymembership.
- filters.
- timezone/currency.
- watermark.
- state.
- row count.
- checksum.
- warnings.
- export references.
- started/completed/expired times.

## 93. States

`Queued → Running → Succeeded | Failed | Cancelled | Expired`

قدتوجد`SucceededWithWarnings` أوwarnings array بدلحالةمستقلة حسبAPI contract.

## 94. Scheduled Reports

- Schedule timezone واضحة.
- DST handling معلن.
- Same scheduled occurrence idempotent.
- Delivery failure لا تعيدتوليدReport إذاالنتيجةصالحة.
- تعطيلmembership/permission قبلrun يعادفحصه.

# القسم الحادي والعشرون — Filters and Scopes

## 95. Mandatory Scope

كلReport Tenant-owned تحملtenant_id منauth context، وليسBody موثوق.

## 96. Organizational Filters

- Legal Entity.
- Location.
- Warehouse.
- Terminal.
- Shift.

Scope filters تقاطعPermission scope، ولا توسعها.

## 97. Date Range

- Inclusive start, exclusive end للـtimestamps.
- Business date ranges موثقة.
- Max range حسبReport cost.
- Large ranges async.

## 98. Empty Scope

لا تعنيAll. تستخدمexplicit all-current-and-future scope فقطمعPermission مناسبة.

# القسم الثاني والعشرون — Security, Privacy and Audit

## 99. Permissions

أمثلةPermission keys:

- `reporting.dashboard.read`
- `reporting.sales.read`
- `reporting.profit.read`
- `reporting.inventory_valuation.read`
- `reporting.cash_reconciliation.read`
- `reporting.customer_pii.read`
- `reporting.export.create`
- `reporting.export.download`
- `reporting.schedule.manage`
- `reporting.definition.manage`

Profit/cost/PII permissions مستقلةعنSales read.

## 100. Data Minimization

- Reports لا تعرضContacts أوAddresses إلاعندالحاجة.
- Customer/Supplier/Employee dimensions masked افتراضيًا.
- Export fields allow-listed.
- Row-level scope يطبققبلAggregation وDrill-through.

## 101. Audit

Audit actions:

- Report viewed عندحساسيةعالية.
- Report run created/cancelled.
- Export created/downloaded/expired.
- Schedule created/changed.
- Definition published/deprecated.
- PII/cost/profit report accessed.
- Reconciliation override/acknowledgement.

## 102. Formula Injection and File Safety

CSV exports:

- Escape cells starting `=`, `+`, `-`, `@` وفقsecure export policy.
- UTF-8 BOM optional حسبcompatibility.
- No secrets/internal IDs unlessauthorized.
- Filename sanitized.

PDF/XLSX generation لاحقًا وفقDocument/Export implementation.

# القسم الثالث والعشرون — Performance

## 103. Synchronous Report Limits

- Bounded rows/time/range.
- Query timeout.
- Keyset pagination.
- No unbounded joins/includes.

## 104. Asynchronous Thresholds

أيReport يتجاوزestimated cost/rows/range يتحولJob.

## 105. Pre-aggregation

تستخدمعندما:

- Metric definition مستقرة.
- Source lineage محفوظة.
- Incremental update/rebuild ممكن.
- Reconciliation test موجود.

## 106. Indexing

Reporting projections تبدأبـtenant + date/scope keys. Exact indexes يحددهاQuery plans والـPerformance Strategy، لا التخمينفقط.

## 107. Cache

- Cache key تشملtenant, scope, filters, definition version, watermark.
- Sensitive reports لا تخزنفيshared cache غيرمعزول.
- Invalidation عبرprojection version/watermark.

# القسم الرابع والعشرون — Reconciliation and Data Quality

## 108. Control Totals

لكلProjection حرجة:

- Source row count.
- Source amount/quantity totals.
- Projected totals.
- Difference.
- Last reconciled sequence.

## 109. Required Reconciliations

- Sale documents ↔ sales facts.
- Payment ledger ↔payment reports.
- Inventory movement ledger ↔balance projections.
- Cost ledger ↔COGS/profit facts.
- Return lines ↔return/refund facts.
- Cash ledger ↔shift expected cash.
- Subscription ledger ↔billing reports.

## 110. Data Quality States

- Healthy.
- Delayed.
- Incomplete.
- Rebuilding.
- ReconciliationFailed.

Critical reports تعرضالحالة.

## 111. Duplicate Prevention

Projection uniqueness حسبsource event/entry ID. Double-delivery لا تضاعفMetric.

# القسم الخامس والعشرون — Initial Report Catalog

## 112. Executive Dashboards

- Today net sales.
- Sales trend.
- Gross profit/margin معCompleteness.
- Orders/units/AOV.
- Returns/refunds.
- Tender mix.
- Low stock/out of stock.
- Cash discrepancies.
- Terminal health.

## 113. Sales Reports

- Sales summary.
- Sale line detail.
- Product/category/location performance.
- Discounts/promotions.
- Taxes.
- Seller/cashier performance معPrivacy/behavior safeguards.
- Void/correction/reprint activity.

## 114. Payment Reports

- Payment collection.
- Tender mix.
- Refund status.
- Outcome unknown queue.
- Provider reconciliation.

## 115. Inventory Reports

- On-hand/available/in-transit.
- Movement detail.
- Valuation.
- Negative inventory.
- Stock count/reconciliation.
- Slow-moving baseline بعدتعريفwindow.

## 116. Purchasing Reports

- PO status/open commitments.
- Goods receipts.
- Supplier invoices/matching.
- Supplier performance.
- Purchase cost variance.

## 117. Returns Reports

- Return rate.
- Reasons.
- Disposition.
- Refund linkage.
- Exchanges.

## 118. Cash and Shift Reports

- Shift summary.
- Cash movement detail.
- Expected vs counted.
- Discrepancies andapprovals.
- Offline pending atclose.

## 119. Customer Reports

- Activity andcohorts.
- Sales/value.
- Receivables aging.
- Store credit liability/activity.
- Loyalty activity.

## 120. SaaS Platform Reports

- Tenant status.
- Subscription state.
- Usage/entitlements.
- Terminal/client versions.
- Sync health.
- Support/security actions.

# القسم السادس والعشرون — Error and Recovery

## 121. Reporting Errors

- `REPORT_DEFINITION_NOT_FOUND`
- `REPORT_VERSION_NOT_AVAILABLE`
- `REPORT_FILTER_INVALID`
- `REPORT_SCOPE_FORBIDDEN`
- `REPORT_DATE_RANGE_TOO_LARGE`
- `REPORT_DATA_NOT_READY`
- `REPORT_SOURCE_INCOMPLETE`
- `REPORT_PROJECTION_REBUILDING`
- `REPORT_GENERATION_FAILED`
- `REPORT_CANCEL_NOT_ALLOWED`
- `EXPORT_REQUIRES_APPROVAL`
- `EXPORT_GENERATION_FAILED`
- `EXPORT_EXPIRED`
- `EXPORT_DOWNLOAD_LIMIT_REACHED`
- `REPORT_RECONCILIATION_FAILED`

## 122. Retry Behavior

- Invalid filter/scope: user correction.
- Projection delayed: poll/retry afterdelay.
- Generation job failed transiently: sameoperation retry.
- Reconciliation failure: manual/operator action.
- Export expired: newauthorized run، وليسإحياءرابطقديم.

## 123. Partial Data

Report لا تسكتعنpartial data. ترجعWarnings مثل:

- Pending offline operations excluded.
- Payment outcomes unknown.
- Cost incomplete.
- Projection lag.
- One or more locations unavailable.

# القسم السابع والعشرون — Testing Contract

## 124. Metric Definition Tests

- Formula fixtures.
- Inclusion/exclusion.
- Returns/refunds separation.
- Tax handling.
- Zero denominator.
- Multi-currency behavior.
- Historical snapshots vscurrent master.

## 125. Ledger Reconciliation Tests

- Sales/COGS/gross profit.
- Inventory balance rebuild.
- Payment/refund allocation.
- Cash expected balance.
- Receivables/store credit/loyalty.

## 126. Time Tests

- Location timezone.
- DST boundary.
- Business day cutoff.
- Late offline event.
- Closed-period correction.
- occurred vsrecorded filter.

## 127. Tenant and Permission Tests

- Cross-tenant isolation.
- Location scope intersection.
- Profit permission separate.
- PII masking.
- Export permission/approval.
- Drill-through cannotbypassscope.

## 128. Projection Tests

- Duplicate event.
- Out-of-order event.
- Gap detection.
- Replay/rebuild.
- Version switch.
- Atomic cutover.
- Control totals.

## 129. Export Tests

- Large async export.
- Expiry/download limit.
- Formula injection.
- Encoding.
- Audit.
- Sensitive field allow-list.

## 130. Performance Tests

- Dashboard p95 underrepresentative data.
- Keyset pagination.
- Concurrent tenants.
- Long date range async switch.
- Projection lag underload.
- Noimpact onPOS transaction latency.

# القسم الثامن والعشرون — Open Decisions

## 131. OD-RPT-001 — Reporting currency

**Baseline:** Group bytransaction currency. Tenant reporting currency اختياريةبعدExchange-rate policy.

## 132. OD-RPT-002 — Data warehouse timing

**Baseline:** PostgreSQL projections أولًا. Warehouse خارجي فقطعندحجم/احتياج مثبت.

## 133. OD-RPT-003 — Closed-period restatement

**Baseline:** Open periods restate occurrence date؛ closed periods تظهرadjustment معoriginal reference. Exact close policy تنتظرAccounting/fiscal design.

## 134. OD-RPT-004 — Inventory aging

**Baseline:** غيرمعتمد دونcost/receipt layer definition مناسبة.

## 135. OD-RPT-005 — Current vs historical hierarchy

**Baseline:** Historical snapshot default للربحيةوالوثائق؛ current hierarchy خيارإداري موسوم.

## 136. OD-RPT-006 — Seller performance

**Baseline:** متاحوفقPermission، مععدمتحويله لمراقبةخفية؛ definitions وprivacy واضحة.

## 137. OD-RPT-007 — Gross profit completeness

**Baseline:** كلReport ربح تعرضComplete/Provisional/Reconciled.

## 138. OD-RPT-008 — Real-time SLA

**Baseline:** Operational dashboard F1 near-real-time؛ exact seconds تحددPerformance Strategy.

## 139. OD-RPT-009 — Export formats

**Baseline:** CSV أولًا، PDF للمستندات، XLSX لاحقًا إذاالحاجة مثبتة.

## 140. OD-RPT-010 — General ledger reporting

**Baseline:** خارجالنطاق. Operational ledgers فقطحتىAccounting blueprint مستقل.

# القسم التاسع والعشرون — Prohibited Patterns

## 141. أنماطممنوعة

- Metric بلاdefinition/version/owner.
- Dashboard query مباشرةعشوائية علىكلOLTP tables.
- تعديلDomain data منReport.
- حسابHistorical profit منcurrent cost.
- خلطReturn وRefund.
- خلطCollected payment وRevenue.
- خلطTax معNet sales دونLabel.
- جمععملات مختلفة بلاConversion policy.
- استخدامUser timezone ضمنيًا لتغييرBusiness date.
- إخفاءprojection lag.
- Export كلcolumns تلقائيًا.
- PII فيcache/logs/files بلاسبب.
- Offset pagination غيرمحدودة.
- Rebuild يمسحprojection السليمةقبلنجاحالبديلة.
- At-least-once event يضاعفTotals.
- Excel/CSV formula injection.
- Report scheduled باسمUser معطل دونreevaluation.
- Data warehouse مدفوع مبكرًا لمجردالتعقيد.

# القسم الثلاثون — Implementation Readiness

## 142. Ready after Shared Foundation

- Report definition/run/exports contracts.
- Core metric registry.
- Sales/payment/inventory fact projections الأساسية.
- Freshness/watermark metadata.
- Reconciliation test framework.

## 143. Ready after Domain Packages

كلDomain يضيفfacts وmetrics الخاصةبعدتثبيتLedger/Aggregate implementation.

## 144. Deferred

- Billing MRR/ARR exact formulas إلىBilling Model.
- Notification delivery analytics إلىNotification Contract.
- Country tax statutory reports إلىFiscal adapters.
- General ledger/financial statements إلىAccounting blueprint.
- External warehouse إلىPerformance/scale decision.

# القسم الحادي والثلاثون — Acceptance Gate

## 145. بوابةالاعتماد

لا يعتبرReporting Model مكتملًا قبل:

1. فصلOperational Query/Dashboard/Report/Export/Reconciliation.
2. تثبيتsource-of-truth hierarchy وlineage.
3. تثبيتtime/timezone/business-date semantics.
4. تثبيتcurrency/precision rules.
5. تعريفSales/Returns/Tax/Profit core metrics.
6. تعريفPayment وInventory وPurchasing وCash metrics.
7. تعريفCustomer وSaaS metric boundaries.
8. تثبيتdimensions وfact grains.
9. تثبيتprojection/rebuild/idempotency model.
10. تثبيتfreshness/watermark/warnings.
11. تثبيتReport Definition/Run/Schedule.
12. تثبيتpermissions/privacy/audit/export security.
13. تثبيتreconciliation/control totals.
14. تثبيتinitial report catalog.
15. تثبيتtests وprohibited patterns.
16. توضيحDeferred accounting/fiscal/warehouse items.

## 146. القرار التخطيطي الحالي

- PostgreSQL reporting projections هيBaseline.
- لاWarehouse خارجي مدفوعفيالبداية.
- Metrics تسندإلىLedgers/Documents، لاCurrent mutable data.
- Gross Profit يعتمدHistorical COGS.
- Returns وRefunds منفصلان.
- Profit reports تعلنcompleteness.
- كلReport لهاWatermark وAs-of وDefinition version.
- Dashboard stale/partial data لا تعرضكأنهاكاملة.
- CSV هوExport baseline معحمايةFormula injection.
- Reports لا توسعPermission scope.

## 147. المرحلة التالية

**ATHR Billing Model v1.0**

سيثبت:

- Plans وPlan versions.
- Subscription lifecycle.
- Billing periods وproration.
- Trials وdiscounts وcredits.
- Entitlement snapshots.
- Usage measurement.
- Invoices وcollections وrefunds.
- Past-due/suspension/read-only modes.
- Provider abstraction وoutcome unknown.
- MRR/ARR/churn definitions.
- Upgrade/downgrade/cancellation.
- Free demo to first paid customer transition.

بعده: **ATHR Notification Contract v1.0**.