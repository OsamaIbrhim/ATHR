import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import type { MembershipRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { CreateUserDto, EGYPTIAN_MOBILE_PATTERN } from './dto/create-user.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { canAccessAllBranches, hasBranchAccess, primaryBranchId } from '../auth/branch-access';
import { effectivePermissions } from '../identity/permission-catalog';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
import { UsersRepository } from './users.repository';
import type { TenantContext } from '../identity/tenant-context.type';
import { LimitService } from '../entitlements/limit.service';

/** Roles a branch-scoped manager may manage inside their own branch. */
const BRANCH_MANAGEABLE_ROLES: readonly MembershipRole[] = ['cashier', 'warehouse_manager', 'seller'];

@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly limits: LimitService,
  ) {}

  findAll(context: TenantContext, actor: AuthenticatedUser) {
    if (canAccessAllBranches(actor)) {
      return this.repository.list(context, { role: { not: 'tenant_owner' } });
    }
    const branchId = primaryBranchId(actor);
    if (!branchId) return Promise.resolve([]);
    return this.repository.list(context, {
      role: { in: [...BRANCH_MANAGEABLE_ROLES] },
      access_scope_assignments: { some: { scope_type: 'location', scope_ref_id: branchId } },
    });
  }

  async create(context: TenantContext, data: CreateUserDto, actor: AuthenticatedUser) {
    this.assertCanManage(actor, data.role, data.branch_id ?? null);
    const phone = typeof data.phone === 'string'
      ? data.phone.replace(/\s+/g, '')
      : '';
    if (!EGYPTIAN_MOBILE_PATTERN.test(phone)) {
      throw new BadRequestException('phone must be a valid Egyptian mobile number');
    }

    await this.limits.assertCanCreate(context.tenantId, 'users');
    const password_hash = await bcrypt.hash(data.password, 12);
    return this.repository.save(context, {
      user: { name: data.name, phone, email: data.email, password_hash, is_active: true },
      role: data.role,
      // No branch: a warehouse manager works across the tenant; other roles get no scope.
      branchId: data.branch_id ?? (data.role === 'warehouse_manager' ? null : undefined),
    });
  }

  async updatePermissions(
    context: TenantContext,
    userId: string,
    data: UpdateUserPermissionsDto,
    actor: AuthenticatedUser,
  ) {
    const target = await this.repository.findMembership(context, userId);
    if (!target) throw new NotFoundException('User not found');
    this.assertCanManage(actor, target.role, target.branch_id);

    const overlap = data.granted_permissions.find((permission) =>
      data.revoked_permissions.includes(permission));
    if (overlap) {
      throw new BadRequestException(`Permission cannot be granted and revoked: ${overlap}`);
    }
    const invalidGrant = data.granted_permissions.find((permission) =>
      !actor.permissions.has(permission as never));
    if (invalidGrant) {
      throw new ForbiddenException(`You cannot grant permission: ${invalidGrant}`);
    }

    const updated = await this.repository.updatePermissions(
      context,
      userId,
      data.granted_permissions,
      data.revoked_permissions,
    );
    return {
      ...updated,
      permissions: [...effectivePermissions(updated.role, updated.granted_permissions, updated.revoked_permissions)],
    };
  }

  /** Tenant-wide managers manage anyone but the owner; a branch manager only subordinates in their branch. */
  private assertCanManage(actor: AuthenticatedUser, targetRole: MembershipRole, targetBranchId: string | null) {
    if (targetRole === 'tenant_owner') {
      throw new ForbiddenException('The owner account cannot be managed here');
    }
    if (canAccessAllBranches(actor)) return;
    if (
      !targetBranchId ||
      !hasBranchAccess(actor, targetBranchId) ||
      !BRANCH_MANAGEABLE_ROLES.includes(targetRole)
    ) {
      throw new ForbiddenException('You can only manage subordinate users in your branch');
    }
  }
}
