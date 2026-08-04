import { Injectable } from '@nestjs/common';
import type { Branch, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export interface BranchFilters {
  readonly activeOnly?: boolean;
}

/**
 * WP-007 Phase A §A.3.2 — tenant-scoped repository for the `branches` module.
 *
 * `Branch` is the legacy operational root that WP-005 Phase B superseded with
 * `Location`. Both still exist; the legacy column removal is Phase D (§A.4),
 * so this scopes the `Branch` table as it stands today rather than switching
 * any consumer over to `Location`.
 */
@Injectable()
export class BranchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<Branch | null> {
    return this.prisma.branch.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async list(context: TenantScope, filters: BranchFilters = {}): Promise<Branch[]> {
    return this.prisma.branch.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(filters.activeOnly === false ? {} : { is_active: true }),
      },
    });
  }

  async save(context: TenantScope, data: Prisma.BranchCreateInput): Promise<Branch> {
    return this.prisma.branch.create({ data: { ...data, tenant_id: context.tenantId } });
  }

  /** Used by every module that accepts a caller-supplied `branch_id`. */
  async assertInTenant(context: TenantScope, id: string): Promise<Branch> {
    const branch = await this.findById(context, id);
    if (!branch) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Branch ${id} not found.`);
    }
    return branch;
  }
}
