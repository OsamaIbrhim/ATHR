import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
 * `Branch` is the operational site (shop / branch). Its stock lives in
 * warehouses, so creating a branch creates its default warehouse in the same
 * transaction.
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

  async save(context: TenantScope, data: Omit<Prisma.BranchCreateInput, 'tenant_id'>): Promise<Branch> {
    const id = randomUUID();
    const [branch] = await this.prisma.$transaction([
      this.prisma.branch.create({ data: { ...data, id, tenant_id: context.tenantId } }),
      this.prisma.warehouse.create({
        data: {
          tenant_id: context.tenantId,
          branch_id: id,
          name: `${data.name_ar} — Default Warehouse`,
          is_default: true,
        },
      }),
    ]);
    return branch;
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
