import { Injectable } from '@nestjs/common';
import type { Brand, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export interface BrandFilters {
  readonly search?: string;
  readonly activeOnly?: boolean;
}

/** WP-008 Phase A — tenant-scoped repository for the `brands` module, same contract as WP-007's `branches`/`suppliers`. */
@Injectable()
export class BrandsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<Brand | null> {
    return this.prisma.brand.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async findByName(context: TenantScope, name: string): Promise<Brand | null> {
    return this.prisma.brand.findFirst({ where: { tenant_id: context.tenantId, name } });
  }

  async list(context: TenantScope, filters: BrandFilters = {}): Promise<Brand[]> {
    return this.prisma.brand.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(filters.activeOnly === false ? {} : { is_active: true }),
        ...(filters.search
          ? { name: { contains: filters.search, mode: 'insensitive' as Prisma.QueryMode } }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async save(context: TenantScope, data: Omit<Prisma.BrandCreateInput, 'tenant_id'>): Promise<Brand> {
    return this.prisma.brand.create({ data: { ...data, tenant_id: context.tenantId } });
  }

  async update(context: TenantScope, id: string, data: Prisma.BrandUpdateInput): Promise<Brand> {
    await this.assertInTenant(context, id);
    return this.prisma.brand.update({ where: { id }, data });
  }

  async assertInTenant(context: TenantScope, id: string): Promise<Brand> {
    const brand = await this.findById(context, id);
    if (!brand) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Brand ${id} not found.`);
    }
    return brand;
  }
}
