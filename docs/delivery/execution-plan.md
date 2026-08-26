# ATHR Work Mode Execution Plan v1.0

**Authoritative Coding Plan — Bold-to-ATHR Controlled Transformation**

## 1. Mission

تحويلRepository الحالي `OsamaIbrhim/bold_system` إلى ATHR كنظام SaaS/POS/ERP احترافي، معإعادةاستخدامالأصول القوية الموجودة، وكسرأوتغييرأيBold-specific behavior أوسchema أوdeployment أوtests عندمايتطلبهدف ATHR ذلك.

**ATHR لهالأولوية المطلقة. الحفاظعلىBold كمنتجليسRequirement.**

## 2. Team Role

Work mode يعمل كفريقتطوير كامل، ويؤدي أدوار:

- Principal Software Architect.
- Senior Backend Engineer.
- Senior Frontend Engineer.
- Senior Electron/POS Engineer.
- Senior PostgreSQL/Prisma Engineer.
- Security Engineer.
- Test Automation Engineer.
- Performance Engineer.
- DevOps/Release Engineer.
- Code Reviewer.

لا يكتفيبتعديلسطحي أوإصلاحBug منفرد. كلحزمةعمل يجب أنتشملالتصميم التنفيذي، الكود، الاختبارات، migration safety، integration verification، وrelease impact.

## 3. Source of Truth

قبلتنفيذأيWork Package، يقرأWork mode:

1. هذهالوثيقة.
2. وثائق ATHR فيProduct & System Design Hub ذاتالصلة بالحزمة.
3. آخرEntry في `docs/delivery/delivery-log.md`.
4. Current repository state والـbranch المستهدفة.

ترتيبالأولوية عندالتعارض:

`ATHR approved planning → current execution package → repository evidence → legacy Bold behavior`

## 4. Branch and Delivery Rules

- Base repository: `OsamaIbrhim/bold_system`.
- Long-running transformation branch: `feat/athr-transformation`.
- يجوزإنشاءChild branches لكلWork Package ثمmerge إلىTransformation branch.
- لايعملمباشرةعلى`master`.
- يجوزتغييرBackend وAdmin وPOS وPrisma وMigrations وCI وRailway/Vercel/Supabase config وRelease workflow.
- يجوزكسرBold compatibility إذاكانذلكمطلوبًا لـATHR.
- يجبالحفاظعلىForward-only migration discipline.
- لايجوزForce push لفرعتمتشاركته دونسببموثق.
- Bash فقط.

## 5. Deployment Policy

- Existing Railway, Vercel andSupabase deployment are ATHR demo infrastructure.
- يجوزتغييرها وتحويلها إلىATHR.
- لايشترطالحفاظعلىBold live behavior.
- الأولويةللحصولعلىDemo ATHR عامل وقابللعرضللعملاء.
- استخدمالخططالمجانية الحالية حتىوجودأولمشترك.
- لا تضفPaid service دونقرارصريح.
- عندالحاجةلخدمةمدفوعة، ينفذFallback مجاني أوLocal-compatible architecture ويوثقUpgrade path.

## 6. Quality Gates for Every Package

كلWork Package لا تعتبرمكتملة إلا بعد:

1. Typecheck success.
2. Unit/contract tests success.
3. Relevant integration tests success.
4. Migration clean-database test إنوجدDatabase change.
5. Migration populated-upgrade test إنوجدDatabase change.
6. Admin/POS build success عندالتأثير.
7. Hard-smoke success عندالتأثيرعلىRuntime/DB/Sync.
8. Security andtenant-isolation tests عندالتأثير.
9. `git diff` review.
10. Delivery Log update.

## 7. Execution Sequence

# Wave 0 — Establish a Green ATHR Baseline

## WP-000 — Stabilize Transformation Base

**Start from:** PR #42 head `ba2af73ff35a5b4ad2c4ab9005d3a016f895fd22`.

### Tasks

1. Create `feat/athr-transformation` fromthatcommit.
2. Fix hard-smoke failure caused byundefined shift ID.
3. Ensure test flow validates everyAPI response beforeusingIDs.
4. Retain deterministic negative-stock accounting repair.
5. Runallrelease gates.
6. Recordbaseline commit andtest results.

### Acceptance

- Backend, Admin, POS, migration-gate, Admin E2E, hard-smoke andrelease-gate green.
- No `undefined` resource paths canbeconstructed bytests orruntime helpers.

# Wave 1 — Convert the Product from Bold to ATHR

## WP-001 — ATHR Identity, Configuration and Release

### Tasks

1. Renamepackage names/descriptions whereappropriate.
2. ChangeSwagger identity toATHR.
3. ChangeAdmin andPOS visible branding.
4. ChangeElectron:
    - appId.
    - productName.
    - installer artifact.
    - shortcuts.
    - local database filename.
    - icons/assets whenavailable.
5. Removehard-coded Bold Railway API URL.
6. Introducevalidated API base resolution:
    - build-time/environment.
    - enrollment-provided configuration whereappropriate.
    - safe production fallback onlyifexplicitlyconfigured.
7. RenamePOS release tags/artifacts/manifest titles toATHR.
8. UpdateCI andscripts fromBold identifiers toATHR identifiers.
9. Updatehealth/logging/docs identifiers.
10. Createcompatibility migration forlocal `bold_pos.sqlite` onlyifrequired to preservepending demo data; otherwisestartclean anddocumentit.

### Acceptance

- No customer-visible `Bold` branding remains.
- Installer andGitHub release areATHR.
- API endpoint isnot hard-coded inapplication source.
- Existing demo deploy canbeconverted toATHR.

# Wave 2 — Shared Engineering Foundation

## WP-002 — Workspace and Shared Packages

### Tasks

1. Convertroot intoexplicit npm workspaces orapprovedmonorepo layout.
2. Addshared packages:
    - contracts.
    - domain-core.
    - error-registry.
    - testing utilities.
3. Establishstrict TypeScript settings.
4. Addcross-package build andtest orchestration.
5. Preventcyclic dependencies.

## WP-003 — API and Error Contract Foundation

Implementapproved:

- response envelopes.
- command/query results.
- field errors.
- stable error registry.
- retry modes.
- outcome certainty.
- idempotency andconcurrency contracts.
- request/correlation IDs.

MigrateexistingAPI filter andexceptions gradually withoutbreakingunmigrated routes.

## WP-004 — Core Value Objects

Implement:

- Money andCurrency.
- Quantity andUnit.
- Percentage.
- BusinessDate andUTC timestamps.
- TypedopaqueIDs.
- AggregateVersion.
- IdempotencyKey.
- ClientOperationId.

Removefloating-point money fromPOS persistence/calculation. Migratefrom`REAL` money fields tointeger minor-units ordecimal-safe text representation accordingtoapproveddesign.

# Wave 3 — Multi-tenancy Foundation

## WP-005 — Tenant, Organization and Location Schema

**Requires:** relevant Database Blueprint section markedReady forImplementation.

### Tasks

1. AddTenant.
2. AddOrganization/LegalEntity.
3. GeneralizeBranch intoLocation withcontrolledtransition.
4. AddWarehouse andLocation/Warehouse relationships.
5. BackfillexistingBold data intooneinitial ATHR tenant andorganization.
6. Addtenant_id toallownedresources usingexpand/backfill/constrain pattern.
7. Replaceglobal unique constraints withtenant-scoped uniqueness.
8. Addtenant-aware indexes.
9. Adddatabase integrity tests.

## WP-006 — Identity, Membership and Permission Model

1. SeparateIdentity fromTenant Membership.
2. Replacefixed Prisma Role asDomain authority.
3. ImplementRole templates onlyasassignment convenience.
4. Implementstable permission keys andscope assignments.
5. IntroduceTenant/Location/Warehouse/Terminal scope enforcement.
6. Migrateexistingusers andcapabilities.
7. Adddefault-deny andcross-tenant tests.
8. EnsurePOS login resolvesmembership andterminal scope.

## WP-007 — Tenant Context Enforcement

1. IntroducecentralTenantContext.
2. Requiretenant context inapplication services/repositories.
3. Eliminateunscoped Prisma reads/writes fromtenant-owned modules.
4. Adddefense-in-depth DB policy/RLS onlyifapproved andcompatiblewithPrisma.
5. Addtests provingTenant A cannotread/writeTenant B.

# Wave 4 — Domain Migration

## WP-008 — Catalog, Pricing, Tax and Promotions

Generalizeclothing-specific assumptions whilepreservingvariants.

Implementversioned:

- Catalog.
- Units/conversions.
- Price books.
- Tax rules.
- Promotion/coupon rules.
- location/channel applicability.
- immutable transaction snapshots.

## WP-009 — Inventory and Stock

1. GeneralizeBranch inventory toLocation/Warehouse.
2. Preserveandstrengthenappend-onlyInventoryMovement.
3. Implementreservations andavailability.
4. PreserveInventoryCostMovement withtenant isolation.
5. Addstock count/reconciliation states.
6. Completeacceptance-first negative-stock policy accordingtoATHR rules.

## WP-010 — Sales and Payments

1. ReplaceSalesInvoice-as-command withSale aggregate andcommands.
2. SeparateSale, Payment, PaymentAttempt, Allocation andDocument.
3. Preservehistorical snapshots.
4. Implementcash baseline andonline provider abstraction.
5. ImplementOutcomeUnknown andReconciliation.
6. Convert`/pos/sale` towardapprovedcommand contract withcompatibility window.

## WP-011 — Returns, Refunds and Exchanges

1. SeparateReturn posting fromRefund outcome.
2. Implementeligibility, inspection, disposition andapproval.
3. Preventover-return andduplicate refund.
4. Implementexchange orchestration.

## WP-012 — Purchasing and Suppliers

1. AddPurchaseOrder lifecycle.
2. SeparateGoodsReceipt andSupplierInvoice.
3. Preserveweighted cost ledger behavior.
4. Implementmatching, overrides andsupplier returns.

## WP-013 — Transfers

Implementfull state machine:

`Draft → Approved → Shipped → PartiallyReceived → Received`

with:

- immutable approved lines.
- reservations.
- in-transit ledger.
- partial receipt.
- damaged/missing discrepancy.
- cancellation rules.
- duplicate-receipt protection.

## WP-014 — Customers, Receivables, Store Credit and Loyalty

Addtenant-scopedcustomeridentity andledgers. Keepstore value online-only untiloffline policy explicitlyallowsotherwise.

## WP-015 — Shifts, Cash Drawers and Terminals

1. Generalizeone-open-shift-per-branch design.
2. Addterminal/drawer assignment.
3. SeparateProvisionalClosed andFinalClosed.
4. Implementcash movement ledger anddiscrepancy approval.
5. Replacecurrentoffline context withsignedOffline Lease.

# Wave 5 — Sync and Offline Replacement

## WP-016 — Sync Protocol v1

Implement:

- bootstrap.
- snapshot manifest/chunks.
- logical cutoff.
- opaque cursors.
- incremental projection changes.
- operation upload batches.
- operation result ledger.
- deduplication.
- conflicts.
- tombstones.
- resync recovery.

MigratecurrentPOS withoutlosingpendingoutbox operations.

## WP-017 — Offline Protocol v1

Implement:

- signedOfflineAuthorizationLease.
- capability levels.
- cash-onlylimits.
- snapshot bindings.
- offline number ranges.
- clock evidence.
- device signing abstraction.
- provisional shift closure.
- user-facingpending/conflict states.

## WP-018 — POS Main-process Refactor

Splitcurrentlarge`electron/main.ts` into:

- app bootstrap.
- local storage adapter/migrations.
- secure credential store.
- API client.
- auth/session service.
- enrollment/device service.
- sync engine.
- operation queue.
- sale service.
- shift/cash service.
- printing.
- updater.
- diagnostics.
- IPC boundary.

Behavior remainscovered bytests throughincremental extraction.

# Wave 6 — Admin and Product Experience

## WP-019 — ATHR Admin Shell

- Tenant switch/context.
- Organization/location navigation.
- Permission-driven menus.
- Plan/entitlement visibility.
- Arabic RTL andEnglish.
- Clearerror/action states.

## WP-020 — Operational Modules UI

Implementadmin workflows followingdomain order:

- catalog/pricing.
- inventory.
- sales/payments.
- returns/refunds.
- purchasing.
- transfers.
- customers.
- shifts/terminals.
- reports/audit.

## WP-021 — POS Experience

- Fast cashier login.
- unambiguousonline/offline/degraded state.
- lease expiry/pending/conflict indicators.
- paged/searchable catalog.
- sale,hold,resume,print,reprint.
- clearreconciliation UI.
- accessibility andkeyboard-first operation.

# Wave 7 — SaaS Capabilities

## WP-022 — Billing, Plans and Entitlements

ImplementafterBilling Model approval:

- Plans.
- subscriptions.
- entitlement snapshots.
- usage limits.
- suspension/read-only modes.
- provider abstraction.

## WP-023 — Reporting, Documents and Notifications

Implementapprovedmodels for:

- operational reports.
- asynchronous exports.
- invoice/receipt artifacts.
- notifications.
- webhooks.
- retention metadata.

# Wave 8 — Production Engineering

## WP-024 — Security Hardening

- authentication step-up.
- approval workflows.
- secrets andkey rotation.
- rate limits.
- audit completeness.
- data minimization.
- security tests.

## WP-025 — Observability and Performance

- structured logs.
- metrics.
- tracing/correlation.
- slow query/request detection.
- sync lag andterminal health.
- representative volume datasets.
- tenant-aware performance gates.

## WP-026 — Deployment and Recovery

Transformexistingfree infrastructure:

- Railway backend.
- Vercel Admin.
- Supabase database/storage.
- GitHub POS releases.

Add:

- safe environment config.
- migration release gate.
- backup/restore rehearsal.
- rollback/forward-fix procedure.
- demo seed andtenant.

## WP-027 — ATHR Demo Release

Release criteria:

- ATHR branding complete.
- demo tenant provisioning.
- Admin andPOS critical flow complete.
- installer published.
- Railway/Vercel/Supabase demo healthy.
- nohigh/critical security findings.
- release gates green.
- scriptedcustomer demo path.

## 8. Execution Control

Work mode executes **oneWork Package atatime**, unlesspackage explicitlycontainsparallel independent tasks.

Atcompletion itmustupdateDelivery Log andstop forreview beforethenextpackage, unlessuser explicitlyauthorizescontinuous execution.

## 9. Report Format

Work mode doesnotcreatefree-form reports. ItupdatesoneDelivery Log entry containing:

- Work Package ID/title.
- branch andcommit SHA.
- scope completed.
- files changed.
- migrations.
- tests andresults.
- deployment/release impact.
- unresolved blockers.
- deviations fromplan.
- nextrecommended package.

## 10. Current Execution Authorization

- **WP-000 — Stabilize Transformation Base:** `Closed / Passed`.
- **WP-001 — ATHR Identity, Configuration and Release:** `Closed / Passed`.
- **WP-001 branch:** `feat/athr-transformation`.
- **WP-001 pull request:** [PR #44](https://github.com/OsamaIbrhim/bold_system/pull/44) — open, mergeable and not merged.
- **WP-001 base SHA:** `59e54c9121544d02f8925fd7a71d04f93b5bcd7c`.
- **WP-001 head SHA:** `f84b7678a8639e1149bc3f32f8e758cda9783b29`.
- **Verified gates:** GitHub CI run `30441611959` passed، POS Windows Installer run `30441611966` passed، وVercel preview check passed.
- **Accepted by project owner at:** 2026-07-29 21:35 Africa/Cairo.

**WP-002 — Workspace and Shared Packages is now authorized to begin.**

Work mode must remain on `feat/athr-transformation`, read the latest Delivery Log entry and the approved ATHR engineering documents, execute WP-002 only, pass all relevant gates, update the Delivery Log, then stop for review before WP-003 unless continuous execution is explicitly authorized.