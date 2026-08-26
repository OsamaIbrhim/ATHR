# ATHR Billing Model v1.0

**Planning Baseline — Plans, Subscriptions, Invoicing, Collections, Entitlements, Usage and SaaS Revenue Metrics**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة النموذج التجاري والتقني لفوترة اشتراكات ATHR، وتشمل:

- Plan catalog وPlan versions.
- Prices والعملات ودوراتالفوترة.
- Trials وInternal demo grants.
- Subscription lifecycle.
- Activation, renewal, upgrade, downgrade andcancellation.
- Proration والـcredits والـdiscounts.
- Subscription invoices وcollection attempts.
- Provider abstraction وWebhook reconciliation.
- Failed وUnknown payment outcomes.
- Grace period وRead-only وSuspension.
- Entitlements وUsage limits.
- Metered usage وoverage readiness.
- MRR وARR وChurn وExpansion metrics.
- الانتقال منDemo مجاني إلىأولعميل مدفوع.
- Security, audit, errors, recovery andtesting.

هذه الوثيقة تخص **فواتيرATHR للعملاء المشتركين فيالمنصة**. لا تخصSales invoices التيينشئهاالعميل داخلنظامه، ولا تخلطPlatform revenue معRetail sales.

## 2. حدودالملكية

### Billing Context يملك

- Plans وPlan versions.
- Commercial prices.
- Subscription state.
- Billing periods.
- Subscription invoices والـcredits.
- Collection attempts.
- Entitlement snapshots.
- Authoritative usage charges.
- Provider reconciliation evidence.

### Billing Context لا يملك

- Tenant users أوPermissions.
- Retail sales/payments الخاصةبالـTenant.
- Location/Terminal lifecycle.
- Provider secrets.
- Infrastructure deployment state.
- General ledger أوfinancial statements.

## 3. المبادئ غيرالقابلة للتفاوض

1. Plan المنشورةVersioned ولا تعدلصامتًا.
2. Subscription ترتبطبـPlan version محددة، وليساسمخطة متغير.
3. Entitlement لا تمنحPermission.
4. Permission لا تتجاوزEntitlement.
5. Payment provider ليستSource of truth منفردة؛ الأدلةتُطابق محليًا.
6. Timeout أوWebhook delay لا يعنيفشل الدفع.
7. Invoice issued لا تُعدل؛ التصحيحCredit/Debit adjustment.
8. Retry يستخدمنفسIdempotency key ولا يكررالتحصيل.
9. Trial وDemo وComplimentary لا تدخلMRR.
10. Tax منفصلةعنRecurring revenue metrics.
11. One-time setup fees لا تدخلMRR.
12. Discounts تحسبوفقVersion ونطاقوفترة معلومة.
13. Usage events idempotent ولا تعتمدDashboard estimate للفوترة.
14. Access restriction لا تحذفبياناتTenant.
15. Past due لا يغيرBusiness history.
16. Suspension لا تمسحPending offline operations.
17. كلتغييرخطة أوOverride عاليالأثر Audit ومؤرخ.
18. لا يوجدProvider-specific state داخلDomain contract.
19. Currency لا تتحول ضمنيًا.
20. Billing ليستمتطلبًا لتطويرDemo الداخلي قبلأولعميل.

# القسم الأول — Commercial Catalog

## 4. Plan

Plan هيهوية تجارية مستقرة مثل:

- Starter.
- Growth.
- Professional.
- Enterprise.

الاسم ليسعقدًا تقنيًا؛ العقد الحقيقي هوPlan Version المنشورة.

## 5. Plan Version

كلVersion تحفظ:

- `plan_version_id`.
- plan key.
- display name/localizations.
- effective period.
- billing model.
- included entitlements.
- included usage quantities.
- limits.
- support level.
- commercial metadata.
- lifecycle state.

الحالات:

`Draft → Published → Deprecated → Retired`

Published version immutable. أي تعديلينشئVersion جديدة.

## 6. Price Definition

كلسعر يحدد:

- Plan version.
- billing interval: monthly/annual/custom.
- interval count.
- currency.
- country/market/channel applicability.
- recurring amount.
- optional setup amount.
- tax behavior reference.
- effective period.
- price lifecycle.

لا يوجدسعر عالمي ضمني لكلالعملات.

## 7. Billing Models

Baseline يدعم:

- Fixed recurring.
- Per-location recurring.
- Per-terminal recurring.
- Per-membership recurring.
- Included quantity +hard/soft limit.
- Metered usage readiness.
- Negotiated enterprise contract.

النسخةالأولى تفضلFixed + included limits، وتؤجلUsage-based charges المعقدة حتىوجوداحتياج مثبت.

## 8. Commercial Classification

Tenant subscription تحملتصنيفًا واضحًا:

- `internal_demo`
- `trial`
- `paid`
- `complimentary`
- `sandbox`

Internal demo ليستFree public plan، ولا تدخلRevenue metrics.

# القسم الثاني — Subscription Aggregate

## 9. Subscription Identity

Subscription ترتبطبـ:

- tenant_id.
- billing_account_id.
- selected plan version.
- price definition.
- billing currency.
- billing interval.
- current period.
- commercial classification.
- provider customer/subscription references عندوجودها.

## 10. Subscription States

Baseline state machine:

```
Draft
→ PendingActivation
→ Trialing | Active
→ PastDue
→ GracePeriod
→ ReadOnly
→ Suspended
→ Cancelled
```

Transitions إضافية:

- Active → CancellationScheduled → Cancelled.
- Cancelled → ReactivationPending → Active، إذاPolicy تسمح.
- Trialing → Active أوExpired/Cancelled.
- Any active-like state → Suspended للأمان/الإساءة/قرارإداري مصرح.

## 11. Draft

- لا Entitlements تشغيلية إلاPreview.
- يمكنتغييرالخطة/السعر قبلالإصدار.
- لا تدخلMetrics.

## 12. PendingActivation

تنتظر أحدالأسباب:

- Payment confirmation.
- Manual commercial approval.
- Contract signature.
- Provisioning completion.

لا تعتبرActive بمجردإنشاءProvider checkout session.

## 13. Trialing

- لهاStart وEnd واضحان.
- Entitlements محددةبـTrial policy.
- لا MRR.
- لا تمديدتلقائي متكرر.
- Trial conversion تنشئ/تربطPayment method وتنتقلActive بعدنجاحالمطلوب.

## 14. Active

- Current period مدفوع أومصرحبه وفقCommercial terms.
- Entitlements فعالة.
- Renewals تصدرفيوقتها.

## 15. PastDue

حدثفشلتحصيل مستحق، لكنGrace policy لمتبدأأوتنته.

- لا يعنيإلغاءالاشتراك.
- يمكنالاستمرار بكاملأوCapabilities محدودة حسبPlan/tenant policy.
- تعرضمطالبةتصحيحالدفع.

## 16. GracePeriod

فترةمحددة بعدPastDue:

- تاريخبدايةونهاية.
- سياسةAccess واضحة.
- Retry schedule.
- Notifications.
- لا تتكررإلىمالانهاية.

## 17. ReadOnly

- يمنعBusiness mutations الجديدة.
- يسمحبالقراءة والتقاريروالتصدير ضمنSecurity/Retention policy.
- لا يصدرOffline leases جديدة.
- Operations أنشئتقبلالتقييد تقيمحسبOccurredAt وLease policy.
- لا يحذفأويسقطالبيانات.

## 18. Suspended

- يمنعالعملالتشغيلي حسبسببالتعليق.
- Security suspension قدتكونأشدمنCommercial suspension.
- Support/owner routes محدودة ومؤمنة.
- Data export/closure rights حسبPolicy والقانون.

## 19. Cancelled

- لا Renewals مستقبلية.
- Access ينتقلوفقCancellation effective time وRetention policy.
- History وInvoices وAudit محفوظة.

# القسم الثالث — Billing Periods and Renewal

## 20. Billing Period

كلPeriod تحفظ:

- period start inclusive.
- period end exclusive.
- billing timezone.
- invoice generation time.
- due time.
- status.
- source subscription version.

## 21. Anniversary Billing

Baseline:

- Subscription لهاbilling anchor ثابت.
- Monthly renewal يحافظعلىanchor قدرالإمكان.
- End-of-month anchors لهاقاعدةمعلنة.
- لا تستخدم30 يومًا كبديلضمني لشهرCalendar.

## 22. Annual Billing

- Period سنةتقويمية منAnchor.
- ARR normalization لا يغيرInvoice amount.
- Annual plan discount جزءمنPrice definition، وليسخصمًا عشوائيًا.

## 23. Renewal

Renewal عمليةIdempotent:

1. تثبيتPlan/Price version للـperiod القادمة.
2. حسابRecurring وUsage وCredits وTax.
3. إصدارInvoice.
4. محاولةالتحصيل حسبTerms.
5. تحديثSubscription فقطبعدOutcome معروفة أوProcess state واضحة.

## 24. Renewal Failure

- لا تصدرInvoice مكررة عندRetry.
- لا تنتقلCancelled مباشرة.
- تدخلPastDue/Dunning وفقPolicy.

# القسم الرابع — Upgrade, Downgrade and Proration

## 25. Upgrade

Baseline:

- Upgrade يمكنتفعيلهافورًا.
- Entitlements الأعلى تبدأبعدنجاحالعملية التجارية المحددة.
- Proration تحسبRemaining time علىOld/New price snapshots.
- Upgrade command idempotent.

## 26. Downgrade

Baseline:

- Downgrade تطبقعندبدايةالفترةالتالية.
- إذاالاستخدامالحالي أعلىمنحدالخطة الجديدة، يظهرBlocking review قبلالتفعيل.
- لا يحذفResources تلقائيًا للوصولللحد.

## 27. Proration Formula

تحسبباستخدام:

- Old recurring charge.
- New recurring charge.
- Exact service period.
- Billing timezone/calendar policy.
- Currency precision.
- Effective timestamp.

```
Unused old-plan credit
+ Remaining new-plan charge
= Net proration adjustment
```

كلLine تحتفظبالفترةوالـformula inputs.

## 28. No Silent Proration

- Preview تعرضقبلالتأكيد.
- Provider-calculated proration يجبأن تطابقLocal expected calculation أوتدخلReconciliation.
- فرقRounding يظهرAdjustment line واضحة.

## 29. Scheduled Plan Change

يحفظ:

- requested plan/version.
- requested at/by.
- effective at.
- price preview.
- required approval.
- state.

طلبجديد يستبدلالسابق فقطبـCommand موثقة.

# القسم الخامس — Trials and Demo-to-Paid Transition

## 30. Internal Demo Baseline

قبلأولعميل:

- Demo Tenant تستخدم`internal_demo` classification.
- Entitlements تأتيمنDemo grant versioned.
- لا Invoice ولاMRR.
- يمكنتشغيلهاعلىRailway/Supabase/Vercel المجانية.
- انتهاءأوإلغاءDemo grant لا يحذفالبيانات.

## 31. Public Trial

إذا تمإطلاقTrial للعملاء:

- One active trial pertenant/commercial identity baseline.
- Start/end server-controlled.
- Trial entitlements وlimits مستقلة.
- Payment method requirement configurable.
- Abuse prevention وidentity/device controls.

## 32. First Paid Customer Transition

المسارالمعتمد:

1. Publish أولPlan/Price version.
2. إنشاءBilling Account للعميل.
3. إنشاءSubscription `PendingActivation`.
4. إصدارInvoice أوPayment request.
5. تأكيدPayment/Commercial approval.
6. تفعيلSubscription وEntitlement snapshot.
7. Trigger operational infrastructure-upgrade checklist.
8. التحققأنPaid tenant لا يعتمدعلىDemo grant.

ترقيةRailway/Supabase ليستجزءًا منPayment transaction ولا تؤخرحقيقةالتحصيل؛ هيOperational milestone مستقلة معRetry/alert.

## 33. Manual Collection Before Provider Integration

يجوزللعميلالأول:

- Manual invoice.
- Bank transfer evidence.
- Admin-confirmed collection بموافقةوتدقيق.

لكن:

- لا يتمتفعيلPaid subscription بلاCollection/approval evidence.
- Manual mark-paid يحتاجPermission وStep-up وAudit.
- Provider integration يمكنإضافتهلاحقًا دونتغييرDomain model.

## 34. No Permanent Free Plan Baseline

Baseline التجاري لا يفترضFree public plan. يوجد:

- Internal demo.
- Time-bounded trial.
- Complimentary grant بموافقة.

أيFree plan دائمة تحتاجPlan version صريحة وقرارًا تجاريًا لاحقًا.

# القسم السادس — Billing Account

## 35. Billing Account

يحفظ:

- tenant/legal entity references.
- billing name/address.
- tax registration snapshots.
- billing contacts.
- invoice delivery preference.
- default currency.
- payment terms.
- provider customer references.

## 36. Billing Contacts

- Effective-dated.
- Verified where needed.
- لا تكتسبPermission داخلATHR تلقائيًا.
- PII masked فيLogs/Reports.

## 37. Payment Method References

- ATHR لا يخزنPAN أوCVV.
- يخزنProvider token/reference وsafe display metadata.
- Default method change high-risk Audit.
- Invalid/expired state منProvider evidence بعدNormalization.

# القسم السابع — Subscription Invoices

## 38. Invoice States

```
Draft → Issued/Open → PartiallyPaid → Paid
                      ↘ Void | Uncollectible
```

Refund/Credit لا يعيدكتابةInvoice؛ يستخدمCredit Note/Refund records.

## 39. Invoice Lines

الأنواع:

- Recurring subscription.
- Proration charge.
- Proration credit.
- Usage charge.
- One-time setup/service.
- Discount.
- Manual adjustment.
- Tax.
- Credit application.

كلLine تحفظSource وPeriod وQuantity وUnit price وCurrency وTax metadata.

## 40. Invoice Immutability

بعدIssued:

- لا تعديلالخطوط أوالمبلغ.
- التصحيحCredit note أوDebit adjustment.
- Void يسمحفقطوفقState/Legal policy ويحتفظبالرقم.

## 41. Due Date

- ناتجةعنPayment terms snapshot.
- لا تتغيرصامتًا.
- Extension تحتاجCommand وAudit.

## 42. Partial Payment

- Payment allocation إلىInvoice/lines عندالحاجة.
- Remaining balance مشتقمنLedger/allocations.
- لا تعتبرPaid حتىالرصيدالمستحق صفر ضمنTolerance policy.

## 43. Credit Notes

- لهاسببومصدروموافقة.
- ترتبطبـInvoice الأصلية.
- لا تتجاوزEligible amount دونApproval استثنائية.
- تؤثرعلىRevenue metrics حسبEffective period policy.

# القسم الثامن — Collections and Provider Abstraction

## 44. Collection Attempt

يحفظ:

- invoice/subscription reference.
- amount/currency.
- provider namespace.
- idempotency key.
- attempt state.
- provider references.
- outcome certainty.
- created/accepted/settled times.

## 45. Attempt States

- Created.
- Submitted.
- Authorized.
- Captured/Collected.
- Declined.
- FailedNoEffect.
- OutcomeUnknown.
- ReconciliationPending.
- ReconciledSucceeded.
- ReconciledFailed.
- Refunded/PartiallyRefunded.

## 46. Outcome Unknown

عندTimeout بعدإمكانيةقبولProvider:

- لا Retry blind.
- Subscription لا تعتبرPaid أوFailed نهائيًا.
- Operation تدخلReconciliation.
- نفسIdempotency key وprovider reference تستخدم للاستعلام.

## 47. Webhooks

- Verify signature علىraw body.
- Enforce replay window.
- Store receipt durably.
- Dedupe byprovider event ID.
- Return fast acknowledgement.
- Process asynchronously.
- Out-of-order events لا تعيدالحالةللخلف.

## 48. Provider Mapping

كلProvider status تتحولإلىNormalized Billing outcome. Raw status لا يكتبمباشرةفيSubscription state.

## 49. Provider Independence

Interfaces:

- Create payment/checkout.
- Retrieve outcome.
- Capture where applicable.
- Refund.
- List settlement evidence.
- Verify webhook.

لا يفترضStripe أوأيProvider بعينه فيCore.

# القسم التاسع — Dunning, Grace and Access Modes

## 50. Dunning Policy

Versioned policy تحدد:

- retry count/schedule.
- retryable decline classes.
- grace period.
- notifications.
- access transitions.
- manual intervention conditions.

## 51. Retry Rules

- Hard decline لا يعادإرسالهبلاUser action.
- Temporary provider failure يعادنفسالطلببعدdelay.
- Outcome unknown لا ينشئAttempt ماليةجديدة.
- Updated payment method قدينشئAttempt جديدة برابطواضح.

## 52. Access Transition

Baseline progression:

```
Active
→ PastDue
→ GracePeriod
→ ReadOnly
→ Suspended
```

Exact durations Open Decision، وليستHard-coded فيDomain.

## 53. Read-only Behavior

يسمحعمومًا:

- Login للمالكين/المصرح لهم.
- قراءةالبيانات.
- تقاريروتصدير ضمنPolicy.
- تحديثBilling details/payment method.
- Support interaction.

يمنع:

- Sales/Purchasing/Inventory mutations الجديدة.
- New offline leases.
- New members/locations/terminals إذاليستضروريةللاسترداد.

## 54. Existing Offline Work

Operations أنشئتقبلAccess restriction:

- لا تسقطتلقائيًا.
- تقيمعندSync باستخدامLease/OccurredAt/Subscription policy.
- قد تقبل، ترفض، أوتدخلManual review.

## 55. Recovery from Past Due

بعدنجاحالتحصيل:

- Reconcile invoice balance.
- Subscription تعودActive إذالا يوجدBlock آخر.
- Entitlement snapshot جديدة.
- Devices/clients تحصلAccess-mode change عبرSync.

# القسم العاشر — Entitlements

## 56. Entitlement Definition

Stable key مثل:

- `catalog.advanced_pricing`
- `inventory.transfers`
- `reporting.profit`
- `locations.max_count`
- `terminals.max_active`
- `memberships.max_active`
- `exports.monthly_limit`
- `offline.max_hours`

## 57. Entitlement Types

- Boolean feature.
- Integer limit.
- Decimal/quantity limit.
- Duration limit.
- Allowed enum/set.
- Rate limit.
- Included usage quantity.

## 58. Entitlement Sources

Effective entitlement ناتجةمن:

1. Plan version.
2. Price/add-on entitlements.
3. Trial/demo/complimentary grant.
4. Approved commercial override.
5. Access-mode restrictions.

لا يمكنClient أوTenant admin تعديلها مباشرة.

## 59. Entitlement Snapshot

Snapshot تحفظ:

- tenant/subscription.
- version.
- effective period.
- source plan/grants/overrides.
- resolved values.
- access mode.
- generated at.
- checksum.

## 60. Entitlement vs Permission

السماحيتطلب:

```
Permission allows
AND Scope allows
AND Entitlement allows
AND Resource state allows
```

Feature entitled لا تمنحUser حقاستخدامهابدونPermission.

## 61. Hard and Soft Limits

### Hard limit

يمنعإنشاءResource/operation جديدة.

### Soft limit

يسمحمعWarning/overage path.

لا يحذفResources موجودةعندخفضالحد.

## 62. Limit Reduction

عندDowngrade تحتالاستخدامالحالي:

- Existing resources محفوظة.
- New creation ممنوعةحتىالعودةداخلحد أوUpgrade.
- Critical operation completion قدتسمحلتجنبcorruption حسبPolicy.
- UI تعرضusage/limit/action.

## 63. Overrides

Commercial override:

- Effective-dated.
- Reason.
- Approval.
- Expiry.
- Specific entitlement only.
- Audit.

لا يوجد`unlimited=true` عام يخفيالنطاق.

# القسم الحادي عشر — Usage Metering

## 64. Meter Definition

كلMeter تحدد:

- meter key/version.
- authoritative event/source.
- unit.
- aggregation method.
- reset/billing period.
- included quantity.
- late-event policy.
- correction policy.
- billable/non-billable classification.

## 65. Usage Event

يحفظ:

- tenant.
- meter key/version.
- event ID.
- source type/id.
- quantity.
- occurred/recorded time.
- billing period.
- idempotency key.
- correction reference.

## 66. Aggregation Types

- Sum.
- Maximum active count.
- End-of-period count.
- Distinct count withauthoritative identity.
- Tiered quantity.

لا تستخدمApproximate dashboard counter للفوترة.

## 67. Late Events

- Open billing period: restate.
- Issued invoice: createadjustment/next-invoice correction حسبPolicy.
- لا تعدلIssued invoice صامتًا.

## 68. Usage Correction

- Opposing/correction event.
- Original event preserved.
- Audit andreason.

## 69. Initial Baseline

قبلScaling:

- معظمخططATHR fixed recurring +limits.
- Usage collection تبنىبصورةAuthoritative.
- Overage charging يؤجلحتىPricing/Support model مثبت.

# القسم الثاني عشر — Discounts, Coupons and Credits

## 70. Discount Definition

تحدد:

- percentage/fixed.
- applicable plans/prices.
- recurring periods أوone-time.
- max redemptions.
- customer/tenant eligibility.
- stacking rule.
- effective period.

## 71. Coupon Redemption

- Idempotent.
- Reservation إذاCheckout طويل.
- Redemption لا تتجاوزlimit.
- Expired/revoked coupon لا تستخدم.

## 72. Stacking

Baseline: لاStacking إلاإذاPolicy صريحة تحددالترتيب.

## 73. Credits

مصادر:

- Service credit.
- Billing correction.
- Referral/promotion.
- Manual commercial credit.
- Overpayment.

Credit ledger لا يعدلInvoice الأصلية.

## 74. Credit Expiry

- Effective/expiry policy صريحة.
- Legal restrictions قدتمنعexpiry لبعضالأنواع.
- Expiry entry موثقة، لا حذفالرصيد.

# القسم الثالث عشر — Taxes and Legal Documents

## 75. Tax Boundary

Core Billing يحفظ:

- tax jurisdiction reference.
- tax behavior: inclusive/exclusive/exempt.
- tax ID snapshots.
- calculated tax lines.
- provider/adapter evidence.

Exact statutory rules تضافعبرCountry fiscal/tax adapter.

## 76. Invoice Numbering

- Scope واضح حسبLegal entity/document type/fiscal period.
- Number لا يعاداستخدامه.
- Void يحتفظبالرقم.
- Provider invoice number لا يستبدلInternal document identity.

## 77. Legal Entity Snapshot

Issued subscription invoice تحفظبياناتATHR seller والعميل القانونية وقتالإصدار.

# القسم الرابع عشر — Cancellation and Reactivation

## 78. Cancellation Types

- At period end baseline.
- Immediate withcredit/refund policy.
- Immediate forsecurity/fraud/contract breach.
- Non-renewal aftertrial.

## 79. Cancellation Request

تحفظ:

- requested/effective time.
- actor.
- reason code.
- retention/export consequences.
- credit/refund preview.
- approval where required.

## 80. At-period-end Baseline

- Entitlements تستمرحتىperiod end.
- Renewal لا تصدر.
- يمكنUndo قبلcutoff إذاPolicy تسمح.

## 81. Immediate Cancellation

- لا تحذفالبيانات.
- Access mode ينتقلوفقسببالإنهاء.
- Unused service credit/refund حسبCommercial/legal policy.

## 82. Reactivation

- ليستمجردتغييرstatus.
- تتحققمنPlan availability, price, outstanding invoices, tenant state andpayment method.
- قدتنشئSubscription جديدة إذاالقديمةأنهتنهائيًا.

# القسم الخامس عشر — Refunds and Adjustments

## 83. Subscription Refund

منفصلةعنRetail refund داخلTenant.

- ترتبطCollection/Invoice allocation.
- لا تتجاوزالمبلغالقابلللرد.
- Provider outcome unknown مدعوم.
- Credit note/refund document حسبTax/legal policy.

## 84. Service Credit vs Cash Refund

- Service credit يبقىLiability داخلBilling ledger.
- Cash refund عمليةProvider/collection خارجية.
- لا يتمتحويلأحدهما للآخرضمنيًا.

## 85. Manual Adjustment

- Permission +Step-up +Approval حسبالقيمة.
- Reason andevidence.
- Immutable entry.
- لا تعديلInvoice line بعدالإصدار.

# القسم السادس عشر — Revenue Metrics

## 86. MRR

**Metric key:** `billing.mrr`

Monthly normalized recurring committed amount:

- يشملRecurring subscription charges النشطة.
- Annual recurring amount يقسمعلى12.
- Custom interval يطبعNormalized monthly factor معلن.
- يستبعدTax, one-time fees, usage overage غيرمتكرر, refunds غيرrecurring, trial/demo/complimentary.
- Discounts recurring تخصمخلالفترتها.
- Group bycurrency baseline؛ لا تجمععملاتمختلفة دونExchange-rate policy.

## 87. ARR

```
ARR = MRR × 12
```

هوRun-rate metric، وليسInvoice cash collected.

## 88. New MRR

MRR منTenants أصبحتPaid active لأولمرة فيالفترة.

## 89. Expansion MRR

زيادةRecurring MRR منUpgrade/add-on/quantity expansion للـexisting paid tenants.

## 90. Contraction MRR

انخفاضRecurring MRR منDowngrade أوخصممتكرر، دونFull churn.

## 91. Churned MRR

MRR المفقودة منSubscriptions انتهت/لغيتولم تعدنشطة.

## 92. Reactivation MRR

MRR عادتمنSubscription كانتChurned ثمفعّلت مجددًا وفقWindow/definition.

## 93. Logo Churn

```
Paid tenants churned during period
÷ Paid tenants active at period start
```

Exact exclusions للـtrial/demo/mergers موثقة.

## 94. MRR Churn Rate

```
Churned MRR
÷ Beginning MRR
```

Gross Revenue Churn وNet Revenue Retention metrics منفصلة.

## 95. Collections vs Revenue

تقاريرمنفصلة:

- Invoiced recurring amount.
- Collected cash.
- Recognized service revenue مستقبلًا إذاAccounting model اعتمد.
- MRR/ARR run-rate.

لا تستخدمCollected cash كـMRR.

# القسم السابع عشر — Reporting and Reconciliation

## 96. Required Billing Reports

- Subscription state andplan mix.
- Renewal calendar.
- Invoices andoutstanding balances.
- Collection attempts andunknown outcomes.
- Dunning/grace/read-only/suspended tenants.
- MRR bridge: beginning +new +expansion -contraction -churn +reactivation.
- Usage vslimits.
- Trial conversion.
- Credits/refunds.
- Provider reconciliation.

## 97. Reconciliation

- Internal invoices ↔collection allocations.
- Collection attempts ↔provider evidence.
- Provider settlements ↔collected ledger.
- Entitlement snapshot ↔subscription/plan/overrides.
- Usage aggregates ↔source events.

## 98. Revenue Lineage

كلMetric تحفظ/source drill-through إلىSubscription, invoice lines, changes andcollection evidence.

# القسم الثامن عشر — Security and Permissions

## 99. Permission Keys

- `billing.plan.read`
- `billing.plan.manage`
- `billing.subscription.read`
- `billing.subscription.change`
- `billing.invoice.read`
- `billing.collection.read`
- `billing.collection.retry`
- `billing.credit.issue`
- `billing.refund.create`
- `billing.payment_method.manage`
- `billing.entitlement.override`
- `billing.dunning.manage`
- `billing.revenue.read`
- `billing.provider.configure`

## 100. Step-up and Approvals

تحتاجA2/A3 أوApproval حسبPolicy:

- Mark paid manually.
- Issue large credit/refund.
- Extend grace.
- Override entitlement.
- Immediate cancellation.
- Change provider configuration.
- Reactivate suspended tenant.

## 101. Tenant Visibility

Tenant owners يرونبياناتهم فقط. Platform finance/support access scoped, time-bound andaudited.

## 102. Secrets

Provider API keys/webhook secrets خارجDomain records، فيSecret manager/environment protected configuration.

# القسم التاسع عشر — Audit

## 103. Audit Actions

- Plan/version published/deprecated.
- Price published/retired.
- Subscription created/activated/changed/cancelled/reactivated.
- Trial/demo/complimentary grant issued/extended/revoked.
- Invoice issued/voided.
- Collection attempted/reconciled.
- Manual payment confirmation.
- Credit/refund issued.
- Dunning/access mode changed.
- Entitlement override.
- Billing contact/payment method changed.
- Provider webhook anomaly.

## 104. Audit Safety

لا تسجل:

- Card data.
- Provider secrets.
- Full webhook raw sensitive payload.
- Unmasked billing contacts بلاسبب.

# القسم العشرون — Error Catalog

## 105. Plan and Price Errors

- `BILLING_PLAN_NOT_FOUND`
- `BILLING_PLAN_VERSION_NOT_PUBLISHED`
- `BILLING_PRICE_NOT_APPLICABLE`
- `BILLING_CURRENCY_NOT_SUPPORTED`
- `BILLING_PRICE_EFFECTIVE_PERIOD_INVALID`

## 106. Subscription Errors

- `SUBSCRIPTION_INVALID_STATE`
- `SUBSCRIPTION_ALREADY_ACTIVE`
- `SUBSCRIPTION_CHANGE_ALREADY_SCHEDULED`
- `SUBSCRIPTION_PLAN_CHANGE_BLOCKED_BY_USAGE`
- `SUBSCRIPTION_TRIAL_NOT_ELIGIBLE`
- `SUBSCRIPTION_REACTIVATION_NOT_ALLOWED`
- `SUBSCRIPTION_CANCELLATION_NOT_ALLOWED`

## 107. Invoice and Collection Errors

- `BILLING_INVOICE_NOT_FOUND`
- `BILLING_INVOICE_ALREADY_PAID`
- `BILLING_INVOICE_IMMUTABLE`
- `BILLING_AMOUNT_MISMATCH`
- `BILLING_COLLECTION_DECLINED`
- `BILLING_COLLECTION_PROVIDER_UNAVAILABLE`
- `BILLING_COLLECTION_OUTCOME_UNKNOWN`
- `BILLING_COLLECTION_RECONCILIATION_REQUIRED`
- `BILLING_PAYMENT_METHOD_REQUIRED`

## 108. Entitlement and Usage Errors

- `ENTITLEMENT_NOT_AVAILABLE`
- `ENTITLEMENT_LIMIT_REACHED`
- `ENTITLEMENT_OVERRIDE_EXPIRED`
- `USAGE_METER_NOT_FOUND`
- `USAGE_EVENT_DUPLICATE`
- `USAGE_EVENT_OUTSIDE_PERIOD`
- `USAGE_AGGREGATION_INCOMPLETE`

## 109. Retry/Outcome Rules

- Validation/state: no_effect, user action.
- Provider unavailable beforeacceptance: same idempotency key afterdelay.
- Timeout afterpossibleacceptance: unknown, poll/reconcile.
- Declined: no_effect, updatepayment method.
- Entitlement limit: no blind retry untilusage/plan changes.

# القسم الحادي والعشرون — Failure and Recovery

## 110. Invoice Generation Failure

- Subscription state لا تتقدمكأنInvoice صدرت.
- Same period generation retries idempotently.
- Partial draft تنظيف/reuse deterministically.

## 111. Response Lost After Collection

- Retry same idempotency key.
- Query operation/provider.
- لا Attempt ماليةجديدة حتىoutcome واضحة.

## 112. Webhook Missing

- Scheduled reconciliation retrievesprovider state.
- Webhook ليستالمسارالوحيد للحقيقة.

## 113. Duplicate Webhook

Inbox/provider receipt dedupe، no duplicate allocations.

## 114. Entitlement Projection Lag

- Subscription change committed أولًا.
- Entitlement generation retried.
- Access decision تستخدمlatest durable snapshot/version، وتعرضpending activation إذالا يمكنضمانالجديد.
- لا تمنحFeature عاليةقبلSnapshot سليمة.

## 115. Infrastructure Upgrade Failure after First Customer

- Paid subscription تبقىحقيقةمالية.
- Operational alert/escalation.
- Do not silently downgrade customer.
- Capacity safeguard may blocknew onboarding whilepreservingexisting service.

# القسم الثاني والعشرون — Testing Contract

## 116. Plan and Price Tests

- Published immutability.
- Effective periods.
- Currency applicability.
- Deprecated version renewal behavior.
- No silent price change.

## 117. Lifecycle Tests

- Draft→Trial/Active.
- Trial expiry/conversion.
- Renewal success/failure.
- PastDue→Grace→ReadOnly→Suspended.
- Recovery toActive.
- At-period-end cancellation.
- Reactivation.

## 118. Proration Tests

- Mid-period upgrade.
- Month-end anchor.
- Annual plan.
- Rounding.
- Preview equalsinvoice.
- Retry idempotency.

## 119. Collection Tests

- Success.
- Hard decline.
- Temporary failure.
- Timeout/outcome unknown.
- Duplicate webhook.
- Out-of-order webhook.
- Manual bank transfer confirmation.
- Partial payment.
- Refund/credit ceilings.

## 120. Entitlement Tests

- Permission withoutentitlement denied.
- Entitlement withoutpermission denied.
- Hard/soft limits.
- Downgrade belowcurrentusage.
- Override expiry.
- Access mode restriction.
- Offline lease blocked inReadOnly.

## 121. Usage Tests

- Duplicate event.
- Late event.
- Correction event.
- Period boundary.
- Sum/max/end-period meters.
- Invoice finalization.

## 122. Metrics Tests

- Monthly/annual MRR normalization.
- Recurring discount.
- Trial/demo excluded.
- New/Expansion/Contraction/Churn/Reactivation bridge.
- Multi-currency grouping.
- Tax/one-time excluded.

## 123. Tenant and Security Tests

- Cross-tenant access denied.
- Manual mark-paid step-up/audit.
- Secret masking.
- Support grant scope.
- Webhook signature/replay.

## 124. Migration and Demo Tests

- Existing demo tenant classification.
- Transition toPaid subscription.
- No loss ofoperational data.
- Entitlements switch fromdemo grant topaid plan.
- Infrastructure upgrade checklist event emitted once.

# القسم الثالث والعشرون — Open Decisions

## 125. OD-BILL-001 — Initial public plans

**Baseline:** لا نثبتأسماءأوأسعارنهائية الآن. Plan catalog versioned وتحددقبلأولبيع.

## 126. OD-BILL-002 — Billing provider

**Baseline:** Provider abstraction. العميلالأول يمكنManual invoice/bank transfer؛ اختيارProvider لاحق.

## 127. OD-BILL-003 — Billing currency

**Baseline:** Price/Subscription currency ثابتةخلالperiod. Multi-currency aggregation group-by أولًا.

## 128. OD-BILL-004 — Trial duration

**Baseline:** Configurable pertrial policy؛ لاHard-coded global duration.

## 129. OD-BILL-005 — Grace and Dunning durations

**Baseline:** Versioned policy. القيمالنهائية تجارية/قانونية قبلالإطلاق.

## 130. OD-BILL-006 — Upgrade/downgrade timing

**Baseline:** Upgrade immediate withpreviewed proration؛ downgrade nextperiod.

## 131. OD-BILL-007 — Usage overages

**Baseline:** Measure authoritatively، لكنcharge overage مؤجل. Hard/soft limits أولًا.

## 132. OD-BILL-008 — Tax engine

**Baseline:** Adapter boundary؛ لاCountry-specific logic فيCore.

## 133. OD-BILL-009 — Revenue recognition

**Baseline:** Invoicing/collections/MRR فقط. Accounting revenue recognition خارجالنطاق.

## 134. OD-BILL-010 — Complimentary access

**Baseline:** Time-bounded approved grant، لاPermanent hidden override.

## 135. OD-BILL-011 — Free plan

**Baseline:** لاPublic free plan. Internal demo وTrial فقطحتىقرارلاحق.

## 136. OD-BILL-012 — Infrastructure upgrade trigger

**Baseline:** First paid activation emitsoperational milestone/checklist once؛ لا يكونpart ofbilling transaction.

# القسم الرابع والعشرون — Prohibited Patterns

## 137. أنماطممنوعة

- تعديلPublished plan/price بدلVersion جديدة.
- استخدامPlan name فيDomain condition.
- Entitlement تمنحPermission.
- Mark paid دونEvidence/Audit.
- Blind retry بعدProvider timeout.
- Subscription Active بمجردإنشاءCheckout.
- Invoice issued قابلةللتعديل.
- Hard delete عندCancellation/PastDue.
- إزالةResources تلقائيًا عندDowngrade.
- MRR تشملTax أوone-time fees أوTrial/Demo.
- جمعMRR متعددةالعملات بلاConversion policy.
- Usage billing منApproximate dashboard metrics.
- Provider webhook status يكتبSubscription مباشرة.
- Free/unlimited hidden flags بلاGrant version.
- Grace period بلاExpiry.
- Paid infrastructure requirement قبلأولعميل كمانع للتطوير.
- تشغيلخدمةمدفوعة تلقائيًا دونقرارCommercial/Operational.
- خلطRetail sales revenue معATHR SaaS revenue.

# القسم الخامس والعشرون — Implementation Readiness

## 138. Ready after Shared Foundation

- Plan/price/subscription contracts.
- Entitlement key registry andsnapshot resolution.
- Internal demo classification/grant.
- Billing API/error contracts.

## 139. Ready before Provider Selection

- Manual invoice andbank-transfer evidence workflow.
- Subscription lifecycle.
- Entitlements/access modes.
- MRR definitions.
- Provider adapter interfaces.

## 140. Deferred

- Specific provider SDK/webhooks.
- Country tax/e-invoice adapter.
- Usage overage pricing.
- Accounting revenue recognition.
- Final public plan names/prices.

# القسم السادس والعشرون — Acceptance Gate

## 141. بوابةالاعتماد

لا يعتبرBilling Model مكتملًا قبل:

1. فصلPlatform billing عنTenant retail transactions.
2. تثبيتPlan/Price versioning.
3. تثبيتSubscription lifecycle.
4. تثبيتbilling periods/renewal.
5. تثبيتupgrade/downgrade/proration.
6. تثبيتtrial/demo/first-paid transition.
7. تثبيتinvoice/credit/collection models.
8. تثبيتprovider outcome unknown/reconciliation.
9. تثبيتdunning/grace/read-only/suspension.
10. تثبيتentitlement resolution والفرقعنPermission.
11. تثبيتusage metering contract.
12. تثبيتdiscounts/credits/refunds.
13. تثبيتMRR/ARR/churn definitions.
14. تثبيتsecurity/audit/errors/recovery.
15. تثبيتtests وopen decisions وprohibited patterns.

## 142. القرار التخطيطي الحالي

- Internal demo لا تدخلMRR ولا تحتاجPaid infrastructure.
- لاPublic free plan baseline.
- أولعميل يمكنتحصيلهManual invoice/bank transfer بأدلةوموافقة.
- Provider abstraction تمنعربطCore بمزودواحد.
- Upgrade immediate معProration؛ Downgrade nextperiod.
- Subscription access progresses PastDue→Grace→ReadOnly→Suspended.
- Entitlements snapshots versioned ولا تمنحPermissions.
- Usage measured authoritatively، والـoverage charging مؤجل.
- MRR تستبعدTax/one-time/trial/demo وتحسبpercurrency.
- أولPaid activation تطلقInfrastructure upgrade milestone مستقلة.

## 143. المرحلة التالية

**ATHR Notification Contract v1.0**

سيثبت:

- Notification intents andownership.
- Channels: In-app, Email, SMS, WhatsApp, Push.
- Recipient resolution.
- Templates andlocalization.
- Preferences, consent andquiet hours.
- Transactional vsmarketing separation.
- Delivery attempts, retries andprovider normalization.
- Deduplication andrate limits.
- Sensitive data andsecure links.
- Escalation andfallback channels.
- Document delivery.
- Webhook notifications.
- Audit, retention, errors andtesting.

بعده تبدأوثائق **Multi-tenancy and Security**.