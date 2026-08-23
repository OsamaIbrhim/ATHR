# ATHR Permission Matrix v1.0

**Planning Baseline — Permission Keys, Scope, Roles, Separation of Duties and Runtime Authorization**

## 1. وظيفة الوثيقة

تحدد هذه الوثيقة عقد التفويض Authorization في ATHR، وتثبت:

- Permission keys الثابتة.
- Resource وAction لكلPermission.
- أنواع الـScope.
- ما إذا كانتPermission Read أوCreate أوUpdate أوApprove أوPost أوCorrect أوExport.
- درجة الخطورة.
- متطلبات Step-up وApproval.
- القيود المعتمدة علىالحالة والمبلغ والملكية.
- Separation of Duties.
- تقاطع Permissions معSubscription Entitlements.
- سياسات Offline Authorization.
- Support وBreak-glass permissions.
- Denial وAudit behavior.
- Role templates كبداية، دونربط الـPermission باسمRole ثابت.

هذه الوثيقة لا تحدد API tokens أوIdentity-provider implementation أوواجهة إدارة الأدوار.

## 2. معادلة السماح

```
ALLOW =
IdentityActive
AND MembershipActive
AND TenantAccessModeAllows
AND ResourceTenantMatches
AND ScopeMatches
AND PermissionGranted
AND PermissionConstraintsPass
AND EntitlementAllows
AND ResourceStateAllows
AND AuthenticationStrengthSufficient
AND ApprovalSatisfiedWhenRequired
AND DeviceAndChannelTrustedWhenRequired
AND NoExplicitDeny
```

أيشرط مفقود ينتج Deny. لا يوجدImplicit allow.

## 3. مبادئ إلزامية

1. Default deny.
2. Permission key لا تتضمناسمRole.
3. Role تجمع Permissions فقط؛ لا تصبحBusiness rule.
4. Scope فارغة أومفقودة لاتعنيTenant-wide.
5. Home Location ليستAccess grant.
6. Permission لا تتجاوزTenant boundary.
7. Entitlement لا يمنحPermission.
8. Permission لا تتجاوزEntitlement غيرفعال.
9. UI hiding ليستAuthorization control.
10. كلCommand تعيدالتفويض علىالخادم.
11. Read وExport وDownload وShare Permissions منفصلة.
12. Create وApprove وPost وVoid وRefund وCorrect منفصلة.
13. Self-approval ممنوعة عندSeparation rule.
14. Support access لا تستخدمTenant roles مباشرة بلاSupport grant.
15. Offline lease تحملsubset محدودًا ومؤقتًا منالصلاحيات.
16. تغييرRole/Scope يبطلclaims والـOffline leases وفقversion.
17. High-risk deny والـAllow يسجلان فيAudit.
18. Resource state وOwnership وAmount limits جزء منPolicy constraints، لاPermission key عشوائية لكلقيمة.
19. Service accounts تستخدمPermissions وScopes مستقلة، لاحساب موظف مشترك.
20. Platform operator لا يملكCross-tenant access افتراضيًا.

## 4. Permission Key Standard

النمط:

`<domain>.<resource>.<action>`

أمثلة:

- `sales.sale.create`
- `sales.sale.complete`
- `payments.refund.approve`
- `inventory.adjustment.post`
- `reports.sales.export`
- `tenant.membership.scope.manage`

### Actions القياسية

- `view`
- `view-sensitive`
- `list`
- `search`
- `create`
- `update`
- `archive`
- `submit`
- `approve`
- `reject`
- `post`
- `complete`
- `cancel`
- `void`
- `correct`
- `reconcile`
- `override`
- `export`
- `download`
- `share`
- `manage`
- `assign`
- `impersonate`
- `break-glass`

## 5. Scope Model

### Tenant Scope

ينطبق علىكلمواردTenant، ويمنح صراحة فقط.

### Legal Entity Scope

لمواردكيان قانوني محدد.

### Business Unit Scope

Extension scope؛ لايستخدم فيMVP إلاإذااعتمدت الوحدات.

### Location Scope

لموقع أوعدة مواقع محددة.

### Warehouse Scope

لمخزن أوعدة مخازن؛ لايستنتج دائمًا منLocation.

### Terminal Scope

لجهازPOS محدد أوTerminal group.

### Shift Scope

صلاحية مرتبطة بالوردية الحالية؛ لا تمنح عبرRole دائمة وحدها.

### Own-Record Scope

للسجلات التي أنشأها أوأسندت للمستخدم، ولا تستخدم للـFinancial posting دونقواعد إضافية.

### Assigned-Task Scope

لحالات approvals/investigations المخصصة.

### Customer Segment Scope

لايعتمد مبدئيًا للتفويض الأساسي؛ قد يستخدم لPrivacy/portfolio rules لاحقًا.

### Support Grant Scope

Tenant +Resources +Actions +Purpose +Expiry.

## 6. Scope Matching Rules

- TenantId يجب أنيطابقMembership tenant دائمًا.
- Location permission لا تطابقLocation أخرى بسببنفسLegalEntity.
- Warehouse permission تحتاجWarehouse ID صريح أوinheritance policy معتمدة.
- Terminal operation تحتاجTerminal assignment وLocation scope وactive terminal.
- Cross-location transfer تحتاجSource وDestination scopes أوPermission خاصة.
- Tenant-wide scope لا تنتج منقائمة Locations الحالية.
- إضافةLocation جديدة لا تدخل تلقائيًا فيRoleAssignment ذاتexplicit locations.
- `all_current_and_future_locations` Scope type منفصلة High-risk، وليستEmpty list.
- Effective-dated scopes تدقق عندOccurredAt للـOffline وعندRecordedAt وفقpolicy.

## 7. Permission Metadata

كلPermission Catalog entry تحتوي:

- Key.
- Domain owner.
- Resource type.
- Action.
- Allowed scope types.
- Risk level.
- Authentication level.
- Approval policy key optional.
- Offline eligibility.
- Entitlement key optional.
- Audit allow/deny requirements.
- Mutually exclusive permissions.
- Default role templates.
- Deprecation version.

## 8. Authentication Strength

### A0 — Existing session

للـLow-risk reads والعمليات الروتينية.

### A1 — Recent primary authentication

للتغييرات المتوسطة.

### A2 — MFA / Step-up

للـHigh-risk المالية والصلاحيات والExports.

### A3 — Strong step-up + independent approval

للـCritical actions مثلOwner transfer وBreak-glass وLegal Hold release.

الـStep-up لا تمنحPermission؛ تؤكد مستوىالثقة فقط.

## 9. Approval Classes

- **P0:** لاApproval.
- **P1:** Manager approval عندthreshold/policy.
- **P2:** Independent approver مختلف عنRequester.
- **P3:** Dual approval منوظيفتين مختلفتين.
- **P4:** Platform/Legal/Security controlled approval.

## 10. Risk Classes

- **L:** منخفض.
- **M:** متوسط.
- **H:** مرتفع.
- **C:** حرج.

# القسم الأول — Platform Identity, Tenant and Authorization

## 11. Identity Permissions

| Permission | Scope | Risk/Auth | Approval/Notes |
| --- | --- | --- | --- |
| `identity.profile.view-self` | Self | L/A0 | Own profile فقط |
| `identity.profile.update-self` | Self | M/A1 | Contact changes need verification |
| `identity.security.manage-self` | Self | H/A2 | MFA/credentials/session revocation |
| `identity.security.view-tenant-members` | Tenant | H/A2 | Masked security status |
| `identity.suspension.request` | Tenant | H/A2 | P1/P2 bypolicy |
| `identity.suspension.execute` | Platform/Security | C/A3 | Not normal tenant role |

## 12. Tenant and Organization Permissions

- `tenant.profile.view`
- `tenant.profile.update`
- `tenant.configuration.view`
- `tenant.configuration.update`
- `tenant.access-mode.view`
- `tenant.access-mode.change`
- `tenant.owner.transfer-request`
- `tenant.owner.transfer-approve`
- `tenant.owner.transfer-execute`
- `tenant.closure.request`
- `tenant.closure.cancel`
- `tenant.closure.approve`
- `tenant.closure.execute`
- `legal-entity.view`
- `legal-entity.create`
- `legal-entity.update`
- `legal-entity.archive`
- `location.view`
- `location.create`
- `location.update`
- `location.open`
- `location.restrict`
- `location.close`
- `warehouse.view`
- `warehouse.create`
- `warehouse.update`
- `warehouse.close`

### Critical constraints

- Owner transfer: Requester ≠ final Approver؛ A3؛P2 أوP3.
- Tenant closure: لايجمع نفسالشخص request + approve + irreversible execute فيEnterprise policy.
- Location close يحتاجguards علىshifts/stock/open documents، وليسPermission فقط.

## 13. Membership and Role Permissions

- `tenant.membership.view`
- `tenant.membership.view-sensitive`
- `tenant.membership.invite`
- `tenant.membership.resend-invitation`
- `tenant.membership.revoke-invitation`
- `tenant.membership.suspend`
- `tenant.membership.reinstate`
- `tenant.membership.offboard`
- `tenant.membership.role.assign`
- `tenant.membership.role.revoke`
- `tenant.membership.scope.manage`
- `tenant.membership.home-location.change`
- `tenant.role.view`
- `tenant.role.create`
- `tenant.role.update`
- `tenant.role.archive`
- `tenant.role.permission.manage`
- `tenant.role.tenant-wide-scope.assign`

### Constraints

- لايجوز للمستخدمرفعصلاحياته أوScope الخاصة به مباشرة.
- منحPermission أعلىمنصلاحياتالمانح يحتاجDelegation policy أوOwner/Admin role.
- `tenant.role.tenant-wide-scope.assign` H/A2/P2.
- آخرOwner لايمكنتعطيله أوإزالةOwner role منه.

## 14. Approval Permissions

- `approval.request.view-own`
- `approval.request.view-assigned`
- `approval.request.view-all-in-scope`
- `approval.request.create`
- `approval.request.approve`
- `approval.request.reject`
- `approval.request.cancel-own`
- `approval.request.reassign`
- `approval.policy.view`
- `approval.policy.manage`

Approver يجبأنيمتلكPermission الخاصةبالعملية بالإضافة إلى`approval.request.approve` إذاpolicy تطلبذلك.

# القسم الثاني — Devices, Terminals and Offline

## 15. Device and Terminal Permissions

- `device.view`
- `device.enroll`
- `device.restrict`
- `device.revoke`
- `device.rotate-key`
- `device.retire`
- `terminal.view`
- `terminal.view-health`
- `terminal.provision`
- `terminal.activate`
- `terminal.block`
- `terminal.maintenance.manage`
- `terminal.location-reassign-request`
- `terminal.location-reassign-approve`
- `terminal.location-reassign-execute`
- `terminal.peripheral.manage`
- `terminal.retire`
- `offline-lease.view`
- `offline-lease.issue`
- `offline-lease.revoke`
- `offline-lease.policy.manage`

### Constraints

- Device revoke H/A2؛ Terminal reassignment H/A2/P1 عندunsynced/open shift.
- Lease issuer لايمنح Permissions غيرموجودة فيMembership أوEntitlement.
- Local terminal admin لايمنح نفسهTenant permissions.

# القسم الثالث — Catalog, Pricing, Tax and Promotions

## 16. Product Catalog Permissions

- `catalog.product.view`
- `catalog.product.view-cost-sensitive`
- `catalog.product.create`
- `catalog.product.update`
- `catalog.product.activate`
- `catalog.product.restrict`
- `catalog.product.discontinue`
- `catalog.product.archive`
- `catalog.variant.create`
- `catalog.variant.update`
- `catalog.variant.sellability-manage`
- `catalog.identifier.assign`
- `catalog.identifier.retire`
- `catalog.identifier.reuse-approve`
- `catalog.uom.view`
- `catalog.uom.create`
- `catalog.uom.update`
- `catalog.uom-conversion.publish`
- `catalog.category.manage`
- `catalog.brand.manage`
- `catalog.assortment.view`
- `catalog.assortment.manage`
- `catalog.bundle.manage`
- `catalog.import.preview`
- `catalog.import.execute`
- `catalog.export`

### Constraints

- Identifier reuse C/A3/P2؛ baseline policy قدتمنع حتىمعPermission.
- Historical UOM change H/A2/P1.
- Cost-sensitive read منفصلة عنProduct view.

## 17. Pricing Permissions

- `pricing.price-book.view`
- `pricing.price-book.create`
- `pricing.price-book.update-draft`
- `pricing.price-book.submit`
- `pricing.price-book.approve`
- `pricing.price-book.schedule`
- `pricing.price-book.activate`
- `pricing.price-book.end`
- `pricing.price-entry.manage`
- `pricing.cost.view`
- `pricing.margin.view`
- `pricing.floor.configure`
- `pricing.manual-override.apply`
- `pricing.manual-override.approve`
- `pricing.manual-override.above-threshold`
- `pricing.export`

### Separation

- Creator ofprice book لايوافقنفسها إذاpolicy P2.
- Cashier manual override ضمنlimit قدP0/P1؛ below-floor دائمًاApproval منفصلة.

## 18. Tax Permissions

- `tax.code.view`
- `tax.rule.create`
- `tax.rule.update-draft`
- `tax.rule.submit`
- `tax.rule.approve`
- `tax.rule.schedule`
- `tax.rule.activate`
- `tax.rule.supersede`
- `tax.exemption.apply`
- `tax.exemption.approve`
- `tax.calculation.override`
- `tax.export`

Tax rule activation H/A2/P2. Manual tax override C/A3 وقدتمنع بالكامل حسبjurisdiction.

## 19. Promotion and Coupon Permissions

- `promotion.view`
- `promotion.create`
- `promotion.update-draft`
- `promotion.submit`
- `promotion.approve`
- `promotion.schedule`
- `promotion.activate`
- `promotion.pause`
- `promotion.resume`
- `promotion.end`
- `promotion.simulate`
- `coupon.campaign.create`
- `coupon.code.generate`
- `coupon.code.view-sensitive`
- `coupon.usage.view`
- `coupon.redemption.override`
- `coupon.export-codes`

Raw coupon export C/A3/P2 ومشفّر ومؤقت.

# القسم الرابع — Sales and Payments

## 20. Sales Permissions

- `sales.sale.view`
- `sales.sale.view-all-in-scope`
- `sales.sale.create`
- `sales.sale.update-draft`
- `sales.sale.attach-customer`
- `sales.sale.apply-line-discount`
- `sales.sale.apply-order-discount`
- `sales.sale.apply-manual-price`
- `sales.sale.apply-tax-exemption`
- `sales.sale.suspend`
- `sales.sale.resume-own`
- `sales.sale.resume-any-in-scope`
- `sales.sale.cancel-draft-own`
- `sales.sale.cancel-draft-any`
- `sales.sale.request-payment`
- `sales.sale.complete`
- `sales.sale.view-cost-margin`
- `sales.sale.view-profit`
- `sales.sale.view-offline-exceptions`
- `sales.sale.resolve-offline-exception`
- `sales.sale.reprint-receipt`

### Constraints

- Complete تحتاجactive Terminal/Shift حسبchannel.
- Discount/price permissions تحملmax percentage/amount، floor policy وapproval threshold.
- Resume-any لايعنيفتحCompleted sale.
- Reprint منفصلة عنview/complete.

## 21. Payment Permissions

- `payments.payment.view`
- `payments.payment.view-provider-details`
- `payments.payment.initiate`
- `payments.cash.accept`
- `payments.electronic.initiate`
- `payments.payment.allocate`
- `payments.payment.release-allocation`
- `payments.payment.void-authorization`
- `payments.payment.reverse`
- `payments.reconciliation.view`
- `payments.reconciliation.start`
- `payments.reconciliation.resolve-evidence`
- `payments.reconciliation.manual-override-request`
- `payments.reconciliation.manual-override-approve`
- `payments.reconciliation.manual-override-execute`
- `payments.provider-config.view`
- `payments.provider-config.manage`

### Critical controls

- Manual reconciliation override C/A3/P2 أوP3.
- Provider configuration change C/A3/P2.
- Raw provider evidence Restricted.

## 22. Refund Permissions

- `refunds.refund.view`
- `refunds.refund.request`
- `refunds.refund.approve`
- `refunds.refund.execute-original-method`
- `refunds.refund.execute-cash`
- `refunds.refund.execute-store-credit`
- `refunds.refund.alternate-method-request`
- `refunds.refund.alternate-method-approve`
- `refunds.refund.retry-temporary-failure`
- `refunds.refund.reconcile-unknown`
- `refunds.refund.resolve-liability`

### Constraints

- Requester ≠ Approver عندthreshold.
- Cash refund تحتاجshift/drawer scope وcash limit.
- Alternate method H/A2/P2.
- Permission لا تتجاوزremaining refundable value.

# القسم الخامس — Inventory, Transfers and Purchasing

## 23. Inventory Permissions

- `inventory.position.view`
- `inventory.position.view-cost`
- `inventory.movement.view`
- `inventory.movement.post-standard`
- `inventory.adjustment.request`
- `inventory.adjustment.approve`
- `inventory.adjustment.post`
- `inventory.adjustment.correct`
- `inventory.negative-stock.override-request`
- `inventory.negative-stock.override-approve`
- `inventory.batch.manage`
- `inventory.serial.manage`
- `inventory.quarantine.manage`
- `inventory.availability.export`
- `inventory.ledger.export`

### Separation

Requester/Counter لايوافق أوينشر adjustment الخاصبه عندP2.

### Constraints

- Post permission تحتاجWarehouse scope.
- Cost read منفصلة.
- Direct balance edit لايوجدلهاPermission.

## 24. Transfer Permissions

- `transfer.view`
- `transfer.create`
- `transfer.update-draft`
- `transfer.submit`
- `transfer.approve`
- `transfer.reject`
- `transfer.cancel-before-shipment`
- `transfer.ship`
- `transfer.receive`
- `transfer.record-discrepancy`
- `transfer.resolve-discrepancy`
- `transfer.close`
- `transfer.export`

### Scope rules

- Create تحتاجSource scope؛ Destination selectable only ifaccessible/authorized policy.
- Ship تحتاجSource warehouse scope.
- Receive تحتاجDestination warehouse scope.
- Approve cross-location قدتحتاجboth أوTenant-level permission.
- نفسالشخص لايشحن ويستلم نفسTransfer عندSoD policy.

## 25. Stock Count Permissions

- `stock-count.view`
- `stock-count.create`
- `stock-count.schedule`
- `stock-count.start`
- `stock-count.record-observation`
- `stock-count.view-expected`
- `stock-count.submit`
- `stock-count.request-recount`
- `stock-count.approve`
- `stock-count.post-adjustment`
- `stock-count.cancel`
- `stock-count.export`

Blind counter لايملك`view-expected` قبلsubmission. Counter ≠ Approver/Post actor حسبpolicy.

## 26. Supplier Permissions

- `supplier.view`
- `supplier.view-sensitive`
- `supplier.create`
- `supplier.update`
- `supplier.payment-terms.manage`
- `supplier.bank-details.view`
- `supplier.bank-details.change-request`
- `supplier.bank-details.change-approve`
- `supplier.restrict`
- `supplier.archive`
- `supplier.export`

Bank details C/A3/P2 وdual control موصى به.

## 27. Purchasing Permissions

- `purchasing.requisition.view`
- `purchasing.requisition.create`
- `purchasing.requisition.submit`
- `purchasing.requisition.approve`
- `purchasing.rfq.manage`
- `purchasing.quote.view`
- `purchasing.purchase-order.view`
- `purchasing.purchase-order.create`
- `purchasing.purchase-order.update-draft`
- `purchasing.purchase-order.submit`
- `purchasing.purchase-order.approve`
- `purchasing.purchase-order.reject`
- `purchasing.purchase-order.revise`
- `purchasing.purchase-order.cancel`
- `purchasing.purchase-order.send`
- `purchasing.goods-receipt.view`
- `purchasing.goods-receipt.create`
- `purchasing.goods-receipt.inspect`
- `purchasing.goods-receipt.post`
- `purchasing.goods-receipt.resolve-exception`
- `purchasing.supplier-invoice.view`
- `purchasing.supplier-invoice.record`
- `purchasing.supplier-invoice.match`
- `purchasing.supplier-invoice.override-match-exception`
- `purchasing.supplier-invoice.approve`
- `purchasing.supplier-liability.post`
- `purchasing.supplier-return.create`
- `purchasing.supplier-return.approve`
- `purchasing.supplier-return.post`
- `purchasing.export`

### SoD baseline

- PO creator ≠ final approver above threshold.
- Receiver ≠ Supplier invoice approver whenstrong control enabled.
- Match exception override ≠ invoice recorder.
- Supplier bank changer ≠ supplier payment approver.

# القسم السادس — Returns, Customers and Value Ledgers

## 28. Return and Exchange Permissions

- `returns.return.view`
- `returns.return.request`
- `returns.return.evaluate-eligibility`
- `returns.return.approve-standard`
- `returns.return.approve-window-exception`
- `returns.return.approve-no-receipt`
- `returns.return.receive-item`
- `returns.return.inspect`
- `returns.return.decide-disposition`
- `returns.return.calculate-valuation`
- `returns.return.override-valuation`
- `returns.return.post`
- `returns.return.resolve-inventory-exception`
- `exchange.exchange.create`
- `exchange.exchange.complete`
- `void.transaction.request`
- `void.transaction.approve`
- `void.transaction.execute`

No-receipt وvaluation override وVoid H/C حسبamount، معStep-up/Approval.

## 29. Customer Permissions

- `customer.profile.view`
- `customer.profile.view-sensitive`
- `customer.profile.search`
- `customer.profile.bulk-search`
- `customer.profile.create`
- `customer.profile.update`
- `customer.contact.update`
- `customer.status.restrict`
- `customer.status.block`
- `customer.status.deactivate`
- `customer.merge.request`
- `customer.merge.approve`
- `customer.merge.execute`
- `customer.anonymization.request`
- `customer.anonymization.approve`
- `customer.anonymization.execute`
- `customer.privacy-export.request`
- `customer.privacy-export.execute`
- `customer.export`

Sensitive/bulk/export permissions مستقلة، وCustomer ID لايعطيAccess وحده.

## 30. Consent Permissions

- `customer.consent.view`
- `customer.consent.record-grant`
- `customer.consent.record-withdrawal`
- `customer.consent.policy.manage`
- `customer.communication.send-operational`
- `customer.communication.send-marketing`

Marketing permission تحتاجConsent/Preference checks؛ وجودPermission لايتجاوزwithdrawal.

## 31. Receivables Permissions

- `receivables.account.view`
- `receivables.account.view-sensitive`
- `receivables.credit-limit.request`
- `receivables.credit-limit.approve`
- `receivables.credit-limit.change`
- `receivables.entry.post`
- `receivables.payment.allocate`
- `receivables.dispute.manage`
- `receivables.adjustment.request`
- `receivables.adjustment.approve`
- `receivables.adjustment.post`
- `receivables.write-off.request`
- `receivables.write-off.approve`
- `receivables.write-off.post`
- `receivables.export`

Credit limit/write-off H/A2/P2. Customer verification andbalance constraints still apply.

## 32. Store Credit Permissions

- `store-credit.account.view`
- `store-credit.issue`
- `store-credit.reserve`
- `store-credit.redeem`
- `store-credit.expire`
- `store-credit.correction.request`
- `store-credit.correction.approve`
- `store-credit.correction.post`
- `store-credit.export`

لا توجدPermission لتعديلbalance مباشرة.

## 33. Loyalty Permissions

- `loyalty.account.view`
- `loyalty.points.earn`
- `loyalty.points.reserve`
- `loyalty.points.redeem`
- `loyalty.points.reverse`
- `loyalty.points.expire`
- `loyalty.adjustment.request`
- `loyalty.adjustment.approve`
- `loyalty.adjustment.post`
- `loyalty.tier.manage-policy`
- `loyalty.export`

# القسم السابع — Shift, Cash and Terminal Operations

## 34. Shift Permissions

- `shift.view`
- `shift.open-own`
- `shift.open-for-other`
- `shift.suspend-own`
- `shift.resume-own`
- `shift.close-own`
- `shift.close-for-other`
- `shift.view-pending-operations`
- `shift.provisional-close`
- `shift.finalize-close`
- `shift.resolve-close-exception`
- `shift.view-history`
- `shift.export`

Open/Close تحتاجTerminal/Location scope. Finalize close قدتحتاجseparate manager عندdiscrepancy.

## 35. Cash Permissions

- `cash.drawer.view-expected`
- `cash.drawer.open-no-sale`
- `cash.opening-float.record`
- `cash.cash-in.request`
- `cash.cash-in.post`
- `cash.cash-out.request`
- `cash.cash-out.approve`
- `cash.cash-out.post`
- `cash.safe-drop.post`
- `cash.safe-pickup.post`
- `cash.count.submit`
- `cash.count.view-expected-after-submit`
- `cash.recount.request`
- `cash.discrepancy.view`
- `cash.discrepancy.approve`
- `cash.discrepancy.resolve`
- `cash.handover.execute`
- `cash.ledger.view`
- `cash.ledger.export`

### SoD

- Cashier لايرىExpected قبلblind count إذاpolicy.
- Cashier لايوافق discrepancy الخاصةبه.
- Cash-out above threshold يحتاجP2.

# القسم الثامن — Documents, Notifications, Reporting and Audit

## 36. Document Permissions

- `documents.document.view`
- `documents.document.view-sensitive`
- `documents.document.issue-manual-request`
- `documents.document.correct-request`
- `documents.document.correct-approve`
- `documents.document.download`
- `documents.document.print`
- `documents.document.reprint`
- `documents.document.email`
- `documents.document.share-link-create`
- `documents.template.view`
- `documents.template.create`
- `documents.template.update-draft`
- `documents.template.publish`
- `documents.number-sequence.manage`

Number sequence andtemplate publication H/A2/P1/P2.

## 37. Notification Permissions

- `notifications.notification.view`
- `notifications.notification.resend`
- `notifications.rule.view`
- `notifications.rule.manage`
- `notifications.template.view`
- `notifications.template.manage`
- `notifications.delivery.view-provider-status`
- `notifications.recipient.override`

Recipient override H/A2 ويخضعPurpose/Consent.

## 38. Reporting Permissions

Permissions منفصلة بحسبDomain والعملية:

- `reports.sales.view`
- `reports.sales.view-cost-margin`
- `reports.sales.export`
- `reports.payments.view`
- `reports.payments.export`
- `reports.inventory.view`
- `reports.inventory.view-cost`
- `reports.inventory.export`
- `reports.purchasing.view`
- `reports.purchasing.export`
- `reports.cash.view`
- `reports.cash.export`
- `reports.customers.view`
- `reports.customers.view-sensitive`
- `reports.customers.export`
- `reports.billing.view`
- `reports.billing.export`
- `reports.security.view`
- `reports.security.export`
- `reports.definition.manage`
- `reports.schedule.manage`
- `reports.schedule.manage-recipients`

View لايعنيExport. Export لايعنيShare externally.

## 39. Export Permissions العامة

- `exports.job.request`
- `exports.job.approve`
- `exports.job.download-own`
- `exports.job.download-any-in-scope`
- `exports.job.cancel`
- `exports.job.delete-early`
- `exports.cross-location.request`
- `exports.cross-tenant.request`

Cross-tenant ليستTenant role؛ Platform compliance only، C/A3/P4.

## 40. Audit Permissions

- `audit.records.view-standard`
- `audit.records.view-financial`
- `audit.records.view-security`
- `audit.records.view-privacy`
- `audit.records.view-support`
- `audit.records.search`
- `audit.records.view-restricted`
- `audit.records.export-request`
- `audit.records.export-approve`
- `audit.records.export-download`
- `audit.integrity.view`
- `audit.integrity.run-check`
- `audit.correction.record`

قراءةRestricted Audit نفسها مدققة. لاPermission لتعديل/حذفrecord.

# القسم التاسع — SaaS Billing and Entitlements

## 41. Tenant Billing Permissions

- `billing.account.view`
- `billing.account.update-contact`
- `billing.payment-method.view-masked`
- `billing.payment-method.manage`
- `billing.invoice.view`
- `billing.invoice.download`
- `billing.subscription.view`
- `billing.subscription.start-trial`
- `billing.subscription.upgrade-request`
- `billing.subscription.downgrade-schedule`
- `billing.subscription.cancel-schedule`
- `billing.subscription.cancel-revoke`
- `billing.subscription.reactivate-request`

## 42. Platform Commercial Permissions

- `platform-billing.plan.view`
- `platform-billing.plan.create`
- `platform-billing.plan-version.publish`
- `platform-billing.plan-price.manage`
- `platform-billing.discount.manage`
- `platform-billing.subscription.view-any`
- `platform-billing.subscription.override-request`
- `platform-billing.subscription.override-approve`
- `platform-billing.subscription.override-execute`
- `platform-billing.manual-payment.record`
- `platform-billing.manual-payment.approve`
- `platform-billing.account-credit.issue`
- `platform-billing.refund.execute`
- `platform-billing.dunning.manage`

Platform permissions لا تمنحTenant business data access تلقائيًا.

## 43. Entitlement Permissions

- `entitlements.set.view`
- `entitlements.limit.view`
- `entitlements.override.request`
- `entitlements.override.approve`
- `entitlements.override.grant`
- `entitlements.override.revoke`
- `entitlements.compiler.rebuild`

Temporary override C/A3/P2 معExpiry إلزامي.

# القسم العاشر — Privacy, Retention, Legal and Operations

## 44. Privacy Permissions

- `privacy.request.view`
- `privacy.request.assign`
- `privacy.request.verify-subject`
- `privacy.request.approve`
- `privacy.export.execute`
- `privacy.anonymization.execute`
- `privacy.request.close`
- `privacy.policy.manage`

Requester verification ≠ final destructive execution عندhigh-risk.

## 45. Legal Hold and Retention Permissions

- `legal-hold.view`
- `legal-hold.create`
- `legal-hold.approve`
- `legal-hold.activate`
- `legal-hold.change-scope`
- `legal-hold.release-request`
- `legal-hold.release-approve`
- `legal-hold.release-execute`
- `retention.policy.view`
- `retention.policy.manage`
- `retention.disposition.preview`
- `retention.disposition.approve`
- `retention.disposition.execute`
- `retention.disposition.retry`
- `retention.disposition.view-evidence`

Legal Hold release وdestructive disposition C/A3/P3/P4.

## 46. Recovery and Operations Permissions

- `recovery.exception.view`
- `recovery.exception.assign`
- `recovery.exception.resolve`
- `recovery.event-replay.request`
- `recovery.event-replay.approve`
- `recovery.event-replay.execute`
- `recovery.projection-rebuild.request`
- `recovery.projection-rebuild.execute`
- `recovery.data-repair.request`
- `recovery.data-repair.approve`
- `recovery.data-repair.execute`
- `operations.configuration.view`
- `operations.configuration.manage`
- `operations.feature-flag.manage`
- `operations.production-access.request`
- `operations.production-access.approve`
- `operations.production-access.use`
- `operations.backup.view`
- `operations.restore.request`
- `operations.restore.approve`
- `operations.restore.execute`

Data repair/restore C/A3/P3، وكلهاPlatform operations لاTenant roles.

# القسم الحادي عشر — Support and Break-glass

## 47. Support Permissions

- `support.tenant.lookup-minimal`
- `support.case.view-assigned`
- `support.access.request-read`
- `support.access.request-write`
- `support.access.approve`
- `support.access.start`
- `support.access.view-resource`
- `support.access.execute-approved-action`
- `support.access.end`
- `support.break-glass.request`
- `support.break-glass.approve`
- `support.break-glass.use`
- `support.break-glass.review`

### Support authorization formula

Platform support identity +assigned case +active SupportGrant +resource/action scope +purpose +expiry +step-up +tenant/contract consent where required.

### Prohibited

- Unbounded `support.admin`.
- Reusing tenant Owner permissions.
- Write access fromread grant.
- Continuing afterexpiry.
- Acting ascustomer withoutReal Actor evidence.

# القسم الثاني عشر — Role Templates

## 48. Tenant Owner

Baseline grants:

- Tenant configuration andmembership administration.
- Broad reporting/business visibility.
- Subscription self-service.

Not automatically granted:

- Payment reconciliation override.
- Legal Hold/destructive retention.
- Platform billing operations.
- Provider secrets.
- Unrestricted support orcross-tenant access.

## 49. Tenant Administrator

Membership/location/configuration ضمنassigned scope، لكنOwner transfer وclosure final execution مستثناة افتراضيًا.

## 50. Store Manager

Location-scoped:

- Sales oversight.
- Refund/void approvals withinlimits.
- Shift/cash discrepancy approvals.
- Local inventory/purchasing approvals.
- Reports forlocation.

No tenant-wide role management أوplatform billing.

## 51. Cashier

- Create/update/complete Sales.
- Accept allowed tenders.
- Own shift/drawer operations.
- Standard return request حسبpolicy.
- Reprint withinlimit.

No final refunds above limit، inventory adjustments، cost/margin views، role management، exports.

## 52. Inventory Clerk

Warehouse-scoped viewing، transfers/count observations، receipt handling. لاapproval/posting high-risk افتراضيًا.

## 53. Inventory Manager

Approvals/posting/discrepancies/cost reports ضمنwarehouse scope، معSoD ضدown counts/requests.

## 54. Purchasing Agent

Supplier/PO creation، RFQ، receipt visibility. لاfinal approval أوsupplier bank approval.

## 55. Purchasing Manager

PO/invoice exception approvals، supplier returns، purchasing reports ضمنscope.

## 56. Finance Manager

Payments/refunds/receivables/cash/billing reports، لكنprovider config وmanual reconciliation override تحتاجصلاحيات إضافية.

## 57. Accountant/Auditor

Read/report/export حسبgrant؛ لاBusiness posting افتراضيًا لتجنبconflict.

## 58. Customer Service

Customer/return/refund cases ضمنlimits، دونbulk PII export أوcredit write-off.

## 59. Privacy Officer

Privacy requests، consent، anonymization approvals، restricted customer audit ضمنscope.

## 60. Security Administrator

Membership security، devices، sessions، security audit؛ لاBusiness financial posting.

## 61. Read-only Analyst

Reports فقط حسبDomains/data classes؛ لاraw sensitive records أوexports إلامنح منفصل.

## 62. Role Template Rules

- Templates قابلةللنسخ، وليستRoles hard-coded.
- Custom role changes versioned/audited.
- Template update لا تغيرexisting roles تلقائيًا.
- No wildcard `*` فيTenant custom roles مبدئيًا.
- Explicit denies قدتستخدم فقطللحالاتالمركبة بحذر؛ baseline relies onallow lists.

# القسم الثالث عشر — Separation of Duties Matrix

## 63. Mandatory SoD pairs

| Requester/Executor | Must differ from | Condition |
| --- | --- | --- |
| Owner transfer requester | Final approver | Always |
| Role/scope change requester forself | Approver/executor | Privilege increase |
| Price book creator | Approver | Above policy threshold |
| Stock adjustment requester/counter | Approver | Material variance |
| Transfer shipper | Receiver | High-control policy |
| PO creator | Final approver | Above threshold |
| Supplier bank changer | Approver/payment executor | Always |
| Supplier invoice recorder | Match exception approver | Exception |
| Refund requester | Approver | Above threshold/alternate method |
| Cashier/counter | Cash discrepancy approver | Own shift |
| Payment reconciliation investigator | Manual override approver | Critical override |
| Legal Hold creator | Release approver | Always |
| Disposition executor | Final approver | Destructive action |
| Support user | Support grant approver | Write/break-glass |

## 64. SoD enforcement

- Evaluated byidentity، وليسdisplay name.
- Different sessions لنفسidentity لا تحققSoD.
- Service acting on behalf inheritsrequester identity forconflict checks.
- Emergency override createsCritical audit andpost-review، ولايلغيconflict silently.

# القسم الرابع عشر — Entitlement Intersection

## 65. Rules

- Permission answers **may this actor perform action?**
- Entitlement answers **does tenant subscription include capability/capacity?**
- Business rule answers **is action valid now forresource?**

### أمثلة

- User has `catalog.product.create` butproduct limit reached → Deny `ENTITLEMENT_LIMIT_REACHED`.
- User has `reports.sales.export` butplan lacksadvanced exports → Deny entitlement.
- Plan hasrefund feature butcashier lacks`refunds.refund.execute-cash` → Deny permission.
- Tenant suspended → AccessMode maydeny both even ifpermission andentitlement exist.

## 66. Entitlement-linked permission groups

- Multi-location management.
- Additional terminals.
- Advanced promotions.
- Loyalty/Store Credit.
- Credit sales/Receivables.
- Advanced reports/exports.
- API/integrations.
- Offline operation capability.
- Audit retention tier.
- Support tier features.

Entitlement key mapping يثبت لاحقًا فيBilling/API Contracts.

# القسم الخامس عشر — Offline Authorization

## 67. Offline eligible permissions baseline

- `sales.sale.create`
- `sales.sale.update-draft`
- `sales.sale.complete` forcash-only andvalid lease.
- `payments.cash.accept`
- `cash.opening-float.record`
- limited `cash.cash-in.post` / `cash.cash-out.post` belowpolicy limits.
- `stock-count.record-observation` forassigned count.
- `documents.document.print` fromtrusted snapshot.

## 68. Online-required permissions

- Membership/role/scope changes.
- Device/terminal reassignment.
- Electronic payments/refunds.
- Store Credit/Loyalty redemption.
- Credit Sale.
- Final Return/Refund posting.
- Transfer approval/shipment/receipt baseline.
- Price/tax/promotion publication.
- Sensitive exports.
- Provider configuration.
- Subscription/entitlement changes.
- Legal Hold/Retention/Tenant closure.
- Support andBreak-glass.

## 69. Offline lease constraints

- Permission subset explicit.
- Location/Terminal/Shift scope.
- Effective/expiry times.
- Monetary/discount/cash limits.
- Catalog/price/tax versions.
- Entitlement version.
- Authorization version.
- Device binding/signature.
- Revocation version.

Server يعيدتقييم العملية عندSync. Lease لا تضمنقبولأيعملية خرقتInvariant أوبدأت بعدrevocation effective time وفقpolicy.

# القسم السادس عشر — Read, Search, Export and Data Classification

## 70. Read levels

### Standard view

الحقول التشغيلية الضرورية.

### Sensitive view

PII، costs، margins، payment evidence، bank details، security data.

### Bulk search

الوصول لعددكبير منrecords، Permission منفصلة حتىلويمكنعرضrecord فردي.

### Export

استخراج خارجواجهة النظام، Permission وApproval وartifact controls منفصلة.

### Share

إتاحة artifact لطرفآخر، Permission أخرى وغرض وexpiry.

## 71. Field-level policy

Permission Matrix تحددclass، بينماAPI/Reporting contracts تحددfield mapping. أمثلة:

- Customer standard: name/masked contact.
- Customer sensitive: full authorized contact/address.
- Payment standard: amount/status/method.
- Payment sensitive: masked provider refs/evidence.
- Inventory standard: quantities.
- Inventory cost: cost layers/valuation.
- Sales standard: totals.
- Sales margin: costs/margins.

# القسم السابع عشر — Authorization Decision Contract

## 72. Inputs

- Identity/session.
- Membership andstatus.
- Role assignments andscope.
- Permission key.
- Resource tenant/location/warehouse/terminal.
- Resource owner/creator andstate.
- Request channel/device/lease.
- Authentication strength/recent step-up.
- Entitlement set/version/limits.
- Approval references.
- Amount/quantity/discount thresholds.
- Time/effective policy.

## 73. Output

```json
{
  "decision": "allow|deny|challenge|approval-required",
  "permission_key": "refunds.refund.execute-cash",
  "reason_code": "STEP_UP_REQUIRED",
  "policy_version": "opaque-version",
  "matched_scope_ids": ["opaque-id"],
  "required_authentication_level": "A2",
  "required_approval_policy": "refund.cash.high-value",
  "entitlement_version": "opaque-version",
  "decision_id": "opaque-id"
}
```

لايعيدالقرار معلومات تكشف صلاحياتأوScopes غيرمصرح للمستخدم بمعرفتها.

## 74. Denial precedence

لمنعinformation leakage، قدتعيدAPI denial عامًاللمستخدم، بينماAudit تحفظالسبب الدقيق. ترتيبداخلي مقترح:

1. Authentication.
2. Tenant/resource existence concealment.
3. Membership/status.
4. Scope.
5. Permission.
6. Entitlement.
7. State/business guards.
8. Step-up/approval challenge.

الترتيب النهائي فيError/API Contract.

# القسم الثامن عشر — Audit Behavior

## 75. Always audit allow and deny

- Owner/role/scope changes.
- Support/Break-glass.
- Sensitive data access/export.
- Payment/refund/reconciliation.
- Inventory/cash corrections.
- Tax/price overrides.
- Legal Hold/Retention.
- Provider configuration.
- Tenant closure.

## 76. Audit on success only oraggregated

- Routine low-risk list/search mayaggregate، إلاSensitive/bulk.
- Draft edits يمكنgrouped activity audit.
- High-volume POS line changes needstructured domain activity withoutlog spam، لكنoverrides/customer attachment/completion منفصلة.

# القسم التاسع عشر — Permission Lifecycle

## 77. Permission catalog states

`Draft → Published → Deprecated → Retired`

- Published key immutable meaning.
- تغييرالمعنى يحتاجKey أوMajor policy version جديدة.
- Deprecated keys remainreadable duringmigration.
- Retire afternoactive roles/clients.

## 78. Role assignment lifecycle

- Effective-dated.
- Versioned.
- Revocation immediate server-side.
- Session/cache/lease invalidation.
- Scheduled temporary assignments expire automatically.
- Historical assignments preserved forAudit.

# القسم العشرون — Tests

## 79. Permission catalog tests

1. Unique key andowner.
2. Allowed scope types defined.
3. Risk/auth/approval metadata complete.
4. No wildcard accidental grants.
5. Deprecated keys notused innew roles.
6. Entitlement mappings valid.

## 80. Authorization tests

1. Default deny.
2. Tenant mismatch.
3. Location/warehouse/terminal mismatch.
4. Empty scope doesnotmeanall.
5. Membership suspended.
6. Role revoked duringactive session.
7. Entitlement missing/limit reached.
8. Resource invalid state.
9. Step-up required/expired.
10. Approval missing/expired/payload changed.
11. Self-approval blocked.
12. SoD identity conflict.
13. Offline lease stale/revoked.
14. Support grant expired/outofscope.
15. Break-glass audit/review.
16. Sensitive field redaction.
17. View allowed butexport denied.
18. Read own vsreadall.
19. Amount/percentage threshold.
20. Concurrent policy version change.

## 81. Role template tests

- Cashier cannotviewcosts orapproveown discrepancy.
- Store Manager cannotmanageTenant roles bydefault.
- Purchasing Agent cannotapprove ownPO above threshold.
- Inventory counter cannotviewexpected beforesubmit.
- Finance Manager cannotchangeprovider config withoutspecialgrant.
- Auditor cannotpostbusiness transactions.
- Tenant Owner cannotuseplatform cross-tenant permissions.
- Support cannotact withoutactivegrant.

# القسم الحادي والعشرون — Open Decisions

## 82. OD-PERM-001 — Explicit deny support

**Baseline:** Allow-list only forMVP. Explicit deny يضاف فقطإذاظهرتحاجة مركبة، معprecedence واضحة.

## 83. OD-PERM-002 — Role inheritance

**Baseline:** لاrole inheritance عميقة. Composition مسطحة أوtemplate copy لمنعصعوبةالتفسير.

## 84. OD-PERM-003 — Dynamic attributes

ABAC يستخدمللـresource state/amount/ownership/time، لكنPermissions وScopes تظل واضحة وقابلةللشرح. لاpolicy scripting غيرمحكوم.

## 85. OD-PERM-004 — Tenant custom roles

**Baseline:** مدعومة ضمنPublished Permission Catalog، بلاplatform/support keys وبلاwildcards.

## 86. OD-PERM-005 — Location inheritance

**Baseline:** Tenant-wide وall-current-future-locations Scope types صريحة. لااستنتاج منعدموجودLocation IDs.

## 87. OD-PERM-006 — Approval permission model

**Baseline:** Approver يحتاج`approval.request.approve` وPermission للعملية أوapproval-specific grant حسبpolicy. يحسم perworkflow فيApproval Catalog/API.

## 88. OD-PERM-007 — Field-level permissions

**Baseline:** Data-class permissions فيMatrix، والحقول التفصيلية فيAPI/Reporting contract لمنعانفجارPermission keys.

## 89. OD-PERM-008 — Emergency owner recovery

تحتاجSecurity/Identity recovery flow منفصلة؛ لاgeneric admin permission.

# القسم الثاني والعشرون — Prohibited Patterns

## 90. أنماط ممنوعة

- `isAdmin` أو`isManager` كAuthorization كاملة.
- Role name checks داخلDomain code.
- Empty scope = all.
- Frontend-only permission checks.
- Entitlement = permission.
- Permission = approval.
- `manage_all` wildcard فيcustom tenant roles.
- Shared cashier/admin users.
- Same actor request/approve/execute critical action.
- Cached permission بلاversion أوrevocation strategy.
- Offline permissions بلاexpiry أوlimits.
- Support superuser دائم.
- Read permission تمنحExport تلقائيًا.
- Update permission تمنحPost/Void/Correct.
- Tenant Owner يمنحplatform permissions.
- Direct DB role bypass.
- Error messages تكشفوجودresource عبرTenant آخر.
- Permission key meaning يتغير بصمت.

# القسم الثالث والعشرون — Acceptance Gate

## 91. بوابة الاعتماد

لا تعتبر Permission Matrix مكتملة قبل:

1. Permission key لكلCommand وSensitive query فيWorkflows.
2. تحديدScope types لكلPermission.
3. فصلRead/Create/Update/Approve/Post/Correct/Export.
4. تحديدRisk وStep-up وApproval.
5. تحديدSoD conflicts.
6. ربطPermissions بالEntitlements دونخلطهما.
7. تحديدOffline eligibility والlimits.
8. تعريفSupport/Break-glass grants.
9. تعريفRole templates وحدودها.
10. تعريفSensitive/bulk/export access.
11. تحديدAudit allow/deny behavior.
12. Contract tests للـTenant isolation وscope والrevocation.
13. عدموجودwildcards أوempty-scope escalation.
14. ربطكلPermission بالWorkflow/Command/Resource owner.
15. تثبيتAuthorization decision contract.

## 92. القرار التخطيطي الحالي

- تم تعريف أكثر من260 Permission key أولية.
- Authorization Default-deny وServer-side.
- Role names لا تستخدم داخلDomain rules.
- Scope مفقودة لاتعنيTenant-wide.
- View وSensitive View وBulk Search وExport وShare منفصلة.
- Permission وEntitlement وBusiness Guard وApproval طبقات مستقلة.
- Critical actions تخضعStep-up وSeparation of Duties.
- Offline leases تحملsubset محدودًا ومؤقتًا معlimits وversions.
- Support لايملكSuperuser دائمًا، ويعملبGrant مؤقتة ومحددة.
- Custom roles لايمكنهاالحصول علىPlatform/Support permissions.

## 93. المرحلة التالية

**ATHR API Contract v1.0**

سيثبت:

- API styles andresource boundaries.
- Command vsQuery endpoints.
- Request/response envelopes.
- Idempotency andconcurrency headers.
- Authentication andtenant context.
- Permission mapping.
- Pagination/filtering/sorting/search.
- Money/quantity/time formats.
- Long-running operations.
- Async workflows andstatus resources.
- Webhooks andexternal integration boundary.
- Versioning/deprecation.
- Validation andpartial-result rules.

بعده: **ATHR Error Catalog v1.0**.