import { Injectable } from '@nestjs/common';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { BrandsRepository } from './brands.repository';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';
import type { TenantContext } from '../identity/tenant-context.type';

/** WP-008 Phase A (BR-CLS-103): Brand as an independent, archivable entity. */
@Injectable()
export class BrandsService {
  constructor(private readonly repository: BrandsRepository) {}

  findAll(context: TenantContext, q?: string, includeArchived = false) {
    return this.repository.list(context, { search: q, activeOnly: !includeArchived });
  }

  findOne(context: TenantContext, id: string) {
    return this.repository.assertInTenant(context, id);
  }

  async create(context: TenantContext, dto: CreateBrandDto) {
    const name = dto.name.trim();
    const existing = await this.repository.findByName(context, name);
    if (existing) {
      throw new AthrDomainError(
        'CATALOG_BRAND_NAME_CONFLICT',
        `Brand "${name}" already exists.`,
      );
    }
    return this.repository.save(context, { name });
  }

  async update(context: TenantContext, id: string, dto: UpdateBrandDto) {
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const existing = await this.repository.findByName(context, name);
      if (existing && existing.id !== id) {
        throw new AthrDomainError(
          'CATALOG_BRAND_NAME_CONFLICT',
          `Brand "${name}" already exists.`,
        );
      }
      return this.repository.update(context, id, { name, is_active: dto.is_active });
    }
    return this.repository.update(context, id, { is_active: dto.is_active });
  }

  // BR-CAT-104: archiving, never a hard delete — historical Product
  // references to this Brand remain valid.
  archive(context: TenantContext, id: string) {
    return this.repository.update(context, id, { is_active: false });
  }
}
