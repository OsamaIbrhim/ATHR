# ADR-0005: Authorization / Entitlements Boundary

**Status:** Accepted
**Author:** ATHR Planning (reviewed and finalized directly, not CLI-authored)
**Requires approval from:** Osama (project owner) before Phase B may begin

- **Date:** 2026-08-02
- **Work package:** WP-005 Phase A
- **Related docs:** `ATHR Tenant, Organization, Locations & User Membership Business Rules v1.0` §16 (BR-SCP-100–106); `ATHR Multi-tenancy Blueprint v1.0` §92–96 (Entitlements and Limits); `Code Gap Analysis — 2026-07-29` (Stage 5 — Plans and Entitlements: "Permission: هل المستخدم يستطيع تنفيذ العملية؟ Entitlement: هل اشتراك Tenant يحتوي على الميزة؟ Limit: كم موردًا مسموحًا؟")

## Context

Two independent questions are easy to accidentally collapse into one during implementation: "can this Membership perform this operation" (permission/scope, evaluated per-Membership) and "does this Tenant's subscription include this capability at all" (entitlement, evaluated per-Tenant/per-plan). `Code Gap Analysis` explicitly separates these and defers entitlement *implementation* to WP-022 (Billing/Plans), but requires the *conceptual* boundary to be fixed now (Stage 0A gate) so that WP-006's permission model does not later collide with or duplicate WP-022's entitlement model. This ADR draws that line before either is implemented.

## Decision

### 1. Access Scope types are fixed now (`BR-SCP-100`)

The initial Access Scope types are: `tenant-wide`, `location`, `warehouse`, `terminal` (where applicable). A future `own-record`/self-service scope is acknowledged as a later addition and is not implemented in WP-005/006/007.

### 2. Empty scope is never implicitly tenant-wide (`BR-SCP-101`)

An Access Scope with no explicit value is a bug or an incomplete grant — it must **never** be interpreted as "tenant-wide" by default. `tenant-wide` is only granted by an explicit, visibly-flagged assignment (`BR-ADM-103`: tenant-wide grants require a clear warning in the granting UI/workflow).

### 3. Permission, Entitlement, and Limit are three separate concerns

- **Permission** — "can this Membership, given its Role/Scope assignments, perform this operation?" Owned by the Authorization subsystem (WP-006). Evaluated per-Membership.
- **Entitlement** — "does this Tenant's active subscription/plan include this feature at all?" Owned by the Billing/Entitlements subsystem (WP-022, per `Code Gap Analysis` Stage 5). Evaluated per-Tenant.
- **Limit** — "how many of this resource, or how much of this usage, is this Tenant's plan allowed?" Also owned by Billing/Entitlements (WP-022). Evaluated per-Tenant, per-resource-type.

None of the three may be merged into another's implementation. A permission check must never silently also enforce a plan limit, and an entitlement check must never substitute for a real per-Membership permission check. Final effective access for any operation is the **intersection** of all three that apply — consistent with the Entity Ownership Matrix's cross-context rule: "User permission | Authorization | Billing | Decision; final access is permission ∩ scope ∩ entitlement."

### 4. WP-005/006 build the Permission/Scope side only; WP-022 builds Entitlement/Limit later

WP-005 Phase B does not implement any authorization logic (it is explicitly out of scope per the WP-005 document, §B.4 "Out of scope"). WP-006 implements Membership/Role/Scope evaluation per items 1–3 above. Entitlement and Limit evaluation is deferred to WP-022 and must be designed, when it arrives, to compose with — not replace or duplicate — the Permission/Scope evaluator this ADR anchors.

## Alternatives Considered

1. **Fold Entitlement checks into the Authorization/Permission evaluator now, to avoid building two systems.** Rejected: conflates two independently-changing concerns (a Tenant's plan changes on its own commercial timeline; a Membership's role changes on its own operational timeline) and would force WP-006 to depend on Billing concepts (Plan, Subscription) that do not exist yet, blocking WP-006 on WP-022's schedule for no benefit.
2. **Treat "empty scope" as tenant-wide by default to simplify early role definitions.** Rejected: directly violates `BR-SCP-101` and is a well-known privilege-escalation class of bug (an incomplete/buggy scope assignment silently becoming maximally permissive instead of maximally restrictive).
3. **Add a fifth scope type (`own-record`) now even though nothing consumes it yet.** Rejected: no current use case; adding unused scope types early only expands the authorization surface WP-006 must test without benefit — deferred until a real self-service feature needs it.

## Consequences

- WP-006 must implement Membership/Role/Scope evaluation using exactly the four scope types in Decision item 1, with the empty-scope-is-never-tenant-wide rule as a hard-enforced invariant (ideally with a dedicated regression test: an assignment with a null/empty scope value must be rejected at write time, not silently interpreted at read time).
- WP-022, when it begins, must be designed against the Permission ∩ Entitlement ∩ Limit composition model in Decision item 3 — it may not reach into or modify the Permission/Scope evaluator's internals.
- Any operation's authorization check in code must be traceable to which of the three concerns (or which combination) it is enforcing, so a reviewer can tell a permission bug from an entitlement bug from a limit bug.

## Security / Data / Operational Impact

Conflating these three concerns is a realistic source of both over-permissive bugs (empty scope defaulting to tenant-wide) and under-permissive bugs (a valid Role/Scope grant incorrectly blocked by a Billing-plan check that shouldn't apply to that operation). This ADR's separation is a security control, not just a code-organization preference.

## Compatibility and Migration

No schema or migration impact from this ADR directly — it constrains the design WP-006 and WP-022 must follow, not WP-005 Phase B's tables.

## Validation / Acceptance

- [ ] Osama has reviewed and set this file's `Status:` to `Accepted`.
- [ ] WP-006's authorization design references this ADR and implements Decision items 1–2 as hard invariants with tests.
- [ ] WP-022 (when scheduled) references this ADR for its integration boundary with WP-006's evaluator.

## Review or Expiry

Review when WP-022 (Plans/Entitlements) begins detailed design, to confirm the composition boundary in Decision item 3 still holds against the actual Billing model chosen. No fixed expiry.
