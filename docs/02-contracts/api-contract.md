# ATHR API Contract v1.0

**Planning Baseline — Resource Boundaries, Commands, Queries, Idempotency and External Contracts**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة العقد العام لواجهات ATHR قبل تنفيذ أيController أوRoute أوDTO. وتشمل:

- نمط الـAPI وحدود الـResources.
- الفرق بين Commands وQueries.
- Authentication وTenant context.
- Request وResponse envelopes.
- Idempotency وOptimistic concurrency.
- Validation وAuthorization sequence.
- Pagination وFiltering وSorting وSearch.
- تمثيل Money وQuantity وTime وIDs.
- Long-running operations وStatus resources.
- File uploads/downloads وDocuments.
- Sync وOffline boundary علىمستوى الـAPI العام.
- Webhooks وExternal integrations.
- Versioning وDeprecation.
- Rate limits وRetry behavior.
- Caching وConditional requests.
- Partial results وBulk operations.
- Contract testing وOpenAPI governance.

هذه الوثيقة لا تختارFramework أولغة أوAPI gateway أوQueue أوDatabase.

## 2. المبادئ العامة

1. الـAPI تعكس الـDomain، ولا تصبح CRUD مباشر للجداول.
2. كلResource لهاOwner Context واحد.
3. Queries لا تنفذBusiness side effects.
4. Commands تمثلIntent تجاري واضح.
5. لا يستخدم `PATCH status` لتنفيذ State transition.
6. كلMutation قابلةللتكرار تحتاجIdempotency contract.
7. كلUpdate لAggregate تحتاجConcurrency contract.
8. Tenant context لا يؤخذ منBody وحده.
9. Authentication لا تعنيAuthorization.
10. Permission وScope وEntitlement وBusiness Guards يعادفحصها server-side.
11. الـClient لا يرسل أويفرض totals أوbalances كحقائق نهائية.
12. Money وQuantity لا تمثلfloat.
13. تاريخ الـResource المكتملة لا يعدل؛ تستخدمCorrection workflows.
14. Error response لهاSchema ثابتة، وتفاصيلها فيError Catalog التالي.
15. لا تكشفالـAPI وجودResource خارجTenant/Scope.
16. لا تعتمد علىHTTP timeout لتحديدنجاح أوفشلCommand.
17. عملياتProvider الخارجية قدترجع `pending` أو`outcome_unknown`.
18. List endpoints تستخدمCursor pagination افتراضيًا.
19. Bulk endpoints لا تفترضAtomicity علىكلالعناصر.
20. أيContract منشورة Versioned ومختبرةBackward compatibility.

## 3. API Surfaces

### Interactive Tenant API

لـWeb Admin وPOS online وMobile apps.

### Device Sync API

لـPOS/Terminal synchronization، بعقودbatch/cursor/lease مستقلة.

### Platform API

لـATHR platform operations وSaaS billing والدعم، ولا تختلط معTenant routes.

### External Integration API

للتطبيقات المصرح بها وAPI clients وwebhooks.

### Provider Callback API

لـPayment/Delivery providers، معsignature/replay controls.

## 4. Version and Base Paths

```
/api/v1/tenants/{tenant_id}/...
/api/v1/platform/...
/api/v1/sync/...
/api/v1/integrations/...
/api/v1/provider-callbacks/{provider_namespace}/...
```

### قواعد الـVersion

- Major version فيالمسار للعقود العامة.
- Minor compatible changes لا تغيرالمسار.
- Provider callbacks يمكنVersion مستقلة حسبadapter.
- Internal service APIs لا تعفى منSchema/version governance.

## 5. Authentication Context

### Interactive clients

`Authorization: Bearer <access-token>`

### Service clients

Scoped service credential أوOAuth client credential وفقSecurity Blueprint.

### Device clients

Device credential + user/session proof + optional Offline lease proof.

### Required server-resolved context

- identity_id.
- session_id/token family.
- membership_id.
- tenant_id.
- authorization_version.
- entitlement_version.
- authentication strength.
- device_id/terminal_id whenrelevant.

### ممنوع

- الوثوق في`actor_id` أو`membership_id` منBody.
- استخدامshared admin API key.
- تمريرTenantId فيBody دونمطابقته للمسار والـToken.

## 6. Standard Headers

### Request headers

- `Authorization`
- `X-Request-Id` optional client-provided UUID-like identifier.
- `Idempotency-Key` required fordefined commands.
- `If-Match` forversioned mutations.
- `X-Terminal-Id` wherechannel requires.
- `X-Device-Id` wherechannel requires.
- `X-Client-Operation-Id` foroffline/sync-originated operations.
- `X-Client-Version`
- `Accept-Language`
- `Content-Type`
- `Prefer: respond-async` whereallowed.

### Response headers

- `X-Request-Id`
- `X-Correlation-Id`
- `ETag`
- `Location`
- `Retry-After`
- `RateLimit-Limit`
- `RateLimit-Remaining`
- `RateLimit-Reset`
- `Deprecation`
- `Sunset`
- `Link`

لا تستخدمHeaders لحملBusiness payload أساسي لايمكنقراءته منBody.

## 7. Resource ID Rules

- Opaque، غيرمتسلسلة، غيرقابلةللتخمين.
- Stable طول عمرالـResource.
- لا تستخدمEmail أوSKU أوDocument number كPrimary URL identity.
- Business references قابلةللبحث، لكنها لاتستبدلID.
- IDs لا تكشفTenant أوTimestamp بطريقةتضرالأمن.
- Offline-created Resources تستخدمClient-generated IDs أوmapping contract معCanonical ID دونازدواج.

# القسم الأول — Request and Response Contracts

## 8. Query Response Envelope

```json
{
  "data": {},
  "meta": {
    "request_id": "req_...",
    "correlation_id": "corr_...",
    "generated_at": "2026-07-29T01:00:00Z",
    "resource_version": 12,
    "projection_freshness": {
      "as_of": "2026-07-29T00:59:58Z",
      "lag_ms": 120
    }
  },
  "links": {
    "self": "/api/v1/..."
  }
}
```

`projection_freshness` تظهر فقطللـRead models التيقدتكونEventually consistent.

## 9. List Response Envelope

```json
{
  "data": [],
  "page": {
    "limit": 50,
    "next_cursor": "opaque-or-null",
    "previous_cursor": "opaque-or-null",
    "has_more": false
  },
  "meta": {
    "request_id": "req_...",
    "generated_at": "2026-07-29T01:00:00Z"
  },
  "links": {
    "self": "/api/v1/...",
    "next": null
  }
}
```

## 10. Command Success Envelope

### Synchronous completed command

```json
{
  "data": {
    "resource": {},
    "command": {
      "command_id": "cmd_...",
      "status": "succeeded",
      "resulting_version": 13
    }
  },
  "meta": {
    "request_id": "req_...",
    "correlation_id": "corr_..."
  }
}
```

### Accepted async command

```json
{
  "data": {
    "operation_id": "op_...",
    "status": "accepted",
    "status_url": "/api/v1/tenants/.../operations/op_..."
  },
  "meta": {
    "request_id": "req_..."
  }
}
```

HTTP `202 Accepted` لا يعنيBusiness success.

## 11. No-content responses

`204 No Content` تستخدم فقطعندمالايحتاجالعميلresult أوversion جديد. Baseline يفضلإرجاعالـResource أوCommand result للـMutations الحرجة.

## 12. Error Envelope Baseline

```json
{
  "error": {
    "code": "SALE_INVALID_STATE",
    "category": "conflict",
    "message": "The sale cannot be completed in its current state.",
    "retryable": false,
    "target": "sale",
    "details": [],
    "current_state": "payment_resolution_pending",
    "current_version": 14,
    "required_action": "resolve_payment_outcome",
    "support_reference": "req_..."
  },
  "meta": {
    "request_id": "req_...",
    "correlation_id": "corr_..."
  }
}
```

الـError Catalog التالي يثبتالأكواد والـHTTP mapping وعدمكشفالمعلومات.

# القسم الثاني — HTTP Semantics

## 13. GET

- Read-only.
- Safe وIdempotent.
- يدعمConditional GET عندملائم.
- لا يسجلBusiness side effect.
- Sensitive access قديسجلAudit.

## 14. POST

يستخدم لـ:

- إنشاءResource.
- تنفيذCommand صريحة.
- إنشاءSearch/Export/Operation resources.
- Provider callbacks.

الـPOST mutation تحتاجIdempotency-Key إذااحتمالRetry أوأثرمالي/مخزني/مستند.

## 15. PUT

يستخدم لاستبدالConfiguration resource كاملة فقطعندماSemantics واضحة وIdempotent. لايستخدمبشكلواسع للـAggregates التجارية.

## 16. PATCH

يقتصر علىحقولDraft أوConfiguration القابلةللتعديل، مع`If-Match`.

### ممنوع عبرPATCH

- Complete Sale.
- Approve PO.
- Post Inventory Movement.
- Refund Payment.
- Close Shift.
- Activate Tax Rule.
- Change Tenant access mode.

## 17. DELETE

- لايستخدم لحذفTransactions أوDocuments أوAudit أوLedgers.
- قد يستخدم لحذفDraft/temporary resource إذاDomain تسمح.
- Prefer command endpoints مثل`:archive` أو`:cancel` عندوجودBusiness meaning.

## 18. Command Endpoint Pattern

Baseline:

```
POST /api/v1/tenants/{tenant_id}/sales/{sale_id}:complete
POST /api/v1/tenants/{tenant_id}/purchase-orders/{po_id}:approve
POST /api/v1/tenants/{tenant_id}/refunds/{refund_id}:execute
POST /api/v1/tenants/{tenant_id}/shifts/{shift_id}:finalize-close
```

Command body يحملParameters والـReason والـApproval reference، ولا يحملالحالة الجديدة كمجردstring.

# القسم الثالث — Idempotency

## 19. Idempotency-Key Contract

مطلوبة لـ:

- Resource creation التيقديعيدهاالعميل.
- Sale completion.
- Payment initiation/capture/refund/reversal.
- Inventory/ledger posting.
- Goods receipt posting.
- Transfer shipment/receipt.
- Return posting.
- Shift opening/closing.
- Document issuance.
- Exports.
- Subscription changes.
- Provider processing commands.

## 20. Idempotency Scope

Key تربط بـ:

- Tenant.
- Authenticated principal/client.
- Route/operation key.
- Normalized request payload hash.

نفسKey + نفسpayload تعيدنفسالنتيجة.

نفسKey + payload مختلف → `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`.

## 21. Stored Result

يحفظ:

- HTTP status.
- response body/reference.
- resulting resource IDs/version.
- operation state إذاpending.
- request hash.
- created/expiry timestamps.

الـRetention أطول للآثارالمالية والمخزنية منالعملياتالروتينية.

## 22. Unknown client outcome

إذاانقطعالاتصال بعدإرسالCommand:

1. العميل يعيد نفسCommand بنفسIdempotency-Key.
2. الخادم يعيدالنتيجة السابقة أوالحالة pending.
3. لا ينشئOperation جديدة.

# القسم الرابع — Optimistic Concurrency

## 23. ETag and If-Match

Resource version تمثل `ETag: "v12"`.

Mutations الحساسة علىResource موجودة تتطلب:

`If-Match: "v12"`

إذاالنسخة تغيرت → `412 Precondition Failed` أو`409 Conflict` حسبالـError Contract النهائي.

## 24. Expected version داخلCommand

يمكنتضمينها فيBody فقطإذاالعقد يحتاجها، لكنHeader هوالـHTTP baseline. الخادم يربطها بـAggregate version.

## 25. No blind overwrite

- لاLast-write-wins للـDomain Aggregates.
- Merge مسموح فقطلحقولExplicitly commutative أوUser preferences.
- Offline conflicts ترجعStructured conflict، لاoverwrite.

# القسم الخامس — Data Types

## 26. Money

```json
{
  "amount": "1250.50",
  "currency": "USD"
}
```

### Rules

- Decimal string، لاJSON float.
- Currency ISO 4217.
- Scale validated bycurrency/policy.
- Rounding result server-owned.
- Totals ترجعمعbreakdown/evidence version عندالحاجة.
- Negative values تستخدم فقطفيالعقود التيتسمحSemantically.

## 27. Quantity

```json
{
  "value": "3.250",
  "unit_id": "uom_...",
  "unit_code": "kg"
}
```

- Decimal string.
- Scale حسبUOM/product policy.
- Base quantity/conversion evidence قدترجع منفصلة.
- لايرسلClient conversion factor كحقيقة إلاreference/version معتمدة.

## 28. Percentages and Rates

Decimal strings معmeaning واضح:

```json
{
  "rate": "0.150000",
  "display_percent": "15.0000"
}
```

Contract تختارواحدًا كحقيقة لكلfield ولا تخلطبينهما.

## 29. Dates and Times

- UTC timestamps بصيغةRFC 3339.
- Local business date منفصلة: `YYYY-MM-DD`.
- Timezone IANA identifier.
- `occurred_at`, `recorded_at`, `effective_at` منفصلة.
- لا timestamps بدونtimezone.
- Date-only fields لا تحولإلىmidnight UTC.

## 30. Enums

- Lowercase snake_case.
- Clients تتعامل معunknown future values بأمان عندماfield extensible.
- Closed enum changes تحتاجVersion جديدة.
- Display labels لا تأتي كsource-of-truth enum.

## 31. Booleans

لا تستخدمBoolean بدلState machine، مثل:

- `is_paid`
- `is_closed`
- `is_refunded`

ترجعState واضحة وderived flags اختيارية للـUI فقط.

## 32. Null and Omitted Fields

- Omitted = غيرمطلوب/غيرمضمّن/لايتغير فيPATCH.
- `null` = قيمةمعلومة أنهافارغة ويسمحالعقدبها.
- لا يستخدم`null` و`""` بالتبادل.

# القسم السادس — Query Contracts

## 33. Pagination

### Cursor pagination baseline

Parameters:

- `page[limit]`
- `page[after]`
- `page[before]`

Default 50، max حسبresource/risk.

### Offset pagination

مسموحة للتقاريرالمحدودة أوAdmin views غيرالمتحركة فقط، وليستbaseline للـOperational lists الكبيرة.

## 34. Stable ordering

كلCursor يرتبط بـ:

- sort fields.
- filter hash.
- tenant/scope.
- data snapshot/cutoff عندالحاجة.

Default sort يجب أنيكونstable معID tie-breaker.

## 35. Filtering

Baseline syntax:

```
filter[state]=active
filter[location_id]=loc_...
filter[created_at][gte]=2026-07-01T00:00:00Z
filter[created_at][lt]=2026-08-01T00:00:00Z
```

- Allow-list per endpoint.
- لاarbitrary SQL-like filter.
- Unsupported filter → validation error، لاignore صامت.

## 36. Sorting

```
sort=-created_at,reference
```

- Allow-list.
- Max fields محدد.
- Sensitive/computational sorts قدغيرمتاحة.

## 37. Search

- `q` للبحثالنصي المحدود.
- Search semantics موثقة لكلResource.
- Minimum length/rate controls.
- Exact identifiers تستخدمfilters صريحة.
- Search result لايكشفعناصرخارجScope.
- Fuzzy ranking لايستخدم لترتيبFinancial truth.

## 38. Field selection

Optional sparse fields:

```
fields[sales]=id,reference,state,total,completed_at
```

- لايتجاوزfield-level permissions.
- Required identity/state/version fields قدتظل موجودة.

## 39. Includes

```
include=customer_summary,payment_summary
```

- Allow-list.
- Depth محدود.
- لاgeneric recursive expansion.
- Includes لا تتجاوزOwners أوAuthorization.

## 40. Counts and totals

- `total_count` ليسافتراضيًا للقوائم الكبيرة.
- يطلب `include_total_count=true` فقطعندماendpoint تسمح.
- Aggregates المالية تأتي منReporting/read model معfreshness metadata، لاsum عشوائي لصفحة.

# القسم السابع — Command Validation Sequence

## 41. Server processing order

1. Parse andschema validation.
2. Authentication.
3. Resolve tenant/resource context دونinformation leakage.
4. Membership/status.
5. Idempotency lookup.
6. Permission/scope/entitlement decision.
7. Step-up/approval validation.
8. Load Aggregate +version.
9. State/business guards.
10. Execute local transaction.
11. Store Domain/Audit/Outbox evidence.
12. Return result.

التسلسل قديتغير تقنيًا بشرطحفظsecurity semantics وعدمإنشاءside effects قبلالتحقق.

## 42. Validation types

- Schema validation.
- Field format.
- Cross-field validation.
- Reference validation.
- State guard.
- Authorization constraint.
- Entitlement limit.
- Approval payload hash.

لا تعادكلأخطاءBusiness invariants دفعةواحدة إذاذلكيكشفمعلومات أويخلقrace.

# القسم الثامن — Long-running Operations

## 43. Operation Resource

```json
{
  "id": "op_...",
  "type": "export_generation",
  "state": "queued|running|waiting_external|manual_review|succeeded|failed|cancelled|expired",
  "progress": {
    "completed_units": 25,
    "total_units": 100,
    "percent": "25.00"
  },
  "result": null,
  "error": null,
  "created_at": "...",
  "updated_at": "...",
  "expires_at": "..."
}
```

## 44. Operation endpoints

```
GET  /operations/{operation_id}
POST /operations/{operation_id}:cancel
POST /operations/{operation_id}:retry
```

Cancel/Retry متاحة فقطإذاالـWorkflow تسمح وبPermission مستقلة.

## 45. Async candidates

- Exports.
- Large imports.
- Report generation.
- Document rendering batches.
- Tenant provisioning/closure.
- Data disposition.
- Projection rebuild.
- Large catalog publish.
- Provider reconciliation batches.

## 46. Polling

- Client honors `Retry-After`.
- Exponential backoff +jitter.
- Status response hasETag.
- Terminal state mayincludeexpiring result URL/reference.

# القسم التاسع — Bulk Operations

## 47. Bulk request model

```json
{
  "operations": [
    {
      "client_operation_id": "item-1",
      "action": "catalog.product.activate",
      "resource_id": "prod_...",
      "if_match": "v4",
      "input": {}
    }
  ]
}
```

## 48. Bulk response model

```json
{
  "data": {
    "batch_id": "batch_...",
    "status": "partially_completed",
    "results": [
      {
        "client_operation_id": "item-1",
        "status": "succeeded",
        "resource_id": "prod_...",
        "version": 5
      }
    ]
  }
}
```

## 49. Atomicity

- Default per-item transaction.
- Batch-wide atomicity فقطلعقدصريح صغير داخلOwner Context.
- Success items لا تتراجع بسببفشلothers.
- Retry يستخدمنفسclient operation IDs.

# القسم العاشر — Files and Artifacts

## 50. Upload workflow

1. `POST /uploads` يطلبUpload session.
2. الخادم يحددsize/type/classification/checksum requirements.
3. Client يرفعإلىsecured target.
4. `POST /uploads/{id}:complete` للتحقق والربط.
5. Domain command تستخدم`upload_id` بعدنجاحscan/validation.

## 51. Upload rules

- Size/type allow-list.
- Malware scanning.
- Checksum.
- Tenant ownership.
- Expiry forunattached uploads.
- No executable content unlessspecific controlled use.
- Filename ليسidentity موثوقًا.

## 52. Downloads

- Authorized عندكلطلب.
- Short-lived signed URL أوstreamed response.
- `Content-Disposition` آمن.
- Sensitive downloads audited.
- Range requests فقطللأنواعالمسموحة.
- Revoked/expired artifact لايبقىpublic.

# القسم الحادي عشر — Domain Resource Patterns

## 53. Identity and Tenant routes

```
GET  /api/v1/me
GET  /api/v1/me/memberships
POST /api/v1/authentication-sessions:revoke
GET  /api/v1/tenants/{tenant_id}
PATCH /api/v1/tenants/{tenant_id}
GET  /api/v1/tenants/{tenant_id}/locations
POST /api/v1/tenants/{tenant_id}/locations
POST /api/v1/tenants/{tenant_id}/locations/{location_id}:open
POST /api/v1/tenants/{tenant_id}/locations/{location_id}:close
GET  /api/v1/tenants/{tenant_id}/memberships
POST /api/v1/tenants/{tenant_id}/membership-invitations
POST /api/v1/tenants/{tenant_id}/membership-invitations/{id}:accept
POST /api/v1/tenants/{tenant_id}/memberships/{id}:suspend
POST /api/v1/tenants/{tenant_id}/memberships/{id}:offboard
```

## 54. Roles and approvals

```
GET  /roles
POST /roles
PATCH /roles/{role_id}
POST /roles/{role_id}:publish
POST /memberships/{membership_id}/role-assignments
DELETE /memberships/{membership_id}/role-assignments/{assignment_id}
GET  /approval-requests
POST /approval-requests/{id}:approve
POST /approval-requests/{id}:reject
```

Role assignment mutation لهاresource/command semantics واضحة، ولاترسلpermission arrays بلاversion/audit.

## 55. Device and terminal routes

```
POST /devices/enrollment-challenges
POST /devices:enroll
GET  /devices
POST /devices/{device_id}:revoke
POST /devices/{device_id}:rotate-key
POST /terminals
POST /terminals/{terminal_id}:activate
POST /terminals/{terminal_id}:reassign-location
GET  /terminals/{terminal_id}/health
GET  /offline-leases
POST /offline-leases
POST /offline-leases/{lease_id}:revoke
```

## 56. Catalog routes

```
GET  /products
POST /products
GET  /products/{product_id}
PATCH /products/{product_id}
POST /products/{product_id}:activate
POST /products/{product_id}:restrict
POST /products/{product_id}:discontinue
POST /products/{product_id}/variants
POST /variants/{variant_id}/identifiers
POST /identifiers/{identifier_id}:retire
GET  /units-of-measure
POST /units-of-measure
POST /uom-conversion-versions
GET  /location-assortments/{location_id}
POST /location-assortments/{location_id}:publish
```

## 57. Pricing, tax and promotions

```
GET  /price-books
POST /price-books
PATCH /price-books/{id}
POST /price-books/{id}:submit
POST /price-books/{id}:approve
POST /price-books/{id}:schedule
POST /price-books/{id}:activate
GET  /tax-rule-versions
POST /tax-rule-versions
POST /tax-rule-versions/{id}:approve
POST /tax-rule-versions/{id}:activate
GET  /promotions
POST /promotions
POST /promotions/{id}:approve
POST /promotions/{id}:activate
POST /promotions/{id}:pause
POST /coupons/{coupon_id}:reserve
POST /coupon-reservations/{id}:release
```

## 58. Sales routes

```
GET  /sales
POST /sales
GET  /sales/{sale_id}
PATCH /sales/{sale_id}
POST /sales/{sale_id}/lines
PATCH /sales/{sale_id}/lines/{line_id}
DELETE /sales/{sale_id}/lines/{line_id}
POST /sales/{sale_id}:price
POST /sales/{sale_id}:suspend
POST /sales/{sale_id}:resume
POST /sales/{sale_id}:cancel
POST /sales/{sale_id}:request-payment
POST /sales/{sale_id}:complete
GET  /sales/{sale_id}/completion-status
```

`POST /sales/{id}:complete` لايقبلserver totals منالعميل كحقيقة؛ يمكنإرسالexpected calculation version/change given والتأكيد.

## 59. Payment routes

```
GET  /payments
POST /payments
GET  /payments/{payment_id}
POST /payments/{payment_id}:authorize
POST /payments/{payment_id}:capture
POST /payments/{payment_id}:allocate
POST /payments/{payment_id}:void-authorization
POST /payments/{payment_id}:reverse
POST /payments/{payment_id}:start-reconciliation
POST /payment-reconciliation-cases/{id}:resolve
POST /payments/{payment_id}/refunds
GET  /refunds/{refund_id}
POST /refunds/{refund_id}:execute
POST /refunds/{refund_id}:retry
POST /refunds/{refund_id}:reconcile
```

Payment provider request/response لايعادخامًا للـClient؛ يرجعnormalized state وmasked evidence.

## 60. Inventory and transfer routes

```
GET  /inventory-positions
GET  /inventory-movements
POST /inventory-adjustments
POST /inventory-adjustments/{id}:submit
POST /inventory-adjustments/{id}:approve
POST /inventory-adjustments/{id}:post
GET  /transfers
POST /transfers
PATCH /transfers/{id}
POST /transfers/{id}:submit
POST /transfers/{id}:approve
POST /transfers/{id}/shipments
POST /transfers/{id}/receipts
POST /transfer-discrepancies/{id}:resolve
POST /transfers/{id}:close
GET  /stock-counts
POST /stock-counts
POST /stock-counts/{id}:start
POST /stock-counts/{id}/observations
POST /stock-counts/{id}:submit
POST /stock-counts/{id}:approve
POST /stock-counts/{id}:post
```

لا يوجدEndpoint لتعديلInventory balance مباشرة.

## 61. Purchasing routes

```
GET  /suppliers
POST /suppliers
PATCH /suppliers/{id}
POST /suppliers/{id}/bank-detail-change-requests
POST /supplier-bank-detail-change-requests/{id}:approve
GET  /purchase-orders
POST /purchase-orders
PATCH /purchase-orders/{id}
POST /purchase-orders/{id}:submit
POST /purchase-orders/{id}:approve
POST /purchase-orders/{id}:revise
POST /purchase-orders/{id}:cancel
POST /goods-receipts
POST /goods-receipts/{id}:record-inspection
POST /goods-receipts/{id}:post
POST /supplier-invoices
POST /supplier-invoices/{id}:match
POST /supplier-invoices/{id}:approve
POST /supplier-returns
POST /supplier-returns/{id}:post
```

## 62. Returns and exchanges

```
POST /return-requests
GET  /return-requests/{id}
POST /return-requests/{id}:approve
POST /return-requests/{id}:reject
POST /returns
POST /returns/{id}:receive
POST /returns/{id}:record-inspection
POST /returns/{id}:decide-disposition
POST /returns/{id}:calculate-valuation
POST /returns/{id}:post
POST /exchanges
GET  /exchanges/{id}
POST /exchanges/{id}:complete
POST /void-requests
POST /void-requests/{id}:approve
POST /void-requests/{id}:execute
```

## 63. Customer and value routes

```
GET  /customers
POST /customers
GET  /customers/{id}
PATCH /customers/{id}
POST /customers/{id}:restrict
POST /customer-merge-cases
POST /customer-merge-cases/{id}:approve
POST /customer-merge-cases/{id}:execute
POST /customers/{id}/consents
POST /customers/{id}/privacy-requests
GET  /receivable-accounts/{customer_id}
POST /receivable-entries
POST /receivable-payments
GET  /store-credit-accounts/{customer_id}
POST /store-credit-issuances
POST /store-credit-reservations
POST /store-credit-reservations/{id}:consume
GET  /loyalty-accounts/{customer_id}
POST /loyalty-reservations
POST /loyalty-reservations/{id}:consume
```

## 64. Shift and cash routes

```
GET  /shifts
POST /shifts
GET  /shifts/{id}
POST /shifts/{id}:open
POST /shifts/{id}:suspend
POST /shifts/{id}:resume
POST /shifts/{id}:request-close
POST /shifts/{id}/counts
POST /shifts/{id}:provisional-close
POST /shifts/{id}:finalize-close
GET  /cash-drawer-sessions/{id}
POST /cash-movements
POST /cash-reconciliations/{id}:approve
POST /cash-reconciliations/{id}:resolve
```

## 65. Documents, notifications and reports

```
GET  /documents
GET  /documents/{id}
POST /documents/{id}:render
POST /documents/{id}:print
POST /documents/{id}:reprint
POST /documents/{id}:deliver
GET  /delivery-jobs/{id}
POST /delivery-jobs/{id}:retry
GET  /notifications
POST /notifications/{id}:resend
GET  /reports/definitions
POST /reports/runs
GET  /reports/runs/{id}
POST /exports
GET  /exports/{id}
POST /exports/{id}:cancel
GET  /exports/{id}/download
```

## 66. Audit, retention and legal routes

```
GET  /audit-records
POST /audit-exports
GET  /audit-integrity-checks
POST /audit-integrity-checks
GET  /legal-holds
POST /legal-holds
POST /legal-holds/{id}:approve
POST /legal-holds/{id}:activate
POST /legal-holds/{id}:request-release
POST /legal-holds/{id}:release
GET  /data-disposition-jobs
POST /data-disposition-jobs
POST /data-disposition-jobs/{id}:approve
POST /data-disposition-jobs/{id}:execute
```

## 67. Billing and subscription routes

```
GET  /billing-account
PATCH /billing-account
GET  /billing-invoices
GET  /billing-invoices/{id}
GET  /subscription
POST /subscription:upgrade
POST /subscription:schedule-downgrade
POST /subscription:schedule-cancellation
POST /subscription:revoke-cancellation
POST /subscription:reactivate
GET  /entitlements
GET  /usage
```

Platform-side routes منفصلة:

```
GET  /api/v1/platform/plans
POST /api/v1/platform/plan-versions
POST /api/v1/platform/plan-versions/{id}:publish
POST /api/v1/platform/subscriptions/{id}:override
POST /api/v1/platform/entitlement-overrides
```

# القسم الثاني عشر — Sync API Boundary

## 68. Sync routes baseline

```
POST /api/v1/sync/bootstrap
GET  /api/v1/sync/changes?cursor=...
POST /api/v1/sync/operations
GET  /api/v1/sync/batches/{batch_id}
POST /api/v1/sync/snapshots:request
GET  /api/v1/sync/snapshots/{snapshot_id}
```

## 69. Sync operation item

```json
{
  "client_operation_id": "op-local-123",
  "operation_type": "sales.sale.complete-cash",
  "occurred_at": "2026-07-29T00:55:00Z",
  "local_sequence": 418,
  "lease_id": "lease_...",
  "resource_id": "sale-client-id",
  "expected_version": 6,
  "payload": {},
  "signature": "detached-signature"
}
```

## 70. Sync rules

- Batch ليستatomic افتراضيًا.
- كلOperation لهاresult مستقلة.
- Server dedup byClientOperationId.
- Accepted لايعنيكلdownstream effects اكتملت.
- Rejection structured وقابلةللتصحيح.
- Cursor opaque ومقيدdevice/scope/schema.
- Cursor expired → snapshot required، لاfull replay عشوائي.
- Sync protocol التفصيلي فيالوثيقة اللاحقة بعدError Catalog.

# القسم الثالث عشر — Provider Callbacks

## 71. Callback requirements

- Public endpoint معprovider-specific authentication/signature.
- Raw body verification قبلJSON parsing عندماprovider تتطلب.
- Timestamp/replay window.
- Event/reference deduplication.
- Fast acknowledgment بعدdurable persistence.
- Business processing async عندالحاجة.
- لايثقفيTenantId منpayload دونmapping داخلي.
- Unknown provider reference لايكشفتفاصيل.

## 72. Callback response

- `2xx` فقطبعدdurable acceptance أوknown duplicate.
- `4xx` للsignature/schema nonretryable.
- `5xx` للtemporary persistence failure.
- لايرجعinternal state أوPII.

## 73. Provider evidence

Raw payload فيRestricted evidence store، معhash/signature result/provider received time. Domain/API تعرضnormalized status فقط.

# القسم الرابع عشر — External Webhooks

## 74. Webhook subscription resource

```json
{
  "id": "whsub_...",
  "endpoint_url": "https://example.com/hooks/athr",
  "event_types": ["athr.sales.sale.completed.v1"],
  "scope": {"location_ids": ["loc_..."]},
  "state": "active",
  "secret_version": 3
}
```

## 75. Webhook security

- HTTPS only.
- Secret generated/rotated securely.
- HMAC signature overtimestamp +raw body.
- Delivery ID وEvent ID.
- Replay protection.
- Endpoint verification challenge.
- Redirect policy controlled.
- Private/internal IP protections.
- Payload data minimization.

## 76. Webhook delivery

- At-least-once.
- Exponential backoff.
- Stable EventId.
- Delivery attempts visible.
- Dead-letter/disable policy afterthreshold.
- Manual replay createsnewDeliveryId withsameEventId.

## 77. Webhook routes

```
GET  /webhook-subscriptions
POST /webhook-subscriptions
PATCH /webhook-subscriptions/{id}
POST /webhook-subscriptions/{id}:rotate-secret
POST /webhook-subscriptions/{id}:disable
GET  /webhook-deliveries
POST /webhook-deliveries/{id}:retry
```

Internal event bus لايكشف مباشرةللـTenants.

# القسم الخامس عشر — Caching and Conditional Requests

## 78. Cacheability

### Private cache candidates

- Product catalog projections.
- Price/tax/promotion snapshots.
- Entitlement summaries.
- Report definitions.

### No-store candidates

- Authentication/security responses.
- Payment evidence.
- Sensitive customer data.
- Audit records.
- Temporary download URLs.

## 79. HTTP caching headers

- `Cache-Control: private, max-age=...`
- `ETag`
- `Last-Modified` whereaccurate.
- `Vary: Authorization, Accept-Language` asneeded.

لا تستخدمshared caches لTenant-sensitive responses دونhard isolation.

## 80. Conditional GET

`If-None-Match` → `304 Not Modified` معلاBody، بشرطحفظauthorization evaluation وعدمكشفexistence.

# القسم السادس عشر — Rate Limiting and Resilience

## 81. Limit dimensions

- Identity/IP forauth.
- Tenant.
- Membership/user.
- Device/terminal.
- API client.
- Endpoint cost class.
- Provider callback namespace.

## 82. Cost classes

- Low: single-resource reads.
- Medium: filtered lists.
- High: searches, reports, exports.
- Critical protected: payment/refund commands، not rate bysimple volume only.

## 83. 429 behavior

- Structured error.
- `Retry-After`.
- No partial mutation.
- Idempotent command retry safe.

## 84. Timeout budgets

- Interactive queries قصيرة.
- Commands لاتنتظرdownstream consumers.
- Provider calls لهاexplicit timeout وتنتجUnknown عندعدمconclusive result.
- Heavy work تتحولOperation resource.

## 85. Circuit breakers

Provider/internal dependency outage لايغيرBusiness result تخمينيًا. ترجعpending/unknown/temporary failure حسبالعقد.

# القسم السابع عشر — API Versioning and Deprecation

## 86. Compatible additions

- Optional response field.
- Optional request field withsafe default.
- New endpoint.
- New enum value فقطإذاcontract مفتوحة والclients required tohandle unknown.

## 87. Breaking changes

- Rename/remove field.
- Type/meaning change.
- Required field addition.
- Money/unit semantic change.
- Pagination/cursor semantic change.
- Authorization scope change يؤثربclients.
- Error code meaning change.

## 88. Deprecation lifecycle

`Published → Supported → Deprecated → Sunset → Retired`

- `Deprecation` و`Sunset` headers.
- Documentation andchangelog.
- Usage metrics byclient/version.
- Migration guide.
- No retirement withactive critical clients withoutapproved exception.

# القسم الثامن عشر — Localization

## 89. API data vsdisplay text

- API ترجعcodes وstructured values.
- User-facing messages localized optionally، لكنهاليستمنطقclient.
- `Accept-Language` يؤثرعلىdisplay fields/messages فقط.
- Historical document language/version منفصلة.
- Enums لا تترجم داخلpayload.

## 90. Number and date display

API تستخدمcanonical decimal strings وUTC/ISO forms. Formatting locale مسؤوليةUI أوDocument renderer.

# القسم التاسع عشر — Security Controls

## 91. Request security

- Max body size.
- JSON depth/array limits.
- Strict content type.
- Schema reject unknown sensitive fields حسبendpoint policy.
- SSRF protections للURLs.
- Injection-safe filter/search parsing.
- File scanning.
- CORS allow-list.
- CSRF controls للcookie-based sessions.

## 92. Response security

- No secrets/tokens inerrors.
- Field-level redaction.
- No cross-tenant resource hints.
- Security headers.
- Sensitive responses `no-store`.
- Request IDs لا تكشفتopology.

## 93. Logging

- Request metadata، notraw sensitive bodies.
- Redaction byschema classification.
- Correlation IDs.
- High-risk Commands linkedAudit.
- Provider callbacks raw body inrestricted evidence، notgeneral logs.

# القسم العشرون — Contract Documentation and Governance

## 94. OpenAPI baseline

كلpublic/interactive route تحتاج:

- operationId ثابت.
- summary/description.
- owner Context.
- permission key.
- entitlement key optional.
- idempotency requirement.
- concurrency requirement.
- request/response schemas.
- allknown status codes.
- error code references.
- rate/cost class.
- audit class.
- examples.

## 95. Operation ID naming

```
sales_createSale
sales_completeSale
payments_startReconciliation
inventory_postAdjustment
```

Stable ولايعتمداسمController.

## 96. Contract ownership

- Domain team تملكsemantics.
- Platform/API governance تملكshared conventions.
- Security تراجعauth/data classifications.
- Consumer/client teams تراجعbreaking changes.

## 97. Generated clients

مسموحة منPublished spec، لكنلا تستبدلcontract tests ولاdomain understanding.

# القسم الحادي والعشرون — Testing Contract

## 98. Schema tests

1. Request/response againstOpenAPI schema.
2. Unknown/extra field policy.
3. Money/quantity/time formats.
4. Enum compatibility.
5. Null/omitted semantics.

## 99. Authentication/authorization tests

1. Missing/expired credential.
2. Tenant mismatch.
3. Scope mismatch.
4. Permission denied.
5. Entitlement denied.
6. Step-up required.
7. Approval invalid/expired.
8. Support grant expired.
9. Sensitive field redaction.
10. Resource existence concealment.

## 100. Mutation tests

1. Idempotency duplicate samepayload.
2. Idempotency key conflictingpayload.
3. If-Match success/stale.
4. Invalid state transition.
5. Audit/outbox atomicity.
6. Crash aftercommit beforeresponse.
7. Retry returns same result.
8. Partial downstream status.

## 101. Query tests

1. Cursor stability.
2. Scope-safe pagination.
3. Filter allow-list.
4. Stable sorting/tie-break.
5. Search isolation.
6. Sparse fields andincludes authorization.
7. Projection freshness metadata.
8. Conditional GET.

## 102. Async andbulk tests

1. 202 andstatus resource.
2. Polling/Retry-After.
3. Cancel eligibility.
4. Partial bulk results.
5. Item idempotency.
6. Operation expiry.

## 103. Webhook/provider tests

1. Signature valid/invalid.
2. Replay timestamp.
3. Duplicate event.
4. Unknown reference.
5. Provider timeout/unknown.
6. Tenant webhook retry andmanual replay.
7. NoPII overexposure.

## 104. Compatibility tests

- Previous supported clients.
- Additive schema change.
- Enum unknown handling.
- Deprecated route headers.
- Dual-version migration.

# القسم الثاني والعشرون — Open Decisions

## 105. OD-API-001 — REST command syntax

**Baseline:** REST resources +explicit `:command` actions للـState transitions. لاgeneric command bus endpoint عام.

## 106. OD-API-002 — GraphQL

ليسbaseline للـTransactional API. قد يستخدملاحقًا read-only analytical/composite queries إذاثبتتالحاجة، معfield authorization وcost limits.

## 107. OD-API-003 — Tenant identifier placement

**Baseline:** TenantId فيpath للعقودTenant-scoped +مطابقةserver token context. لاHeader سريضمني فقط.

## 108. OD-API-004 — JSON casing

**Baseline:** snake_case للـPublic API. Internal code style لايغيرالعقد.

## 109. OD-API-005 — HTTP conflict mapping

تفصيل `409` مقابل`412` و`422` يحسم فيError Catalog؛ baseline يحتفظmachine-readable error codes.

## 110. OD-API-006 — Date/time precision

**Baseline:** UTC RFC3339 withmillisecond precision افتراضيًا؛ لايعتمدclients علىأكثر منالعقدالمعلن.

## 111. OD-API-007 — Large SaleCompleted snapshot

API Sale read ترجعresource كامل وفقpermissions؛ Event payload concern منفصلة. Completion response قدترجعsummary +resource URL لتجنبpayload غيرمحدود.

## 112. OD-API-008 — Public integration API scope

يبدأAllow-list limited resources/commands؛ لايكشفكلInteractive API تلقائيًا.

## 113. OD-API-009 — API keys vsOAuth

يحسم فيSecurity/Integration Blueprint. Baseline: scoped, expirable, rotatable credentials، لاpermanent unscoped key.

## 114. OD-API-010 — International fiscal APIs

تضافكAdapters/contracts منفصلة بعدCountry/Fiscal Blueprint، ولا تلوثcore API بحقولقانونية خاصة بدولة بلاversioning.

# القسم الثالث والعشرون — Prohibited Patterns

## 115. أنماط ممنوعة

- CRUD مباشر لكلDatabase table.
- `PATCH {"status":"completed"}` للـBusiness transitions.
- Float للمال أوالكمية.
- TenantId موثوق منBody.
- Endpoint واحد `POST /commands` لكلشيء.
- `200 OK` معخطأ داخلBody.
- Retry غيرIdempotent للدفع أوالـPosting.
- Offset pagination للقوائم التشغيلية الكبيرة كbaseline.
- Unbounded `include=*`.
- Search/filter يمررSQL أوfield names مباشرة.
- API response تكشفسرًا أوraw provider payload.
- Read permission تمنحSensitive fields/Export.
- حذفTransactions المكتملة بـDELETE.
- Client-computed totals كsource oftruth.
- Timeout = failed.
- 202 = completed.
- Bulk batch failure يلغينجاحات سابقة دونعقدatomic واضح.
- Webhook داخلي event bus مكشوف للـTenant.
- Breaking change صامتة.
- Localized message هيالمنطق الوحيد للـClient.

# القسم الرابع والعشرون — Acceptance Gate

## 116. بوابة الاعتماد

لا يعتبر API Contract مكتملًا قبل:

1. تحديد surfaces والـbase paths والversioning.
2. تحديد Command vsQuery semantics.
3. تثبيت request/response/error envelopes.
4. تثبيت Authentication/Tenant context.
5. ربطكلoperation بـPermission key وOwner Context.
6. تثبيت Idempotency وConcurrency rules.
7. تثبيت Money/Quantity/Time/ID formats.
8. تثبيت Pagination/Filtering/Sorting/Search.
9. تحديد Async operation resource.
10. تحديد Bulk partial-result semantics.
11. تحديدFile/Artifact security.
12. تحديدProvider callbacks وTenant webhooks.
13. تحديدCaching/rate limiting/resilience.
14. تحديدVersioning/deprecation.
15. تحديدOpenAPI governance واختباراتالعقد.
16. عدموجودCRUD routes تكسرState Machines أوOwnership.
17. عدموجودmutation حرجة بلاIdempotency/Audit.
18. ربطالعقد بالWorkflow/Event/Audit/Permission catalogs.

## 117. القرار التخطيطي الحالي

- API baseline هيREST resources معCommands صريحة.
- TenantId يظهر فيpath ويطابقSession/credential context.
- كلMutation حرجة تستخدمIdempotency-Key، وكلAggregate update تستخدمETag/If-Match.
- Money وQuantity Decimal strings، وليسfloat.
- Cursor pagination هيbaseline.
- `202 Accepted` تعنيOperation بدأت فقط.
- Provider timeout يمكنأنينتجOutcome Unknown.
- Webhooks At-least-once وموقعة وقابلةلإعادةالإرسال بأمان.
- Read، Sensitive Read، Export وShare عقود منفصلة.
- Sync API لهاسطح مستقل، وتفاصيلها بعدError Catalog.
- لا يبدأImplementation أوOpenAPI generation قبلإغلاقError Catalog والقرارات المرتبطة.

## 118. المرحلة التالية

**ATHR Error Catalog v1.0**

سيثبت:

- Error categories.
- Stable machine-readable codes.
- HTTP status mapping.
- Retryability.
- User-safe messages.
- Field validation details.
- Authorization concealment.
- Conflict andexpected-version errors.
- State-machine errors.
- External outcome unknown.
- Partial completion andmanual intervention.
- Rate-limit/dependency/provider errors.
- Logging, support reference andlocalization.

بعده: **ATHR Sync Protocol v1.0 ثمOffline Protocol v1.0**.