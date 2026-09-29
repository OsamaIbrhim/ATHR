import { FIRST_PAGE, pageArgs, pageOf, type PageQuery } from '../common/pagination';
import { Injectable } from '@nestjs/common';
import type { MembershipRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';
import { primaryBranchId, toScopeSet } from '../auth/branch-access';

const MEMBERSHIP_VIEW = {
  id: true,
  role: true,
  status: true,
  granted_permissions: true,
  revoked_permissions: true,
  access_scope_assignments: true,
  user: { select: { id: true, name: true, phone: true, email: true, is_active: true, created_at: true } },
} satisfies Prisma.MembershipSelect;

type MembershipRow = Prisma.MembershipGetPayload<{ select: typeof MEMBERSHIP_VIEW }>;

/** A staff member as the admin sees them: identity + tenant-specific Membership data. */
function toView({ user, access_scope_assignments, ...membership }: MembershipRow) {
  const scope_set = toScopeSet(access_scope_assignments);
  return {
    ...user,
    membership_id: membership.id,
    role: membership.role,
    branch_id: primaryBranchId({ scope_set }),
    all_branches: scope_set.some((scope) => scope.scope_type === 'tenant_wide'),
    granted_permissions: membership.granted_permissions,
    revoked_permissions: membership.revoked_permissions,
  };
}

export interface NewStaffInput {
  readonly user: Omit<Prisma.UserUncheckedCreateInput, 'id'>;
  readonly role: MembershipRole;
  /** A branch scope, or `null` for a tenant-wide scope, or `undefined` for none. */
  readonly branchId: string | null | undefined;
}

/**
 * Tenant-scoped repository for the `users` module.
 *
 * `User` is the global identity and has no `tenant_id`; a person belongs to a
 * Tenant only through a `Membership`, which is where role, scope and permission
 * overrides live. So every query here goes through the Membership.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMembership(context: TenantScope, userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { user_id: userId, tenant_id: context.tenantId },
      select: MEMBERSHIP_VIEW,
    });
    return membership && toView(membership);
  }

  async list(context: TenantScope, filter: Prisma.MembershipWhereInput, paging: PageQuery = FIRST_PAGE) {
    const where = { ...filter, tenant_id: context.tenantId };
    const [memberships, total] = await Promise.all([
      this.prisma.membership.findMany({
        where,
        select: MEMBERSHIP_VIEW,
        orderBy: [{ user: { created_at: 'desc' } }, { id: 'asc' }],
        ...pageArgs(paging),
      }),
      this.prisma.membership.count({ where }),
    ]);
    return pageOf(memberships.map(toView), total, paging);
  }

  /**
   * Creates the identity, its Membership and its access scope in one
   * transaction. Without the Membership the new account would authenticate but
   * resolve no TenantContext, so every request would be denied.
   */
  async save(context: TenantScope, input: NewStaffInput) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: input.user, select: { id: true } });
      const membership = await tx.membership.create({
        data: {
          tenant_id: context.tenantId,
          user_id: user.id,
          role: input.role,
          status: input.user.is_active === false ? 'suspended' : 'active',
        },
      });
      if (input.branchId !== undefined) {
        await tx.accessScopeAssignment.create({
          data: {
            membership_id: membership.id,
            scope_type: input.branchId === null ? 'tenant_wide' : 'location',
            scope_ref_id: input.branchId,
            grant_source: 'user_admin',
          },
        });
      }
      return toView(await tx.membership.findUniqueOrThrow({ where: { id: membership.id }, select: MEMBERSHIP_VIEW }));
    });
  }

  async updatePermissions(context: TenantScope, userId: string, granted: string[], revoked: string[]) {
    const existing = await this.findMembership(context, userId);
    if (!existing) throw new AthrDomainError('RESOURCE_NOT_FOUND', 'User not found');
    const membership = await this.prisma.membership.update({
      where: { id: existing.membership_id },
      data: { granted_permissions: granted, revoked_permissions: revoked },
      select: MEMBERSHIP_VIEW,
    });
    return toView(membership);
  }
}
