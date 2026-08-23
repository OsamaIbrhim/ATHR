# ATHR Audit Catalog v1.0

**Planning Baseline — Accountability, Decision Evidence, Sensitive Access and Tamper-Resistant History**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة ما يجب تدقيقه داخل ATHR، وكيف يثبت النظام:

- من طلب الفعل.
- من نفذه فعليًا.
- تحت أي Tenant وMembership وScope.
- من كان الـEffective Actor عندالدعم أوالتفويض.
- ما القرار الذي اتخذه النظام.
- ما القواعد والصلاحيات والاستحقاقات التي استخدمت.
- ما الحالة قبل وبعد.
- ما الـCommand والـWorkflow والـDomain Event المرتبطة.
- هل نجح الفعل أوفشل أورفض أوأصبح جزئيًا أومجهول النتيجة.
- ما الأدلة الخارجية المرتبطة.
- كيف تمنع السجلات من العبث أوالحذف غيرالمصرح.
- من يملك قراءتها وتصديرها والاحتفاظ بها.

هذه الوثيقة لا تستبدل Domain Events أوApplication logs أوSecurity telemetry أوBusiness documents.

## 2. الفرق بين السجلات

### Domain Event

يثبت حقيقة تجارية حدثت داخل Aggregate، مثل `SaleCompleted`.

### Integration Event

عقد بين Contexts مبني علىحقيقة مملوكة، مثل `InventoryMovementPosted`.

### Audit Record

يثبت المساءلة والقرار: من طلب، منوافق، ماالسبب، ماالتغيير، وماالنتيجة.

### Security Event

إشارة أمنية قد تنتج منعدة Audit Records، مثل repeated denied access.

### Operational Log

تفاصيل تشغيلية للتشخيص، وقدتكون مؤقتة وعالية الحجم، وليست سجلًا قانونيًا أوتدقيقيًا كاملًا.

### Access Log

يثبت الوصول إلىData أوResource، خصوصًاالبيانات الحساسة والتقارير والExports.

> الحدث لا يغني عن التدقيق، والتدقيق لا يصبح مصدر الحقيقة التجارية بدل الـAggregate أوLedger.
> 

## 3. مبادئ إلزامية

1. Audit Records Append-only.
2. لا Update أوDelete عادي لسجل تدقيق.
3. التصحيح بسجل `AuditCorrection` مرتبط بالأصل، دونمحو التاريخ.
4. كل High-risk Command تسجل حتىلوتمرفضها.
5. النجاح والفشل والرفض والنتيجة المجهولة حالات مستقلة.
6. الـActor الحقيقي والـEffective Actor يسجلان منفصلين.
7. Support access لايختفي خلفاسم المستخدم العميل.
8. System وService وDevice actors لهاهوية مستقلة قابلة للتتبع.
9. الـBefore/After evidence تقلل البيانات الحساسة ولا تخزن secrets.
10. لا تخزن Passwords أوTokens أوPrivate keys أوFull payment credentials.
11. السبب Structured reason code، والنص الحر محدود ومصنف.
12. Audit timestamp يعتمد server clock؛ يحتفظ OccurredAt منفصلًا للـOffline.
13. كل Audit Record تحمل TenantId عندما يكونالفعل Tenant-owned.
14. لا يسمح Cross-tenant audit query افتراضيًا.
15. قراءة Audit Records الحساسة نفسها Audit action.
16. تصدير Audit data High-risk ويحتاج Scope وPurpose وExpiry.
17. Audit failure لا يمر صامتًا فيالعمليات الحرجة.
18. لا ينجح High-risk mutation إذا تعذر حفظ الحدالأدنى منAudit evidence داخلنفسالـTransaction أوDurable path المعتمد.
19. لا تستخدم Application logs كبديل بسببقابليتها للتدوير والتعديل وعدمثبات schema.
20. لا تعتمد علىIP وحده لإثباتالهوية.

## 4. Audit Record Schema

```json
{
  "audit_id": "opaque-id",
  "audit_type": "action|decision|access|security|support|governance|system",
  "action_key": "athr.sales.sale.manual-discount.applied",
  "schema_version": 1,
  "tenant_id": "opaque-id-or-null",
  "legal_entity_id": "opaque-id-or-null",
  "location_id": "opaque-id-or-null",
  "actor": {
    "actor_type": "user|service|device|system|support",
    "identity_id": "opaque-id-or-null",
    "membership_id": "opaque-id-or-null",
    "session_id": "opaque-id-or-null",
    "authentication_strength": "password|mfa|step-up|device-key|service-credential|system",
    "authorization_version": "opaque-version-or-null"
  },
  "effective_actor": {
    "identity_id": "opaque-id-or-null",
    "membership_id": "opaque-id-or-null",
    "mode": "self|delegated|support-assisted|impersonated|system-on-behalf"
  },
  "origin": {
    "channel": "web|pos|mobile|api|sync|job|provider-webhook|support-console",
    "device_id": "opaque-id-or-null",
    "terminal_id": "opaque-id-or-null",
    "shift_id": "opaque-id-or-null",
    "ip_address": "masked-or-protected",
    "user_agent_hash": "optional",
    "offline_lease_id": "opaque-id-or-null"
  },
  "target": {
    "resource_type": "sale",
    "resource_id": "opaque-id",
    "aggregate_version_before": 10,
    "aggregate_version_after": 11
  },
  "request": {
    "command_id": "opaque-id-or-null",
    "workflow_id": "WF-SAL-002",
    "process_instance_id": "opaque-id-or-null",
    "idempotency_key_hash": "optional",
    "payload_hash": "optional"
  },
  "decision": {
    "outcome": "allowed|denied|succeeded|failed|partial|unknown|cancelled",
    "reason_code": "structured-code",
    "permission_keys": ["sales.discount.override"],
    "policy_versions": ["opaque-version"],
    "entitlement_version": "opaque-version-or-null",
    "approval_ids": ["opaque-id"],
    "risk_level": "low|medium|high|critical"
  },
  "change": {
    "change_type": "create|update|transition|archive|correct|access|export|execute",
    "before_hash": "optional",
    "after_hash": "optional",
    "changed_fields": ["status", "credit_limit"],
    "redacted_diff": {}
  },
  "evidence": {
    "domain_event_ids": ["opaque-id"],
    "provider_reference_ids": ["masked-reference"],
    "document_ids": ["opaque-id"],
    "attachment_evidence_ids": ["opaque-id"],
    "correlation_id": "opaque-id",
    "causation_id": "opaque-id"
  },
  "time": {
    "occurred_at": "ISO-8601 UTC",
    "recorded_at": "ISO-8601 UTC",
    "effective_at": "ISO-8601 UTC or null"
  },
  "data_classification": "internal|confidential|restricted",
  "retention_class": "AUD-R1",
  "integrity": {
    "writer_id": "service-identity",
    "sequence": 12345,
    "record_hash": "hash",
    "previous_hash": "optional"
  }
}
```

## 5. Actor Model

### Real Actor

الهوية التي بدأت الطلب فعليًا.

### Effective Actor

العضوية التي طبقت صلاحياتها أوتمالعمل نيابةعنها.

### Approver

Actor مستقلة اتخذت قرار موافقة، ولا تحل محلRequester.

### Service Actor

Service identity واضحة بإصدار Credential وPurpose وOwner.

### Device Actor

جهاز أوTerminal وقع أوأرسل Offline operation؛ لا يستبدل المستخدم المسؤول.

### System Actor

Scheduler أوPolicy engine أوReconciliation job. يجب تسجيل Job/Rule version.

### Support Actor

موظف ATHR أوOperator منصي يدخلسياقTenant وفقGrant محدد.

### Break-glass Actor

Support/Security actor يستخدمصلاحية طوارئ مؤقتة. يحتاج سببًا، Step-up، Approval أوPost-review، وتنبيهًا مستقلًا.

## 6. Support Access and Impersonation

كل Support session تحتاج:

- Support user identity.
- Tenant target.
- Requested purpose.
- Ticket/incident/reference.
- Approved scope.
- Start andexpiry.
- Consent orcontractual authority where required.
- Read-only أوWrite capabilities.
- Effective user/member إنتمالعمل نيابةعنه.
- كل resource تمعرضه أوتعديله.
- End reason.

### ممنوع

- تسجيل Support action باسمCustomer user فقط.
- جلسة مفتوحة بلاExpiry.
- Access لجميعTenants افتراضيًا.
- استخدام shared support account.
- إخفاءRead access الحساسة.

### Audit actions

- `athr.support.access.requested`
- `athr.support.access.approved`
- `athr.support.access.started`
- `athr.support.resource.viewed`
- `athr.support.action.executed`
- `athr.support.access.expired`
- `athr.support.access.revoked`
- `athr.support.access.ended`
- `athr.support.break-glass.used`
- `athr.support.break-glass.reviewed`

## 7. Decision Evidence

كل قرار حساس يسجل طبقات القرار منفصلة:

1. Authentication result.
2. Identity status.
3. Membership status.
4. Scope match.
5. Permission decision.
6. Entitlement decision.
7. Business invariant guards.
8. Risk/step-up requirement.
9. Approval requirement/result.
10. Final execution result.

### مثال

رفض Refund قد يكونبسبب:

- Permission denied.
- Refund amount exceedsremaining refundable.
- Required approval missing.
- Payment provider outcome unknown.
- Tenant restricted.

لا يسجل `denied` فقط؛ يسجلreason code المنظم والـPolicy version دونكشف قواعد حساسة للمستخدم غيرالمصرح.

## 8. Before/After Evidence

### Full values مسموحة فقط عندما

- الحقول غيرحساسة.
- الحجم محدود.
- القيمة ضرورية للتحقيق.
- Retention مصرح بها.

### Default approach

- changed field names.
- normalized redacted diff.
- before/after hashes.
- selected safe values.
- reference toimmutable domain/document snapshot.

### أمثلة

- Role scope change: before/after Scope IDs والـPolicy version.
- Credit limit: old/new amount andcurrency معreason/approval.
- Customer contact change: masked old/new value، لاتخزينraw contact مرتين.
- Price change: old/new amount، currency، effective period.
- Password change: `credential_version changed` فقط، لاقيمة أوhash.

## 9. Audit Outcome Model

- **Allowed:** القرار يسمح قبلالتنفيذ.
- **Denied:** منع قبلأيBusiness effect.
- **Succeeded:** الأثر المطلوب اكتمل داخلOwner.
- **Failed:** التنفيذ لمينجح بنتيجة محسومة.
- **Partial:** بعضالخطوات اكتملت وأخرى pending/failed.
- **Unknown:** نتيجة خارجية غيرمحسومة.
- **Cancelled:** طلب صالح ألغي قبلالأثر غيرالقابل للعكس.

لا تستبدل هذه الحالات State Machine التجارية؛ هيAudit outcome للطلب أوالخطوة.

## 10. Risk Levels

### Low

تغيير عرضي غيرحساس، مثلتفضيل واجهة.

### Medium

تغيير تشغيل محدود، مثلProduct description.

### High

يؤثر علىمال أومخزون أوصلاحيات أوPII أوعمليات مغلقة.

### Critical

Owner transfer، Break-glass، tenant closure، payment reconciliation override، legal hold، mass export، destructive disposition، credential/security root changes.

الـRisk level تحدد Step-up وApproval وRetention وAlerting، لكنها لاتمنحPermission.

# القسم الأول — Identity and Authentication Audit

## 11. Authentication actions

يجب تدقيق:

- `athr.identity.registration.requested`
- `athr.identity.registration.completed`
- `athr.identity.contact.verification.requested`
- `athr.identity.contact.verified`
- `athr.identity.sign-in.succeeded`
- `athr.identity.sign-in.failed`
- `athr.identity.sign-in.rate-limited`
- `athr.identity.mfa.challenge.issued`
- `athr.identity.mfa.challenge.failed`
- `athr.identity.mfa.challenge.succeeded`
- `athr.identity.mfa.factor.added`
- `athr.identity.mfa.factor.removed`
- `athr.identity.credential.changed`
- `athr.identity.recovery.started`
- `athr.identity.recovery.completed`
- `athr.identity.recovery.failed`
- `athr.identity.session.issued`
- `athr.identity.session.refreshed`
- `athr.identity.session.revoked`
- `athr.identity.sessions.revoked-all`
- `athr.identity.suspended`
- `athr.identity.reinstated`
- `athr.identity.closed`

### تسجيل محاولات الدخول

- Success records قدتخزن بأحجام تشغيلية وسياسةRetention مختلفة.
- Failures تجمع أيضًا فيSecurity detection.
- لا يسجل password أوOTP.
- IP/User-agent تخضعmasking/protection.

# القسم الثاني — Tenant, Membership and Authorization Audit

## 12. Tenant and organization actions

- `athr.tenant.created`
- `athr.tenant.provisioning.failed`
- `athr.tenant.activated`
- `athr.tenant.access-mode.changed`
- `athr.tenant.restricted`
- `athr.tenant.suspended`
- `athr.tenant.restored`
- `athr.tenant.closure.requested`
- `athr.tenant.closure.cancelled`
- `athr.tenant.closed`
- `athr.legal-entity.created`
- `athr.legal-entity.profile.changed`
- `athr.location.created`
- `athr.location.opened`
- `athr.location.restricted`
- `athr.location.closed`
- `athr.warehouse.created`
- `athr.warehouse.closed`
- `athr.configuration.override.changed`

## 13. Membership actions

- `athr.membership.invitation.created`
- `athr.membership.invitation.revoked`
- `athr.membership.invitation.accepted`
- `athr.membership.activated`
- `athr.membership.role-assignment.changed`
- `athr.membership.scope.changed`
- `athr.membership.home-location.changed`
- `athr.membership.suspended`
- `athr.membership.reinstated`
- `athr.membership.offboarding.started`
- `athr.membership.deactivated`
- `athr.membership.owner-transfer.requested`
- `athr.membership.owner-transfer.completed`

Owner transfer وTenant-wide scope changes Critical، وتحتاج Before/After +Approval +Step-up.

## 14. Authorization and approval actions

- `athr.authorization.role.created`
- `athr.authorization.role.changed`
- `athr.authorization.role.archived`
- `athr.authorization.policy.published`
- `athr.authorization.permission.granted`
- `athr.authorization.permission.revoked`
- `athr.authorization.decision.denied-high-risk`
- `athr.authorization.repeated-denials.detected`
- `athr.approval.requested`
- `athr.approval.granted`
- `athr.approval.rejected`
- `athr.approval.expired`
- `athr.approval.invalidated`
- `athr.approval.cancelled`

### Denied actions

لا يلزم حفظكلUI denial منخفضةالقيمة بنفسالتفصيل. إلزامي عند:

- Sensitive resource.
- High-risk action.
- Cross-tenant attempt.
- Repeated pattern.
- Support access.
- Data export.
- Financial/membership/security action.

# القسم الثالث — Devices, Terminals and Offline Audit

## 15. Device and terminal actions

- `athr.device.enrollment.requested`
- `athr.device.enrolled`
- `athr.device.key-rotation.required`
- `athr.device.key-rotated`
- `athr.device.restricted`
- `athr.device.revoked`
- `athr.device.retired`
- `athr.terminal.provisioned`
- `athr.terminal.activated`
- `athr.terminal.blocked`
- `athr.terminal.location-reassignment.requested`
- `athr.terminal.location-reassigned`
- `athr.terminal.peripheral-binding.changed`
- `athr.terminal.retired`
- `athr.offline-lease.issued`
- `athr.offline-lease.revoked`
- `athr.offline-lease.expired`

## 16. Offline operation evidence

كل Offline-originated operation تسجل:

- local ClientOperationId.
- DeviceId وTerminalId.
- User/Membership.
- LeaseId وlease policy version.
- local sequence.
- device occurred_at.
- server recorded_at.
- catalog/price/tax snapshot versions.
- signature verification result.
- server acceptance/rejection/conflict.
- canonical AggregateId/Version.

### حالات خاصة

- Clock drift detected.
- Sequence gap.
- Revoked lease used.
- Duplicate operation.
- Local transaction accepted butserver invariant conflict.
- Device signature invalid.

# القسم الرابع — Catalog, Pricing, Tax and Promotions Audit

## 17. Catalog actions

- `athr.catalog.product.created`
- `athr.catalog.product.profile.changed`
- `athr.catalog.product.activated`
- `athr.catalog.product.restricted`
- `athr.catalog.product.discontinued`
- `athr.catalog.product.archived`
- `athr.catalog.variant.created`
- `athr.catalog.variant.sellability.changed`
- `athr.catalog.sku.assigned`
- `athr.catalog.sku.retired`
- `athr.catalog.barcode.assigned`
- `athr.catalog.barcode.retired`
- `athr.catalog.uom.created`
- `athr.catalog.uom-conversion.versioned`
- `athr.catalog.assortment.published`
- `athr.catalog.bulk-import.started`
- `athr.catalog.bulk-import.completed`
- `athr.catalog.bulk-import.partially-failed`

Identifier reuse attempt وUOM conversion aftertransaction history High-risk.

## 18. Pricing actions

- `athr.pricing.price-book.created`
- `athr.pricing.price-book.submitted`
- `athr.pricing.price-book.approved`
- `athr.pricing.price-book.activated`
- `athr.pricing.price-entry.changed`
- `athr.pricing.price-entry.ended`
- `athr.pricing.manual-price-override.applied`
- `athr.pricing.floor-price.override-attempted`
- `athr.pricing.floor-price.override-approved`

Before/After amounts, currency, scope, effective dates andapproval mandatory.

## 19. Tax actions

- `athr.tax.rule.created`
- `athr.tax.rule.submitted`
- `athr.tax.rule.approved`
- `athr.tax.rule.activated`
- `athr.tax.rule.superseded`
- `athr.tax.manual-exemption.applied`
- `athr.tax.calculation.override.applied`

Tax overrides Critical/High حسبjurisdiction، معlegal reason/reference.

## 20. Promotion and coupon actions

- `athr.promotion.created`
- `athr.promotion.approved`
- `athr.promotion.activated`
- `athr.promotion.paused`
- `athr.promotion.ended`
- `athr.coupon.campaign.created`
- `athr.coupon.codes.generated`
- `athr.coupon.reserved`
- `athr.coupon.redeemed`
- `athr.coupon.redemption.reversed`
- `athr.coupon.manual-usage-override.applied`

Raw coupon codes لا تظهر فيAudit exports افتراضيًا.

# القسم الخامس — Sales and Payments Audit

## 21. Sale actions

- `athr.sales.sale.started`
- `athr.sales.sale.customer-attached`
- `athr.sales.sale.line-added`
- `athr.sales.sale.line-removed`
- `athr.sales.sale.quantity-changed`
- `athr.sales.sale.manual-discount.applied`
- `athr.sales.sale.manual-discount.rejected`
- `athr.sales.sale.price-override.applied`
- `athr.sales.sale.tax-exemption.applied`
- `athr.sales.sale.suspended`
- `athr.sales.sale.resumed`
- `athr.sales.sale.cancelled`
- `athr.sales.sale.payment-requested`
- `athr.sales.sale.completed`
- `athr.sales.sale.completion-exception`
- `athr.sales.sale.offline-accepted`
- `athr.sales.sale.offline-conflict`

### حجم التدقيق

لا يلزمAudit record منفصلة لكلkeystroke فيCart. يلزم عند:

- Command committed غيّرتAggregate.
- Override أوDiscount أوTax exception.
- Customer attachment/change.
- Suspend/resume acrossoperator.
- Cancellation.
- Completion.

قد تجمع تعديلات Draft العادية فيstructured activity records معaggregate version.

## 22. Payment actions

- `athr.payments.payment.created`
- `athr.payments.attempt.started`
- `athr.payments.attempt.sent`
- `athr.payments.authorized`
- `athr.payments.captured`
- `athr.payments.declined`
- `athr.payments.failed`
- `athr.payments.outcome-unknown`
- `athr.payments.reconciliation.started`
- `athr.payments.reconciliation.resolved-captured`
- `athr.payments.reconciliation.resolved-failed`
- `athr.payments.reconciliation.manual-review-required`
- `athr.payments.reconciliation.manual-override-applied`
- `athr.payments.allocation.created`
- `athr.payments.allocation.released`
- `athr.payments.reversal.requested`
- `athr.payments.reversed`
- `athr.payments.refund.requested`
- `athr.payments.refund.succeeded`
- `athr.payments.refund.failed`
- `athr.payments.refund.outcome-unknown`

### Provider evidence

Audit تسجل:

- Provider namespace.
- masked provider reference.
- request/response evidence hash.
- normalized outcome.
- webhook signature validation.
- received_at.
- matched PaymentAttempt.

Raw provider payload فيRestricted evidence store منفصلة.

### Manual reconciliation override

Critical ويحتاج:

- Step-up.
- Permission مستقلة.
- Reason.
- Provider evidence.
- Approval أوpost-review.
- Before/After state.
- Impacted Sale/Refund/Invoice.

# القسم السادس — Inventory, Transfers and Purchasing Audit

## 23. Inventory actions

- `athr.inventory.reservation.created`
- `athr.inventory.reservation.released`
- `athr.inventory.movement.posted`
- `athr.inventory.movement.rejected`
- `athr.inventory.correction.posted`
- `athr.inventory.negative-stock.override-requested`
- `athr.inventory.negative-stock.override-approved`
- `athr.inventory.adjustment.requested`
- `athr.inventory.adjustment.approved`
- `athr.inventory.adjustment.posted`
- `athr.inventory.batch-status.changed`
- `athr.inventory.serial-status.changed`

Direct balance edit attempt يجب أن ينتجSecurity/Audit denial.

## 24. Transfer actions

- `athr.transfer.created`
- `athr.transfer.submitted`
- `athr.transfer.approved`
- `athr.transfer.rejected`
- `athr.transfer.cancelled`
- `athr.transfer.shipment.recorded`
- `athr.transfer.receipt.recorded`
- `athr.transfer.discrepancy.opened`
- `athr.transfer.discrepancy.resolved`
- `athr.transfer.closed`
- `athr.transfer.duplicate-receipt.rejected`

كل Line revision بعدapproval تحتاجBefore/After وreapproval evidence.

## 25. Stock count actions

- `athr.stock-count.created`
- `athr.stock-count.started`
- `athr.stock-count.observation-recorded`
- `athr.stock-count.submitted`
- `athr.stock-count.recount-requested`
- `athr.stock-count.approved`
- `athr.stock-count.adjustment-posted`
- `athr.stock-count.cancelled`
- `athr.stock-count.exception-resolved`

Blind count: لايسجلExpected value فيrecord المتاح للCounter قبلsubmission.

## 26. Supplier and purchasing actions

- `athr.supplier.created`
- `athr.supplier.profile.changed`
- `athr.supplier.payment-terms.changed`
- `athr.supplier.bank-details.changed`
- `athr.supplier.restricted`
- `athr.purchase-order.created`
- `athr.purchase-order.submitted`
- `athr.purchase-order.approved`
- `athr.purchase-order.rejected`
- `athr.purchase-order.revision-created`
- `athr.purchase-order.cancelled`
- `athr.goods-receipt.created`
- `athr.goods-receipt.inspection-recorded`
- `athr.goods-receipt.posted`
- `athr.goods-receipt.exception-resolved`
- `athr.supplier-invoice.recorded`
- `athr.supplier-invoice.match-exception-raised`
- `athr.supplier-invoice.match-exception-overridden`
- `athr.supplier-invoice.approved`
- `athr.supplier-liability.posted`
- `athr.supplier-return.approved`
- `athr.supplier-return.posted`

Supplier bank/payment details Restricted؛ تغييرها Critical معStep-up وdual review حيثpolicy.

# القسم السابع — Returns, Refunds and Exchanges Audit

## 27. Return actions

- `athr.returns.request.created`
- `athr.returns.eligibility.approved`
- `athr.returns.eligibility.rejected`
- `athr.returns.window-exception.approved`
- `athr.returns.no-receipt-exception.approved`
- `athr.returns.item.received`
- `athr.returns.inspection.recorded`
- `athr.returns.disposition.decided`
- `athr.returns.valuation.calculated`
- `athr.returns.valuation.overridden`
- `athr.returns.return.posted`
- `athr.returns.inventory-disposition.exception`

## 28. Refund and exchange actions

- `athr.refunds.refund.approved`
- `athr.refunds.execution.requested`
- `athr.refunds.original-method.bypassed`
- `athr.refunds.alternate-method.approved`
- `athr.refunds.cash-threshold.override-approved`
- `athr.refunds.refund.succeeded`
- `athr.refunds.refund.failed`
- `athr.refunds.refund.outcome-unknown`
- `athr.refunds.liability.opened`
- `athr.refunds.liability.settled`
- `athr.exchange.started`
- `athr.exchange.replacement-sale.completed`
- `athr.exchange.settlement.completed`
- `athr.void.requested`
- `athr.void.approved`
- `athr.void.completed`
- `athr.void.reconciliation-required`

Return وRefund وVoid records يجب ألا تدمج فيAudit action واحدة مبهمة.

# القسم الثامن — Customer, Privacy, Receivables and Loyalty Audit

## 29. Customer profile and access actions

- `athr.customer.created`
- `athr.customer.profile.viewed-sensitive`
- `athr.customer.profile.changed`
- `athr.customer.contact.changed`
- `athr.customer.identifier.added`
- `athr.customer.restricted`
- `athr.customer.blocked`
- `athr.customer.deactivated`
- `athr.customer.merge.requested`
- `athr.customer.merge.completed`
- `athr.customer.merge.rejected`
- `athr.customer.anonymization.requested`
- `athr.customer.anonymized`
- `athr.customer.privacy-export.requested`
- `athr.customer.privacy-export.completed`

### Sensitive views

لا يلزم تسجيل كلعرض اسم عميل فيSale العادية كسجل مستقل. يلزم عند:

- عرضPII موسع.
- Search واسع.
- Export.
- Support access.
- Credit/financial profile.
- Privacy request.
- Bulk customer access.

## 30. Consent actions

- `athr.customer.consent.granted`
- `athr.customer.consent.withdrawn`
- `athr.customer.consent.policy-version-changed`
- `athr.customer.communication.sent-under-consent`
- `athr.customer.communication.suppressed-by-consent`

يسجل Purpose وChannel وPolicy version وEffectiveAt، دونتكرار contact الخام.

## 31. Receivable actions

- `athr.receivable.credit-limit.requested`
- `athr.receivable.credit-limit.approved`
- `athr.receivable.credit-limit.changed`
- `athr.receivable.entry.posted`
- `athr.receivable.payment.allocated`
- `athr.receivable.dispute.opened`
- `athr.receivable.adjustment.posted`
- `athr.receivable.write-off.approved`
- `athr.receivable.written-off`

## 32. Store Credit actions

- `athr.store-credit.issued`
- `athr.store-credit.reserved`
- `athr.store-credit.redeemed`
- `athr.store-credit.expired`
- `athr.store-credit.corrected`
- `athr.store-credit.manual-adjustment.rejected`

## 33. Loyalty actions

- `athr.loyalty.points-earned`
- `athr.loyalty.points-reserved`
- `athr.loyalty.points-redeemed`
- `athr.loyalty.points-reversed`
- `athr.loyalty.points-expired`
- `athr.loyalty.tier-changed`
- `athr.loyalty.manual-points-adjustment.approved`
- `athr.loyalty.manual-points-adjustment.posted`

Ledger before/after balance يمكنتسجيله كderived summary، لكنالـEntries هيالحقيقة.

# القسم التاسع — Shift, Cash and Terminal Operations Audit

## 34. Shift actions

- `athr.shift.opening.started`
- `athr.shift.opened`
- `athr.shift.suspended`
- `athr.shift.resumed`
- `athr.shift.closing.requested`
- `athr.shift.count.submitted`
- `athr.shift.provisional-close.completed`
- `athr.shift.final-close.completed`
- `athr.shift.close.blocked`
- `athr.shift.close.exception-resolved`
- `athr.shift.reopen.attempt-rejected`

## 35. Cash actions

- `athr.cash.opening-float.posted`
- `athr.cash.drawer.opened-no-sale`
- `athr.cash.cash-in.posted`
- `athr.cash.cash-out.posted`
- `athr.cash.safe-drop.posted`
- `athr.cash.safe-pickup.posted`
- `athr.cash.refund.posted`
- `athr.cash.count.submitted`
- `athr.cash.recount.requested`
- `athr.cash.discrepancy.opened`
- `athr.cash.discrepancy.approved`
- `athr.cash.discrepancy.resolved`
- `athr.cash.handover.completed`
- `athr.cash.direct-balance-edit.rejected`

كل Cash movement تسجل Amount/Currency/Direction/Reason/Source/Drawer/Shift وActor.

# القسم العاشر — Documents, Notifications, Reports and Exports Audit

## 36. Document actions

- `athr.document.issuance.requested`
- `athr.document.issued`
- `athr.document.issuance.failed`
- `athr.document.corrected`
- `athr.document.voided-by-correction`
- `athr.document.render.generated`
- `athr.document.render.failed`
- `athr.document.print.requested`
- `athr.document.print.succeeded`
- `athr.document.print.failed`
- `athr.document.reprinted`
- `athr.document.downloaded`

Reprint يحتاج Actor/Reason/CopyType/DocumentId؛ لا ينشئ مستندًا تجاريًا جديدًا.

## 37. Notification and delivery actions

- `athr.notification.created`
- `athr.notification.suppressed`
- `athr.notification.sent`
- `athr.notification.delivery-failed`
- `athr.notification.delivery-outcome-unknown`
- `athr.notification.manual-resend.requested`
- `athr.notification.manual-resend.completed`
- `athr.notification.recipient-changed`

لا تخزن Message body كاملة فيAudit افتراضيًا؛ تستخدمTemplateId/Version وcontent hash.

## 38. Reporting actions

- `athr.report.definition.created`
- `athr.report.definition.changed`
- `athr.report.run.requested`
- `athr.report.run.completed`
- `athr.report.run.failed`
- `athr.report.schedule.created`
- `athr.report.schedule.changed`
- `athr.report.schedule.recipient-changed`
- `athr.report.sensitive-data.viewed`

## 39. Export actions

- `athr.export.requested`
- `athr.export.approval-requested`
- `athr.export.approved`
- `athr.export.rejected`
- `athr.export.generated`
- `athr.export.downloaded`
- `athr.export.shared-link-created`
- `athr.export.expired`
- `athr.export.deleted`
- `athr.export.anomaly-detected`

كل Export تسجل Purpose، Scope hash، Columns/data classes، row count، artifact checksum، requester، approver، expiry، download events.

# القسم الحادي عشر — SaaS Billing and Entitlements Audit

## 40. Plan and price actions

- `athr.billing.plan.created`
- `athr.billing.plan-version.published`
- `athr.billing.plan-version.archived`
- `athr.billing.plan-price.changed`
- `athr.billing.add-on.created`
- `athr.billing.discount.created`
- `athr.billing.discount.applied`
- `athr.billing.discount.override-applied`

## 41. Subscription actions

- `athr.subscription.trial.started`
- `athr.subscription.trial.extended`
- `athr.subscription.activated`
- `athr.subscription.renewal.started`
- `athr.subscription.renewed`
- `athr.subscription.past-due`
- `athr.subscription.grace-started`
- `athr.subscription.restricted`
- `athr.subscription.suspended`
- `athr.subscription.restored`
- `athr.subscription.upgrade.quoted`
- `athr.subscription.upgrade.applied`
- `athr.subscription.downgrade.scheduled`
- `athr.subscription.downgrade.applied`
- `athr.subscription.cancellation.scheduled`
- `athr.subscription.cancellation.revoked`
- `athr.subscription.cancelled`
- `athr.subscription.reactivated`

## 42. Billing and collection actions

- `athr.billing.invoice.issued`
- `athr.billing.invoice.voided`
- `athr.billing.invoice.credited`
- `athr.billing.collection.started`
- `athr.billing.collection.succeeded`
- `athr.billing.collection.failed`
- `athr.billing.collection.outcome-unknown`
- `athr.billing.collection.reconciled`
- `athr.billing.refund.succeeded`
- `athr.billing.account-credit.issued`
- `athr.billing.manual-payment.recorded`
- `athr.billing.manual-payment.approved`

## 43. Entitlement actions

- `athr.entitlement.compilation.started`
- `athr.entitlement.compilation.failed`
- `athr.entitlement.set.activated`
- `athr.entitlement.set.superseded`
- `athr.entitlement.limit.reached`
- `athr.entitlement.temporary-override.requested`
- `athr.entitlement.temporary-override.granted`
- `athr.entitlement.temporary-override.revoked`
- `athr.entitlement.temporary-override.expired`

Temporary overrides High-risk، تحتاج Expiry وReason وApprover، ولا تكونpermanent بلاPlan change.

# القسم الثاني عشر — Sync, Recovery and Operations Audit

## 44. Sync actions

- `athr.sync.batch.received`
- `athr.sync.operation.accepted`
- `athr.sync.operation.rejected`
- `athr.sync.operation.conflict-detected`
- `athr.sync.operation.pending-reconciliation`
- `athr.sync.batch.partially-completed`
- `athr.sync.batch.completed`
- `athr.sync.cursor.invalidated`
- `athr.sync.snapshot.published`
- `athr.sync.device-lag.threshold-exceeded`

## 45. Event and process recovery actions

- `athr.recovery.event-delivery.failed`
- `athr.recovery.event.dead-lettered`
- `athr.recovery.event-replay.requested`
- `athr.recovery.event-replay.approved`
- `athr.recovery.event-replay.completed`
- `athr.recovery.process.manual-intervention-opened`
- `athr.recovery.process.manual-resolution-applied`
- `athr.recovery.compensation.started`
- `athr.recovery.compensation.completed`
- `athr.recovery.projection-rebuild.started`
- `athr.recovery.projection-rebuild.completed`
- `athr.recovery.projection-cutover.completed`

## 46. Platform operations actions

يجب تدقيق العمليات التيتغير runtime أوdata safety:

- `athr.ops.configuration.changed`
- `athr.ops.feature-flag.changed`
- `athr.ops.secret.rotated`
- `athr.ops.encryption-key.rotated`
- `athr.ops.database-migration.started`
- `athr.ops.database-migration.completed`
- `athr.ops.database-migration.failed`
- `athr.ops.backup.started`
- `athr.ops.backup.completed`
- `athr.ops.restore.requested`
- `athr.ops.restore.approved`
- `athr.ops.restore.completed`
- `athr.ops.data-repair.requested`
- `athr.ops.data-repair.approved`
- `athr.ops.data-repair.executed`
- `athr.ops.production-access.started`
- `athr.ops.production-access.ended`

لا يسجل Secret value، فقطSecretId/version وactor وreason.

# القسم الثالث عشر — Governance, Privacy and Legal Audit

## 47. Legal Hold actions

- `athr.legal-hold.created`
- `athr.legal-hold.approval-requested`
- `athr.legal-hold.activated`
- `athr.legal-hold.scope-changed`
- `athr.legal-hold.reviewed`
- `athr.legal-hold.release-requested`
- `athr.legal-hold.released`
- `athr.legal-hold.disposition-blocked`

## 48. Retention actions

- `athr.retention.policy.created`
- `athr.retention.policy.changed`
- `athr.retention.disposition.planned`
- `athr.retention.disposition.blocked`
- `athr.retention.archive.started`
- `athr.retention.archive.completed`
- `athr.retention.anonymization.started`
- `athr.retention.anonymization.completed`
- `athr.retention.deletion.started`
- `athr.retention.deletion.completed`
- `athr.retention.disposition.partially-failed`
- `athr.retention.disposition.completed`

Destructive actions Critical، تحتاج Evidence منكلstore وموانعLegal Hold.

## 49. Audit system actions

- `athr.audit.record-written`
- `athr.audit.write-failed`
- `athr.audit.integrity-check.started`
- `athr.audit.integrity-check.passed`
- `athr.audit.integrity-check.failed`
- `athr.audit.search.performed`
- `athr.audit.record.viewed-restricted`
- `athr.audit.export.requested`
- `athr.audit.export.approved`
- `athr.audit.export.downloaded`
- `athr.audit.retention-executed`
- `athr.audit.correction-recorded`

لا ينتج `record-written` لكلrecord فينفسstream بشكل يسببloop؛ يستخدمOperational aggregate/metrics أوseparate control channel.

# القسم الرابع عشر — Audit Access Model

## 50. Tenant audit access

الأدوار المقترحة:

- Tenant Owner: نطاق واسع معRedaction لبعضsecurity/platform fields.
- Security Administrator: Identity, access, device andsecurity records.
- Finance Auditor: Sales, payments, cash, purchasing, billing.
- Inventory Auditor: Movements, counts, transfers.
- Privacy Officer: PII access, consent, privacy requests, retention.
- Read-only Auditor: Search andview ضمنScope، بلاexports افتراضيًا.

Role names نهائية فيPermission Matrix؛ هنا نثبت separation.

## 51. Platform audit access

- Platform Security: security/platform-wide signals وفقneed.
- Support: لا يصلAudit كامل؛ يرىمايلزم للـcase.
- Compliance: restricted cross-tenant access بقانون/غرض.
- Operations: technical records فقط، معRedaction business/PII.

Cross-tenant query Critical وتحتاجPurpose وApproval وقدتحتاجBreak-glass.

## 52. Audit search rules

كلSearch يسجل:

- requester.
- Tenant/scope.
- filters.
- date range.
- data classes.
- result count.
- purpose.
- whetherrestricted records viewed.

لا يسجل full result فيSearch audit؛ يستخدمquery hash/summary.

## 53. Audit exports

- Online-only.
- Step-up required للـRestricted.
- Approval forbulk/cross-location/cross-tenant.
- Encrypted temporary artifact.
- Short expiry.
- Watermark/metadata whereapplicable.
- Download reauthorization.
- Every download audited.
- No permanent public links.

# القسم الخامس عشر — Privacy and Redaction

## 54. Data minimization

Audit يجب أن تثبتالمساءلة دونتحويلها إلىمخزنPII زائد.

### ممنوع

- Password/OTP/token.
- Full card/account credentials.
- Raw biometric data.
- Secret keys.
- Full provider request/response فيالـAudit record.
- Document binary.
- Unbounded free-text customer notes.

### Redaction examples

- Email: masked +stable hash ifneeded forcorrelation.
- Phone: last digits +country code optional.
- Payment: provider token/reference masked.
- Address: changed fields +hash؛ raw snapshot فيDomain authorized store.
- Name: قدتظهر فقط إذاالغرض يحتاجها، وإلاCustomerId.

## 55. Subject privacy requests

Audit records قدتحتويPseudonymous identifiers لازمة للأمن والامتثال. عندanonymization:

- لايمحى السجل عشوائيًا.
- يراجع legal basis/retention.
- تقلل direct identifiers حيثمسموح.
- تحفظ روابط المستندات والـLedgers القانونية.
- يسجل anonymization action نفسها.

# القسم السادس عشر — Integrity and Tamper Resistance

## 56. كتابة السجل

### داخل نفسtransaction عند

- High-risk state transition داخلنفسstorage boundary.
- Permission/approval decision حرج.
- Ledger posting.

### Durable asynchronous مسموح عند

- Access telemetry عاليالحجم.
- External provider evidence afterlocal transition.
- Operational detection.

لكن يجب وجودDurable handoff وعدمفقد السجل عندcrash.

## 57. Tamper controls baseline

- Append-only storage permissions.
- Separate writer andreader roles.
- No UPDATE/DELETE للتطبيق العادي.
- Sequence numbers perpartition.
- Record hashes وoptional hash chaining.
- Periodic signed checkpoints.
- Backup/replication.
- Integrity verification jobs.
- Alert on gap, rewrite orclock anomaly.
- WORM/archive tier للـCritical classes عنداعتمادarchitecture.
- Database administrators لايملكونsilent modification path؛ كلrepair audited.

## 58. Clock integrity

- Server UTC authoritative forRecordedAt.
- Device OccurredAt محفوظ لكنmarked trusted/untrusted حسبdrift/signature.
- Provider timestamp evidence منفصلة.
- Time correction لا يعيد كتابةrecords.

## 59. Audit write failure policy

### Critical mutation

Fail closed أويدخلDurable safe queue قبلإرجاعsuccess، حسبtransaction architecture.

### Noncritical read/access telemetry

قديستمر الطلب معalert وbuffer durable، إذاpolicy تسمح.

### ممنوع

إرجاعsuccess لOwner/Role change أوPayment reconciliation override أوLegal Hold إذا لايوجدAudit evidence durable.

# القسم السابع عشر — Retention Classes

## 60. Retention class model

### AUD-R1 — Critical legal/financial/security

Owner transfer، ledgers، payment reconciliation، legal hold، tenant closure، support break-glass، destructive disposition.

### AUD-R2 — High-risk business administration

Role/scope، price/tax changes، inventory adjustments، cash discrepancy، supplier banking، billing overrides.

### AUD-R3 — Standard business actions

Product changes، PO lifecycle، customer status، report definitions.

### AUD-R4 — Access andauthentication activity

Sign-ins، sensitive views، searches، downloads، device telemetry.

### AUD-R5 — Operational health

Delivery retries، projection lag، nonbusiness diagnostics.

المدد الرقمية لا تحسم قبلLegal/Regulatory/Data Classification Blueprint. كلClass تحدد:

- minimum retention.
- maximum retention.
- archive tier.
- legal hold behavior.
- anonymization rules.
- deletion approval.

## 61. Retention invariants

- Legal Hold يوقفdestruction.
- Dedup/correlation evidence لا تحذف قبلالفترة اللازمة للتحقيق.
- Audit export artifact لايحتفظ بمدة السجلات الأصلية؛ ينتهي أسرع.
- Backup ليسRetention archive.
- حذفTenant لا يحذفCritical audit فورًا.

# القسم الثامن عشر — Monitoring and Detection

## 62. Audit-derived detections

- Repeated denied permissions.
- Cross-tenant access attempts.
- Unusual sensitive exports.
- Refund/void spikes.
- Frequent price overrides.
- Inventory adjustment anomalies.
- Cash discrepancy patterns.
- Multiple failed MFA/recovery attempts.
- Device reuse orrevoked lease activity.
- Support access outsideapproved window.
- Entitlement overrides nearingexpiry.
- Audit integrity gaps.

Detection alert ليستحكمًا نهائيًا؛ ترتبط بالسجلات المصدرية والتحقيق.

## 63. Audit health metrics

- audit write success rate.
- critical action withoutaudit count = zero target.
- write latency.
- integrity verification failures.
- sequence gaps.
- records missing actor/context.
- redaction failures.
- export volumes.
- support access sessions open pastexpiry.
- audit backlog/lag.

# القسم التاسع عشر — Correlation and Investigation

## 64. Correlation keys

كلتحقيق يجب أنيستطيع الربط بين:

- AuditId.
- CommandId.
- IdempotencyKey hash.
- CorrelationId/CausationId.
- Workflow/ProcessInstanceId.
- AggregateId/Version.
- Domain/Integration EventIds.
- Provider references masked.
- DocumentId.
- Device/Terminal/Shift.
- ApprovalId.
- Support access grant.

## 65. Investigation timeline

الـTimeline ترتب حسبRecordedAt وتعرضOccurredAt/EffectiveAt منفصلًا. لا تفترضأنDevice/provider times تعنيorder النهائي.

### Investigation view must show

- actor chain.
- permissions/policies.
- state transition.
- approvals.
- external evidence.
- partial outcomes.
- recovery actions.
- correction/compensation.

# القسم العشرون — Testing Contract

## 66. Audit producer tests

1. Critical command writesAudit داخلdurable boundary.
2. Duplicate command لاينتجتغييرًا ثانيًا، ويعيد/يربطAudit outcome المناسبة.
3. Denied action سجلتreason/policy version.
4. Actor وEffective Actor صحيحان.
5. Support action لا تظهر كcustomer self-action.
6. Before/After redaction صحيحة.
7. Secrets/PII المحظورة غيرموجودة.
8. TenantId/Scope صحيحان.
9. Command/Event correlation كاملة.
10. Offline occurred/recorded times محفوظة.
11. Unknown provider outcome سجلتUnknown.
12. Partial process سجلPartial وليسFailed عام.

## 67. Integrity tests

1. UPDATE/DELETE blocked forapp role.
2. Sequence/hash validation.
3. Gap detection.
4. Backup/restore preservesrecords/integrity metadata.
5. Archive verification.
6. Legal Hold blocks disposition.
7. Clock anomaly handling.
8. Audit write failure policy.

## 68. Access tests

1. Tenant isolation.
2. Location-scoped auditor limitations.
3. Restricted record redaction.
4. Cross-tenant query denial.
5. Support grant expiry.
6. Step-up foraudit export.
7. Export row/field scoping.
8. Audit search itself logged.
9. Audit export download logged.
10. Revoked membership cannotreadcached audit.

## 69. Domain scenario tests

- Owner transfer full actor/approval/before-after chain.
- Payment unknown → reconciliation → manual override.
- Offline Sale accepted withdevice/lease evidence.
- Stock adjustment approval andmovement reference.
- Return posted ثمRefund failed دونخلط outcomes.
- Shift provisional/final close timeline.
- Customer merge preserveshistorical IDs.
- Support views customer PII withinapproved case.
- Legal Hold prevents deletion.
- Tenant closure andreactivation window.
- Entitlement override expires automatically withAudit.
- Event replay repairs projection دونduplicate side effect.

# القسم الحادي والعشرون — Open Decisions

## 70. OD-AUD-001 — Audit storage architecture

Append-only relational tables، dedicated immutable store، أوWORM archive؟

**Baseline:** logical append-only contract الآن؛ physical architecture فيDatabase/Security Blueprint، معseparate writer permissions وintegrity checks.

## 71. OD-AUD-002 — Full diff vsselected evidence

**Baseline:** selected redacted diff +hashes +references. Full snapshots فقطللحقول الآمنة والحالات القانونية المبررة.

## 72. OD-AUD-003 — Read access granularity

**Baseline:** audit كلsensitive/bulk/support access؛ aggregate routine low-risk reads معsession/access telemetry لتجنبحجم غيرقابل للإدارة.

## 73. OD-AUD-004 — IP retention

تحدد فيPrivacy/Security Blueprint حسبjurisdiction. Baseline: protected/masked andshorter retention thancritical business audit.

## 74. OD-AUD-005 — Hash chaining partition

**Baseline:** perTenant أوperstream signed checkpoints، دونادعاءglobal chain حتىيحسمperformance/recovery design.

## 75. OD-AUD-006 — Audit availability toTenant

**Baseline:** Tenant يرىrecords المتعلقةبموارده وActors، معRedaction platform/security internals. Platform support لايملكunbounded view.

## 76. OD-AUD-007 — Failed authentication volume

**Baseline:** detailed short-term security telemetry +normalized longer-lived security records/detections، معrate andprivacy controls.

## 77. OD-AUD-008 — Country-specific legal duration

مؤجل للـLegal/Data Retention Blueprint؛ لا نثبت مددًا رقمية بلاjurisdiction.

# القسم الثاني والعشرون — Prohibited Patterns

## 78. أنماط ممنوعة

- Mutable `updated_by` كبديل audit history.
- حذف Audit عندحذفbusiness record.
- Shared admin account.
- Support impersonation بلاReal Actor.
- تخزينpassword/token/raw card data.
- `action = updated` دونfield/target/decision.
- Free-text reason فقط دونReasonCode.
- Success record بلاCommand/Event correlation.
- Audit فيApplication log فقط.
- Audit write best-effort فيOwner transfer/payment override/legal hold.
- Cross-tenant export بلاApproval.
- Direct DB fix بلاrepair command وAudit.
- تغييرAudit record بعدالتحقيق.
- إخفاءdenied high-risk actions.
- اعتبارAudit record مصدرbalance أوstatus التجاري.
- الاحتفاظ بـAudit export للأبد.

# القسم الثالث والعشرون — Acceptance Gate

## 79. بوابة الاعتماد

لا يعتبر Audit Catalog مكتملًا قبل:

1. تعريف Actor وEffective Actor وSupport/Service/System identities.
2. تعريف Audit Record schema وOutcome model.
3. تحديد High-risk action catalog لكلContext.
4. تحديد Denied-action policy.
5. تحديد Before/After وRedaction rules.
6. ربط Commands وWorkflows وEvents وApprovals.
7. تحديد Audit access وcross-tenant restrictions.
8. تحديد Support/Break-glass lifecycle.
9. تحديد Integrity وwrite-failure behavior.
10. تحديد Retention classes وLegal Hold behavior.
11. تحديد Audit search/export controls.
12. تحديد Offline/provider evidence.
13. Contract/integrity/access tests.
14. عدموجودSecrets أوPII غيرمبررة.
15. إثبات أنCritical mutations لا تنجح بلاDurable audit.

## 80. القرار التخطيطي الحالي

- تم تعريف أكثر من180 Audit action key عبركلContexts.
- الـAudit منفصلة عنDomain Events وApplication logs.
- Real Actor وEffective Actor وApprover يسجلون منفصلين.
- Support وBreak-glass access مؤقتة، scoped، ومدققة.
- Critical actions تسجلحتىعندالرفض.
- Before/After evidence redacted ومحدودة، معhash/reference عندالحاجة.
- Provider raw payload خارجAudit record فيRestricted evidence store.
- Audit append-only معintegrity verification وseparate permissions.
- قراءة/بحث/تصديرAudit الحساسة Actions مدققة بذاتها.
- لا مدد رقمية قبلتحديدjurisdiction وData Retention policy.

## 81. المرحلة التالية

**ATHR Permission Matrix v1.0**

ستثبت:

- Permission keys.
- Resource andscope model.
- Role templates.
- Tenant/Location/Warehouse/Terminal scope.
- Sensitive read permissions.
- Create/update/approve/post/void/refund/export distinctions.
- Separation of Duties.
- Step-up requirements.
- Entitlement intersection.
- Offline authorization.
- Support andbreak-glass permissions.
- Denial andAudit behavior.

بعدها: **ATHR API Contract ثمError Catalog**.