# ATHR Database Blueprint v1.0

**Planning Baseline — PostgreSQL Context Schemas, Tenant Isolation, Ledgers, Sync, Audit, Migrations and Recovery**

## 1. وظيفة الوثيقة

تحول هذه الوثيقة الـDomain Model والـOwnership Matrix والـState Machines والـAPI/Sync/Offline contracts إلى تصميم تخزين مستهدف يحدد:

- Database platform وحدودها.
- PostgreSQL schemas حسب الـBounded Contexts.
- Aggregate tables والـLedgers والـSnapshots والـProjections.
- Tenant isolation وCross-tenant integrity.
- IDs وVersions وMoney وQuantity وTime representations.
- Transaction boundaries وConcurrency وLocking.
- Idempotency وOutbox وInbox.
- Sync change storage وOffline evidence.
- Audit وRetention وArchival.
- Indexing وSearch وPagination.
- Migration strategy منBold إلىATHR.
- شروطجاهزيةالتنفيذ والاختبارات.

هذه الوثيقة **ليستPrisma schema نهائية** وليستMigration SQL. التنفيذ يُشتق منها فيWork Packages ويخضع لاختباراتClean database وPopulated upgrade وSchema drift.

## 2. Scope

يشمل:

- Primary transactional database.
- Tenant-owned operational data.
- Platform identity and security metadata.
- Financial and inventory ledgers.
- Event, outbox, inbox and process persistence.
- Sync, offline, audit and reporting metadata.
- SaaS subscription and entitlement persistence.
- Migration and compatibility rules.

لا يشمل:

- Final report dimensions/measures؛ يحسمهاReporting Model.
- Exact billing provider schema؛ يحسمهاBilling Model.
- Notification template payloads؛ يحسمهاNotification Contract.
- Infrastructure sizing وreplicas؛ تحسمهاDeployment Architecture وPerformance Strategy.
- Country-specific fiscal/e-invoice adapter tables؛ تضافكـversioned adapter schemas بعداعتمادالدولة.

## 3. القرارات المعمارية الأساسية

### DB-DEC-001 — PostgreSQL هوالمصدر الرئيسي للحقيقة

- PostgreSQL 16+ هوالـOLTP system of record.
- Supabase PostgreSQL يمكنأن يكونالـmanaged provider الحالي.
- Railway يشغلApplication، ولا يملكحقيقةتجارية دائمة.
- POS local database هيcache + pending operations وليستبديلًا عنالسيرفر.

### DB-DEC-002 — Modular Monolith + One Primary Database

- يبدأATHR كـModular Monolith.
- Contexts منفصلة منطقيًا وتطبيقيًا داخلDatabase واحدة.
- لاMicroservices ولاDistributed database فيالنسخةالأولى.
- لاDistributed transaction.

### DB-DEC-003 — PostgreSQL schemas تعكسحدودالـContexts

الـschemas المستهدفة:

```
platform
organization
authorization
devices
catalog
pricing
sales
payments
inventory
purchasing
returns
customers
cash
documents
reporting
audit
billing
integration
```

قد تستخدمPrisma mappings أوعدةPrisma schema files فيEngineering Design. وجودSchema تقنية لا يمنحContext حقكتابةبياناتContext أخرى.

### DB-DEC-004 — SQL migrations والـconstraints هيالحكم النهائي

- Prisma يبقىORM وClient generator.
- Migration SQL committed وforward-only.
- Database constraints لا تستبدلبـapplication validation.
- Raw SQL مسموح فقطللقيود والـindexes والـfunctions التيلا يعبرعنهاPrisma بأمان.
- لا تعديل يدوي غيرموثق فيSupabase production schema.

### DB-DEC-005 — لاBlockchain

- Hash chains أوsignatures فيOffline/Audit هدفهاTamper evidence.
- لاBlockchain، لاSmart contracts، ولاDistributed ledger خارجي.

## 4. قواعدالتخزين العامة

### DB-GEN-001 — أسماءSQL

- Schemas, tables, columns, indexes وconstraints تستخدم `snake_case`.
- Prisma models تستخدمPascalCase مع`@@map` و`@map` عندالحاجة.
- أسماءالقيود صريحة ومستقرة.

### DB-GEN-002 — Primary IDs

- Primary keys مننوع`uuid`.
- IDs الحالية فيBold تظلصالحة ولا يعادترقيمها.
- السجلاتالجديدة تستخدمApplication-generated UUIDv7 عندمايدعمهاShared Kernel، معقبولUUIDv4 القديمة.
- Ledger/event/order sequences تستخدم`bigint` منفصلة عنPublic ID.
- External/provider IDs لا تستخدمPrimary key.

### DB-GEN-003 — Common aggregate columns

كلAggregate root تشغيلية تحمل عندالحاجة:

```
id uuid primary key
tenant_id uuid not null
version bigint not null
status text/enum not null
created_at timestamptz not null
created_by_membership_id uuid null
updated_at timestamptz not null
updated_by_membership_id uuid null
```

- `version` يزيدمعكلتغيير معتمد ويستخدممع`If-Match`.
- `updated_at` ليستبديلًا عنversion.
- Child entities لا تحتاجVersion مستقلة إلا إذاكانتAggregate مستقلة.

### DB-GEN-004 — Time

- كلInstant يخزن`timestamp with time zone` ويكتبUTC.
- `business_date` يخزن`date` منفصلًا.
- `occurred_at`, `recorded_at`, `effective_at` منفصلة حيثيلزم.
- Timezone تخزنIANA identifier مثل`Africa/Cairo`، وليسoffset ثابت.
- لا تعتمدالقيودالمالية علىوقتClient غيرموثوق.

### DB-GEN-005 — Money, Rates and Quantity

- لا`float`, `real` أوdouble للحساباتالتجارية.
- Money وUnit Price وCost تخزن`numeric(24,8)` + `currency_code char(3)` عندالحاجة.
- Quantity تخزن`numeric(24,6)` + `unit_of_measure_id`.
- Rates/Percentages تخزن`numeric(18,8)`.
- كلDocument مكتمل يحتفظبـrounding policy وcurrency scale snapshots.
- API يستمرفيإرسالdecimal strings.
- POS ينتقل من`REAL` إلىminor units أوdecimal-safe text حسبShared Value Objects.

### DB-GEN-006 — Lifecycle وليسGeneric Soft Delete

- لا يضاف`deleted_at` آليًا لكلجدول.
- Master data تستخدمstatus/archived_at حسبLifecycle.
- Posted ledgers, payments, documents, audits وevents لا تحذفأوتعدل.
- Ephemeral tokens, challenges, locks وtemporary uploads يجوزحذفهابعدTTL.

### DB-GEN-007 — Snapshots

كلعملية تاريخية تحتفظبما يلزم من:

- الاسم/الوصف.
- SKU/barcode.
- legal/fiscal identity.
- price/tax/promotion versions.
- actor/display name.
- currency/UOM.
- rounding and numbering policy.

Snapshot لا تحدثبعدإتمامالعملية.

## 5. Tenant Isolation

### DB-TEN-001 — TenantId صريح

كلجدول مملوكTenant يحمل`tenant_id not null`، حتى لويمكنالوصولإليه منLocation أوDocument.

لا تحمل`tenant_id` الجداولالعالمية الحقيقية فقط، مثل:

- Platform identity.
- Platform permission catalog.
- Country/currency reference catalogs.
- Provider registry metadata غيرالمملوكةلعميل.

### DB-TEN-002 — Same-tenant foreign keys

المراجع بينجداولTenant-owned تستخدمComposite integrity:

```
unique (tenant_id, id)
foreign key (tenant_id, resource_id)
  references target (tenant_id, id)
```

هذا يمنعربطSale منTenant A بـCustomer أوLocation منTenant B حتىلوفشلApplication check.

### DB-TEN-003 — Tenant-scoped uniqueness

كلUnique business key يحددScope صراحة، مثل:

- `(tenant_id, normalized_phone)` للعميل عندالسياسةالمعتمدة.
- `(tenant_id, sku)` للـSKU.
- `(tenant_id, legal_entity_id, document_type, document_number)` للمستندات.
- `(tenant_id, terminal_code)` للأجهزة.
- `(tenant_id, provider_namespace, provider_reference)` لمراجعالمزود.

لا توجدGlobal uniqueness إلا لحقيقةعالمية مقصودة مثلPlatform identity contact بعدNormalization وسياسةالخصوصية.

### DB-TEN-004 — Application enforcement أولًا، RLS دفاع إضافي

- TenantContext إلزامي فيApplication services/repositories.
- كلtenant query تحملtenant predicate.
- Unscoped repository methods ممنوعة.
- PostgreSQL RLS تضافكدفاع إضافي بعداختبارها معPrisma pooling وtransactions.
- RLS لا تستخدمبديلًا عنComposite FKs والـauthorization.
- Background/support access يستخدمService identity محددة، Scope وAudit، وليسbypass عام مخفي.

### DB-TEN-005 — Tenant closure

إغلاقTenant:

- يغيرAccess mode.
- يمنععملياتجديدة.
- لا يحذفالتاريخ.
- يبدأRetention/Export/Disposition workflows منفصلة.

## 6. Platform Identity Schema

### الجداولالرئيسية

- `platform.identities`
- `platform.identity_contacts`
- `platform.authentication_methods`
- `platform.security_factors`
- `platform.sessions`
- `platform.refresh_token_families`
- `platform.security_challenges`
- `platform.identity_risk_flags`

### قواعدحرجة

- Password/refresh/device secrets تخزنhash أوprovider reference فقط.
- Refresh token reuse يدمرالعائلة حسبالسياسة.
- Contact normalization منفصل عنdisplay value.
- Membership لا تخزنفيهذاSchema.
- تعطيلIdentity لا يحذفMembership history.

## 7. Organization and Membership Schema

### الجداولالرئيسية

- `organization.tenants`
- `organization.legal_entities`
- `organization.locations`
- `organization.warehouses`
- `organization.memberships`
- `organization.membership_scopes`
- `organization.tenant_invitations`
- `organization.ownership_transfers`
- `organization.tenant_settings_versions`

### قواعدحرجة

- Tenant أعلىData ownership boundary.
- LegalEntity/Location/Warehouse لا تنتقلبينTenants.
- Membership تربط`identity_id` العالمي بـ`tenant_id`.
- Scope فارغة لا تعنيTenant-wide.
- Ownership transfer يحملapproval evidence وpayload hash.
- Settings المنشورةVersioned وeffective-dated.

## 8. Authorization Schema

### الجداولالرئيسية

- `authorization.permission_definitions`
- `authorization.role_templates`
- `authorization.roles`
- `authorization.role_permission_grants`
- `authorization.membership_role_assignments`
- `authorization.access_policies`
- `authorization.approval_policies`
- `authorization.approval_requests`
- `authorization.approval_decisions`
- `authorization.separation_of_duties_rules`

### قواعدحرجة

- Permission key ثابتةوVersioned.
- Role اسم/تجميع وليسDomain condition.
- Assignment وScope effective-dated.
- Approval request تربطpayload hash وexpected resource version.
- Self-approval وSoD تمنعDatabase/Application constraints حيثيمكن.

## 9. Devices, Terminals and Offline Trust Schema

### الجداولالرئيسية

- `devices.registered_devices`
- `devices.device_credentials`
- `devices.terminals`
- `devices.terminal_assignments`
- `devices.peripheral_bindings`
- `devices.enrollment_tokens`
- `devices.offline_authorization_leases`
- `devices.offline_lease_capabilities`
- `devices.offline_number_allocations`
- `devices.device_clock_evidence`
- `devices.terminal_heartbeats`

### قواعدحرجة

- Credential secret لا يخزنPlaintext.
- Terminal assignment effective-dated ولا يعيدكتابةالتاريخ.
- Offline lease immutable بعدالإصدار؛ revocation سجلمنفصل أوحالةمقيدة.
- Lease تحفظpolicy/snapshot versions والحدود.
- Heartbeats Telemetry قابلةللـretention وليستمصدرصلاحية منفرد.

## 10. Catalog Schema

### الجداولالرئيسية

- `catalog.products`
- `catalog.product_variants`
- `catalog.categories`
- `catalog.brands`
- `catalog.identifiers`
- `catalog.units_of_measure`
- `catalog.unit_conversions`
- `catalog.product_uom_assignments`
- `catalog.product_media`
- `catalog.catalog_versions`
- `catalog.location_assortments`

### قواعدحرجة

- SKU/barcode uniqueness داخلTenant ونوعIdentifier.
- Product/Variant state صريحة.
- Conversion graph تمنعالدورات أوالتحويلالغامض.
- Published catalog versions immutable.
- Media binary خارجPostgreSQL؛ الجدول يخزنmetadata/checksum/storage reference.

## 11. Pricing, Tax and Promotions Schema

### الجداولالرئيسية

- `pricing.price_books`
- `pricing.price_book_versions`
- `pricing.price_entries`
- `pricing.tax_policies`
- `pricing.tax_rule_versions`
- `pricing.promotions`
- `pricing.promotion_versions`
- `pricing.promotion_rules`
- `pricing.coupons`
- `pricing.coupon_reservations`
- `pricing.promotion_usage`

### قواعدحرجة

- Published versions immutable.
- Effective periods داخلنفسScope لا تتداخلإلا بسياسةأولوية صريحة.
- Sale لا تعتمدJoin حي؛ تخزنpricing/tax/promotion snapshots.
- Coupon reservation وredemption idempotent.
- Usage counters projection/ledger حسبنوعالحد، ولا تحدثبـblind increment.

## 12. Sales Schema

### الجداولالرئيسية

- `sales.sales`
- `sales.sale_lines`
- `sales.sale_adjustments`
- `sales.sale_totals`
- `sales.sale_state_transitions`
- `sales.sale_completion_records`
- `sales.sale_number_allocations`
- `sales.sale_corrections`

### قواعدحرجة

- Sale aggregate state machine صريحة.
- Line snapshots immutable بعدCompletion.
- Totals server-owned ومثبتةبcurrency/rounding snapshots.
- Completion idempotent ولا يعادفتحSale completed.
- Payment وInventory ليستOwned هنا؛ تحفظreferences/process state فقط.
- Correction لا تعدلCompleted sale؛ تنشئrecord معاكس/مرتبط.

## 13. Payments Schema

### الجداولالرئيسية

- `payments.payments`
- `payments.payment_attempts`
- `payments.payment_allocations`
- `payments.payment_ledger_entries`
- `payments.refunds`
- `payments.refund_attempts`
- `payments.provider_events`
- `payments.provider_reconciliation_cases`
- `payments.payment_method_configurations`

### قواعدحرجة

- Payment ledger append-only.
- Provider outcome `unknown` حالةصريحة.
- Provider event dedupe علىnamespace + external event ID.
- Same idempotency key + different payload conflict.
- Refund لا يتجاوزالـeligible allocation.
- Raw provider payload مشفر/مقيد أوObject Storage حسبالحاجة، ولا يظهرللعميل.

## 14. Inventory and Transfers Schema

### الجداولالرئيسية

- `inventory.inventory_accounts`
- `inventory.inventory_movement_entries`
- `inventory.inventory_balance_projections`
- `inventory.inventory_reservations`
- `inventory.inventory_cost_entries`
- `inventory.inventory_cost_projections`
- `inventory.stock_counts`
- `inventory.stock_count_lines`
- `inventory.stock_count_observations`
- `inventory.stock_reconciliations`
- `inventory.transfers`
- `inventory.transfer_lines`
- `inventory.transfer_commands`
- `inventory.transfer_transit_entries`
- `inventory.transfer_discrepancies`

### قواعدحرجة

- Movement وCost ledgers append-only ومصدرالحقيقة.
- Balance tables projections/materialized state قابلةلإعادةالبناء.
- كلEntry تحملsource type/id/line/idempotency key.
- Available = on hand - active reservations حسبالسياسة.
- لاDirect update للرصيد دونLedger entry داخلنفسTransaction.
- Approved transfer lines immutable.
- Shipment/receipt/discrepancy entries deduplicated.
- Negative-stock policy صريحةومسجلة؛ لا تنتجCost value وهمية.

## 15. Purchasing Schema

### الجداولالرئيسية

- `purchasing.suppliers`
- `purchasing.supplier_sites`
- `purchasing.supplier_bank_details`
- `purchasing.purchase_orders`
- `purchasing.purchase_order_lines`
- `purchasing.goods_receipts`
- `purchasing.goods_receipt_lines`
- `purchasing.supplier_invoices`
- `purchasing.supplier_invoice_lines`
- `purchasing.match_results`
- `purchasing.supplier_returns`
- `purchasing.supplier_return_lines`

### قواعدحرجة

- PO, Receipt وSupplierInvoice Aggregates منفصلة.
- Approved PO lines immutable.
- Receipt لا يتجاوزالمسموح إلاPolicy/Approval صريحة.
- Supplier invoice uniqueness tenant + supplier + normalized reference.
- Bank detail changes high-risk وeffective-dated.
- Cost movement reference محفوظبدقة لكلReceipt/Return line.

## 16. Returns, Refunds and Exchanges Schema

### الجداولالرئيسية

- `returns.returns`
- `returns.return_lines`
- `returns.return_eligibility_snapshots`
- `returns.return_inspections`
- `returns.return_dispositions`
- `returns.exchange_processes`
- `returns.return_settlement_links`

### قواعدحرجة

- Posted return لا يعنيRefund success.
- Eligible quantity محسوبةمنOriginal sale line ناقصposted returns.
- Concurrent returns تستخدمlocking/unique source consumption constraints.
- Inspection/disposition evidence immutable بعدالقرار.
- Exchange يربطReturn + replacement Sale + settlement دونDistributed transaction.

## 17. Customers, Receivables, Store Credit and Loyalty Schema

### الجداولالرئيسية

- `customers.customers`
- `customers.customer_contacts`
- `customers.customer_merge_records`
- `customers.customer_consents`
- `customers.receivable_accounts`
- `customers.receivable_ledger_entries`
- `customers.store_credit_accounts`
- `customers.store_credit_ledger_entries`
- `customers.store_credit_reservations`
- `customers.loyalty_accounts`
- `customers.loyalty_ledger_entries`
- `customers.loyalty_reservations`

### قواعدحرجة

- Customer identity tenant-scoped.
- Merge لا يحذفالمصدر؛ يسجلcanonical mapping.
- Receivable/StoreCredit/Loyalty balances مشتقةمنLedgers.
- Reservation لهاexpiry وidempotency.
- Consent effective-dated وpurpose-scoped.

## 18. Shift and Cash Schema

### الجداولالرئيسية

- `cash.shifts`
- `cash.shift_assignments`
- `cash.cash_drawers`
- `cash.drawer_assignments`
- `cash.cash_movement_entries`
- `cash.cash_count_sessions`
- `cash.cash_count_lines`
- `cash.shift_reconciliations`
- `cash.shift_close_approvals`

### قواعدحرجة

- Open-shift uniqueness حسبTerminal/Drawer/Location policy باستخدامPartial unique index.
- Cash movement ledger append-only.
- Provisional close منفصلةعنFinal close.
- Final close يتطلبمزامنة/تسويةكلعملياتOffline المطلوبة.
- Difference لا تعدلمباشرة؛ تنتجreconciliation/approval evidence.

## 19. Documents and Notifications Schema

### الجداولالرئيسية

- `documents.document_records`
- `documents.document_versions`
- `documents.document_number_sequences`
- `documents.render_jobs`
- `documents.delivery_jobs`
- `documents.notification_requests`
- `documents.notification_attempts`
- `documents.webhook_endpoints`
- `documents.webhook_deliveries`
- `documents.file_objects`

### قواعدحرجة

- Binary files فيObject Storage؛ PostgreSQL يحتفظmetadata/checksum.
- Issued document version immutable.
- Number allocation transaction-safe وscope-aware.
- Delivery retries لا تعيدإصدارالمستند.
- Webhook delivery at-least-once وdeduplicated byevent/delivery IDs.

## 20. Reporting, Audit and Retention Schema

### الجداولالرئيسية

- `reporting.report_definitions`
- `reporting.report_runs`
- `reporting.export_jobs`
- `reporting.projection_checkpoints`
- `reporting.operational_projections_*`
- `audit.audit_records`
- `audit.security_signals`
- `audit.legal_holds`
- `audit.retention_policies`
- `audit.disposition_jobs`
- `audit.disposition_evidence`

### قواعدحرجة

- Projection ليستSource of truth.
- Audit append-only ولا يسمحUpdate/Delete عبرApplication role.
- Audit details allow-listed ولا تحتويSecrets.
- Legal hold يمنعDisposition بالـdatabase guard/workflow.
- Export file مؤقت ولهexpiry/download limits.
- Exact reporting star/dimension design ينتظرReporting Model.

## 21. Billing and Entitlements Schema

### الجداولالرئيسية

- `billing.plans`
- `billing.plan_versions`
- `billing.plan_entitlements`
- `billing.subscriptions`
- `billing.subscription_changes`
- `billing.billing_accounts`
- `billing.billing_invoices`
- `billing.billing_payment_attempts`
- `billing.entitlement_snapshots`
- `billing.usage_counters`

### قواعدحرجة

- Published plan versions immutable.
- Subscription state machine صريحة.
- Entitlement snapshot input للAuthorization، وليستPermission.
- Provider outcome unknown/reconciliation مثلPayments.
- Tenant operational data لا تحذفبسببPast due؛ Access mode يتغير.

## 22. Integration, Idempotency and Process Schema

### الجداولالرئيسية

- `integration.command_idempotency_records`
- `integration.outbox_messages`
- `integration.inbox_messages`
- `integration.process_instances`
- `integration.process_steps`
- `integration.async_operations`
- `integration.provider_callback_receipts`
- `integration.dead_letter_records`

### Idempotency record

يحفظ:

- tenant/principal/route أوcommand type.
- idempotency key hash.
- request payload hash.
- status: in_progress/completed/failed_replayable/expired.
- response reference أوoperation ID.
- created/locked/completed/expiry times.

### Outbox

- تكتبداخلنفسTransaction معAggregate change.
- تحتويevent ID, aggregate ID/version, event type/version, payload, occurred/recorded time.
- Worker ينشرat-least-once.
- Consumer يعتمدInbox dedupe.

### Inbox

- Unique `(consumer, message_id)`.
- يسجلprocessing status وattempts.
- Side effect + inbox completion داخلTransaction واحدة عندمايمكن.

### Process instances

- تحفظworkflow state فقط، ولا تصبحOwner للحقيقةالتجارية.
- كلstep idempotent ولهcorrelation/causation references.

## 23. Sync and Offline Persistence

### الجداولالرئيسية

- `integration.sync_streams`
- `integration.sync_change_entries`
- `integration.sync_cursor_registrations`
- `integration.snapshot_manifests`
- `integration.snapshot_datasets`
- `integration.snapshot_chunks`
- `integration.client_operations`
- `integration.client_operation_results`
- `integration.sync_conflicts`
- `integration.id_mappings`
- `integration.resync_requests`
- `devices.offline_operation_evidence`

### قواعدحرجة

- Sync cursor Public opaque، حتىلوكانداخليًايرتبطبـbigint sequence.
- Change entries projection facts، وليستDomain events الخام.
- Batch ليستAtomic؛ كلoperation نتيجةمستقلة.
- Client operation ID unique داخلTenant + Device/Installation scope.
- Same operation/payload يعيدنفسالنتيجة؛ payload مختلفConflict.
- Snapshot manifest لهlogical cutoff واضح.
- Chunk checksum وsize/count موثقة.
- Cursor expiry تنتجSnapshot required، لاSilent data loss.
- Offline evidence يحتفظlease ID، device key version، sequence، clock evidence، snapshot bindings وsignature metadata.
- Pending POS operations لا تحذفأوتمسحعندUpgrade أوResync.

## 24. Transaction, Locking and Concurrency Rules

### DB-TX-001 — Aggregate transaction

- Command تعدلAggregate واحدةافتراضيًا.
- Aggregate version update يستخدمOptimistic concurrency.
- `UPDATE ... WHERE id = ? AND version = ?` يجبأن يؤثرعلىصفواحد.

### DB-TX-002 — Ledger transaction

- Business aggregate change + ledger entry + materialized balance + audit/outbox تحفظداخلنفسTransaction عندمايمتلكهاContext نفسه.
- Balance row تقفل`FOR UPDATE` أوتستخدمatomic statement.

### DB-TX-003 — Resource ordering

عندقفلعدةصفوف، الترتيب ثابت حسب:

```
tenant_id → account/location → aggregate type → aggregate id → line id
```

لخفضDeadlocks.

### DB-TX-004 — Advisory locks

تستخدمفقطلـcross-row invariants محددة مثل:

- document sequence allocation.
- one-open-shift policy.
- tenant migration/cutover.

لا تستخدمكبديل دائم عنconstraints.

### DB-TX-005 — Serialization failures

- Retry داخلي محدودللمعاملاتالآمنة.
- Retry يحافظعلىنفسIdempotency key.
- Provider/outcome-unknown operations لا تعادعميانيًا.

## 25. Constraints and Database Guards

مطلوب حيثينطبق:

- `check(quantity <> 0)` للـledger deltas.
- `check(amount >= 0)` للقيمالتيلا تسمحبسالب.
- `check(valid_from < valid_to)`.
- Currency/UOM consistency.
- Partial unique indexes للحالةالنشطة.
- Exclusion constraints لمنعeffective-period overlap عندالحاجة.
- Composite same-tenant FKs.
- Immutable-table update/delete revoke أوtrigger للحمايةالدفاعية.
- Deferrable constraints فقطعندمايوجدUse case واضح.

لا توضعBusiness logic معقدة كاملة فيTriggers مخفية. Functions/Triggers المسموحة تكونصغيرة، حتمية، موثقة، واختبارهايشملMigration upgrade.

## 26. Indexing, Search and Pagination

### قواعدالفهارس

- كلFK مستخدمةفيJoin/lookup لهاIndex.
- Tenant-owned operational indexes تبدأغالبًابـ`tenant_id`.
- Time-ordered lists تستخدمkeyset indexes مثل:
    
    `(tenant_id, occurred_at desc, id desc)`.
    
- State queues تستخدمpartial indexes علىالحالاتالنشطة.
- Idempotency/provider references unique indexes.
- Ledger account + sequence indexes.

### Search

- PostgreSQL `pg_trgm` للبحثبالاسم/SKU/reference عندالحاجة.
- Extension creation داخلأولmigration واضحةوidempotent.
- لايفترضShadow database وجودextension مسبقًا.
- Full-text search يضافبـgenerated/search vector عندمايثبتالاحتياج.

### Pagination

- Cursor/keyset للـoperational lists الكبيرة.
- Offset مسموحلقوائمإداريةصغيرة فقطوبحدود.
- Count queries قابلةللتعطيلأوالتقدير فيالقوائمالضخمة.

## 27. Partitioning and Data Growth

### Baseline

- لا نبدأPartitioning شاملًا بلاقياس.
- التصميم يضمنوجود`tenant_id`, `recorded_at`, `sequence` المناسبةلإضافته.

### مرشحونللتقسيم لاحقًا

- Audit records.
- Outbox/inbox history.
- Sync change entries.
- Payment/provider events.
- Inventory/payment/cash ledgers عندالحجم الكبير.

### قواعدالتقسيم

- Range by month/quarter على`recorded_at` معTenant-aware indexes.
- لاPartition per tenant.
- Archive/retention jobs تنشئوتغلقPartitions آليًا بعداختبار.
- Prisma accesses parent tables فقط.

## 28. Retention, Archival and Deletion

فئاتمبدئية:

- Permanent/long-lived: posted financial documents, ledgers, critical audit, legal evidence.
- Policy-retained: operational history, reports, provider events.
- Short-lived: sessions, challenges, enrollment tokens, temporary exports, heartbeats.
- Rebuildable: projections andsearch indexes.

قواعد:

- Legal hold يتغلبعلىRetention.
- Deletion/disposition workflow يسجلEvidence.
- PII minimization/anonymization لا تكسرالمرجعالمالي.
- لاCascade delete منMaster data إلىTransactions.
- `on delete restrict` للتاريخ، و`set null` فقطللعرضغيرالسلطوي معSnapshot محفوظة.

## 29. Backup and Recovery Database Requirements

حتىقبلوثيقةBackup التفصيلية:

- Migrations لا تعملقبلBackup/restore policy فيProduction الحقيقي.
- كلRelease database change لهForward-fix path.
- Restore test يستخدمDatabase منفصلة.
- Outbox/inbox/idempotency تبقىمتسقةبعدRestore.
- POS pending operations تتعامل معRestore point عبرidempotency/reconciliation.
- Recovery لا يعيدإرسالExternal side effects دونInbox/provider reconciliation.

## 30. Environment Separation

- Local development database.
- Isolated unit/integration databases.
- CI clean database.
- CI populated-upgrade database.
- Demo database علىSupabase الحالي.
- Production database لاحقًا منفصلةعنDemo.

ممنوع:

- Tests أوseed destructive علىDemo/Production دونguard صريح.
- Sharing نفسDatabase بينCI وDemo.
- استخدامProduction credentials فيPR workflows.

الخطةالمجانية الحالية لا تغيرالتصميم. نستخدمSupabase/Railway/Vercel المجانيةللـDemo، ونرقيلخطةمدفوعةمعأولعميل دونإعادةتصميمSchema.

## 31. Bold → ATHR Migration Strategy

### MIG-000 — Green baseline

- يبدأمن`feat/athr-transformation` بعدنجاحWP-000.
- كلRelease gates خضراءقبلأيTenant migration.

### MIG-001 — Product identity/configuration

- تحويلBold branding/config دونSchema business change كبير.
- إزالةhard-coded API URL.

### MIG-002 — Expand foundation

إضافةدونكسرالقديم:

- Tenant.
- LegalEntity/Organization.
- Location/Warehouse.
- PlatformIdentity/Membership.
- Shared IDs/value representations.

### MIG-003 — Seed initial ATHR ownership

- إنشاءDemo Tenant واحد.
- إنشاءLegal Entity واحدة.
- تحويلكل`Branch` إلىLocation معالحفاظعلىIDs قدرالإمكان.
- إنشاءWarehouse افتراضيةلكلLocation حسبالبيانات.
- تحويلUsers إلىIdentities + Memberships.
- حفظLegacy role/capability mapping كmigration evidence.

### MIG-004 — Add tenant ownership

- إضافة`tenant_id` nullable أولًا لكلجدولTenant-owned.
- Backfill deterministic منLocation/owner chain أوinitial tenant.
- الجداولالعالمية الحالية مثلProducts/Suppliers/Customers تُسندللـinitial tenant.
- Migration تفشلإذاوجدصفغيرقابلللتعيين؛ لا تعينعشوائيًا.

### MIG-005 — Dual-compatible application

- Application تكتبوتقرأالجديد.
- Compatibility adapters محدودةومؤقتةللـroutes/fields القديمة.
- لاDual-write طويل غيرمراقب.

### MIG-006 — Constrain

بعدإثباتBackfill:

- `tenant_id not null`.
- Composite unique/FKs.
- Tenant-scoped indexes.
- إزالةglobal unique constraints غيرالصحيحة.

### MIG-007 — Rename/generalize

- `Branch` يصبحLocation فيDomain/API/UI.
- يمكنإعادةتسميةالجدول معالحفاظعلىIDs.
- Legacy views/aliases تستخدمفقطخلالنافذةالانتقالية.

### MIG-008 — Ledger and aggregate migration

- تحويلSalesInvoice إلىSale/Document boundaries تدريجيًا.
- نقلCurrent stock إلىOpening/proven ledger evidence عندالحاجة.
- الحفاظعلىInventoryMovement/CostMovement الحاليةوتوسيعTenant ownership.
- لا يعادكتابةPosted history لإجباره علىشكلجديد؛ migration snapshots/evidence توثقLegacy semantics.

### MIG-009 — Sync/POS cutover

- Versioned protocol compatibility.
- POS local schema migration تحفظpending outbox.
- New ATHR installer لا يمسحpending Bold local operations دونreconciliation.
- Server يقبلنافذةبروتوكول محددةثميفرضUpgrade.

### MIG-010 — Contract old structures

بعدنجاحالتشغيل والـrollback window:

- إزالةlegacy columns/tables/routes.
- كلRemoval فيMigration مستقلة.
- لا تعديلMigration مطبقة؛ Repair manifest فقطوفقسياسةالمشروع.

## 32. Migration Quality Gates

لكلMigration أوحزمةDatabase:

1. Prisma/schema validation.
2. Apply fromempty PostgreSQL 16 database.
3. Apply twice withoutunexpected effect.
4. Build previous-release populated database.
5. Upgrade populated data.
6. Validate row counts andfinancial/inventory invariants.
7. Validatetenant backfill completeness.
8. ValidateallFK/orphan queries.
9. ValidatePrisma drift = zero.
10. Runbackend, Admin, POS andhard-smoke relevant flows.
11. Testrollback strategy asrestore/forward-fix، وليسdown migration عمياء.
12. Recordresult فيATHR Work Mode Delivery Log.

## 33. Database Test Catalog Baseline

مطلوب علىالأقل:

- Cross-tenant FK rejection.
- Cross-tenant read/write rejection.
- Tenant-scoped uniqueness.
- Aggregate version conflict.
- Idempotency same/different payload.
- Ledger append-only andbalance reconstruction.
- Concurrent stock consumption/reservation.
- Concurrent return eligibility.
- Payment/refund allocation ceilings.
- Provider event dedupe.
- One-open-shift invariant.
- Transfer duplicate receipt protection.
- Outbox atomicity.
- Inbox duplicate delivery.
- Cursor expiry andsnapshot requirement.
- POS pending operation preservation duringlocal upgrade.
- Legal hold blocksdisposition.
- Clean andpopulated migration paths.

## 34. Prohibited Patterns

ممنوع:

- `tenant_id` اختياري فيجدولTenant-owned بعدمرحلةالانتقال.
- الاعتمادعلىUI لإرسالTenant الصحيح.
- Global unique SKU/document/customer key دونقرار.
- Money أوprices كـfloat/real.
- Generic `status varchar` بلاcatalog/state machine ownership.
- Direct balance updates دونledger.
- تعديلأوحذفposted ledger/document/audit rows.
- Cross-context writes عبرPrisma client منModule أخرى.
- Trigger business workflows مخفية.
- Long transactions تشملNetwork/provider calls.
- Blind retry بعدtimeout لمعاملةخارجية.
- Offset pagination غيرمحدودة.
- Destructive seed علىremote database.
- Editing applied migration in place.
- RLS كبديلعنpermissions أوsame-tenant FKs.
- Database per tenant فيbaseline.
- Table per tenant أوschema per tenant.
- تخزينPDF/images داخلPostgreSQL.
- Blockchain لتخزينالمعاملات.

## 35. Open Decisions

### OD-DB-001 — Prisma multi-schema implementation

**Baseline:** PostgreSQL context schemas معPrisma mapping. الشكلالدقيق—single schema file أوmultiple generated files—يحسمفيRepository Architecture بعدProof of compatibility.

### OD-DB-002 — UUIDv7 library

**Baseline:** قبولUUIDv4 الحالية؛ IDs الجديدةUUIDv7 منShared Kernel بعداختيارمكتبةمراجعة.

### OD-DB-003 — Money precision

**Baseline:** `numeric(24,8)` عام، معCurrency scale/rounding validation. يمكنتضييقحقولDocument totals بعدReporting/Billing review دونفقد.

### OD-DB-004 — RLS timing

**Baseline:** Application tenant enforcement + composite FKs أولًا. RLS defense-in-depth بعدintegration proof معSupabase pooler/Prisma.

### OD-DB-005 — sql.js continuation

**Baseline:** يبقىمؤقتًا خلفLocal Storage Adapter. تغييرالمحرك ليسشرطًا لبدايةالتحويل.

### OD-DB-006 — Physical partition thresholds

**Baseline:** لاPartitioning مبكر. يفعّلمنPerformance Strategy حسبrow count/storage/latency.

### OD-DB-007 — Customer uniqueness

**Baseline:** لاGlobal unique phone داخلTenant بلاسياسةMerge. normalized contacts + duplicate detection؛ القرارالتفصيلي فيCustomer implementation.

### OD-DB-008 — Document numbering authority

**Baseline:** Database-backed scoped sequence allocation. Exact legal scopes تنتظرCountry fiscal adapters.

### OD-DB-009 — Accounting journal

**Baseline:** ATHR يحتفظOperational financial ledgers الآن. General Ledger كامل خارجالنطاق حتىAccounting blueprint مستقل.

### OD-DB-010 — Existing Supabase data preservation

**Baseline:** Forward migration تحفظالبيانات كـinitial ATHR tenant. Destructive reset مسموحفقطبقرارصريح وعلىنسخةDemo معExport/backup مناسب.

## 36. Implementation Readiness

### Ready after WP-000/WP-001

- Shared naming/config foundations.
- Money/Quantity migration inPOS.
- Error/idempotency/integration foundation.
- Migration gate strengthening.

### Ready after WP-002–WP-004

- Tenant/Organization/Location expand migrations.
- Identity/Membership schema.
- TenantContext repository enforcement.
- Composite tenant keys/backfill.

### Not yet ready

- Final reporting projections حتىReporting Model.
- Billing tables التفصيليةحتىBilling Model.
- Notification template/delivery detail حتىNotification Contract.
- Country fiscal/e-invoice schema.
- Full production partitioning.

## 37. Acceptance Gate

تعتبرDatabase Blueprint مكتملةعندما:

- Platform andstorage decisions مثبتة.
- Context schemas محددة.
- Tenant isolation لهApplication وDatabase defenses.
- Common IDs/time/money/quantity/version rules مثبتة.
- Aggregate, ledger, snapshot andprojection patterns محددة.
- Idempotency/outbox/inbox/process persistence محددة.
- Sync/offline persistence محددة.
- Audit/retention/storage rules محددة.
- Index/search/pagination rules محددة.
- Bold-to-ATHR migration sequence محددة.
- Clean/populated migration gates محددة.
- Prohibited patterns andopen decisions موثقة.
- Work mode يعرفمتى يبدأكلDatabase package ومتىيتوقف.

## 38. المرحلة التالية

بعداعتمادهذهالوثيقة:

1. `ATHR Reporting Model v1.0`
2. `ATHR Billing Model v1.0`
3. `ATHR Notification Contract v1.0`

ولا تبدأحزمةTenant database التنفيذية قبلنجاحWP-000 وقراءةWork mode لهذهالوثيقة.