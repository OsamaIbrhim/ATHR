# ATHR Domain Model v1.0

**Planning Baseline — Bounded Contexts, Aggregate Ownership and Transaction Boundaries**

## 1. وظيفة الوثيقة

تحول هذه الوثيقة Business Rules المعتمدة إلى نموذج Domain منطقي يحدد:

- Bounded Contexts.
- Aggregate Roots.
- Entities وValue Objects.
- Ownership boundaries.
- Aggregate invariants.
- Transaction boundaries.
- Domain services.
- Ledgers والمصادر السلطوية للحقيقة.
- Cross-context references.
- Domain events وIntegration boundaries.
- Read models.
- Consistency model.
- Offline ownership وحدود المزامنة.

هذه ليست Database schema، وليست API contract، وليست Package structure. قد تتحول بعض العناصر لاحقًا إلى جداول أوStreams أوDocuments أوRead models، لكن ذلك يحسم في Database Blueprint وEngineering Design.

## 2. قواعد النمذجة العامة

### DM-GEN-001 — Tenant boundary في كل Aggregate تشغيلي

كل Aggregate مملوكة لTenant تحمل TenantId صريحًا أوتوجد داخل Storage boundary تضمنه. لا يقبل أي Cross-tenant reference تشغيلي.

### DM-GEN-002 — Aggregate Root هي بوابة التعديل الوحيدة

لا يعدل Entity داخل Aggregate من خارج Root، ولا يكتب Context مباشرة في Aggregate يملكها Context آخر.

### DM-GEN-003 — المعاملة المحلية قصيرة

الـTransaction الواحدة تحفظ Aggregate واحدة افتراضيًا. تعديل أكثر من Aggregate يتم عبر Workflow/Saga وأحداث، إلا إذا ثبت أنها داخل Consistency boundary واحدة صغيرة ومملوكة لنفس Context.

### DM-GEN-004 — لا Distributed Transaction بين Contexts

التكامل يعتمد:

- Idempotent commands.
- Domain events.
- Transactional outbox.
- Inbox/deduplication.
- Reconciliation.
- Compensating actions.

### DM-GEN-005 — References عبر ID وSnapshot

الـAggregate تحتفظ بـID للكيان الخارجي، وبـSnapshot عند الحاجة التاريخية. لا تعتمد على Join حي كي تظل صحيحة.

### DM-GEN-006 — Ledger هي المصدر السلطوي للأرصدة

الأرصدة المشتقة لا تعدل مباشرة. تشمل Ledgers الأساسية:

- Inventory Movement Ledger.
- Payment Ledger.
- Cash Drawer Movement Ledger.
- Customer Receivable Ledger.
- Store Credit Ledger.
- Loyalty Points Ledger.
- Subscription Billing Ledger.

### DM-GEN-007 — الأحداث حقائق ماضية

Domain Event تصف ما حدث داخل Domain بصيغة ماضية، وليست طلبًا. الأمر المطلوب يمثله Command.

### DM-GEN-008 — Domain Event ليست Integration Event تلقائيًا

يحول Context الأحداث الداخلية إلى Contract خارجي مستقر، مع Version وPrivacy filtering.

### DM-GEN-009 — التاريخ لا يعاد كتابته

كل Snapshot أوLedger entry أوDocument مكتمل Immutable. التصحيح يتم بVersion جديدة أوCompensating record أوCorrection aggregate.

### DM-GEN-010 — الزمن ثلاثي عند الحاجة

يفرق النموذج بين:

- OccurredAt: وقت الواقعة التجارية.
- RecordedAt: وقت تسجيلها بالنظام.
- EffectiveAt: وقت بدء سريان قرار أوPolicy.

### DM-GEN-011 — Money وQuantity ليست أرقامًا عارية

تستخدم Value Objects تحمل Currency أوUOM وPrecision وRounding policy.

### DM-GEN-012 — الحالة ليست Boolean عام

العمليات المركبة تستخدم State machines معلنة؛ `isActive` لا يستبدل Lifecycle حقيقية.

### DM-GEN-013 — External identifiers غير موثوقة منفردة

Provider IDs وExternal references وBarcodes وEmails لا تستبدل Internal IDs.

### DM-GEN-014 — كل Command حساس يحمل Context

يشمل عند الحاجة:

- TenantId.
- ActorId/MembershipId.
- LocationId.
- TerminalId.
- ShiftId.
- IdempotencyKey.
- ExpectedVersion.
- CorrelationId/CausationId.

### DM-GEN-015 — Read Models ليست Aggregates

Dashboard وSearch index وقوائم POS وReports projections قابلة لإعادة البناء ولا تملك Invariants تشغيلية.

## 3. Shared Kernel المحدود

يسمح Shared Kernel صغير فقط للقيم غير التجارية المتنازع عليها:

- TenantId وTyped IDs.
- Money.
- CurrencyCode.
- Quantity.
- UnitOfMeasureId.
- Percentage/Rate.
- DateRange/EffectivePeriod.
- EmailAddress وPhoneNumber normalized.
- PostalAddress.
- TimezoneId.
- Locale.
- DocumentNumber.
- IdempotencyKey.
- CorrelationId/CausationId.
- Version/Revision.
- AuditActor reference.
- Result/Error primitives دون Business semantics.

لا يوضع في Shared Kernel:

- Sale status.
- Payment status.
- Inventory movement type.
- Subscription state.
- Permission rules.
- Tax logic.
- Promotion evaluation.

## 4. خريطة الـBounded Contexts

1. **Platform Identity & Authentication**
2. **Tenant Organization & Membership**
3. **Authorization Policy**
4. **Device, Terminal & Offline Trust**
5. **Product Catalog**
6. **Pricing, Tax & Promotions**
7. **Sales**
8. **Payments**
9. **Inventory & Transfers**
10. **Purchasing & Supplier Operations**
11. **Returns, Refunds & Exchanges**
12. **Customer, Receivables, Store Credit & Loyalty**
13. **Shift & Cash Operations**
14. **Documents, Notifications & Delivery**
15. **Reporting, Audit, Retention & Compliance**
16. **SaaS Billing, Subscription & Entitlements**

### 4.1 سياق المزامنة

`Sync & Offline` ليس مالكًا للحقائق التجارية. هو Integration/Application context ينسق Commands وEvents وSnapshots بين Device والـContexts المالكة.

### 4.2 Context Map

```
Platform Identity
  -> Tenant Membership
  -> Authorization Policy

Tenant Organization
  -> Location/Warehouse/Terminal scopes
  -> جميع Contexts التشغيلية

Product Catalog
  -> Pricing/Tax/Promotions
  -> Sales
  -> Inventory
  -> Purchasing

Pricing/Tax/Promotions
  -> Sales calculation snapshot
  -> Returns valuation snapshot

Sales
  -> Payments
  -> Inventory consumption request
  -> Customer activity
  -> Documents
  -> Reporting

Payments
  -> Refunds
  -> Shift/Cash Operations
  -> Documents
  -> Reporting

Inventory
  <- Sales, Returns, Purchasing, Transfers, Counts
  -> Reporting

Purchasing
  -> Inventory receipts
  -> Supplier liability references
  -> Documents

Returns/Refunds/Exchanges
  -> Inventory disposition
  -> Payments refund
  -> Customer Store Credit
  -> Sales for exchange replacement

Shift/Cash Operations
  <- Cash payment/refund movements
  -> Documents and Reports

Billing/Entitlements
  -> Tenant access mode and capability decisions
  -X-> لا تكتب في بيانات التشغيل التجارية

Documents/Notifications
  <- جميع Contexts عبر Snapshots/Events

Reporting/Audit/Retention
  <- Integration events and immutable source records
```

## 5. Context 1 — Platform Identity & Authentication

### الهدف

امتلاك هوية الشخص العالمية ووسائل المصادقة والجلسات الأمنية، دون امتلاك عضويته أوصلاحياته داخل Tenant.

### Aggregate Roots

#### PlatformIdentity

**Entities:**

- AuthenticationMethod.
- VerifiedContactMethod.
- RecoveryMethod.
- SecurityFactor.

**Value Objects:**

- IdentityStatus.
- EmailAddress.
- PhoneNumber.
- PasswordCredentialMetadata.
- MFAFactorDescriptor.
- RiskFlag.

**Invariants:**

- الهوية عالمية وليست مكررة لكل Tenant.
- تعطيل هوية المنصة يمنع كل Sessions، لكنه لا يحذف Membership history.
- وسائل Recovery لا تصبح Verified دون Proof.
- Credential secrets لا تظهر في Domain events.

#### AuthenticationSession

**Entities:**

- SessionGrant.
- RefreshTokenFamily metadata.

**Invariants:**

- Session مرتبطة بهوية وجهاز/Client context.
- Revocation وexpiry مستقلان عن Membership.
- Session لا تحمل صلاحية أوسع من آخر Authorization evaluation.

#### SecurityChallenge

يمثل MFA أوPassword reset أوStep-up challenge بحالة وانتهاء ومحاولات محدودة.

### Domain Services

- IdentityUniquenessService.
- AuthenticationRiskService.
- CredentialRotationPolicy.

### أحداث رئيسية

- PlatformIdentityCreated.
- ContactMethodVerified.
- AuthenticationMethodAdded.
- IdentitySuspended.
- SessionIssued.
- SessionRevoked.
- SecurityChallengeCompleted.

### خارج الملكية

- Roles.
- Location access.
- Tenant invitation.
- POS cashier shift.

## 6. Context 2 — Tenant Organization & Membership

### الهدف

امتلاك Tenant والهيكل التنظيمي والكيانات القانونية والفروع والمخازن والعضويات والدعوات.

### Aggregate Roots

#### Tenant

**Entities:**

- TenantProfile.
- TenantPolicyReference.

**Value Objects:**

- TenantStatus.
- TenantAccessMode.
- BusinessName.
- DefaultLocale.
- ReportingTimezone.

**Invariants:**

- Tenant هي أعلى Data ownership boundary.
- الإغلاق لا يحذف البيانات فورًا.
- لا توجد عمليات تشغيلية جديدة في Closed state.
- تغيير AccessMode لا يعدل التاريخ.

#### LegalEntity

**Entities:**

- LegalRegistration.
- FiscalIdentity reference.
- RegisteredAddress.

**Invariants:**

- Legal Entity مملوكة لـTenant واحد.
- المستندات تشير Snapshot منها.
- لا تعاد كتابة هويتها على مستندات سابقة.

#### Location

**Entities:**

- LocationAddress.
- OperatingTimezone.
- LocationCapability.

**Value Objects:**

- LocationStatus.
- BusinessDayPolicy reference.

**Invariants:**

- Location لا تنتقل بين Tenants.
- إغلاقها لا يحذف Warehouses أوDocuments.
- Default warehouse يجب أن تكون داخل نفس Tenant ونطاق Location المسموح.

#### Warehouse

**Value Objects:** WarehouseType, WarehouseStatus.

**Invariants:**

- Warehouse مملوكة لـTenant وترتبط بـLocation أوتكون مركزية صراحة.
- لا تستخدم Warehouse مغلقة لحركات جديدة إلا Recovery مصرح.

#### Membership

**Entities:**

- RoleAssignment reference.
- ScopeAssignment.
- Employment/Operator metadata غير HR.

**Value Objects:**

- MembershipStatus.
- AccessScope.
- EffectivePeriod.

**Invariants:**

- Membership تربط PlatformIdentity بـTenant.
- نفس الهوية يمكن أن تملك عدة Memberships مستقلة.
- لا معنى لـScope فارغة كTenant-wide.
- آخر Owner لا يعطل أوينقل دون تعيين بديل.
- التعطيل لا يحذف Audit أوعمليات المستخدم.

#### TenantInvitation

**Invariants:**

- دعوة مرتبطة بـTenant وRole/Scope المقترحة وExpiry.
- القبول Idempotent.
- الدعوة لا تصبح Membership فعالة إذا تغيرت أهلية Tenant أوألغيت.

### Domain Services

- OwnershipTransferService.
- MembershipEligibilityService.
- OrganizationalScopeResolver.

### أحداث رئيسية

- TenantCreated.
- TenantAccessModeChanged.
- LegalEntityRegistered.
- LocationOpened/Closed.
- WarehouseCreated/Closed.
- MembershipInvited/Activated/Suspended.
- TenantOwnershipTransferred.

## 7. Context 3 — Authorization Policy

### الهدف

امتلاك تعريف Permissions وRoles وPolicy evaluation، دون امتلاك المستخدم أوالبيانات التجارية.

### Aggregate Roots

#### RoleDefinition

**Entities:** PermissionGrant, PermissionConstraint.

**Invariants:**

- Role مملوكة لـTenant أوPlatform template versioned.
- Role لا تمنح Scope بيانات بذاتها إلا إذا نصت Policy صراحة.
- تعديل Role لا يعيد كتابة Audit قديمة.

#### AccessPolicy

يمثل Policy versioned قد تعتمد Actor، Permission، Resource scope، Context، Approval، Entitlement.

#### ApprovalPolicy

**Entities:** ApprovalLevel, ThresholdRule, EligibleApproverRule.

**Invariants:**

- مقدم الطلب لا يعتمد نفسه حيث تفرض Separation of Duties.
- Approval مربوطة بـCommand payload hash/version.
- تغير الطلب بعد الاعتماد يبطل Approval.

### Domain Services

- AuthorizationDecisionService.
- ScopeIntersectionService.
- ApprovalRequirementService.

### Value Objects

- PermissionKey.
- ResourceScope.
- DecisionReason.
- PolicyVersion.
- ApprovalRequirement.

### أحداث

- RoleDefined/Changed/Archived.
- PermissionGranted/Revoked.
- ApprovalPolicyChanged.
- ApprovalRequested/Granted/Rejected/Expired.

## 8. Context 4 — Device, Terminal & Offline Trust

### الهدف

امتلاك الأجهزة المسجلة والثقة والـTerminal configuration وOffline leases، لا امتلاك Sales أوShift نفسها.

### Aggregate Roots

#### RegisteredDevice

**Entities:** DeviceCredential, DeviceKeyVersion, AttestationRecord.

**Value Objects:** DeviceStatus, DeviceFingerprint, TrustLevel.

**Invariants:**

- Device مملوكة لـTenant.
- Credential rotation لا تغير Device identity.
- Revoked device لا تحصل على Leases جديدة.
- الأسرار لا تزامن كنص صريح.

#### Terminal

**Entities:** PeripheralBinding, PrinterBinding, CashDrawerBinding.

**Value Objects:** TerminalStatus, TerminalCapabilitySet, LocationAssignment.

**Invariants:**

- Terminal مرتبطة بـLocation واحدة فعالة في اللحظة.
- نقلها بين Locations عملية مدققة وتبطل Offline scope القديمة.
- Printer أوDrawer assignment لا يغير ملكية المستند أوShift.

#### OfflineAuthorizationLease

**Invariants:**

- مرتبطة بـDevice وMembership وTenant وScope وEntitlement version.
- لها Expiry وIssuedAt وRevocation version.
- لا تمنح صلاحيات أوسع من Online decision.
- لا تمدد نفسها محليًا.

#### SyncCursorRegistration

يمتلك Metadata الخاصة بStreams التي استلمها Device، دون امتلاك الـBusiness events.

### Domain Services

- DeviceEnrollmentService.
- OfflineLeaseIssuer.
- TerminalScopeResolver.

### أحداث

- DeviceEnrolled/Revoked.
- DeviceKeyRotated.
- TerminalActivated/Reassigned/Retired.
- OfflineLeaseIssued/Expired/Revoked.

## 9. Context 5 — Product Catalog

### الهدف

امتلاك Product identity وVariants وSKU وBarcode وUOM وClassification وAssortment.

### Aggregate Roots

#### Product

**Entities:**

- Variant.
- ProductTranslation.
- ProductAttributeSelection.
- ProductMediaReference.

**Value Objects:**

- ProductType.
- ProductLifecycleStatus.
- ProductName.
- ProductDescription.
- TaxCategoryReference.
- TrackingPolicy.

**Invariants:**

- Product لها Variant واحدة على الأقل.
- Variant combination فريدة داخل Product.
- Product/Variant IDs لا يعاد استخدامها.
- تغيير Type بعد معاملات يخضع Migration ولا تعديل مباشر.
- Archive لا تمحو التاريخ.

#### CatalogIdentifierRegistry

يمتلك Uniqueness وحجز:

- SKU.
- Barcode.
- Identifier aliases.

**Invariants:**

- SKU فريدة داخل Tenant normalized.
- Barcode لا تشير لأكثر من Variant/بيع وحدة نشطة.
- المعرف المتقاعد لا يعاد استخدامه وفق retention/offline policy.

#### UnitDefinition

**Entities:** UnitConversionVersion.

**Invariants:**

- Conversion factor موجبة.
- Base UOM واحدة للVariant المخزنية.
- تغيير Conversion Versioned.
- Precision لا تتجاوز Policy.

#### Category

Hierarchy مستقلة مع منع Cycles.

#### Brand

كيان مستقل قابل للأرشفة.

#### LocationAssortment

يمثل توافر Variants داخل Location.

**Invariants:**

- لا يغير Inventory balance.
- Sellable/Purchasable/Displayable flags مستقلة.
- المرجع Product/Variant من نفس Tenant.

### Domain Services

- VariantCombinationService.
- CatalogIdentifierService.
- UomConversionService.
- AssortmentEligibilityService.

### أحداث

- ProductCreated/Activated/Archived.
- VariantAdded/Discontinued.
- SkuAssigned/Retired.
- BarcodeAssigned/Retired.
- UomConversionVersionCreated.
- AssortmentChanged.

## 10. Context 6 — Pricing, Tax & Promotions

### الهدف

امتلاك قواعد اختيار السعر والضريبة والعروض وإنتاج Calculation evidence، دون امتلاك Sale.

### Aggregate Roots

#### PriceBook

**Entities:** PriceEntry, QuantityTier.

**Value Objects:** PriceBookScope, EffectivePeriod, PricePriority, Money.

**Invariants:**

- عملة واحدة لكل Price Book.
- Entries المتعارضة بنفس النطاق والأولوية ممنوعة أوتحسم صراحة.
- تعديل السعر ينشئ Version/Entry جديدة.

#### TaxCode

**Entities:** TaxRuleVersion, TaxComponent.

**Invariants:**

- Rate/calculation effective-dated.
- Inclusive/exclusive محددة.
- التغيير لا يعدل المستندات السابقة.

#### Promotion

**Entities:** PromotionVersion, EligibilityCondition, BenefitRule, StackRule, UsageLimit.

**Invariants:**

- النسخة الفعالة Immutable.
- Priority وStackability وReturn allocation إلزامية.
- Benefit لا تنتج Net negative.

#### CouponCampaign

**Entities:** CouponCode, CouponReservation, CouponRedemption.

**Invariants:**

- Redemption Idempotent.
- Limits مركزية.
- Reservation لها Expiry.

### Domain Services

#### PricingEngine

Input:

- Tenant/Location.
- Customer pricing references.
- Variant/UOM/quantity.
- Date/time/channel.

Output:

- SelectedPrice.
- SourceEvidence.
- RejectedCandidates.

#### TaxCalculationService

ينتج TaxSnapshot evidence دون كتابة Sale.

#### PromotionEvaluationService

ينتج BenefitAllocation وRule evidence.

### Value Objects

- PriceCalculationSnapshot.
- TaxCalculationSnapshot.
- DiscountAllocation.
- PromotionEvidence.
- RoundingEvidence.

### أحداث

- PriceBookActivated/Expired.
- PriceEntryScheduled/Ended.
- TaxRuleVersionActivated.
- PromotionScheduled/Activated/Paused/Ended.
- CouponReserved/Redeemed/Released.

## 11. Context 7 — Sales

### الهدف

امتلاك Cart/Sale lifecycle والسطور والحساب النهائي وبيع العميل، دون امتلاك Payment settlement أوInventory ledger.

### Aggregate Roots

#### Sale

**Entities:**

- SaleLine.
- SaleLineAdjustment.
- SaleDiscountAllocation.
- SaleTaxComponent.
- TenderRequirement reference.

**Value Objects:**

- SaleStatus.
- SaleChannel.
- SaleNumber reference.
- CustomerSnapshot.
- ProductSnapshot.
- PriceSnapshot.
- TaxSnapshot.
- SaleTotals.
- FulfillmentReference.

**Invariants:**

- Sale مملوكة لـTenant وLocation.
- Line quantity موجبة في Sale العادية.
- الأسعار والضرائب والخصومات متوازنة مع Totals.
- Completion لا تتم قبل Payment policy المطلوبة.
- Completed Sale Immutable.
- Retry completion لا ينشئ Sale ثانية.
- Manual overrides تحفظ Actor/Reason/Approval.

#### SuspendedSale

قد تكون حالة داخل Sale أوAggregate منفصلة إذا كانت دورة حياة طويلة. القرار المبدئي: حالة داخل Sale ما دامت لا تشارك Concurrent editing.

#### SaleNumberReservation

Aggregate صغيرة لإدارة Number uniqueness/gaps، منفصلة عن Sale transaction عند الحاجة القانونية/offline.

### Domain Services

- SaleCalculationOrchestrator.
- SaleCompletionPolicy.
- SaleNumberingService.
- SaleEligibilityService.

### Commands

- StartSale.
- Add/Change/RemoveLine.
- AttachCustomerSnapshot.
- ApplyPriceOverride.
- ApplyManualDiscount.
- RequestPayment.
- ConfirmPaymentSatisfied.
- CompleteSale.
- Suspend/Resume/CancelSale.

### أحداث

- SaleStarted.
- SaleLineAdded/Changed/Removed.
- SalePriced.
- PaymentRequested.
- SalePaymentSatisfied.
- SaleCompleted.
- SaleSuspended/Cancelled.

### Transaction Boundary

- كل تعديل Cart/Sale داخل Sale Aggregate.
- Payment وInventory effects ليست داخل نفس Transaction.
- Completion تنتج أحداثًا لPayment confirmation already received، Inventory consumption، Documents، Customer activity.

## 12. Context 8 — Payments

### الهدف

امتلاك Payment intents/attempts/transactions والتسوية والـProvider reconciliation، مستقلًا عن Sale وShift.

### Aggregate Roots

#### Payment

**Entities:**

- PaymentAttempt.
- PaymentAllocation.
- ProviderReference.
- PaymentReversal.

**Value Objects:**

- PaymentStatus.
- TenderType.
- PaymentMethodSnapshot.
- Amount.
- ProviderOutcome.

**Invariants:**

- Payment amount موجبة.
- Allocation لا تتجاوز Captured/settled amount.
- Provider request Idempotent.
- Unknown outcome لا يعاد كفشل أوينفذ مرة ثانية بلا reconciliation.
- Refund لا تعدل Payment الأصلية؛ تنشئ Refund transaction مرتبطة.

#### PaymentMethodConfiguration

يمتلك طرق الدفع المتاحة ونطاق Location/Terminal وCapabilities، دون تخزين أسرار Provider مباشرة في Domain.

#### ProviderReconciliationCase

**Invariants:**

- يربط Attempt بالProvider evidence.
- Resolution لا تخفي الأحداث السابقة.

#### PaymentLedger

يمكن أن يكون Aggregate stream لكل Payment أوLedger partition، والمبدأ أن كل Entry Immutable ومتوازن.

### Domain Services

- PaymentRoutingService.
- TenderEligibilityService.
- ProviderReconciliationService.
- PaymentAllocationService.

### أحداث

- PaymentInitiated.
- PaymentAttemptStarted.
- PaymentAuthorized/Captured/Failed/OutcomeUnknown.
- PaymentAllocated.
- PaymentReconciled.
- PaymentReversed.

### Transaction Boundary

- Provider call خارج Database transaction.
- تسجيل Intent قبل call، ثمتسجيل outcome Idempotently.
- Sale تستهلك PaymentAllocated/PaymentSatisfied event ولا تكتب Payment.

## 13. Context 9 — Inventory & Transfers

### الهدف

امتلاك كل تغير كمي في المخزون والحجوزات والتحويلات والجرد والتسوية.

### Aggregate Roots

#### InventoryItemPosition

يمثل Variant + Warehouse + optional Batch/Serial dimension.

**Entities:**

- StockReservation.
- PositionRestriction.

**Value Objects:**

- StockKey.
- OnHandQuantity derived.
- ReservedQuantity derived.
- AvailableQuantity derived.

**Invariants:**

- الأرصدة مشتقة من Ledger، وليست مدخلًا حرًا.
- Reservation لا تتجاوز Available إلا Override policy.
- Batch/Serial dimension تتوافق مع Tracking policy.

#### InventoryMovement

Aggregate Immutable تمثل حركة واحدة أومجموعة سطور ذرية المصدر.

**Entities:** InventoryMovementLine.

**Value Objects:** MovementType, MovementReason, SourceReference, QuantityDelta.

**Invariants:**

- لكل Line مصدر ووجهة أوطرف واحد حسب النوع.
- مجموع التحويل الداخلي متوازن بين Source/Destination/In-transit stages.
- Idempotency لكل Source event.
- لا تعديل بعد Posting؛ Correction بحركة مقابلة.

#### TransferOrder

**Entities:** TransferLine, Shipment, Receipt, Discrepancy.

**Invariants:**

- Lines تصبح Immutable بعد Approval إلا Revision workflow.
- Shipped لا تتجاوز Approved/remaining.
- Received لا تتجاوز Shipped المقبول دون Discrepancy صريحة.
- Shipment تنقل إلىIn-transit، وReceipt تنقل إلىDestination.
- Duplicate receipt ممنوعة.

#### StockCount

**Entities:** CountScope, CountLine, CountObservation, Recount, CountApproval.

**Invariants:**

- Expected snapshot يثبت وقت Freeze/Count policy.
- Count لا تعدل Stock مباشرة.
- Posting ينتج Adjustment movements بعد Approval.

#### StockReservation

قد تبقى Entity داخل Position أوAggregate مستقلة إذا كانت طويلة/عالية التنافس. القرار المبدئي: Aggregate مستقلة عند تطبيق Transfer/Sale reservations واسعة، لتقليل Hot aggregate.

### Domain Services

- InventoryAvailabilityService.
- ReservationService.
- MovementPostingService.
- TransferFulfillmentService.
- StockReconciliationService.
- CostingService boundary منفصلة داخل Context.

### أحداث

- StockReserved/Released.
- InventoryMovementPosted.
- StockBecameNegative.
- TransferDrafted/Approved/Shipped/PartiallyReceived/Received/Cancelled.
- TransferDiscrepancyRecorded.
- StockCountStarted/Submitted/Approved/Posted.

### Transaction Boundary

- Posting Movement وLedger entries الخاصة بها ذرية داخل Inventory Context.
- Sale/Purchase/Return لا تعدل Position مباشرة؛ تطلب Movement بواسطة Source reference.

## 14. Context 10 — Purchasing & Supplier Operations

### الهدف

امتلاك الموردين وعلاقات الشراء وRequisition/RFQ/PO/Receipt matching وSupplier invoice lifecycle.

### Aggregate Roots

#### Supplier

**Entities:** SupplierContact, SupplierAddress, SupplierProductReference, PaymentTermReference.

**Invariants:**

- Supplier مملوكة لـTenant.
- Supplier SKU منفصلة عن Tenant SKU.
- Archive لا يمحو Purchase history.

#### PurchaseRequisition

**Entities:** RequisitionLine, ApprovalRecord reference.

#### RequestForQuotation

**Entities:** SupplierInvitation, QuoteResponse, QuoteLine.

قد تؤجل من MVP لكن النموذج لا يخلطها بـPO.

#### PurchaseOrder

**Entities:** PurchaseOrderLine, Revision, ApprovalSnapshot.

**Invariants:**

- Approved revision ثابتة.
- PO لا تنشئ Stock أوLiability.
- Received/Invoiced quantities لا تتجاوز القواعد دون Exception.

#### GoodsReceipt

**Entities:** ReceiptLine, InspectionResult, Disposition, ReceiptDiscrepancy.

**Invariants:**

- Receipt مصدر Inventory movement مستقل.
- Accepted/Quarantined/Rejected quantities متوازنة.
- Duplicate receipt source ممنوعة.

#### SupplierInvoice

**Entities:** InvoiceLine, MatchResult, Variance, Approval.

**Invariants:**

- Invoice منفصلة عن PO وReceipt.
- Three-way match evidence محفوظ.
- Liability لا تنشأ من PO وحدها.

#### SupplierReturn

مصدر Inventory outbound، ولا يعدل GoodsReceipt الأصلية.

### Domain Services

- PurchaseOrderApprovalService.
- ThreeWayMatchService.
- ReceiptDispositionService.
- SupplierLiabilityPostingService boundary.

### أحداث

- SupplierCreated/Archived.
- PurchaseOrderApproved/Revised/Cancelled.
- GoodsReceived/Quarantined/Rejected.
- SupplierInvoiceRecorded/Matched/ExceptionRaised/Approved.
- SupplierReturnPosted.

## 15. Context 11 — Returns, Refunds & Exchanges

### الهدف

امتلاك أهلية Return والتفتيش والتقييم المالي والتصرف، وتنسيق Refund/Exchange دون امتلاك Payment أوInventory ledgers.

### Aggregate Roots

#### ReturnRequest

**Entities:** ReturnLineRequest, EvidenceReference, EligibilityDecision.

**Invariants:**

- الكمية المطلوبة لا تتجاوز remaining returnable.
- الارتباط بالSale/Line الأصلية محفوظ.
- No-receipt workflow منفصلة إن فُعلت.

#### Return

**Entities:** ReturnLine, Inspection, DispositionDecision, ValueAllocation.

**Value Objects:** ReturnStatus, ReturnReason, Condition, ReturnValuationSnapshot.

**Invariants:**

- Posted Return Immutable.
- Accepted quantity والتصرف متوازنان.
- Refund eligibility لا تعني Refund completed.
- Product لا يدخل Available تلقائيًا دون Disposition.

#### Refund

يمتلك طلب Refund التجاري وربطه بـPayment refund transactions أوStore Credit issuance.

**Invariants:**

- المبلغ لا يتجاوز remaining refundable.
- Failed refund لا يلغي Return.
- كل محاولة Provider داخل Payments Context وتعود نتيجتها.

#### Exchange

Workflow Aggregate تربط Return + Replacement Sale + Settlement.

**Invariants:**

- لا تدمج الهويات الثلاث.
- Settlement difference متوازن.
- Completion يتطلب الحالات المطلوبة لكل جزء.

#### VoidRequest

Workflow ضيق لتصحيح Sale/Payment في نافذة محددة، لا يمثل Return جزئية.

### Domain Services

- ReturnEligibilityService.
- ReturnValuationService.
- RefundMethodSelectionService.
- ExchangeSettlementService.

### أحداث

- ReturnRequested/Approved/Rejected.
- ReturnedItemsInspected.
- ReturnPosted.
- RefundRequested/Succeeded/Failed/LiabilityCreated.
- ExchangeStarted/Completed.

## 16. Context 12 — Customer, Receivables, Store Credit & Loyalty

### الهدف

امتلاك هوية العميل التشغيلية وConsent وMerge والـCustomer financial/non-cash ledgers.

### Aggregate Roots

#### Customer

**Entities:**

- ContactMethod.
- Address.
- ConsentRecord.
- CustomerIdentifier.
- CustomerAlias.
- BusinessCustomerProfile.

**Value Objects:** CustomerStatus, CustomerType, ConsentPurpose, ConsentChannel.

**Invariants:**

- Customer ليست User أوSupplier.
- Phone ليست unique identity مطلقة.
- Merge لا يتم تلقائيًا بالتشابه.
- Walk-in sale لا تنشئ Customer وهمية.
- Consent Versioned وأقلها سماحًا عند Merge.

#### CustomerMergeCase

**Entities:** DuplicateCandidate, ConflictDecision, AliasMapping.

**Invariants:**

- Survivor واحدة.
- التاريخ لا ينقل بالنسخ؛ يعاد توجيه Alias/References بطريقة قابلة للتتبع.
- Balances لا تدمج دون reconciliation.

#### ReceivableAccount

**Entities:** ReceivableEntry, Allocation, CreditLimitRevision.

**Invariants:**

- Ledger Immutable.
- Balance مشتق.
- Credit sale تحتاج limit/approval effective.
- Allocation لا تتجاوز open amount.

#### StoreCreditAccount

**Entities:** StoreCreditEntry, Reservation, Redemption, Expiry.

**Invariants:**

- منفصلة عن Cash وReceivable وLoyalty.
- لا تصبح سالبة دون policy صريحة.
- Redemption Idempotent وOnline-first.

#### LoyaltyAccount

**Entities:** PointsEntry, PointsReservation, PointsRedemption, ExpiryBucket, TierHistory.

**Invariants:**

- Points Ledger مستقلة عن Store Credit.
- Earning/Redemption references محفوظة.
- Return reversal لا تعدل Entry الأصلية.

### Domain Services

- CustomerDuplicateDetectionService.
- CustomerMergeService.
- CreditEligibilityService.
- StoreCreditIssuanceService.
- LoyaltyCalculationService.

### أحداث

- CustomerCreated/Restricted/Anonymized/Merged.
- ConsentGranted/Withdrawn.
- ReceivablePosted/Settled.
- StoreCreditIssued/Reserved/Redeemed/Expired.
- LoyaltyPointsEarned/Redeemed/Reversed/Expired.

## 17. Context 13 — Shift & Cash Operations

### الهدف

امتلاك Cashier/Register shift وCash Drawer session والعهدة والحركات النقدية والإغلاق والمصالحة.

### Aggregate Roots

#### RegisterShift

**Entities:** ShiftOperatorAssignment, ShiftException.

**Value Objects:** ShiftStatus, BusinessDayReference, TerminalReference.

**Invariants:**

- Shift ليست User session ولاEmployee attendance.
- لا Cash transaction بلا Shift/Drawer session صالحة، إلا Exception policy.
- Offline provisional close لا تصبح Final قبل reconciliation.

#### CashDrawerSession

**Entities:** OpeningFloat, CashCount, DenominationCount, HandoverRecord.

**Invariants:**

- Custodian واحدة افتراضيًا في اللحظة.
- Opening float لا تعدل؛ الفرق بحركة.
- Expected cash مشتق من Ledger.
- Counted cash وExpected snapshot ثابتان عند final close.

#### CashMovement

**Entities:** CashMovementLine عند تعدد العملات أوSources.

**Value Objects:** CashMovementType, ReasonCode, Direction, Amount.

**Invariants:**

- كل حركة لها Source/Actor/Drawer/Shift.
- Exact-once.
- لا generic balance adjustment.

#### CashReconciliation

**Entities:** Discrepancy, Recount, Approval, CorrectionMovementReference.

**Invariants:**

- Over/Short لا تعدل Sales أوPayments.
- Correction بعد close عبر Movement/Reconciliation جديدة.

#### SafeCustodySession

قد تكون Extension لاحقة؛ MVP يدعم SafeDrop/ pickup references مع Ledger منفصل مبسط.

### Domain Services

- ExpectedCashCalculator.
- ShiftClosingPolicy.
- CashLimitPolicy.
- HandoverService.

### أحداث

- ShiftOpened/Suspended/Closing/Closed/Reconciled.
- OpeningFloatPosted.
- CashMovementPosted.
- SafeDropRecorded.
- DrawerCountSubmitted.
- CashDiscrepancyRecorded/Approved.
- DrawerHandedOver.

## 18. Context 14 — Documents, Notifications & Delivery

### الهدف

امتلاك Business document snapshots والـRender/Print/Delivery lifecycles والإشعارات، دون امتلاك الواقعة الأصلية.

### Aggregate Roots

#### BusinessDocument

**Entities:** DocumentLineSnapshot, TaxSnapshot, PaymentReferenceSnapshot, CorrectionLink.

**Value Objects:** DocumentType, DocumentStatus, DocumentNumber, LegalEntitySnapshot, TemplateVersionReference.

**Invariants:**

- Document issued Immutable.
- Source reference واحدة واضحة.
- Reissue/Correction ليست تعديلًا صامتًا.
- Number لا يعاد استخدامها.

#### DocumentNumberSequence

يمتلك uniqueness/reservations/gaps حسب Scope.

#### DocumentRender

**Entities:** RenderArtifact, RenderAttempt.

**Invariants:**

- Render مشتقة.
- Generator/template/version/hash محفوظة.
- Retry لا ينشئ BusinessDocument جديدة.

#### PrintJob

يمتلك Print attempts وحالات الطابعة وReprint classification.

#### Notification

**Entities:** RecipientSnapshot, ChannelAttempt, SuppressionDecision.

**Invariants:**

- Purpose class صريحة.
- نفس Event/Rule/Recipient deduplicated.
- Transactional وMarketing منفصلتان.

#### NotificationRule

Versioned trigger/audience/channel/template/dedup/escalation policy.

#### DeliveryJob

قد يكون جزءًا من Notification، لكن المستندات المباشرة تحتاج Aggregate مستقلة إذا تعددت القنوات والمحاولات. القرار المبدئي: DeliveryJob مستقلة تشير Document أوNotification content.

### Domain Services

- DocumentIssuanceService.
- TemplateSelectionService.
- NotificationAudienceResolver.
- ChannelRoutingService.
- DeliveryRetryPolicy.

### أحداث

- DocumentIssued/Corrected/Voided.
- RenderGenerated/Failed.
- PrintRequested/Succeeded/Failed/Reprinted.
- NotificationCreated/Suppressed.
- DeliveryQueued/Accepted/Delivered/Failed/Bounced/Expired.

## 19. Context 15 — Reporting, Audit, Retention & Compliance

### الهدف

امتلاك تعريفات التقارير والتشغيل والExports والAudit catalog والRetention policies وLegal holds. لا يملك الحقائق التشغيلية الأصلية.

### Aggregate Roots

#### ReportDefinition

**Entities:** MetricDefinition, DimensionDefinition, FilterDefinition, Version.

**Invariants:**

- كل Metric لها Grain وSource وTimezone/Currency/Freshness.
- Version الجديدة لا تغير Snapshot runs القديمة.

#### ReportRun

**Entities:** RunParameterSnapshot, OutputArtifact, RunError.

**Invariants:**

- Scope وRequester محفوظان.
- Partial output لا تعتبر Complete.
- Scheduled execution يعيد Authorization.

#### ReportSchedule

**Entities:** RecipientRule, ScheduleExpression, DeliveryPolicy.

#### ExportJob

**Invariants:**

- Data classes وColumns وScope مسجلة.
- Artifact مؤقتة.
- Download audit.

#### AuditRecord

Append-only record أوStream، مع Actor/Action/Resource/BeforeAfter metadata masked.

#### RetentionPolicy

**Entities:** DataClassRule, RetentionPeriod, EndAction, JurisdictionOverride.

#### LegalHold

**Entities:** HoldScope, Review, ReleaseDecision.

**Invariants:**

- تمنع destruction داخل scope.
- لا تمنح access.
- Release يعيد policy evaluation ولا يحذف فورًا دون Job.

#### DataDispositionJob

يمتلك Archive/Anonymize/Delete execution والخطوات والنتائج وRetries.

### Domain Services

- MetricEvaluationService.
- ReportingScopeService.
- RetentionEvaluationService.
- LegalHoldIntersectionService.
- AnonymizationPlanner.

### أحداث

- ReportDefinitionVersioned.
- ReportRunCompleted/Failed.
- ExportGenerated/Downloaded/Expired.
- RetentionPolicyChanged.
- LegalHoldIssued/Released.
- DataArchived/Anonymized/Deleted/DispositionFailed.

## 20. Context 16 — SaaS Billing, Subscription & Entitlements

### الهدف

امتلاك Commercial plan catalog والSubscription lifecycle والفوترة والتحصيل والاستحقاقات، دون امتلاك Tenant business operations.

### Aggregate Roots

#### Plan

**Entities:** PlanVersion, PlanPrice, IncludedEntitlement, IncludedLimit, AddOnCompatibility.

**Invariants:**

- Plan version المنشورة Immutable.
- الأسعار والعملات والفترات effective-dated.
- حذف Plan مستخدمة ممنوع؛ تؤرشف.

#### Subscription

**Entities:** SubscriptionItem, TrialPeriod, ScheduledChange, CancellationRequest, GracePeriod.

**Value Objects:** SubscriptionStatus, BillingCycle, RenewalPolicy.

**Invariants:**

- Tenant لها Subscription تجارية فعالة واحدة افتراضيًا لكل Product family.
- تغير الخطة لا يعيد كتابة Billing periods الماضية.
- Cancellation وSuspension وTenant closure حقائق مختلفة.

#### BillingAccount

**Entities:** BillingContact, BillingAddress, TaxIdentityReference, PaymentMethodReference.

#### BillingInvoice

**Entities:** BillingInvoiceLine, TaxLine, CreditAllocation.

**Invariants:**

- Invoice المكتملة Immutable.
- Payment failure لا يمحو Invoice.
- Credits/refunds منفصلة.

#### CollectionPayment

يمثل Payment attempts الخاصة باشتراك ATHR، منفصل عن Payments الخاصة بمبيعات Tenant.

#### UsageMeter

**Entities:** UsageRecord, UsageAggregation, Correction.

**Invariants:**

- Usage idempotent.
- Meter definition/version محفوظة.
- Correction لا تمحو record الأصلية.

#### EntitlementSet

**Entities:** FeatureEntitlement, LimitEntitlement, AddOnGrant, TemporaryOverride.

**Invariants:**

- مشتقة من Plan + Add-ons + Overrides + Subscription access mode.
- Versioned وEffective-dated.
- لا تمنح Permission داخل Tenant؛ authorization = permission ∩ scope ∩ entitlement.
- Downgrade لا يحذف البيانات الزائدة.

### Domain Services

- SubscriptionChangeService.
- ProrationService.
- DunningPolicyService.
- EntitlementCompiler.
- LimitDecisionService.

### أحداث

- PlanVersionPublished.
- TrialStarted/Ended.
- SubscriptionActivated/Renewed/Changed/Suspended/Cancelled/Reactivated.
- BillingInvoiceIssued/Paid/Overdue/Credited.
- CollectionPaymentFailed/Succeeded.
- UsageRecorded.
- EntitlementSetCompiled/Activated/Expired.

## 21. Sync & Offline Application Context

### الدور

لا يملك Sale أوPayment أوInventory أوCustomer. يقوم بـ:

- قبول Command envelopes من Device.
- التحقق من Device/Lease/Scope.
- Routing للـContext المالك.
- حفظ ClientOperationId وIdempotency.
- بث Integration events وCatalog snapshots.
- إدارة cursors وconflicts وrejections.

### نماذج رئيسية

#### ClientOperationEnvelope

- ClientOperationId.
- DeviceId.
- TenantId.
- Actor/Membership snapshot.
- OfflineLeaseId.
- CommandType/Version.
- Payload hash.
- OccurredAt/RecordedAt.
- Local sequence.

#### SyncBatch

- BatchId.
- DeviceId.
- Operations.
- Cursor claims.
- Result per operation.

#### SyncProjectionStream

- StreamName/Version.
- Scope.
- Cursor.
- Events/Snapshots.

### Invariants

- نفس ClientOperationId لا ينفذ مرتين.
- رفض عملية لا يلغي باقي العمليات المستقلة إلا Atomic batch معلنة.
- Device لا يقرر conflict resolution النهائي لحقائق Server-owned.
- Operation المقبولة لا تختفي بعد ACK.
- Clock الجهاز ليست مصدر ترتيب عالمي.

## 22. Cross-Context Ownership Rules

### 22.1 Sale لا تملك

- Product master.
- Current customer profile.
- Payment provider state.
- Inventory balance.
- Document PDF.

تملك Snapshots وReferences فقط.

### 22.2 Payment لا تملك

- Sale lines.
- Cash drawer expected balance.
- Customer receivable account.

### 22.3 Inventory لا تملك

- Purchase order commercial terms.
- Sale price أوTax.
- Return refund status.

### 22.4 Customer لا تملك

- Sale document.
- Payment transaction.
- Subscription billing account الخاصة بـATHR إلا Reference منفصل.

### 22.5 Billing لا تملك

- Tenant business data.
- Membership permissions.
- POS shifts.

وتنتج Entitlement/access-mode decisions فقط.

## 23. Reference and Snapshot Matrix

### Sale

- ProductVariantId + ProductSnapshot.
- CustomerId optional + CustomerSnapshot.
- LocationId + LegalEntitySnapshot.
- PriceRule references + PriceSnapshot.
- TaxRule references + TaxSnapshot.
- MembershipId/TerminalId/ShiftId references.

### Return

- OriginalSaleId/LineId.
- Original valuation snapshot.
- Current inspection/disposition.

### Inventory Movement

- VariantId/UOMId.
- SourceContext + SourceAggregateId + SourceLineId.
- Warehouse/Batch/Serial dimensions.

### Business Document

- Source aggregate reference.
- Full legal/commercial snapshot.
- Template version.

### Report Run

- Definition/version.
- Scope and parameter snapshot.
- Data freshness cutoff.

## 24. Transaction and Consistency Boundaries

### Strong consistency داخل Aggregate

- Sale totals مع Lines/Adjustments داخل Sale.
- Payment attempts/state داخل Payment.
- Transfer quantities داخل TransferOrder.
- Cash count/discrepancy داخل Drawer/Reconciliation.
- Subscription lifecycle داخل Subscription.

### Eventual consistency بين Contexts

- Sale completed → Inventory movement.
- Sale completed → Document issue.
- Sale completed → Customer activity/loyalty earning.
- Payment cash captured → Cash movement.
- Return posted → Inventory disposition movement.
- Refund succeeded → Documents/Customer balances.
- Subscription changed → Entitlement set.

### حالات تحتاج Saga/Process Manager

- Sale completion orchestration.
- Electronic payment unknown outcome.
- Exchange.
- Transfer shipment/receipt.
- Purchase receipt + inventory + matching.
- Return + refund + inventory disposition.
- Shift closing with pending offline operations.
- Subscription renewal + collection + entitlement update.
- Tenant closure + export + retention.

## 25. Domain Services مقابل Application Services

### Domain Service

يحتوي Business rule لا تنتمي طبيعيًا لكيان واحد، ويعمل على Domain objects، مثل:

- PricingEngine.
- ReturnEligibilityService.
- ThreeWayMatchService.
- EntitlementCompiler.

### Application Service

ينسق:

- Authorization.
- Load/save Aggregates.
- Transactions.
- External providers.
- Outbox.
- Idempotency.

ولا يحتوي حسابات Business غير موثقة داخل Domain.

## 26. Read Models الأساسية

- POS Product Search Projection.
- POS Price/Tax/Promotion Snapshot.
- Customer 360 View.
- Sale Details View.
- Payment Reconciliation Queue.
- Inventory Position View.
- Stock Movement Timeline.
- Transfer Progress View.
- Purchase Order Fulfillment View.
- Return/Refund Case View.
- Shift Summary View.
- Terminal Health and Last Sync View.
- Document Search View.
- Notification Delivery View.
- Subscription and Entitlement View.
- Operational Dashboard Projections.
- Audit Investigation View.

كل Read Model:

- تحدد Source events.
- تحمل Projection version.
- قابلة لإعادة البناء.
- تعرض Freshness.
- لا تستخدم لتنفيذ Invariant حرجة دون العودة للمصدر السلطوي.

## 27. Integration Contracts المبدئية

كل Integration event تحتاج:

- EventId.
- EventType.
- SchemaVersion.
- TenantId إن كانت Tenant-owned.
- AggregateId.
- AggregateVersion.
- OccurredAt/RecordedAt.
- CorrelationId/CausationId.
- Privacy classification.
- Minimal payload.

أحداث Integration المقترحة عالية المستوى:

- TenantAccessModeChanged.
- MembershipScopeChanged.
- DeviceRevoked.
- ProductVariantChanged.
- PriceSnapshotChanged.
- SaleCompleted.
- PaymentCaptured/RefundSucceeded/OutcomeUnknown.
- InventoryMovementPosted.
- TransferStateChanged.
- GoodsReceiptPosted.
- ReturnPosted.
- StoreCreditBalanceChanged.
- ShiftClosed.
- DocumentIssued.
- EntitlementSetChanged.

## 28. Concurrency and Versioning

- كل Aggregate mutable تحمل Version للتفاؤل Optimistic concurrency.
- Commands التي تعتمد نسخة معروضة تحمل ExpectedVersion.
- Ledger append يستخدم Unique source/idempotency constraint منطقي.
- Hot aggregates تقسم حسب Natural partition، مثل Inventory position أوCoupon usage buckets، دون كسر Invariants.
- لا يستخدم Timestamp وحده لمنع Lost updates.
- Offline conflict يعالج حسب Command semantics، لاLast-write-wins عامًا.

## 29. Identity Strategy

- IDs داخلية Opaque وغير قابلة للاستنتاج التجاري.
- Human-readable numbers منفصلة عن IDs.
- External IDs تحمل Provider/Namespace.
- Alias history تحفظ للـSKU/Barcode/Customer merge.
- IDs لا يعاد استخدامها.
- Import keys لا تصبح Primary identity دون Mapping صريح.

## 30. Data Classification داخل الـDomain

### Restricted/Highly sensitive

- Authentication credentials metadata.
- Device keys.
- Payment provider tokens/references.
- Customer PII.
- Billing details.
- Legal hold data.

### Confidential business

- Cost/margin.
- Supplier terms.
- Price contracts.
- Cash discrepancies.
- Audit investigations.

### Operational

- Catalog identity.
- Inventory positions.
- Sale status.
- Shift status.

الClassification النهائية توسع في Data Classification document، لكن كل Aggregate يجب أن تحدد Data class قبل API/Storage design.

## 31. Failure and Recovery Model

لكل Process Manager يجب توثيق:

- Current state.
- Completed steps.
- Pending step.
- Last error classification.
- Retry eligibility.
- Compensation eligibility.
- Manual intervention requirement.
- Correlation/source evidence.

مبادئ الاسترداد:

- Retry نفس Command لا Command جديدة عند الأثر نفسه.
- Compensation سجل جديد، لا حذف للأثر السابق.
- Unknown outcome يدخل Reconciliation.
- Direct database edits ممنوعة كمسار تشغيلي.
- Replay للأحداث Idempotent.
- Rebuild Read Model لا يعيد تنفيذ Side effects.

## 32. القرارات الحالية

1. 16 Bounded Contexts مع Sync كApplication/Integration context.
2. Product Catalog منفصل عن Pricing/Tax/Promotions.
3. Sales منفصلة عن Payments وInventory.
4. Returns/Refunds/Exchanges Context مستقل بسبب تعدد الأطراف والحالات.
5. Shift/Cash منفصلة عن Payments رغم استهلاكها Cash payment events.
6. Customer Receivable وStore Credit وLoyalty ثلاث Ledgers منفصلة داخل Customer context.
7. ATHR subscription billing منفصلة تمامًا عن مبيعات ومدفوعات Tenant.
8. Authorization context منفصل عن Identity وMembership.
9. Documents تملك snapshots/renders ولا تملك الواقعة التجارية.
10. Reporting/Retention لا يكتب في Domains الأصلية.
11. لا Distributed transactions؛ Sagas وOutbox/Inbox.
12. كل Completed document/ledger entry Immutable.
13. Offline commands تنفذ في Context المالك بنفس Invariants، وليست نسخة مبسطة منطقياً.
14. Read models قابلة لإعادة البناء ولا تملك الحقيقة.

## 33. القرارات المفتوحة

### OD-DM-001 — Inventory reservation aggregate

هل تكون Reservation Aggregate مستقلة دائمًا أمEntity داخل Position للحالات البسيطة؟

**الاقتراح:** مستقلة عند Sales/Transfers واسعة، مع Position projection للحساب.

### OD-DM-002 — Supplier liability

هل توجد Accounting/Payables Context مستقلة في MVP؟

**الاقتراح:** Supplier Invoice وliability references داخل Purchasing مبدئيًا، مع فصل Accounting context عندما يبدأ General Ledger حقيقي.

### OD-DM-003 — Safe custody

هل Safe ledger Aggregate كاملة أمCash movements بنطاق Safe؟

**الاقتراح:** MVP يدعم SafeDrop/Pickup كCash movement scope؛ الفصل عند Bank deposit/custody advanced workflow.

### OD-DM-004 — Promotion coupon ownership

**القرار المقترح:** CouponCampaign داخل Pricing/Promotions، بينما Redemption evidence تنعكس Snapshot في Sale.

### OD-DM-005 — Document numbering ownership

**الاقتراح:** Document context تملك sequences، بينما Sale تحمل Business number reference فقط. الأنواع القانونية الخاصة قد تحتاج Number reservation قبل Completion.

### OD-DM-006 — Audit storage model

Append-only table أمEvent stream/WORM tier يحسم في Security/Database Blueprint، دون تغيير Domain ownership.

### OD-DM-007 — Accounting context

General Ledger وChart of Accounts وJournal Entries خارج النموذج الحالي، لكن Events المالية يجب أن تسمح بإضافتها مستقبلًا دون إعادة تصميم العمليات.

### OD-DM-008 — Manufacturing/Assembly

خارج MVP؛ لا تستخدم Bundle لتقليد BOM أوManufacturing aggregate.

## 34. ما هو خارج النطاق

- Physical database tables/indexes.
- ORM models.
- REST/GraphQL routes.
- Microservice deployment count.
- Repository folders/packages.
- Message broker selection.
- Full General Ledger.
- Payroll/HR/attendance.
- Manufacturing/MRP.
- Country-specific fiscal implementation.
- Provider-specific payment adapters.
- BI warehouse technology.

## 35. Traceability إلى Business Rules

كل Aggregate وInvariant في هذه الوثيقة يجب لاحقًا أن يرتبط بـ:

- Rule IDs من Business Rules documents.
- Commands التي تطبقها.
- State transitions.
- Domain events.
- Permissions/Approvals.
- Error codes.
- Tests.

لا يسمح بإنشاء Entity أوحالة جديدة في التنفيذ دون Traceability أوADR يبررها.

## 36. Acceptance Gate

لا تعتبر Domain Model مكتملة قبل:

1. اعتماد قائمة Bounded Contexts وحدودها.
2. اعتماد Aggregate Root لكل دورة حياة حرجة.
3. اعتماد Owner واحد لكل Fact وLedger.
4. إزالة أي Cross-context direct write.
5. اعتماد Snapshots وReferences التاريخية.
6. اعتماد Strong مقابل Eventual consistency لكل Workflow.
7. تحديد Process Managers/Sagas المطلوبة.
8. تحديد Domain Services التي تحمل الحسابات المشتركة.
9. اعتماد Identity وVersioning وIdempotency model.
10. اعتماد Read models الرئيسية ومصادرها.
11. حسم القرارات المفتوحة التي تمنع Workflow Catalog.
12. بناء Entity Ownership Matrix منفصلة قابلة للتتبع.
13. مراجعة كل Business Rules documents للتأكد أن لا Rule بلا Owner.

## 37. المرحلة التالية

بعد اعتماد هذا النموذج:

1. **ATHR Entity Ownership Matrix v1.0** لتثبيت Owner وSource of Truth وReference type لكل Entity/Fact.
2. **ATHR Workflow Catalog v1.0** لتوصيف كل رحلة End-to-End وحدود الـSagas.
3. **ATHR State Machines v1.0** للحالات والانتقالات والأوامر والأخطاء.

لا يبدأ Database Blueprint أوAPI contract أوCode execution قبل إغلاق هذه البوابات.