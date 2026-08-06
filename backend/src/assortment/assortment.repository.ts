import { Injectable } from '@nestjs/common';
import type { Assortment, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export interface AssortmentFilters {
  readonly branchId?: string;
  readonly variantId?: string;
}

export interface AssortmentFlags {
  readonly isSellable?: boolean;
  readonly isPurchasable?: boolean;
  readonly isDisplayable?: boolean;
}

/**
 * WP-008 Phase A (BR-AST-1xx) — tenant-scoped repository for the
 * `assortment` module: per-Branch sellability/purchasability/displayability,
 * distinct from `Product.is_active` (tenant-wide).
 */
@Injectable()
export class AssortmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<Assortment | null> {
    return this.prisma.assortment.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async findOne(context: TenantScope, branchId: string, variantId: string): Promise<Assortment | null> {
    return this.prisma.assortment.findFirst({
      where: { tenant_id: context.tenantId, branch_id: branchId, variant_id: variantId },
    });
  }

  async list(context: TenantScope, filters: AssortmentFilters = {}): Promise<Assortment[]> {
    return this.prisma.assortment.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(filters.branchId ? { branch_id: filters.branchId } : {}),
        ...(filters.variantId ? { variant_id: filters.variantId } : {}),
      },
    });
  }

  /**
   * BR-AST-100: one flags row per (Branch, Variant). `save` finds-then-writes
   * rather than a Prisma compound-unique `upsert` — callers don't need to
   * know whether a row already exists, only the flags they want in force.
   */
  async save(
    context: TenantScope,
    branchId: string,
    variantId: string,
    flags: AssortmentFlags,
  ): Promise<Assortment> {
    const existing = await this.findOne(context, branchId, variantId);
    if (existing) {
      const data: Prisma.AssortmentUpdateInput = {
        ...(flags.isSellable !== undefined ? { is_sellable: flags.isSellable } : {}),
        ...(flags.isPurchasable !== undefined ? { is_purchasable: flags.isPurchasable } : {}),
        ...(flags.isDisplayable !== undefined ? { is_displayable: flags.isDisplayable } : {}),
      };
      return this.prisma.assortment.update({ where: { id: existing.id }, data });
    }
    return this.prisma.assortment.create({
      data: {
        tenant_id: context.tenantId,
        branch_id: branchId,
        variant_id: variantId,
        is_sellable: flags.isSellable ?? true,
        is_purchasable: flags.isPurchasable ?? true,
        is_displayable: flags.isDisplayable ?? true,
      },
    });
  }

  async assertInTenant(context: TenantScope, id: string): Promise<Assortment> {
    const row = await this.findById(context, id);
    if (!row) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Assortment row ${id} not found.`);
    }
    return row;
  }
}
