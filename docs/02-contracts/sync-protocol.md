# ATHR Sync Protocol v1.0

**Planning Baseline — Bootstrap, Change Feed, Operation Upload, Conflict Resolution and Recovery**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة عقد المزامنة بين ATHR Server والعملاء المحليين، خصوصًا POS Terminals، وتثبت:

- تسجيل جهاز المزامنة وربطه بالـTenant والـLocation والـTerminal.
- Bootstrap الأولي.
- Snapshot generation والتطبيق.
- Incremental change feed.
- Cursor semantics.
- Upload batches للعمليات المحلية.
- Deduplication وIdempotency.
- Temporary ID وCanonical ID mapping.
- Ordering وDependencies.
- Conflict detection والتصنيف.
- Server authority وMerge policies.
- Tombstones والحذف المنطقي.
- Schema/version compatibility.
- Retry وBackoff وRate controls.
- Partial batch results.
- Recovery منcursor expiry أوlocal corruption.
- Security وAudit وMonitoring.

هذه الوثيقة تحدد النقل والمصالحة، ولا تمنح حق إنشاء عملية Offline. صلاحية التنفيذ دوناتصال يحددها **ATHR Offline Protocol v1.0** التالي.

## 2. الحدود والمسؤوليات

### Sync Protocol مسؤول عن

- نقل Client Operations إلىالخادم.
- نقل Canonical Changes إلىالعميل.
- إثبات ما استلمه كلطرف.
- منع تكرار الأثر.
- اكتشاف التعارضات.
- وصف طريقة الاسترداد.

### Sync Protocol غيرمسؤول عن

- امتلاك Business truth.
- تجاوزBusiness invariants.
- اختراعMerge تلقائي لحقائق مالية.
- منحPermissions أوEntitlements.
- تنفيذPayment provider operation Offline.
- اعتبارLocal database هيالمصدر النهائي.

> المزامنة ناقل ومصالح، وليستOwner لأيحقيقة تجارية.
> 

## 3. المبادئ الإلزامية

1. Server هوالمرجعCanonical لكلBusiness fact بعدقبول العملية.
2. Local record قدتكونProvisional حتىإقرارالخادم.
3. كلClient Operation لها`client_operation_id` ثابت وفريد داخلDevice.
4. Retry لاينشئOperation جديدة.
5. Transport at-least-once، وBusiness effect exactly-once عبرIdempotency.
6. Batch ليستAtomic افتراضيًا.
7. كلعنصر فيBatch لهنتيجة مستقلة.
8. Server لايطبقClient state snapshot ككتابة عامة.
9. العميل يرسلIntent أوCommand، لاصفًا كاملًا ليحل محلCanonical record.
10. Cursors opaque ومقيدةبالجهاز والـScope والـSchema.
11. لا يوجدGlobal ordering لكلTenant.
12. Ordering المطلوب يحدد perstream أوperaggregate.
13. Missing change لايعالج بالقفز الصامت.
14. Cursor expired ينتجSnapshot recovery.
15. Conflict لايعنيLast-write-wins.
16. Posted ledgers والـCompleted transactions لاتدمج حقليًا.
17. Authorization وEntitlement يعادفحصهما عندServer acceptance.
18. Revocation يمكنأنترفضعملية أنشئت محليًا وفقOffline policy.
19. Sync response لايعتبر downstream projections فورية إلاإذاصرح بذلك.
20. Local deletion لايحذفCanonical resource إلاعبرCommand معتمدة.
21. Tombstones تحفظ لمدةتكفي لكلالأجهزة المتوقعة.
22. كلوقت محلي يسجل منفصلًا عنServer recorded time.
23. Sync لايثقفيClient totals أوbalances أوsequence وحدها.
24. Sensitive payloads تقلل وتشفّر أثناءالنقل والتخزين.
25. جهازلايستطيعطلبScope خارجLease وMembership وTerminal assignment.

# القسم الأول — Sync Participants and Identity

## 4. الأطراف

### Sync Client

تطبيق POS/Device يحتفظLocal Store وOperation Queue وApplied Change Cursor.

### Sync Gateway

سطح API يتحقق منDevice credential والـProtocol version والـRate limits.

### Sync Application Service

يحللBatches ويحوّلClient Operations إلىCommands مملوكة بالـContexts.

### Domain Owners

تتحقق منState وPermissions وInvariants وتنتجCanonical events.

### Change Feed Publisher

ينشرRead-model changes المصرح بها للجهاز.

### Snapshot Builder

يبنيBaseline ثابتة وموقعة أوذاتChecksum.

## 5. Device Sync Identity

كلطلب مزامنة يرتبط بـ:

- tenant_id.
- device_id.
- terminal_id عنداللزوم.
- location_id.
- device credential version.
- membership/user session عندoperations البشرية.
- offline lease ID للعمليات التيأنشئت Offline.
- authorization version.
- entitlement version.
- protocol version.
- client application version.

### ممنوع

- Shared sync credential بينعدةDevices.
- TenantId موثوق منBody فقط.
- إرسالعمليات باسمUser غيرموجودفيLocal actor evidence.
- استمرارSync بعدDevice revoked دونرفض واضح.

## 6. Device Sync States

`Unregistered → Registered → Bootstrapping → Ready → Degraded → ResyncRequired → Revoked`

### Registered

الجهازمعروف لكنلميكملBaseline.

### Bootstrapping

Snapshot/manifest قيدالتطبيق.

### Ready

Upload/download incremental مسموح.

### Degraded

يمكناستمرار بعضالعمليات لكنيوجدمشكلة lag أوpartial feed.

### ResyncRequired

Incremental sync ممنوعة حتىSnapshot جديدة.

### Revoked

كلSync مرفوضة، معسياسة منفصلة لتسليمEvidence أخيرة إنسمحتSecurity policy.

# القسم الثاني — Local Client Model

## 7. Local Store Components

- Canonical projection tables.
- Provisional resources.
- Operation queue.
- Operation result ledger.
- Applied change ledger.
- Cursor state.
- ID mapping table.
- Conflict queue.
- Snapshot metadata.
- Device/lease/policy metadata.
- Local audit trail.

## 8. Operation Queue States

`Draft → ReadyToSend → Sending → Acknowledged → Accepted | Rejected | PendingReconciliation | Conflict | Superseded`

### Sending لايعنيAccepted

إذاانقطعالاتصال، تعودالعملية `ReadyToSend` بنفسID، لاOperation جديدة.

### Acknowledged

Server استلمBatch بشكلDurable، لكننتيجةالعنصر قدلاتكوننهائية.

## 9. Local Canonical vs Provisional Data

### Canonical

وصلت منServer change feed أوتأكدقبولها فيOperation result.

### Provisional

أنشئت أوعدلت محليًا ولمتقبلبعد.

### Derived local UI state

قدتجمعCanonical +Provisional للعرض، لكنيجبتمييزها داخليًا ومنعاعتبارهاServer truth.

## 10. Local Transaction Rules

- حفظBusiness intent وOperation queue فينفسLocal transaction.
- لا تظهرعملية للمستخدم كناجحةمحليًا إنفشلحفظQueue evidence.
- تغييرQueue state وResult ledger Atomic محليًا.
- تطبيقChange وCursor advancement Atomic محليًا.

# القسم الثالث — Protocol Endpoints

## 11. Baseline Routes

```
POST /api/v1/sync/bootstrap
GET  /api/v1/sync/manifests/{manifest_id}
POST /api/v1/sync/snapshots:request
GET  /api/v1/sync/snapshots/{snapshot_id}
GET  /api/v1/sync/changes?cursor=...
POST /api/v1/sync/operations
GET  /api/v1/sync/batches/{batch_id}
GET  /api/v1/sync/operations/{client_operation_id}
POST /api/v1/sync/conflicts/{conflict_id}:resolve
POST /api/v1/sync/acknowledgements
GET  /api/v1/sync/status
```

## 12. Standard Sync Headers

- `Authorization`
- `X-Device-Id`
- `X-Terminal-Id`
- `X-Sync-Protocol-Version`
- `X-Client-Version`
- `X-Request-Id`
- `Content-Encoding`
- `If-None-Match` للـManifest/Snapshot metadata.

## 13. Sync Request Context

```json
{
  "device_id": "dev_...",
  "terminal_id": "term_...",
  "location_id": "loc_...",
  "protocol_version": "1.0",
  "client_version": "1.4.0",
  "local_schema_version": 12,
  "last_applied_cursor": "opaque-or-null",
  "last_successful_sync_at": "2026-07-29T04:00:00Z",
  "device_clock_at": "2026-07-29T04:02:00Z"
}
```

Server لايثقفيLocation أوversions المرسلة؛ يطابقهابالسجلCanonical.

# القسم الرابع — Bootstrap

## 14. Bootstrap Purpose

يستخدم عند:

- أولتسجيل للجهاز.
- Local database جديدة.
- Cursor expired.
- Schema incompatible.
- Integrity failure.
- Scope changed materially.
- Manual full resync.

## 15. Bootstrap Request

```json
{
  "requested_scopes": ["catalog", "pricing", "tax", "customers_minimal", "terminal_config"],
  "capabilities": {
    "compression": ["gzip"],
    "max_chunk_bytes": 5242880,
    "supported_schema_versions": [11, 12]
  },
  "existing_snapshot_id": null
}
```

Requested scopes مجردcapability request؛ Server يحددEffective scope.

## 16. Bootstrap Response

```json
{
  "data": {
    "bootstrap_id": "boot_...",
    "state": "snapshot_required",
    "manifest_id": "manifest_...",
    "snapshot_id": "snap_...",
    "starting_cursor": "cursor_...",
    "effective_scope": {
      "tenant_id": "tenant_...",
      "location_ids": ["loc_..."],
      "warehouse_ids": ["wh_..."],
      "terminal_id": "term_..."
    },
    "authorization_version": "authz_42",
    "entitlement_version": "ent_18",
    "offline_policy_version": "off_7"
  }
}
```

## 17. Bootstrap Consistency Point

Snapshot وstarting cursor يجب أنيمثلا نفسLogical cutoff:

- Snapshot تحتويالحالة حتى`cutoff_sequence`.
- Change feed تبدأبعدهذاالـcutoff.
- لاGap ولادuplicate effect؛ duplicate change application آمن بالـChangeId.

## 18. Bootstrap Completion

Client يثبت:

- كلchunks مكتملة.
- checksums صحيحة.
- schema compatible.
- local apply transaction succeeded.
- starting cursor محفوظ.

ثميرسلAcknowledgement. قبلذلكيبقىDevice `Bootstrapping`.

# القسم الخامس — Manifest and Snapshot

## 19. Snapshot Manifest

```json
{
  "manifest_id": "manifest_...",
  "snapshot_id": "snap_...",
  "schema_version": 12,
  "cutoff": "feed-sequence-884211",
  "created_at": "2026-07-29T04:01:00Z",
  "expires_at": "2026-07-29T10:01:00Z",
  "datasets": [
    {
      "name": "products",
      "version": 3,
      "record_count": 4200,
      "chunks": 4,
      "checksum": "sha256:..."
    }
  ],
  "manifest_checksum": "sha256:..."
}
```

## 20. Snapshot Datasets Baseline

- Tenant/location configuration.
- Device/terminal configuration.
- Product catalog.
- Variants وIdentifiers.
- UOM/conversion versions.
- Active/scheduled price snapshots المسموحة.
- Tax versions.
- Promotions/coupon metadata المسموحة.
- Customer minimal index حسبpolicy.
- Open local-shift resources عندrecovery.
- Open terminal-specific provisional reconciliation references.
- Entitlements وoffline policy metadata.

### لا تدخل افتراضيًا

- Full audit history.
- Full payment provider evidence.
- Historical documents binaries.
- Cross-location data خارجscope.
- Raw PII غيرضرورية للـPOS.

## 21. Snapshot Chunk Contract

كلChunk تحتوي:

- dataset name/version.
- chunk index/count.
- records.
- chunk checksum.
- previous/next references optional.

Client يطبقالـSnapshot إلىStaging store، ثمAtomic swap أوtransactional replace.

## 22. Snapshot Expiry

إذاانتهتقبلالإكمال:

- Client لايمزجSnapshot قديمة معجديدة.
- يطلبManifest/Snapshot جديدة.
- partial chunks تحذف أوتوسمغيرصالحة.

## 23. Snapshot Redaction

Snapshot مبنية حسبEffective permissions/data classes وقتالإنشاء. تغييرScope بعدذلك قديفرض:

- Incremental tombstones/visibility revocations.
- أوFull resync إذاالتغييرواسع أوحساس.

# القسم السادس — Change Feed

## 24. Change Feed Purpose

تنقلCanonical projection changes، وليستDomain event stream خامًا.

### السبب

- Domain Events قدتحتويتفاصيلغيرصالحةللعميل.
- Projection change يمكنأنتمثلRedaction وScope وSchema مناسبًا.
- نفسDomain Event قدينتجعدةClient changes أوصفر.

## 25. Change Envelope

```json
{
  "change_id": "chg_...",
  "change_type": "upsert|tombstone|visibility_revoked|policy_changed|resync_required",
  "resource_type": "product",
  "resource_id": "prod_...",
  "resource_version": 14,
  "partition_key": "loc_...",
  "occurred_at": "2026-07-29T04:03:10Z",
  "recorded_at": "2026-07-29T04:03:11Z",
  "schema_version": 3,
  "payload": {},
  "caused_by_client_operation_id": null
}
```

## 26. Change Ordering

### Guaranteed

- Feed order داخلنفسCursor partition.
- Resource versions monotonic لكلResource.
- ChangeId فريدة.

### غيرمضمون

- Global chronological order بينكلContexts.
- Arrival order يساويOccurredAt.
- Projection change تظهر فورDomain commit بلاlag.

## 27. Applying Changes

Client:

1. يتحقق schema/type.
2. يتحققChangeId dedupe.
3. يقارنresource version.
4. يطبقupsert/tombstone.
5. يسجلApplied Change.
6. يحركcursor فينفسLocal transaction.

### Duplicate

إذاChangeId مطبقة، يتجاوزها دونخطأ.

### Older resource version

لا تكتبفوقنسخةأحدث؛ تسجلTelemetry وتكملإذاpolicy تسمح.

### Version gap

قديكونطبيعيًا إذاFeed ترسلlatest projection فقط، أومشكلةإذاresource stream يتطلبكلنسخة. Metadata تحدد`delivery_mode`.

## 28. Feed Delivery Modes

### Latest-state change

يمكنتخطيintermediate resource versions؛ مناسبCatalog projections.

### Every-transition change

كلtransition مطلوب؛ مناسبOperation results وcritical reconciliation references.

### Ledger-safe projection

يرسلEntries أوimmutable records، لاbalance overwrite فقط.

## 29. Long Polling

`GET /changes` يمكنأنيدعم:

- `wait_seconds` bounded.
- `limit` bounded.
- immediate empty response.

WebSocket/push ليسbaseline؛ قدينبهClient بوجودChanges لكنالاستلامCanonical عبرfeed.

# القسم السابع — Cursor Contract

## 30. Cursor Properties

Cursor:

- Opaque.
- Signed أوserver-validated.
- مرتبطةTenant/Device/Scope.
- مرتبطةFeed schema version.
- تتضمنأوتشيرإلىposition وpartition set.
- لهاretention/expiry.

## 31. Cursor Errors

- `SYNC_CURSOR_INVALID`
- `SYNC_CURSOR_EXPIRED`
- `SYNC_CURSOR_SCOPE_MISMATCH`
- `SYNC_CURSOR_SCHEMA_MISMATCH`
- `SYNC_CURSOR_DEVICE_MISMATCH`
- `SYNC_CURSOR_AHEAD_OF_SERVER`

## 32. Cursor Advancement

Server يرجع`next_cursor` معpage. Client لايحفظه إلا بعدتطبيقكلchanges بنجاح.

## 33. Empty Page

قديتغيرcursor حتىلولاChanges بسببcheckpoint compaction؛ Client يحفظه بعدنجاحالاستجابة.

## 34. Retention and Expiry

مدةRetention يجب أنتغطيExpected offline window +safety margin. إذاالجهازغابأطول:

- Server يرجع`resync_required`.
- Client يحتفظOutbound operations.
- يجلبSnapshot.
- يعيدRebase/submit العملياتالمعلقة وفقOffline Protocol.

# القسم الثامن — Outbound Client Operations

## 35. Operation Envelope

```json
{
  "client_operation_id": "01J...",
  "operation_type": "sales.sale.complete-cash",
  "operation_schema_version": 2,
  "aggregate_type": "sale",
  "resource_id": "sale_local_...",
  "expected_server_version": null,
  "occurred_at": "2026-07-29T03:55:00Z",
  "local_sequence": 481,
  "actor": {
    "identity_id": "id_...",
    "membership_id": "mem_..."
  },
  "context": {
    "tenant_id": "tenant_...",
    "location_id": "loc_...",
    "terminal_id": "term_...",
    "shift_id": "shift_...",
    "device_id": "dev_...",
    "offline_lease_id": "lease_..."
  },
  "dependencies": ["client-op-previous"],
  "payload": {},
  "payload_hash": "sha256:...",
  "signature": "..."
}
```

## 36. Operation Types

Operation type قائمةAllow-list منشورة، وليستاسمEndpoint حر. كلنوع يحدد:

- Owner Context.
- Permission key.
- Offline eligibility.
- Payload schema.
- Required dependency types.
- Idempotency retention.
- Conflict policy.
- Result projection.

## 37. Batch Request

```json
{
  "batch_id": "client-batch-...",
  "previous_batch_id": "client-batch-...",
  "operations": [],
  "client_state": {
    "last_applied_cursor": "cursor_...",
    "local_schema_version": 12,
    "queue_depth": 37
  }
}
```

## 38. Batch Limits

- Max operations.
- Max compressed/uncompressed bytes.
- Maxdependency depth.
- Maxage peroperation حسبtype.
- Rate/cost limit perdevice.

Server قديرفضBatch malformed كاملة، لكنهلايرفضكلbatch بسببBusiness failure لعنصرواحد.

## 39. Batch Acknowledgement

HTTP success يعنيBatch envelope استلمت وفحصت. النتائج:

- Inline إذاسريعة.
- أو`202` مع`batch_status_url`.

## 40. Operation Result

```json
{
  "client_operation_id": "01J...",
  "status": "accepted|rejected|conflict|pending|duplicate|manual_review",
  "outcome": "committed|no_effect|pending|unknown|partial",
  "canonical_resource_id": "sale_...",
  "canonical_version": 1,
  "error": null,
  "result_changes": [],
  "required_action": null,
  "operation_id": "op_...",
  "recorded_at": "2026-07-29T04:04:00Z"
}
```

## 41. Duplicate Result

إذاسبققبولنفسClientOperationId:

- يرجع`duplicate` أونفسstatus الأصلية.
- نفسCanonical IDs/versions.
- لايتكررDomain effect.

إذانفسID معPayload hash مختلفة:

- `SYNC_OPERATION_ID_REUSED_WITH_DIFFERENT_PAYLOAD`.
- Critical audit/security signal.

# القسم التاسع — Idempotency and Deduplication

## 42. Deduplication Key

Baseline:

`TenantId + DeviceId + ClientOperationId`

قدتضافOperationType كفحص، لكنها لاتسمحبإعادةاستخدامID.

## 43. Deduplication Record

يحفظ:

- operation ID/type/schema.
- payload hash.
- first received at.
- final/last status.
- canonical result references.
- error/reconciliation reference.
- retention class.

## 44. Retention

- Financial/ledger operations: long enough topreventduplicate overlegal/recovery horizon.
- Routine drafts: shorter policy.
- لا تحذفDedup record بينماDevice قدتعيدoperation ضمنsupported window.

## 45. Server Crash Cases

### Before Domain commit

Retry تعيدالتنفيذ بأمان.

### After Domain commit beforeResult saved

Domain command idempotency أوoutbox correlation تستعيدالنتيجة، ولاينشأأثرثانٍ.

### AfterResult saved beforeResponse

Retry ترجعstored result.

# القسم العاشر — Dependencies and Ordering

## 46. Local Sequence

Local sequence تكشفgap أوreordering، لكنها ليستAuthorization ولاCanonical global order.

## 47. Explicit Dependencies

تستخدمعندماOperation تحتاجنتيجةأخرى، مثل:

- Sale line changes قبلSale complete.
- Shift open قبلCash sale.
- Local customer create قبلattach customer.
- Return create قبلRefund request.

## 48. Dependency Results

- Dependency accepted → evaluate child.
- Dependency pending → child `blocked_by_dependency`.
- Dependency rejected → child rejected/superseded حسبpolicy.
- Circular dependency → batch validation error.

## 49. Parallelism

Server يمكنمعالجةOperations غيرالمترابطة بالتوازي، معSerialization perAggregate أوperbusiness partition عندالحاجة.

## 50. Aggregate Ordering

عملياتنفسAggregate تستخدم:

- explicit dependency chain.
- expected version.
- local sequence check optional.
- server optimistic concurrency.

# القسم الحادي عشر — Temporary and Canonical IDs

## 51. Client-generated IDs

Client يمكنإنشاءOpaque IDs للـResources المسموحة Offline.

### Baseline preference

استخدامID تصلحأن تصبحCanonical مباشرة عندماformat آمن وفريد.

## 52. ID Mapping

إذاServer يستبدلID:

```json
{
  "resource_type": "customer",
  "client_resource_id": "cust_local_1",
  "canonical_resource_id": "cust_..."
}
```

Client يحفظmapping ولايعيدكتابةHistorical operation payloads؛ resolution layer تستخدمmapping.

## 53. Collision

إذاClient ID مستخدمةلمورد آخر أوTenant آخر:

- رفض آمن.
- لايكشفresource الآخر.
- operation تدخلConflict/Manual resolution.

# القسم الثاني عشر — Conflict Model

## 54. تعريف Conflict

Conflict يحدث عندماIntent محلي صالح وقتالإنشاء لايمكنتطبيقهاCanonical كماهي بسببنسخة أوحالة أوPolicy أوScope تغيرت.

## 55. Conflict Categories

- `version_conflict`
- `state_conflict`
- `uniqueness_conflict`
- `reference_conflict`
- `authorization_conflict`
- `entitlement_conflict`
- `policy_version_conflict`
- `inventory_availability_conflict`
- `pricing_conflict`
- `identity_mapping_conflict`
- `deletion_conflict`
- `dependency_conflict`

## 56. Conflict Resolution Classes

### Auto Accept

العمليةCommutative ولا تكسرInvariant، مثلإضافةObservation مستقلة.

### Auto Rebase

Server يعيدتطبيقIntent علىنسخةأحدث وفقPolicy معلنة.

### Server Wins

Local provisional state تزال أوتتحولRejected؛ مناسبMaster configuration.

### Client Retry After Refresh

Client يجلبCanonical state ويطلبقرارالمستخدم.

### Compensating Workflow

الأثر المحلي وقع بالفعل ويحتاجCorrection/Return/Reconciliation.

### Manual Review

لايمكنالقرار تلقائيًا، خاصةالمال والمخزون والهوية.

## 57. ممنوع Last-write-wins

في:

- Payments/refunds.
- Inventory movements.
- Cash movements.
- Posted returns.
- Shift close.
- Purchase receipt posting.
- Permissions/roles.
- Tax/price activated versions.
- Store credit/loyalty/receivables ledgers.

## 58. Conflict Resource

```json
{
  "conflict_id": "conf_...",
  "client_operation_id": "...",
  "category": "state_conflict",
  "resource_type": "sale",
  "resource_id": "sale_...",
  "local_intent_summary": {},
  "canonical_summary": {},
  "allowed_resolutions": ["discard_local", "create_correction", "manual_review"],
  "state": "open",
  "created_at": "..."
}
```

Sensitive fields redacted حسبPermission.

## 59. User-facing Conflict Rules

- لاتعرضTechnical stack.
- توضحهلتمحفظالعملية محليًا.
- توضحهلحدثCanonical effect.
- تمنعزرRetry إذاقديكررأثرمالي.
- تربطSupport/reference عندManual review.

# القسم الثالث عشر — Merge Policies by Data Class

## 60. Reference Master Data

Products/categories/config:

- Server wins baseline.
- Local unsent drafts يمكنإعادةتطبيقها يدويًا.
- Versioned active rules لاتعدل.

## 61. Append-only Business Records

Ledger entries/documents/events:

- Dedup byoperation/reference.
- لاfield merge.
- correction أوopposing record فقط.

## 62. Draft Transactions

Sales/PO drafts:

- Optimistic concurrency.
- Field-level merge فقطللحقولالمستقلة المعلنة.
- Line collections تحتاجstable line IDs.
- Totals يعادحسابهاServer-side.

## 63. User Preferences

يمكنLast-write-wins بالـserver recorded time فقطإذاغيرحساسة ومعلنة.

## 64. Customer Data

- Client updates تحتاجfield version/expected version.
- Contact/identity collisions Manual review.
- Merge/anonymization Server-governed.
- PII visibility revocation تزيلLocal fields فورًا.

# القسم الرابع عشر — Resource Sync Eligibility

## 65. Download-eligible Baseline

- Products/variants/identifiers.
- Location assortments.
- Active price/tax/promotion snapshots.
- Minimal customer lookup حسبpolicy.
- Terminal/device configuration.
- Shift andcash state للـterminal.
- Operation outcomes/conflicts.
- Documents metadata/print payloads المسموحة.

## 66. Upload-eligible Baseline

- Allowed local sale drafts/completions.
- Cash tender/cash movement ضمنOffline policy.
- Stock count observations.
- Limited customer create/update fields.
- Print acknowledgements.
- Device health/status.

## 67. Online-only/Not Sync-command Baseline

- Electronic payment/refund execution.
- Role/scope changes.
- Provider configuration.
- Tax/price publication.
- Legal hold/disposition.
- Tenant closure.
- Subscription/entitlement override.
- Support/Break-glass.

Offline Protocol يثبتالقائمة النهائية والـlimits.

# القسم الخامس عشر — Authorization and Policy Changes

## 68. Authorization Version

كلLease/Bootstrap/Operation تحملauthorization version. Server يقارنCurrent version.

### تغيير الصلاحيات

قدينتج:

- Immediate rejection للعمليات الجديدة.
- Visibility revocation changes.
- Lease revocation.
- ResyncRequired لتغييرscope واسع.

## 69. Entitlement Version

Feature/limit يتحقق عندالقبول. Local availability لايضمنServer acceptance.

## 70. Policy Effective Time

Offline Protocol يحدد هلعمليةأنشئت قبلrevocation تقبل. Sync تنقل:

- occurred_at evidence.
- recorded_at server.
- lease effective/expiry.
- policy version.

# القسم السادس عشر — Tombstones and Data Removal

## 71. Tombstone

```json
{
  "change_type": "tombstone",
  "resource_type": "product",
  "resource_id": "prod_...",
  "resource_version": 19,
  "reason": "archived",
  "effective_at": "..."
}
```

## 72. Visibility Revoked

مختلفةعنالحذف؛ المورد قدمازال موجودًا لكنالجهاز فقدScope. Client:

- يزيل/يردact fields حسبclassification.
- يمنعالاستخدامالجديد.
- يحتفظبminimal reference إذايلزمHistorical local transaction وبسياسةمشفرة.

## 73. Purge Safety

Server لايتخلص منtombstones قبل:

- انتهاءsupported cursor window.
- أوإجباركلالأجهزة القديمة علىresync.

## 74. Local Purge

- Provisional operations لا تحذف قبلfinal result/retention.
- Canonical cache يمكنتنظيفهابعدtombstone/visibility change.
- Legal/receipt local copies تخضعRetention/Offline rules.

# القسم السابع عشر — Schema Evolution

## 75. Version Layers

- Sync protocol version.
- Operation schema version.
- Change schema version.
- Snapshot dataset version.
- Local database schema version.

## 76. Compatibility

### Compatible

- Optional field.
- Newchange type إذاclient declared unknown-safe.
- Newdataset اختياري.

### Breaking

- Required field جديد.
- Field meaning/type change.
- Cursor semantics change.
- Operation behavior change.
- Money/quantity representation change.

## 77. Capability Negotiation

Bootstrap يرسلCapabilities، Server يختارنسخةمدعومة ويرجعminimum client version عندالحاجة.

## 78. Client Too Old

- `SYNC_CLIENT_VERSION_UNSUPPORTED`.
- قديسمحRead-only grace حسبpolicy.
- لايسمحOperations غيرمفهومة.

## 79. Dual Schema Window

Server قدينتجنسختين لفترةMigration، لكنلايخلطschemas داخلنفسBatch/Feed دونmetadata صريحة.

# القسم الثامن عشر — Compression, Transport and Payload Limits

## 80. Compression

- gzip baseline عندالحجم المناسب.
- Checksums علىuncompressed canonical content أوكمايحددmanifest.
- حمايةمنcompression bombs.

## 81. Chunking

- Snapshot chunks مستقلة.
- Operation batches bounded.
- Change pages bounded بالعدد والحجم والزمن.

## 82. Network Retry

- Exponential backoff +jitter.
- Respect `Retry-After`.
- Same ClientOperation IDs.
- Separate backoff forupload/download.
- لاbusy loop عندعدماتصال.

## 83. Connection Detection

Online indicator لايعتمدوجودNetwork interface فقط. يحتاجsuccessful authenticated health/sync exchange حديث.

### POS status baseline

- Online.
- Offline.
- Degraded.
- Syncing.
- Action required.
- Last successful sync time.
- Pending operations count.
- Failed/conflict operations count.

# القسم التاسع عشر — Failure and Recovery

## 84. Failure Classes

- Transport failure.
- Authentication/device failure.
- Batch envelope failure.
- Per-operation business rejection.
- Cursor failure.
- Snapshot failure.
- Local storage failure.
- Integrity/checksum failure.
- Schema incompatibility.
- Server partial outage.

## 85. Transport Failure

لا تغيرOperation state إلىRejected. تبقىقابلةلإعادةالإرسال.

## 86. Batch Malformed

Batch كاملة مرفوضة دونمعالجةالعناصر، معerror واضح. Client يصلحenvelope ولايغيرOperation IDs.

## 87. Partial Operation Results

Client يحفظكلنتيجةمستلمة. Missing results تبقىPending وتستعلمبـOperation ID، لايعيدإنشاءها.

## 88. Cursor Corruption/Expiry

1. Stop applying incremental changes.
2. Preserve outbound queue.
3. Request new snapshot.
4. Apply snapshot staging.
5. Rebase pending operations.
6. Resume upload/feed.

## 89. Local Database Corruption

- Quarantine local store.
- Preserve signed operation queue/evidence إنأمكن.
- New bootstrap.
- Re-submit unacknowledged operations بنفسIDs.
- لايمزجcorrupt projections معSnapshot جديدة.

## 90. Server Change Feed Lag

Responses تحملfreshness/lag. Client لايفترضأنOperation result وChange feed يصلانمعًا.

## 91. Disaster Recovery

بعدServer restore:

- Cursor epochs قدتتغير.
- Devices تحصل`resync_required` عندعدمضمانcontinuity.
- Deduplication records يجبأنترجعمعBusiness data.
- لايسمحrestore يسببقبولDuplicate financial operations.

# القسم العشرون — Acknowledgements

## 92. Change Acknowledgement

Baseline cursor pull لايتطلبAck لكلChange، لكنيمكنإرسالcheckpoint دوري للـMonitoring وtombstone safety.

## 93. Operation Acknowledgement

Server حفظOperation result؛ Client يؤكدتطبيقها محليًا اختياريًا. عدمAck لايعيدBusiness effect.

## 94. Snapshot Acknowledgement

إلزامي لتغييرDevice state إلىReady.

# القسم الحادي والعشرون — Security and Privacy

## 95. Transport Security

- TLS only.
- Device credentials rotatable.
- Request signing للـOffline operations حسبOffline Protocol.
- Replay protection.
- Rate limiting.
- Payload size/depth limits.

## 96. Data Minimization

- Device يحصلأقلScope وFields.
- Customer PII محدودة.
- لاprovider secrets أوraw payment evidence.
- Logs لاتحفظfull payloads الحساسة.

## 97. Device Revocation

- New sync rejected.
- Active tokens/leases invalidated.
- Platform records last seen/attempt.
- سياسةRemote wipe signal ممكنة لاحقًا وليستضمانًا.

## 98. Tamper Detection

- Operation signatures/checksums.
- Local sequence anomalies.
- Payload hash mismatch.
- Reused operation ID.
- Impossible clock patterns.
- Device identity mismatch.

# القسم الثاني والعشرون — Audit and Observability

## 99. Audit Actions

- Bootstrap requested/completed/failed.
- Snapshot issued/applied acknowledgment.
- Operation accepted/rejected/conflict/manual review.
- Lease/auth version conflict.
- Cursor resync required.
- Device revoked sync attempt.
- Manual conflict resolution.
- Operation replay anomaly.

High-volume routine changes تستخدمOperational telemetry، لاAudit record لكلcache upsert.

## 100. Metrics

- Sync success rate.
- Upload/download latency.
- Batch size.
- Operations accepted/rejected/conflict.
- Duplicate ratio.
- Pending queue age/depth.
- Cursor age.
- Snapshot generation/apply duration.
- Feed lag.
- Devices not synced bythreshold.
- Resync frequency.
- Signature/checksum failures.

## 101. Admin Monitoring

Tenant-authorized dashboard تعرض:

- Terminal online/degraded/offline.
- Last successful sync.
- Last contact.
- Pending count.
- Conflict count.
- Current client/protocol/schema versions.
- Snapshot/resync state.
- Device/lease status.

لا تعرضSensitive payloads افتراضيًا.

## 102. Alerts

- Pending critical operation aging.
- Repeated sync failures.
- Large queue growth.
- Cursor near expiry.
- Device clock drift.
- Dedup anomaly.
- Snapshot checksum failure.
- Many conflicts afterpolicy/catalog change.
- Revoked device activity.

# القسم الثالث والعشرون — Error Codes

## 103. Protocol Errors

- `SYNC_PROTOCOL_VERSION_REQUIRED`
- `SYNC_PROTOCOL_VERSION_UNSUPPORTED`
- `SYNC_CLIENT_VERSION_UNSUPPORTED`
- `SYNC_DEVICE_NOT_REGISTERED`
- `SYNC_DEVICE_REVOKED`
- `SYNC_TERMINAL_MISMATCH`
- `SYNC_SCOPE_MISMATCH`
- `SYNC_BOOTSTRAP_REQUIRED`
- `SYNC_RESYNC_REQUIRED`
- `SYNC_BATCH_MALFORMED`
- `SYNC_BATCH_TOO_LARGE`
- `SYNC_BATCH_RATE_LIMITED`

## 104. Snapshot Errors

- `SYNC_SNAPSHOT_NOT_FOUND`
- `SYNC_SNAPSHOT_EXPIRED`
- `SYNC_SNAPSHOT_SCHEMA_UNSUPPORTED`
- `SYNC_SNAPSHOT_CHECKSUM_FAILED`
- `SYNC_SNAPSHOT_CHUNK_MISSING`
- `SYNC_SNAPSHOT_SCOPE_CHANGED`

## 105. Cursor/Feed Errors

- `SYNC_CURSOR_INVALID`
- `SYNC_CURSOR_EXPIRED`
- `SYNC_CURSOR_SCOPE_MISMATCH`
- `SYNC_CURSOR_DEVICE_MISMATCH`
- `SYNC_CURSOR_SCHEMA_MISMATCH`
- `SYNC_CHANGE_SCHEMA_UNSUPPORTED`
- `SYNC_CHANGE_APPLICATION_FAILED`

## 106. Operation Errors

- `SYNC_OPERATION_TYPE_UNSUPPORTED`
- `SYNC_OPERATION_SCHEMA_UNSUPPORTED`
- `SYNC_OPERATION_ID_REQUIRED`
- `SYNC_OPERATION_ID_REUSED_WITH_DIFFERENT_PAYLOAD`
- `SYNC_OPERATION_SIGNATURE_INVALID`
- `SYNC_OPERATION_DEPENDENCY_MISSING`
- `SYNC_OPERATION_DEPENDENCY_FAILED`
- `SYNC_OPERATION_SEQUENCE_GAP`
- `SYNC_OPERATION_TOO_OLD`
- `SYNC_OPERATION_NOT_OFFLINE_ELIGIBLE`
- `SYNC_OPERATION_CONFLICT`
- `SYNC_OPERATION_MANUAL_REVIEW_REQUIRED`

هذهالأكواد ترجعمعDomain error الأصلي عندملائم.

# القسم الرابع والعشرون — Testing Contract

## 107. Bootstrap Tests

1. First bootstrap.
2. Snapshot/cursor same cutoff.
3. Chunk retry andchecksum.
4. Expired snapshot.
5. Scope change duringbootstrap.
6. Atomic local apply.
7. Crash beforeacknowledgement.

## 108. Change Feed Tests

1. Duplicate change.
2. Stable cursor pagination.
3. Empty page cursor advance.
4. Tombstone delivery.
5. Visibility revoked.
6. Resource version older/newer.
7. Cursor expiry.
8. Schema incompatibility.
9. Feed lag metadata.
10. Scope isolation.

## 109. Upload/Idempotency Tests

1. Sameoperation samepayload repeated.
2. SameID differentpayload.
3. Crash afterDomain commit.
4. Batch partial result.
5. Missing result query.
6. Duplicate financial operation.
7. Batch transport timeout.
8. Server restart.
9. Dedup record retention.

## 110. Dependency/Ordering Tests

1. Parent accepted.
2. Parent pending.
3. Parent rejected.
4. Circular dependency.
5. SameAggregate concurrent operations.
6. Out-of-order local sequence.
7. Independent parallel operations.

## 111. Conflict Tests

1. Draft version conflict.
2. Sale alreadycompleted.
3. Inventory unavailable.
4. Customer identity collision.
5. Permission revoked.
6. Entitlement limit reached.
7. Price/tax version changed.
8. Manual review lifecycle.
9. Compensation path.
10. NoLast-write-wins forledger.

## 112. Recovery Tests

1. Local DB corruption.
2. Cursor corrupted.
3. Snapshot interrupted.
4. Server restore/epoch change.
5. Device offline beyondretention.
6. Client upgrade duringpending queue.
7. Revoked device reconnect.
8. Rebootstrap preservesoutbound operations.

## 113. Security Tests

1. Cross-tenant cursor.
2. Device credential reuse.
3. Invalid signature.
4. Operation replay.
5. Scope escalation request.
6. Sensitive snapshot redaction.
7. Compression bomb/body limits.
8. Rate limits.
9. Revocation propagation.

# القسم الخامس والعشرون — Open Decisions

## 114. OD-SYNC-001 — Change feed physical source

Outbox-derived projection stream، CDC، أوdedicated change log؟

**Baseline:** Dedicated logical client change feed بعقدمستقل عنraw CDC/Domain events؛ التنفيذ فيDatabase/Architecture Blueprint.

## 115. OD-SYNC-002 — Cursor partitioning

PerTenant/device أمperdataset partitions؟

**Baseline:** Opaque composite cursor تخفيالتقسيم؛ لايلتزمClient بتفاصيلphysical partitions.

## 116. OD-SYNC-003 — Push channel

**Baseline:** Pull/long-poll canonical. Push notification اختيارية للإيقاظ فقط.

## 117. OD-SYNC-004 — Client-generated canonical IDs

**Baseline:** مفضلة للـOffline-eligible resources معformat آمن، لتقليلID mapping.

## 118. OD-SYNC-005 — Snapshot storage anddelivery

يحسم فيStorage/Deployment Blueprint. يجب دعمchecksums، expiry، encryption، chunking، tenant isolation.

## 119. OD-SYNC-006 — Tombstone retention

تحددرقميًا بعدتثبيتmaximum supported offline window فيOffline Protocol.

## 120. OD-SYNC-007 — Customer dataset

مقدارPII وsearch index المتاح Offline يحتاجData Classification وPrivacy decision.

## 121. OD-SYNC-008 — Operation result push

**Baseline:** نتيجةمؤكدة عبرpoll/change feed. Push مجردتنبيه.

## 122. OD-SYNC-009 — Conflict UI ownership

Baseline: Sync layer توفرstructured conflict؛ Product workflow يحددالشاشة والقرار لكلنوع.

## 123. OD-SYNC-010 — Batch encryption beyond TLS

Field/payload envelope encryption تحددحسبData classification وdevice threat model.

# القسم السادس والعشرون — Prohibited Patterns

## 124. أنماط ممنوعة

- رفعنسخةLocal database كاملة واستبدالServer state.
- Last-write-wins للمال والمخزون.
- إنشاءClientOperationId جديدة عندكلRetry.
- تحريكCursor قبلتطبيقالصفحة.
- حذفOutbound queue عندcursor expiry.
- الثقةفيClient balance أوtotals.
- اعتبارBatch atomic دونعقد.
- اعتبارHTTP timeout رفضًا.
- مزجSnapshot chunks منإصداراتمختلفة.
- استخدامDomain event stream خامةكواجهةClient تلقائيًا.
- Empty scope = tenant-wide.
- قبولOperation غيرمسموحة Offline لأنهاوصلت عبرSync.
- الاعتمادعلىlocal sequence وحدها لمنعالتكرار.
- حذفDedup records مبكرًا.
- إخفاءConflict بتحويلهSuccess.
- إعادةفتحCompleted resource لمطابقةLocal draft.
- إرسالPII/Provider evidence غيرضرورية لكلTerminal.
- Global cursor مشتركة بينأجهزةوScopes.

# القسم السابع والعشرون — Acceptance Gate

## 125. بوابة الاعتماد

لا يعتبر Sync Protocol مكتملًا قبل:

1. تعريفParticipants وDevice sync states.
2. تعريفLocal queue/canonical/provisional model.
3. تثبيتBootstrap وSnapshot consistency point.
4. تثبيتManifest/chunk/checksum contract.
5. تثبيتChange envelope وdelivery modes.
6. تثبيتCursor binding/expiry/recovery.
7. تثبيتClient Operation وBatch envelopes.
8. تثبيتDeduplication وcrash recovery.
9. تثبيتDependencies وAggregate ordering.
10. تثبيتTemporary/Canonical ID rules.
11. تثبيتConflict categories/resolutions.
12. منعLast-write-wins للـLedgers والـCompleted transactions.
13. تثبيتTombstone/visibility revocation.
14. تثبيتSchema/capability negotiation.
15. تثبيتAuthorization/Entitlement version behavior.
16. تحديدSecurity/Audit/Monitoring.
17. تحديدTerminal online/last sync status.
18. Contract tests للـretry، duplicate، partial، recovery، isolation.
19. ربطالـProtocol بالAPI/Error/Event/Audit/Permission catalogs.
20. عدمادعاءOffline eligibility قبلOffline Protocol.

## 126. القرار التخطيطي الحالي

- Sync تنقلIntent وCanonical changes؛ لا تملكBusiness truth.
- Bootstrap Snapshot وStarting cursor يشتركان فيcutoff واحد.
- Incremental feed هيClient projection changes، وليستDomain events خامة.
- Cursors opaque ومربوطةبالDevice والـScope والـSchema.
- Batch non-atomic، وكلOperation لهانتيجة مستقلة.
- ClientOperationId ثابت عبركلRetries.
- Exactly-once business effect يتحققعبرDedup/Idempotency، لاExactly-once transport.
- Conflicts Structured، ولايوجدLast-write-wins للمال أوالمخزون أوLedgers.
- Cursor expiry يؤديResnapshot معالحفاظعلىOutbound queue.
- Online status يعتمدSuccessful authenticated sync، لاNetwork interface فقط.
- Admin يمكنهعرضTerminal health وLast sync وPending/Conflict counts.

## 127. المرحلة التالية

**ATHR Offline Protocol v1.0**

سيثبت:

- ماالعمليات المسموحة Offline.
- Offline Authorization Lease.
- Monetary/quantity/time limits.
- Catalog/price/tax snapshots.
- Device signing andclock trust.
- Shift andcash continuity.
- Offline Sale numbering andreceipts.
- ممنوعاتElectronic payment/refund/credit/store value.
- Reconnection anduser-facing outcomes.
- Revocation semantics.
- Fraud andabuse controls.
- Maximum offline window.

بعده: **ATHR Database Blueprint v1.0**.