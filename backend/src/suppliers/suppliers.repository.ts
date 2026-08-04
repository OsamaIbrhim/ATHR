import { Injectable } from '@nestjs/common';
import type { Prisma, Supplier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export interface SupplierFilters {
  readonly search?: string;
}

/** WP-007 Phase A §A.3.2 — tenant-scoped repository for the `suppliers` module. */
@Injectable()
export class SuppliersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<Supplier | null> {
    return this.prisma.supplier.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async findByIdWithRecentPurchases(context: TenantScope, id: string) {
    return this.prisma.supplier.findFirst({
      where: { id, tenant_id: context.tenantId },
      include: {
        purchases: {
          where: { tenant_id: context.tenantId },
          take: 10,
          orderBy: { created_at: 'desc' },
        },
      },
    });
  }

  async list(context: TenantScope, filters: SupplierFilters = {}): Promise<Supplier[]> {
    const search = filters.search;
    return this.prisma.supplier.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as Prisma.QueryMode } },
                { company_name: { contains: search, mode: 'insensitive' as Prisma.QueryMode } },
                { alias_names: { has: search } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async save(context: TenantScope, data: Prisma.SupplierCreateInput): Promise<Supplier> {
    return this.prisma.supplier.create({ data: { ...data, tenant_id: context.tenantId } });
  }

  async update(context: TenantScope, id: string, data: Prisma.SupplierUpdateInput): Promise<Supplier> {
    await this.assertInTenant(context, id);
    return this.prisma.supplier.update({ where: { id }, data });
  }

  async remove(context: TenantScope, id: string): Promise<Supplier> {
    await this.assertInTenant(context, id);
    return this.prisma.supplier.delete({ where: { id } });
  }

  private async assertInTenant(context: TenantScope, id: string): Promise<void> {
    if (!(await this.findById(context, id))) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Supplier ${id} not found.`);
    }
  }
}
