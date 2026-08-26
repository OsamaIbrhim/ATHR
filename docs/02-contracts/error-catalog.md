# ATHR Error Catalog v1.0

**Planning Baseline — Stable Error Codes, HTTP Mapping, Outcome Certainty, Retry and Recovery**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة عقد الأخطاء الموحد في ATHR، وتثبت:

- Error categories.
- Stable machine-readable codes.
- HTTP status mapping.
- Retryability وRetry mode.
- Outcome certainty.
- User-safe messages.
- Validation details.
- Authorization concealment.
- State-machine وBusiness-rule errors.
- Idempotency وConcurrency conflicts.
- External provider outcomes.
- Partial completion وManual intervention.
- Rate limits وDependency failures.
- Logging وAudit وSupport references.
- Localization وClient behavior.
- Error lifecycle وCompatibility rules.

هذه الوثيقة لا تعرّف النصوص النهائية لكللغة، ولا تختارException framework أوObservability vendor.

## 2. المبادئ الإلزامية

1. Error code ثابتة ولا تعتمد علىالنص المترجم.
2. HTTP status تصفطبقةالفشل، والـError code تصفالمعنى الدقيق.
3. لا يرجع `200 OK` معخطأ داخلBody.
4. لا تكشفالأخطاء وجودResource خارجTenant أوScope.
5. لا تكشفStack traces أوSQL أوProvider secrets أوPolicy internals.
6. كلError تحددهلحدثأثر أملا، وهل النتيجة محسومة أممجهولة.
7. `retryable=true` وحدها غيركافية؛ يجب تحديدRetry mode.
8. Financial/provider timeout لايعنيFailed تلقائيًا.
9. `OUTCOME_UNKNOWN` تمنعBlind retry بمحاولةجديدة.
10. Validation errors لا تخلطمعBusiness state conflicts.
11. Concurrency conflict لايستبدلValidation error.
12. Approval وStep-up outcomes ليستInternal errors.
13. Partial completion تمثلStructured result، لا500 عام.
14. Manual review حالةWorkflow، وليستفشل تقني مبهم.
15. Error details تخضعField-level authorization وData minimization.
16. RequestId وCorrelationId موجودان لكلخطأ.
17. High-risk denies وunknown outcomes تدقق Audit.
18. Error codes المنشورة لا يعادتفسيرها بمعنىجديد.
19. Clients لا تعتمد علىmessage text لاتخاذقرار.
20. Unexpected exception تتحولإلىInternal error آمن معSupport reference.

## 3. Standard Error Envelope

```json
{
  "error": {
    "code": "SALE_INVALID_STATE",
    "category": "state_conflict",
    "message": "The sale cannot be completed in its current state.",
    "retryable": false,
    "retry_mode": "after_user_action",
    "outcome": "no_effect",
    "severity": "error",
    "target": "sale",
    "details": [],
    "current_state": "payment_resolution_pending",
    "current_version": 14,
    "required_action": "resolve_payment_outcome",
    "operation_id": null,
    "support_reference": "req_..."
  },
  "meta": {
    "request_id": "req_...",
    "correlation_id": "corr_...",
    "occurred_at": "2026-07-29T01:00:00Z"
  }
}
```

## 4. Error Detail Contract

```json
{
  "type": "field|item|rule|conflict|limit|dependency",
  "code": "VALUE_OUT_OF_RANGE",
  "target": "lines[2].quantity.value",
  "message": "Quantity exceeds the allowed maximum.",
  "rejected_value": null,
  "allowed": {
    "minimum": "0.001",
    "maximum": "1000.000"
  },
  "resource_id": null,
  "client_operation_id": null
}
```

### Rules

- `rejected_value` لايرجع للحقول الحساسة.
- `target` يستخدمJSON path ثابتًا.
- `details` ليستبديلًا عنcode الرئيسي.
- Bulk items تحمل`client_operation_id`.
- لا تعادPermission أوScope names غيرالمسموح معرفتها.

## 5. Error Categories

- `request_invalid`
- `authentication`
- `authorization`
- `resource_not_found`
- `state_conflict`
- `business_rule`
- `precondition`
- `concurrency`
- `idempotency`
- `entitlement`
- `limit`
- `rate_limit`
- `dependency`
- `provider`
- `temporarily_unavailable`
- `outcome_unknown`
- `partial_completion`
- `manual_intervention`
- `data_integrity`
- `internal`

## 6. Outcome Certainty

### `no_effect`

لم يحدثBusiness effect.

### `committed`

الأثرالأساسي حدث، حتىلوفشل downstream effect.

### `pending`

الطلبقبل ومازالقيدالمعالجة.

### `partial`

بعضالآثار حدثت وبعضها لم يكتمل.

### `unknown`

لايمكنتأكيد هلحدثالأثر الخارجي.

### `not_applicable`

للـRead/auth/validation errors التيلا تتعلقبmutation effect.

## 7. Retry Modes

- `never`
- `same_request_immediately`
- `same_idempotency_key_after_delay`
- `after_refresh`
- `after_reauthentication`
- `after_step_up`
- `after_approval`
- `after_user_action`
- `after_dependency_recovery`
- `manual_review_only`
- `poll_operation`

## 8. Severity

- `info`: حالة متوقعة لا تمنعالعمل كليًا.
- `warning`: يتطلبانتباهًا أوإجراءً.
- `error`: العملية لمتكتمل.
- `critical`: نتيجة مجهولة، خلل نزاهة، أوإجراء يدوي عاجل.

# القسم الأول — HTTP Status Mapping

## 9. 400 Bad Request

لـMalformed syntax، invalid query syntax، missing required headers، unsupported command shape.

أمثلة:

- `REQUEST_BODY_MALFORMED`
- `REQUEST_HEADER_REQUIRED`
- `FILTER_SYNTAX_INVALID`
- `CURSOR_FORMAT_INVALID`

## 10. 401 Unauthorized

Authentication missing/invalid/expired.

- `AUTHENTICATION_REQUIRED`
- `ACCESS_TOKEN_INVALID`
- `ACCESS_TOKEN_EXPIRED`
- `SESSION_REVOKED`
- `DEVICE_CREDENTIAL_INVALID`

لا يستخدم401 للـPermission denied بعدAuthentication صحيحة.

## 11. 403 Forbidden

Authenticated، لكنالعملية ممنوعة ويمكنكشفوجودResource بأمان.

- `PERMISSION_DENIED`
- `SCOPE_DENIED`
- `TENANT_ACCESS_RESTRICTED`
- `STEP_UP_REQUIRED`
- `SUPPORT_GRANT_REQUIRED`

قديستخدم404 بدل403 لمنعكشفResource.

## 12. 404 Not Found

- Resource غيرموجود.
- أوغيرمرئي بسببTenant/Scope concealment.

Baseline client message عامة:

`RESOURCE_NOT_FOUND`

الـAudit/internal telemetry قدتحفظالسبب الدقيق.

## 13. 405 Method Not Allowed

`HTTP_METHOD_NOT_ALLOWED` مع`Allow` header.

## 14. 406 Not Acceptable

`RESPONSE_FORMAT_NOT_SUPPORTED`.

## 15. 409 Conflict

لـState conflict أوBusiness uniqueness أوIdempotency conflict أوOperation already in progress.

- `RESOURCE_STATE_CONFLICT`
- `DUPLICATE_BUSINESS_REFERENCE`
- `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`
- `OPERATION_ALREADY_IN_PROGRESS`

## 16. 410 Gone

Resource كانت موجودة لكنانتهت صلاحيتها ولايمكناستعادتها بنفسالعقد:

- `EXPORT_EXPIRED`
- `UPLOAD_SESSION_EXPIRED`
- `CURSOR_RETIRED`
- `INVITATION_EXPIRED`

## 17. 412 Precondition Failed

- `EXPECTED_VERSION_MISMATCH`
- `ETAG_REQUIRED`
- `APPROVED_PAYLOAD_CHANGED`
- `CONDITIONAL_REQUEST_FAILED`

## 18. 413 Content Too Large

- `REQUEST_BODY_TOO_LARGE`
- `UPLOAD_TOO_LARGE`
- `BATCH_SIZE_EXCEEDED`

## 19. 415 Unsupported Media Type

- `CONTENT_TYPE_NOT_SUPPORTED`
- `FILE_TYPE_NOT_ALLOWED`

## 20. 422 Unprocessable Content

Schema صحيحة لكنالقيم أوBusiness preconditions غيرصالحة، بشرطألا تكونState race أنسبلـ409/412.

- `VALIDATION_FAILED`
- `MONEY_SCALE_INVALID`
- `QUANTITY_SCALE_INVALID`
- `BUSINESS_RULE_VIOLATION`
- `APPROVAL_REQUIRED`

## 21. 423 Locked

اختياري للـResources المقفلة صراحة:

- `RESOURCE_LOCKED`
- `STOCK_COUNT_FROZEN_SCOPE`
- `LEGAL_HOLD_BLOCKS_OPERATION`

Baseline يمكنMapping إلى409 إنكان423 غيرمدعوم فيClient ecosystem.

## 22. 428 Precondition Required

- `IF_MATCH_REQUIRED`
- `IDEMPOTENCY_KEY_REQUIRED`
- `STEP_UP_TOKEN_REQUIRED`

## 23. 429 Too Many Requests

- `RATE_LIMIT_EXCEEDED`
- `AUTH_ATTEMPT_LIMIT_EXCEEDED`
- `EXPORT_RATE_LIMIT_EXCEEDED`

مع`Retry-After` عندإمكانية retry.

## 24. 500 Internal Server Error

- `INTERNAL_ERROR`
- `UNEXPECTED_PROCESSING_ERROR`

لايعادالسبب الداخلي للعميل.

## 25. 502 Bad Gateway

- `DEPENDENCY_INVALID_RESPONSE`
- `PROVIDER_INVALID_RESPONSE`

لا يستخدمإذاprovider outcome قدتكوننجحت؛ عندهاOutcome Unknown contract.

## 26. 503 Service Unavailable

- `SERVICE_TEMPORARILY_UNAVAILABLE`
- `DEPENDENCY_UNAVAILABLE`
- `MAINTENANCE_IN_PROGRESS`
- `AUDIT_PERSISTENCE_UNAVAILABLE`

## 27. 504 Gateway Timeout

لـRead/Dependency operation بلاBusiness effect. لايستخدمكدليل Payment failure.

- `DEPENDENCY_TIMEOUT`
- `REPORT_QUERY_TIMEOUT`

# القسم الثاني — Naming and Lifecycle

## 28. Error Code Naming

Upper snake case:

`<CONTEXT>_<CONDITION>`

أمثلة:

- `SALE_INVALID_STATE`
- `PAYMENT_OUTCOME_UNKNOWN`
- `INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY`
- `MEMBERSHIP_SCOPE_DENIED`

## 29. Code Metadata

كلCode تحتاج:

- owner Context.
- category.
- default HTTP status.
- retryable.
- retry mode.
- outcome certainty.
- severity.
- user-safe message key.
- audit requirement.
- allowed detail fields.
- recovery action.
- lifecycle status.

## 30. Lifecycle

`Draft → Published → Deprecated → Retired`

- Published meaning immutable.
- Message يمكنتحسينهادونتغييرcode semantics.
- تغييرRetryability أوOutcome meaning يعتبرBreaking إذايؤثرClient behavior.
- Deprecated code تبقىمدعومة خلالmigration window.

# القسم الثالث — Common Request Errors

## 31. Syntax and Schema Codes

- `REQUEST_BODY_MALFORMED`
- `REQUEST_BODY_REQUIRED`
- `REQUEST_HEADER_REQUIRED`
- `REQUEST_FIELD_REQUIRED`
- `REQUEST_FIELD_UNKNOWN`
- `REQUEST_FIELD_TYPE_INVALID`
- `REQUEST_FIELD_FORMAT_INVALID`
- `REQUEST_FIELD_VALUE_INVALID`
- `REQUEST_ARRAY_EMPTY`
- `REQUEST_ARRAY_TOO_LARGE`
- `REQUEST_OBJECT_TOO_DEEP`
- `REQUEST_BODY_TOO_LARGE`
- `CONTENT_TYPE_NOT_SUPPORTED`
- `RESPONSE_FORMAT_NOT_SUPPORTED`
- `HTTP_METHOD_NOT_ALLOWED`

## 32. Shared Data Type Codes

- `MONEY_AMOUNT_INVALID`
- `MONEY_CURRENCY_INVALID`
- `MONEY_SCALE_INVALID`
- `MONEY_NEGATIVE_NOT_ALLOWED`
- `QUANTITY_VALUE_INVALID`
- `QUANTITY_SCALE_INVALID`
- `UNIT_NOT_ALLOWED`
- `PERCENTAGE_OUT_OF_RANGE`
- `DATE_FORMAT_INVALID`
- `TIME_FORMAT_INVALID`
- `TIMEZONE_INVALID`
- `DATE_RANGE_INVALID`
- `EFFECTIVE_PERIOD_OVERLAPS`
- `IDENTIFIER_FORMAT_INVALID`

## 33. Query Codes

- `PAGINATION_LIMIT_INVALID`
- `PAGINATION_LIMIT_EXCEEDED`
- `CURSOR_FORMAT_INVALID`
- `CURSOR_EXPIRED`
- `CURSOR_SCOPE_MISMATCH`
- `CURSOR_FILTER_MISMATCH`
- `FILTER_NOT_SUPPORTED`
- `FILTER_VALUE_INVALID`
- `SORT_NOT_SUPPORTED`
- `SORT_FIELD_LIMIT_EXCEEDED`
- `SEARCH_QUERY_TOO_SHORT`
- `SEARCH_QUERY_INVALID`
- `INCLUDE_NOT_SUPPORTED`
- `INCLUDE_DEPTH_EXCEEDED`
- `FIELD_SELECTION_INVALID`
- `TOTAL_COUNT_NOT_AVAILABLE`

# القسم الرابع — Authentication and Authorization

## 34. Authentication Codes

- `AUTHENTICATION_REQUIRED`
- `ACCESS_TOKEN_INVALID`
- `ACCESS_TOKEN_EXPIRED`
- `SESSION_EXPIRED`
- `SESSION_REVOKED`
- `SESSION_SUPERSEDED`
- `AUTHENTICATION_METHOD_NOT_ALLOWED`
- `MFA_REQUIRED`
- `MFA_CHALLENGE_EXPIRED`
- `MFA_CHALLENGE_INVALID`
- `STEP_UP_REQUIRED`
- `STEP_UP_EXPIRED`
- `RECENT_AUTHENTICATION_REQUIRED`
- `SERVICE_CREDENTIAL_INVALID`
- `DEVICE_CREDENTIAL_INVALID`
- `DEVICE_SIGNATURE_INVALID`

## 35. Authorization Codes

- `PERMISSION_DENIED`
- `SCOPE_DENIED`
- `RESOURCE_NOT_FOUND`
- `TENANT_CONTEXT_MISMATCH`
- `TENANT_ACCESS_RESTRICTED`
- `TENANT_ACCESS_READ_ONLY`
- `TENANT_SUSPENDED`
- `MEMBERSHIP_INACTIVE`
- `MEMBERSHIP_SUSPENDED`
- `MEMBERSHIP_SCOPE_DENIED`
- `LOCATION_SCOPE_DENIED`
- `WAREHOUSE_SCOPE_DENIED`
- `TERMINAL_SCOPE_DENIED`
- `SHIFT_SCOPE_DENIED`
- `SEPARATION_OF_DUTIES_CONFLICT`
- `SELF_APPROVAL_NOT_ALLOWED`
- `DELEGATION_NOT_ALLOWED`
- `SUPPORT_GRANT_REQUIRED`
- `SUPPORT_GRANT_EXPIRED`
- `SUPPORT_GRANT_SCOPE_DENIED`
- `BREAK_GLASS_APPROVAL_REQUIRED`

## 36. Concealment Rules

للـCross-tenant أوresource invisible:

- Client يحصلعلى`RESOURCE_NOT_FOUND`.
- لايرجعإذاكانTenant/Scope/Permission هوالسبب.
- Audit قدتسجل`CROSS_TENANT_ACCESS_DENIED` داخليًا.
- Timing وresponse shape لا تميزexistence قدرالإمكان.

# القسم الخامس — Idempotency, Concurrency and Approvals

## 37. Idempotency Codes

- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_KEY_FORMAT_INVALID`
- `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`
- `IDEMPOTENCY_RECORD_EXPIRED`
- `IDEMPOTENT_OPERATION_IN_PROGRESS`
- `IDEMPOTENT_RESULT_UNAVAILABLE`

### Recovery

- Same key/same payload → نفسالنتيجة.
- Different payload → never retry withsame key.
- In progress → poll أوretry بعد`Retry-After` بنفسkey.

## 38. Concurrency Codes

- `IF_MATCH_REQUIRED`
- `EXPECTED_VERSION_MISMATCH`
- `RESOURCE_CHANGED_SINCE_READ`
- `CONCURRENT_OPERATION_CONFLICT`
- `RESOURCE_LOCKED`
- `OPERATION_ALREADY_IN_PROGRESS`

Recovery baseline: refresh، إعادةتطبيقintent، وإرسالversion جديدة. لاblind overwrite.

## 39. Approval Codes

- `APPROVAL_REQUIRED`
- `APPROVAL_NOT_FOUND`
- `APPROVAL_PENDING`
- `APPROVAL_REJECTED`
- `APPROVAL_EXPIRED`
- `APPROVAL_CANCELLED`
- `APPROVAL_ALREADY_USED`
- `APPROVAL_SCOPE_MISMATCH`
- `APPROVAL_PAYLOAD_MISMATCH`
- `APPROVED_PAYLOAD_CHANGED`
- `APPROVER_NOT_ELIGIBLE`
- `APPROVAL_LEVEL_INSUFFICIENT`

# القسم السادس — Entitlements and Limits

## 40. Entitlement Codes

- `ENTITLEMENT_REQUIRED`
- `ENTITLEMENT_NOT_ACTIVE`
- `ENTITLEMENT_EXPIRED`
- `ENTITLEMENT_VERSION_STALE`
- `ENTITLEMENT_LIMIT_REACHED`
- `FEATURE_NOT_INCLUDED_IN_PLAN`
- `SUBSCRIPTION_RESTRICTED`
- `SUBSCRIPTION_SUSPENDED`
- `TEMPORARY_OVERRIDE_EXPIRED`

## 41. Generic Limit Codes

- `LIMIT_EXCEEDED`
- `MONETARY_LIMIT_EXCEEDED`
- `QUANTITY_LIMIT_EXCEEDED`
- `DISCOUNT_LIMIT_EXCEEDED`
- `DAILY_OPERATION_LIMIT_EXCEEDED`
- `RESOURCE_COUNT_LIMIT_REACHED`
- `BATCH_SIZE_EXCEEDED`
- `EXPORT_ROW_LIMIT_EXCEEDED`

# القسم السابع — Tenant, Membership, Device and Terminal

## 42. Tenant Codes

- `TENANT_NOT_FOUND`
- `TENANT_ALREADY_EXISTS`
- `TENANT_INVALID_STATE`
- `TENANT_PROVISIONING_IN_PROGRESS`
- `TENANT_PROVISIONING_FAILED`
- `TENANT_CLOSURE_ALREADY_IN_PROGRESS`
- `TENANT_CLOSURE_BLOCKED_BY_OPEN_OBLIGATIONS`
- `TENANT_CLOSURE_WINDOW_EXPIRED`
- `TENANT_OWNER_TRANSFER_REQUIRED`
- `TENANT_LAST_OWNER_REQUIRED`
- `TENANT_ACCESS_MODE_CONFLICT`

## 43. Membership and Role Codes

- `MEMBERSHIP_NOT_FOUND`
- `MEMBERSHIP_ALREADY_EXISTS`
- `MEMBERSHIP_INVALID_STATE`
- `INVITATION_NOT_FOUND`
- `INVITATION_EXPIRED`
- `INVITATION_ALREADY_ACCEPTED`
- `INVITATION_EMAIL_MISMATCH`
- `ROLE_NOT_FOUND`
- `ROLE_INVALID_STATE`
- `ROLE_PERMISSION_NOT_ALLOWED`
- `ROLE_PLATFORM_PERMISSION_NOT_ALLOWED`
- `ROLE_WILDCARD_NOT_ALLOWED`
- `ROLE_ASSIGNMENT_CONFLICT`
- `SCOPE_EMPTY_NOT_ALLOWED`
- `SCOPE_RESOURCE_NOT_FOUND`
- `PRIVILEGE_ESCALATION_NOT_ALLOWED`

## 44. Device and Terminal Codes

- `DEVICE_NOT_FOUND`
- `DEVICE_NOT_ENROLLED`
- `DEVICE_ALREADY_ENROLLED`
- `DEVICE_RESTRICTED`
- `DEVICE_REVOKED`
- `DEVICE_KEY_ROTATION_REQUIRED`
- `DEVICE_KEY_VERSION_STALE`
- `TERMINAL_NOT_FOUND`
- `TERMINAL_INACTIVE`
- `TERMINAL_BLOCKED`
- `TERMINAL_LOCATION_MISMATCH`
- `TERMINAL_SHIFT_REQUIRED`
- `TERMINAL_REASSIGNMENT_BLOCKED_BY_OPEN_SHIFT`
- `TERMINAL_REASSIGNMENT_BLOCKED_BY_UNSYNCED_OPERATIONS`
- `OFFLINE_LEASE_REQUIRED`
- `OFFLINE_LEASE_EXPIRED`
- `OFFLINE_LEASE_REVOKED`
- `OFFLINE_LEASE_SCOPE_MISMATCH`
- `OFFLINE_LEASE_LIMIT_EXCEEDED`
- `OFFLINE_LEASE_VERSION_STALE`

# القسم الثامن — Catalog, Pricing, Tax and Promotions

## 45. Catalog Codes

- `PRODUCT_NOT_FOUND`
- `PRODUCT_INVALID_STATE`
- `PRODUCT_NOT_SELLABLE`
- `PRODUCT_DISCONTINUED`
- `VARIANT_NOT_FOUND`
- `VARIANT_NOT_SELLABLE`
- `IDENTIFIER_ALREADY_ASSIGNED`
- `IDENTIFIER_NOT_FOUND`
- `IDENTIFIER_RETIRED`
- `IDENTIFIER_REUSE_NOT_ALLOWED`
- `SKU_ALREADY_EXISTS`
- `BARCODE_ALREADY_EXISTS`
- `UNIT_NOT_FOUND`
- `UNIT_CONVERSION_NOT_FOUND`
- `UNIT_CONVERSION_CONFLICT`
- `UNIT_CONVERSION_HISTORICAL_CHANGE_NOT_ALLOWED`
- `ASSORTMENT_PRODUCT_NOT_ALLOWED`
- `CATALOG_IMPORT_PARTIAL_FAILURE`

## 46. Pricing Codes

- `PRICE_BOOK_NOT_FOUND`
- `PRICE_BOOK_INVALID_STATE`
- `PRICE_BOOK_OVERLAPPING_EFFECTIVE_PERIOD`
- `PRICE_ENTRY_NOT_FOUND`
- `PRICE_NOT_AVAILABLE`
- `PRICE_VERSION_STALE`
- `PRICE_CALCULATION_CHANGED`
- `PRICE_OVERRIDE_NOT_ALLOWED`
- `PRICE_OVERRIDE_APPROVAL_REQUIRED`
- `PRICE_BELOW_FLOOR`
- `PRICE_CURRENCY_MISMATCH`
- `MARGIN_DATA_ACCESS_DENIED`

## 47. Tax Codes

- `TAX_RULE_NOT_FOUND`
- `TAX_RULE_INVALID_STATE`
- `TAX_RULE_OVERLAPPING_EFFECTIVE_PERIOD`
- `TAX_RULE_VERSION_STALE`
- `TAX_CALCULATION_FAILED`
- `TAX_EXEMPTION_NOT_ALLOWED`
- `TAX_EXEMPTION_EVIDENCE_REQUIRED`
- `TAX_OVERRIDE_NOT_ALLOWED`
- `TAX_JURISDICTION_NOT_SUPPORTED`

## 48. Promotion and Coupon Codes

- `PROMOTION_NOT_FOUND`
- `PROMOTION_INVALID_STATE`
- `PROMOTION_NOT_ACTIVE`
- `PROMOTION_NOT_APPLICABLE`
- `PROMOTION_CONFLICT`
- `PROMOTION_USAGE_LIMIT_REACHED`
- `COUPON_NOT_FOUND`
- `COUPON_INVALID`
- `COUPON_NOT_ACTIVE`
- `COUPON_EXPIRED`
- `COUPON_ALREADY_REDEEMED`
- `COUPON_RESERVED`
- `COUPON_RESERVATION_EXPIRED`
- `COUPON_CUSTOMER_MISMATCH`
- `COUPON_USAGE_LIMIT_REACHED`

# القسم التاسع — Sales and Payments

## 49. Sale Codes

- `SALE_NOT_FOUND`
- `SALE_INVALID_STATE`
- `SALE_ALREADY_COMPLETED`
- `SALE_ALREADY_CANCELLED`
- `SALE_EMPTY`
- `SALE_LINE_NOT_FOUND`
- `SALE_LINE_PRODUCT_NOT_SELLABLE`
- `SALE_QUANTITY_INVALID`
- `SALE_CUSTOMER_REQUIRED`
- `SALE_TERMINAL_REQUIRED`
- `SALE_SHIFT_REQUIRED`
- `SALE_PRICE_VERSION_STALE`
- `SALE_TAX_VERSION_STALE`
- `SALE_PROMOTION_VERSION_STALE`
- `SALE_TOTAL_CHANGED`
- `SALE_PAYMENT_INSUFFICIENT`
- `SALE_PAYMENT_EXCEEDS_ALLOWED`
- `SALE_PAYMENT_RESOLUTION_PENDING`
- `SALE_COMPLETION_ALREADY_IN_PROGRESS`
- `SALE_COMPLETION_PARTIAL`
- `SALE_DOWNSTREAM_RECONCILIATION_REQUIRED`
- `SALE_SUSPENSION_LIMIT_REACHED`
- `SALE_RESUME_NOT_ALLOWED`
- `SALE_CANCEL_NOT_ALLOWED`
- `SALE_OFFLINE_NOT_ALLOWED`

## 50. Payment Codes

- `PAYMENT_NOT_FOUND`
- `PAYMENT_INVALID_STATE`
- `PAYMENT_METHOD_NOT_ALLOWED`
- `PAYMENT_AMOUNT_INVALID`
- `PAYMENT_CURRENCY_MISMATCH`
- `PAYMENT_ALREADY_CAPTURED`
- `PAYMENT_ALREADY_REVERSED`
- `PAYMENT_ALLOCATION_EXCEEDS_AVAILABLE`
- `PAYMENT_PROVIDER_NOT_CONFIGURED`
- `PAYMENT_PROVIDER_UNAVAILABLE`
- `PAYMENT_PROVIDER_DECLINED`
- `PAYMENT_PROVIDER_TIMEOUT`
- `PAYMENT_PROVIDER_INVALID_RESPONSE`
- `PAYMENT_OUTCOME_UNKNOWN`
- `PAYMENT_RECONCILIATION_REQUIRED`
- `PAYMENT_RECONCILIATION_IN_PROGRESS`
- `PAYMENT_MANUAL_REVIEW_REQUIRED`
- `PAYMENT_MANUAL_OVERRIDE_APPROVAL_REQUIRED`
- `PAYMENT_DUPLICATE_PROVIDER_REFERENCE`

### `PAYMENT_OUTCOME_UNKNOWN`

- category: `outcome_unknown`.
- outcome: `unknown`.
- severity: `critical`.
- retry mode: `manual_review_only` أو`poll_operation`.
- العميل لا ينشئPaymentAttempt جديدة.
- يعيدنفسIdempotency-Key أويتابعreconciliation resource.

## 51. Refund Codes

- `REFUND_NOT_FOUND`
- `REFUND_INVALID_STATE`
- `REFUND_AMOUNT_INVALID`
- `REFUND_EXCEEDS_REMAINING_AMOUNT`
- `REFUND_ORIGINAL_PAYMENT_NOT_REFUNDABLE`
- `REFUND_ORIGINAL_METHOD_REQUIRED`
- `REFUND_ALTERNATE_METHOD_APPROVAL_REQUIRED`
- `REFUND_CASH_SHIFT_REQUIRED`
- `REFUND_CASH_LIMIT_EXCEEDED`
- `REFUND_ALREADY_COMPLETED`
- `REFUND_PROVIDER_DECLINED`
- `REFUND_PROVIDER_UNAVAILABLE`
- `REFUND_OUTCOME_UNKNOWN`
- `REFUND_RECONCILIATION_REQUIRED`
- `REFUND_LIABILITY_OPENED`

# القسم العاشر — Inventory, Transfers and Purchasing

## 52. Inventory Codes

- `INVENTORY_POSITION_NOT_FOUND`
- `INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY`
- `INVENTORY_NEGATIVE_STOCK_NOT_ALLOWED`
- `INVENTORY_NEGATIVE_STOCK_APPROVAL_REQUIRED`
- `INVENTORY_RESERVATION_NOT_FOUND`
- `INVENTORY_RESERVATION_EXPIRED`
- `INVENTORY_RESERVATION_CONFLICT`
- `INVENTORY_MOVEMENT_NOT_FOUND`
- `INVENTORY_MOVEMENT_INVALID_STATE`
- `INVENTORY_MOVEMENT_ALREADY_POSTED`
- `INVENTORY_MOVEMENT_IMMUTABLE`
- `INVENTORY_ADJUSTMENT_APPROVAL_REQUIRED`
- `INVENTORY_ADJUSTMENT_VARIANCE_LIMIT_EXCEEDED`
- `INVENTORY_COST_LAYER_UNAVAILABLE`
- `INVENTORY_SERIAL_ALREADY_USED`
- `INVENTORY_SERIAL_NOT_FOUND`
- `INVENTORY_BATCH_NOT_FOUND`
- `INVENTORY_BATCH_QUARANTINED`
- `INVENTORY_RECONCILIATION_REQUIRED`

## 53. Transfer Codes

- `TRANSFER_NOT_FOUND`
- `TRANSFER_INVALID_STATE`
- `TRANSFER_SOURCE_DESTINATION_SAME`
- `TRANSFER_SOURCE_SCOPE_DENIED`
- `TRANSFER_DESTINATION_SCOPE_DENIED`
- `TRANSFER_LINES_IMMUTABLE_AFTER_APPROVAL`
- `TRANSFER_INSUFFICIENT_AVAILABLE_QUANTITY`
- `TRANSFER_ALREADY_SHIPPED`
- `TRANSFER_SHIPMENT_EXCEEDS_APPROVED_QUANTITY`
- `TRANSFER_ALREADY_RECEIVED`
- `TRANSFER_RECEIPT_EXCEEDS_SHIPPED_QUANTITY`
- `TRANSFER_DUPLICATE_RECEIPT`
- `TRANSFER_DISCREPANCY_REQUIRES_RESOLUTION`
- `TRANSFER_CANCELLATION_NOT_ALLOWED`
- `TRANSFER_CLOSE_BLOCKED`

## 54. Stock Count Codes

- `STOCK_COUNT_NOT_FOUND`
- `STOCK_COUNT_INVALID_STATE`
- `STOCK_COUNT_SCOPE_OVERLAP`
- `STOCK_COUNT_EXPECTED_QUANTITY_HIDDEN`
- `STOCK_COUNT_OBSERVATION_DUPLICATE`
- `STOCK_COUNT_RECOUNT_REQUIRED`
- `STOCK_COUNT_VARIANCE_APPROVAL_REQUIRED`
- `STOCK_COUNT_ADJUSTMENT_ALREADY_POSTED`
- `STOCK_COUNT_FROZEN_SCOPE`

## 55. Supplier and Purchasing Codes

- `SUPPLIER_NOT_FOUND`
- `SUPPLIER_RESTRICTED`
- `SUPPLIER_DUPLICATE`
- `SUPPLIER_BANK_CHANGE_APPROVAL_REQUIRED`
- `PURCHASE_ORDER_NOT_FOUND`
- `PURCHASE_ORDER_INVALID_STATE`
- `PURCHASE_ORDER_APPROVAL_REQUIRED`
- `PURCHASE_ORDER_ALREADY_APPROVED`
- `PURCHASE_ORDER_REVISION_REQUIRED`
- `PURCHASE_ORDER_CANCELLATION_NOT_ALLOWED`
- `GOODS_RECEIPT_NOT_FOUND`
- `GOODS_RECEIPT_INVALID_STATE`
- `GOODS_RECEIPT_EXCEEDS_OPEN_QUANTITY`
- `GOODS_RECEIPT_INSPECTION_REQUIRED`
- `GOODS_RECEIPT_ALREADY_POSTED`
- `SUPPLIER_INVOICE_NOT_FOUND`
- `SUPPLIER_INVOICE_DUPLICATE_REFERENCE`
- `SUPPLIER_INVOICE_MATCH_EXCEPTION`
- `SUPPLIER_INVOICE_MATCH_OVERRIDE_APPROVAL_REQUIRED`
- `SUPPLIER_INVOICE_ALREADY_APPROVED`
- `SUPPLIER_RETURN_NOT_ALLOWED`

# القسم الحادي عشر — Returns, Customers and Ledgers

## 56. Return and Exchange Codes

- `RETURN_REQUEST_NOT_FOUND`
- `RETURN_NOT_ELIGIBLE`
- `RETURN_WINDOW_EXPIRED`
- `RETURN_NO_RECEIPT_APPROVAL_REQUIRED`
- `RETURN_QUANTITY_EXCEEDS_SOLD`
- `RETURN_QUANTITY_EXCEEDS_REMAINING`
- `RETURN_ITEM_ALREADY_RETURNED`
- `RETURN_INSPECTION_REQUIRED`
- `RETURN_DISPOSITION_REQUIRED`
- `RETURN_VALUATION_CHANGED`
- `RETURN_VALUATION_OVERRIDE_APPROVAL_REQUIRED`
- `RETURN_INVALID_STATE`
- `RETURN_ALREADY_POSTED`
- `RETURN_INVENTORY_EXCEPTION`
- `EXCHANGE_NOT_FOUND`
- `EXCHANGE_INVALID_STATE`
- `EXCHANGE_REPLACEMENT_SALE_REQUIRED`
- `EXCHANGE_SETTLEMENT_REQUIRED`
- `VOID_NOT_ALLOWED`
- `VOID_APPROVAL_REQUIRED`
- `VOID_RECONCILIATION_REQUIRED`

## 57. Customer and Privacy Codes

- `CUSTOMER_NOT_FOUND`
- `CUSTOMER_DUPLICATE_CANDIDATE`
- `CUSTOMER_RESTRICTED`
- `CUSTOMER_BLOCKED`
- `CUSTOMER_MERGED`
- `CUSTOMER_ANONYMIZED`
- `CUSTOMER_MERGE_CONFLICT`
- `CUSTOMER_MERGE_APPROVAL_REQUIRED`
- `CUSTOMER_ANONYMIZATION_BLOCKED_BY_RETENTION`
- `CUSTOMER_ANONYMIZATION_BLOCKED_BY_LEGAL_HOLD`
- `CUSTOMER_CONSENT_REQUIRED`
- `CUSTOMER_CONSENT_WITHDRAWN`
- `CUSTOMER_SENSITIVE_ACCESS_DENIED`
- `CUSTOMER_BULK_ACCESS_DENIED`
- `PRIVACY_SUBJECT_VERIFICATION_REQUIRED`
- `PRIVACY_REQUEST_INVALID_STATE`

## 58. Receivables Codes

- `RECEIVABLE_ACCOUNT_NOT_FOUND`
- `CREDIT_SALE_NOT_ALLOWED`
- `CREDIT_LIMIT_REQUIRED`
- `CREDIT_LIMIT_EXCEEDED`
- `CREDIT_LIMIT_APPROVAL_REQUIRED`
- `RECEIVABLE_ENTRY_INVALID`
- `RECEIVABLE_ALLOCATION_EXCEEDS_OPEN_BALANCE`
- `RECEIVABLE_DISPUTE_OPEN`
- `RECEIVABLE_WRITE_OFF_APPROVAL_REQUIRED`
- `RECEIVABLE_LEDGER_IMMUTABLE`

## 59. Store Credit and Loyalty Codes

- `STORE_CREDIT_ACCOUNT_NOT_FOUND`
- `STORE_CREDIT_INSUFFICIENT_BALANCE`
- `STORE_CREDIT_RESERVATION_NOT_FOUND`
- `STORE_CREDIT_RESERVATION_EXPIRED`
- `STORE_CREDIT_ALREADY_CONSUMED`
- `STORE_CREDIT_CORRECTION_APPROVAL_REQUIRED`
- `LOYALTY_ACCOUNT_NOT_FOUND`
- `LOYALTY_INSUFFICIENT_POINTS`
- `LOYALTY_RESERVATION_NOT_FOUND`
- `LOYALTY_RESERVATION_EXPIRED`
- `LOYALTY_ALREADY_CONSUMED`
- `LOYALTY_ADJUSTMENT_APPROVAL_REQUIRED`

# القسم الثاني عشر — Shifts and Cash

## 60. Shift Codes

- `SHIFT_NOT_FOUND`
- `SHIFT_INVALID_STATE`
- `SHIFT_ALREADY_OPEN`
- `SHIFT_OPEN_REQUIRED`
- `SHIFT_OPERATOR_ALREADY_HAS_OPEN_SHIFT`
- `SHIFT_TERMINAL_ALREADY_IN_USE`
- `SHIFT_CLOSE_BLOCKED_BY_PENDING_OPERATIONS`
- `SHIFT_CLOSE_BLOCKED_BY_UNKNOWN_PAYMENTS`
- `SHIFT_COUNT_REQUIRED`
- `SHIFT_PROVISIONAL_CLOSE_REQUIRED`
- `SHIFT_FINAL_CLOSE_APPROVAL_REQUIRED`
- `SHIFT_ALREADY_FINAL_CLOSED`
- `SHIFT_REOPEN_NOT_ALLOWED`

## 61. Cash Codes

- `CASH_DRAWER_SESSION_NOT_FOUND`
- `CASH_DRAWER_NOT_OPEN`
- `CASH_MOVEMENT_AMOUNT_INVALID`
- `CASH_MOVEMENT_LIMIT_EXCEEDED`
- `CASH_MOVEMENT_APPROVAL_REQUIRED`
- `CASH_EXPECTED_BALANCE_HIDDEN`
- `CASH_COUNT_REQUIRED`
- `CASH_RECOUNT_REQUIRED`
- `CASH_DISCREPANCY_OPEN`
- `CASH_DISCREPANCY_APPROVAL_REQUIRED`
- `CASH_DISCREPANCY_SELF_APPROVAL_NOT_ALLOWED`
- `CASH_BALANCE_DIRECT_EDIT_NOT_ALLOWED`
- `CASH_HANDOVER_REQUIRED`

# القسم الثالث عشر — Documents, Notifications, Reports and Exports

## 62. Document Codes

- `DOCUMENT_NOT_FOUND`
- `DOCUMENT_NOT_ISSUED`
- `DOCUMENT_ALREADY_ISSUED`
- `DOCUMENT_IMMUTABLE`
- `DOCUMENT_CORRECTION_REQUIRED`
- `DOCUMENT_CORRECTION_APPROVAL_REQUIRED`
- `DOCUMENT_RENDER_PENDING`
- `DOCUMENT_RENDER_FAILED`
- `DOCUMENT_TEMPLATE_NOT_FOUND`
- `DOCUMENT_TEMPLATE_VERSION_UNAVAILABLE`
- `DOCUMENT_NUMBER_SEQUENCE_UNAVAILABLE`
- `DOCUMENT_PRINT_FAILED`
- `DOCUMENT_REPRINT_REASON_REQUIRED`
- `DOCUMENT_DOWNLOAD_EXPIRED`

## 63. Notification and Delivery Codes

- `NOTIFICATION_NOT_FOUND`
- `NOTIFICATION_SUPPRESSED_BY_CONSENT`
- `NOTIFICATION_RECIPIENT_INVALID`
- `NOTIFICATION_TEMPLATE_NOT_FOUND`
- `NOTIFICATION_TEMPLATE_VERSION_UNAVAILABLE`
- `DELIVERY_PROVIDER_NOT_CONFIGURED`
- `DELIVERY_PROVIDER_UNAVAILABLE`
- `DELIVERY_REJECTED`
- `DELIVERY_OUTCOME_UNKNOWN`
- `DELIVERY_RETRY_EXHAUSTED`
- `RECIPIENT_OVERRIDE_APPROVAL_REQUIRED`

## 64. Report Codes

- `REPORT_DEFINITION_NOT_FOUND`
- `REPORT_FILTER_INVALID`
- `REPORT_DATE_RANGE_TOO_LARGE`
- `REPORT_DATA_ACCESS_DENIED`
- `REPORT_RUN_NOT_FOUND`
- `REPORT_RUN_PENDING`
- `REPORT_RUN_FAILED`
- `REPORT_QUERY_TIMEOUT`
- `REPORT_PROJECTION_STALE`
- `REPORT_RESULT_EXPIRED`

## 65. Export Codes

- `EXPORT_NOT_FOUND`
- `EXPORT_APPROVAL_REQUIRED`
- `EXPORT_SCOPE_TOO_BROAD`
- `EXPORT_SENSITIVE_FIELDS_DENIED`
- `EXPORT_ROW_LIMIT_EXCEEDED`
- `EXPORT_RATE_LIMIT_EXCEEDED`
- `EXPORT_PENDING`
- `EXPORT_GENERATION_FAILED`
- `EXPORT_EXPIRED`
- `EXPORT_DOWNLOAD_DENIED`
- `EXPORT_ALREADY_DOWNLOADED_LIMIT_REACHED`
- `EXPORT_CHECKSUM_MISMATCH`

# القسم الرابع عشر — Audit, Retention and Legal

## 66. Audit Codes

- `AUDIT_RECORD_NOT_FOUND`
- `AUDIT_ACCESS_DENIED`
- `AUDIT_RESTRICTED_RECORD_DENIED`
- `AUDIT_EXPORT_APPROVAL_REQUIRED`
- `AUDIT_INTEGRITY_CHECK_FAILED`
- `AUDIT_SEQUENCE_GAP_DETECTED`
- `AUDIT_HASH_MISMATCH`
- `AUDIT_PERSISTENCE_UNAVAILABLE`
- `AUDIT_RECORD_MUTATION_NOT_ALLOWED`
- `AUDIT_CORRECTION_REASON_REQUIRED`

## 67. Legal Hold Codes

- `LEGAL_HOLD_NOT_FOUND`
- `LEGAL_HOLD_INVALID_STATE`
- `LEGAL_HOLD_APPROVAL_REQUIRED`
- `LEGAL_HOLD_SCOPE_INVALID`
- `LEGAL_HOLD_ALREADY_ACTIVE`
- `LEGAL_HOLD_RELEASE_APPROVAL_REQUIRED`
- `LEGAL_HOLD_BLOCKS_OPERATION`
- `LEGAL_HOLD_BLOCKS_DISPOSITION`

## 68. Retention Codes

- `RETENTION_POLICY_NOT_FOUND`
- `RETENTION_POLICY_INVALID`
- `RETENTION_DISPOSITION_NOT_DUE`
- `RETENTION_DISPOSITION_APPROVAL_REQUIRED`
- `RETENTION_DISPOSITION_BLOCKED`
- `RETENTION_DISPOSITION_PARTIAL_FAILURE`
- `RETENTION_EVIDENCE_INCOMPLETE`
- `RETENTION_DELETION_NOT_ALLOWED`
- `RETENTION_ARCHIVE_UNAVAILABLE`

# القسم الخامس عشر — Billing and Entitlements

## 69. Subscription Codes

- `SUBSCRIPTION_NOT_FOUND`
- `SUBSCRIPTION_INVALID_STATE`
- `SUBSCRIPTION_CHANGE_NOT_ALLOWED`
- `SUBSCRIPTION_UPGRADE_QUOTE_EXPIRED`
- `SUBSCRIPTION_DOWNGRADE_BLOCKED_BY_USAGE`
- `SUBSCRIPTION_CANCELLATION_ALREADY_SCHEDULED`
- `SUBSCRIPTION_REACTIVATION_NOT_ALLOWED`
- `SUBSCRIPTION_PAYMENT_REQUIRED`
- `SUBSCRIPTION_COLLECTION_OUTCOME_UNKNOWN`

## 70. Billing Codes

- `BILLING_ACCOUNT_NOT_FOUND`
- `BILLING_INVOICE_NOT_FOUND`
- `BILLING_INVOICE_INVALID_STATE`
- `BILLING_INVOICE_ALREADY_PAID`
- `BILLING_PAYMENT_METHOD_REQUIRED`
- `BILLING_COLLECTION_DECLINED`
- `BILLING_COLLECTION_FAILED`
- `BILLING_COLLECTION_OUTCOME_UNKNOWN`
- `BILLING_MANUAL_PAYMENT_APPROVAL_REQUIRED`
- `BILLING_CREDIT_LIMIT_EXCEEDED`
- `BILLING_REFUND_NOT_ALLOWED`

## 71. Entitlement Compiler Codes

- `ENTITLEMENT_SET_NOT_FOUND`
- `ENTITLEMENT_COMPILATION_FAILED`
- `ENTITLEMENT_SET_NOT_ACTIVE`
- `ENTITLEMENT_OVERRIDE_APPROVAL_REQUIRED`
- `ENTITLEMENT_OVERRIDE_EXPIRY_REQUIRED`
- `ENTITLEMENT_OVERRIDE_CONFLICT`

# القسم السادس عشر — Sync and Offline

## 72. Sync Batch Codes

- `SYNC_AUTHENTICATION_FAILED`
- `SYNC_DEVICE_NOT_ALLOWED`
- `SYNC_BATCH_EMPTY`
- `SYNC_BATCH_TOO_LARGE`
- `SYNC_BATCH_DUPLICATE`
- `SYNC_BATCH_PARTIAL_FAILURE`
- `SYNC_CURSOR_INVALID`
- `SYNC_CURSOR_EXPIRED`
- `SYNC_CURSOR_SCOPE_MISMATCH`
- `SYNC_CURSOR_SCHEMA_MISMATCH`
- `SYNC_SNAPSHOT_REQUIRED`
- `SYNC_SNAPSHOT_PENDING`
- `SYNC_SNAPSHOT_EXPIRED`

## 73. Sync Operation Codes

- `SYNC_OPERATION_TYPE_NOT_SUPPORTED`
- `SYNC_OPERATION_DUPLICATE`
- `SYNC_OPERATION_SEQUENCE_GAP`
- `SYNC_OPERATION_SEQUENCE_REPLAY`
- `SYNC_OPERATION_SIGNATURE_INVALID`
- `SYNC_OPERATION_LEASE_INVALID`
- `SYNC_OPERATION_VERSION_CONFLICT`
- `SYNC_OPERATION_STATE_CONFLICT`
- `SYNC_OPERATION_PERMISSION_REVOKED`
- `SYNC_OPERATION_ENTITLEMENT_CHANGED`
- `SYNC_OPERATION_REFERENCE_MISSING`
- `SYNC_OPERATION_DEPENDENCY_PENDING`
- `SYNC_OPERATION_RECONCILIATION_REQUIRED`

## 74. Offline Codes

- `OFFLINE_OPERATION_NOT_ALLOWED`
- `OFFLINE_PAYMENT_METHOD_NOT_ALLOWED`
- `OFFLINE_CREDIT_SALE_NOT_ALLOWED`
- `OFFLINE_REFUND_NOT_ALLOWED`
- `OFFLINE_DISCOUNT_LIMIT_EXCEEDED`
- `OFFLINE_CASH_LIMIT_EXCEEDED`
- `OFFLINE_CATALOG_VERSION_STALE`
- `OFFLINE_PRICE_VERSION_STALE`
- `OFFLINE_TAX_VERSION_STALE`
- `OFFLINE_AUTHORIZATION_VERSION_STALE`
- `OFFLINE_ENTITLEMENT_VERSION_STALE`
- `OFFLINE_CLOCK_DRIFT_EXCEEDED`
- `OFFLINE_RESOURCE_CONFLICT`
- `OFFLINE_CANONICALIZATION_REQUIRED`

التفاصيل والـRecovery protocol فيوثيقتي Sync وOffline التاليتين.

# القسم السابع عشر — Providers, Webhooks and Dependencies

## 75. Dependency Codes

- `DEPENDENCY_UNAVAILABLE`
- `DEPENDENCY_TIMEOUT`
- `DEPENDENCY_INVALID_RESPONSE`
- `DEPENDENCY_RATE_LIMITED`
- `DEPENDENCY_AUTHENTICATION_FAILED`
- `DEPENDENCY_CONFIGURATION_INVALID`
- `DEPENDENCY_CIRCUIT_OPEN`

## 76. Provider Callback Codes

- `PROVIDER_SIGNATURE_INVALID`
- `PROVIDER_TIMESTAMP_INVALID`
- `PROVIDER_REPLAY_DETECTED`
- `PROVIDER_EVENT_DUPLICATE`
- `PROVIDER_EVENT_NOT_SUPPORTED`
- `PROVIDER_REFERENCE_NOT_FOUND`
- `PROVIDER_PAYLOAD_INVALID`
- `PROVIDER_MAPPING_CONFLICT`
- `PROVIDER_CALLBACK_PERSISTENCE_FAILED`

## 77. Tenant Webhook Codes

- `WEBHOOK_SUBSCRIPTION_NOT_FOUND`
- `WEBHOOK_ENDPOINT_INVALID`
- `WEBHOOK_ENDPOINT_NOT_ALLOWED`
- `WEBHOOK_VERIFICATION_FAILED`
- `WEBHOOK_SECRET_ROTATION_REQUIRED`
- `WEBHOOK_DELIVERY_FAILED`
- `WEBHOOK_DELIVERY_RATE_LIMITED`
- `WEBHOOK_DELIVERY_TIMEOUT`
- `WEBHOOK_DELIVERY_RETRY_EXHAUSTED`
- `WEBHOOK_SUBSCRIPTION_DISABLED`
- `WEBHOOK_REPLAY_NOT_ALLOWED`

# القسم الثامن عشر — Operations and Recovery

## 78. Operation Resource Codes

- `OPERATION_NOT_FOUND`
- `OPERATION_PENDING`
- `OPERATION_ALREADY_COMPLETED`
- `OPERATION_INVALID_STATE`
- `OPERATION_CANCELLATION_NOT_ALLOWED`
- `OPERATION_RETRY_NOT_ALLOWED`
- `OPERATION_RESULT_EXPIRED`
- `OPERATION_MANUAL_INTERVENTION_REQUIRED`

## 79. Recovery Codes

- `RECOVERY_CASE_NOT_FOUND`
- `RECOVERY_ACTION_NOT_ALLOWED`
- `RECOVERY_APPROVAL_REQUIRED`
- `EVENT_REPLAY_NOT_ALLOWED`
- `EVENT_REPLAY_SIDE_EFFECT_BLOCKED`
- `EVENT_REPLAY_ALREADY_IN_PROGRESS`
- `DEAD_LETTER_NOT_FOUND`
- `DEAD_LETTER_REDRIVE_LIMIT_REACHED`
- `PROJECTION_REBUILD_IN_PROGRESS`
- `PROJECTION_CUTOVER_CONFLICT`
- `DATA_REPAIR_APPROVAL_REQUIRED`
- `DATA_REPAIR_PRECONDITION_FAILED`

## 80. Platform Operations Codes

- `SERVICE_TEMPORARILY_UNAVAILABLE`
- `MAINTENANCE_IN_PROGRESS`
- `READ_MODEL_UNAVAILABLE`
- `READ_MODEL_STALE`
- `WRITE_MODEL_UNAVAILABLE`
- `CONFIGURATION_UNAVAILABLE`
- `FEATURE_TEMPORARILY_DISABLED`
- `PRODUCTION_ACCESS_REQUIRED`
- `RESTORE_APPROVAL_REQUIRED`
- `RESTORE_IN_PROGRESS`
- `MIGRATION_IN_PROGRESS`

# القسم التاسع عشر — Partial Completion and Unknown Outcomes

## 81. Partial Completion Contract

Partial ليست500 تلقائيًا. Response تتضمن:

- top-level `status=partially_completed`.
- succeeded items/effects.
- failed/pending items.
- لكلitem error code وoutcome.
- recovery action.
- operation/process ID.

أمثلة:

- `BULK_OPERATION_PARTIAL_FAILURE`
- `CATALOG_IMPORT_PARTIAL_FAILURE`
- `SYNC_BATCH_PARTIAL_FAILURE`
- `RETENTION_DISPOSITION_PARTIAL_FAILURE`
- `SALE_COMPLETION_PARTIAL`

## 82. Committed Core withDownstream Failure

إذاSale اكتملت وفشلDocument أوNotification أوLoyalty:

- Sale completion لا تتحولFailure.
- response `outcome=committed`.
- ترجعwarnings/reconciliation references.
- codes مثل:
    - `SALE_DOCUMENT_PENDING`
    - `SALE_INVENTORY_RECONCILIATION_REQUIRED`
    - `SALE_LOYALTY_POSTING_PENDING`

## 83. Outcome Unknown Contract

أكواد رئيسية:

- `PAYMENT_OUTCOME_UNKNOWN`
- `REFUND_OUTCOME_UNKNOWN`
- `DELIVERY_OUTCOME_UNKNOWN`
- `BILLING_COLLECTION_OUTCOME_UNKNOWN`

### Rules

- لا تصنفFailed.
- لا تسمحBlind retry بمحاولةجديدة.
- ترتبطOperation/Reconciliation case.
- تعرضUser action آمنة مثلانتظر/راجعالحالة، دونالقولإنالمبلغ لم يخصم.
- High-severity audit andmonitoring.

## 84. Manual Intervention

- `MANUAL_INTERVENTION_REQUIRED`
- `PAYMENT_MANUAL_REVIEW_REQUIRED`
- `INVENTORY_RECONCILIATION_REQUIRED`
- `SHIFT_CLOSE_EXCEPTION_REQUIRES_REVIEW`
- `SYNC_OPERATION_RECONCILIATION_REQUIRED`
- `DATA_INTEGRITY_REVIEW_REQUIRED`

Manual intervention record تحددQueue، priority، owner، reason، allowed commands.

# القسم العشرون — Client Behavior

## 85. Client Decision Rules

Clients تعتمد على:

- `code`.
- `retry_mode`.
- `outcome`.
- `required_action`.
- `operation_id`.

ولا تعتمدعلى:

- message text.
- HTTP status وحده.
- substring matching.
- absence ofresponse لتقريرfailure.

## 86. UI Patterns

### Inline field error

Validation target محدد.

### Blocking modal

State conflict يحتاجRefresh أوuser decision.

### Step-up challenge

`STEP_UP_REQUIRED` معchallenge route/context.

### Approval banner

`APPROVAL_REQUIRED` أو`APPROVAL_PENDING`.

### Pending status

Operation polling، لاerror toast متكرر.

### Unknown outcome

تحذير واضح يمنعإعادةالدفع/الاسترداد ويعرضReference.

### Support reference

يعرضللأخطاء غيرالمتوقعة أوManual review، دونتفاصيل حساسة.

## 87. Offline Client Behavior

- يحفظerror لكلClientOperationId.
- يميزrejected وconflict وpending reconciliation.
- لايحذفlocal evidence بسببserver rejection.
- يسمحCorrection operation جديدة، لاedit للطلب المرسل.
- لايعيدbatch كامل عشوائيًا.

# القسم الحادي والعشرون — Retry Policy

## 88. Safe Automatic Retry

مسموح لـ:

- transient GET.
- `429/503` وفقRetry-After.
- idempotent mutation بنفسIdempotency-Key.
- webhook delivery.
- dependency operation classified no-effect.

معexponential backoff وjitter وحدأقصى.

## 89. Never Auto-Retry

- Validation failures.
- Permission/Scope denied.
- State conflicts.
- Different-payload idempotency conflict.
- Payment/Refund outcome unknown بمحاولةجديدة.
- Approval rejected.
- SoD conflict.
- Data integrity errors.

## 90. Retry Budget

كلClient/worker يحتاج:

- max attempts.
- max elapsed time.
- retryable codes allow-list.
- idempotency preservation.
- circuit breaker interaction.
- dead-letter/manual escalation.

# القسم الثاني والعشرون — Logging, Audit and Observability

## 91. Logging Contract

يسجل:

- error code/category/status.
- request/correlation IDs.
- operation/aggregate IDs masked asneeded.
- tenant/client/channel.
- retry mode/outcome.
- dependency/provider namespace.
- latency andattempt.

لا يسجل:

- passwords/tokens.
- full payment credentials.
- raw PII request bodies.
- provider secrets.
- stack trace فيuser response.

## 92. Audit Requirements

Always audit:

- High-risk authorization deny.
- Step-up/approval failures forcritical actions.
- Self-approval/SoD attempts.
- Provider outcome unknown.
- Manual reconciliation override failures.
- Cross-tenant attempts.
- Data integrity/tamper failures.
- Retention/Legal Hold blocked actions.
- Support grant violations.

## 93. Metrics

- errors bycode/context/version.
- retry volume andsuccess.
- unknown outcomes aging.
- partial completion rate.
- manual intervention backlog.
- authorization denial anomalies.
- concurrency conflict rate.
- provider/dependency failure rate.
- internal error rate.
- client version producinginvalid requests.

# القسم الثالث والعشرون — Localization and User Safety

## 94. Message Keys

كلCode ترتبطبـmessage key مثل:

`errors.sale.invalid_state`

النص المترجم لايرسلBusiness logic جديدة.

## 95. Message Layers

- Developer/API message.
- End-user message.
- Operator/admin guidance.
- Support internal detail.

كلطبقة تخضعصلاحية ومقدارمعلومات مختلف.

## 96. Safe Wording

ممنوع:

- تأكيدوجودResource غيرمرئي.
- إظهاراسمRole أوPermission سرية.
- القولPayment failed عندOutcome unknown.
- إظهارProvider raw response.
- لومالمستخدم برسالة غيرمحددة.

# القسم الرابع والعشرون — Contract Tests

## 97. Schema Tests

1. كلError تطابقEnvelope.
2. Code منشورة وموجودةCatalog.
3. HTTP mapping صحيح.
4. Retry mode موجود.
5. Outcome موجود للـMutations.
6. No sensitive rejected values.

## 98. Security Tests

1. Cross-tenant concealment.
2. Permission vsnot-found timing/shape.
3. No stack traces/secrets.
4. Sensitive detail redaction.
5. Support grant errors لا تكشفTenant data.
6. Audit high-risk denies.

## 99. Idempotency andConcurrency Tests

1. Same key/same payload.
2. Same key/different payload.
3. Operation inprogress.
4. Crash aftercommit beforeresponse.
5. StaleIf-Match.
6. Approval payload changed.

## 100. Provider Tests

1. Decline vsfailure vsunknown.
2. Timeout afterprovider acceptance.
3. Duplicate webhook.
4. Reconciliation resolution.
5. Client doesnotblind retry.

## 101. Partial andBulk Tests

1. Per-item codes.
2. Successes preserved.
3. Batch status partial.
4. Retry failed items only.
5. Operation ID andsupport references.

## 102. Compatibility Tests

- Existing codes unchanged.
- New optional details ignored safely.
- Unknown future code usescategory fallback.
- Deprecated codes remainmapped.
- Message changes do notbreakclients.

# القسم الخامس والعشرون — Open Decisions

## 103. OD-ERR-001 — 409 vs412

**Baseline:** `412` للـHTTP preconditions مثلIf-Match؛ `409` للـBusiness/state/idempotency conflicts.

## 104. OD-ERR-002 — 422 usage

**Baseline:** Semantic validation وBusiness precondition known beforestate race؛ state transitions conflicts تستخدم409.

## 105. OD-ERR-003 — 423 Locked

**Baseline:** اختياري؛ إذاClient compatibility ضعيفة يستخدم409 معstable code.

## 106. OD-ERR-004 — Multi-status 207

**Baseline:** لايستخدم كعقدعام. Bulk returns200/202 معstructured batch status وper-item results.

## 107. OD-ERR-005 — Localization source

تحدد فيNotification/Frontend architecture؛ codes مستقلة عنmessage catalog.

## 108. OD-ERR-006 — Unknown outcome HTTP status

**Baseline:** إذاOperation accepted يرجع202 معstatus resource؛ إذاقراءةCurrent state ترجع200 وحالة`outcome_unknown`. لايرجع500 لمجردعدممعرفةالنتيجة.

## 109. OD-ERR-007 — Validation aggregation

**Baseline:** تجمعfield-level schema errors الآمنة، لكنلا تجمعauthorization/business checks التيقدتكشفمعلومات أومعرضةللrace.

## 110. OD-ERR-008 — Internal code granularity

Client sees stable safe code؛ internal telemetry قدتحملsubcode غيرمنشورة لا يعتمدعليهاClient.

# القسم السادس والعشرون — Prohibited Patterns

## 111. أنماط ممنوعة

- `200 OK` مع`success:false`.
- Code ديناميكية منException class names.
- الاعتمادعلىmessage parsing.
- `INTERNAL_ERROR` لكلBusiness conflict.
- `VALIDATION_ERROR` عام بلاfield details عندالأمان.
- إعادةStack trace أوSQL constraint name.
- كشفResource خارجTenant عبر403 مفصل.
- اعتبارTimeout = failed.
- Automatic retry لـOutcome Unknown بمحاولةجديدة.
- فقدIdempotency-Key عندretry.
- تغييرمعنىCode منشورة.
- ترجمةCode نفسها.
- وضعPII فيsupport reference.
- إرجاعProvider raw response.
- Bulk failure بلاper-item results.
- Partial success تتحولإلىrollback وهمي أو500 مبهم.
- Manual intervention بلاQueue/owner/action.

# القسم السابع والعشرون — Acceptance Gate

## 112. بوابة الاعتماد

لا يعتبر Error Catalog مكتملًا قبل:

1. Category وHTTP mapping لكلCode.
2. Retryability وRetry mode.
3. Outcome certainty للـMutations.
4. Error envelope وdetail schema.
5. Authorization concealment rules.
6. Validation وConcurrency وIdempotency distinctions.
7. State-machine errors لكلAggregate.
8. Provider decline/failure/unknown distinctions.
9. Partial completion وmanual intervention contracts.
10. Sync/Offline error baseline.
11. Logging/Audit/metrics requirements.
12. Localization وuser-safe messages.
13. Contract/security/retry tests.
14. Versioning/deprecation rules.
15. ربطكلAPI operation بالError codes الممكنة.
16. عدموجودsecret/PII/internal detail leakage.
17. عدموجودblind retry للعملياتالمالية.

## 113. القرار التخطيطي الحالي

- تم تعريف أكثر من300 Error code أولية عبركلContexts.
- الـCode هيالعقد، والـMessage للعرض فقط.
- HTTP status لا تكفي وحدها لاتخاذقرارClient.
- كلMutation error تحددOutcome certainty.
- Retry mode صريحة وليستBoolean فقط.
- Outcome Unknown منفصلة عنFailed.
- Partial completion Structured result وليست500 عام.
- Cross-tenant resources تستخدمconcealed not-found behavior.
- 412 للـHTTP precondition و409 للـState/Business conflicts.
- Critical unknown/denied/integrity errors تدقق وتراقب.
- لا يبدأImplementation أوOpenAPI generation قبلربطOperation→Permission→Errors وإغلاق Sync/Offline contracts.

## 114. المرحلة التالية

**ATHR Sync Protocol v1.0**

سيثبت:

- Bootstrap andsnapshot protocol.
- Incremental change cursor.
- Client operation envelope.
- Batch submission/result.
- Idempotency anddeduplication.
- Ordering anddependency handling.
- Conflict classification.
- Canonical ID mapping.
- Tombstones anddeletions.
- Schema/version compatibility.
- Lease/auth changes.
- Retry/backoff/resume.
- Partial acceptance andreconciliation.
- Data volume/compaction.
- Terminal health andlast-sync status.

بعده: **ATHR Offline Protocol v1.0**.