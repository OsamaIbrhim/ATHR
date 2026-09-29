import { Injectable } from '@nestjs/common';
import type { Membership, MembershipRole, MembershipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { TenantScope } from './tenant-context.type';

export interface MembershipFilters {
  readonly status?: MembershipStatus;
  readonly role?: MembershipRole;
}

export interface CreateMembershipInput {
  readonly userId: string;
  readonly role: MembershipRole;
  readonly status?: MembershipStatus;
}

/**
 * Tenant-scoped per Multi-tenancy Blueprint §29 — every method takes
 * `TenantContext` explicitly; there is no bare `findById(id)` anywhere in
 * this file.
 */
@Injectable()
export class MembershipRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<Membership | null> {
    return this.prisma.membership.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async list(context: TenantScope, filters: MembershipFilters = {}): Promise<Membership[]> {
    return this.prisma.membership.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.role ? { role: filters.role } : {}),
      },
      orderBy: { created_at: 'asc' },
    });
  }

  /** BR-MEM-100: at most one active Membership per (User, Tenant) pair. */
  async findByUser(context: TenantScope, userId: string): Promise<Membership | null> {
    return this.prisma.membership.findUnique({
      where: { user_id_tenant_id: { user_id: userId, tenant_id: context.tenantId } },
    });
  }

  async countActiveByRole(context: TenantScope, role: MembershipRole): Promise<number> {
    return this.prisma.membership.count({ where: { tenant_id: context.tenantId, role, status: 'active' } });
  }

  async save(context: TenantScope, input: CreateMembershipInput): Promise<Membership> {
    return this.prisma.membership.create({
      data: {
        tenant_id: context.tenantId,
        user_id: input.userId,
        role: input.role,
        status: input.status ?? 'invited',
      },
    });
  }

  async updateStatus(context: TenantScope, id: string, status: MembershipStatus): Promise<Membership> {
    const existing = await this.findById(context, id);
    if (!existing) {
      throw new AthrDomainError('MEMBERSHIP_NOT_FOUND', `Membership ${id} not found in this Tenant.`);
    }
    return this.prisma.membership.update({ where: { id }, data: { status } });
  }

  async updateRole(context: TenantScope, id: string, role: MembershipRole): Promise<Membership> {
    const existing = await this.findById(context, id);
    if (!existing) {
      throw new AthrDomainError('MEMBERSHIP_NOT_FOUND', `Membership ${id} not found in this Tenant.`);
    }
    return this.prisma.membership.update({ where: { id }, data: { role } });
  }
}
