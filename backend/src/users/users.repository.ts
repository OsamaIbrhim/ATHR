import { Injectable } from '@nestjs/common';
import type { MembershipRole, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

const USER_VIEW = {
  id: true,
  branch_id: true,
  name: true,
  phone: true,
  email: true,
  role: true,
  granted_capabilities: true,
  revoked_capabilities: true,
  is_active: true,
  created_at: true,
} as const;

/** The legacy `Role` → `MembershipRole` mapping fixed by migration 202608020003. */
const MEMBERSHIP_ROLE_FOR: Readonly<Record<Role, MembershipRole>> = {
  owner: 'tenant_owner',
  branch_manager: 'location_manager',
  cashier: 'cashier',
  warehouse_manager: 'warehouse_manager',
  seller: 'seller',
};

/**
 * WP-007 Phase A §A.3.2 — tenant-scoped repository for the `users` module.
 *
 * `User` is the Platform Identity (ADR-0003) and deliberately has **no**
 * `tenant_id` column: an Identity is global and belongs to a Tenant only
 * through a `Membership`. So every query here scopes through the Membership
 * join rather than a column predicate. That is the correct model, not a
 * workaround — an Identity may later hold Memberships in several Tenants,
 * and a `tenant_id` on `User` would make that unrepresentable.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  private tenantMembers(context: TenantScope): Prisma.UserWhereInput {
    return { memberships: { some: { tenantId: context.tenantId } } };
  }

  async findById(context: TenantScope, id: string) {
    return this.prisma.user.findFirst({ where: { id, ...this.tenantMembers(context) } });
  }

  async list(context: TenantScope, where: Prisma.UserWhereInput) {
    return this.prisma.user.findMany({
      where: { ...where, ...this.tenantMembers(context) },
      select: USER_VIEW,
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Creates the Identity and its Membership in one transaction.
   *
   * Without the Membership the new account would authenticate but resolve no
   * TenantContext, so `TenantContextGuard` would deny every request — the
   * account would be created successfully and then be unusable. Migration
   * `202608020003` guarantees this invariant for every pre-existing User;
   * this keeps it true for every new one.
   */
  async save(context: TenantScope, data: Prisma.UserUncheckedCreateInput) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data, select: USER_VIEW });
      await tx.membership.create({
        data: {
          tenantId: context.tenantId,
          identityId: user.id,
          role: MEMBERSHIP_ROLE_FOR[user.role],
          status: user.is_active ? 'active' : 'suspended',
        },
      });
      return user;
    });
  }

  async updateCapabilities(
    context: TenantScope,
    id: string,
    granted: string[],
    revoked: string[],
  ) {
    await this.assertInTenant(context, id);
    return this.prisma.user.update({
      where: { id },
      data: { granted_capabilities: granted, revoked_capabilities: revoked },
      select: USER_VIEW,
    });
  }

  async assertInTenant(context: TenantScope, id: string) {
    const user = await this.findById(context, id);
    if (!user) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', 'User not found');
    }
    return user;
  }
}
