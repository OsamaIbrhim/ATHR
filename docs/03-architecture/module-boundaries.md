# ATHR Module Boundaries v1.0

**Status:** Approved engineering-design baseline

**Applies to:** ATHR Backend modular monolith, Admin, POS, shared packages, database ownership, workers, sync/offline and cross-context integrations.

## 1. Purpose

تحدد هذه الوثيقة الحدود التنفيذية الدقيقة بين Modules وBounded Contexts في ATHR. الهدف هو منع تضخم الـmodular monolith إلى كتلة مترابطة، ومنع أيContext من امتلاك أو تعديل حقائق Context آخر.

## 2. Governing Principles

1. لكل حقيقة تشغيلية Owner واحد فقط.
2. Aggregate Root هي بوابة التعديل الوحيدة داخلContext.
3. لا Context يكتبفي Repository أوTable أوLedger مملوكة لContext آخر.
4. Cross-context work يستخدمCommands إلىOwner أوEvents بعدCommit.
5. لاDistributed Transaction بينContexts.
6. Read models وprojections ليستمصدر حقيقة.
7. Sync وReporting وDocuments لايمتلكون الحقائق التجارية الأصلية.
8. Tenant boundary إلزامية فيكلmodule تشغيلي.
9. Module public API أصغر منinternal implementation.
10. Module boundary تُفرض بالكود والاختبارات، لابالتسمية فقط.

## 3. Standard Module Shape

كلBackend module جديد أوmodule يتمإعادةهيكلته يتجه إلى:

```
backend/src/<module>/
├── domain/
│   ├── aggregates/
│   ├── entities/
│   ├── value-objects/
│   ├── policies/
│   ├── events/
│   └── ports/
├── application/
│   ├── commands/
│   ├── queries/
│   ├── handlers/
│   ├── services/
│   └── dto/
├── infrastructure/
│   ├── persistence/
│   ├── providers/
│   ├── messaging/
│   └── projections/
├── delivery/
│   ├── http/
│   ├── worker/
│   └── scheduler/
├── public.ts
└── module.ts
```

`public.ts` هوالمدخل المسموح للمستهلكين داخلBackend. الاستيراد منinternal paths خارجmodule ممنوع.

## 4. Platform Identity & Authentication

**Owns:**

- PlatformIdentity.
- authentication methods andverified contacts.
- sessions, refresh-token families, MFA/recovery challenges.
- identity suspension andcredential rotation metadata.

**Exposes:**

- authenticate identity.
- issue/revoke/recheck session.
- resolveactor identity claim.
- verify step-up/MFA result.
- identity-status events.

**Consumes:**

- device risk/trust claims.
- membership revocation notification forsession re-evaluation.

**Must not own:**

- tenant membership.
- roles andpermissions.
- terminal assignment.
- cashier shift.

## 5. Tenant Organization & Membership

**Owns:**

- Tenant, LegalEntity, Location, Warehouse.
- Membership, scope assignment, invitations andownership transfer.
- tenant access mode asorganizational state input.

**Exposes:**

- tenant/location/warehouse existence andstatus checks.
- membership activation/suspension.
- scope resolution.
- organizational snapshots fordocuments.

**Consumes:**

- PlatformIdentity status.
- subscription access-mode changes.

**Must not own:**

- permission evaluation logic.
- inventory balances.
- terminal device credentials.
- SaaS invoice/payment facts.

## 6. Authorization Policy

**Owns:**

- stable permission catalog.
- role definitions andgrants.
- policies, constraints, approval rules andapproval requests.
- authorization decision logic anddecision version.

**Exposes:**

- authorize(actor, action, resource, scope, context).
- approval requirement/decision.
- policy version anddeny reason.

**Consumes:**

- identity/session claims.
- membership/scopes.
- tenant access mode.
- device/terminal trust.
- entitlement snapshot.

**Must not own:**

- identity lifecycle.
- memberships.
- business aggregate state.
- UI menu definitions asauthority.

## 7. Device, Terminal & Offline Trust

**Owns:**

- RegisteredDevice anddevice-key metadata.
- Terminal identity, location assignment andperipheral binding.
- enrollment andrevocation.
- OfflineAuthorizationLease.
- terminal heartbeat/health projection.
- device sync cursor registration metadata whereoperational.

**Exposes:**

- device/terminal trust verification.
- enrollment/rotation/revocation commands.
- signed offline lease issue/revoke.
- terminal assignment andhealth read model.

**Consumes:**

- membership status/scopes.
- tenant access mode.
- entitlements.

**Must not own:**

- sales, shifts orcash facts.
- business sync results.
- product catalog truth.

## 8. Product Catalog

**Owns:**

- Product, Variant/SKU, barcode, category andbrand references.
- UnitOfMeasure andconversion definitions wherecatalog-owned.
- catalog lifecycle andsearch attributes.

**Exposes:**

- product/variant lookup.
- barcode resolution.
- active sellable/purchasable eligibility.
- immutable catalog snapshot data fortransactions.

**Consumes:**

- tenant/location configuration.

**Must not own:**

- price, tax orpromotion evaluation.
- inventory quantity.
- purchase cost ledger.
- sales line state.

## 9. Pricing, Tax & Promotions

**Owns:**

- PriceBook andprice versions.
- tax rules andjurisdiction/application policy.
- promotion, coupon andeligibility rules.
- evaluation engine andpublished rule versions.

**Exposes:**

- quote/evaluate snapshot forSale orReturn.
- validate coupon/promotion use.
- explain applied adjustments.

**Consumes:**

- catalog identifiers andattributes.
- tenant/location/channel/customer context.

**Must not own:**

- sale posting.
- payment collection.
- product lifecycle.
- historical sale totals afterposting.

## 10. Sales

**Owns:**

- Sale aggregate.
- SaleLine snapshots.
- holds/resumes/cancellation beforeposting.
- sale posting state, totals, numbering andhistorical commercial snapshot.
- sale idempotency andclient-operation acknowledgement.

**Exposes:**

- create/hold/resume/post/cancel sale commands.
- getSale andsale history queries.
- `SalePosted`, `SaleCancelled`, `SaleCorrected` events.

**Consumes:**

- catalog snapshot.
- pricing/tax/promotion evaluation.
- customer reference.
- shift/terminal authorization.
- inventory availability policy asquery/advisory input.

**Must not own:**

- payment outcome.
- inventory movement ledger.
- refund.
- document delivery.

## 11. Payments

**Owns:**

- Payment, PaymentAttempt andAllocation.
- payment ledger.
- provider request/evidence mapping.
- cash/noncash method outcome, unknown outcome andreconciliation state.

**Exposes:**

- initiate/record/confirm/fail/reconcile payment.
- allocate/unallocate accordingtoapproved rules.
- payment outcome andledger queries.

**Consumes:**

- sale/return/refund references andamount due.
- shift/cash context forcash movements.
- external provider callbacks.

**Must not own:**

- sale totals.
- refund business eligibility.
- cash-drawer balance.
- provider webhook transport shared concerns.

## 12. Inventory & Costing

**Owns:**

- InventoryMovement append-only ledger.
- InventoryCostMovement ledger.
- reservations, availability andon-hand projections.
- stock count/reconciliation.
- warehouse/location stock state.
- transfer inventory effects, whiletransfer workflow ownership mayremain a dedicated submodule.

**Exposes:**

- reserve/release/consume/receive/adjust/transfer commands.
- availability andstock queries.
- movement andcost history.

**Consumes:**

- sale posted/cancelled corrections.
- return disposition.
- goods receipt.
- transfer shipment/receipt.
- catalog andwarehouse references.

**Must not own:**

- sales invoice.
- purchase order lifecycle.
- refund outcome.
- supplier liability.

## 13. Transfers

**Owns:**

- Transfer aggregate andstate machine.
- approved immutable lines.
- shipment, partial receipt, discrepancy andcancellation decisions.

**Exposes:**

- draft/approve/ship/receive/cancel/discrepancy commands.
- transfer progress andin-transit queries.

**Consumes:**

- source/destination warehouse eligibility.
- inventory reservation andmovement commands.
- approval policy.

**Must not own:**

- inventory balance directly.
- warehouse master data.
- transport provider implementation unlessadapter-specific.

## 14. Purchasing & Supplier Operations

**Owns:**

- Supplier identity within tenant scope.
- PurchaseOrder.
- GoodsReceipt business record.
- SupplierInvoice andmatching/override decisions.
- supplier return workflow andliability references.

**Exposes:**

- PO lifecycle commands.
- receive/match/approve supplier documents.
- purchasing status andhistory.

**Consumes:**

- catalog/product references.
- inventory receipt commands.
- documents andapproval policy.

**Must not own:**

- inventory/cost ledgers directly.
- tenant legal entity truth.
- payment-provider mechanics.

## 15. Returns, Refunds & Exchanges

**Owns:**

- Return aggregate andeligibility decision.
- returned lines, inspection anddisposition.
- RefundRequest business intent.
- Exchange orchestration/process state.

**Exposes:**

- request/approve/post return.
- request/approve refund.
- initiate/complete exchange.

**Consumes:**

- original sale snapshot.
- payment refund command/outcome.
- inventory disposition command.
- customer/store-credit command.
- replacement sale command.

**Must not own:**

- payment ledger.
- inventory movement ledger.
- original sale mutation.

## 16. Customer, Receivables, Store Credit & Loyalty

**Owns:**

- tenant-scoped Customer.
- CustomerReceivable ledger.
- StoreCredit ledger.
- LoyaltyPoints ledger andprogram version.
- customer consent/preferences wherebusiness-owned.

**Exposes:**

- customer lookup/profile update.
- post/settle receivable.
- issue/redeem/expire store credit.
- earn/redeem/expire loyalty.

**Consumes:**

- sales/returns/payment events.
- tenant policies andprivacy/retention rules.

**Must not own:**

- platform identity credentials.
- sale posting.
- payment outcome.

## 17. Shift & Cash Operations

**Owns:**

- Shift aggregate.
- cash drawer assignment andcash movement ledger.
- open/provisional-close/final-close.
- count, expected cash, discrepancy andapproval references.

**Exposes:**

- open/close/reconcile shift.
- record cash movement fromapproved sources.
- current shift/offline operational context.

**Consumes:**

- terminal andoperator scope.
- cash payment/refund events.
- approval decisions.

**Must not own:**

- payment ledger.
- terminal identity.
- sale totals.

## 18. Documents

**Owns:**

- document artifact metadata.
- document template/version reference.
- immutable generated receipt/invoice/export artifact.
- numbering allocation wherelegally/document-owned.

**Exposes:**

- generate/regenerate-corrected/retrieve document.
- artifact hash, storage reference andretention metadata.

**Consumes:**

- immutable snapshots/events fromsales, payments, returns, purchasing andbilling.

**Must not own:**

- source transaction business state.
- notification delivery state.

## 19. Notifications & Webhooks

**Owns:**

- notification intent routing state.
- template publication metadata.
- delivery attempts, provider evidence andoutcome.
- webhook subscriptions anddelivery attempts.

**Exposes:**

- route/schedule/cancel notification whereallowed.
- delivery status andprovider reconciliation.

**Consumes:**

- domain/integration events.
- recipient preferences andsecure links.

**Must not own:**

- domain truth communicated bynotification.
- user identity credentials.

## 20. Reporting

**Owns:**

- report definitions andversions.
- report runs, export jobs andfreshness metadata.
- projections/materializations used forreporting.

**Exposes:**

- run/export/status/download report.
- metric definition andfreshness/completeness state.

**Consumes:**

- immutable source records andintegration events.

**Must not own:**

- financial/inventory/customer operational facts.
- permission source.

## 21. Audit, Retention & Compliance

**Owns:**

- immutable audit records.
- retention policies andexecution evidence.
- legal hold anddestruction workflow.

**Exposes:**

- append/query audit evidence.
- evaluate/execute retention underowner constraints.

**Consumes:**

- security/business events.
- data classification andlegal policies.

**Must not own:**

- business aggregate state.
- authorization decision itself, exceptits audit evidence.

## 22. SaaS Billing, Subscription & Entitlements

**Owns:**

- PlanVersion, PriceVersion.
- Subscription andbilling period.
- SaaS Invoice/Payment evidence.
- entitlement snapshot andtenant access-mode recommendation.

**Exposes:**

- create/change/cancel subscription.
- entitlement evaluation.
- billing invoice/payment/reconciliation.

**Consumes:**

- tenant identity andlegal billing profile.
- external billing provider evidence.

**Must not own:**

- retail sales/payments.
- operational tenant data.
- direct mutation ofbusiness aggregates.

## 23. Sync & Offline Coordination

**Owns:**

- sync envelope, cursor, manifest andchunk metadata.
- operation-upload batch andoperation result ledger.
- deduplication, conflict envelope andresync state.
- local protocol compatibility metadata.

**Exposes:**

- bootstrap/pull/push/resync protocol.
- per-operation outcome andcursor advancement.

**Consumes:**

- owner-context commands.
- owner-context projections/events.
- device/offline lease verification.

**Must not own:**

- sale, payment, inventory, shift orcustomer business results.
- business invariants.

## 24. Integration Infrastructure

Transactional outbox, inbox/deduplication, job leases andprovider adapters areinfrastructure capabilities. Their persistence maybecentralized technically, butlogical ownership remainswiththepublishing/consuming context.

## 25. Cross-Context Transaction Rules

- Default: one aggregate transaction.
- Same-context multi-aggregate transaction requiresdocumented invariant andsmall boundary.
- Cross-context orchestration usesprocess manager/Saga.
- Everyexternal side effect occurs aftercommit orwithoutcome reconciliation.
- Outbox event andaggregate mutation commit together.
- Consumer inbox/dedupe commit withconsumer state change.

## 26. Command Routing Rules

A module may:

- call itsown application service directly.
- invoke anothermodule onlythroughits public command/query interface.
- publish integration event aftercommit.

A module may not:

- instantiate anothermodule repository.
- call anothermodule internal service.
- update anothermodule table directly.
- depend onanothermodule Prisma model asdomain type.

## 27. Query Rules

- Strong invariant queries readowner state.
- Cross-context UI queries useAPI composition orprojection.
- Reporting andsearch useprojections.
- A projection cannotauthorize acritical mutation unlesspolicy explicitlydefines safe bounded staleness.

## 28. Event Rules

- Domain events remaininsideowner context unlessmapped.
- Integration events areversioned, privacy-filtered andstable.
- Event names arepast-tense facts.
- Consumers neverrepublish owner event astheir ownfact.
- Ordering guarantee isper aggregate/stream unlesscontract statesotherwise.

## 29. Public Module Contract

كلmodule يعلن:

- commands.
- queries.
- integration events.
- public read DTOs.
- stable error codes.
- required tenant/actor/scope context.
- idempotency andconcurrency requirements.

Internal entities, repositories andORM mappings arenotpublic.

## 30. Admin Boundary

Admin consumesBackend API contracts only. It doesnotimportBackend source, Prisma types orbusiness services. UI modules mirroruser workflows, notdatabase tables.

## 31. POS Boundary

POS renderer communicates throughnarrow typed preload IPC. Main process ownslocal DB, secure storage, networking, sync, printing andupdater. POS local records areprotocol/cache/outbox representations, notserver domain ownership.

## 32. Database Boundary

- Physical foreign keys maycross technical schemas onlywhereapproved, butdo notgrantwrite ownership.
- Composite tenant-safe references aremandatory.
- Ledgers areappend-only underowner module.
- Migration maytouch multiple technical tables onlywithowners documented andcompatibility plan.

## 33. Testing Boundary

كلmodule لديه:

- domain unit tests.
- application contract tests.
- repository/integration tests.
- public-boundary tests.
- forbidden-import tests.
- tenant-isolation tests whereowned.
- event compatibility tests forpublished contracts.

## 34. Migration from Current Repository

- Introduce public module entrypoints incrementally.
- Wrap current services behindapplication interfaces beforemoving files.
- Stop newcross-module direct Prisma writes immediately.
- Existing violations arecataloged andremoved context-by-context.
- No big-bang directory rewrite.

## 35. Acceptance Gate

هذهالوثيقة تعتبرمطبقة عندما:

- every active backend module hasdeclared owner andpublic API.
- forbidden cross-context writes aredetected.
- module graph hasno cycles.
- shared kernel excludesbusiness statuses/policies.
- Admin/POS do notimportBackend internals.
- Sync/Reporting/Documents remainnon-owner ofbusiness facts.
- tenant andauthorization context propagate atpublic boundaries.

## 36. Open Decisions

- Whether Transfers remainsinventory submodule orseparateNest module; default separate application module withinventory-owned ledgers.
- Whether Documents andNotifications shareone deployment process whilekeepingseparate logical ownership.
- Exact worker split timing.
- Exact module migration sequence afterWP-004.

## 37. Prohibited Patterns

- Shared `common/services` withbusiness logic.
- Direct cross-context repository access.
- Circular Nest module imports solved with`forwardRef` asdefault.
- Prisma model aspublic DTO.
- Reporting projection used asfinancial truth.
- Sync handler writingbusiness tables directly.
- UI authorization used asserver authority.
- One global transaction spanningunrelated contexts.

## 38. Implementation Mapping

- WP-002 establishespackages andboundary tooling.
- WP-003 definespublic API/error contracts.
- WP-004 establishesvalue objects/shared kernel.
- WP-005–WP-018 migratecontexts progressively.
- WP-024/025 hardensecurity andobservability withoutbreakingownership.

## 39. Approval Outcome

هذهالوثيقة تعتمدحدودModules التنفيذية لـATHR وتمنعأيimplementation مناختصارالتكامل عبرتعديلبياناتContext آخر.