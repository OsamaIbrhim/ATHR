import { Injectable } from '@nestjs/common';
import { Prisma, type ProductType } from '@prisma/client';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantContext } from '../identity/tenant-context.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductTypeDto, UpdateProductTypeDto } from './dto/product-type.dto';
import { parseAttributeDefinitions, type AttributeDefinition } from './product-type-schema';

/** The stored attributes of a type, already validated when they were written. */
export const typeAttributes = (type: Pick<ProductType, 'attributes'>) =>
  type.attributes as unknown as AttributeDefinition[];

@Injectable()
export class ProductTypesService {
  constructor(private readonly prisma: PrismaService) {}

  list(context: TenantContext) {
    return this.prisma.productType.findMany({
      where: { tenant_id: context.tenantId },
      orderBy: [{ is_active: 'desc' }, { name_en: 'asc' }],
    });
  }

  async get(context: TenantContext, id: string): Promise<ProductType> {
    const type = await this.prisma.productType.findFirst({ where: { id, tenant_id: context.tenantId } });
    if (!type) throw new AthrDomainError('RESOURCE_NOT_FOUND', 'Product type not found');
    return type;
  }

  async create(context: TenantContext, dto: CreateProductTypeDto) {
    const attributes = parseAttributeDefinitions(dto.attributes);
    return this.prisma.productType.create({
      data: {
        tenant_id: context.tenantId,
        name_ar: dto.name_ar,
        name_en: dto.name_en,
        attributes: attributes as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async update(context: TenantContext, id: string, dto: UpdateProductTypeDto) {
    const type = await this.get(context, id);
    let attributes: AttributeDefinition[] | undefined;
    if (dto.attributes) {
      attributes = parseAttributeDefinitions(dto.attributes);
      const inUse = await this.prisma.product.count({ where: { tenant_id: context.tenantId, product_type_id: id } });
      if (inUse) this.assertOnlyAdditions(typeAttributes(type), attributes);
    }
    return this.prisma.productType.update({
      where: { id },
      data: {
        name_ar: dto.name_ar,
        name_en: dto.name_en,
        is_active: dto.is_active,
        attributes: attributes as unknown as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /** Existing products already carry values for these attributes, so they can only be extended. */
  private assertOnlyAdditions(before: AttributeDefinition[], after: AttributeDefinition[]) {
    for (const old of before) {
      const next = after.find((a) => a.key === old.key);
      if (!next || next.kind !== old.kind || next.axis !== old.axis) {
        throw new AthrDomainError(
          'CATALOG_PRODUCT_TYPE_IN_USE',
          `Product type is used by products: attribute "${old.key}" cannot be removed or change kind/axis.`,
        );
      }
    }
  }
}
