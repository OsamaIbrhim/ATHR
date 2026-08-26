# ATHR Entity Ownership Matrix v1.0

**Planning Baseline — Single Ownership, Source of Truth, Reference and Lifecycle Authority**

## 1. وظيفة الوثيقة

تثبت هذه المصفوفة لكل Entity وFact وLedger وSnapshot وProjection:

- الـBounded Context المالك.
- الـAggregate Root المسؤول.
- مصدر الحقيقة السلطوي.
- من يملك الإنشاء والتعديل والإغلاق والتصحيح.
- كيف تستخدمها Contexts الأخرى.
- هل تستخدم ID أوSnapshot أوEvent أوProjection.
- مستوى الاتساق المطلوب.
- تصنيف البيانات.
- مالك الاحتفاظ والحذف.
- الأحداث التي تنشرها وتستهلكها.

> قاعدة المصفوفة: لكل حقيقة تشغيلية Owner واحد فقط. يسمح بتكرار تمثيلها كSnapshot أوProjection، لكن لا يسمح بوجود مصدرين متنافسين للحقيقة.
> 

## 2. تعريف أعمدة الملكية

### Owner Context

الـContext الوحيدة المسموح لها بتغيير الحقيقة التجارية من خلال Commands وقواعدها.

### Aggregate Root

بوابة الاتساق والتعديل. وجود Entity داخل Aggregate لا يمنح Context خارجية حق تعديلها مباشرة.

### Source of Truth

أحد الأنواع:

- **Aggregate state:** الحالة الحالية السلطوية.
- **Immutable document:** مستند ثابت.
- **Append-only ledger:** Entries هي الحقيقة، والرصيد مشتق.
- **Versioned policy:** النسخ المنشورة هي الحقيقة.
- **External provider evidence:** حقيقة خارجية موثقة محليًا مع reconciliation.
- **Derived projection:** ليست مصدر حقيقة، وقابلة لإعادة البناء.

### Cross-context representation

- **ID Reference:** معرف فقط مع تحقق Tenant/Scope.
- **Historical Snapshot:** نسخة ثابتة وقت العملية.
- **Integration Event:** حقيقة منشورة بعد Commit.
- **Read Projection:** نسخة مشتقة للبحث والعرض.
- **External Reference:** Provider ID مع Namespace.

### Consistency

- **Strong:** داخل Aggregate transaction.
- **Append-exactly-once:** Ledger entry فريدة حسب Source.
- **Eventual:** Projection أوProcess عبر Contexts.
- **Reconciled external:** Provider outcome يحتاج reconciliation.

## 3. قواعد الملكية العامة

1. لا يكتب Context في Storage أوAggregate تابعة لـContext أخرى.
2. الـForeign key التقنية لا تمنح ملكية Domain.
3. Snapshot التاريخية لا تتحدث عند تغيير Master data.
4. Projection لا تستخدم لتنفيذ Invariant مالية أومخزنية حرجة.
5. الرصيد لا يملك Setter؛ مالكه Ledger Entries.
6. المستند المكتمل لا يُعدل؛ التصحيح Entity أوDocument جديدة.
7. Context المستهلك لا يعيد نشر حدث باسم المالك وكأنه مصدره.
8. Retention Context تنفذ Policy، لكن الـDomain owner يحدد القيود التجارية والقانونية على الإتلاف.
9. Reporting يملك Definition وRun، ولا يملك Facts المصدر.
10. Sync يملك Envelope وCursor، ولا يملك Command result التجاري.
11. Audit record تملك إثبات الفعل، ولا تصبح نسخة بديلة من Entity.
12. Provider status لا يكتب مباشرة فوق Business state دون Mapping وReconciliation.

## 4. Matrix — Platform Identity & Authentication

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Platform identity | PlatformIdentity | Aggregate state | IdentityId reference فقط | Strong | Restricted؛ owner ينشئ ويعطل ويؤرشف |
| Verified email/phone | PlatformIdentity | Verification record داخل Aggregate | Masked reference أوverified claim | Strong | PII؛ Retention بالتنسيق مع Privacy |
| Authentication method metadata | PlatformIdentity | Aggregate state؛ secret في secure provider | Capability claim فقط | Strong | Highly restricted؛ لا Snapshot في العمليات |
| Authentication session | AuthenticationSession | Session state | Session/actor claims | Strong مع revocation propagation | Security data؛ TTL قصير |
| Security challenge | SecurityChallenge | Challenge state | Completed/failed event | Strong | Security data؛ expire ثمretain minimal audit |
| Identity risk flag | PlatformIdentity | Versioned risk state | Authorization input claim | Eventual propagation | Restricted؛ reviewable |

**Publishes:** IdentityCreated, IdentitySuspended, ContactVerified, SessionRevoked.

**Consumes:** DeviceRiskChanged، TenantMembershipRevoked عند session reevaluation.

## 5. Matrix — Tenant Organization & Membership

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Tenant identity/status | Tenant | Aggregate state | TenantId + access-mode event | Strong ثمEventual | Confidential؛ closure لا يحذف history |
| Tenant operating defaults | Tenant | Versioned settings | Effective configuration snapshot | Strong؛ cached eventual | Operational configuration |
| Legal entity | LegalEntity | Aggregate state/version | ID + historical legal snapshot | Strong | Legal/confidential؛ long retention |
| Location | Location | Aggregate state | LocationId + selected attributes | Strong؛ projections eventual | Operational؛ close/archive owner |
| Warehouse identity | Warehouse | Aggregate state | WarehouseId reference | Strong | Operational؛ inventory references preserved |
| Membership | Membership | Aggregate state | MembershipId + active/scope claims | Strong؛ revocation propagated promptly | PII/access؛ history retained |
| Scope assignment | Membership | Aggregate entity state | Authorization input | Strong | Security-sensitive؛ effective-dated |
| Tenant invitation | TenantInvitation | Aggregate state | Token reference لا payload كامل | Strong | PII؛ expires and minimal retention |
| Ownership transfer | Tenant / Process | Approved transition record | OwnershipChanged event | Strong | High-risk audit; permanent history |

**Publishes:** TenantAccessModeChanged, LocationOpened/Closed, MembershipActivated/Suspended, MembershipScopeChanged.

**Consumes:** SubscriptionAccessModeChanged، PlatformIdentitySuspended.

## 6. Matrix — Authorization Policy

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Permission definition | Platform Permission Catalog | Versioned policy | PermissionKey | Strong publication | Internal security configuration |
| Tenant role definition | RoleDefinition | Aggregate/version state | RoleId + evaluated grants | Strong؛ caches eventual | Security-sensitive |
| Permission grant/constraint | RoleDefinition | Entity state | Authorization decision input | Strong | Permanent audit of changes |
| Access policy | AccessPolicy | Published version | Policy decision result + version | Strong evaluation | Security-sensitive |
| Approval policy | ApprovalPolicy | Published version | Approval requirement snapshot | Strong | Confidential business rules |
| Approval request/decision | ApprovalRequest | Aggregate state + payload hash | Decision reference/event | Strong | Audit-sensitive؛ retained |
| Authorization decision | Decision service output | Ephemeral decision + audit where sensitive | Allow/deny reason | Point-in-time | Short-lived except sensitive audit |

**Publishes:** RoleChanged, ApprovalRequested/Granted/Rejected, PolicyVersionPublished.

**Consumes:** MembershipScopeChanged, EntitlementSetChanged, DeviceTrustChanged.

## 7. Matrix — Device, Terminal & Offline Trust

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Registered device | RegisteredDevice | Aggregate state | DeviceId + status/trust claims | Strong | Security-sensitive |
| Device credential/key metadata | RegisteredDevice | Versioned metadata; secret secure storage | Verification result فقط | Strong | Highly restricted |
| Terminal identity | Terminal | Aggregate state | TerminalId reference | Strong | Operational |
| Terminal-location assignment | Terminal | Effective-dated assignment | Scope claim + changed event | Strong | Security/operations |
| Peripheral binding | Terminal | Aggregate entity state | Device-local configuration projection | Strong؛ local cache eventual | Operational |
| Offline authorization lease | OfflineAuthorizationLease | Signed/versioned lease record | Lease token/ID | Strong issue; bounded stale use | Security-sensitive؛ short TTL |
| Sync cursor registration | SyncCursorRegistration | Cursor state | Cursor opaque value | Strong per stream/device | Operational metadata |
| Terminal heartbeat/health | Terminal Health Projection | Derived projection | Admin monitoring view | Eventual | Telemetry retention |

**Publishes:** DeviceRevoked, TerminalReassigned, OfflineLeaseIssued/Revoked, TerminalHealthChanged.

**Consumes:** MembershipSuspended, EntitlementSetChanged, TenantAccessModeChanged.

## 8. Matrix — Product Catalog

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Product | Product | Aggregate state/version | ProductId + current projection + snapshots | Strong | Operational master؛ archive owner |
| Variant | Product | Entity state | VariantId + sale/purchase snapshots | Strong | Operational master |
| Variant attribute combination | Product | Entity/value state | Display snapshot | Strong uniqueness | Operational |
| SKU reservation/history | CatalogIdentifierRegistry | Registry state | SKU lookup projection | Strong uniqueness | Operational؛ aliases retained |
| Barcode assignment/history | CatalogIdentifierRegistry | Registry state | Scan projection + historical snapshot | Strong uniqueness | Operational؛ reuse controlled |
| Unit definition | UnitDefinition | Aggregate state | UomId + display snapshot | Strong | Operational master |
| Conversion version | UnitDefinition | Immutable version | Conversion snapshot/reference | Strong | Long retention where used |
| Category | Category | Aggregate state | CategoryId + current reporting projection | Strong | Operational |
| Brand | Brand | Aggregate state | BrandId/snapshot | Strong | Operational |
| Location assortment | LocationAssortment | Aggregate state | POS catalog projection | Strong; projection eventual | Operational per location |

**Publishes:** ProductVariantChanged, IdentifierChanged, UomConversionVersioned, AssortmentChanged.

**Consumes:** LocationClosed، TenantAccessModeChanged.

## 9. Matrix — Pricing, Tax & Promotions

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Price book | PriceBook | Versioned aggregate | PriceBookId + evaluation result | Strong | Confidential commercial data |
| Price entry/tier | PriceBook | Effective-dated entity | Price calculation snapshot | Strong | Long retention if referenced |
| Selected sale price | PricingEngine output | Calculation evidence at request time | Immutable snapshot owned by Sale after acceptance | Point-in-time deterministic | Commercial evidence |
| Tax code | TaxCode | Versioned aggregate | TaxCodeId + calculation snapshot | Strong | Legal configuration |
| Tax rule version | TaxCode | Immutable published version | Tax snapshot | Strong | Legal retention |
| Promotion/version | Promotion | Versioned aggregate | Promotion evidence snapshot | Strong | Commercial data |
| Coupon campaign/code | CouponCampaign | Aggregate state | Code token/eligibility result | Strong | Confidential; code masked |
| Coupon reservation/redemption | CouponCampaign | Entity state / append evidence | Reservation/Redemption reference | Strong exactly-once | Commercial audit |
| Promotion usage counters | Promotion usage partition | Append/aggregate state | Eligibility result | Strong where capped | Operational commercial |

**Publishes:** PriceRuleChanged, TaxRuleChanged, PromotionActivated/Ended, CouponRedeemed.

**Consumes:** ProductVariantChanged, CustomerGroupChanged, LocationClosed.

## 10. Matrix — Sales

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Sale | Sale | Aggregate state then immutable completed state | SaleId + integration events + document snapshot | Strong | Financial/operational؛ legal retention |
| Sale line | Sale | Entity state | LineId + immutable snapshots | Strong | Financial history |
| Product snapshot on line | Sale | Historical Snapshot | Owned only by Sale/document consumers | Immutable | Legal/commercial retention |
| Price/tax/discount snapshot | Sale | Calculation snapshot accepted by Aggregate | Documents, returns, reporting | Strong then immutable | Financial/legal |
| Sale totals | Sale | Derived and validated within Aggregate | Snapshot/event | Strong | Financial |
| Sale lifecycle status | Sale | Aggregate state machine | Status event/projection | Strong | Operational/legal |
| Sale number reservation | SaleNumberReservation أوDocument sequence | Reservation state | Number reference | Strong uniqueness | Legal operational |
| Payment satisfaction fact | Sale | Accepted Payment event reference | SaleCompleted event | Eventual input thenStrong transition | Financial evidence |
| Inventory fulfillment outcome | Inventory owner | ليس مملوكًا لـSale | Reference/projection only | Eventual | Operational |

**Writes allowed:** Sales commands فقط.

**Publishes:** SaleStarted, SalePriced, PaymentRequested, SaleCompleted, SaleCancelled.

**Consumes:** PaymentSatisfied/Failed, EntitlementDecision, Catalog/Pricing snapshots.

## 11. Matrix — Payments

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Payment intent/transaction | Payment | Aggregate state | PaymentId + status events | Strong | Highly confidential financial |
| Payment attempt | Payment | Entity state + provider evidence | Attempt reference/status | Strong local; external reconciled | Restricted; provider IDs masked |
| Authorization/capture outcome | Payment | Mapped provider evidence | Domain event | Reconciled external | Financial evidence |
| Payment allocation | Payment | Entity state | AllocatedTo reference event | Strong | Financial/legal |
| Payment ledger entry | Payment Ledger | Append-only ledger | Balance/projection/events | Append-exactly-once | Financial long retention |
| Payment method configuration | PaymentMethodConfiguration | Versioned aggregate | Eligibility projection | Strong | Confidential configuration |
| Provider reconciliation case | ProviderReconciliationCase | Case state + evidence | Resolution event | Strong case; external reconciled | Restricted audit |
| Refund provider transaction | Payment | Linked child/new transaction state | Refund outcome event | Reconciled external | Financial/legal |

**Publishes:** PaymentCaptured, PaymentAllocated, PaymentOutcomeUnknown, PaymentReconciled, RefundSucceeded/Failed.

**Consumes:** PaymentRequested, RefundRequested, Shift context references.

## 12. Matrix — Inventory & Transfers

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Inventory movement | InventoryMovement | Immutable posted aggregate | Movement event/projection | Append-exactly-once | Financial/operational long retention |
| Movement line | InventoryMovement | Immutable entity | Source reference | Strong posting | Operational history |
| On-hand quantity | Inventory Ledger | Derived from movements | Inventory position projection | Strong posting; projection eventual | Operational/financial |
| Reserved quantity | StockReservation | Active reservation state/ledger | Availability projection | Strong | Operational |
| Available quantity | Derived fact | On-hand minus valid reservations | Read projection only | Derived | Operational |
| Batch/serial stock dimension | Inventory position/movement | Ledger dimensions | Reference/projection | Strong uniqueness where serial | Traceability retention |
| Transfer order | TransferOrder | Aggregate state | Status events/projection | Strong | Operational long retention |
| Shipment | TransferOrder | Entity + posted movement references | Shipment event | Strong then inventory eventual | Operational |
| Receipt/discrepancy | TransferOrder | Entity state | Receipt/discrepancy event | Strong | Operational/audit |
| Stock count | StockCount | Aggregate state | Count result projection | Strong | Operational/audit |
| Count adjustment | InventoryMovement | Posted movement | Movement event | Append-exactly-once | Financial/operational |
| Inventory cost layer/value | Inventory Costing subdomain | Cost ledger/model | Cost snapshot/projection | Strong/append | Confidential financial |

**Publishes:** InventoryMovementPosted, ReservationChanged, TransferStateChanged, StockCountPosted.

**Consumes:** SaleCompleted, GoodsReceiptAccepted, ReturnDispositionApproved, SupplierReturnPosted.

## 13. Matrix — Purchasing & Supplier Operations

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Supplier | Supplier | Aggregate state | SupplierId + snapshots | Strong | Confidential/PII |
| Supplier product reference | Supplier | Entity state | Purchasing lookup | Strong | Commercial |
| Purchase requisition | PurchaseRequisition | Aggregate state | Status/approval references | Strong | Internal commercial |
| RFQ/quote | RequestForQuotation | Aggregate state/version | Comparison projection | Strong | Confidential commercial |
| Purchase order | PurchaseOrder | Aggregate state; approved revision immutable | PO snapshot/reference | Strong | Commercial/legal retention |
| Goods receipt | GoodsReceipt | Aggregate state then posted immutable | Inventory source event | Strong thenEventual | Operational/legal |
| Inspection/disposition | GoodsReceipt | Entity state | Inventory disposition event | Strong | Operational evidence |
| Supplier invoice | SupplierInvoice | Aggregate state/document snapshot | Liability/match events | Strong | Financial/legal |
| Three-way match result | SupplierInvoice | Calculation evidence | Approval/exception projection | Point-in-time deterministic | Financial audit |
| Supplier return | SupplierReturn | Aggregate state | Inventory outbound event | Strong thenEventual | Operational/legal |

**Publishes:** PurchaseOrderApproved, GoodsReceiptPosted, SupplierInvoiceMatched/ExceptionRaised, SupplierReturnPosted.

**Consumes:** ProductChanged, InventoryMovementPosted, ApprovalDecision.

## 14. Matrix — Returns, Refunds & Exchanges

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Return request | ReturnRequest | Aggregate state | Case/status projection | Strong | Customer/operational |
| Eligibility decision | ReturnRequest | Decision evidence | Approval/status event | Strong | Audit retention |
| Return | Return | Aggregate state then immutable posted state | ReturnPosted event/document snapshot | Strong | Financial/legal |
| Inspection/condition | Return | Entity state | Inventory disposition input | Strong | Operational evidence |
| Return valuation | Return | Historical calculation snapshot | Refund/store-credit input | Strong | Financial/legal |
| Disposition decision | Return | Entity state | Inventory command/event | Strong | Operational |
| Refund business request | Refund | Aggregate state | Payment/Store Credit command references | Strong | Financial/legal |
| Refund provider outcome | Payments | ليس مملوكًا هنا | Consumed event/reference | Eventual/reconciled | Financial |
| Exchange process | Exchange | Process aggregate state | Return/Sale/Settlement references | Saga consistency | Financial/legal |
| Void request | VoidRequest | Aggregate state | Commands to Sale/Payment | Saga consistency | High-risk audit |

**Publishes:** ReturnPosted, RefundRequested, ExchangeStarted/Completed, RefundLiabilityCreated.

**Consumes:** SaleSnapshotAvailable, RefundSucceeded/Failed, InventoryDispositionPosted, StoreCreditIssued.

## 15. Matrix — Customer, Receivables, Store Credit & Loyalty

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Customer profile | Customer | Aggregate state | CustomerId + current projection + snapshots | Strong | PII؛ privacy-controlled |
| Contact/address | Customer | Entity state | Purpose-limited snapshot | Strong | PII |
| Consent record | Customer | Append/versioned entity state | Consent decision claim | Strong | Privacy/legal retention |
| Customer merge case | CustomerMergeCase | Case state + mappings | Alias resolution event | Strong | PII/audit |
| Receivable entry | ReceivableAccount | Append-only ledger | Balance/projection/events | Append-exactly-once | Financial/legal |
| Receivable balance | ReceivableAccount | Derived from ledger | Credit decision projection | Derived | Financial confidential |
| Credit limit revision | ReceivableAccount | Effective-dated state | Eligibility result | Strong | Confidential |
| Store credit entry | StoreCreditAccount | Append-only ledger | Balance/reservation events | Append-exactly-once | Financial |
| Store credit balance | StoreCreditAccount | Derived | Payment eligibility projection | Derived | Financial |
| Loyalty points entry | LoyaltyAccount | Append-only ledger | Balance/tier projection | Append-exactly-once | Customer behavioral data |
| Loyalty tier history | LoyaltyAccount | Versioned/append history | Pricing/promotion claim | Eventual claim with version | Customer behavioral data |

**Publishes:** CustomerChanged/Merged/Anonymized, ConsentChanged, ReceivableBalanceChanged, StoreCreditBalanceChanged, LoyaltyTierChanged.

**Consumes:** SaleCompleted, ReturnPosted, RefundSettlementDecision.

## 16. Matrix — Shift & Cash Operations

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Register shift | RegisterShift | Aggregate state | ShiftId + status events | Strong | Operational/audit |
| Cash drawer session | CashDrawerSession | Aggregate state | DrawerSessionId reference | Strong | Financial operational |
| Opening float | CashDrawerSession / CashMovement | Immutable movement/evidence | Shift summary | Append-exactly-once | Financial |
| Cash movement | CashMovement | Append-only ledger entry | Movement event/projection | Append-exactly-once | Financial/legal |
| Expected cash | Cash ledger | Derived from movements | Closing snapshot | Derived | Financial confidential |
| Counted cash | CashDrawerSession | Count snapshot | Reconciliation input | Strong | Financial confidential |
| Discrepancy | CashReconciliation | Aggregate state | Approval/report event | Strong | Highly confidential/audit |
| Handover | CashDrawerSession | Entity state/evidence | Audit projection | Strong | Operational audit |
| Business day reference | Tenant/Location policy | Reference فقط | Snapshot in Shift | Point-in-time | Operational |
| Terminal health | Device context projection | ليس مملوكًا لـShift | Read only | Eventual | Telemetry |

**Publishes:** ShiftOpened/Closed, CashMovementPosted, DrawerCountSubmitted, CashDiscrepancyRecorded.

**Consumes:** CashPaymentCaptured, CashRefundSucceeded, TerminalRevoked, OfflineSyncStatusChanged.

## 17. Matrix — Documents, Notifications & Delivery

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Business document | BusinessDocument | Immutable issued document | DocumentId + secured render | Strong issue; immutable | Legal/financial retention |
| Document snapshot | BusinessDocument | Historical snapshot | Render/report evidence | Immutable | Legal/PII minimized |
| Document number | DocumentNumberSequence | Sequence/reservation state | Human number reference | Strong uniqueness | Legal operational |
| Template version | Document Template | Published version | TemplateVersionId | Strong | Configuration/legal |
| Render artifact | DocumentRender | Derived artifact + checksum | Temporary secured file | Rebuildable | PII; shorter retention when possible |
| Print job/attempt | PrintJob | Attempt state | Status projection | Strong per job | Operational audit |
| Notification | Notification | Aggregate state | NotificationId/status | Strong | Purpose-classified |
| Recipient snapshot | Notification/DeliveryJob | Historical destination snapshot | Masked status | Immutable per attempt | PII |
| Delivery attempt | DeliveryJob | State + provider evidence | Delivery status event | External reconciled | PII/operational |
| Notification rule | NotificationRule | Published version | Rule reference | Strong | Configuration |

**Publishes:** DocumentIssued, PrintFailed/Succeeded, DeliveryStatusChanged.

**Consumes:** Source domain completion events, ConsentChanged, MembershipScopeChanged.

## 18. Matrix — Reporting, Audit, Retention & Compliance

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Report definition | ReportDefinition | Published version | DefinitionId/version | Strong | Internal configuration |
| Metric definition | ReportDefinition | Versioned entity | Documentation/UI metadata | Strong | Internal |
| Report run | ReportRun | Run state + parameter snapshot | Result reference | Strong job lifecycle | May contain confidential data |
| Dashboard projection | Projection owner | Derived projection | Read only | Eventual | Scope-filtered |
| Report schedule | ReportSchedule | Aggregate state | Execution command | Strong | Security-sensitive recipients |
| Export job | ExportJob | Job state | Temporary artifact | Strong job; artifact derived | Sensitive; short retention |
| Audit record | Audit stream/record | Append-only record | Investigation projection | Append-exactly-once | Restricted; long retention |
| Retention policy | RetentionPolicy | Published version | Disposition decision | Strong | Governance configuration |
| Legal hold | LegalHold | Aggregate state | Hold intersection decision | Strong | Highly restricted |
| Disposition job | DataDispositionJob | Job state + deletion evidence | Completion/failure event | Strong job; distributed idempotent steps | Governance audit |
| Anonymized aggregate result | Original Domain owner + disposition orchestration | Domain-correct transformed state | Completion evidence | Saga consistency | Privacy controlled |

**Publishes:** ReportCompleted, ExportGenerated/Expired, LegalHoldChanged, DataDispositionCompleted/Failed.

**Consumes:** Integration events from all domains, Authorization changes, Tenant closure events.

## 19. Matrix — SaaS Billing, Subscription & Entitlements

| Entity أوFact | Aggregate Root | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Plan | Plan | Aggregate state | PlanId/current catalog projection | Strong | Commercial configuration |
| Plan version/price | Plan | Immutable published version | Subscription snapshot | Strong | Commercial/legal |
| Subscription | Subscription | Aggregate state | Status/access-mode events | Strong | Commercial confidential |
| Trial/grace/cancellation | Subscription | Entity/effective state | Entitlement compiler input | Strong | Commercial |
| Billing account | BillingAccount | Aggregate state | Billing snapshot | Strong | PII/financial |
| Billing invoice | BillingInvoice | Immutable issued invoice | Document/payment reference | Strong | Financial/legal |
| Collection payment | CollectionPayment | State + provider evidence | Paid/failed event | External reconciled | Highly confidential |
| Usage record | UsageMeter | Append-only usage entries | Aggregated usage | Append-exactly-once | Commercial telemetry |
| Entitlement set | EntitlementSet | Compiled/versioned state | Signed/effective claims | Strong compile; propagation eventual | Security/commercial |
| Feature/limit decision | Entitlement decision service | Point-in-time result | Allow/deny/remaining | Point-in-time | Operational |
| Manual commercial override | EntitlementSet أوSubscription override | Effective-dated approved state | Compiled entitlement | Strong | High-risk audit |

**Publishes:** SubscriptionChanged/Suspended/Cancelled, BillingInvoicePaid/Overdue, EntitlementSetChanged.

**Consumes:** TenantCreated/Closed, UsageReported, Provider payment evidence.

## 20. Matrix — Sync & Offline Application Context

| Entity أوFact | Owner | Source of Truth | الاستخدام خارج Context | Consistency | Classification / Lifecycle |
| --- | --- | --- | --- | --- | --- |
| Client operation envelope | Sync context | Immutable envelope | Routed command metadata | Append/deduplicated | Operational/security |
| ClientOperationId result | Sync context | Execution receipt pointing owner result | Device ACK | Exactly-once identity | Operational retention |
| Sync batch | Sync context | Batch state | Per-operation result | Strong batch metadata | Operational |
| Projection stream cursor | Sync context | Cursor state | Opaque cursor | Strong per device/stream | Operational |
| Offline business command result | Domain owner | Owner Aggregate/Ledger | Referenced in sync receipt | Domain-defined | حسب الـDomain |
| Conflict decision | Domain owner أوProcess policy | Decision record | Sync rejection/resolution | Domain-defined | Audit |
| Device catalog snapshot | Projection publisher | Derived/versioned snapshot | Local cache | Eventual/bounded stale | Scope-filtered |

## 21. Cross-context fact ownership decisions

| Fact | Owner | Contexts التي لا تملكه | التمثيل المسموح |
| --- | --- | --- | --- |
| Current product name | Product Catalog | Sales, Purchasing, Reports | ID/current projection؛ historical docs use snapshot |
| Sold product description | Sales | Catalog | Immutable SaleLine snapshot |
| Current customer contact | Customer | Sales, Documents | ID/current authorized lookup |
| Customer shown on issued invoice | BusinessDocument/Sale snapshot | Customer master | Immutable historical snapshot |
| Current price rule | Pricing | Sales | Evaluation input |
| Price charged | Sales | Pricing | Accepted immutable snapshot |
| Payment provider outcome | Payments | Sales, Returns | Mapped event/reference |
| Sale paid status | Sales | Payments | Derived from accepted allocation events inside Sale lifecycle |
| Stock on hand | Inventory Ledger | Sales, Catalog, Purchasing | Availability projection |
| Expected drawer cash | Cash Ledger | Payments | Closing projection/snapshot |
| Return eligibility | Returns | Sales | Decision result based on original snapshots |
| Refund execution outcome | Payments أوStore Credit owner | Returns | Outcome event |
| Tenant feature entitlement | Billing/Entitlements | Authorization, Product domains | Versioned effective claim |
| User permission | Authorization | Billing | Decision; final access is permission ∩ scope ∩ entitlement |
| Report metric result | ReportRun/Projection | Source domains | Derived result, not operational truth |

## 22. Lifecycle authority matrix

### Create authority

- Platform identity: Identity context.
- Tenant/locations/memberships: Tenant context.
- Product/Variant: Catalog.
- Sale: Sales.
- Payment: Payments.
- Inventory Movement: Inventory فقط، حتى لو Source event خارجي.
- Return: Returns.
- Business Document: Documents بناءً على source event.
- Billing invoice: SaaS Billing.

### Update authority

- Master data updates من Owner فقط.
- Historical snapshots لا Update لها.
- Ledger entries لا Update لها.
- External outcome يضاف كEvidence/transition، لا overwrite غير مدقق.

### Close/Archive authority

- Aggregate owner ينفذ Preconditions.
- Tenant/Retention policy قد تمنع عمليات جديدة أوتطلب disposition، لكنها لا تغير Aggregate history مباشرة.

### Correction authority

- Owner يصدر Correction command/record.
- لا يسمح Reporting أوSupport أوDatabase administrator بتغيير حقيقة Domain خارج المسار.

## 23. Data classification ownership

### Domain owner مسؤول عن

- تعيين Data class للحقول والـEvents.
- تحديد الحد الأدنى من payload الخارجي.
- Masking requirements.
- Legal/business retention constraints.
- Anonymization semantics.

### Governance context مسؤول عن

- Retention policy orchestration.
- Legal holds.
- Disposition jobs.
- إثبات التنفيذ والفشل.

### Security architecture مسؤولة لاحقًا عن

- Encryption.
- Key ownership.
- Storage segregation.
- Access logging.
- DLP and export controls.

## 24. Event publisher and consumer rules

1. Publisher هو Owner الحقيقة فقط.
2. المستهلك لا يفترض ترتيبًا عالميًا بين Aggregates.
3. Consumer يسجل EventId قبل تطبيق Side effect.
4. Schema version mandatory.
5. Event payload لا يحمل Aggregate كاملًا دون ضرورة.
6. PII تمر عبر classification وpurpose review.
7. Snapshot داخل الحدث لا تصبح Master record.
8. Replayed event يعيد Projection، ولا يكرر Provider call أوDocument delivery.
9. Event correction تستخدم Event جديدة، لا تعديل Event قديمة.
10. Consumers تتحمل وصول Duplicate وLate events.

## 25. Retention authority matrix

| Data class | Business owner | Policy owner | Default end action | موانع الإتلاف |
| --- | --- | --- | --- | --- |
| Sales/returns/payments documents | Source domain + Documents | Retention/Legal | Archive/retain | Fiscal law, dispute, legal hold |
| Inventory/cash/payment ledgers | Ledger context | Retention/Legal | Retain/archive | Accounting, reconciliation, hold |
| Customer PII | Customer | Privacy/Retention | Anonymize/delete by field | Open balances, legal docs, hold |
| Authentication/session data | Identity | Security/Retention | Expire/delete; retain minimal audit | Incident investigation/hold |
| Device telemetry | Device context | Operations/Retention | Aggregate/delete | Security incident/hold |
| Exports/renders | Reporting/Documents | Retention | Expire/delete | Explicit legal evidence/hold |
| Audit records | Audit context | Security/Legal | Retain/archive | Policy minimum/hold |
| Subscription billing | SaaS Billing | Finance/Legal | Retain/archive | Tax/accounting/hold |

## 26. Prohibited ownership patterns

- `products.stock_quantity` كحقل قابل للتعديل داخل Catalog.
- `sales.payment_status` يكتب مباشرة من Provider webhook دون Payments mapping.
- `payments.cash_drawer_balance` داخل Payment.
- `returns.inventory_restored = true` دون Inventory movement reference.
- `users.role` داخل PlatformIdentity كبديل Membership/RoleAssignment.
- `tenant.plan_features` تعدل يدويًا خارج EntitlementSet.
- `invoice_pdf` كمصدر الحقيقة للمبيعات.
- `report_total` يستخدم لإصلاح Ledger.
- `last_write_wins` عام للعمليات Offline.
- Copy كامل من Customer أوProduct داخل Context أخرى ثمتحديثه كMaster.
- Hard delete Aggregate مستخدمة تاريخيًا بسبب Archive request.
- Shared mutable table يكتب فيها أكثر من Context دون Owner.

## 27. Open decisions

### OD-OWN-001 — StockReservation ownership shape

**Baseline:** Inventory owner؛ Aggregate مستقلة للحجوزات طويلة أوعالية التنافس، مع Position projection.

### OD-OWN-002 — Document number owner

**Baseline:** Documents context تملك sequence؛ Sales/Purchasing تحفظ number reference. Country-specific fiscal adapter قد يشارك في الحجز دون امتلاك المستند.

### OD-OWN-003 — Supplier liability

**Baseline:** SupplierInvoice داخل Purchasing؛ Liability ledger مؤقتًا داخل Purchasing Finance subdomain حتى اعتماد Accounting context.

### OD-OWN-004 — Product media binary ownership

**Baseline:** Catalog يملك metadata والعلاقة؛ Object Storage يملك binary تقنيًا، وRetention policy تنسق الحذف.

### OD-OWN-005 — Business day aggregate

**Baseline:** Business day policy مملوكة Location/Tenant، بينما Shift تحفظ reference/snapshot. نضيف BusinessDay aggregate فقط إذا أصبح لها إغلاق مالي مستقل.

### OD-OWN-006 — Customer merge references

**Baseline:** Customer context يملك alias resolution؛ Contexts الأخرى لا تعيد كتابة historical CustomerId، وتستخدم canonical resolver للعرض الحالي.

### OD-OWN-007 — Promotion usage counters

**Baseline:** Pricing/Promotion owner؛ تقسيم تقني إلىBuckets مسموح بشرط بقاء Invariant الاستخدام المركزي.

### OD-OWN-008 — Accounting Context

**Baseline:** غير موجود حاليًا. لا نسمّي تقارير أوSupplier balances General Ledger قبل تصميم Chart of Accounts وJournal ownership.

## 28. Acceptance Gate

لا تعتبر Entity Ownership Matrix مكتملة قبل:

1. وجود Owner واحد لكل Aggregate وLedger وFact حرجة.
2. تحديد Source of Truth لكل رصيد وحالة ومقياس.
3. إزالة أي Shared mutable ownership.
4. تحديد ID مقابل Snapshot لكل Cross-context reference.
5. تحديد Publisher وConsumer للأحداث الرئيسية.
6. تحديد Strong/Eventual/Reconciled consistency.
7. تحديد Lifecycle authority للإنشاء والتعديل والتصحيح والإغلاق.
8. تحديد Data classification وRetention owner.
9. ربط كل Entity بالـDomain Model وBusiness Rules.
10. تحويل الحالات العابرة للـContexts إلى Workflows/Process Managers.
11. مراجعة Offline ownership ومنع Device من امتلاك الحقيقة النهائية.
12. حسم القرارات التي تمنع Workflow Catalog.

## 29. القرار التخطيطي الحالي

- المصفوفة تعتمد Single-writer لكل Fact.
- الـSnapshots مملوكة للمعاملة التي استخدمتها، وليست Copies قابلة للمزامنة مع Master.
- كل Balance مملوكة لـAppend-only ledger.
- Documents وReports وSync لا تملك حقائق التشغيل الأصلية.
- Billing Entitlements لا تمنح Permission، وAuthorization لا تمنح Feature غير مشتركة في الخطة.
- Retention تنسق الإتلاف، لكن Domain owner يحدد معنى Anonymization والقيود.
- Historical IDs لا تعاد كتابتها عند Merge أوRename أوReorganization.
- Provider outcomes تمر عبر Owner Context وReconciliation قبل التأثير على Business status.

## 30. المرحلة التالية

**ATHR Workflow Catalog v1.0**

سيحول المالكين والحدود في هذه المصفوفة إلى رحلات End-to-End، ويحدد لكل Workflow:

- Trigger.
- Actor.
- Preconditions.
- Commands.
- Aggregate transitions.
- Cross-context events.
- Saga/Process Manager.
- Success state.
- Partial failure.
- Retry/compensation/reconciliation.
- Offline behavior.
- Permissions and approvals.
- Audit and acceptance tests.

بعده: **ATHR State Machines v1.0**.