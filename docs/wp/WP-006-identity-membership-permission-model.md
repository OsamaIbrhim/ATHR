# WP-006 — Identity, Membership and Permission Model

**Repository:** `OsamaIbrhim/bold_system`
**Base branch:** `master`
**Single branch/PR WP** (no ADR gate — the governing ADRs were already approved in WP-005 Phase A: `docs/adr/0003-identity-membership.md`, `docs/adr/0004-location-warehouse.md`, `docs/adr/0005-authorization-entitlements.md`, `docs/adr/0006-platform-boundary.md`).
**Depends on:** WP-005 Phase A (all 6 ADRs `Accepted`) and WP-005 Phase B (merged and deployed — `Tenant`, `OrganizationProfile`, `LegalEntity`, `Location`, `Warehouse`, `Membership` tables exist and are backfilled).
**Blocks:** WP-007 (Tenant Context Enforcement), and every domain WP from WP-008 onward that needs a real permission check.

---

## 0. Mandatory Pre-Flight

1. Read `docs/wp/WP-000-to-002-baseline-status.md`, `docs/wp/WP-003-api-and-error-contract-foundation.md`, `docs/wp/WP-004-core-value-objects.md`, `docs/wp/WP-005-tenant-organization-location-schema.md` in full.
2. Confirm WP-005 Phase B is actually merged to `master` and deployed: check `backend/prisma/schema.prisma` for `model Tenant`, `model Membership`, `model Location`, `model Warehouse` and confirm `git log` shows the Phase B PR merged. If it is not merged, **stop and report back** — do not attempt to build the identity/membership layer on schema that doesn't exist yet.
3. Confirm the 6 ADRs in `docs/adr/0002-*.md` through `docs/adr/0006-*.md` all show `Status: Accepted`. If any is still `Proposed`, stop and report back.
4. Read `docs/adr/0003-identity-membership.md`, `docs/adr/0005-authorization-entitlements.md`, and `docs/adr/0006-platform-boundary.md` closely — this WP is the direct implementation of the decisions recorded there. If anything in this WP doc appears to conflict with what an ADR actually says (ADRs may have been revised during Osama's review before acceptance), **the ADR wins** — follow the ADR text, not this document, and note the discrepancy in the PR description.
5. Read `docs/00-product/br-tenant-org-locations-membership.md` sections: `BR-MEM-*`, `BR-INVIT-*`, `BR-OWN-*`, `BR-ROL-*`, `BR-SCP-*`, `BR-SES-*`, `BR-SUS-*`, `BR-PLT-*`, `BR-SUPA-*`, and the 35 test scenarios relevant to membership/roles/scopes/sessions.
6. Read `docs/03-architecture/multi-tenancy-blueprint.md` §"TenantContext contract" and §"Platform Support Access" again, plus **§116 step MT-MIG-005 "Application dual-compatibility"** — this WP implements that step's identity/permission half only (data/repository dual-compatibility is WP-007's job).
7. Read `backend/src/**` current auth/session code (find it — likely `backend/src/modules/auth/` or similar) before writing anything. Understand exactly how JWTs/sessions are issued and validated today, and what existing clients (Admin, POS) read from them, so you know precisely what you must not break.
8. **Re-apply the WP-003/004/005 lesson from §0.3 of WP-005:** any new `packages/*` code must be proven against a clean `npm ci` across Backend build, Backend Docker build/run, POS/Vite, and Admin/Vercel before this WP is considered done — this is not optional, see §9.

---

## 1. Objective

Build the **application-layer** identity, membership, and permission model on top of the WP-005 schema: TenantContext resolution, Membership lifecycle (invite → accept → active → suspended → revoked), system roles with an allow-only permission policy, Access Scope assignment, the last-owner safeguard, and Platform Support Access grants — all as **new, additive** application code that existing endpoints do not yet depend on. This WP does **not** retrofit tenant enforcement onto any existing sales/inventory/catalog endpoint — that global rollout, plus making `tenant_id` `NOT NULL` and removing the legacy `Role`/`branch_id` fields, is WP-007's job. Think of this WP as building the new engine; WP-007 swaps it in.

## 2. Scope In

1. **TenantContext type and resolution service** (`backend/src/modules/identity/tenant-context/`): the full contract from the Multi-tenancy Blueprint (`tenant_id`, `membership_id`/`service_principal_id`, `authenticated_identity_id`, `tenant_access_mode`, `entitlement_snapshot_version`, `permission_policy_version`, `scope_set`, `selected_location_id`, `selected_warehouse_id`, `terminal_id`/`device_id`, `support_grant_id`, `request_id`, `correlation_id`, `actor_type`). A resolver function that builds this from an authenticated request. Implemented as a NestJS provider, **not yet wired as a global guard** — WP-007 does the global wiring.
2. **Membership lifecycle service and endpoints**, per `BR-MEM-*` and `BR-INVIT-*`:
   - Invitation: create invitation (email + target role + target scope), accept invitation, expire invitation, revoke invitation.
   - Membership state machine: `Invited → Active → Suspended → Revoked` (confirm exact state names against `BR-MEM-101` — use the business rules doc's terms verbatim, don't invent your own).
   - New Backend endpoints under `/api/v1/tenants/:tenantId/memberships` and `/api/v1/tenants/:tenantId/invitations`, using the WP-003 response/error envelope and idempotency-key contract (this is new code — no excuse to skip the WP-003 conventions).
3. **System roles and allow-only permission policy**, per `BR-ROL-*` and ADR `0005-authorization-entitlements.md`:
   - Seed the fixed set of system roles defined in the business rules doc (read it for the exact names/permission sets — do not invent role names).
   - A `PermissionPolicy` concept with a version stamp (`permission_policy_version`, matching the TenantContext field) so that a Membership's effective permissions are a resolvable, versioned snapshot, not a live join computed differently every time.
   - Custom roles are explicitly out of scope (`OD-TEN-004`, resolved in the ADR) — system roles only.
4. **Access Scope assignment**, per `BR-SCP-*`:
   - A Membership can be assigned Tenant-wide, Location-scoped, Warehouse-scoped, or Terminal-scoped access. Explicit Tenant-wide scope is never implied by an absent/empty scope (`BR-SCP-101`) — model this so "no scope set" is a distinguishable, invalid state that fails validation rather than silently defaulting to full access.
5. **Last-owner safeguard**, per `BR-OWN-100`: block any operation (role change, suspension, revocation) that would leave a Tenant with zero Active Owners. Must be enforced at the service layer with a test proving it can't be bypassed by any of the mutation endpoints.
6. **Session/token dual-compatibility**, per MT-MIG-005: extend whatever the current session/JWT issuance mechanism is to **additively** carry `tenant_id`, `membership_id`, `scope_set`, and `permission_policy_version` as new claims, alongside all existing claims unchanged. Existing Admin/POS clients that only read the old claims must keep working exactly as before — verify this explicitly (see §7).
7. **Platform Support Access grants**, per `BR-SUPA-*` and ADR `0006-platform-boundary.md`: a minimal grant model (create grant, time-boxed, audited, never a standing membership) — data model and service only; the actual support-tooling UI is out of scope (later WP).
8. New tenant-scoped repository interfaces for everything above, following the pattern from the Multi-tenancy Blueprint: `findById(context, id)`, `list(context, filters)`, `save(context, aggregate)` — no bare `findById(id)` anywhere in this WP's new code, since there's no legacy excuse for it here.
9. Value objects from `@athr/domain-core` (WP-004) used wherever applicable (opaque branded IDs for `TenantId`/`MembershipId`/`InvitationId`, `Result`/`DomainFailure` for service return types, `UtcTimestamp` for lifecycle timestamps) — respect the dependency direction lesson from WP-004: `domain-core` is never modified to depend on anything in this WP; this WP's new code depends on `domain-core`, one-way.

## 3. Scope Out (do not touch)

- No retrofitting of TenantContext enforcement onto any existing sales/inventory/catalog/customer endpoint — zero changes to `backend/src/modules/{sales,inventory,catalog,customers,...}` in this WP.
- No global auth guard wiring — the resolver exists as a provider; applying it globally is WP-007.
- `tenant_id` stays nullable everywhere; no composite FKs; no tenant-scoped uniqueness constraints added — still WP-007.
- No removal of the legacy `Role` enum or `branch_id` column.
- No RLS.
- No POS terminal enrollment/cutover logic.
- No entitlements/billing logic beyond the bare `entitlement_snapshot_version` field existing in the TenantContext type — actual entitlement computation is WP-022.
- No Admin or POS UI work — this is Backend-only. (If the session/token shape change requires any client-side awareness at all, it must be purely additive/ignorable by old clients — confirm this and do not add any required client change in this WP.)
- No custom roles.

## 4. Architecture Rules (non-negotiable)

- Every new repository method takes `TenantContext` (or the resolved subset it needs) as an explicit parameter — no ambient/global tenant state, no reliance on request-scoped DI magic that could silently leak between requests. Re-read Multi-tenancy Blueprint's Application Isolation rules before writing the first repository.
- Follow `ATHR Dependency Rules v1.0` exactly: new `backend/src/modules/identity/` code may depend on `@athr/contracts`, `@athr/domain-core`, `@athr/error-registry`; it must not be depended on by `packages/*` in the reverse direction.
- Use the WP-003 response envelope, error envelope, and Idempotency-Key guard on every new mutating endpoint — this WP is a good opportunity to prove those WP-003 conventions work end-to-end on a real feature, since WP-003 only migrated 2 pre-existing endpoints as proof-of-concept.
- Every new migration in this WP (for `Invitation`, `RoleAssignment`/`MembershipRole`, `AccessScope`, `PermissionPolicySnapshot`, `SupportAccessGrant` — exact table list depends on what you find already exists from WP-005's `Membership` table; check first) is additive-only, same discipline as WP-005 §B.5.

## 5. Files You Will Likely Create

```
backend/src/modules/identity/tenant-context/tenant-context.type.ts
backend/src/modules/identity/tenant-context/tenant-context.resolver.ts
backend/src/modules/identity/tenant-context/tenant-context.resolver.spec.ts
backend/src/modules/identity/membership/membership.service.ts
backend/src/modules/identity/membership/membership.repository.ts
backend/src/modules/identity/membership/membership.controller.ts
backend/src/modules/identity/membership/*.spec.ts
backend/src/modules/identity/invitation/invitation.service.ts
backend/src/modules/identity/invitation/invitation.controller.ts
backend/src/modules/identity/invitation/*.spec.ts
backend/src/modules/identity/roles/system-roles.seed.ts
backend/src/modules/identity/roles/permission-policy.service.ts
backend/src/modules/identity/roles/permission-policy.service.spec.ts
backend/src/modules/identity/scope/access-scope.service.ts
backend/src/modules/identity/scope/access-scope.service.spec.ts
backend/src/modules/identity/support-access/support-access-grant.service.ts
backend/src/modules/identity/support-access/support-access-grant.service.spec.ts
backend/prisma/migrations/<timestamp>_add_invitation_role_scope_tables/migration.sql
```

Confirm exact naming/folder conventions against 2-3 existing modules in `backend/src/modules/` before creating new ones — match house style, don't invent a new pattern.

## 6. Files You Will Modify

- `backend/prisma/schema.prisma` — additive tables only (as above).
- Whatever file currently issues/validates JWTs/sessions — additive claims only, confirm the exact file by reading the current auth module first (do not guess the path).
- `backend/src/app.module.ts` (or equivalent) — register the new `IdentityModule`.

Do not modify any other existing module.

## 7. Testing Requirements

- Unit tests for: Membership state machine (all valid/invalid transitions), last-owner safeguard (prove it blocks demotion/suspension/revocation of the sole Owner, and that it correctly allows the same operation when a second Active Owner exists), invitation expiry, Access Scope validation (explicit scope required, no implicit tenant-wide default), permission policy snapshot versioning.
- Integration tests: full invite → accept → active → suspend → reinstate → revoke flow through the actual HTTP endpoints, using the WP-003 envelope/idempotency conventions; a support-access grant creation + expiry test.
- **Dual-compatibility regression test:** issue a session/token before and after this WP's changes (or simulate an "old-shape" consumer) and prove that reading only the pre-existing claims still works identically — this is the single most important test in this WP given the MT-MIG-005 requirement and the WP-003/004 history of "worked locally, broke a real consumer."
- Full `npm run test:soft` for Backend must still pass unchanged for every module outside `identity/`.
- **Hardened acceptance criterion (per WP-005 §0.3, carried forward to every WP from here on):** clean `npm ci` at repo root, Backend build, Backend `docker build` + `docker run` + `GET /api/v1/health/ready`, POS/Vite build, Admin/Vercel-equivalent build — all verified green before this WP is considered done. If this WP doesn't touch POS or Admin source at all, still run their builds unchanged to confirm nothing broke by side effect (e.g. a schema/type change rippling through a shared package).

## 8. Acceptance Criteria (Definition of Done)

- [ ] WP-005 Phase B confirmed merged/deployed and all 6 ADRs confirmed `Accepted` before this WP's branch was created.
- [ ] TenantContext type matches the Multi-tenancy Blueprint contract field-for-field.
- [ ] Membership lifecycle service + endpoints implemented and tested end-to-end.
- [ ] Invitation flow implemented and tested end-to-end.
- [ ] System roles seeded exactly as named in the Business Rules doc; permission policy is versioned and snapshot-resolvable.
- [ ] Access Scope model implemented; empty/absent scope is a validation failure, never an implicit tenant-wide grant.
- [ ] Last-owner safeguard proven un-bypassable by test.
- [ ] Session/token claims extended additively; dual-compatibility regression test passes.
- [ ] Support Access grant model implemented (creation + time-box + audit fields; expiry logic tested).
- [ ] Zero changes to any existing sales/inventory/catalog/customer module.
- [ ] `tenant_id` still nullable everywhere; no composite FKs added; legacy `Role`/`branch_id` untouched.
- [ ] All new repository methods are tenant-context-scoped; zero bare `findById(id)` in new code.
- [ ] Full test:soft green outside `identity/`; full new-module test suite green.
- [ ] Clean `npm ci` + Backend build + Docker build/run + `/health/ready` + POS build + Admin build all verified green.
- [ ] Delivery Log entry appended for WP-006.

## 9. Branch, Commit and PR Instructions

Branch `feat/wp-006-identity-membership-permission` from `master`. One PR titled `WP-006: Identity, Membership and Permission Model`, referencing this document and the accepted ADRs 0003/0005/0006. Squash-merge after all required checks (including the hardened multi-consumer build proof from §7) pass green — no exceptions, given the direct history of WP-003/004 failures from unverified claims.

## 10. Prohibited in This WP

- No enforcement wiring on existing endpoints.
- No `NOT NULL` on `tenant_id`, no composite FKs, no tenant-scoped uniqueness constraints.
- No removal of legacy `Role` enum or `branch_id`.
- No RLS.
- No custom roles.
- No POS/Admin UI changes.
- No breaking change to any existing session/token claim (additive only).
- No claiming this WP "done" without the full clean-`npm ci` + Docker + POS + Admin build proof actually run and its output captured in the PR description.

## 11. Stop Conditions

- WP-005 Phase B not actually merged, or any ADR not `Accepted` — stop before branching.
- The current auth/session mechanism turns out to be structurally incompatible with additive claims (e.g., a fixed-schema token library that can't carry extra fields without a breaking version bump) — stop and report back with the specific constraint found, rather than forcing a breaking change through.
- Any existing test outside `identity/` starts failing — stop, root-cause, do not loosen the assertion.
