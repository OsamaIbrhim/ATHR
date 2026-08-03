import { Injectable } from '@nestjs/common';
import type { AccessScopeAssignment, AccessScopeType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { TenantScope } from './tenant-context.type';

export interface CreateAccessScopeAssignmentInput {
  readonly membershipId: string;
  readonly scopeType: AccessScopeType;
  readonly scopeRefId: string | null;
  readonly grantSource: string;
}

export interface AccessScopeAssignmentFilters {
  readonly membershipId?: string;
  readonly effectiveOnly?: boolean;
}

/**
 * Tenant-scoped per Multi-tenancy Blueprint §29 — every method takes
 * `TenantContext` explicitly and cross-checks the Membership actually
 * belongs to `context.tenantId` before touching its scope assignments, so a
 * caller can never read/write another Tenant's Access Scope rows by guessing
 * a membership id.
 */
@Injectable()
export class AccessScopeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<AccessScopeAssignment | null> {
    return this.prisma.accessScopeAssignment.findFirst({
      where: { id, membership: { tenantId: context.tenantId } },
    });
  }

  async list(context: TenantScope, filters: AccessScopeAssignmentFilters): Promise<AccessScopeAssignment[]> {
    return this.prisma.accessScopeAssignment.findMany({
      where: {
        membership: { tenantId: context.tenantId },
        ...(filters.membershipId ? { membership_id: filters.membershipId } : {}),
        ...(filters.effectiveOnly ? { effective_to: null } : {}),
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async save(context: TenantScope, input: CreateAccessScopeAssignmentInput): Promise<AccessScopeAssignment> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: input.membershipId, tenantId: context.tenantId },
    });
    if (!membership) {
      throw new AthrDomainError('MEMBERSHIP_NOT_FOUND', `Membership ${input.membershipId} not found in this Tenant.`);
    }

    return this.prisma.accessScopeAssignment.create({
      data: {
        membership_id: input.membershipId,
        scope_type: input.scopeType,
        scope_ref_id: input.scopeRefId,
        grant_source: input.grantSource,
      },
    });
  }

  async revoke(context: TenantScope, id: string): Promise<AccessScopeAssignment> {
    const existing = await this.findById(context, id);
    if (!existing) {
      throw new AthrDomainError('MEMBERSHIP_NOT_FOUND', `Access Scope assignment ${id} not found in this Tenant.`);
    }
    return this.prisma.accessScopeAssignment.update({
      where: { id },
      data: { effective_to: new Date() },
    });
  }
}
