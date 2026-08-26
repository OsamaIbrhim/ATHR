# ATHR ADR Catalog v1.0

**Status:** Approved engineering-governance baseline

**Applies to:** Architectural decisions, domain/data boundaries, protocols, infrastructure, security, deployment, compatibility andexceptions.

## 1. Purpose

هذاالـCatalog يحدد متى وكيف نسجلArchitecture Decision Record، وماالقرارات الموجودة أوالمطلوبة، وكيف نحافظ علىتاريخ القرار بدونإعادةكتابة.

## 2. ADR Principle

ADR تسجل:

- context/problem.
- decision.
- alternatives.
- consequences.
- scope.
- status.
- owners.
- review/expiry whenneeded.

ADR ليستوثيقةشرح عامة، وليستبديلًا عنBusiness Rules أوAPI Contract.

## 3. When ADR Is Required

ADR مطلوبة عند:

- newshared package.
- bounded-context ownership change.
- cross-context transaction.
- newprotocol/versioning strategy.
- database technology/schema ownership shift.
- deployment topology change.
- security/crypto/auth decision.
- provider selection withlock-in.
- exception todependency/coding/testing rules.
- destructive/irreversible migration strategy.
- major performance/cost tradeoff.

## 4. ADR Naming

Files:

```
docs/adr/ADR-0001-short-kebab-title.md
```

Stable sequence; number neverreused.

## 5. ADR Statuses

- Proposed.
- Accepted.
- Rejected.
- Superseded.
- Deprecated.
- Temporary Exception.

Accepted ADR لا تعدللتغييرالقرار؛ تنشأADR جديدة supersedes القديمة.

## 6. ADR Template

```
# ADR-XXXX — Title
Status:
Date:
Owners:
Related WP/PR/Docs:

## Context
## Decision
## Alternatives Considered
## Consequences
## Security / Data / Operational Impact
## Compatibility and Migration
## Validation / Acceptance
## Review or Expiry
```

## 7. Decision Quality Rules

- decision محددة وقابلةللتنفيذ.
- evidence/constraints واضحة.
- alternatives حقيقية، ليستشكلية.
- negative consequences مذكورة.
- migration/rollback considered.
- no secret values.

## 8. Ownership

- author يقترح.
- architecture owner يراجع.
- domain/data/security/release owners يوافقون حسبالتأثير.
- approval recorded inPR/ADR status.

## 9. Relationship to Planning Docs

- Business Rules تحددمايجب أنيفعلهالنظام.
- Domain Model تحددownership/invariants.
- API/Sync/Offline contracts تحددpublic behavior.
- ADR تشرحchoice هندسي محدد بينبدائل.
- Delivery Log يسجلما تمتنفيذه فعليًا.

## 10. Repository Authority

Canonical ADRs تعيشفيGit تحت`docs/adr/`.

Notion Catalog يوفرindex وروابط وملخصات، لكنGit history هوالمرجع القابلللمراجعة معالكود.

## 11. Initial ADR Register

### ADR-0001 — Refactor, Not Rewrite

**Status:** Accepted

- Preserve NestJS modular monolith, PostgreSQL/Prisma, Next.js, Electron andexisting operational ledgers.
- Incremental Work Packages instead ofbig-bang rewrite.

### ADR-0002 — Canonical Repository Paths

**Status:** Accepted

- Keep `backend/`, `admin-web/`, `pos-electron/` duringWP-002.
- No cosmetic move to`apps/*` withoutmeasured benefit.

### ADR-0003 — npm Workspaces and One Root Lockfile

**Status:** Accepted

- Root workspaces includeapps and`packages/*`.
- root isorchestrator, notruntime dependency.

### ADR-0004 — Initial Shared Packages

**Status:** Accepted

- `@athr/contracts`.
- `@athr/domain-core`.
- `@athr/error-registry`.
- `@athr/testing`.
- newpackages requirestable ownership andmultiple consumers.

### ADR-0005 — Backend Modular Monolith Boundaries

**Status:** Accepted

- domain/application/infrastructure/delivery direction.
- public module entrypoints.
- no cross-context direct writes.

### ADR-0006 — Tenant asHighest Operational Boundary

**Status:** Accepted

- Branch generalized toTenant/Organization/Location/Warehouse.
- tenant-safe IDs, queries, FKs andcache keys.

### ADR-0007 — Membership andPermission Model

**Status:** Accepted

- Platform identity separate fromTenant Membership.
- permissions/roles/scopes replacefixed global roles.

### ADR-0008 — Ledger asSource ofTruth

**Status:** Accepted

- inventory, cost, payment, cash, receivables, store credit, loyalty andbilling balances derive fromappend-only ledgers.

### ADR-0009 — Offline Acceptance andIdempotency

**Status:** Accepted

- POS operation durable beforeacknowledgement.
- replay safe.
- acceptance-first negative stock policy preserved whereapproved.

### ADR-0010 — Sync Owns Protocol, NotBusiness Facts

**Status:** Accepted

- Sync maps operations toowner-context commands.
- cursors/envelopes owned bySync; commercial outcomes owned bydomains.

### ADR-0011 — Separate Sales, Payments, Returns andRefunds

**Status:** Accepted

- Sale posting isnotpayment outcome.
- Return business decision isnotrefund ledger result.

### ADR-0012 — Single Production Migration Runner

**Status:** Accepted

- Railway pre-deploy runner only.
- no app-start migration.
- direct connection preferred.
- advisory locking remains enabled.

### ADR-0013 — Forward-Only Migration Policy

**Status:** Accepted

- applied migrations immutable.
- expand/backfill/constrain/contract.
- forward fixes instead ofhistory editing.

### ADR-0014 — ATHR Identity and Configurable Endpoints

**Status:** Accepted

- noBold identity asruntime target.
- nocompiled production API URL.
- validated deployment configuration.

### ADR-0015 — POS Legacy Data Migration

**Status:** Accepted

- changingapp identity mustpreserveSQLite andsecure state throughverified non-destructive migration.

### ADR-0016 — Browser andNode Export Separation

**Status:** Accepted

- shared packages exposeexplicit browser-safe/node-only entrypoints.

### ADR-0017 — Error Contract

**Status:** Accepted

- stable error code, retry mode, outcome certainty andlocalization key.
- no raw provider/ORM errors.

### ADR-0018 — Money andQuantity Value Objects

**Status:** Accepted

- nofloating-point business arithmetic.
- explicit precision, UOM, currency androunding.

### ADR-0019 — Eventual Cross-Context Consistency

**Status:** Accepted

- outbox/inbox/idempotency/process managers.
- no distributed transaction.

### ADR-0020 — Reporting Projections AreNotSource ofTruth

**Status:** Accepted

- reports/search/read models rebuildable.
- cannotownoperational invariants.

## 12. Proposed ADR Backlog

### ADR-0021 — Dependency Enforcement Tool

Choose custom Node checker vsdependency-cruiser.

### ADR-0022 — TypeScript Project References

Decide timing andbuild impact.

### ADR-0023 — Worker andScheduler Deployment Split

Define when separateprocesses becomeoperationally necessary.

### ADR-0024 — Transfer Module Placement

Separate module vsInventory submodule whileInventory retainsledger ownership.

### ADR-0025 — Browser E2E Tool Consolidation

Choose canonical Admin E2E tooling.

### ADR-0026 — Observability Provider Stack

Provider choice afterinterfaces anddata-label rules.

### ADR-0027 — Object Storage andDocument Retention

Provider, encryption, signed access andlifecycle.

### ADR-0028 — Billing Provider

Onlyafterbilling domain/contracts stable.

### ADR-0029 — Queue/Job Infrastructure

PostgreSQL-based vsmanaged queue basedonmeasured requirements.

### ADR-0030 — First-Paid-Customer Readiness Threshold

Freeze exactperformance, coverage, recovery andsecurity thresholds afterbaseline evidence.

## 13. Temporary Exception ADRs

Must include:

- exactrule violated.
- files/edges affected.
- risk.
- compensating controls.
- owner.
- removal WP.
- expiry date/commit.

Expired exception failsCI/review.

## 14. Superseding Decisions

When decision changes:

1. create newADR.
2. markold asSuperseded.
3. linkbothdirections.
4. documentmigration/compatibility.
5. updateHub/contracts/code inapproved order.

## 15. Rejected Decisions

Rejected ADR retained toavoidrepeatinganalysis. It stateswhy rejected andwhat evidence couldreopen it.

## 16. Evidence Requirements

Depending ondecision:

- benchmark.
- spike/prototype.
- threat model.
- migration rehearsal.
- cost estimate.
- failure analysis.
- dependency graph.
- customer/product constraint.

## 17. Review Cadence

Review ADR when:

- assumption changes.
- incident exposesweakness.
- dependency/platform deprecates behavior.
- major WP reachesimplementation.
- temporary exception nearsexpiry.

## 18. ADR and Code Review

PR reviewer checks:

- doeschange requireADR?
- doesitcomply withaccepted ADRs?
- aredocs/tests/migrations aligned?
- isanyexception explicit?

## 19. ADR Index Fields

Catalog entry records:

- number/title.
- status.
- date.
- owners.
- affectedcontexts/apps.
- relatedWPs/PRs.
- supersedes/superseded by.
- review/expiry.

## 20. WP-002 Required ADRs

BeforeWP-002 closes, Git versions shouldexist for:

- npm workspaces/root lockfile.
- initial shared packages.
- dependency enforcement tool.
- browser/node exports ifimplemented.
- anytemporary legacy exception.

## 21. Acceptance Gate

- `docs/adr/` exists.
- template andindex committed.
- accepted baseline decisions captured.
- proposed backlog owned.
- PR template asksforADR impact.
- supersede/exception policy enforced.

## 22. Prohibited Patterns

- architecture decision onlyinchat.
- editingaccepted ADR tohidechange.
- ADR afterimplementation solelyforappearance.
- vague decision withouttradeoffs.
- permanent temporary exception.
- Notion-only decision disconnected fromcode.

## 23. Approval Outcome

هذاالـCatalog هوالمرجع المعتمد لتسجيلوتتبع القرارات المعمارية فيATHR.