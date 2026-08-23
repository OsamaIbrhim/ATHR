# ATHR Event Catalog v1.0

**Planning Baseline — Domain Events, Integration Contracts, Ordering, Replay and Evolution**

## 1. وظيفة الوثيقة

تثبت هذه الوثيقة جميع الأحداث التجارية والأمنية والتشغيلية الأساسية في ATHR، وتحدد لكل Event:

- الاسم والمعرّف الثابت.
- النوع: Domain أوIntegration أوProcess أوOperational.
- الـOwner Context.
- الـAggregate والـState transition المصدر.
- معنى الحدث وحدود استخدامه.
- الـMetadata والـPayload الأدنى.
- Data classification.
- الـConsumers المعتمدين.
- Ordering وIdempotency requirements.
- Replay وRetention rules.
- Schema evolution وDeprecation.

هذه الوثيقة لا تختار Message Broker أوEvent Store، ولا تعني أن النظام Event-Sourced بالكامل.

## 2. تعريف الأنواع

### Domain Event

حقيقة داخلية نتجت عن انتقال ناجح داخل Aggregate، وقد تحتوي تفاصيل يحتاجها نفس الـContext. لا تنشر تلقائيًا خارج حدودها.

### Integration Event

عقد مستقر ومحدود بين Contexts، ينتجه Owner الحقيقة بعدCommit، وقد يكون مشتقًا من Domain Event واحدة أوأكثر.

### Process Event

حدث خاص بتقدم Saga أوProcess Manager، مثل `SaleCompletionInventoryStepFailed`. لا يستبدل أحداث الـDomains المالكة.

### Operational Event

حدث تشغيل ومراقبة مثل Dead Letter أوProjection lag. لا يغير Business state وحده.

### Audit Event

تمثيل تدقيقي لقرار أوفعل. يوسع في Audit Catalog التالي، ولا يخلط مع Integration Events.

## 3. مبادئ إلزامية

1. الـCommand بصيغة أمر؛ الـEvent بصيغة ماضٍ.
2. Owner الحقيقة فقط ينشر الحدث الذي يثبتها.
3. الحدث ينتج بعد نجاح الـTransaction المحلية.
4. Outbox record تحفظ داخل نفسCommit الذي حفظ الـAggregate.
5. Event delivery At-least-once؛ الـConsumer يضمن Idempotency.
6. لا نفترض Exactly-once transport؛ نبني Exactly-once business effect.
7. لا يوجد ترتيب عالمي بين كل الأحداث.
8. الترتيب المضمون فقط داخل `AggregateId + AggregateVersion` أوPartition key معتمد.
9. الـConsumer يتحمل Duplicate، Late وOut-of-order events.
10. EventId لا يتغير عندRetry أوReplay.
11. الحدث لا يحمل Secrets أوPasswords أوPrivate keys أوFull card data.
12. PII لا تنشر إلا للغرض المحدد وبأقل Payload.
13. لا يستخدم Event كبديل Query للحصول على كل تفاصيل Aggregate.
14. لا يعدّل حدث منشور؛ التصحيح Event جديدة.
15. تغيير اسم أوحذف Field لا يتم داخل نفسSchemaVersion.
16. الـProjection handlers Side-effect-free؛ Provider calls منفصلة.
17. Replay لا يعيد إرسال Email أوتحصيل Payment أوطباعة Receipt تلقائيًا.
18. Event schema وConsumer contracts لها اختبارات توافق.

## 4. Event Naming Standard

### الاسم الخارجي

`athr.<context>.<aggregate>.<fact>.v<major>`

أمثلة:

- `athr.sales.sale.completed.v1`
- `athr.payments.payment.outcome-unknown.v1`
- `athr.inventory.movement.posted.v1`
- `athr.billing.entitlement-set.activated.v1`

### Event Catalog ID

`EVT-<CONTEXT>-NNN`

### قواعد الاسم

- past tense أوfact noun واضحة.
- لا أسماء عامة مثل `Updated`, `Changed` إلا إذاالـPayload يحدد نوع التغيير بدقة وكان الحدث للـProjection فقط.
- لا أسماء تقنية مثل `RowInserted`.
- لا يذكر اسم Vendor في العقد العام؛ Provider details داخل namespaced metadata.
- Major version فيname أوschema registry.

## 5. Envelope الإلزامي

كل Integration Event يحتوي:

```json
{
  "event_id": "opaque-id",
  "event_type": "athr.sales.sale.completed.v1",
  "schema_version": 1,
  "tenant_id": "opaque-id-or-null-for-platform-events",
  "aggregate_type": "sale",
  "aggregate_id": "opaque-id",
  "aggregate_version": 12,
  "partition_key": "tenant-or-aggregate-key",
  "occurred_at": "ISO-8601 UTC",
  "recorded_at": "ISO-8601 UTC",
  "effective_at": "ISO-8601 UTC or null",
  "correlation_id": "opaque-id",
  "causation_id": "command-or-event-id",
  "actor": {
    "actor_type": "user|service|device|system|support",
    "identity_id": "opaque-id-or-null",
    "membership_id": "opaque-id-or-null"
  },
  "context": {
    "location_id": "opaque-id-or-null",
    "terminal_id": "opaque-id-or-null",
    "shift_id": "opaque-id-or-null",
    "device_id": "opaque-id-or-null"
  },
  "data_classification": "public|internal|confidential|restricted",
  "payload": {}
}
```

### Envelope rules

- `tenant_id` mandatory لكلTenant-owned event.
- `aggregate_version` monotonically increasing داخلAggregate.
- `occurred_at` business occurrence؛ `recorded_at` server persistence.
- `actor` قد يكونSystem، لكن لا يترك مجهولًا.
- `partition_key` لا تعتمد علىPII.
- Trace metadata لا تحتوي raw access tokens.

## 6. Payload Design Rules

### مسموح

- IDs.
- الحالة الجديدة والقديمة عندالحاجة.
- Effective dates.
- Amount + currency عندحاجة Consumer مالية.
- Quantity + UOM عندحاجة Inventory.
- Source references.
- Reason codes غير الحساسة.
- Version references.
- Minimal immutable snapshot حينلا يمكن للـConsumer Query تاريخي موثوق.

### غير مسموح افتراضيًا

- Full Customer profile.
- Email/phone كاملان.
- Full Sale lines لكلحدث صغير.
- Provider raw webhook.
- Secrets أوtokens.
- Password hashes.
- Unmasked payment identifiers.
- Free-text notes غير المصنفة.
- Binary documents أوPDFs.

### Snapshot rule

الـSnapshot داخل Event تستخدم فقط إذا:

- Consumer يحتاج التاريخ كما كان وقت الواقعة.
- Query لاحقة قد تعيد بيانات متغيرة.
- Payload approved وفقData classification.

## 7. Event Production Pipeline

1. Command validated.
2. Aggregate transition committed.
3. Domain events stored/returned داخليًا.
4. Integration event mapper يحول فقط events المعتمدة.
5. Outbox record written atomically.
6. Dispatcher ينشر.
7. Consumer Inbox deduplicates EventId.
8. Consumer applies local transaction.
9. Handler outcome/lag/error observable.
10. Dead-letter بعدpolicy exhaustion، دونفقد original event.

# القسم الأول — Identity, Tenant, Authorization and Devices

## 8. Platform Identity Events

### EVT-IDN-001 — PlatformIdentityCreated

- **Type:** Integration.
- **Source:** PlatformIdentity `none → PendingVerification`.
- **Payload:** identity_id، status، created_at، required_verification_types.
- **Classification:** Restricted metadata؛ لاcontact raw.
- **Consumers:** Tenant invitation acceptance، Security monitoring.

### EVT-IDN-002 — ContactMethodVerified

- **Source:** verification transition.
- **Payload:** identity_id، contact_type، masked_contact، verified_at، verification_version.
- **Consumers:** Tenant onboarding، security notifications.

### EVT-IDN-003 — PlatformIdentityActivated

- **Consumers:** Membership activation، session eligibility projections.

### EVT-IDN-004 — PlatformIdentitySuspended

- **Payload:** identity_id، effective_at، reason_code، security_version.
- **Consumers:** Session revocation، Membership access projection، Offline lease revocation.
- **Ordering:** identity_id.

### EVT-IDN-005 — PlatformIdentityReinstated

### EVT-IDN-006 — PlatformIdentityClosed

### EVT-IDN-007 — AuthenticationSessionRevoked

- **Payload:** session_family_id، identity_id، reason_code، security_version.
- **Classification:** Restricted.
- **Consumers:** Gateway/session cache.

### EVT-IDN-008 — IdentitySecurityVersionAdvanced

- **Use:** invalidation signal بعدpassword recovery/MFA compromise.

## 9. Tenant and Organization Events

### EVT-TEN-001 — TenantProvisioningStarted

### EVT-TEN-002 — TenantActivated

- **Payload:** tenant_id، primary_legal_entity_id، default_timezone، locale، access_mode_version.
- **Consumers:** Config projections، billing، reporting bootstrap.

### EVT-TEN-003 — TenantAccessModeChanged

- **Payload:** previous_mode، new_mode، reason_source `billing|security|closure|support`، effective_at، access_mode_version.
- **Consumers:** Authorization، Devices/leases، API gateway، scheduled jobs.
- **Rule:** لايحتوي تفاصيل الفاتورة أوincident.

### EVT-TEN-004 — TenantClosureRequested

### EVT-TEN-005 — TenantClosed

- **Consumers:** Billing، retention، integration disabling.

### EVT-TEN-006 — LegalEntityRegistered

### EVT-TEN-007 — LegalEntityProfileVersioned

- **Payload:** legal_entity_id، profile_version، effective_at.
- **Consumers:** Documents current lookup فقط؛ issued docs لا تتغير.

### EVT-TEN-008 — LocationOpened

### EVT-TEN-009 — LocationRestricted

### EVT-TEN-010 — LocationClosed

- **Consumers:** Catalog assortment، devices، shifts، purchasing، reporting.

### EVT-TEN-011 — WarehouseCreated

### EVT-TEN-012 — WarehouseClosed

## 10. Membership and Authorization Events

### EVT-MEM-001 — MembershipInvited

- **Payload:** invitation_id، tenant_id، proposed_role_ids، scope_summary، expires_at؛ لاtoken.

### EVT-MEM-002 — MembershipActivated

- **Payload:** membership_id، identity_id، tenant_id، home_location_id، authorization_version.

### EVT-MEM-003 — MembershipSuspended

### EVT-MEM-004 — MembershipReinstated

### EVT-MEM-005 — MembershipOffboardingStarted

### EVT-MEM-006 — MembershipDeactivated

### EVT-MEM-007 — MembershipScopeChanged

- **Payload:** membership_id، authorization_version، affected_scope_types، effective_at.
- **Consumers:** Authorization caches، offline leases، report schedules، terminal sessions.
- **No payload:** full permission list؛ Consumers fetch/evaluate versioned policy.

### EVT-AUT-001 — RoleDefinitionPublished

### EVT-AUT-002 — RoleDefinitionArchived

### EVT-AUT-003 — AccessPolicyVersionPublished

### EVT-AUT-004 — ApprovalRequested

- **Payload:** approval_request_id، operation_type، target_reference، payload_hash، required_levels، expires_at.

### EVT-AUT-005 — ApprovalGranted

- **Payload:** approval_request_id، level، approver_membership_id، decision_at، payload_hash.

### EVT-AUT-006 — ApprovalRejected

### EVT-AUT-007 — ApprovalExpired

### EVT-AUT-008 — ApprovalInvalidated

## 11. Device and Terminal Events

### EVT-DEV-001 — DeviceEnrolled

### EVT-DEV-002 — DeviceRestricted

### EVT-DEV-003 — DeviceRevoked

- **Payload:** device_id، terminal_ids، revocation_version، effective_at، reason_code.
- **Consumers:** Sync gateway، lease service، terminal monitoring.

### EVT-DEV-004 — DeviceKeyRotationRequired

### EVT-DEV-005 — DeviceKeyRotated

### EVT-TRM-001 — TerminalProvisioned

### EVT-TRM-002 — TerminalActivated

### EVT-TRM-003 — TerminalReassignmentRequested

### EVT-TRM-004 — TerminalReassigned

- **Payload:** terminal_id، previous_location_id، new_location_id، assignment_version.
- **Consumers:** Shifts، sync snapshots، reporting.

### EVT-TRM-005 — TerminalBlocked

### EVT-TRM-006 — TerminalRetired

### EVT-OFL-001 — OfflineLeaseIssued

- **Payload:** lease_id، device_id، membership_id، scope_hash، entitlement_version، expires_at؛ لاsigned token.

### EVT-OFL-002 — OfflineLeaseRevoked

### EVT-OFL-003 — OfflineLeaseExpired

# القسم الثاني — Catalog, Pricing, Tax and Promotions

## 12. Product Catalog Events

### EVT-CAT-001 — ProductCreated

### EVT-CAT-002 — ProductActivated

### EVT-CAT-003 — ProductRestricted

### EVT-CAT-004 — ProductDiscontinued

### EVT-CAT-005 — ProductArchived

### EVT-CAT-006 — ProductProfileVersioned

- **Payload:** product_id، profile_version، changed_sections، effective_at.
- **Consumers:** Search projection، device catalog snapshots.

### EVT-CAT-007 — VariantAdded

### EVT-CAT-008 — VariantActivated

### EVT-CAT-009 — VariantSellabilityChanged

### EVT-CAT-010 — VariantDiscontinued

### EVT-CAT-011 — SkuAssigned

### EVT-CAT-012 — SkuRetired

### EVT-CAT-013 — BarcodeAssigned

### EVT-CAT-014 — BarcodeRetired

- **Consumers:** POS lookup، offline catalog.
- **Ordering:** identifier registry partition.

### EVT-CAT-015 — UnitDefinitionCreated

### EVT-CAT-016 — UomConversionVersionPublished

- **Payload:** unit_definition_id، conversion_version، effective_at، affected_variant_ids optionally bounded.

### EVT-CAT-017 — CategoryChanged

### EVT-CAT-018 — BrandChanged

### EVT-CAT-019 — LocationAssortmentPublished

- **Payload:** location_id، assortment_version، effective_at، delta_reference/full_snapshot_reference.

## 13. Pricing Events

### EVT-PRC-001 — PriceBookSubmitted

### EVT-PRC-002 — PriceBookApproved

### EVT-PRC-003 — PriceBookScheduled

### EVT-PRC-004 — PriceBookActivated

- **Payload:** price_book_id، version، currency، scope، effective_at.
- **Consumers:** Pricing projection، POS sync، reporting.

### EVT-PRC-005 — PriceBookEnded

### EVT-PRC-006 — PriceEntryScheduled

### EVT-PRC-007 — PriceEntryActivated

### EVT-PRC-008 — PriceEntryEnded

### EVT-PRC-009 — ManualPriceOverrideApplied

- **Type:** Domain + Audit؛ Integration فقط للتقارير عالية المستوى.
- **Payload Integration:** sale_id، line_id، override_reason_code، approval_reference، original_amount، applied_amount، currency.
- **Classification:** Confidential.

## 14. Tax Events

### EVT-TAX-001 — TaxRuleVersionSubmitted

### EVT-TAX-002 — TaxRuleVersionApproved

### EVT-TAX-003 — TaxRuleVersionScheduled

### EVT-TAX-004 — TaxRuleVersionActivated

- **Payload:** tax_code_id، version، jurisdiction_key، effective_at، calculation_mode.

### EVT-TAX-005 — TaxRuleVersionSuperseded

## 15. Promotion and Coupon Events

### EVT-PRO-001 — PromotionSubmitted

### EVT-PRO-002 — PromotionApproved

### EVT-PRO-003 — PromotionScheduled

### EVT-PRO-004 — PromotionActivated

### EVT-PRO-005 — PromotionPaused

### EVT-PRO-006 — PromotionResumed

### EVT-PRO-007 — PromotionEnded

### EVT-PRO-008 — CouponCodeIssued

- **Integration payload:** campaign_id، coupon_id، masked_code_suffix، effective period؛ لاraw code إلافيsecure delivery context.

### EVT-PRO-009 — CouponReserved

### EVT-PRO-010 — CouponReservationReleased

### EVT-PRO-011 — CouponRedeemed

- **Payload:** campaign_id، coupon_id، sale_id، redemption_id، benefit_summary، occurred_at.
- **Consumers:** Sales process، campaign usage projection، reporting.

### EVT-PRO-012 — CouponExpired

# القسم الثالث — Sales and Payments

## 16. Sale Events

### EVT-SAL-001 — SaleStarted

- **Payload:** sale_id، location_id، terminal_id، shift_id، channel، currency، customer_id optional.
- **Consumers:** Operational monitoring only; not inventory.

### EVT-SAL-002 — SaleLineAdded

- **Type:** Domain؛ Integration فقط إذاreal-time external need approved.
- **Payload Domain:** line identity and snapshots.

### EVT-SAL-003 — SaleLineChanged

### EVT-SAL-004 — SaleLineRemoved

### EVT-SAL-005 — SalePriced

- **Payload:** sale_id، calculation_version، totals، price/tax/promotion evidence references، priced_at.
- **Classification:** Confidential financial.

### EVT-SAL-006 — SalePaymentRequested

- **Payload:** sale_id، payment_request_id، required_amount، currency، allowed_tender_types، expiration optional.
- **Consumer:** Payments.

### EVT-SAL-007 — SalePaymentResolutionPending

- **Consumers:** POS/admin status، shift close blocker.

### EVT-SAL-008 — SalePaymentSatisfied

- **Owner:** Sales بعدقبول allocations.
- **Payload:** sale_id، satisfied_amount، currency، payment_allocation_refs.

### EVT-SAL-009 — SaleCompletionStarted

- **Type:** Domain/process only.

### EVT-SAL-010 — SaleCompleted

- **Event type:** `athr.sales.sale.completed.v1`.
- **Source transition:** Completing → Completed.
- **Payload minimum:**
    - sale_id، sale_number/reference.
    - tenant/location/terminal/shift.
    - completed_at/business_date.
    - currency and totals summary.
    - customer_id optional.
    - payment_allocation_refs.
    - line_effects list: sale_line_id، variant_id، warehouse_id، quantity، uom_id، inventory_tracking refs whenrequired.
    - document snapshot reference/data approved.
- **Consumers:** Inventory، Documents، Customer/Loyalty، Reporting، Cash Process coordination.
- **Ordering:** sale_id.
- **Replay:** Inventory/Documents dedupe byEventId/source line.

### EVT-SAL-011 — SaleSuspended

### EVT-SAL-012 — SaleResumed

### EVT-SAL-013 — SaleCancelled

### EVT-SAL-014 — SaleCompletionExceptionRaised

- **Process/Operational event** للمصالحة؛ لايعني Sale completed.

### EVT-SAL-015 — OfflineSaleAccepted

- **Payload:** sale_id، original_client_operation_id، occurred_at، lease_id، canonical acceptance version.

### EVT-SAL-016 — OfflineSaleExceptionRaised

- **Classification:** Confidential؛ سبب منظم لاfree text.

## 17. Payment Events

### EVT-PAY-001 — PaymentCreated

### EVT-PAY-002 — PaymentAttemptPrepared

### EVT-PAY-003 — PaymentAttemptSent

### EVT-PAY-004 — PaymentAuthorized

- **Payload:** payment_id، attempt_id، amount، currency، provider_reference_masked، authorization_expires_at optional.

### EVT-PAY-005 — PaymentCaptured

- **Event type:** `athr.payments.payment.captured.v1`.
- **Payload:** payment_id، attempt_id، amount، currency، tender_type، provider_reference_masked، captured_at، source_sale_id optional، cash_context refs whencash.
- **Consumers:** Payment allocation process، Cash context whencash، reporting.

### EVT-PAY-006 — PaymentDeclined

- **Payload:** normalized decline category؛ لاraw provider error/PII.

### EVT-PAY-007 — PaymentFailed

### EVT-PAY-008 — PaymentOutcomeUnknown

- **Event type:** `athr.payments.payment.outcome-unknown.v1`.
- **Payload:** payment_id، attempt_id، amount، currency، provider_reference_masked، last_known_stage، reconciliation_due_at.
- **Consumers:** ElectronicPaymentResolutionProcess، Sale/Shift blocker projections، alerts.

### EVT-PAY-009 — PaymentReconciliationStarted

### EVT-PAY-010 — PaymentReconciledAsCaptured

### EVT-PAY-011 — PaymentReconciledAsFailed

### EVT-PAY-012 — PaymentReconciliationManualReviewRequired

### EVT-PAY-013 — PaymentAllocated

- **Payload:** payment_id، allocation_id، target_type، target_id، amount، currency.
- **Consumers:** Sales، Receivables، Billing according tonamespace.

### EVT-PAY-014 — PaymentAllocationReleased

### EVT-PAY-015 — PaymentSettled

### EVT-PAY-016 — PaymentReversalRequested

### EVT-PAY-017 — PaymentReversed

### EVT-PAY-018 — PaymentRefundRequested

### EVT-PAY-019 — PaymentRefundSucceeded

- **Payload:** refund_transaction_id، source_payment_id، business_refund_id، amount، currency، method، provider_reference_masked.
- **Consumers:** Returns/Refund process، Cash context ifcash، Documents، reporting.

### EVT-PAY-020 — PaymentRefundFailed

### EVT-PAY-021 — PaymentRefundOutcomeUnknown

# القسم الرابع — Inventory, Transfers and Purchasing

## 18. Inventory Events

### EVT-INV-001 — StockReservationRequested

### EVT-INV-002 — StockReserved

### EVT-INV-003 — StockReservationPartiallyConsumed

### EVT-INV-004 — StockReservationConsumed

### EVT-INV-005 — StockReservationReleased

### EVT-INV-006 — StockReservationExpired

### EVT-INV-007 — InventoryMovementValidated

### EVT-INV-008 — InventoryMovementPosted

- **Event type:** `athr.inventory.movement.posted.v1`.
- **Payload:** movement_id، movement_type، source_context، source_aggregate_id، source_event_id، posted_at، lines[{variant_id, warehouse_id, batch/serial refs, quantity_delta, uom_id, cost_reference optional}].
- **Consumers:** Inventory position projection، costing، reporting، source process manager.
- **Ordering:** stock partition/warehouse-variant; Consumers must not assume global order.

### EVT-INV-009 — InventoryMovementRejected

### EVT-INV-010 — InventoryCorrectionMovementPosted

### EVT-INV-011 — InventoryPositionBecameNegative

- **Operational/risk event**, not balance authority.

### EVT-INV-012 — InventoryAvailabilityThresholdCrossed

- **Derived event:** stock alert/notification only؛ لاtransaction owner.

## 19. Transfer Events

### EVT-TRF-001 — TransferCreated

### EVT-TRF-002 — TransferSubmitted

### EVT-TRF-003 — TransferApproved

### EVT-TRF-004 — TransferRejected

### EVT-TRF-005 — TransferCancelled

### EVT-TRF-006 — TransferShipmentRecorded

- **Payload:** transfer_id، shipment_id، source_warehouse_id، destination_warehouse_id، lines and source operation id.

### EVT-TRF-007 — TransferPartiallyShipped

### EVT-TRF-008 — TransferShipped

### EVT-TRF-009 — TransferReceiptRecorded

### EVT-TRF-010 — TransferPartiallyReceived

### EVT-TRF-011 — TransferReceived

### EVT-TRF-012 — TransferDiscrepancyOpened

### EVT-TRF-013 — TransferDiscrepancyResolved

### EVT-TRF-014 — TransferClosed

## 20. Stock Count Events

### EVT-CNT-001 — StockCountScheduled

### EVT-CNT-002 — StockCountStarted

### EVT-CNT-003 — StockCountSubmitted

### EVT-CNT-004 — StockRecountRequired

### EVT-CNT-005 — StockCountApproved

### EVT-CNT-006 — StockCountAdjustmentPostingRequested

### EVT-CNT-007 — StockCountPosted

### EVT-CNT-008 — StockCountExceptionRaised

## 21. Purchasing Events

### EVT-SUP-001 — SupplierCreated

### EVT-SUP-002 — SupplierRestricted

### EVT-SUP-003 — SupplierArchived

### EVT-PUR-001 — PurchaseOrderCreated

### EVT-PUR-002 — PurchaseOrderSubmitted

### EVT-PUR-003 — PurchaseOrderApproved

- **Payload:** po_id، revision، supplier_id، location/warehouse refs، currency، total_summary، approved_at.
- **Consumers:** Documents، receiving projection، reporting.

### EVT-PUR-004 — PurchaseOrderRejected

### EVT-PUR-005 — PurchaseOrderRevisionCreated

### EVT-PUR-006 — PurchaseOrderCancelled

### EVT-PUR-007 — PurchaseOrderPartiallyReceived

### EVT-PUR-008 — PurchaseOrderFullyReceived

### EVT-RCV-001 — GoodsReceiptCreated

### EVT-RCV-002 — GoodsReceiptInspectionRecorded

### EVT-RCV-003 — GoodsReceiptPosted

- **Payload:** receipt_id، po_id optional، supplier_id، warehouse_id، accepted/quarantine/rejected line effects، batches/serials.
- **Consumers:** Inventory، PO fulfillment، Documents، reporting.

### EVT-RCV-004 — GoodsReceiptInventoryPostingPending

### EVT-RCV-005 — GoodsReceiptCompleted

### EVT-RCV-006 — GoodsReceiptExceptionRaised

### EVT-SIN-001 — SupplierInvoiceRecorded

### EVT-SIN-002 — SupplierInvoiceMatchStarted

### EVT-SIN-003 — SupplierInvoiceMatched

### EVT-SIN-004 — SupplierInvoiceMatchExceptionRaised

### EVT-SIN-005 — SupplierInvoiceApproved

### EVT-SIN-006 — SupplierLiabilityPosted

### EVT-SRT-001 — SupplierReturnApproved

### EVT-SRT-002 — SupplierReturnPosted

### EVT-SRT-003 — SupplierReturnResolved

# القسم الخامس — Returns, Customer Value, Shifts and Cash

## 22. Return and Refund Events

### EVT-RET-001 — ReturnRequested

### EVT-RET-002 — ReturnEligibilityApproved

### EVT-RET-003 — ReturnEligibilityRejected

### EVT-RET-004 — ReturnedItemsReceived

### EVT-RET-005 — ReturnInspectionRecorded

### EVT-RET-006 — ReturnDispositionDecided

### EVT-RET-007 — ReturnValued

### EVT-RET-008 — ReturnPosted

- **Event type:** `athr.returns.return.posted.v1`.
- **Payload:** return_id، original_sale_id، location_id، posted_at، lines[{return_line_id, original_sale_line_id, variant_id, accepted_quantity, uom_id, disposition, refund_eligible_amount, tax_allocation}].
- **Consumers:** Inventory، Refund process، Customer/Loyalty، Documents، reporting.

### EVT-RET-009 — ReturnInventoryDispositionPending

### EVT-REF-001 — RefundApproved

### EVT-REF-002 — RefundExecutionRequested

### EVT-REF-003 — RefundSucceeded

- **Owner:** Returns Refund Aggregate بعدقبول Payment/StoreCredit result.
- **Payload:** refund_id، return_id optional، settlement_reference، amount، currency، completed_at.
- **Consumers:** Documents، reporting، customer notifications.

### EVT-REF-004 — RefundFailedTemporary

### EVT-REF-005 — RefundFailedPermanent

### EVT-REF-006 — RefundOutcomeUnknown

### EVT-REF-007 — RefundLiabilityOpened

### EVT-REF-008 — RefundLiabilitySettled

### EVT-EXC-001 — ExchangeStarted

### EVT-EXC-002 — ExchangeReturnCompleted

### EVT-EXC-003 — ExchangeReplacementSaleCompleted

### EVT-EXC-004 — ExchangeSettlementPending

### EVT-EXC-005 — ExchangeCompleted

### EVT-VOI-001 — VoidRequested

### EVT-VOI-002 — VoidCompleted

### EVT-VOI-003 — VoidReconciliationRequired

## 23. Customer Events

### EVT-CUS-001 — CustomerCreated

- **Integration payload:** customer_id، customer_type، status، created_at؛ لاPII افتراضيًا.

### EVT-CUS-002 — CustomerProfileChanged

- **Payload:** customer_id، profile_version، changed_sections.

### EVT-CUS-003 — CustomerRestricted

### EVT-CUS-004 — CustomerBlocked

### EVT-CUS-005 — CustomerDeactivated

### EVT-CUS-006 — CustomerMerged

- **Payload:** merge_case_id، survivor_customer_id، merged_customer_ids، alias_resolution_version.
- **Consumers:** Search/projections؛ historical records لايعاد كتابتها.

### EVT-CUS-007 — CustomerAnonymized

### EVT-CUS-008 — ConsentGranted

- **Payload:** customer_id، purpose، channel، policy_version، effective_at؛ لاcontact raw.

### EVT-CUS-009 — ConsentWithdrawn

### EVT-CUS-010 — CustomerCommunicationRestricted

## 24. Receivable, Store Credit and Loyalty Events

### EVT-AR-001 — ReceivableEntryPosted

### EVT-AR-002 — ReceivablePartiallySettled

### EVT-AR-003 — ReceivableSettled

### EVT-AR-004 — CreditLimitVersionPublished

### EVT-AR-005 — ReceivableDisputed

### EVT-AR-006 — ReceivableWrittenOff

### EVT-SCR-001 — StoreCreditIssued

### EVT-SCR-002 — StoreCreditReserved

### EVT-SCR-003 — StoreCreditReservationReleased

### EVT-SCR-004 — StoreCreditRedeemed

### EVT-SCR-005 — StoreCreditExpired

### EVT-SCR-006 — StoreCreditCorrected

### EVT-LOY-001 — LoyaltyPointsEarned

### EVT-LOY-002 — LoyaltyPointsReserved

### EVT-LOY-003 — LoyaltyPointsRedeemed

### EVT-LOY-004 — LoyaltyPointsReversed

### EVT-LOY-005 — LoyaltyPointsExpired

### EVT-LOY-006 — LoyaltyTierChanged

## 25. Shift and Cash Events

### EVT-SHF-001 — ShiftOpeningStarted

### EVT-SHF-002 — ShiftOpened

- **Payload:** shift_id، terminal_id، location_id، drawer_session_id، operator_membership_id، opened_at، business_date.
- **Consumers:** Sales eligibility، terminal monitoring، reporting.

### EVT-SHF-003 — ShiftSuspended

### EVT-SHF-004 — ShiftResumed

### EVT-SHF-005 — ShiftClosingRequested

### EVT-SHF-006 — ShiftProvisionalClosed

- **Payload:** shift_id، local_final_sequence، counted_amount_summary، pending_operation_count، closed_offline_at.
- **Consumers:** Sync/reconciliation/admin monitoring.

### EVT-SHF-007 — ShiftFinalClosed

- **Payload:** shift_id، expected/counted/discrepancy summary، final_closed_at، reconciliation_id.

### EVT-SHF-008 — ShiftClosingExceptionRaised

### EVT-CSH-001 — OpeningFloatPosted

### EVT-CSH-002 — CashMovementPosted

- **Payload:** cash_movement_id، drawer_session_id، shift_id، type، direction، amount، currency، source_context/id، occurred_at.
- **Consumers:** Expected cash projection، reports، closing process.

### EVT-CSH-003 — SafeDropRecorded

### EVT-CSH-004 — DrawerCountSubmitted

### EVT-CSH-005 — DrawerRecountRequired

### EVT-CSH-006 — CashDiscrepancyOpened

### EVT-CSH-007 — CashDiscrepancyApproved

### EVT-CSH-008 — CashDiscrepancyResolved

### EVT-CSH-009 — DrawerHandoverCompleted

# القسم السادس — Documents, Notifications, Reporting and Governance

## 26. Document Events

### EVT-DOC-001 — DocumentIssuanceRequested

- **Type:** Internal/process event، source from authoritative business event.

### EVT-DOC-002 — BusinessDocumentIssued

- **Payload:** document_id، document_type، document_number، source_context/id، legal_entity_id، issued_at، template_version، artifact availability false/true.
- **Consumers:** Rendering، delivery، reporting، customer portal.

### EVT-DOC-003 — BusinessDocumentCorrected

### EVT-DOC-004 — BusinessDocumentVoidedByCorrection

### EVT-DOC-005 — DocumentIssuanceFailed

- **Process/Operational:** failure category and source reference؛ لاraw content.

### EVT-RND-001 — DocumentRenderRequested

### EVT-RND-002 — DocumentRenderReady

- **Payload:** render_id، document_id، format، checksum، secured_artifact_reference، expires_at optional.

### EVT-RND-003 — DocumentRenderFailed

### EVT-PRN-001 — PrintJobQueued

### EVT-PRN-002 — PrintJobSucceeded

### EVT-PRN-003 — PrintJobFailed

### EVT-PRN-004 — DocumentReprinted

- **Audit-sensitive:** reason، actor، copy_type.

## 27. Notification and Delivery Events

### EVT-NTF-001 — NotificationCreated

### EVT-NTF-002 — NotificationSuppressed

### EVT-NTF-003 — NotificationQueued

### EVT-NTF-004 — NotificationPartiallyDelivered

### EVT-NTF-005 — NotificationCompleted

### EVT-DLV-001 — DeliveryQueued

### EVT-DLV-002 — DeliveryProviderAccepted

### EVT-DLV-003 — DeliverySucceeded

### EVT-DLV-004 — DeliveryFailedTemporary

### EVT-DLV-005 — DeliveryFailedPermanent

### EVT-DLV-006 — DeliveryOutcomeUnknown

### EVT-DLV-007 — DeliveryBounced

### EVT-DLV-008 — DeliveryExpired

## 28. Reporting and Export Events

### EVT-RPT-001 — ReportRunRequested

### EVT-RPT-002 — ReportRunStarted

### EVT-RPT-003 — ReportRunCompleted

- **Payload:** report_run_id، definition_id/version، scope_hash، freshness_cutoff، output_reference، row_count، totals_checksum optional.
- **Classification:** based onreport data; envelope alone may beConfidential.

### EVT-RPT-004 — ReportRunFailed

### EVT-RPT-005 — ReportScheduleTriggered

### EVT-EXP-001 — ExportRequested

### EVT-EXP-002 — ExportApproved

### EVT-EXP-003 — ExportReady

- **Payload:** export_job_id، requester_membership_id، classification، artifact_reference، expires_at؛ no raw data.

### EVT-EXP-004 — ExportDownloaded

### EVT-EXP-005 — ExportExpired

### EVT-EXP-006 — ExportDeleted

## 29. Audit and Security Operational Signals

تنتقل التفاصيل إلىAudit Catalog، لكن Integration/Operational signals الأساسية:

### EVT-SEC-001 — HighRiskActionDetected

### EVT-SEC-002 — RepeatedAuthorizationDenialsDetected

### EVT-SEC-003 — SupportAccessStarted

### EVT-SEC-004 — SupportAccessEnded

### EVT-SEC-005 — SensitiveExportAnomalyDetected

هذه Events ليست بديلًاAudit records، وقد تحمل references فقط.

## 30. Retention and Legal Hold Events

### EVT-HOLD-001 — LegalHoldActivated

- **Payload:** legal_hold_id، scope_hash، effective_at، review_due_at، authority_reference masked.
- **Consumers:** Retention/disposition engine.

### EVT-HOLD-002 — LegalHoldReviewDue

### EVT-HOLD-003 — LegalHoldReleased

### EVT-RETENTION-001 — DataDispositionPlanned

### EVT-RETENTION-002 — DataDispositionBlockedByHold

### EVT-RETENTION-003 — DataDispositionStarted

### EVT-RETENTION-004 — DataDispositionPartiallyCompleted

### EVT-RETENTION-005 — DataArchived

### EVT-RETENTION-006 — DataAnonymized

### EVT-RETENTION-007 — DataDeleted

### EVT-RETENTION-008 — DataDispositionCompleted

### EVT-RETENTION-009 — DataDispositionFailed

# القسم السابع — SaaS Billing, Subscription and Entitlements

## 31. Plan and Subscription Events

### EVT-PLN-001 — PlanVersionPublished

### EVT-PLN-002 — PlanVersionArchived

### EVT-SUB-001 — TrialStarted

- **Payload:** subscription_id، tenant_id، plan_version_id، trial_start/end، entitlement_compile_reference.

### EVT-SUB-002 — TrialEndingSoon

- **Scheduled fact**, notification trigger; dedupe bysubscription+threshold.

### EVT-SUB-003 — TrialEnded

### EVT-SUB-004 — SubscriptionActivated

### EVT-SUB-005 — SubscriptionRenewalScheduled

### EVT-SUB-006 — SubscriptionRenewed

- **Payload:** subscription_id، prior_period، new_period، billing_invoice_id، plan_version_id.

### EVT-SUB-007 — SubscriptionMarkedPastDue

### EVT-SUB-008 — SubscriptionGracePeriodStarted

### EVT-SUB-009 — SubscriptionRestricted

### EVT-SUB-010 — SubscriptionSuspended

### EVT-SUB-011 — SubscriptionRestored

### EVT-SUB-012 — SubscriptionPlanChangeScheduled

### EVT-SUB-013 — SubscriptionPlanChanged

### EVT-SUB-014 — SubscriptionCancellationScheduled

### EVT-SUB-015 — SubscriptionCancellationRevoked

### EVT-SUB-016 — SubscriptionCancelled

### EVT-SUB-017 — SubscriptionReactivated

### EVT-SUB-018 — SubscriptionExpired

## 32. SaaS Billing Events

### EVT-BIL-001 — BillingInvoiceIssued

- **Payload:** billing_invoice_id، subscription_id، service_period، amount_due، currency، due_at، tax_summary، invoice_number.

### EVT-BIL-002 — BillingInvoiceOverdue

### EVT-BIL-003 — BillingInvoicePartiallyPaid

### EVT-BIL-004 — BillingInvoicePaid

### EVT-BIL-005 — BillingInvoiceCredited

### EVT-BIL-006 — CollectionPaymentStarted

### EVT-BIL-007 — CollectionPaymentSucceeded

### EVT-BIL-008 — CollectionPaymentFailed

### EVT-BIL-009 — CollectionPaymentOutcomeUnknown

### EVT-BIL-010 — DunningStepStarted

### EVT-BIL-011 — DunningRecovered

### EVT-BIL-012 — AccountCreditIssued

### EVT-BIL-013 — SaaSRefundSucceeded

## 33. Usage and Entitlement Events

### EVT-USG-001 — UsageRecorded

- **Payload:** meter_id/version، tenant_id، source_event_id، quantity، unit، occurred_at، period_key.
- **Rule:** dedupe bysource event/meter.

### EVT-USG-002 — UsageCorrected

### EVT-USG-003 — UsageThresholdCrossed

### EVT-ENT-001 — EntitlementCompilationStarted

### EVT-ENT-002 — EntitlementCompilationFailed

### EVT-ENT-003 — EntitlementSetScheduled

### EVT-ENT-004 — EntitlementSetActivated

- **Event type:** `athr.billing.entitlement-set.activated.v1`.
- **Payload:** entitlement_set_id، tenant_id، version، effective_at، feature_keys_changed، limit_keys_changed، access_mode، expires_at optional.
- **Consumers:** Authorization، API policy، Device/offline lease، UI capability projection.
- **No payload:** full sensitive commercial terms.

### EVT-ENT-005 — EntitlementSetSuperseded

### EVT-ENT-006 — EntitlementSetExpired

### EVT-ENT-007 — EntitlementLimitReached

### EVT-ENT-008 — TemporaryEntitlementOverrideGranted

### EVT-ENT-009 — TemporaryEntitlementOverrideExpired

# القسم الثامن — Sync, Process and Operational Events

## 34. Sync Events

### EVT-SYN-001 — SyncBatchReceived

### EVT-SYN-002 — ClientOperationAccepted

- **Payload:** client_operation_id، owner_context، aggregate_id، result_version، accepted_at.

### EVT-SYN-003 — ClientOperationRejected

- **Payload:** client_operation_id، error_family/code، retryability، current_version optional؛ لاsensitive details.

### EVT-SYN-004 — ClientOperationConflictDetected

### EVT-SYN-005 — ClientOperationPendingReconciliation

### EVT-SYN-006 — SyncBatchPartiallyCompleted

### EVT-SYN-007 — SyncBatchCompleted

### EVT-SYN-008 — ProjectionSnapshotPublished

### EVT-SYN-009 — ProjectionCursorInvalidated

### EVT-SYN-010 — DeviceSyncLagThresholdExceeded

## 35. Process Manager Events

### EVT-PROC-001 — ProcessStarted

### EVT-PROC-002 — ProcessStepCompleted

### EVT-PROC-003 — ProcessWaitingForEvent

### EVT-PROC-004 — ProcessRetryScheduled

### EVT-PROC-005 — ProcessManualInterventionRequired

### EVT-PROC-006 — ProcessCompensationStarted

### EVT-PROC-007 — ProcessCompleted

### EVT-PROC-008 — ProcessCancelled

هذه Events تشغيلية/داخلية عادة، ولاينبغي أن تصبح عقدًا عامًا لكلConsumers.

## 36. Event Delivery Operational Events

### EVT-OPS-001 — OutboxEventPublished

### EVT-OPS-002 — EventDeliveryFailedTemporary

### EVT-OPS-003 — EventDeadLettered

### EVT-OPS-004 — EventReplayApproved

### EVT-OPS-005 — EventReplayCompleted

### EVT-OPS-006 — ConsumerProjectionLagExceeded

### EVT-OPS-007 — ConsumerSchemaIncompatible

# القسم التاسع — Consumer Matrix

## 37. High-value consumer mapping

### SaleCompleted

- Inventory: post consumption.
- Documents: issue receipt/invoice.
- Customer: activity/loyalty earning.
- Reporting: sales/payment facts.
- Notification: optional customer receipt trigger.
- Sync: distribute canonical result.

### PaymentCaptured

- Payment allocation process.
- Cash Context forcash tender only.
- Reporting.
- Reconciliation.

### ReturnPosted

- Inventory disposition.
- Refund process.
- Loyalty reversal.
- Documents.
- Reporting.

### GoodsReceiptPosted

- Inventory receipt movement.
- PO fulfillment projection.
- Supplier invoice matching.
- Documents/reporting.

### InventoryMovementPosted

- Inventory positions.
- Costing.
- Source Process Manager.
- Reporting.

### ShiftFinalClosed

- Shift reports.
- Cash reconciliation summary.
- Terminal/admin monitoring.
- Scheduled business-day processes.

### EntitlementSetActivated

- Authorization.
- API capability policy.
- Device lease issuer.
- Tenant UI capability projection.
- Usage/limit monitoring.

### MembershipScopeChanged

- Authorization caches.
- Sessions/leases.
- Scheduled report access.
- Support/admin views.

## 38. Consumer ownership rule

كلConsumer يسجل:

- ConsumerName.
- EventType + supported versions.
- Business purpose.
- Handler transaction boundary.
- Deduplication key.
- Retry policy.
- Dead-letter owner.
- Replay safety class.
- Data classification permission.
- Projection/side-effect type.

لا يسمح بConsumer غيرمسجل لEvent Restricted.

# القسم العاشر — Ordering and Concurrency

## 39. Ordering guarantees

### Guaranteed

- داخلAggregate واحدة حسبAggregateVersion عندpartitioning الصحيح.
- داخلOutbox المحلية حسبsequence، لكن النقل قد يعيد الترتيب؛ Consumer يتحقق منversion.

### غيرمضمون

- أحداث Aggregates مختلفة.
- Contexts مختلفة.
- Provider webhook مقابلAPI response.
- Offline OccurredAt مقابلserver RecordedAt.

### Consumer strategies

- Ignore duplicate version.
- Buffer small gaps أوfetch current state/snapshot.
- Apply commutative ledger entries byunique source.
- Reject impossible future version to retry queue.
- لا تستخدم arrival time كbusiness order.

## 40. Partition key baseline

- Identity events: identity_id.
- Tenant access: tenant_id.
- Membership: membership_id.
- Sale: sale_id.
- Payment: payment_id.
- Inventory movement: movement_id، والـprojection partition warehouse+variant عندالحاجة.
- Transfer: transfer_id.
- Shift: shift_id.
- Subscription: subscription_id.

Partitioning تقني قد يتغير بشرط الحفاظ علىsemantics.

# القسم الحادي عشر — Idempotency

## 41. Producer idempotency

- CommandId unique withinOwner Context.
- Outbox event unique byDomainEventId/Integration mapping key.
- Re-publish uses sameEventId.

## 42. Consumer idempotency

- Inbox `(consumer_name, event_id)` unique.
- Business effects use source keys، مثل `(source_context, source_event_id, source_line_id)`.
- Provider call handlers تحفظ attempt قبلcall؛ replay لايكرر call إذاoutcome/evidence موجود.
- Document issuance unique by `(source_event_id, document_type)`.
- Inventory movement unique by source line.
- Loyalty earning unique bysale line/earning rule.

## 43. Idempotency retention

Inbox keys تحفظ مدة أطول منأقصى replay window ومنretention المعتمدة للأثر المالي. لايتم حذف dedup records مبكرًا بما يسمح بإعادة الأثر.

# القسم الثاني عشر — Replay and Rebuild

## 44. Replay classes

### Class A — Projection-safe

يمكن Replay تلقائيًا:

- Search projections.
- Dashboards.
- Inventory position rebuild fromledger.
- Report read models.
- Terminal health projections.

### Class B — Domain command with dedupe

Replay مسموح عبرhandler Idempotent:

- SaleCompleted → Inventory movement.
- GoodsReceiptPosted → Inventory movement.
- ReturnPosted → Loyalty reversal.
- EntitlementSetActivated → cache projection.

### Class C — External side effect

لا Replay تلقائيًا:

- Payment charge/refund provider call.
- Email/SMS/WhatsApp send.
- Print job.
- Webhook tocustomer integration.
- File export delivery.

يحتاج evidence check وexplicit replay command/new attempt identity.

### Class D — Destructive/governance

Retention deletion/anonymization لا Replay عشوائيًا؛ Process state/evidence تتحكم.

## 45. Rebuild rules

- Rebuild projection تستخدم event stream أوauthoritative snapshot + deltas.
- لا تنشر Domain/Integration events جديدة منprojection rebuild.
- لا تحدث Audit actor كأنrebuild مستخدم بشري.
- تحفظ rebuild job/version/cutoff.
- تقارن checksums/counts قبلswitch.

# القسم الثالث عشر — Schema Evolution

## 46. Compatible changes داخلنفسmajor version

- إضافة optional field with safe default.
- إضافة enum value فقط إذاConsumers مصممة للتعامل معunknown.
- توسيع metadata غيرالمستخدمة تجاريًا.

## 47. Breaking changes تحتاجmajor جديد

- حذف/إعادةتسمية field.
- تغيير meaning أوunit أوcurrency semantics.
- تغيير required/optional بمايكسرconsumer.
- تقسيم event أودمجها بطريقة تغير business fact.
- تغيير identity/ordering semantics.

## 48. Version lifecycle

`Draft → Proposed → Published → Supported → Deprecated → Retired`

- Published schema immutable.
- Deprecation window موثق.
- Producer قدdual-publish مؤقتًا عندالحاجة.
- Consumer inventory يحدد آخرversion مستخدمة.
- Retire فقط بعدzero active consumers وreplay requirements resolved.

## 49. Upcasting and translation

- Upcaster داخلconsumer/platform يمكن تحويلold schema إلىinternal canonical model.
- لايعيد كتابةevents التاريخية.
- Translation logs errors and source version.
- لايفترض data غيرموجودة؛ يستخدم explicit unknown/default only ifsemantically safe.

# القسم الرابع عشر — Correction, Retraction and Deletion

## 50. Correction events

الحدث الخاطئ لا يحذف. ينشر Owner:

- `...Corrected` معreference_to_event_id.
- `...Reversed` للأثر المالي/ledger.
- `...Superseded` للـpolicy/version.
- `...VoidedByCorrection` للمستندات.

### Payload minimum

- original_event_id.
- correction_reason_code.
- correcting_aggregate/version.
- corrected fields/effect، دوننسخfull event إنلميلزم.

## 51. Retraction

لا يوجد generic `EventRetracted`. كلDomain تحدد معنى التصحيح. Consumers لا تمحو history؛ تطبق أثرًا مقابلًا.

## 52. Privacy deletion

- Event payloads تقللPII منذالبداية.
- عندحقAnonymization، owner قد يصدر `CustomerAnonymized` ويحدث stores التيتسمح semantics.
- Event immutable logs قدتحتفظ pseudonymous IDs وفقlegal/security policy.
- لا تنشر raw PII كحل سهل ثم تعتمد علىحذفها لاحقًا.

# القسم الخامس عشر — Security and Privacy

## 53. Classification rules

### Public

نادر جدًا؛ لا business events عامة افتراضيًا.

### Internal

Catalog/status metadata غيرالحساسة.

### Confidential

Sales amounts، inventory، prices، suppliers، billing.

### Restricted

Identity/security، customer PII، payment evidence، support access، legal holds.

## 54. Field controls

- Masking حسبconsumer.
- Encryption in transit/at rest.
- Topic/stream ACL byContext andclassification.
- Least privilege subscriptions.
- No free-text sensitive reasons inintegration payload.
- Raw provider payload محفوظ فيrestricted evidence store، لاevent bus العام.
- Events inlogs يجب أنتخضع redaction.

# القسم السادس عشر — Retention and Archival

## 55. Retention principles

- Business event retention حسبDomain/legal class.
- Financial/inventory/cash events طويلة ومتصلة بالledger/document retention.
- Operational delivery events أقصر، معaggregate metrics أطول.
- Inbox/outbox retention لايقل عنreplay/idempotency requirement.
- Archived events تبقىread-only معintegrity checks.
- Legal Hold يوقفdestruction للأحداث المطابقة.

## 56. Event integrity

- checksums/hash chain أوWORM controls تحسم فيSecurity/Database Blueprint.
- EventId immutable.
- producer/service identity recorded.
- tamper detection alerts.

# القسم السابع عشر — Testing Contract

## 57. Producer contract tests

لكلEvent:

1. Produced only aftervalid transition.
2. Correct owner andaggregate version.
3. Envelope completeness.
4. Tenant isolation.
5. No prohibited fields/PII leakage.
6. Schema validation.
7. Outbox atomicity.
8. Duplicate command does notcreate duplicate business event.

## 58. Consumer contract tests

1. Supported schema versions.
2. Duplicate delivery.
3. Out-of-order aggregate version.
4. Missing prior event/gap.
5. Late event.
6. Poison payload/dead letter.
7. Retry aftercrash beforecommit/aftercommit.
8. Replay safety.
9. Tenant mismatch rejection.
10. Unauthorized classification rejection.
11. Projection rebuild withoutside effects.
12. Correction/reversal handling.

## 59. End-to-end tests

- SaleCompleted reaches Inventory/Document/Reporting once.
- PaymentOutcomeUnknown blocksduplicate charge andresolves byreconciliation.
- ReturnPosted triggers inventory disposition andrefund independently.
- MembershipScopeChanged invalidates leases/caches.
- EntitlementSetActivated changes capability withoutchangingrole permissions.
- Dead-letter replay repairs missing projection only.
- Old schema remains consumable duringmigration.

# القسم الثامن عشر — Open Decisions

## 60. OD-EVT-001 — Event storage model

هل تحفظ Domain Events كاملًا أمIntegration outbox فقط؟

**Baseline:** لا نفترض full event sourcing. نحتفظ Domain audit/state transition records المطلوبة، وIntegration events/outbox حسبreplay/retention. القرار النهائي فيDatabase/Audit Architecture.

## 61. OD-EVT-002 — Broker and schema registry

غيرمحسوم. العقد مستقل عنKafka/NATS/Rabbit/SQS/Postgres outbox.

## 62. OD-EVT-003 — SaleCompleted payload size

**Baseline:** يحمل line effects الضرورية للInventory/Documents معpayload limits. إذاsales كبيرة جدًا، يستخدم immutable snapshot reference معintegrity checksum وsecured fetch contract.

## 63. OD-EVT-004 — PII event strategy

**Baseline:** IDs + masked/minimal fields. Consumers التيتحتاجcurrent PII تستخدمauthorized query؛ historical delivery usespurpose-bound snapshot inrestricted context.

## 64. OD-EVT-005 — Inventory ordering partition

**Baseline:** movement source exactly-once أهم منglobal order. Position projection ترتب حسبserver posting sequence لكلstock key.

## 65. OD-EVT-006 — Dual publishing

مسموح مؤقتًا فيmajor migration، معmetrics وsunset date. ممنوع dual-publish غيرمراقب طويلًا.

## 66. OD-EVT-007 — External webhooks للـTenants

تحتاج Webhook Contract مستقلة، signing، filtering، retry، replay portal وplan entitlement. لا نكشف internal event bus مباشرة.

## 67. OD-EVT-008 — Event payload localization

Events تحملcodes/values فقط، لاlocalized user messages. Localization فيUI/notification templates.

# القسم التاسع عشر — Prohibited Patterns

## 68. أنماط ممنوعة

- `EntityUpdated` بPayload كامل لكلتغيير.
- استخدامevent كCommand مخفي مثل `PleaseChargeCard`.
- نشرevent قبلCommit.
- حذفevent بعدcorrection.
- تغييرpayload لنفسEventId.
- الاعتماد علىarrival order بينContexts.
- Retry provider call منgeneric event replay.
- وضعraw webhook أوpassword/token فيevent.
- Consumer يكتب مباشرة فيowner tables.
- إعادةنشر event باسمOwner آخر.
- استخدامPII كpartition key.
- تخزينlocalized message كنص الحقيقة.
- اعتبارmessage broker Exactly-once ضمانًا تجاريًا.
- event handler يغيرأكثر منContext داخلdistributed transaction.

# القسم العشرون — Acceptance Gate

## 69. بوابة الاعتماد

لا يعتبر Event Catalog مكتملًا قبل:

1. Event owner واحد لكلbusiness fact.
2. ربط كلState transition الحرجة بDomain Event.
3. تعريف Integration Events الضرورية فقط.
4. تثبيت Envelope وNaming وVersioning.
5. تحديد Payload minimum وData classification.
6. تسجيل Consumers والغرض التجاري.
7. تحديد ordering/partition semantics.
8. تحديد producer/consumer idempotency.
9. تصنيف replay safety لكلhandler.
10. تحديد correction/deprecation strategy.
11. تحديد retention وLegal Hold behavior.
12. Contract tests لكلevent critical.
13. عدم وجود event يحملsecret أوPII غيرمبررة.
14. عدم استخدامevents كبديل Commands أوQueries.
15. ربط Event IDs بالWorkflow Catalog وState Machines وOwnership Matrix.

## 70. القرار التخطيطي الحالي

- تم تحديد أكثر من200 Domain/Integration/Process events أساسية.
- Integration event ليست نسخة منAggregate.
- SaleCompleted هيfact المصدر للآثار اللاحقة، معexact-once business effects عندConsumers.
- Unknown outcomes لهاEvents مستقلة.
- Event delivery At-least-once؛ الأثر Idempotent.
- الترتيب داخلAggregate فقط، لاglobal ordering.
- Replay مصنف حسبProjection، Domain effect، External side effect، Governance.
- Active schemas immutable، والتغيير الكاسرMajor version جديدة.
- Correction Event جديدة، لا تعديل أوحذف للتاريخ.
- Events لا تحتوي localized messages أوraw provider payload أوsecrets.

## 71. المرحلة التالية

**ATHR Audit Catalog v1.0**

سيثبت:

- ما الذي يجب تدقيقه.
- Actor وEffective actor وSupport impersonation.
- Before/after evidence.
- Decision anddenial records.
- High-risk action catalog.
- Audit event schema.
- Tamper resistance.
- Retention andLegal Hold.
- Search, export andinvestigation access.
- Redaction andprivacy.
- Correlation withCommands, Events andProvider evidence.

بعده: **ATHR Permission Matrix v1.0**.