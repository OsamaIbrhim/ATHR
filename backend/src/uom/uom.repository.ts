import { Injectable } from '@nestjs/common';
import type { Prisma, UnitOfMeasure, UomConversion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export interface UomFilters {
  readonly activeOnly?: boolean;
}

export interface UomConversionFilters {
  readonly fromUomId?: string;
  readonly toUomId?: string;
}

/** WP-008 Phase A — tenant-scoped repository for the `uom` module (BR-UOM-1xx). */
@Injectable()
export class UomRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<UnitOfMeasure | null> {
    return this.prisma.unitOfMeasure.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async findByCode(context: TenantScope, code: string): Promise<UnitOfMeasure | null> {
    return this.prisma.unitOfMeasure.findFirst({ where: { tenant_id: context.tenantId, code } });
  }

  async list(context: TenantScope, filters: UomFilters = {}): Promise<UnitOfMeasure[]> {
    return this.prisma.unitOfMeasure.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(filters.activeOnly === false ? {} : { is_active: true }),
      },
      orderBy: { code: 'asc' },
    });
  }

  async save(
    context: TenantScope,
    data: Omit<Prisma.UnitOfMeasureCreateInput, 'tenant_id'>,
  ): Promise<UnitOfMeasure> {
    return this.prisma.unitOfMeasure.create({ data: { ...data, tenant_id: context.tenantId } });
  }

  async update(
    context: TenantScope,
    id: string,
    data: Prisma.UnitOfMeasureUpdateInput,
  ): Promise<UnitOfMeasure> {
    await this.assertInTenant(context, id);
    return this.prisma.unitOfMeasure.update({ where: { id }, data });
  }

  async assertInTenant(context: TenantScope, id: string): Promise<UnitOfMeasure> {
    const uom = await this.findById(context, id);
    if (!uom) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Unit of Measure ${id} not found.`);
    }
    return uom;
  }

  // --- UomConversion (BR-UOM-102: versioned, no update path) -------------

  async findConversionById(context: TenantScope, id: string): Promise<UomConversion | null> {
    return this.prisma.uomConversion.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async listConversions(
    context: TenantScope,
    filters: UomConversionFilters = {},
  ): Promise<UomConversion[]> {
    return this.prisma.uomConversion.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(filters.fromUomId ? { from_uom_id: filters.fromUomId } : {}),
        ...(filters.toUomId ? { to_uom_id: filters.toUomId } : {}),
      },
      orderBy: [{ from_uom_id: 'asc' }, { to_uom_id: 'asc' }, { version: 'desc' }],
    });
  }

  async createConversion(
    context: TenantScope,
    data: { fromUomId: string; toUomId: string; factor: Prisma.Decimal.Value },
  ): Promise<UomConversion> {
    return this.prisma.uomConversion.create({
      data: {
        tenant_id: context.tenantId,
        from_uom_id: data.fromUomId,
        to_uom_id: data.toUomId,
        factor: data.factor,
        version: 1,
        status: 'active',
      },
    });
  }

  /**
   * The only way to change a conversion after creation (BR-UOM-102). Never
   * mutates the previous row's `factor` — marks it `superseded` and inserts
   * a new version referencing it, in one transaction.
   */
  async supersedeConversion(
    context: TenantScope,
    previousId: string,
    factor: Prisma.Decimal.Value,
  ): Promise<UomConversion> {
    const previous = await this.findConversionById(context, previousId);
    if (!previous) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `UOM conversion ${previousId} not found.`);
    }
    if (previous.status !== 'active') {
      throw new AthrDomainError(
        'CATALOG_UOM_CONVERSION_IMMUTABLE',
        `UOM conversion ${previousId} is already superseded; supersede its active successor instead.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const next = await tx.uomConversion.create({
        data: {
          tenant_id: context.tenantId,
          from_uom_id: previous.from_uom_id,
          to_uom_id: previous.to_uom_id,
          factor,
          version: previous.version + 1,
          status: 'active',
        },
      });
      await tx.uomConversion.update({
        where: { id: previous.id },
        data: { status: 'superseded', superseded_by_id: next.id, superseded_at: new Date() },
      });
      return next;
    });
  }
}
