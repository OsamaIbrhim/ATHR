# ATHR Workflow Catalog v1.0

**Planning Baseline — End-to-End Journeys, Process Managers, Failure and Recovery**

## 1. وظيفة الوثيقة

يحوّل هذا الكتالوج الـBusiness Rules والـDomain Model وEntity Ownership Matrix إلى رحلات تشغيلية End-to-End. كل Workflow توضح:

- Trigger.
- Primary actor وSupporting actors.
- Owner Context وProcess Manager.
- Preconditions.
- Commands.
- Aggregate transitions.
- Cross-context events.
- Success outcome.
- Partial-success outcomes.
- Failure classification.
- Retry, compensation and reconciliation.
- Offline policy.
- Permission and approval requirements.
- Audit evidence.
- Required acceptance scenarios.

هذه الوثيقة لا تحدد شكل الـAPI أوUI أوDatabase، ولا تعني أن كل Workflow خدمة تقنية مستقلة.

## 2. تصنيف الرحلات

### Local Aggregate Workflow

تبدأ وتنتهي داخل Aggregate واحدة، ولا تحتاج Saga، مثل تعديل Draft Product.

### Cross-Aggregate Workflow

تنسق Aggregates متعددة داخل Context واحدة باستخدام Application service أوProcess record.

### Cross-Context Process

تحتاج Process Manager/Saga وأحداث Idempotent، مثل Sale completion وExchange.

### Provider-Reconciled Workflow

تعتمد نتيجة خارجية قد تكون Unknown، مثل Electronic payment أوEmail delivery.

### Scheduled Workflow

تبدأ بزمن أوSchedule، مثل Subscription renewal أوRetention job.

### Offline-Originated Workflow

تبدأ من Device باستخدام Lease وClientOperationId ثم تنفذها الـContext المالكة.

## 3. القواعد العامة لكل Workflow

1. لكل Workflow معرّف ثابت `WF-<DOMAIN>-NNN`.
2. كل Command تحمل IdempotencyKey أوClientOperationId عند احتمال التكرار.
3. نجاح خطوة لا يُمحى عند فشل خطوة لاحقة.
4. `Unknown` حالة حقيقية، وليست Failure أوSuccess تخمينيًا.
5. Retry يعيد نفس الأثر المطلوب؛ Compensation تسجل أثرًا جديدًا.
6. Process Manager لا يعدل Aggregates مباشرة؛ يرسل Commands للمالكين.
7. كل خطوة تحفظ CorrelationId وCausationId.
8. Timeout لا يثبت أن الأمر لم ينفذ.
9. أحداث الـOutbox تنشر بعد Commit المحلي.
10. Consumers تستخدم Inbox/Deduplication.
11. العمليات Offline تخضع لنفس Invariants، مع Boundaries أضيق لا قواعد أبسط.
12. الـUI تعرض الحقيقة المرحلية بدقة، مثل `Sale completed; receipt printing failed`.
13. Manual intervention حالة معلنة لها Queue وOwner وSLA.
14. أي Workflow مالية أوحقوقية لها Reconciliation path.

## 4. قالب تعريف الـWorkflow

كل رحلة في State Machines وContracts اللاحقة ستستخدم الحقول:

- **ID / Name / Classification**
- **Business outcome**
- **Trigger**
- **Actors**
- **Owner / Process Manager**
- **Preconditions**
- **Input snapshot**
- **Happy path**
- **Commands and events**
- **Completion criteria**
- **Partial states**
- **Failure and recovery**
- **Offline**
- **Permissions/approvals**
- **Audit**
- **Tests**

## 5. خريطة الرحلات

### Platform, Tenant and Access

- WF-IDN-001 Create platform identity and verify contact.
- WF-IDN-002 Sign in, step-up and issue session.
- WF-IDN-003 Recover account and revoke prior sessions.
- WF-TEN-001 Provision Tenant and first Owner.
- WF-TEN-002 Invite and activate Membership.
- WF-TEN-003 Change role/scope and propagate revocation.
- WF-TEN-004 Offboard Membership safely.
- WF-DEV-001 Enroll Device and activate Terminal.
- WF-DEV-002 Reassign or revoke Terminal/Device.

### Catalog and Commercial Rules

- WF-CAT-001 Create and activate Product/Variant.
- WF-CAT-002 Change SKU/Barcode/UOM safely.
- WF-CAT-003 Publish Location assortment.
- WF-PRC-001 Publish price changes.
- WF-TAX-001 Publish tax rule version.
- WF-PRO-001 Publish promotion and coupon campaign.

### Sales and Payments

- WF-SAL-001 Start and price Sale.
- WF-SAL-002 Complete cash Sale.
- WF-SAL-003 Complete electronic-payment Sale.
- WF-PAY-001 Resolve unknown electronic payment.
- WF-SAL-004 Suspend and resume Sale.
- WF-SAL-005 Cancel draft Sale.
- WF-SAL-006 Complete Offline cash Sale and synchronize.

### Inventory and Purchasing

- WF-INV-001 Post sale stock consumption.
- WF-TRF-001 Create, approve, ship and receive Transfer.
- WF-TRF-002 Handle partial receipt and discrepancy.
- WF-CNT-001 Perform stock count and post adjustment.
- WF-ADJ-001 Post authorized inventory adjustment.
- WF-PUR-001 Create and approve Purchase Order.
- WF-PUR-002 Receive supplier goods and inspect.
- WF-PUR-003 Record supplier invoice and three-way match.
- WF-PUR-004 Return goods to supplier.

### Returns and Customer Value

- WF-RET-001 Return with original Sale.
- WF-REF-001 Execute refund to original method.
- WF-REF-002 Refund failure and customer liability.
- WF-EXC-001 Exchange product.
- WF-VOI-001 Void eligible completed transaction.
- WF-CUS-001 Create/update customer and consent.
- WF-CUS-002 Merge duplicate customers.
- WF-AR-001 Execute approved credit Sale and settlement.
- WF-SCR-001 Issue and redeem Store Credit.
- WF-LOY-001 Earn/reverse/redeem Loyalty Points.

### Shift, Cash and Terminal Operations

- WF-SHF-001 Open Shift and Cash Drawer.
- WF-CSH-001 Post Cash In/Out or Safe Drop.
- WF-SHF-002 Count and close Shift.
- WF-SHF-003 Provisional Offline close and reconciliation.
- WF-CSH-002 Investigate and approve cash discrepancy.

### Documents, Delivery and Reporting

- WF-DOC-001 Issue document after business completion.
- WF-DOC-002 Render, print and reprint document.
- WF-DLV-001 Deliver document to external recipient.
- WF-NTF-001 Send operational/security notification.
- WF-APR-001 Request, escalate and resolve approval.
- WF-RPT-001 Run report and create snapshot.
- WF-EXP-001 Generate and download sensitive export.

### Governance and SaaS Billing

- WF-RETENTION-001 Execute retention/disposition policy.
- WF-HOLD-001 Issue and release Legal Hold.
- WF-TCL-001 Close Tenant with export and retention grace.
- WF-SUB-001 Start Trial and activate Subscription.
- WF-SUB-002 Renew Subscription successfully.
- WF-SUB-003 Failed renewal, dunning and access restriction.
- WF-SUB-004 Upgrade plan with proration.
- WF-SUB-005 Downgrade without destructive deletion.
- WF-SUB-006 Cancel and reactivate Subscription.

### Sync and Recovery

- WF-SYN-001 Upload Offline operations batch.
- WF-SYN-002 Download scoped projection changes.
- WF-SYN-003 Resolve command conflict or rejection.
- WF-REC-001 Replay failed integration event safely.

## 6. WF-IDN-001 — Create identity and verify contact

**Classification:** Local/Cross-provider security workflow.

**Outcome:** إنشاء PlatformIdentity قابلة لاستخدامها دون منح Tenant access.

**Trigger:** Registration أوTenant invitation acceptance عندما لا توجد هوية.

**Actors:** Person، Identity service، Email/SMS provider.

**Owner:** Platform Identity.

**Preconditions:** Contact normalized، rate limits passed، لا Identity مؤكدة بنفس identifier وفق policy.

**Happy path:**

1. `CreatePlatformIdentity` ينشئ Identity بحالة PendingVerification.
2. إنشاء SecurityChallenge بExpiry وحد محاولات.
3. إرسال verification delivery.
4. المستخدم يقدم proof.
5. `VerifyContactMethod` يثبت Contact.
6. Identity تصبح Active إذا اكتملت المتطلبات.
7. نشر `PlatformIdentityCreated` و`ContactMethodVerified`.

**Partial states:** Identity created لكن delivery failed؛ challenge active لكن verification غير مكتملة.

**Recovery:** Resend challenge دون إنشاء Identity جديدة؛ permanent bounce يطلب contact بديلة.

**Offline:** غير مسموح.

**Audit:** normalized masked contact، challenge events، provider result، IP/device risk metadata.

## 7. WF-IDN-002 — Sign in, step-up and issue session

**Outcome:** Session آمنة مرتبطة بهوية وDevice context، ولا تمنح Tenant scope تلقائيًا.

**Trigger:** Login request أوSensitive action requires step-up.

**Preconditions:** Identity active؛ credential valid؛ risk policy يسمح أويتطلب MFA.

**Path:** Authenticate → evaluate risk → create challenge عند الحاجة → verify factor → issue Session → resolve available Memberships دون اختيار Tenant تلقائيًا عند التعدد.

**Failure:** Invalid credential، locked factor، expired challenge، suspended identity.

**Recovery:** limited retries؛ security notification عند anomaly؛ revoke token family عند suspected compromise.

**Audit:** success/failure classification دون secrets.

## 8. WF-IDN-003 — Account recovery and session revocation

**Outcome:** استعادة التحكم بالهوية وإبطال Sessions القديمة بأثر واضح.

**Path:** Recovery challenge → proof checks → credential reset → increment security version → revoke active session families → notify verified contacts.

**Partial success:** Credential changed لكن notification failed؛ recovery تظل ناجحة مع Delivery retry.

**No compensation:** لا يعاد credential القديم.

## 9. WF-TEN-001 — Provision Tenant and first Owner

**Classification:** Cross-context Saga.

**Trigger:** Completed signup أوapproved sales provisioning.

**Process Manager:** TenantProvisioningProcess.

**Preconditions:** Identity verified؛ plan/trial eligibility؛ unique commercial account reference.

**Path:**

1. Create Tenant in Provisioning.
2. Create initial LegalEntity draft and reporting defaults.
3. Create Owner Membership.
4. Create Trial/Subscription.
5. Compile EntitlementSet.
6. Activate Tenant when mandatory steps succeed.
7. Issue onboarding notification.

**Completion:** Tenant Active، owner membership Active، entitlement version available.

**Partial states:** Tenant exists but billing activation pending؛ notification failed؛ optional setup incomplete.

**Compensation:** قبل أي business data يمكن Cancel provisioning؛ بعد activation لا hard delete، بل closure process.

**Offline:** غير مسموح.

**Audit:** commercial source، owner identity، plan version، provisioning decisions.

## 10. WF-TEN-002 — Invite and activate Membership

**Trigger:** Authorized admin invitation.

**Path:** authorize inviter → validate seat entitlement and role/scope → create invitation → deliver → accept using existing/new identity → revalidate Tenant, role, scope and seat → create Membership → consume invitation → notify.

**Race controls:** seat capacity and invitation acceptance checked atomically at activation; same invite acceptance Idempotent.

**Partial:** Membership active but welcome delivery failed.

**Offline:** invitation and activation Online-only.

## 11. WF-TEN-003 — Change role/scope and propagate revocation

**Outcome:** تعديل access مع منع استمرار claims قديمة بلا حدود.

**Path:** Approval if high-risk → update assignments effective now/future → publish `MembershipScopeChanged` → Authorization cache invalidation → revoke/update Offline leases → reevaluate scheduled report recipients and active Sessions.

**Partial:** Membership updated بينما بعض caches لم تستلم بعد؛ security version/lease expiry يضع bounded exposure.

**Recovery:** retry event delivery؛ security reconciliation scans version mismatch.

## 12. WF-TEN-004 — Offboard Membership safely

**Preconditions:** ليس آخر Owner؛ no unresolved exclusive custodianship أوexplicit handover plan.

**Path:** suspend membership → revoke sessions/leasing → prevent new operations → preserve actor history → transfer open approvals/tasks/drawer custody per policies → notify owners.

**Partial:** offboarding effective حتى لو task reassignment أوnotification تأخرت.

**No destructive action:** لا تغير Sales أوDocuments أوAudit القديمة.

## 13. WF-DEV-001 — Enroll Device and activate Terminal

**Process:** EnrollmentChallenge → verify admin/activation code → create RegisteredDevice and key → create/associate Terminal → assign Location → publish initial scoped configuration/catalog → issue Offline lease only after health and entitlement checks.

**Failures:** code expired، device fingerprint conflict، seat/terminal entitlement exceeded، location closed.

**Recovery:** restart challenge؛ never reuse leaked credential.

## 14. WF-DEV-002 — Reassign or revoke Device/Terminal

**Path:** high-risk approval → block new leases → revoke device credential or close assignment → publish revocation → wipe local data on next contact → move Terminal only after open Shift/unsynced operations resolved orexception process.

**Partial:** server revocation effective فورًا؛ remote wipe pending يظهر منفصلًا.

## 15. WF-CAT-001 — Create and activate Product/Variant

**Classification:** Local aggregate + registry coordination.

**Path:** create Product draft → add Variant(s) → reserve SKU/Barcodes → define UOM/tracking/tax category → configure location assortment and base price references → validation gate → activate Product/Variants → publish catalog changes.

**Completion:** searchable and eligible only in scoped Locations with valid price/tax.

**Failures:** identifier conflict، duplicate variant combination، invalid conversion، missing activation field.

**Compensation:** release never-used draft reservations وفق identifier policy؛ after publication retire rather than reuse.

## 16. WF-CAT-002 — Change identifiers or UOM safely

**Path:** check history/offline safety → approval for sensitive change → create alias/version rather than overwrite → publish delta/full snapshot → retain old identifiers and conversions for history.

**Forbidden:** retroactive conversion update; barcode reuse while stale devices may resolve old mapping.

## 17. WF-CAT-003 — Publish Location assortment

**Path:** select variants and effective period → validate location/warehouse → publish version → build device projection → terminal acknowledges.

**Partial:** central assortment active while some terminals stale؛ stale threshold determines warning/block.

## 18. WF-PRC-001 — Publish price changes

**Process:** draft entries → detect overlap → calculate impact preview → approval if threshold/floor → publish immutable version → schedule activation → emit change → build Offline snapshots.

**At activation:** current Sales retain prior calculation snapshot; new pricing requests use new version.

**Failure:** publication succeeds but projection delayed؛ POS freshness/version gate prevents silent mixed rules.

**Rollback:** new correcting version, not mutation.

## 19. WF-TAX-001 — Publish tax rule version

**Path:** draft legal configuration → validate jurisdiction, effective period, rounding and inclusive/exclusive mode → high-risk approval → publish → activation event → snapshot distribution.

**Failure policy:** missing applicable tax blocks taxable Sale completion; no automatic zero fallback.

## 20. WF-PRO-001 — Publish promotion and coupon campaign

**Path:** define scope/conditions/benefit/priority/stackability/return allocation/limits → simulate representative carts → approval → publish immutable version → issue/generate coupon codes → activate schedule.

**Partial:** promotion active لكن Offline terminals without compatible evaluator cannot apply it; rule marked server-only.

**Recovery:** pause stops new applications; existing Sales retain evidence.

## 21. WF-SAL-001 — Start and price Sale

**Outcome:** Sale Draft تحتوي valid snapshots وحساب قابل للتفسير.

**Actors:** Cashier، Sales، Catalog، Pricing/Tax/Promotions، Customer optional.

**Path:**

1. Validate Membership, Terminal, Shift, Location and entitlement.
2. Start Sale with IdempotencyKey.
3. Add line by Variant/Barcode and UOM.
4. retrieve/validate product and assortment snapshot.
5. evaluate price, tax and promotions.
6. accept calculation snapshots into Sale.
7. optional customer attach with consent/purpose checks.
8. recalculate totals after each change.

**Partial:** external coupon reservation may exist; Sale remains Draft.

**Recovery:** retry calculations with version evidence؛ release reservations on expiry/cancel.

**Offline:** uses published signed catalog/pricing/tax snapshot; server-only rules unavailable.

## 22. WF-SAL-002 — Complete cash Sale

**Classification:** Cross-context Process Manager.

**Preconditions:** Sale priced؛ shift/drawer active؛ cash tender allowed؛ total valid.

**Happy path:**

1. Record customer tendered amount and change calculation.
2. Create Cash Payment and mark captured locally according to cash policy.
3. Allocate Payment to Sale.
4. Sales consumes `PaymentAllocated`, marks payment satisfied.
5. `CompleteSale` freezes Sale.
6. Publish `SaleCompleted`.
7. Inventory posts exact-once consumption.
8. Cash context posts exact-once cash movement.
9. Documents issue receipt.
10. Customer/loyalty and reporting consume event.

**Success criterion:** SaleCompleted. Inventory, cash projection, document and loyalty may be pending but tracked.

**Partial failures:** receipt/print failed؛ inventory posting delayed؛ loyalty failed. لا يطلب إعادة البيع.

**Critical anomaly:** cash payment captured but Sale completion failed. Process Manager retries completion؛ manual reconciliation إذا invariant conflict دائم.

**Offline:** allowed within valid lease/shift; queued source events sync لاحقًا.

## 23. WF-SAL-003 — Complete electronic-payment Sale

**Classification:** Provider-reconciled Saga.

**Path:** create Payment intent → persist Attempt → provider call → capture confirmed → allocate → Sales complete → downstream effects.

**Rules:** Provider call outside DB transaction؛ client timeout cannot create new Attempt with new business identity blindly؛ provider idempotency key ثابت.

**Outcomes:**

- Captured: complete Sale.
- Declined: Sale remains payable.
- Unknown: Sale enters PaymentResolutionPending; do not retry charge automatically.
- Authorized only: follow capture policy.

**Offline:** electronic payment requires online/provider connectivity unless certified terminal has separate approved capability.

## 24. WF-PAY-001 — Resolve unknown electronic payment

**Trigger:** Unknown attempt أوwebhook/reconciliation schedule.

**Process:** query provider by stable reference → receive webhook/status → compare amount/currency/order → record evidence → resolve Captured/Failed/StillUnknown → allocate orrelease Sale.

**Manual intervention:** mismatched amount، multiple provider captures، provider lacks conclusive status.

**Compensation:** duplicate captured charge handled by explicit reversal/refund workflow, not deleting evidence.

## 25. WF-SAL-004 — Suspend and resume Sale

**Path:** validate Draft and no unsafe in-flight provider attempt → suspend with expiry/operator/location rules → release orretain coupon/reservations by policy → resume by authorized user/terminal → revalidate catalog, prices and customer claims → require explicit repricing differences.

**Offline:** local suspended Sale cannot be resumed by another device until synchronized/claimed.

## 26. WF-SAL-005 — Cancel draft Sale

**Path:** cancel Draft → release coupon/stock/payment reservations → record reason → no inventory orfinancial reversal because Sale not completed.

**Blocked:** cannot cancel completed Sale; use Void/Return.

## 27. WF-SAL-006 — Complete Offline cash Sale and synchronize

**Origin path:** validate lease/shift/catalog versions → create local Sale/Payment/Cash evidence with ClientOperationIds → complete locally → print local snapshot → enqueue ordered independent operations.

**Server sync:** authenticate batch → deduplicate → validate lease at OccurredAt and scope → create/accept owner Aggregates using original IDs/references → post inventory and cash exact-once → issue canonical document/number reconciliation.

**Conflict classes:** revoked lease before occurrence، stale blocked product، duplicate client operation، invalid number namespace، negative stock policy breach.

**Policy:** accepted local customer transaction is not silently deleted؛ exception may create operational loss/reconciliation case.

## 28. WF-INV-001 — Post sale stock consumption

**Trigger:** SaleCompleted.

**Owner:** Inventory.

**Path:** validate event tenant/location/variants/UOM → deduplicate source line → convert quantities with sale snapshot/version → post InventoryMovement → update positions/projections → publish movement.

**Failure:** missing variant mapping أوinvalid historical conversion enters exception queue; Sale remains completed.

**Recovery:** repair mapping/version and replay same event؛ no duplicate movement.

## 29. WF-TRF-001 — Create, approve, ship and receive Transfer

**Process Manager:** Transfer aggregate owns lifecycle; Inventory owns movements.

**Path:** draft lines → submit → approval → optional reservations → ship quantities → Inventory moves source to in-transit → receive at destination → Inventory moves in-transit to destination disposition → close when quantities resolved.

**Cancellation:** Draft/approved per rules؛ shipped quantities cannot vanish and require return/receipt resolution.

**Offline:** drafting/counting may be cached; approval/shipment/receipt Online-first initially.

## 30. WF-TRF-002 — Partial receipt and discrepancy

**Trigger:** destination receives less/more/damaged than shipment evidence.

**Path:** record received/rejected/missing quantities → create discrepancy → post only accepted disposition movements → keep Transfer PartiallyReceived/Exception → investigation → resolve via additional receipt, return-to-source, loss adjustment orclaim.

**No shortcut:** received quantity cannot exceed shipped silently.

## 31. WF-CNT-001 — Stock count and adjustment

**Path:** define scope and policy → freeze/expected snapshot orblind count mode → collect observations → recount variances → submit → approval → generate adjustment proposal → Inventory posts exact-once movements → close Count.

**Partial:** Count approved but movement failed؛ state `PostingPending`, retry same source.

**Offline:** counting observations allowed with scoped assignment; final approval/post Online-required.

## 32. WF-ADJ-001 — Authorized inventory adjustment

**Path:** create adjustment request with reason/evidence → approval by threshold → post InventoryMovement → report/audit.

**Forbidden:** direct balance edit.

## 33. WF-PUR-001 — Create and approve Purchase Order

**Path:** draft supplier/lines/prices/taxes/terms → optional requisition/quote links → submit → approval policy → approved revision frozen → send document to supplier.

**Partial:** PO approved though document delivery failed؛ resend without reapproval unless content changes.

**Revision:** changes after approval create revision and may require reapproval.

## 34. WF-PUR-002 — Receive supplier goods and inspect

**Path:** create GoodsReceipt against PO orauthorized exception → capture actual quantities/batches/serials → inspect → classify accepted/quarantine/rejected → post receipt → Inventory posts movements to proper disposition → update PO fulfillment projection.

**Failure:** inventory posting pending does not erase receipt; receiving UI shows status accurately.

## 35. WF-PUR-003 — Supplier invoice and three-way match

**Path:** record immutable supplier invoice snapshot → match Invoice lines with PO and Receipts → calculate price/quantity/tax variances → auto-approve within tolerances orraise exception → approval → create supplier liability reference/entry.

**Unknown:** duplicate external invoice detection creates review, not overwrite.

## 36. WF-PUR-004 — Return goods to supplier

**Path:** request return from eligible received stock → select quantities/disposition → approval → post SupplierReturn → Inventory outbound movement → await supplier credit/replacement as separate financial process.

**No mutation:** original GoodsReceipt remains unchanged.

## 37. WF-RET-001 — Return with original Sale

**Path:** locate Sale/line snapshot → calculate remaining returnable quantity → create ReturnRequest → reason/evidence/approval → inspect item → decide disposition → calculate historical net/tax allocation → post Return → emit inventory disposition and refund eligibility.

**Completion:** Return posted, not necessarily refunded.

**Offline:** draft/intake may be future capability; final eligibility/post Online-required initially.

## 38. WF-REF-001 — Refund to original method

**Trigger:** Posted Return orapproved standalone refund entitlement.

**Path:** create Refund aggregate → choose eligible method/amount → send RefundRequested to Payments → provider/cash/store-credit owner executes → consume outcome → mark Refund Succeeded → issue document.

**Cash refund:** requires active drawer, limit and approval policies; creates cash movement.

**No over-refund:** remaining refundable reserved during in-flight attempt.

## 39. WF-REF-002 — Refund failure and customer liability

**Outcome:** Return remains valid; obligation to customer remains visible.

**Path:** record failed/permanent/unknown attempt → retry same attempt if temporary orreconcile unknown → choose authorized alternate method → if unresolved create CustomerRefundLiability case → notify responsible staff/customer as appropriate.

**Forbidden:** cancel Return because provider failed.

## 40. WF-EXC-001 — Product exchange

**Process Manager:** ExchangeProcess.

**Path:** post Return valuation → start replacement Sale with current pricing/promotion policy → calculate difference → collect additional payment أوcreate refund/store-credit obligation → complete replacement Sale → finalize Exchange when Return, Sale and Settlement reach required states.

**Partial:** returned item accepted but replacement payment failed؛ case remains actionable, not rolled back invisibly.

## 41. WF-VOI-001 — Void eligible transaction

**Preconditions:** within allowed window، full transaction eligible، no downstream blocking states، approval if required.

**Path:** create VoidRequest → command Sales/Payments/Inventory/Cash owners for explicit reversals → wait for all required outcomes → issue void/correction document.

**Partial:** one reversal failed → Void PendingReconciliation; original remains historically completed plus visible corrective process.

## 42. WF-CUS-001 — Create/update customer and consent

**Path:** search duplicates → create customer orupdate authorized fields → validate purpose/contact → append consent grant/withdrawal with version → publish projections.

**No fake customer:** walk-in Sale remains anonymous.

**Offline:** basic customer lookup/create may be limited; consent-sensitive messaging Online-first.

## 43. WF-CUS-002 — Merge duplicate customers

**Path:** create MergeCase → compare identifiers/PII/balances/consents → choose survivor → resolve field conflicts and conservative consent → create aliases → update current projections/resolvers → preserve historical IDs and ledger references.

**Blocked:** unresolved balances/identity conflicts.

**Rollback:** no simple unmerge after external effects; requires controlled split/correction process.

## 44. WF-AR-001 — Approved credit Sale and settlement

**Path:** verify customer, credit limit and account status Online → reserve credit exposure → complete Sale with Receivable tender → post receivable ledger → later accept payment → allocate to open entries → update derived balance.

**Partial:** Sale completed but receivable posting delayed؛ exact-once event retry; credit availability remains conservative until resolution.

## 45. WF-SCR-001 — Issue and redeem Store Credit

**Issue:** approved source such as refund → append credit entry → publish balance.

**Redeem:** Online balance/reservation check → reserve → complete Sale/payment allocation → append redemption → release reservation on failure.

**Rules:** no direct balance mutation؛ separate from Receivables and Loyalty.

## 46. WF-LOY-001 — Earn, reverse and redeem Loyalty Points

**Earn:** SaleCompleted → evaluate earning version → append points entry.

**Reverse:** ReturnPosted → append reversal based on historical earning allocation.

**Redeem:** reserve points Online → Sale completion → append redemption; release on cancellation.

**Partial:** loyalty failure never reverses Sale; queue repair/replay.

## 47. WF-SHF-001 — Open Shift and Cash Drawer

**Preconditions:** active membership/terminal، no conflicting open session، entitlement and location active.

**Path:** create RegisterShift → bind CashDrawerSession and custodian → record opening count/float → append opening CashMovement → issue Offline lease scope if allowed.

**Partial:** shift created but float posting failed → not Open; retry orcancel opening.

## 48. WF-CSH-001 — Cash In/Out or Safe Drop

**Path:** select movement type/reason → validate permission/limits → optional approval → append CashMovement → update expected cash projection → print evidence optionally.

**No generic adjustment:** each movement has explicit direction/source/destination.

## 49. WF-SHF-002 — Count and close Shift

**Path:** request close → block/flag new operations → check pending electronic/offline operations → blind first count → calculate expected snapshot → record discrepancy → approval based on threshold → close drawer/shift → produce closing document/report.

**Completion:** FinalClosed only after mandatory reconciliation; no reopen through normal workflow.

**Partial:** print/report failure does not reopen Shift.

## 50. WF-SHF-003 — Provisional Offline close

**Path:** local close captures final local operation sequence and cash count → state ProvisionalClosed → sync all operations → server reconciles cash and sale/payment evidence → resolve conflicts → produce final expected snapshot → approve discrepancy if needed → FinalClosed.

**Blocked:** device cannot open overlapping new shift under same drawer policy until lease/server rules permit.

## 51. WF-CSH-002 — Cash discrepancy investigation

**Path:** create discrepancy from expected vs counted → classify threshold → recount/evidence → approver decision → record resolution orauthorized correction movement → close case.

**No modification:** Sales/Payments remain unchanged.

## 52. WF-DOC-001 — Issue document after business completion

**Trigger:** authoritative source event.

**Path:** deduplicate source/type → reserve number → assemble legal/commercial snapshot from event and authorized owner lookups → validate required fields → issue immutable BusinessDocument → publish DocumentIssued.

**Partial:** source completed but document issue failed → retry same source; sequence gap recorded according to policy.

## 53. WF-DOC-002 — Render, print and reprint

**Path:** select historical template/version → generate render with checksum → submit PrintJob → record printer outcome.

**Reprint:** same BusinessDocument، new PrintJob، copy marker/reason/actor.

**Failure:** Sale/Document remain valid; retry render/print only.

**Offline:** local trusted snapshot and template may print; canonical Document reconciliation later.

## 54. WF-DLV-001 — Deliver document externally

**Path:** validate purpose and destination → snapshot recipient → create DeliveryJob → send provider request with idempotency → consume webhook/status → delivered/bounced/failed/unknown → retry ormanual resend by class.

**Security:** temporary secured links؛ no public permanent URL.

## 55. WF-NTF-001 — Operational/security notification

**Path:** source event → evaluate NotificationRule/version → resolve current authorized audience → apply suppression/preferences by purpose → create Notification → route channels → attempts/retry/escalation.

**Security notifications:** cannot be suppressed by marketing unsubscribe.

## 56. WF-APR-001 — Approval request and escalation

**Path:** command determines approval requirement → create ApprovalRequest with payload hash/version → notify eligible approvers → grant/reject/expire → original Application service revalidates payload and current policy → execute orcancel command.

**Change after approval:** invalidates decision.

**Escalation:** scheduled reminders/next level; no self-approval where prohibited.

## 57. WF-RPT-001 — Run report and create snapshot

**Path:** authorize scope/columns → load definition version → snapshot filters/timezone/currency/freshness cutoff → execute read pipeline → validate completeness/reconciliation → produce Live result orimmutable Report Snapshot → audit run.

**Failure:** partial output not Complete; retry job may reuse same run request orcreate explicit rerun reference.

## 58. WF-EXP-001 — Sensitive export

**Path:** request with purpose → evaluate permission/step-up/approval and row/field limits → run scoped query → sanitize CSV/formats → encrypt/store temporary artifact → notify requester → download with reauthorization → expire/delete.

**Partial:** file generated but notification failed; export remains discoverable only to authorized requester until expiry.

## 59. WF-RETENTION-001 — Execute retention/disposition policy

**Classification:** Scheduled distributed workflow.

**Path:** identify eligible records by DataClass and clock → intersect Legal Holds/open obligations → create DataDispositionJob → request each Domain owner archive/anonymize/delete action → verify provider/search/cache replicas → record evidence → complete.

**Partial:** some stores completed، others retry; never mark complete prematurely.

**Recovery:** idempotent steps; failed queue and escalation.

## 60. WF-HOLD-001 — Issue and release Legal Hold

**Issue:** authorized legal actor defines scope/reason/period → validate and activate Hold → retention engine blocks matching dispositions → audit restricted event.

**Release:** approval/review → mark released → re-evaluate policies → create future disposition jobs where eligible; no immediate unreviewed deletion.

## 61. WF-TCL-001 — Close Tenant

**Process:** closure request → ownership/high-risk approval → stop new subscription renewal → set Tenant restricted/read-only according to phase → block new operational creation → resolve open shifts/payments/exports → create tenant export package within allowed scope → grace period → archive/disposition per classes → final closure.

**Partial:** subscription canceled while business export pending; data remains governed and accessible by closure policy.

**Reactivation:** allowed only inside documented window and before irreversible disposition.

## 62. WF-SUB-001 — Trial and subscription activation

**Path:** choose published PlanVersion → create BillingAccount/Subscription Trialing → compile Entitlements → activate Tenant capabilities → trial reminders → at conversion collect payment oractivate invoiced contract → Subscription Active → recompile entitlements.

**Trial expiry:** no destructive deletion; transition Grace/Restricted according to policy.

## 63. WF-SUB-002 — Successful renewal

**Scheduled path:** lock renewal period/idempotency → calculate invoice lines/tax/usage → issue BillingInvoice → charge payment method → reconcile success → mark paid → renew Subscription period → compile Entitlements → notify.

**Partial:** payment paid but entitlement update delayed؛ renewal remains financially paid and compiler retries.

## 64. WF-SUB-003 — Failed renewal and dunning

**Path:** payment fails/unknown → classify → Subscription PastDue with grace dates → notify billing contacts → retry schedule → restrict expansion at threshold → read-only/suspension at later threshold → successful payment restores access via new EntitlementSet.

**Unknown:** reconcile before duplicate charge.

**No deletion:** data and historical operations remain.

## 65. WF-SUB-004 — Upgrade with proration

**Path:** quote change using current/new PlanVersion and effective date → customer approval → create prorated invoice/credit → collect if required → schedule oractivate Subscription change → compile entitlements → allow new capacity.

**Rule:** entitlement expansion follows confirmed commercial state, not client-side selection.

## 66. WF-SUB-005 — Downgrade without destructive deletion

**Path:** calculate future limits and incompatible add-ons → show over-limit resources → schedule change at period boundary by default → activate lower EntitlementSet → block creation above limits but retain/view existing data according to access policy.

**Exceptions:** features requiring data transformation need explicit migration workflow, not silent loss.

## 67. WF-SUB-006 — Cancel and reactivate

**Cancel:** immediate orperiod-end request → preserve paid access until effective date → prevent renewal → entitlements transition by policy → closure remains separate.

**Reactivate:** before/after period end depending plan availability and payment → create new period/version as required → compile entitlements.

## 68. WF-SYN-001 — Upload Offline operations batch

**Path:** verify Device and lease signature → receive Batch with local sequence → deduplicate each ClientOperationId → route commands independently → owner validates OccurredAt policy/current irreversible constraints → store per-operation outcome → ACK accepted/rejected/pending-reconciliation.

**Atomicity:** no batch-wide atomicity unless command group explicitly declares it.

**Retries:** same Batch/operation IDs return prior result.

## 69. WF-SYN-002 — Download scoped projection changes

**Path:** authenticate device/lease → request stream cursor → verify scope/version → return ordered stream page/snapshot → device applies transactionally locally → acknowledges next cursor.

**Snapshot fallback:** cursor too old/schema incompatible → full scoped snapshot.

**Revocation:** security stream takes priority and can invalidate local scopes.

## 70. WF-SYN-003 — Resolve conflict or rejection

**Classes:** duplicate، stale expected version، revoked scope، invalid historical reference، policy breach، server-owned concurrent change، unknown external outcome.

**Resolution:** automatic merge only for explicitly commutative fields؛ otherwise reject with structured reason and current version، create exception/correction process where customer operation already occurred.

**Forbidden:** generic last-write-wins.

## 71. WF-REC-001 — Replay failed integration event

**Path:** operator/system selects failed consumer record → verify original event integrity/version → reset retry state without changing EventId → consumer checks Inbox/side-effect evidence → apply missing projection/command → record outcome.

**Rules:** replay must not call provider again if outcome already recorded؛ rebuild Read Model uses side-effect-free handlers.

## 72. Process Managers المطلوبة

### SaleCompletionProcess

Tracks Sale, Payment satisfaction, completion, inventory movement, cash movement, document issuance and optional customer effects. Completion boundary: SaleCompleted; downstream statuses individually visible.

### ElectronicPaymentResolutionProcess

Tracks provider attempt, webhook/query, reconciliation and allocation.

### TransferFulfillmentProcess

Tracks approval, reservation, shipment movement, in-transit balance, receipts and discrepancies.

### PurchaseReceiptProcess

Tracks GoodsReceipt disposition, inventory movements and PO fulfillment.

### ReturnSettlementProcess

Tracks Return posting, inventory disposition, refund/store credit and documents.

### ExchangeProcess

Tracks Return, replacement Sale and difference settlement.

### ShiftClosingProcess

Tracks pending operations, count, discrepancy, provisional/final close and reports.

### TenantProvisioningProcess

Tracks Tenant, Owner Membership, Subscription, Entitlements and onboarding.

### SubscriptionRenewalProcess

Tracks invoice, collection, dunning, renewal and entitlement compilation.

### TenantClosureProcess

Tracks access restriction, open obligations, export, grace and disposition.

### DataDispositionProcess

Tracks policy eligibility, hold intersection and multi-store deletion/anonymization evidence.

## 73. حالات النجاح الجزئي المعتمدة

- Sale completed; inventory posting pending.
- Sale completed; receipt generation/printing failed.
- Cash payment recorded; Sale completion pending recovery.
- Electronic payment outcome unknown.
- Return posted; refund pending orfailed.
- Refund failed; customer liability open.
- Goods receipt posted; inventory movement pending.
- Transfer partially received; discrepancy open.
- Shift provisionally closed; sync/reconciliation pending.
- Billing invoice paid; entitlement compilation pending.
- Tenant restricted; export/disposition pending.
- Report completed; delivery failed.
- Document issued; external delivery failed.

كل حالة تحتاج Queue وOwner وAllowed actions، ولا تختزل إلى `failed` عام.

## 74. تصنيف الأخطاء

### Validation

الطلب لم يبدأ أثرًا؛ يمكن تصحيح input.

### Authorization/Entitlement

مرفوض قبل الأثر؛ إعادة المحاولة فقط بعد تغيير صالح في scope/policy/plan.

### Concurrency

ExpectedVersion stale؛ reload/rebase وفق semantics.

### Temporary infrastructure

Retry with backoff بنفس identity.

### Permanent configuration

Manual correction/configuration required.

### External declined

Provider أعطى قرارًا نهائيًا؛ يحتاج إجراء تجاري جديد لاtechnical retry أعمى.

### External unknown

Reconciliation mandatory.

### Partial distributed completion

Continue/retry remaining steps؛ do not repeat completed owners.

### Invariant violation from historical/offline fact

Exception process and compensation؛ لا حذف صامت.

## 75. قواعد Compensation

- Inventory compensation = movement مقابلة.
- Cash compensation = cash movement مقابلة.
- Payment compensation = reversal/refund transaction.
- Sale correction = Void/Return/Correction according to eligibility.
- Document correction = correction/credit/debit document.
- Loyalty/store credit correction = ledger entry مقابلة.
- Subscription correction = credit/adjustment/new effective version.
- Notification لا تُسحب بعد التسليم؛ ترسل correction عند الحاجة.
- Audit/Event لا يُحذف؛ يسجل corrective event.

## 76. Offline Policy Matrix

### مسموح داخل Lease

- Cash Sale باستخدام published snapshots.
- Basic cart operations.
- Local cash movement ضمن limits.
- Count observations.
- Local document print من snapshot.

### مسموح كDraft فقط

- Return intake.
- Purchase/transfer drafts.
- Customer draft updates المحدودة.

### Online-required مبدئيًا

- New Shift authorization إن انتهت lease.
- Electronic payments/refunds.
- Store Credit/Loyalty redemption.
- Credit Sale.
- Final Return posting/refund.
- Transfer approval/shipment/receipt.
- Price/tax/promotion publication.
- Role/membership/device changes.
- Subscription/billing changes.
- Legal hold/retention actions.

## 77. Permission and Approval Touchpoints

تحتاج Permission مستقلة وApproval حسب policy:

- Price override/manual discount.
- Sale under floor/cost.
- Void.
- Return exception/no receipt.
- Refund alternate method/cash threshold.
- Inventory adjustment and discrepancy.
- Transfer approval/cancellation after approval.
- PO approval/revision.
- Supplier match exception.
- Cash in/out, no-sale open, discrepancy resolution.
- Role/scope/owner/device changes.
- Sensitive export.
- Retention/Legal Hold/Tenant closure.
- Commercial entitlement override.

## 78. Audit minimum per Workflow

- WorkflowId and ProcessInstanceId.
- Tenant/Location.
- Actor and effective approver.
- Device/Terminal/Shift when relevant.
- Trigger/source.
- Command identity and payload hash for sensitive actions.
- Aggregate IDs and versions.
- State transitions.
- Event IDs and provider references masked.
- Decisions/reasons/approvals.
- Partial state and recovery actions.
- OccurredAt/RecordedAt/EffectiveAt.

## 79. Acceptance Test Classes

لكل Workflow يجب لاحقًا تغطية:

1. Happy path.
2. Duplicate command/event.
3. Retry after timeout.
4. Concurrent update.
5. Permission denied.
6. Entitlement denied/limit reached.
7. Mid-process actor suspension.
8. Provider failure/unknown where applicable.
9. Downstream consumer unavailable.
10. Process restart after crash.
11. Event late/out-of-order.
12. Manual recovery.
13. Compensation.
14. Cross-tenant rejection.
15. Historical snapshot stability.
16. Offline stale/revoked lease where relevant.
17. Audit completeness.
18. Projection rebuild without side effects.

## 80. Open Decisions

### OD-WF-001 — Sale completion boundary

**Baseline:** SaleCompleted هوBusiness success؛ Inventory/Cash/Document consumers مستقلة ومراقبة. Cash/payment evidence must exist first.

### OD-WF-002 — Inventory failure after Sale

**Baseline:** لا نعكس Sale تلقائيًا؛ ننشئ exception/reconciliation لأن العميل قد استلم السلعة والدفع تم.

### OD-WF-003 — Cash Sale atomicity

**Baseline:** Payment cash record وSale satisfaction تحتاج تصميم transaction/process دقيق داخل الخادم؛ Cash ledger downstream exact-once. لا نخزن distributed transaction.

### OD-WF-004 — Offline legal document numbering

يعتمد Country/Fiscal Blueprint؛ workflow تدعم namespace محلية أوتأجيل الرقم القانوني حتى sync حسب القانون.

### OD-WF-005 — Return inventory timing

**Baseline:** Return posting يثبت استلام/قرار disposition، ثمInventory posts exact-once. لا يدخل Available إلا disposition معتمدة.

### OD-WF-006 — Exchange completion

**Baseline:** Process مكتملة فقط بعد إتمام Return وreplacement Sale والـSettlement، مع حالات partial واضحة.

### OD-WF-007 — Shift close blockers

**Baseline:** unknown electronic outcomes وunsynced cash operations تمنع Final close أوتخلق Provisional close فقط.

### OD-WF-008 — Tenant restriction stages

يُحسم في Entitlement/Security Blueprint؛ baseline: warn → expansion blocked → read-only → suspended، دون حذف.

### OD-WF-009 — Workflow engine technology

غير محسوم؛ Process Manager منطقي لا يفرض Queue/Temporal/DB scheduler بعينه.

## 81. خارج النطاق

- UI screen flows التفصيلية.
- API endpoints and payload schemas.
- Database transaction implementation.
- Queue/broker/workflow-engine selection.
- Country-specific fiscal certification.
- Full accounting journal workflows.
- Manufacturing/Payroll workflows.
- Provider-specific webhook fields.

## 82. Acceptance Gate

لا يعتبر Workflow Catalog مكتملًا قبل:

1. وجود Workflow لكل رحلة حرجة في Business Rules.
2. تحديد Owner وProcess Manager لكل رحلة متعددة الـContexts.
3. تحديد Business success boundary بوضوح.
4. توثيق partial-success states وعدم استخدام rollback وهمي.
5. تحديد retry/compensation/reconciliation لكل Side effect.
6. تحديد Offline policy لكل رحلة.
7. تحديد Permission/Approval touchpoints.
8. تحديد Commands/Events الأولية.
9. تحديد Audit evidence.
10. ربط كل Workflow بالAggregates والOwners.
11. تحويل lifecycle الحرجة إلى State Machines.
12. عدم وجود رحلة تعتمد Distributed transaction أوDirect cross-context write.

## 83. القرار التخطيطي الحالي

- الكتالوج يعتمد 56 Workflow رئيسية عبر 16 Contexts.
- Sale success منفصلة عن نجاح الطباعة والتقارير والولاء.
- External unknown outcomes لها reconciliation وليست retry أعمى.
- Returns وRefunds وExchanges حقائق وعمليات منفصلة.
- Inventory/Cash/Financial corrections دائمًا سجلات مقابلة.
- Offline-originated operations تستخدم نفس Owners وInvariants.
- كل Workflow متعددة الـContexts لها Process state قابلة للاسترداد.
- Process Managers لا تملك الحقائق؛ تملك تقدم الرحلة فقط.

## 84. المرحلة التالية

**ATHR State Machines v1.0**

ستثبت لكل Aggregate وProcess:

- States.
- Initial and terminal states.
- Allowed commands.
- Guards.
- Transitions.
- Emitted events.
- Timeout transitions.
- Invalid transitions and error codes.
- Reopen/correction policy.
- Recovery and manual-intervention states.

بعدها: **Event Catalog ثمAudit Catalog**.