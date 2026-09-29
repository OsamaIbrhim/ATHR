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

  /**
   * Creates the branch and its default selling warehouse atomically. Pass `tx`
   * to run inside a caller's transaction (tenant signup).
   */
  async save(
    context: TenantScope,
    data: Omit<Prisma.BranchCreateInput, 'tenant_id'>,
    tx?: Prisma.TransactionClient,
  ): Promise<Branch> {
    const create = async (client: Prisma.TransactionClient) => {
      const branch = await client.branch.create({ data: { ...data, tenant_id: context.tenantId } });
      await client.warehouse.create({
        data: {
          tenant_id: context.tenantId,
          branch_id: branch.id,
          name: `${data.name_ar} — Default Warehouse`,
          is_default: true,
        },
      });
      return branch;
    };
    return tx ? create(tx) : this.prisma.$transaction(create);
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
