import { Injectable } from '@nestjs/common';
import { DomainFailure, Result, fail, ok, parseMembershipId, parseTenantId } from '@athr/domain-core';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionPolicyService } from './permission-policy.service';
import { ActorType, ScopeGrant, TenantContext } from './tenant-context.type';

export interface ResolveTenantContextInput {
  readonly authenticatedIdentityId: string;
  readonly requestedTenantId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly selectedLocationId?: string | null;
  readonly selectedWarehouseId?: string | null;
  readonly terminalId?: string | null;
  readonly supportGrantId?: string | null;
  readonly actorType?: ActorType;
}

/**
 * Builds a `TenantContext` from an authenticated request (Multi-tenancy
 * Blueprint §22 "Context Creation" — one trust boundary). Implemented as a
 * plain NestJS provider, **not** a global guard — per WP-006 §2 item 1, the
 * global wiring onto every existing route is WP-007's job. Callers (this
 * WP's own new controllers) invoke `resolve(...)` explicitly.
 *
 * Fails closed (`TENANT_CONTEXT_UNRESOLVABLE`) rather than guessing, per
 * `BR-TERR-105` / Blueprint §18 — a mismatch never returns a partial result.
 */
@Injectable()
export class TenantContextResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionPolicy: PermissionPolicyService,
  ) {}

  async resolve(input: ResolveTenantContextInput): Promise<Result<TenantContext, DomainFailure>> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: input.requestedTenantId } });
    if (!tenant) {
      return fail({
        code: 'TENANT_CONTEXT_UNRESOLVABLE',
        message: `Tenant ${input.requestedTenantId} does not exist.`,
      });
    }

    const membership = await this.prisma.membership.findUnique({
      where: { identityId_tenantId: { identityId: input.authenticatedIdentityId, tenantId: input.requestedTenantId } },
      include: { access_scope_assignments: true },
    });

    if (!membership || membership.status !== 'active') {
      return fail({
        code: 'TENANT_CONTEXT_UNRESOLVABLE',
        message: 'No active Membership for this Identity in the requested Tenant.',
      });
    }

    const now = new Date();
    const scopeSet: ScopeGrant[] = membership.access_scope_assignments
      .filter((assignment) => assignment.effective_from <= now && (!assignment.effective_to || assignment.effective_to > now))
      .map((assignment) => ({ scopeType: assignment.scope_type, scopeRefId: assignment.scope_ref_id }));

    const permissionPolicyVersion = await this.permissionPolicy.getCurrentVersion();

    const context: TenantContext = {
      tenantId: parseTenantId(tenant.id),
      membershipId: parseMembershipId(membership.id),
      servicePrincipalId: null,
      authenticatedIdentityId: input.authenticatedIdentityId,
      tenantAccessMode: tenant.access_mode,
      entitlementSnapshotVersion: null,
      permissionPolicyVersion,
      scopeSet,
      selectedLocationId: input.selectedLocationId ?? null,
      selectedWarehouseId: input.selectedWarehouseId ?? null,
      terminalId: input.terminalId ?? null,
      supportGrantId: input.supportGrantId ?? null,
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorType: input.actorType ?? 'human',
    };

    return ok(context);
  }
}
