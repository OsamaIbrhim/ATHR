import { Injectable } from '@nestjs/common';
import type { Customer, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export interface CustomerFilters {
  readonly search?: string;
  readonly take?: number;
}

/**
 * WP-007 Phase A §A.3.2 — tenant-scoped repository for the `customers`
 * module, following the `findById(context, id)` / `list(context, filters)` /
 * `save(context, aggregate)` pattern WP-006's identity module established.
 * There is no bare `findById(id)` here.
 *
 * Note the `phone` lookups: `Customer.phone` is still *globally* unique in
 * the database (making it tenant-scoped-unique is Phase B, §A.4), so a
 * `findUnique({ phone })` would happily return another tenant's customer.
 * Every one of them is a `findFirst` with an explicit tenant predicate
 * instead — that is exactly the application-layer half of defense in depth
 * that has to hold until Phase B adds the constraint.
 */
@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<Customer | null> {
    return this.prisma.customer.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async findByIdWithRecentSales(context: TenantScope, id: string) {
    return this.prisma.customer.findFirst({
      where: { id, tenant_id: context.tenantId },
      include: {
        sales: {
          where: { tenant_id: context.tenantId },
          take: 20,
          orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
        },
      },
    });
  }

  async list(context: TenantScope, filters: CustomerFilters = {}): Promise<Customer[]> {
    const search = filters.search;
    return this.prisma.customer.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(search
          ? {
              OR: [
                { phone: { contains: search } },
                { name: { contains: search, mode: 'insensitive' as Prisma.QueryMode } },
                { email: { contains: search, mode: 'insensitive' as Prisma.QueryMode } },
              ],
            }
          : {}),
      },
      take: filters.take ?? 50,
      orderBy: { total_spent: 'desc' },
    });
  }

  async findByPhone(context: TenantScope, phone: string): Promise<Customer | null> {
    return this.prisma.customer.findFirst({ where: { phone, tenant_id: context.tenantId } });
  }

  async save(context: TenantScope, data: Prisma.CustomerCreateInput): Promise<Customer> {
    return this.prisma.customer.create({ data: { ...data, tenant_id: context.tenantId } });
  }

  async update(
    context: TenantScope,
    id: string,
    data: Prisma.CustomerUpdateInput,
  ): Promise<Customer> {
    await this.assertInTenant(context, id);
    return this.prisma.customer.update({ where: { id }, data });
  }

  async remove(context: TenantScope, id: string): Promise<Customer> {
    await this.assertInTenant(context, id);
    return this.prisma.customer.delete({ where: { id } });
  }

  /**
   * Prisma's `update`/`delete` need the primary key alone, so the tenant
   * predicate cannot be expressed in the same statement. Reading the row
   * under the tenant predicate first is what stops a cross-tenant write —
   * Blueprint §120 "Update/delete cannot affect other tenant". Phase B's
   * composite foreign keys will make this belt-and-braces rather than the
   * only line of defense.
   */
  private async assertInTenant(context: TenantScope, id: string): Promise<void> {
    const existing = await this.findById(context, id);
    if (!existing) {
      // Matrix §90: an error must never reveal that a resource exists in
      // another tenant — same code as a genuinely missing row.
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Customer ${id} not found.`);
    }
  }
}
