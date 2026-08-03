import { Injectable, OnModuleInit } from '@nestjs/common';
import type { MembershipRole, PermissionPolicySnapshot } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  IdentityPermission,
  PERMISSION_POLICY_INITIAL_VERSION,
  SYSTEM_ROLE_PERMISSIONS,
} from './system-roles';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * ADR-0005: a Membership's effective permissions are a resolvable, versioned
 * snapshot — never a live join computed differently every time. `grants` is
 * global and platform-wide (system roles are not tenant-editable in MVP, per
 * ADR-0003 item 6), so there is exactly one active snapshot at a time, not
 * one per Tenant.
 */
@Injectable()
export class PermissionPolicyService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSeeded();
  }

  /** Idempotent: creates the version-1 snapshot only if none exists yet. */
  async ensureSeeded(): Promise<PermissionPolicySnapshot> {
    const existing = await this.prisma.permissionPolicySnapshot.findFirst({
      where: { is_active: true },
      orderBy: { version: 'desc' },
    });
    if (existing) return existing;

    try {
      return await this.prisma.permissionPolicySnapshot.create({
        data: {
          version: PERMISSION_POLICY_INITIAL_VERSION,
          grants: SYSTEM_ROLE_PERMISSIONS,
          is_active: true,
        },
      });
    } catch (error: unknown) {
      // Two concurrent instances/requests racing the first-ever seed: the
      // unique constraint on `version` lets exactly one create win; the
      // loser just reads back what the winner wrote instead of failing.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
        const winner = await this.prisma.permissionPolicySnapshot.findFirst({
          where: { is_active: true },
          orderBy: { version: 'desc' },
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  async getCurrentVersion(): Promise<number> {
    const snapshot = await this.ensureSeeded();
    return snapshot.version;
  }

  async getGrants(role: MembershipRole): Promise<readonly IdentityPermission[]> {
    const snapshot = await this.ensureSeeded();
    const grants = snapshot.grants as Record<string, readonly IdentityPermission[]>;
    return grants[role] ?? [];
  }

  async hasPermission(role: MembershipRole, permission: IdentityPermission): Promise<boolean> {
    const grants = await this.getGrants(role);
    return grants.includes(permission);
  }
}
