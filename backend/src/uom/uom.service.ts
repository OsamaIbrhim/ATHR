import { Injectable } from '@nestjs/common';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { UomRepository } from './uom.repository';
import { CreateUomDto, UpdateUomDto } from './dto/unit-of-measure.dto';
import { CreateUomConversionDto, ListUomConversionsDto, SupersedeUomConversionDto } from './dto/uom-conversion.dto';
import type { TenantContext } from '../identity/tenant-context.type';

/** WP-008 Phase A (BR-UOM-1xx): Unit of Measure reference data + versioned conversions. */
@Injectable()
export class UomService {
  constructor(private readonly repository: UomRepository) {}

  findAll(context: TenantContext, includeArchived = false) {
    return this.repository.list(context, { activeOnly: !includeArchived });
  }

  findOne(context: TenantContext, id: string) {
    return this.repository.assertInTenant(context, id);
  }

  async create(context: TenantContext, dto: CreateUomDto) {
    const code = dto.code.trim();
    const existing = await this.repository.findByCode(context, code);
    if (existing) {
      throw new AthrDomainError('CATALOG_UOM_CODE_CONFLICT', `Unit of Measure "${code}" already exists.`);
    }
    return this.repository.save(context, {
      code,
      name_en: dto.name_en,
      name_ar: dto.name_ar,
      kind: dto.kind,
      precision: dto.precision,
    });
  }

  update(context: TenantContext, id: string, dto: UpdateUomDto) {
    return this.repository.update(context, id, {
      name_en: dto.name_en,
      name_ar: dto.name_ar,
      precision: dto.precision,
      is_active: dto.is_active,
    });
  }

  listConversions(context: TenantContext, dto: ListUomConversionsDto) {
    return this.repository.listConversions(context, {
      fromUomId: dto.from_uom_id,
      toUomId: dto.to_uom_id,
    });
  }

  async createConversion(context: TenantContext, dto: CreateUomConversionDto) {
    if (dto.from_uom_id === dto.to_uom_id) {
      throw new AthrDomainError(
        'REQUEST_FIELD_VALUE_INVALID',
        'from_uom_id and to_uom_id must be different units.',
      );
    }
    await this.repository.assertInTenant(context, dto.from_uom_id);
    await this.repository.assertInTenant(context, dto.to_uom_id);
    return this.repository.createConversion(context, {
      fromUomId: dto.from_uom_id,
      toUomId: dto.to_uom_id,
      factor: dto.factor,
    });
  }

  // BR-UOM-102: the only mutation path for an existing conversion — the
  // service exposes no "update conversion" method at all.
  supersedeConversion(context: TenantContext, id: string, dto: SupersedeUomConversionDto) {
    return this.repository.supersedeConversion(context, id, dto.factor);
  }
}
