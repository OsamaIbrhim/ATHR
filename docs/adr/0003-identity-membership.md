# ADR-0003: Identity / Membership

**Status:** Accepted
**Author:** ATHR Planning (reviewed and finalized directly, not CLI-authored)
**Requires approval from:** Osama (project owner) before Phase B may begin

- **Date:** 2026-08-02
- **Work package:** WP-005 Phase A
- **Related docs:** `ATHR Multi-tenancy Blueprint v1.0` §10–14 (Platform Identity, Membership, Tenant Selection, Last Owner Safeguard); `ATHR Tenant, Organization, Locations & User Membership Business Rules v1.0` §11–15 (BR-PID-100–105, BR-MEM-100–106, BR-OWN-100–104, BR-ROL-100–105); `ATHR Database Blueprint v1.0` §6–7 (Platform Identity Schema, Organization and Membership Schema); `ATHR ADR Catalog v1.0` ADR-0007 (Membership and Permission Model, conceptual register)

## Context

The current `User` model conflates three concepts that the Multi-tenancy Blueprint requires to be separate: a global login identity, membership in a specific tenant, and a role assignment. `User.role` is a single fixed enum (`owner`, `branch_manager`, `cashier`, `warehouse_manager`, `seller`) and `User.branch_id` is a single optional foreign key — there is no way today for one person to hold independent access in more than one Tenant, and no way to suspend a user's access to one Tenant without affecting all their access globally.

WP-005 Phase B (MT-MIG-003) must decide how to introduce Platform Identity and Membership as new structures while treating every existing `User` row as the seed data for exactly one Membership into the Initial ATHR Demo Tenant, without destructively renaming or dropping `User`. This ADR fixes the conceptual model Phase B implements against; it does not fix the exact migration mechanics (that choice is deferred to Phase B's own PR description and Delivery Log entry, per §B.5 of the WP-005 document, because it depends on exactly how `User` is shaped when that code is written).

## Decision

### 1. Platform Identity is global; Membership is per-tenant (MT-DEC-002, Blueprint §10–11)

A **Platform Identity** represents one person globally across all of ATHR. It can hold **zero or more Memberships**, each an independent relationship to exactly one Tenant. Authentication (login, password, sessions) belongs to Platform Identity. Authorization inside a specific Tenant (roles, scopes, active/suspended status) belongs to Membership. A Platform Identity carries **no** business permissions of its own (`BR-TEN-101`) — permissions only exist through an active Membership.

### 2. Membership lifecycle is explicit and independent per Tenant (`BR-MEM-101`, `BR-TEN-102`)

Membership states: `invited`, `pending_verification`, `active`, `suspended`, `deactivated`, `expired` (for fixed-term engagements). Suspending or deactivating a Membership in Tenant A has **no effect** on the same Identity's Membership in Tenant B (`BR-TEN-102`). The only cross-tenant override is disabling the Platform Identity itself for a global security reason (`BR-PID-102`), which suspends all Memberships simultaneously and is a distinct, higher-severity action from a single-Tenant suspension.

### 3. Exactly one Membership per (Identity, Tenant) pair (`BR-MEM-100`)

The system prevents more than one active Membership for the same Identity/Tenant pair. Re-inviting an already-member identity must not create a duplicate Membership (`BR-INVIT-102`, `BR-INVIT-105`).

### 4. Last-owner safeguard is a hard invariant (`BR-OWN-100`, Blueprint §14)

A Tenant must have at least one active `Tenant Owner` Membership at all times. The system must refuse to suspend, deactivate, or remove the last active Owner Membership without a completed ownership-transfer workflow first. `Tenant Owner` is a Tenant-scoped commercial role, not a platform-wide super-admin (`BR-OWN-101`) — it never grants visibility into other Tenants or platform-internal settings.

### 5. Allow-only permission model for MVP; explicit deny deferred (`OD-TEN-005`, `BR-ROL-104`)

For MVP, the permission model is **allow-only**: a Membership's effective permissions are the union of what its Role/Scope assignments explicitly grant. There is no explicit-deny mechanism in MVP. This is a deliberate simplification — explicit deny significantly increases the difficulty of reasoning about effective permissions (conflicting allow/deny at different scopes) with no proven near-term requirement. Revisit only if a real customer scenario requires an exception carve-out that allow-only cannot express.

### 6. System roles first; custom roles deferred (`OD-TEN-004`, `BR-ROL-102`–`103`)

MVP ships a fixed catalog of system roles with well-defined permission grants. Custom, tenant-authored roles are explicitly out of scope until the system-role permission catalog has proven stable in production. System roles may be assigned per-Membership with a Scope (see ADR-0005), but their underlying permission grants are not tenant-editable in MVP.

### 7. Role assignment carries an explicit Scope; Job titles never grant permission (`BR-ROL-100`–`101`)

A Role assignment is the tuple `(Role, Membership, Scope, effective dates, grant source)`. Free-text job titles or display labels never substitute for a real Role/Scope assignment. (Scope types themselves — tenant-wide, location, warehouse, terminal — are fixed by ADR-0005, not this ADR.)

## Alternatives Considered

1. **Keep a single global `role` enum per User, add `tenant_id` to `User`.** Rejected: this still only allows one Tenant and one Role per person; it cannot express "same person, two Tenants, different Memberships/Roles," which the Blueprint requires (`BR-PID-100`).
2. **Explicit-deny permission model from the start.** Rejected for MVP: adds evaluation complexity (grant/deny precedence, scope conflict resolution) not currently justified; deferred per `OD-TEN-005` until a concrete need appears.
3. **Custom roles in MVP.** Rejected for MVP: increases the permission-catalog surface before the system-role catalog itself is proven; deferred per `OD-TEN-004`.
4. **Multiple simultaneous active Owners with no last-owner protection.** Rejected: violates `BR-OWN-100`; co-owners are allowed (`OD-TEN-003` proposes supporting this), but the last-Owner safeguard is non-negotiable regardless of how many Owners currently exist.

## Consequences

- WP-005 Phase B introduces `Membership` (and, per the smaller-safer-change analysis it must document, either a thin new Platform Identity layer above `User` or a repurposed `User`) plus one Membership per existing `User`, mapped from the legacy `Role` enum to an equivalent Membership role assignment (MT-MIG-003). The legacy `Role` enum and `User.branch_id` are **not** removed or enforced against in Phase B — only added-to.
- WP-006 must build the authorization/permission evaluator around allow-only, system-roles-first semantics described here; it must not silently introduce deny rules or custom roles without a new ADR.
- Ownership-transfer as a distinct, auditable, step-up-protected workflow is required before WP-006/WP-007 can allow removing an Owner Membership — this ADR does not itself implement that workflow, only mandates that it must exist before the invariant can be relied upon operationally.
- Any future support for explicit deny or custom roles requires a new ADR superseding item 5/6 of this Decision, not a quiet code change.

## Security / Data / Operational Impact

Membership independence (item 2) is a security-relevant guarantee: a compromised or terminated Membership in one Tenant must not be assumed to imply anything about the same Identity's standing elsewhere. This must be testable in WP-006/WP-007 (Blueprint §122's Authorization Test Catalog: "Membership A does not grant B").

## Compatibility and Migration

MT-MIG-003 (WP-005 Phase B) implements the User→Identity/Membership expand step described here. The exact mechanism (new layer above `User` vs. repurposing `User`) is a Phase B implementation decision, to be documented in that PR and the Delivery Log, constrained to whichever is the smaller, safer, purely-additive change given the actual `User` model in `schema.prisma` at that time.

## Validation / Acceptance

- [ ] Osama has reviewed and set this file's `Status:` to `Accepted`.
- [ ] WP-005 Phase B's Membership seeding is traceable to Decision items 2–4 and 7.
- [ ] WP-006's permission evaluator design is traceable to Decision items 5–6.

## Review or Expiry

Review when `OD-TEN-003` (multiple Owners), `OD-TEN-004` (custom roles), or `OD-TEN-005` (explicit deny) is revisited with a concrete customer requirement. No fixed expiry.
