import { Injectable } from '@nestjs/common';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { SuppliersRepository } from './suppliers.repository';
import type { TenantContext } from '../identity/tenant-context.type';

@Injectable()
export class SuppliersService {
  constructor(private readonly repository: SuppliersRepository) {}

  findAll(context: TenantContext, q?: string) {
    return this.repository.list(context, { search: q });
  }

  findOne(context: TenantContext, id: string) {
    return this.repository.findByIdWithRecentPurchases(context, id);
  }

  create(context: TenantContext, data: CreateSupplierDto) {
    return this.repository.save(context, {
      name: data.name,
      company_name: data.company_name,
      phone: data.phone,
      alias_names: data.alias_names || [],
    });
  }

  update(context: TenantContext, id: string, data: UpdateSupplierDto) {
    return this.repository.update(context, id, data);
  }

  remove(context: TenantContext, id: string) {
    return this.repository.remove(context, id);
  }

  // alias resolver for OCR – "Mohamed Trading Co." -> Supplier Mohamed
  async resolveAlias(context: TenantContext, name: string) {
    const all = await this.repository.list(context);
    return (
      all.find(
        (supplier) =>
          supplier.name === name ||
          supplier.company_name === name ||
          supplier.alias_names.includes(name),
      ) || null
    );
  }
}
