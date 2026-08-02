# ADR-0006: Platform Boundary

**Status:** Accepted
**Author:** ATHR Planning (reviewed and finalized directly, not CLI-authored)
**Requires approval from:** Osama (project owner) before Phase B may begin

- **Date:** 2026-08-02
- **Work package:** WP-005 Phase A
- **Related docs:** `ATHR Tenant, Organization, Locations & User Membership Business Rules v1.0` §20–21 (BR-PLT-100–103, BR-SUPA-100–105); `ATHR Multi-tenancy Blueprint v1.0` §79–84 (Platform Support Access), §100 (Audit); `ATHR Database Blueprint v1.0` §6 (Platform Identity Schema)

## Context

ATHR's own operating team (Platform Operators) needs some operational visibility and, occasionally, temporary access into customer (Tenant) data to provide support. Without an explicit boundary, this is a classic path to accidental standing super-admin access, silent impersonation, and unauditable data exposure — exactly the failure mode `BR-PLT-100`–`103` and `BR-SUPA-100`–`105` exist to prevent. This ADR fixes that boundary before any Platform Operator concept, Support Access grant, or Platform Admin surface (`Code Gap Analysis` Stage 9) is built.

## Decision

### 1. Platform Operator identity is never a standing Tenant Membership (`BR-PLT-100`, `MT §79`)

A Platform Operator (someone on ATHR's own team) does **not** automatically receive a Membership in any Tenant by virtue of being a Platform Operator. There is no "super Membership" or implicit backdoor role. Platform-operational permissions (manage tenant billing state, investigate infrastructure, manage platform incidents, approve emergency access — `BR-PLT-102`) are entirely separate from any Tenant's own permission catalog.

### 2. No default access to tenant data (`BR-PLT-101`)

A Platform Operator sees only limited, non-sensitive operational metadata by default (e.g. Tenant lifecycle state, terminal fleet health, sync health) appropriate to their platform role. Entering actual Tenant business data requires a Support Access grant per item 3 — there is no ambient or "break in case of curiosity" path.

### 3. Support Access is temporary, purpose-bound, and audited (`BR-SUPA-100`–`105`, `MT §80`–`84`)

A Support Access grant must record: operator identity, tenant, purpose/ticket, permissions/scopes, start/expiry, approval, step-up evidence (where applicable), read-only vs. mutation limits, and reason. It is bounded in time and scope, not a standing credential. Four support modes exist, in increasing sensitivity: metadata-only, read-only diagnostic, assisted operation (command-level, approved, extra-audited), and break-glass (critical incident only, short window, mandatory notification and post-hoc review — `MT §81`). Customer (Tenant Owner/Admin) consent is required by default before any grant beyond metadata-only; break-glass is the sole exception, and is held to a higher audit standard specifically because it bypasses that consent (`OD-TEN-008`).

### 4. Impersonation is never silent (`BR-PLT-103`, `MT §82`)

Any action taken by a Platform Operator on behalf of, or appearing on behalf of, a Tenant user must be visibly marked as a Support session in any UI, and every audit record must capture the **real** operator identity and the **effective** Tenant/Membership context together — never presented as if the Tenant's own user performed the action. Using the customer's own password or token to act is prohibited; Support sessions use their own distinct credential/session path. A full silent "log in as the customer" capability is not built.

### 5. Data masking applies by default during Support Access (`MT §83`)

By default, Support Access shows masked PII, no payment secrets, and no unrestricted exports. Seeing unmasked sensitive fields requires an additional, separately-justified permission/approval beyond the base grant.

### 6. Revocation is immediate and cascades to sessions (`MT §84`, `BR-SUPA-104`)

A Support Access grant is revocable at any time; revocation immediately invalidates every session/token issued under that grant.

## Alternatives Considered

1. **Give Platform Operators a standing "super Tenant" role that can access any Tenant.** Rejected: directly violates `BR-PLT-100`/`101`; makes every Platform Operator credential a single point of total compromise across all customers, and cannot satisfy the audit/consent requirements in items 3–4.
2. **Allow Platform Operators to log in as the customer using the customer's own session for troubleshooting speed.** Rejected: this is exactly the silent-impersonation pattern `BR-PLT-103` forbids; it also makes audit trails misattribute actions to the customer.
3. **Skip customer consent for all Support Access to reduce support friction.** Rejected for the default path: `BR-SUPA-101` requires consent by default; only a narrowly-scoped break-glass exception is allowed, and that exception carries a higher audit bar specifically because it lacks consent (`OD-TEN-008`).

## Consequences

- WP-009+ (Platform Admin / Support Access, per `Code Gap Analysis` Stage 9) must implement Support Access as its own first-class, time-boxed, audited grant entity — not as a Role or Membership variant.
- Any Platform Admin surface must visually and structurally separate "operating my own platform-level tools" from "currently inside a Tenant's data under a Support grant," per item 4.
- WP-005 Phase B itself does no Platform Operator or Support Access work (it is schema-and-backfill only for Tenant/Organization/Location data); this ADR governs later WPs, but must be Accepted now per the Stage 2 Entry Gate.
- Any exception to the default-consent rule (item 3) beyond documented break-glass requires its own incident-level audit trail, not just a normal Support Access log entry.

## Security / Data / Operational Impact

This is the single highest-leverage security boundary in the whole multi-tenancy design: a mistake here (an accidental standing cross-tenant credential, or silent impersonation) compromises every customer simultaneously, not just one. WP-006/WP-007's cross-tenant test suite (Blueprint §127, "Support Access Tests") must cover: no standing access, grant expiry/scope enforcement, step-up/approval, impersonation banner/effective-actor recording, PII masking, and break-glass audit/revocation — each traceable to a Decision item above.

## Compatibility and Migration

No schema or migration impact from this ADR in WP-005 Phase B. It constrains the design of the future Support Access / Platform Admin work (Stage 9).

## Validation / Acceptance

- [ ] Osama has reviewed and set this file's `Status:` to `Accepted`.
- [ ] Future Support Access implementation (Stage 9 WP) references this ADR and implements Decision items 1–6 as testable invariants.

## Review or Expiry

Review before Stage 9 (Platform Admin and Operations) begins detailed design, to confirm the grant model here still matches the chosen Platform Admin architecture. No fixed expiry.
