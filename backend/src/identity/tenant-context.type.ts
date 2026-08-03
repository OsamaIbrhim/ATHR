import type { MembershipId, TenantId } from '@athr/domain-core';

/**
 * The application-layer context contract — Multi-tenancy Blueprint v1.0 §20
 * ("TenantContext Fields"), field-for-field. Built once per Command/Query at
 * a single trust boundary (§22) and immutable for the lifetime of that
 * Command/Query (§21) — never mutated mid-request, never reconstructed from
 * a client-supplied value alone (§17 "Untrusted Inputs").
 *
 * This WP introduces the type and a resolver provider only (§2 item 1 of
 * WP-006) — it is not yet wired as a global guard; every consumer in this WP
 * calls `TenantContextResolver.resolve(...)` explicitly. WP-007 does the
 * global wiring (MT-MIG-005/006).
 */
export type ActorType = 'human' | 'service_principal' | 'platform_operator';

export type AccessScopeType = 'tenant_wide' | 'location' | 'warehouse' | 'terminal';

/** BR-SCP-101: `scopeRefId` is null only when `scopeType` is `tenant_wide`. */
export interface ScopeGrant {
  readonly scopeType: AccessScopeType;
  readonly scopeRefId: string | null;
}

export interface TenantContext {
  readonly tenantId: TenantId;
  readonly membershipId: MembershipId | null;
  readonly servicePrincipalId: string | null;
  readonly authenticatedIdentityId: string;
  readonly tenantAccessMode: string;
  readonly entitlementSnapshotVersion: number | null;
  readonly permissionPolicyVersion: number;
  readonly scopeSet: readonly ScopeGrant[];
  readonly selectedLocationId: string | null;
  readonly selectedWarehouseId: string | null;
  readonly terminalId: string | null;
  readonly supportGrantId: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly actorType: ActorType;
}

/**
 * The resolved subset a repository method actually needs (Architecture
 * Rules §4: "TenantContext (or the resolved subset it needs)"). Every new
 * repository in this WP is tenant-scoped by `tenantId` alone — a full
 * `TenantContext` satisfies this trivially, and a bootstrap flow that has
 * only derived a `tenantId` (e.g. invitation acceptance, before any
 * Membership/permission context exists for the accepting Identity) can
 * pass a minimal, honestly-typed value instead of fabricating a full one.
 */
export type TenantScope = Pick<TenantContext, 'tenantId'>;
