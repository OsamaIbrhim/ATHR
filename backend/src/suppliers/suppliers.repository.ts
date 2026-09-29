import { Injectable } from '@nestjs/common';
import type { Prisma, Supplier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';
import { FIRST_PAGE, PageQueryDto, pageArgs, pageOf, type PageQuery } from '../common/pagination';

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

  async list(context: TenantScope, filters: SupplierFilters = {}, paging: PageQuery = FIRST_PAGE) {
    const search = filters.search;
    const where: Prisma.SupplierWhereInput = {
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
    };
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(paging) }),
      this.prisma.supplier.count({ where }),
    ]);
    return pageOf(items, total, paging);
  }

  /** The supplier an OCR'd name refers to: its name, company name or a recorded alias. */
  findByAnyName(context: TenantScope, name: string): Promise<Supplier | null> {
    return this.prisma.supplier.findFirst({
      where: {
        tenant_id: context.tenantId,
        OR: [{ name }, { company_name: name }, { alias_names: { has: name } }],
      },
      orderBy: { name: 'asc' },
    });
  }

  async save(context: TenantScope, data: Omit<Prisma.SupplierCreateInput, 'tenant_id'>): Promise<Supplier> {
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
