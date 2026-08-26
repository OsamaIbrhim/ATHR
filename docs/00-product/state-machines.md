# ATHR State Machines v1.0

**Planning Baseline — Explicit States, Commands, Guards, Timeouts and Recovery**

## 1. وظيفة الوثيقة

تثبت هذه الوثيقة حالات وانتقالات الـAggregates والـProcess Managers الحرجة في ATHR. لكل State Machine تحدد:

- الحالة الابتدائية.
- الحالات التشغيلية والنهائية.
- الأوامر المسموحة.
- Guards والـPreconditions.
- الأحداث الناتجة.
- Timeouts وScheduled transitions.
- Invalid transitions.
- حالات Recovery وManual intervention.
- Reopen وCorrection policy.

الـState هنا حقيقة Domain وليست Label للواجهة. لا يجوز للـUI أوAPI اختراع انتقال غير موجود في هذه الوثيقة.

## 2. اصطلاحات الحالات

### Initial

حالة بداية قبل اكتمال أول انتقال تجاري.

### Active

حالة تقبل أوامر تشغيلية طبيعية.

### Pending

خطوة بدأت وتنتظر قرارًا أونتيجة أوحدثًا خارجيًا.

### Exception

الحقيقة الأساسية محفوظة، لكن توجد مشكلة تحتاج Recovery أوReconciliation.

### Terminal

لا تقبل أوامر دورة الحياة العادية. التصحيح يتم بAggregate أوعملية مقابلة، لا Reopen عشوائيًا.

### Archived

محفوظة تاريخيًا ولا تستخدم في عمليات جديدة.

### Unknown

نتيجة خارجية غير محسومة. لا تعامل كنجاح أوفشل.

## 3. عقد الانتقال العام

كل Transition حرجة يجب أن تحتوي:

- CommandId/IdempotencyKey.
- ActorId وMembershipId.
- TenantId وScope.
- ExpectedAggregateVersion.
- CurrentState.
- RequestedTransition.
- Guard evaluation evidence.
- Approval reference عند الحاجة.
- ResultingState.
- DomainEvent IDs.
- OccurredAt وRecordedAt وEffectiveAt عند الحاجة.

### القواعد العامة

1. نفس CommandId تعيد نفس النتيجة ولا تنفذ انتقالًا ثانيًا.
2. الانتقال يرفض إذا تغير AggregateVersion، إلا Command مصممة للدمج.
3. لا يسمح بالانتقال إلىState سابقة لتصحيح التاريخ.
4. Terminal state لا تفتح إلا عبر Workflow تصحيح صريح إن نصت الوثيقة.
5. Timeout ينتج Command/Event واضحة، ولا يعدل State في الذاكرة فقط.
6. فشل Side effect بعد Commit لا يعكس State المحلية تلقائيًا.
7. Provider callback لا يفرض State قبل التحقق من Provider reference والمبلغ والعملة والنسخة.
8. الحالة المشتقة لا تخزن كحقيقة متنافسة إذا أمكن حسابها من State سلطوية.

## 4. Error Families للانتقالات

- `STATE_INVALID_TRANSITION`
- `STATE_TERMINAL`
- `STATE_EXPECTED_VERSION_MISMATCH`
- `STATE_GUARD_FAILED`
- `STATE_APPROVAL_REQUIRED`
- `STATE_APPROVAL_EXPIRED`
- `STATE_TIMEOUT_NOT_REACHED`
- `STATE_EXTERNAL_OUTCOME_UNKNOWN`
- `STATE_MANUAL_RECONCILIATION_REQUIRED`
- `STATE_DEPENDENCY_PENDING`
- `STATE_ALREADY_COMPLETED`
- `STATE_CORRECTION_WORKFLOW_REQUIRED`

الـError Catalog اللاحق سيعطي أكوادًا Domain-specific أكثر دقة.

# القسم الأول — Platform, Tenant and Access

## 5. SM-IDN-001 — PlatformIdentity

### States

`PendingVerification → Active → Suspended → Closed`

حالة إضافية: `RecoveryLocked` كحالة مؤقتة أمنية.

### Transitions

- `CreateIdentity`: none → PendingVerification.
- `VerifyRequiredContacts`: PendingVerification → Active.
- `SuspendIdentity`: Active أوPendingVerification → Suspended.
- `ReinstateIdentity`: Suspended → Active بعدSecurity review.
- `LockRecovery`: Active/Suspended → RecoveryLocked.
- `CompleteRecovery`: RecoveryLocked → Active أوSuspended حسبrisk decision.
- `CloseIdentity`: Active/Suspended → Closed وفقPrivacy/retention policy.

### Guards

- Verification proofs صالحة وغير منتهية.
- لا Reinstate بلا actor مصرح وسبب.
- Closed لا تعود Active؛ يحتاج Identity جديدة أوcontrolled restoration قبل irreversible disposition فقط.

### Events

IdentityCreated, IdentityActivated, IdentitySuspended, IdentityReinstated, IdentityClosed.

## 6. SM-IDN-002 — AuthenticationSession

### States

`Issued → Active → Expired`

Transitions بديلة: `Active → Revoked`، `Issued → Revoked`.

### Commands

ActivateSession, RefreshSession, RevokeSession, ExpireSession.

### Guards

- Identity active.
- SecurityVersion وToken family غير revoked.
- Refresh قبلexpiry وضمنrotation rules.

### Terminal

Expired وRevoked. لا Reopen؛ تصدر Session جديدة.

## 7. SM-TEN-001 — Tenant lifecycle

### States

`Provisioning → Trialing أوActive → Restricted → ReadOnly → Suspended → Closing → Closed`

حالات تعافي: `ProvisioningFailed`, `ClosureBlocked`.

### Transitions

- CreateTenant: none → Provisioning.
- StartTrial: Provisioning → Trialing.
- ActivateTenant: Provisioning/Trialing/Restricted → Active.
- RestrictTenant: Active/Trialing → Restricted.
- SetReadOnly: Active/Restricted → ReadOnly.
- SuspendTenant: Active/Restricted/ReadOnly → Suspended.
- RestoreTenant: Restricted/ReadOnly/Suspended → Active إذاcommercial/security guards passed.
- RequestClosure: Active/Restricted/ReadOnly/Suspended → Closing.
- BlockClosure: Closing → ClosureBlocked.
- ResumeClosure: ClosureBlocked → Closing.
- CompleteClosure: Closing → Closed.
- FailProvisioning: Provisioning → ProvisioningFailed.
- RetryProvisioning: ProvisioningFailed → Provisioning.

### Guards

- Activation تحتاج Owner Membership وEntitlementSet فعالة.
- Closure تحتاج عدم وجود open critical obligations أوexception plan.
- Closed لا تعاد Active بعد irreversible disposition.

### Notes

Billing status لا تكتب State مباشرة؛ تنتج AccessMode command وفق policy.

## 8. SM-TEN-002 — Membership

### States

`Invited → PendingAcceptance → Active → Suspended → Offboarding → Inactive`

بدائل: `Invited/PendingAcceptance → Expired أوRevoked`.

### Transitions

- IssueInvitation: none → Invited.
- DeliverInvitation: Invited → PendingAcceptance.
- AcceptInvitation: PendingAcceptance → Active.
- SuspendMembership: Active → Suspended.
- ReinstateMembership: Suspended → Active.
- StartOffboarding: Active/Suspended → Offboarding.
- CompleteOffboarding: Offboarding → Inactive.
- ExpireInvitation: Invited/PendingAcceptance → Expired.
- RevokeInvitation: Invited/PendingAcceptance → Revoked.

### Guards

- Seat entitlement، Tenant status، Role/Scope validity عندacceptance.
- آخر Owner لا يدخلOffboarding قبلOwnership transfer.
- Inactive لا تعود Active؛ تنشأ Membership جديدة أوRehire workflow مع history منفصلة.

## 9. SM-APR-001 — ApprovalRequest

### States

`Draft → Pending → Approved أوRejected أوExpired أوCancelled`

حالة: `Invalidated` عندتغيير payload/policy.

### Transitions

SubmitForApproval, GrantApproval, RejectApproval, ExpireApproval, CancelApproval, InvalidateApproval.

### Guards

- approver مؤهل وفيScope.
- لا Self-approval عندseparation rule.
- Payload hash/version مطابق.
- كل required levels اكتملت قبلApproved.

### Terminal

Approved قرار point-in-time؛ إذا تغير payload تنتقل Invalidated ولا تعاد Pending إلا بطلب جديد.

## 10. SM-DEV-001 — RegisteredDevice

### States

`EnrollmentPending → Active → Restricted → Revoked → Retired`

حالة تعافي: `KeyRotationRequired`.

### Transitions

CompleteEnrollment, RestrictDevice, RestoreDevice, RequireKeyRotation, CompleteKeyRotation, RevokeDevice, RetireDevice.

### Guards

- device fingerprint/attestation valid.
- entitlement capacity.
- لا Active إذا key expired أوTenant suspended وفقpolicy.

### Terminal

Revoked لا تعود Active بنفس credentials. قد يعادEnrollment كعلاقة جديدة.

## 11. SM-DEV-002 — Terminal

### States

`Draft → Provisioned → Active → Maintenance → ReassignmentPending → Retired`

بدائل: `Active/Maintenance → Blocked`.

### Guards

- Active تحتاج Location assignment وDevice active وterminal entitlement.
- Reassignment ممنوعة مع Open Shift أوunsynced critical operations إلا exception approval.
- Retired terminal لا تصدر leases أوتشغل shifts.

## 12. SM-DEV-003 — OfflineAuthorizationLease

### States

`Issued → Active → Expired`

بدائل: `Active/Issued → Revoked`, `Active → Superseded`.

### Transitions

ActivateLease, ExpireLease, RevokeLease, SupersedeLease.

### Guards

- Signed claims valid.
- Device/Membership/Tenant versions compatible.
- لا local extension.

# القسم الثاني — Catalog, Pricing and Promotions

## 13. SM-CAT-001 — Product

### States

`Draft → Active → Restricted → Discontinued → Archived`

### Transitions

- ActivateProduct: Draft → Active.
- RestrictProduct: Active → Restricted.
- LiftRestriction: Restricted → Active.
- DiscontinueProduct: Active/Restricted → Discontinued.
- ReactivateProduct: Discontinued → Active فقط إذاpolicy تسمح والمعرفات لم يعاد تخصيصها.
- ArchiveProduct: Draft/Discontinued/Restricted → Archived.

### Guards

- Variant واحدة على الأقل.
- Required identity/UOM/tax fields.
- Active variants have valid identifiers.
- Archive معStock/open docs تحتاج operational resolution أوallows historical-only archive.

### Terminal

Archived لا تستخدم في معاملات جديدة. Unarchive ليست baseline؛ correction/new product preferred.

## 14. SM-CAT-002 — Variant

### States

`Draft → Active → SaleBlocked أوPurchaseBlocked أوFullyRestricted → Discontinued → Archived`

قد تمثل Sellability وPurchasability بأبعاد منفصلة بدل State واحدة. القرار التنفيذي يحافظ على نفس semantics.

### Guards

- unique option combination.
- SKU/barcode registry valid.
- tracking/UOM changes بعدhistory تحتاج Migration workflow.

## 15. SM-CAT-003 — Identifier assignment

### States

`Reserved → Active → Retired → QuarantinedForReuse أوPermanentlyRetired`

### Rules

- Reserved تنتهي بTimeout إذا لم تستخدم، لكن value history تحفظ حسبpolicy.
- Active لا تنتقل إلىReserved.
- Retired لا تعاد Active لVariant أخرى إلا explicit reuse review وبعدoffline safety window؛ baseline تمنع reuse.

## 16. SM-PRC-001 — PriceBook

### States

`Draft → PendingApproval → Scheduled → Active → Expired → Archived`

بدائل: `PendingApproval → Rejected`, `Scheduled → Cancelled`, `Active → EndedEarly`.

### Transitions

SubmitPriceBook, ApprovePriceBook, RejectPriceBook, ScheduleActivation, ActivatePriceBook, EndPriceBook, ExpirePriceBook, ArchivePriceBook.

### Guards

- currency واحدة.
- no unresolved overlaps.
- effective period valid.
- price floors/approvals satisfied.

### Correction

Active version لا تعدل؛ تنشأ Version جديدة.

## 17. SM-TAX-001 — TaxRuleVersion

### States

`Draft → PendingApproval → Scheduled → Active → Superseded → Archived`

بدائل: Rejected, Cancelled.

### Guards

- jurisdiction/effective time/rounding/inclusive mode complete.
- high-risk approval.
- no retroactive silent activation.

### Terminal

Superseded تبقى مرجعًا للمستندات القديمة.

## 18. SM-PRO-001 — Promotion

### States

`Draft → PendingApproval → Scheduled → Active → Paused → Active → Ended → Archived`

بدائل: Rejected, Cancelled.

### Commands

SubmitPromotion, ApprovePromotion, SchedulePromotion, ActivatePromotion, PausePromotion, ResumePromotion, EndPromotion, CancelPromotion.

### Guards

- eligibility, benefit, priority, stackability, caps and return allocation defined.
- evaluator version compatible معchannels المحددة.
- Active version immutable.

### Timeout

EffectiveEndAt: Active/Paused → Ended.

## 19. SM-PRO-002 — CouponCode

### States

`Issued → Active → Reserved → Redeemed`

بدائل: `Issued/Active/Reserved → Expired أوRevoked`, `Reserved → Active` عندrelease.

### Guards

- usage limits/customer binding/period.
- same reservation idempotent.
- Redeemed terminal؛ restoration بعدvoid/return تتم بnew policy action أوexplicit Reactivated state إذا campaign rules تسمح، وليس تعديل التاريخ.

# القسم الثالث — Sales and Payments

## 20. SM-SAL-001 — Sale

### States

`Draft → Priced → PaymentPending → PaymentResolutionPending → Paid → Completing → Completed`

مسارات أخرى:

- Draft/Priced/PaymentPending → Suspended.
- Suspended → Draft أوPriced بعدrevalidation.
- Draft/Priced/PaymentPending/Suspended → Cancelled.
- Completed → لا Return داخل نفس machine؛ تستخدم Void/Return workflows.
- Completing → CompletionException عندفشل invariant داخلي دائم.

### Commands and transitions

- StartSale: none → Draft.
- Add/Change/RemoveLine: Draft/Priced → Draft ثمReprice.
- PriceSale: Draft/Priced → Priced.
- RequestPayment: Priced → PaymentPending.
- RecordUnknownPayment: PaymentPending → PaymentResolutionPending.
- RecordPaymentFailed: PaymentPending/PaymentResolutionPending → Priced أوPaymentPending حسبremaining tenders.
- RecordPaymentSatisfied: PaymentPending/PaymentResolutionPending → Paid.
- BeginCompletion: Paid → Completing.
- CompleteSale: Completing → Completed.
- SuspendSale: Draft/Priced/PaymentPending → Suspended إذالاunsafe in-flight attempt.
- ResumeSale: Suspended → Draft ثمrepricing أوPriced إذاsnapshots still valid.
- CancelSale: nonterminal eligible states → Cancelled.
- MarkCompletionException: Completing → CompletionException.
- RetryCompletion: CompletionException → Completing.

### Guards

- nonempty valid lines.
- totals balanced.
- current actor/terminal/shift/lease eligible.
- payment satisfied قبلcompletion.
- no unresolved unknown payment beforePaid.
- completed snapshots frozen.

### Terminal

Completed وCancelled. Correction عبرVoid/Return.

## 21. SM-SAL-002 — SaleCompletionProcess

### States

`NotStarted → PaymentVerified → SaleCompleted → DownstreamPending → FullyObserved`

Exception states:

- PaymentRecordedSalePending.
- InventoryPending.
- CashPostingPending.
- DocumentPending.
- CustomerEffectsPending.
- ManualReconciliation.

### Semantics

`SaleCompleted` هوBusiness success boundary. FullyObserved تعني أن كلmandatory consumers سجلت outcome، وليست شرطًا لاعتبار البيع ناجحًا.

### Transitions

PaymentSatisfied event → PaymentVerified → CompleteSale command → SaleCompleted → fan-out downstream commands/events → update individual outcomes → FullyObserved عندما اكتملت required observability.

### Recovery

Retry only missing step. لا تعاد Payment أوSale completion إذا IDs موجودة.

## 22. SM-PAY-001 — Payment

### States

`Created → Processing → Authorized → Captured → Allocated → Settled`

Alternative terminal/exception paths:

- Processing → Declined.
- Processing/Authorized → OutcomeUnknown.
- Authorized → Voided.
- Captured/Allocated/Settled → PartiallyRefunded → Refunded.
- Captured/Allocated → ReversalPending → Reversed.
- OutcomeUnknown → ProcessingReconciliation → Captured/Declined/Failed أوManualReconciliation.
- any active state → Failed فقط عندconclusive internal/provider failure.

### Commands

InitiatePayment, StartAttempt, RecordAuthorization, CapturePayment, RecordCapture, RecordDecline, MarkOutcomeUnknown, AllocatePayment, SettlePayment, StartReconciliation, ResolveReconciliation, RequestRefund, RecordRefund, RequestReversal.

### Guards

- amount/currency ثابتان لكلattempt family.
- provider idempotency key.
- allocations ≤ captured/refundable.
- no duplicate allocation source.
- OutcomeUnknown تمنع charge retry blind.

### Terminal

Declined/Failed/Voided/Reversed/Refunded حسبbusiness path، معhistory محفوظ.

## 23. SM-PAY-002 — PaymentAttempt

### States

`Prepared → Sent → ProviderAccepted → Succeeded`

Alternatives: `Sent/ProviderAccepted → OutcomeUnknown`, `Sent → Declined أوFailedTemporary أوFailedPermanent`, `OutcomeUnknown → ReconciledSucceeded أوReconciledFailed أوManualReview`.

### Timeouts

- Client timeout لا يحدد State؛ إذالاprovider evidence تصبح OutcomeUnknown.
- Temporary failure schedules retry بنفس attempt identity أوnew attempt linked حسبprovider contract.

## 24. SM-PAY-003 — ProviderReconciliationCase

### States

`Open → EvidenceCollecting → Matched → Resolved`

Alternatives: `EvidenceCollecting → Mismatch → ManualReview → Resolved`, `Open → Cancelled` فقط إذاno unresolved financial outcome.

### Guards

Matched requires provider ref, amount, currency, merchant and transaction identity compatible.

# القسم الرابع — Inventory, Transfers and Purchasing

## 25. SM-INV-001 — InventoryMovement

### States

`Draft → Validated → Posted`

Alternatives: `Draft/Validated → Rejected`, `Posted → Corrected` كعلامة مشتقة تشير لحركة مقابلة، ولا تغير الـPosted entry.

### Commands

CreateMovement, ValidateMovement, PostMovement, RejectMovement, CreateCorrectionMovement.

### Guards

- source reference unique.
- quantities/UOM valid.
- warehouses/stock dimensions valid.
- movement balance rules satisfied.

### Terminal

Posted وRejected. لا Edit بعدPosting.

## 26. SM-INV-002 — StockReservation

### States

`Requested → Active → PartiallyConsumed → Consumed`

Alternatives: `Requested → Rejected`, `Active/PartiallyConsumed → Released أوExpired أوCancelled`.

### Guards

- sufficient availability أوapproved override.
- source and expiry valid.
- consumption cannot exceed remaining.

## 27. SM-TRF-001 — TransferOrder

### States

`Draft → Submitted → PendingApproval → Approved → PartiallyShipped → Shipped → PartiallyReceived → Received → Closed`

Exception/terminal paths:

- Draft/Submitted/PendingApproval → Cancelled.
- Approved → Cancelled إذاnothing shipped and reservations released.
- Shipped/PartiallyReceived → DiscrepancyOpen.
- DiscrepancyOpen → PartiallyReceived/Received/Closed بعدresolution.
- Approved/PartiallyShipped/Shipped/PartiallyReceived → Exception.

### Commands

SubmitTransfer, RequestApproval, ApproveTransfer, RejectTransfer, CancelTransfer, ShipQuantities, ReceiveQuantities, RecordDiscrepancy, ResolveDiscrepancy, CloseTransfer.

### Guards

- lines immutable afterapproval exceptRevision workflow.
- shipped ≤ approved remaining.
- received ≤ shipped remaining unless discrepancy recorded.
- duplicate shipment/receipt source prohibited.
- Close requires every quantity resolved.

### Terminal

Closed, Cancelled, Rejected. لاReopen؛ new transfer/correction.

## 28. SM-CNT-001 — StockCount

### States

`Draft → Scheduled → Counting → Submitted → RecountRequired → Submitted → PendingApproval → Approved → PostingPending → Posted → Closed`

Alternatives: Cancelled, Rejected, Exception.

### Guards

- scope valid and no duplicate active count policy conflict.
- observations complete according to scope.
- adjustment proposal balanced.
- Posting exact-once.

### Recovery

PostingPending/Exception → retry movement posting بنفسsource IDs.

## 29. SM-PUR-001 — PurchaseOrder

### States

`Draft → Submitted → PendingApproval → Approved → PartiallyReceived → FullyReceived → Closed`

Alternatives:

- PendingApproval → Rejected.
- Draft/Submitted/PendingApproval → Cancelled.
- Approved → PartiallyCancelled أوCancelled إذاnothing received.
- Approved/PartiallyReceived → RevisionPending → PendingApproval/Approved.

### Guards

- supplier/lines/terms valid.
- revision frozen afterapproval.
- received quantities from GoodsReceipt references only.
- Close when lines fulfilled/cancelled within tolerance.

## 30. SM-PUR-002 — GoodsReceipt

### States

`Draft → Inspecting → Submitted → Posted → InventoryPostingPending → Completed`

قد ينتقل Posted مباشرة إلىCompleted إذاInventory outcome متزامن ضمنcontext integration.

Alternatives: Rejected, Cancelled قبلPosted, Exception.

### Guards

- accepted + quarantined + rejected = received.
- source receipt identity unique.
- batch/serial data complete عندrequired.

### Correction

Completed لا تعدل؛ SupplierReturn أوInventory correction.

## 31. SM-PUR-003 — SupplierInvoice

### States

`Draft → Recorded → Matching → Matched → PendingApproval → Approved → LiabilityPosted → Closed`

Alternatives:

- Matching → MatchException.
- MatchException → Matching أوPendingApprovalException.
- PendingApproval → Rejected.
- Recorded/Draft → Cancelled إذاnot legally issued/posted.

### Guards

- duplicate external invoice check.
- amounts/tax/currency balanced.
- tolerance and approvals.

### Terminal

Closed/Rejected/Cancelled؛ legal correction bycredit/debit document.

## 32. SM-PUR-004 — SupplierReturn

### States

`Draft → PendingApproval → Approved → ShipmentPending → Posted → SupplierResolutionPending → Closed`

Alternative: Rejected, Cancelled قبلPosted, Exception.

Posted creates inventory outbound; supplier credit/replacement resolution separate evidence beforeClosed حسبpolicy.

# القسم الخامس — Returns, Customer Value and Cash

## 33. SM-RET-001 — ReturnRequest

### States

`Draft → Submitted → EligibilityReview → Approved → InspectionPending`

Alternatives: Rejected, Cancelled, Expired, ExceptionReview.

### Guards

- original sale/line and remaining quantity.
- return window/product policy.
- no-receipt exception approval.

### Terminal

Rejected/Cancelled/Expired. Approved request may create Return Aggregate؛ لا تعني item received.

## 34. SM-RET-002 — Return

### States

`Created → Receiving → Inspecting → DispositionPending → ValuationPending → ReadyToPost → Posted`

Exception states:

- InspectionException.
- ValuationException.
- InventoryDispositionPending بعدPosted كprocess outcome، لا تعيد Return state.

### Commands

ReceiveItems, RecordInspection, DecideDisposition, CalculateValuation, PostReturn.

### Guards

- accepted quantities within approved/request/original remaining.
- condition/disposition complete.
- historical price/tax/discount allocation balanced.

### Terminal

Posted. Correction عبرReturn correction/void policy أوnew records، لاEdit.

## 35. SM-REF-001 — Refund

### States

`Draft → Approved → ExecutionPending → Processing → Succeeded`

Alternatives:

- Processing → OutcomeUnknown.
- Processing → FailedTemporary أوFailedPermanent.
- FailedTemporary → Processing.
- OutcomeUnknown → ReconciliationPending → Succeeded/FailedPermanent/ManualReconciliation.
- FailedPermanent → AlternateMethodPending → Processing أوLiabilityOpen.
- LiabilityOpen → Settled.
- Draft/Approved → Cancelled إذاno execution/reservation.

### Guards

- linked entitlement/Return.
- remaining refundable reserved.
- method eligibility and approvals.

### Terminal

Succeeded, Settled, Cancelled. FailedPermanent ليست terminal إذاobligation remains.

## 36. SM-EXC-001 — ExchangeProcess

### States

`Started → ReturnPending → ReturnCompleted → ReplacementSalePending → SettlementPending → Completed`

Exception states:

- ReplacementUnavailable.
- AdditionalPaymentFailed.
- RefundPending.
- ManualResolution.
- Cancelled قبلأيirreversible step فقط.

### Guards

- Completed requires Return posted, replacement Sale completed, difference settlement resolved.
- بعدReturnCompleted لا simple cancel؛ يلزم resolution path.

## 37. SM-CUS-001 — Customer

### States

`Active → Restricted → Blocked → Inactive → Anonymized`

Alternative: `Active/Restricted/Blocked/Inactive → Merged`.

### Transitions

RestrictCustomer, BlockCustomer, UnblockCustomer, DeactivateCustomer, ReactivateCustomer, MergeCustomer, AnonymizeCustomer.

### Guards

- Anonymization respects legal documents/open balances/holds.
- Merged terminal as source identity; aliases resolve to survivor.
- Reactivation fromInactive only before anonymization/merge.

## 38. SM-CUS-002 — CustomerMergeCase

### States

`Open → Investigating → ConflictsPending → Ready → Executing → Completed`

Alternatives: Rejected, Cancelled قبلExecuting, ExecutionException → Executing/ManualReview.

### Guards

- survivor defined.
- balance/consent/identifier conflicts resolved.
- payload version stable.

## 39. SM-AR-001 — ReceivableEntry

Entries Immutable؛ State تخصsettlement:

`Open → PartiallySettled → Settled`

Alternatives: `Open/PartiallySettled → Disputed → Open/Adjusted/Settled`, `Open → WrittenOff` بapproval وledger entry مقابلة.

Balance مشتق ولاState عامة للحساب سوى Active/Restricted/Closed.

## 40. SM-SCR-001 — StoreCreditReservation

### States

`Requested → Active → Consumed`

Alternatives: Rejected, Released, Expired, Cancelled.

### Guards

- online balance available.
- one source consumption.
- no negative available balance.

StoreCredit Entries نفسها Immutable.

## 41. SM-LOY-001 — LoyaltyReservation

نفس نمط Store Credit معStates Requested, Active, Consumed, Released, Expired, Rejected. Points entries Immutable، expiry/reversal Entries جديدة.

## 42. SM-SHF-001 — RegisterShift

### States

`Opening → Open → Suspended → Open → ClosingRequested → Counting → ReconciliationPending → ProvisionalClosed → FinalClosed`

Exception states:

- OpeningException.
- PendingOperations.
- DiscrepancyApprovalPending.
- ClosingException.

### Transitions

OpenShift, SuspendShift, ResumeShift, RequestClose, StartCount, SubmitCount, StartReconciliation, ProvisionalClose, FinalizeClose.

### Guards

- active terminal/membership/location.
- valid CashDrawerSession.
- no conflicting shift.
- FinalClosed requires required operations synchronized and unknown outcomes resolved orapproved exception.

### Terminal

FinalClosed. لا Reopen normal operation؛ corrections separate.

## 43. SM-SHF-002 — CashDrawerSession

### States

`Binding → OpeningCountPending → Open → CountPending → CountSubmitted → RecountRequired → CountSubmitted → Reconciled → Closed`

Alternatives: HandoverPending, Suspended, Exception.

### Guards

- one accountable custodian baseline.
- opening float posted.
- counted denominations/amount valid.
- close aftershift policy.

## 44. SM-CSH-001 — CashReconciliation

### States

`Open → RecountPending → ReviewPending → Approved أوExplained أوCorrectionPending → Resolved`

Alternative: Escalated, RejectedDecision ثمReviewPending.

### Guards

- threshold/approver rules.
- correction movement reference beforeResolved whenrequired.

# القسم السادس — Documents, Delivery and Reporting

## 45. SM-DOC-001 — BusinessDocument

### States

`DraftSnapshot → Validating → Issued`

Alternatives: ValidationFailed → Validating, Cancelled قبلIssued.

بعدIssued توجد علاقات correction وليست تعديل state:

- CorrectedBy.
- VoidedBy.
- CreditedBy.

يمكن تمثيل حالة عرض مشتقة: Issued, Corrected, Voided، لكن الأصل يظل Immutable.

### Guards

- source event unique.
- required legal fields.
- number reserved and unique.
- template/legal version reference.

## 46. SM-DOC-002 — DocumentRender

### States

`Requested → Generating → Ready`

Alternatives: Generating → FailedTemporary/FailedPermanent, FailedTemporary → Generating, Ready → Expired/Deleted وفقretention.

Render لا تغير BusinessDocument.

## 47. SM-PRN-001 — PrintJob

### States

`Queued → Sending → Printed`

Alternatives: FailedTemporary → Queued/Sending, FailedPermanent, Cancelled قبلSending, OutcomeUnknown → Reconciliation/ManualConfirmation.

Reprint تنشئ PrintJob جديدة معCopyType، لا تعيد State القديمة.

## 48. SM-NTF-001 — Notification

### States

`Created → Evaluating → Suppressed أوQueued → Dispatching → Completed`

Completed تعني انتهتchannel plan، وليس بالضرورة delivered لكلchannel.

Alternatives: Expired, Cancelled, PartialDelivery.

### Guards

- purpose class.
- audience authorized.
- consent/preferences/frequency rules.
- deduplication key.

## 49. SM-DLV-001 — DeliveryJob

### States

`Queued → Sending → ProviderAccepted → Delivered`

Alternatives:

- Sending/ProviderAccepted → OutcomeUnknown.
- Sending → FailedTemporary/FailedPermanent.
- ProviderAccepted → Bounced أوExpired.
- FailedTemporary → Queued.
- OutcomeUnknown → ReconciliationPending → Delivered/FailedPermanent/ManualReview.
- Queued → Cancelled.

### Terminal

Delivered, FailedPermanent, Bounced, Expired, Cancelled.

## 50. SM-RPT-001 — ReportRun

### States

`Requested → Authorized → Queued → Running → Validating → Completed`

Alternatives:

- AuthorizationDenied.
- Running → CancelRequested → Cancelled.
- Running/Validating → FailedTemporary/FailedPermanent.
- FailedTemporary → Queued.
- Completed artifact may later Expire دونتغيير run result.

### Guards

- definition version/scope/timezone/currency.
- data completeness policies.
- partial output never Completed.

## 51. SM-EXP-001 — ExportJob

### States

`Requested → ApprovalPending → Approved → Queued → Generating → Ready → Downloaded → Expired → Deleted`

Alternatives: Rejected, Cancelled, FailedTemporary, FailedPermanent.

### Guards

- requester still authorized at generation/download.
- fields/rows limits.
- artifact security and expiry.

Ready may transition directly Expired دونDownload.

# القسم السابع — Governance and Subscription

## 52. SM-HOLD-001 — LegalHold

### States

`Draft → PendingApproval → Active → ReviewDue → Active → ReleasePending → Released`

Alternatives: Rejected, Cancelled قبلActive.

### Guards

- scope/reason/authority valid.
- release requires authorized approval.
- Released لا تعود Active؛ new Hold if needed.

## 53. SM-RETENTION-001 — DataDispositionJob

### States

`Planned → EligibilityChecking → HoldBlocked أوReady → Executing → VerificationPending → Completed`

Exception paths:

- Executing → PartiallyCompleted.
- PartiallyCompleted → Executing أوManualIntervention.
- any pre-execution → Cancelled بسببpolicy change.
- VerificationPending → VerificationFailed → Executing/ManualIntervention.

### Guards

- active policy version.
- no intersecting hold/open obligation.
- owner-specific disposition plan.

### Terminal

Completed أوCancelled. Completion requires evidence from all required stores/providers.

## 54. SM-TCL-001 — TenantClosureProcess

### States

`Requested → ApprovalPending → RestrictionPending → Restricted → ObligationsReview → ExportWindow → GracePeriod → DispositionPending → Closed`

Exception states:

- ClosureBlocked.
- ExportFailed.
- DispositionException.
- ReactivationReview.

### Rules

- قبلDisposition irreversible يمكن Cancel closure/Reactivation حسبcontract.
- بعدirreversible disposition لا restore وهمي.
- Subscription cancellation وTenant closure States منفصلة.

## 55. SM-SUB-001 — Subscription

### States

`Draft → Trialing → Active → PastDue → GracePeriod → Restricted → Suspended → Cancelled → Expired`

Additional paths:

- Active/Trialing/PastDue/GracePeriod → ChangeScheduled.
- ChangeScheduled → Active عندeffective date.
- Active/PastDue/GracePeriod/Restricted/Suspended → CancellationScheduled.
- CancellationScheduled → Active إذاreactivated قبلeffective date، أوCancelled عندdate.
- Cancelled → ReactivationPending → Active أوExpired حسبeligibility.

### Commands

StartTrial, ActivateSubscription, MarkPastDue, StartGracePeriod, RestrictSubscription, SuspendSubscription, RestoreSubscription, SchedulePlanChange, ApplyPlanChange, ScheduleCancellation, CancelCancellation, CancelSubscription, RequestReactivation, ReactivateSubscription, ExpireSubscription.

### Guards

- published PlanVersion.
- billing period consistency.
- payment/contract state according topolicy.
- downgrade no destructive deletion.

### Terminal

Expired. Cancelled قد تكون reactivatable وفقwindow، لذلك ليست دائمًا irreversible.

## 56. SM-BIL-001 — BillingInvoice

### States

`Draft → Finalizing → Issued → PaymentPending → PartiallyPaid → Paid`

Alternatives:

- Issued/PaymentPending/PartiallyPaid → Overdue.
- Overdue → PaymentPending/PartiallyPaid/Paid.
- Issued → Voided فقط إنlegally eligible and unpaid.
- Issued/PartiallyPaid/Paid → Credited أوPartiallyCredited بواسطةCredit Notes، معoriginal immutable.
- Draft/Finalizing → Cancelled/FinalizationFailed.

### Guards

- totals/tax balanced.
- number and legal identity.
- paid amount cannot exceed due except explicit credit balance.

## 57. SM-BIL-002 — CollectionPayment

نفس أساس Payment machine لكن منفصلة عنTenant sales:

`Created → Processing → Succeeded → Allocated`

Alternatives: Declined, FailedTemporary, FailedPermanent, OutcomeUnknown → ReconciliationPending → Succeeded/Failed/ManualReview, Refunded/PartiallyRefunded.

## 58. SM-ENT-001 — EntitlementSet

### States

`Compiling → Validating → Scheduled → Active → Superseded → Expired`

Alternatives: CompilationFailed → Compiling, ValidationFailed → Compiling/ManualReview, Scheduled → Cancelled.

### Guards

- sources Plan/Add-ons/Overrides/Subscription version consistent.
- no unknown entitlement keys.
- effective periods nonoverlapping.
- limits coherent.

### Rule

Active set immutable. التغيير ينتجSet جديدة. Superseded تبقى للـAudit والOffline leases.

## 59. SM-SUB-002 — SubscriptionRenewalProcess

### States

`Scheduled → Calculating → InvoiceIssued → CollectionPending → PaymentUnknown أوPaymentFailed أوPaymentSucceeded → RenewalApplying → EntitlementPending → Completed`

Exception states: Dunning, ManualReconciliation, EntitlementException.

### Semantics

PaymentSucceeded لا تعنيEntitlement active؛ EntitlementPending حالة مستقلة. Completed عندماrenewal and entitlement effects confirmed.

# القسم الثامن — Sync and Process Recovery

## 60. SM-SYN-001 — ClientOperation

### States

`Received → Authenticated → Routed → Executing → Accepted`

Alternatives:

- Received/Authenticated → Rejected.
- Executing → Conflict.
- Executing → PendingReconciliation.
- Routed/Executing → FailedTemporary.
- FailedTemporary → Routed/Executing.
- Conflict → ResolvedAccepted أوResolvedRejected.

### Guards

- unique ClientOperationId.
- device/lease/tenant scope.
- command schema version.
- owner-context invariants.

### Terminal

Accepted, Rejected, ResolvedAccepted, ResolvedRejected. PendingReconciliation غيرterminal.

## 61. SM-SYN-002 — SyncBatch

### States

`Received → Validating → Processing → PartiallyCompleted أوCompleted`

Alternatives: Rejected، FailedTemporary، Cancelled قبلProcessing.

### Rule

Batch status مشتقة منoperation results. Partial لا تعني rollback accepted operations.

## 62. SM-REC-001 — FailedEventDelivery

### States

`Pending → Delivering → Delivered`

Alternatives: FailedTemporary → Pending, FailedPermanent → ManualIntervention, SuppressedByPolicy, DeadLettered → ReplayApproved → Pending.

### Guards

- original EventId ثابت.
- consumer inbox check.
- no provider side effect replay إذاoutcome recorded.

## 63. SM-PROC-001 — Generic ProcessManager

كل Process Manager يستخدم Meta-states موحدة بجانبBusiness states:

- Running.
- WaitingForEvent.
- WaitingForTimeout.
- RetryScheduled.
- ManualIntervention.
- Compensating.
- Completed.
- Cancelled.

### Required fields

- ProcessInstanceId.
- BusinessState.
- LastCompletedStep.
- PendingCommand/Event.
- RetryCount/NextRetryAt.
- LastErrorClass.
- ManualOwner.
- Completion/compensation evidence.

### Rules

- Crash recovery resumes from persisted pending step.
- Completed process لا يعاد تشغيله بنفسidentity.
- Manual resolution command must record decision and evidence.

# القسم التاسع — Timeout and Scheduled Transitions

## 64. Timeout catalog baseline

### Invitation

PendingAcceptance → Expired at ExpiresAt.

### Approval

Pending → Expired at policy deadline؛ escalation events قبلexpiry.

### Coupon reservation

Reserved → Active/Expired according to campaign policy.

### Sale suspension

Suspended → Expired/Cancelled أوReviewRequired؛ لا silent completion.

### Payment attempt

Sent بدونconclusive evidence → OutcomeUnknown، لاFailed.

### Stock reservation

Active → Expired/Released.

### Promotion/Price/Tax

Scheduled → Active at EffectiveAt؛ Active → Ended/Expired at EndAt.

### Offline lease

Active → Expired، local device cannot extend.

### Delivery

Queued/Sending/ProviderAccepted → Expired أوOutcomeUnknown حسبprovider contract.

### Subscription

Trialing → Active/PastDue/Restricted حسبconversion policy؛ PastDue → GracePeriod → Restricted/Suspended حسبdunning schedule.

### Export artifact

Ready/Downloaded → Expired → Deleted.

### Legal Hold

Active → ReviewDue، وليسReleased تلقائيًا.

## 65. قواعد تنفيذ الـTimeout

- Scheduler event Idempotent.
- يعتمد server clock وEffective timezone policy.
- يعيد فحص CurrentState وVersion قبلtransition.
- late timeout لا يعكس transition أحدث.
- missed schedules قابلة للcatch-up.
- timezone/DST rules محفوظة فيpolicy snapshot.

# القسم العاشر — Invalid Transition Baseline

## 66. انتقالات ممنوعة صراحة

- Sale Completed → Draft.
- Sale Completed → Cancelled مباشرة.
- Payment OutcomeUnknown → Failed بسببclient timeout فقط.
- Refund Failed → Return Cancelled.
- Return Posted → Draft.
- InventoryMovement Posted → Draft/Deleted.
- Transfer Shipped → Cancelled معإزالة in-transit.
- GoodsReceipt Posted → Cancelled.
- Shift FinalClosed → Open.
- BusinessDocument Issued → Draft.
- BillingInvoice Paid → Draft/Void without credit correction.
- Membership Inactive → Active بنفسlifecycle record.
- Device Revoked → Active بنفسcredential.
- LegalHold Active → Deleted.
- Tenant Closed → Active بعدirreversible disposition.
- EntitlementSet Active → edited in place.
- Promotion Active → Draft.
- Customer Merged/Anonymized → Active مباشرة.

## 67. Reopen policy

### لا Reopen

- Completed Sale.
- Posted Return.
- Posted Inventory Movement.
- Issued Business Document.
- FinalClosed Shift.
- Paid/issued legal BillingInvoice.
- Redeemed coupon record.
- Posted Cash Movement.

### Reopen أوResume مسموح

- Suspended Draft Sale after revalidation.
- Suspended Membership/Device قبلterminal revocation.
- Paused Promotion.
- FailedTemporary job.
- Closure process قبلirreversible disposition.
- Cancelled subscription ضمنreactivation window حسبpolicy.

### Correction بدلReopen

- Void/Return/Credit note.
- Reverse inventory/cash/loyalty/store-credit entry.
- Price/tax/promotion version جديدة.
- Document correction.

# القسم الحادي عشر — Manual Intervention

## 68. حالات Manual queues الإلزامية

- Payment provider outcome remains unknown.
- Duplicate or mismatched provider capture.
- Sale paid but completion invariant permanently fails.
- Inventory source mapping missing after completed Sale.
- Transfer discrepancy unresolved.
- Supplier invoice match exception above tolerance.
- Refund obligation unresolved after method failures.
- Shift close with unknown payment أوmissing offline batch.
- Customer merge conflict with open balances.
- Data disposition partial failure.
- Tenant closure blockers.
- Subscription payment/entitlement mismatch.
- Failed event dead letter.

### Manual resolution commands

لا يسمح بتغيير State مباشرة منAdmin screen. تستخدم Commands مثل:

- ResolvePaymentReconciliation.
- ApproveInventoryExceptionAdjustment.
- ResolveTransferDiscrepancy.
- SelectAlternateRefundMethod.
- ApproveCashDiscrepancy.
- OverrideMatchException.
- ReleaseClosureBlocker.
- ReplayFailedEvent.

كل Command تحتاج Permission، سبب، Evidence، وربماApproval.

# القسم الثاني عشر — State Machine Traceability

## 69. الربط الإلزامي

كل State وTransition يجب أن ترتبط لاحقًا بـ:

- Workflow ID.
- Aggregate Owner.
- Command Catalog entry.
- Domain Event.
- Permission/Approval.
- Error code.
- API operation.
- Audit event.
- Unit/contract/integration test.
- Offline policy.

أي State تظهر فيDatabase أوAPI أوUI وليست هنا تحتاج ADR وتحديث الوثائق قبل التنفيذ.

## 70. الاختبارات الإلزامية لكل Machine

1. Initial state creation.
2. كل valid transition.
3. كل invalid transition أساسية.
4. Terminal-state protection.
5. Duplicate command idempotency.
6. ExpectedVersion conflict.
7. Guard failure.
8. Approval expiry/invalidation.
9. Timeout on-time and late.
10. Event replay.
11. Crash after commit beforepublish.
12. Downstream failure دونrollback المحلي.
13. Manual recovery.
14. Compensation record.
15. Cross-tenant command rejection.
16. Offline stale/revoked lease عندrelevant.
17. Historical snapshot immutability.
18. Audit completeness.

# القسم الثالث عشر — القرارات المفتوحة

## 71. Open Decisions

### OD-SM-001 — Sale `Paid` state

**Baseline:** Sale تحمل PaymentSatisfied fact، وPaid State واضحة قبلCompleting. Payments تظل owner للتفاصيل المالية.

### OD-SM-002 — Sale completion exception

**Baseline:** CompletionException فقط لفشل داخلي بعدpayment satisfaction وقبلCompleted؛ downstream failures بعدCompleted تتبعProcess states ولا تغيرSale.

### OD-SM-003 — Product dimensions

قد تنفذ sellability/purchasability كOrthogonal states بدلenum مركبة. يجب أن تظل transitions والguards الواردة ثابتة.

### OD-SM-004 — GoodsReceipt completion

**Baseline:** Posted هي الحقيقة التجارية للاستلام؛ Completed تعنيInventory effect observed. إذا صممناها Process projection، Aggregate terminal قد تكونPosted فقط.

### OD-SM-005 — Subscription Cancelled terminality

Cancelled ليست terminal دائمًا؛ Reactivation ممكنة ضمنwindow. Expired هي terminal commercial lifecycle.

### OD-SM-006 — BusinessDocument correction display state

الأصل Immutable؛ `Corrected/Voided` إما derived relationship أوState display. لا يسمح بتعديل snapshot.

### OD-SM-007 — Inventory reservation partitioning

State semantics ثابتة سواءAggregate مستقلة أوpartitioned ledger.

### OD-SM-008 — Terminal Blocked vs Maintenance

Blocked Security/Policy state، Maintenance Operational state؛ يمكن تمثيلهما بأبعاد متعامدة لمنعخلط السبب.

# القسم الرابع عشر — خارج النطاق

## 72. خارج النطاق

- UI status labels والترجمات النهائية.
- Database enum names.
- Workflow engine syntax.
- API endpoint design.
- Provider-specific codes.
- Country-specific fiscal states.
- Full accounting journal states.
- Manufacturing وPayroll state machines.

# القسم الخامس عشر — Acceptance Gate

## 73. بوابة الاعتماد

لا تعتبر State Machines مكتملة قبل:

1. وجود Machine لكل Aggregate/Process lifecycle حرجة.
2. عدم وجود State غامضة مثل `done` أو`error` بلامعنى.
3. تحديد Initial وTerminal states.
4. تحديد Commands وGuards لكلTransition.
5. تحديد timeout transitions.
6. تمثيل Unknown وPartial Success وManual Intervention صراحة.
7. حماية السجلات المكتملة منReopen العشوائي.
8. تحديد Correction/Compensation بدلmutation.
9. ربط Machines بالWorkflow Catalog والOwnership Matrix.
10. تحديد invalid transitions وأسر الخطأ.
11. تحديد events الناتجة لكلtransition فيEvent Catalog التالي.
12. إثبات أن Offline لا تستخدم State machine مختلفة تجاريًا.

## 74. القرار التخطيطي الحالي

- تم تحديد 35+ State Machines للـAggregates والـProcesses الحرجة.
- Unknown outcome حالة مستقلة في Payments وDelivery.
- SaleCompleted لا تتراجع بسبب فشل Inventory أوDocument consumer.
- ReturnPosted لا تعنيRefundSucceeded.
- Shift ProvisionalClosed لا تعنيFinalClosed.
- Active policy/version لا تعدل in-place.
- Posted ledgers والمستندات لا تعاد فتحها.
- Manual intervention تتم بأوامر مصرح بها، لا تعديل State مباشر.
- Timeouts تنفذ Commands Idempotent بعدإعادة فحص الحالة والنسخة.

## 75. المرحلة التالية

**ATHR Event Catalog v1.0**

سيثبت:

- Domain Events.
- Integration Events.
- Event owners.
- Triggering transitions.
- Schema/version rules.
- Required metadata.
- Payload minimization and classification.
- Consumers.
- Ordering and idempotency.
- Replay rules.
- Correction/deprecation strategy.

بعده: **ATHR Audit Catalog v1.0**.