# ADR-0002: Tenant / Data Ownership

**Status:** Accepted
**Author:** ATHR Planning (reviewed and finalized directly, not CLI-authored)
**Requires approval from:** Osama (project owner) before Phase B may begin

- **Date:** 2026-08-02
- **Work package:** WP-005 Phase A
- **Related docs:** `ATHR Multi-tenancy Blueprint v1.0` §2 (MT-DEC-001–005), §9 (Hierarchy Baseline), §116 (Migration Sequence); `ATHR Tenant, Organization, Locations & User Membership Business Rules v1.0` §3–9 (BR-TEN-100–106, BR-LEG-100–104, OD-TEN-001); `ATHR Database Blueprint v1.0` §3 (DB-DEC-001–005), §5 (DB-TEN-001–005); `Code Gap Analysis — 2026-07-29` (Identifier Classification Matrix, Stage 2 Entry Gate)

## Context

The current schema (`backend/prisma/schema.prisma`) is single-tenant: `Branch` is the highest operational boundary, and every business table (`Product`, `Customer`, `SalesInvoice`, `PosTerminal`, etc.) either has no ownership scoping at all or is scoped only to `Branch` via `branch_id`. Several columns carry **global** uniqueness (`Branch.code`, `Product.sku_base`, `ProductVariant.sku`, `Customer.phone`, `PosTerminal.device_id`/`terminal_code`, `SalesInvoice.invoice_number`) that must become tenant-scoped once more than one customer organization shares the database.

`Code Gap Analysis — 2026-07-29` names this the single biggest architectural gap blocking SaaS readiness and requires this exact decision — Tenant/Data Ownership — to be an **Accepted ADR** before any Stage 2 (multi-tenancy) code, including WP-005 Phase B, may begin.

Three storage models were realistically available: database-per-tenant, PostgreSQL-schema-per-tenant, and shared-database row-level isolation. The `ATHR Multi-tenancy Blueprint v1.0` (MT-DEC-001) has already evaluated these at the planning-baseline level; this ADR formally adopts that baseline as the binding engineering decision for WP-005 Phase B and all WPs after it, and additionally resolves the entity-hierarchy question (MT-DEC-002) and the Legal Entity cardinality question (`OD-TEN-001`) that Phase B's migration design depends on.

## Decision

### 1. Storage model: shared application, shared PostgreSQL, row-level tenant isolation (MT-DEC-001)

ATHR uses **one application deployment** and **one primary PostgreSQL database**. Tenant-owned rows carry an explicit `tenant_id`. Isolation is enforced through defense-in-depth (application `TenantContext` + scoped repositories + composite same-tenant foreign keys + tenant-scoped uniqueness), **not** through separate databases, separate schemas, or separate tables per tenant.

We explicitly reject database-per-tenant and schema-per-tenant for the current stage because:

- ATHR runs on free-tier Railway/Supabase/Vercel before the first paid customer (MT-DEC-005); per-tenant infrastructure provisioning has no operational or cost justification at this scale.
- A single schema is simpler to migrate, monitor, back up, and support — directly relevant given WP-005 Phase B modifies a live-shaped production database.
- It does not foreclose future dedicated-tenant isolation: `OD-MT-006` already defers that to an export/migration contract if ever needed, not a redesign.

PostgreSQL Row-Level Security (RLS) is **not** part of the Baseline isolation mechanism for this ADR. Per `OD-MT-001`, RLS remains deferred until proven safe against Prisma's query engine and the Supabase connection pooler; application-level enforcement and composite foreign keys are the primary and, for now, only database-adjacent defenses.

### 2. Tenant is the ownership boundary — not Location, Branch, or Role (MT-DEC-002)

`Tenant` is the sole top-level data-ownership and isolation boundary. `Location` (the successor to `Branch`), `Warehouse`, `Terminal`, and `Role` are all **subordinate** concepts that exist inside exactly one Tenant and never substitute for it as an isolation unit. Per `BR-TEN-100`, every operational record belonging to a customer must associate with exactly one Tenant, directly or through an unambiguous ownership chain — never through `Location`/`Branch` alone, and never through `Role`.

### 3. Full ownership hierarchy

Per Multi-tenancy Blueprint §9 (Hierarchy Baseline) and `BR-TEN-106`:

```
Tenant
├── Organization Profile        (commercial display identity — no ownership authority)
├── Primary Legal Entity        (tax/legal/financial responsibility)
│   └── Locations                (operational sites — successor to Branch)
│       ├── Warehouses           (inventory custody — may be Location-linked or centralized)
│       └── Terminals            (registered POS installations)
├── Memberships                  (Identity ↔ Tenant relationship — see ADR-0003)
└── Tenant-owned operational data (Products, Customers, Sales, Inventory, …)
```

Legal Entity, Location, and Warehouse are three **distinct** entities (`BR-TEN-106`) — none is a stand-in for another, even though a Location commonly has exactly one associated Warehouse in the common case handled by WP-005 Phase B (`BR-WHS-202`, `BR-LOC-204`).

### 4. One primary Legal Entity per Tenant for MVP (`OD-TEN-001`, `BR-LEG-101`)

MVP schema and migrations assume **exactly one primary Legal Entity per Tenant**. This is a deliberate simplification to reduce tax/numbering/reporting complexity during the initial SaaS rollout, not a permanent architectural ceiling: the schema does not close the door to multiple Legal Entities per Tenant in the future (`BR-LEG-100` already anticipates the multi-entity case), but WP-005 Phase B creates and backfills exactly one `LegalEntity` row per `Tenant`, and no code in this WP or WP-006/WP-007 may assume more than one is selectable.

### 5. Defense in depth is mandatory, not optional (MT-DEC-004)

No single layer is trusted alone. The layers required, in order, are: authentication/session claims → membership and scope validation → `TenantContext` inside the application → tenant-scoped repositories → tenant predicates in SQL/Prisma → composite same-tenant foreign keys → tenant-scoped uniqueness → (optional, deferred) PostgreSQL RLS → tenant-aware cache/storage/job keys → audit, telemetry, and cross-tenant tests. WP-005 Phase B only lays the database-level layers (tables, nullable `tenant_id`, backfill); the application-level layers (`TenantContext`, scoped repositories, enforced constraints) are explicitly WP-006/WP-007 scope and are **not** implemented in WP-005 Phase B.

### 6. No Tenant context from untrusted input (MT-DEC-003)

Every command, query, job, event, file, or cache entry belonging to a customer must carry an explicit, trustworthy Tenant context — never a `tenant_id` read directly from a request body or an unauthenticated header. This ADR fixes the principle now; WP-007 implements the enforcement.

## Alternatives Considered

1. **Database-per-tenant.** Rejected: highest operational cost and complexity for a pre-revenue, free-tier-infrastructure product; provisioning a new database per signup blocks the self-serve onboarding goal (Stage 8 of the Code Gap Analysis roadmap).
2. **PostgreSQL schema-per-tenant.** Rejected: still requires per-tenant migration fan-out and connection/pool complexity disproportionate to current scale; Prisma's multi-schema support is immature relative to the team's velocity needs.
3. **Enable RLS immediately alongside row ownership.** Rejected for now (not forever): RLS with Prisma's connection pooling and Supabase's pooler has failure modes (session-local `SET` leaking across pooled connections) that are not yet proven safe (`OD-MT-001`). Application enforcement plus composite FKs must be proven first; RLS is added later as defense-in-depth once that proof exists.
4. **Multiple Legal Entities per Tenant from day one.** Rejected for MVP: adds tax-profile, document-numbering, and reporting-scope complexity with no near-term customer requirement; the schema is designed not to block this later (`BR-LEG-100`, `OD-MT-003`).

## Consequences

- Every tenant-owned table in `backend/prisma/schema.prisma` will eventually carry a non-nullable `tenant_id` and composite same-tenant foreign keys (WP-007 / MT-MIG-006) — WP-005 Phase B only adds it as nullable and backfills it (MT-MIG-004).
- Global-uniqueness columns identified in the Identifier Classification Matrix (e.g. `Product.sku_base`, `ProductVariant.sku`/`barcode`, `Customer.phone`, `PosTerminal.terminal_code`, `SalesInvoice.invoice_number`) must be redefined as tenant-scoped unique constraints in a later WP (MT-MIG-006) — not in WP-005 Phase B.
- `Branch` becomes `Location` under a `Tenant`, with a `LegalEntity` and default `Warehouse` introduced above/alongside it (WP-005 Phase B, MT-MIG-001/002).
- No RLS work is scheduled until a dedicated proof spike against Prisma + Supabase pooler succeeds; this ADR does not authorize enabling RLS.
- Any future decision to offer per-tenant dedicated infrastructure requires a new ADR superseding this one, backed by an export/migration contract, not an ad hoc schema fork.

## Security / Data / Operational Impact

Row-level isolation without RLS means correctness rests entirely on WP-006/WP-007's application-layer enforcement and this ADR's composite-FK/uniqueness requirements being implemented faithfully. Until WP-007 lands, no tenant-owned table has enforced isolation beyond nullable `tenant_id` values — this is an accepted, temporary, and explicitly scoped risk window covered by WP-005 Phase B's own Prohibited-in-this-WP list (no `NOT NULL`, no composite FKs yet) and closed by WP-007.

## Compatibility and Migration

This ADR is the architectural basis for the Migration Sequence in `docs/runbooks/tenant-migration-backfill-rollback.md` (MT-MIG-000 through MT-MIG-004, WP-005 Phase B scope). No schema or migration is created by this ADR itself — see §A.4 of `docs/wp/WP-005-tenant-organization-location-schema.md` (Phase A must not touch `schema.prisma`).

## Validation / Acceptance

- [ ] Osama has reviewed and set this file's `Status:` to `Accepted`.
- [ ] WP-005 Phase B's `schema.prisma` changes are traceable to §Decision items 1–4 of this ADR.
- [ ] No Phase B migration introduces database-per-tenant, schema-per-tenant, or RLS.

## Review or Expiry

Review when: (a) RLS proof-of-safety work is scheduled (`OD-MT-001` resolution), (b) a second Legal Entity per Tenant becomes a real customer requirement, or (c) an Enterprise customer requires dedicated infrastructure (`OD-MT-006`). No fixed expiry.
