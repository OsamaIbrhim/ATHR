# ATHR Offline Protocol v1.0

**Planning Baseline — Offline Authorization, Allowed Operations, Limits, Signing, Reconnection and Abuse Controls**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة ما الذي يمكن لجهاز ATHR POS تنفيذه بدون اتصال، وتثبت:

- Offline Authorization Lease.
- العمليات المسموحة والممنوعة Offline.
- حدودالوقت والمبالغ والكميات والخصومات.
- Catalog وPrice وTax وPromotion snapshots.
- Shift وCash continuity.
- Offline Sale وReceipt numbering.
- Device signing وClock trust.
- Local evidence وTamper detection.
- Reconnection outcomes.
- Revocation semantics.
- Fraud وAbuse controls.
- Maximum supported offline window.
- User-facing status and recovery.

هذه الوثيقة لا تنفذ Sync؛ النقل والمصالحة محكومان بـ **ATHR Sync Protocol v1.0**.

## 2. المبادئ الإلزامية

1. Offline capability امتياز مقيد، وليستحقًا دائمًا.
2. لا توجدOperation Offline بدونLease فعالة.
3. Lease مرتبطةTenant وLocation وTerminal وDevice وUser/Role وShift.
4. انتهاءLease يمنعإنشاءعمليات جديدة، لكنهلايحذفالعمليات المسجلة سابقًا.
5. كلعملية Offline موقعة ومعهاClientOperationId ثابت.
6. Server يعيدالتحقق عندالمزامنة.
7. Server قديرفضعملية محلية إذاخرقتBusiness rule أوPolicy.
8. رفضServer لايمحوماحدثفعليًا فيالمحل؛ قدينتجReconciliation أوCorrection workflow.
9. لا توجدElectronic payment أوRefund execution Offline.
10. لا توجدRole/Permission/Entitlement changes Offline.
11. لا يوجدLast-write-wins للمال أوالمخزون.
12. كلCash/Inventory effect يحتفظEvidence قابلللمراجعة.
13. Client clock ليستمصدرحقيقة منفردًا.
14. Catalog/Price/Tax versions المستخدمة تحفظمعكلTransaction.
15. Local totals Provisional حتىServer acceptance.
16. Offline UI يجب أنتعرضوضوحًا أنالعملية Pending Sync.
17. لا يسمحInfinite offline operation.
18. Limits تقل كلماطالالانقطاع أوظهرتإشاراتمخاطر.
19. Device revocation لايمكنضمانوصوله فورًا بلااتصال؛ لذلكLease قصيرة ومحدودة.
20. أيCritical anomaly تنقلDevice إلىRestricted Offline أوBlocked.

# القسم الأول — Offline Authorization Lease

## 3. تعريف Lease

Lease هيوثيقةموقعة منServer تمنحجهازًا محددًا صلاحيات Offline محددة خلالفترة وحدودمحددة.

## 4. Lease Contract

```json
{
  "lease_id": "lease_...",
  "tenant_id": "tenant_...",
  "location_id": "loc_...",
  "terminal_id": "term_...",
  "device_id": "dev_...",
  "membership_id": "mem_...",
  "shift_id": "shift_...",
  "issued_at": "2026-07-29T05:00:00Z",
  "not_before": "2026-07-29T05:00:00Z",
  "expires_at": "2026-07-29T17:00:00Z",
  "authorization_version": "authz_42",
  "entitlement_version": "ent_18",
  "policy_version": "off_7",
  "catalog_snapshot_id": "cat_...",
  "price_snapshot_id": "price_...",
  "tax_snapshot_id": "tax_...",
  "allowed_operation_types": [],
  "limits": {},
  "signature": "..."
}
```

## 5. Lease Conditions

- Device Registered وNot Revoked.
- Terminal Active ومربوطةLocation.
- Membership Active.
- User authenticated recently حسبpolicy.
- Shift open أوlease pre-shift محدودة.
- Latest required snapshots applied.
- Client version مدعومة.
- No unresolved critical integrity failure.

## 6. Lease States

`Requested → Active → NearExpiry → Expired | Revoked | Superseded | Suspended`

## 7. Lease Renewal

- Online only.
- لاrenewal ذاتي منClient.
- يعادفحصPermissions وEntitlements وRisk state.
- إصدارLease جديدة يبطل أويسبق القديمة حسبpolicy.

## 8. Maximum Offline Window

Baseline تخطيطي:

- Standard POS cash selling: حتى12 ساعة.
- Extended continuity mode: حتى24 ساعة بموافقةTenant policy ومخاطر أقل.
- بعدالحد: Read-only +Local queue review فقط.

الأرقام النهائية تعتمدSecurity وBusiness policy، لكنلا يسمحUnbounded offline.

# القسم الثاني — Offline Capability Levels

## 9. Levels

### O0 — Online Required

لاعملياتتجارية Offline.

### O1 — Read-only Offline

Catalog/Prices/Recent records للعرض فقط.

### O2 — Restricted Transactional Offline

Cash sales وحدودضئيلة وعملياتنقدية محدودة.

### O3 — Managed Continuity Offline

Cash sales +ملاحظاتمخزون +بعضCustomer capture معlimits أعلى وتدقيقأقوى.

## 10. Level Determination

يعتمدعلى:

- Tenant policy.
- Location risk class.
- Device trust.
- User role.
- Shift status.
- Last successful sync age.
- Queue depth.
- Recent conflicts/fraud signals.
- Snapshot freshness.

# القسم الثالث — العمليات المسموحة Offline

## 11. Baseline Allowed

- إنشاءSale draft.
- تعديلSale draft المحلية.
- إضافة/حذفlines قبلالإكمال.
- Cash-only Sale completion.
- Cash tender recording.
- Receipt generation/print.
- Suspend/resume local sale.
- Limited cash in/out حسبpolicy.
- Shift count observations.
- Stock count observations assigned مسبقًا.
- Device health events.
- Limited customer creation ببياناتدنيا.
- Print acknowledgements.

## 12. Conditionally Allowed

- Manual discount داخلحدUser/Lease.
- Coupon use فقطإذاOffline-verifiable وغيرمتطلبcentral counter.
- Customer lookup منminimal local index.
- Customer attach إذاidentity match واضحة.
- Return intake draft دونPosting أوRefund.
- Transfer receiving observation دونCanonical receipt posting.

## 13. Online-only Baseline

- Card/electronic payment authorization/capture.
- Electronic refund.
- Store credit issue/redeem.
- Loyalty earn/redeem النهائية.
- Credit sale/receivables posting.
- Gift card activation/redemption.
- Price/Tax/Promotion publication.
- Role/Permission/Scope changes.
- Device enrollment/reassignment.
- Transfer approve/ship/receive posting.
- Inventory adjustment posting.
- Goods receipt posting.
- Supplier payment.
- Subscription/Billing/Entitlement changes.
- Legal hold/Data disposition.
- Support/Break-glass.
- Tenant closure.

# القسم الرابع — Monetary and Operational Limits

## 14. Limit Dimensions

- Max sale total.
- Max line quantity.
- Max discount percent/value.
- Max cash movement amount.
- Max number ofcompleted sales.
- Max cumulative offline sales value.
- Max queue depth.
- Max customer records created.
- Max operation age.
- Max hours since last sync.

## 15. Limit Evaluation

Effective limit = الأقل من:

- Tenant policy.
- Role limit.
- User assignment.
- Device trust limit.
- Location risk limit.
- Lease limit.
- Product-specific restriction.
- Current cumulative offline usage.

## 16. Cumulative Counters

Client يحفظSigned/chain-linked counters للـLease:

- offline_sales_count.
- offline_sales_total.
- offline_discount_total.
- cash_in_total.
- cash_out_total.
- customer_creations_count.

Server يعيدحسابها عندSync.

## 17. Hard vs Soft Limits

### Hard

تمنعOperation محليًا.

### Soft

تسمحمعwarning وSupervisor local approval إذاlease تسمح.

لا يوجدSupervisor override خارجالحدالأقصى للـLease.

# القسم الخامس — Catalog, Price, Tax and Promotion Snapshots

## 18. Snapshot Binding

كلSale Offline تحفظ:

- catalog_snapshot_id.
- price_snapshot_id.
- tax_snapshot_id.
- promotion_snapshot_id عندالتطبيق.
- calculation_version.

## 19. Snapshot Freshness

كلsnapshot لها:

- issued_at.
- effective_from.
- expires_at.
- applicable location/channel.
- checksum/signature.

## 20. Expired Snapshot

- Catalog قدتظلRead-only.
- Sale completion تمنع أوتدخلRestricted emergency policy.
- Tax snapshot expiry baseline يمنعالإكمال.
- Price snapshot expiry قدتسمحبآخرسعرضمنgrace period إذاTenant policy صريحة.

## 21. Server Recalculation

عندSync:

- Server يتحققمنالنسخة المستخدمة.
- لايعيدتسعيرSale مكتملة تلقائيًا إذاكانتنسخةمسموحة وقتالبيع.
- إذاالنسخةغيرصالحة، تدخلConflict/Manual review أوCorrection حسبpolicy.

# القسم السادس — Shift and Cash Continuity

## 22. Shift Requirement

Cash sale Offline تحتاج:

- Shift canonical أوOffline-open allowance.
- Cash drawer session.
- User membership داخلLease.

## 23. Offline Shift Open

Baseline:

- غيرمسموح إلاإذاLease أصدرتقبلالانقطاع مع`may_open_shift_offline=true`.
- يحتاجOpening float limit.
- ينتجProvisional Shift ID موقعة.

## 24. Offline Shift Close

- Provisional close فقط.
- Final close Online بعدSync كلSales/Cash movements.
- Local count تحفظEvidence وSignature.

## 25. Cash Movements

مسموحة فقطلأنواعAllow-list مثل:

- opening float.
- petty cash out ضمنحد.
- cash drop ضمنحد.
- correction request draft.

كلMovement تحتاجReason code وActor وSequence وSignature.

## 26. Cash Discrepancy

لايتمإخفاؤها أوauto-adjust. عندSync تنتجReconciliation case.

# القسم السابع — Offline Sale Contract

## 27. Sale Lifecycle

`LocalDraft → ReadyForCash → LocallyCompleted → PendingSync → Accepted | Conflict | RejectedForCorrection | ManualReview`

## 28. Completion Preconditions

- Active Lease.
- Shift/cash session valid.
- Cash-only tender.
- Totals withinlimits.
- Product/price/tax snapshots valid.
- No blocked product/restriction known locally.
- Operation queue persisted.
- Receipt number allocated.
- Device signature successful.

## 29. Completion Evidence

يحفظ:

- Sale payload hash.
- Line snapshots.
- Totals/tax/discount breakdown.
- Cash tender amount/change.
- Actor/device/terminal/shift.
- Local occurred_at.
- Monotonic sequence.
- Snapshot IDs.
- Lease ID.
- Receipt number.
- Signature.

## 30. Change Due

- Local calculation فقطمنCash received وSale total.
- لايخلقStore credit تلقائيًا.
- Excess cash/change rules حسبcurrency/business policy.

# القسم الثامن — Numbering and Receipts

## 31. Offline Number Range

Server يخصصRange أوPrefix للجهاز/terminal/lease.

مثال:

```
LOC01-T03-20260729-000001
```

## 32. Number Rules

- Unique عبرTenant.
- لايعادالاستخدام.
- Gaps مسموحة ومفسرة.
- Range مرتبطةDevice/Lease.
- Exhaustion يمنعالإكمال أوينتقلEmergency range معpolicy صريحة.

## 33. Receipt Marking

Receipt Offline تعرض:

- Offline/Pending Sync indicator داخليًا أوحسبالقانون المحلي.
- Device/terminal reference.
- Receipt number.
- Sale occurred time.
- Verification reference/QR إذامتاح.

## 34. Reprint

- Reprint منlocal immutable receipt snapshot.
- تحملReprint marker وcount.
- لا تعيدCalculation.

# القسم التاسع — Device Signing and Integrity

## 35. Device Key

- Private key non-exportable قدرالإمكان.
- Rotatable.
- Key version داخلoperation.
- Revocation Online.

## 36. Signed Material

التوقيع يغطي:

- client_operation_id.
- payload hash.
- lease_id.
- device_id.
- terminal_id.
- actor/membership.
- local sequence.
- occurred_at.
- previous operation hash optional.

## 37. Hash Chain

Critical operations يمكنربطها:

`current_hash = hash(previous_hash + canonical_operation_payload)`

هذا لايجعلالنظامBlockchain؛ هوTamper-evident local chain فقط.

## 38. Local Storage Protection

- Encrypted database.
- OS key store.
- No plain secrets.
- Restricted debug export.
- Integrity checks onstartup.

# القسم العاشر — Clock Trust

## 39. Time Sources

- Last trusted server time.
- Monotonic device clock.
- Wall clock.
- Lease issue/expiry.

## 40. Clock Drift Rules

إذاdrift تجاوزthreshold:

- Warning.
- تقليلoffline capability.
- منعoperations الحساسة.
- Require online revalidation.

## 41. Clock Rollback

Detected rollback لايسمح بإعادةLease للحياة أوإعادةاستخدامNumber range. يسجلSecurity signal.

# القسم الحادي عشر — Reconnection and Reconciliation

## 42. Reconnection Sequence

1. Authenticate device.
2. Check lease/device state.
3. Pull urgent policy/revocation changes.
4. Uploadpending operations بنفسIDs.
5. Receive per-operation results.
6. Pull canonical changes.
7. Resolve conflicts/manual review.
8. Update snapshots/lease.
9. Finalize provisional shift close عندالاستعداد.

## 43. Accepted Operation

- تتحولCanonical.
- تحفظServer IDs/versions.
- تطبعلاشيءجديد إلاعندالحاجة.
- لايتكررInventory/Cash effect.

## 44. Rejected No-effect

- Local operation تبقىEvidence.
- UI تطلبCorrection أوSupervisor review.
- لا تحذفReceipt التاريخية.
- قدينتجVoiding/Correction workflow.

## 45. Conflict

أمثلة:

- Product became restricted.
- Price snapshot invalid.
- Permission revoked.
- Shift alreadyclosed.
- Duplicate customer identity.
- Inventory policy conflict.

النتيجة لا تتحولSuccess صامتًا.

## 46. Outcome Unknown

لايستخدمعادةلـCash-only local sale، لكنهقديظهرإذاكانهناكExternal side effect غيرمسموح أصلًا Offline. Baseline يمنعهذهالعمليات لتجنبUnknown provider outcomes.

# القسم الثاني عشر — Revocation Semantics

## 47. Types

- User membership revoked.
- Role/scope revoked.
- Device revoked.
- Terminal reassigned.
- Lease revoked.
- Tenant suspended.
- Entitlement removed.

## 48. While Offline

لايمكنضمانالوصول الفوري؛ لذلك:

- Lease قصيرة.
- Sensitive operations Online-only.
- Limits bounded.
- Last sync age reducescapability.

## 49. On Reconnect

Server يحدد لكلOperation:

- Created before revocation andwithin valid lease.
- Created after effective revocation.
- Actor/device evidence valid ornot.

Policy قدتقبلالعمليات السابقة للـRevocation إذاكانتضمنLease صحيحة، وترفضاللاحقة.

# القسم الثالث عشر — Fraud and Abuse Controls

## 50. Signals

- Excessive offline duration.
- Repeated clock changes.
- Reused operation IDs.
- Sequence gaps/rollback.
- Signature failures.
- Unusual discount pattern.
- High cumulative cash sales.
- Repeated void/reprint.
- Local database reset.
- Device clone indicators.
- Queue deletion/tampering.

## 51. Responses

- Warning.
- Reduce limits.
- Disable specific operation types.
- Force sync.
- Block Offline completion.
- Revoke lease/device عندالاتصال.
- Manual review/Audit alert.

## 52. No Silent Repair

لايعادإنشاءQueue أوSequence أوReceipt numbers صامتًا بعدtamper. يحتاجRecovery workflow.

# القسم الرابع عشر — User Experience

## 53. POS Status

يعرض دائمًا:

- Online / Offline / Degraded / Syncing / Action Required.
- Last successful sync.
- Lease expiry/countdown.
- Pending operations count.
- Conflicts count.
- Snapshot freshness warnings.

## 54. Sale Status Labels

- Saved locally.
- Completed locally — pending sync.
- Synced and accepted.
- Needs review.
- Correction required.

لا تعرض `Paid and final` إذاServer acceptance مطلوبة ولمتحدث.

## 55. Operator Guidance

الرسائل تحددالإجراء:

- Continue cash sales withinlimits.
- Connect before lease expiry.
- Supervisor approval required.
- Electronic payment unavailable offline.
- Sync required before more sales.

# القسم الخامس عشر — Error Codes

## 56. Lease Errors

- `OFFLINE_LEASE_REQUIRED`
- `OFFLINE_LEASE_EXPIRED`
- `OFFLINE_LEASE_REVOKED`
- `OFFLINE_LEASE_DEVICE_MISMATCH`
- `OFFLINE_LEASE_TERMINAL_MISMATCH`
- `OFFLINE_LEASE_MEMBERSHIP_MISMATCH`
- `OFFLINE_LEASE_SHIFT_MISMATCH`
- `OFFLINE_LEASE_SIGNATURE_INVALID`
- `OFFLINE_POLICY_VERSION_UNSUPPORTED`

## 57. Eligibility and Limits

- `OFFLINE_OPERATION_NOT_ALLOWED`
- `OFFLINE_OPERATION_REQUIRES_ONLINE`
- `OFFLINE_SALE_LIMIT_EXCEEDED`
- `OFFLINE_CUMULATIVE_LIMIT_EXCEEDED`
- `OFFLINE_DISCOUNT_LIMIT_EXCEEDED`
- `OFFLINE_QUANTITY_LIMIT_EXCEEDED`
- `OFFLINE_QUEUE_LIMIT_EXCEEDED`
- `OFFLINE_MAX_WINDOW_EXCEEDED`
- `OFFLINE_SNAPSHOT_EXPIRED`
- `OFFLINE_TAX_SNAPSHOT_EXPIRED`

## 58. Integrity Errors

- `OFFLINE_DEVICE_SIGNATURE_INVALID`
- `OFFLINE_SEQUENCE_INVALID`
- `OFFLINE_CLOCK_DRIFT_EXCEEDED`
- `OFFLINE_CLOCK_ROLLBACK_DETECTED`
- `OFFLINE_NUMBER_RANGE_EXHAUSTED`
- `OFFLINE_RECEIPT_NUMBER_REUSED`
- `OFFLINE_LOCAL_INTEGRITY_FAILED`
- `OFFLINE_OPERATION_TAMPER_DETECTED`

## 59. Reconciliation Errors

- `OFFLINE_OPERATION_REJECTED`
- `OFFLINE_OPERATION_CONFLICT`
- `OFFLINE_OPERATION_MANUAL_REVIEW_REQUIRED`
- `OFFLINE_SHIFT_FINALIZATION_BLOCKED`
- `OFFLINE_CASH_RECONCILIATION_REQUIRED`

# القسم السادس عشر — Testing Contract

## 60. Lease Tests

1. Valid lease.
2. Expired lease.
3. Wrong device/terminal/user/shift.
4. Revocation before/after operation time.
5. Renewal andsupersession.
6. Clock rollback attempt.

## 61. Sale Tests

1. Cash sale withinlimits.
2. Electronic tender blocked.
3. Discount limit.
4. Cumulative limit.
5. Snapshot expiry.
6. Receipt number exhaustion.
7. Crash afterlocal completion beforequeue response.
8. Reprint immutable snapshot.

## 62. Sync/Reconnection Tests

1. Duplicate upload sameID.
2. Server rejection.
3. Conflict/manual review.
4. Revoked permission onreconnect.
5. Cursor expired withpending queue.
6. Provisional shift close finalization.
7. Cash discrepancy case.

## 63. Security Tests

1. Copied local database.
2. Exported key attempt.
3. Invalid signature.
4. Sequence rollback.
5. Clock manipulation.
6. Lease tampering.
7. Device clone.
8. Queue deletion.

## 64. UX Tests

1. Clear offline status.
2. Lease expiry warning.
3. Pending sync visibility.
4. Electronic payment disabled message.
5. Review/correction outcome.
6. Last sync/admin terminal status.

# القسم السابع عشر — Open Decisions

## 65. OD-OFF-001 — Maximum Offline Window

Baseline 12 ساعة، و24 ساعة Continuity mode. يحتاجBusiness/Security approval نهائي.

## 66. OD-OFF-002 — Cash Sale Limits

القيم الرقمية حسبTenant/Location/Risk tier، وليستhard-coded عالميًا.

## 67. OD-OFF-003 — Offline Shift Open

Baseline مسموح فقطإذاLease سبقتالانقطاع ومنحتذلك صراحة.

## 68. OD-OFF-004 — Returns Offline

Baseline intake draft فقط؛ Posting/Refund Online.

## 69. OD-OFF-005 — Customer PII

Minimal fields فقطحتىData Classification تحددالمسموح.

## 70. OD-OFF-006 — Receipt Legal Marking

تراجع حسبالدولة والـFiscal requirements؛ Core يدعمOffline marker وverification reference.

## 71. OD-OFF-007 — Emergency Price Grace

Baseline ممنوعةبعدTax snapshot expiry؛ Price grace اختياريةومحدودة حسبTenant policy.

## 72. OD-OFF-008 — Hash Chain Strength

Baseline Tamper-evident chain للعملياتالحرجة، وليستBlockchain أوDistributed ledger.

# القسم الثامن عشر — Prohibited Patterns

## 73. أنماط ممنوعة

- Permanent offline admin account.
- Lease بلاexpiry.
- Shared device key.
- Card payment أوrefund Offline.
- Store credit/loyalty balances معتمدةمحليًا دونServer.
- تعديلPrice/Tax master Offline.
- Cash/Inventory balance overwrite.
- حذفLocal failed operations.
- توليدClientOperationId جديدة عندretry.
- Trust device wall clock وحده.
- إعادةاستخدامReceipt number.
- إخفاءPending Sync عنالمستخدم.
- Final shift close قبلSync.
- Auto-accept conflict بسببأنالعميل باعالفعل.
- Unlimited discount/amount/count.
- Snapshot بلاsignature/checksum/version.
- Remote revocation مفترضةفورية دونLease design.

# القسم التاسع عشر — Acceptance Gate

## 74. بوابة الاعتماد

لا يعتبر Offline Protocol مكتملًا قبل:

1. تعريفLease contract وحالاتها.
2. تحديدCapability levels.
3. تحديدAllowed/Conditional/Online-only operations.
4. تحديدكلLimit dimensions وطريقةالحساب.
5. ربطTransactions بـCatalog/Price/Tax snapshots.
6. تثبيتShift/Cash continuity.
7. تثبيتOffline Sale lifecycle وEvidence.
8. تثبيتNumber range وReceipt rules.
9. تثبيتDevice signing وClock trust.
10. تثبيتReconnection outcomes.
11. تثبيتRevocation semantics.
12. تثبيتFraud signals/responses.
13. تثبيتPOS/Admin status requirements.
14. تحديدError codes والاختبارات.
15. ربطالوثيقة بالSync/API/Error/Permission/Audit catalogs.
16. منعكلProvider-dependent financial operation Offline.
17. تحديدMaximum Offline Window نهائيًا قبلالتنفيذ.

## 75. القرار التخطيطي الحالي

- Offline capability تمنحفقطعبرLease قصيرة وموقعة.
- Cash-only sales هيTransactional baseline.
- Electronic payment/refund/store value Online-only.
- Sale تحتفظبكلSnapshot versions والـEvidence.
- Provisional shift close فقط؛ Final close بعدSync.
- Receipt numbers تخصصبنطاقات فريدة لكلTerminal/Lease.
- Device operations موقعة ومحميةبتسلسل/Hash chain.
- Clock manipulation تقللالصلاحية أوتوقفها.
- Server يعيدفحصكلOperation عندالمزامنة.
- Rejection لايمحوالأثر المحلي؛ ينتجCorrection/Reconciliation.
- لا يوجدUnbounded Offline mode.

## 76. المرحلة التالية

**ATHR Database Blueprint v1.0**

سيثبت:

- PostgreSQL schemas وحدودContexts.
- Aggregate وLedger وSnapshot tables.
- Tenant isolation keys.
- IDs وversions وtimestamps.
- Constraints وunique indexes.
- Outbox وInbox وIdempotency stores.
- Audit storage.
- Sync change log وcursor data.
- Offline lease/dedup/conflict records.
- Partitioning وretention وarchival.
- Migration rules وzero-downtime compatibility.
- Backup/restore integrity requirements.