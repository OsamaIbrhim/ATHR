import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CreateUserDto, EGYPTIAN_MOBILE_PATTERN } from './dto/create-user.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import {
  Capability, effectiveCapabilities,
} from '../auth/permissions';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
import { UsersRepository } from './users.repository';
import type { TenantContext } from '../identity/tenant-context.type';

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  findAll(context: TenantContext, actor: AuthenticatedUser) {
    if (actor.role !== 'owner' && !actor.branch_id) return Promise.resolve([]);
    return this.repository.list(
      context,
      actor.role === 'owner'
        ? { role: { not: 'owner' } }
        : {
            branch_id: actor.branch_id || undefined,
            role: { in: ['cashier', 'warehouse_manager', 'seller'] },
          },
    );
  }

  async create(context: TenantContext, data: CreateUserDto, actor: AuthenticatedUser) {
    this.assertCanManageRole(actor, data.role, data.branch_id || null);
    const phone = typeof data.phone === 'string'
      ? data.phone.replace(/\s+/g, '')
      : '';
    if (!EGYPTIAN_MOBILE_PATTERN.test(phone)) {
      throw new BadRequestException('phone must be a valid Egyptian mobile number');
    }

    const { password, ...rest } = data;
    const password_hash = await bcrypt.hash(password, 12);
    return this.repository.save(context, { ...rest, phone, password_hash } as any);
  }

  async updatePermissions(
    context: TenantContext,
    userId: string,
    data: UpdateUserPermissionsDto,
    actor: AuthenticatedUser,
  ) {
    const target = await this.repository.findById(context, userId);
    if (!target) throw new NotFoundException('User not found');
    this.assertCanManageRole(actor, target.role, target.branch_id);

    const overlap = data.granted_capabilities.find((capability) =>
      data.revoked_capabilities.includes(capability));
    if (overlap) {
      throw new BadRequestException(`Capability cannot be granted and revoked: ${overlap}`);
    }
    const actorCapabilities = new Set(actor.capabilities || []);
    const invalidGrant = data.granted_capabilities.find((capability) =>
      !actorCapabilities.has(capability as Capability));
    if (invalidGrant) {
      throw new ForbiddenException(`You cannot grant capability: ${invalidGrant}`);
    }

    const updated = await this.repository.updateCapabilities(
      context,
      userId,
      data.granted_capabilities,
      data.revoked_capabilities,
    );
    return { ...updated, capabilities: effectiveCapabilities(updated) };
  }

  private assertCanManageRole(
    actor: AuthenticatedUser,
    targetRole: string,
    targetBranchId: string | null,
  ) {
    if (targetRole === 'owner') {
      throw new ForbiddenException('The owner account cannot be managed here');
    }
    if (actor.role === 'owner') return;
    if (
      actor.role !== 'branch_manager' ||
      !actor.branch_id ||
      targetBranchId !== actor.branch_id ||
      !['cashier', 'warehouse_manager', 'seller'].includes(targetRole)
    ) {
      throw new ForbiddenException('You can only manage subordinate users in your branch');
    }
  }
}
