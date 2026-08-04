import { Injectable } from '@nestjs/common';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { decimal } from '../common/money';
import { CustomersRepository } from './customers.repository';
import type { TenantContext } from '../identity/tenant-context.type';

@Injectable()
export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

  findAll(context: TenantContext, q?: string, take = 50) {
    return this.repository.list(context, { search: q, take });
  }

  findOne(context: TenantContext, id: string) {
    return this.repository.findByIdWithRecentSales(context, id);
  }

  searchByPhone(context: TenantContext, phone: string) {
    return this.repository.findByPhone(context, phone);
  }

  create(context: TenantContext, data: CreateCustomerDto) {
    return this.repository.save(context, data);
  }

  update(context: TenantContext, id: string, data: UpdateCustomerDto) {
    return this.repository.update(context, id, data);
  }

  setVip(
    context: TenantContext,
    id: string,
    is_vip: boolean,
    vip_price_tier = 'cost_plus_overhead',
  ) {
    return this.repository.update(context, id, { is_vip, vip_price_tier });
  }

  async loyaltyStatus(context: TenantContext, phone: string) {
    const customer = await this.repository.findByPhone(context, phone);
    if (!customer) return { eligible: false };
    const eligible =
      customer.total_invoices >= 5 || decimal(customer.total_spent).gte(2000);
    return {
      eligible,
      total_invoices: customer.total_invoices,
      total_spent: customer.total_spent,
      customer,
    };
  }

  remove(context: TenantContext, id: string) {
    return this.repository.remove(context, id);
  }
}
