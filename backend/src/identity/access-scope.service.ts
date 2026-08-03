import { Injectable } from '@nestjs/common';
import type { AccessScopeAssignment, AccessScopeType } from '@prisma/client';
import { DomainFailure, Result, fail, ok } from '@athr/domain-core';
import { AccessScopeRepository } from './access-scope.repository';
import { TenantScope } from './tenant-context.type';

export interface AssignAccessScopeInput {
  readonly membershipId: string;
  readonly scopeType: AccessScopeType | null | undefined;
  readonly scopeRefId: string | null | undefined;
  readonly grantSource: string;
}

/**
 * BR-SCP-101 (ADR-0005 item 2): an Access Scope with no explicit value is
 * never interpreted as tenant-wide. This is the single write-time gate that
 * makes "no scope set" a rejected, distinguishable state rather than a
 * silent maximally-permissive default — the exact privilege-escalation
 * class of bug the ADR calls out.
 */
@Injectable()
export class AccessScopeService {
  constructor(private readonly repository: AccessScopeRepository) {}

  async assign(
    context: TenantScope,
    input: AssignAccessScopeInput,
  ): Promise<Result<AccessScopeAssignment, DomainFailure>> {
    if (!input.scopeType) {
      return fail({
        code: 'ACCESS_SCOPE_REQUIRED',
        message: 'An explicit scope_type is required — an absent/empty scope is never implicitly tenant-wide.',
      });
    }

    if (input.scopeType !== 'tenant_wide' && !input.scopeRefId) {
      return fail({
        code: 'ACCESS_SCOPE_REFERENCE_REQUIRED',
        message: `scope_ref_id is required for scope_type "${input.scopeType}".`,
      });
    }

    const record = await this.repository.save(context, {
      membershipId: input.membershipId,
      scopeType: input.scopeType,
      scopeRefId: input.scopeType === 'tenant_wide' ? null : (input.scopeRefId as string),
      grantSource: input.grantSource,
    });
    return ok(record);
  }

  async listForMembership(context: TenantScope, membershipId: string): Promise<AccessScopeAssignment[]> {
    return this.repository.list(context, { membershipId, effectiveOnly: true });
  }

  async revoke(context: TenantScope, id: string): Promise<AccessScopeAssignment> {
    return this.repository.revoke(context, id);
  }
}
