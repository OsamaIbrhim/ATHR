import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, type MembershipRole, type PermissionPolicySnapshot } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALL_ROLE_PERMISSIONS,
  PERMISSION_POLICY_CURRENT_VERSION,
  type AthrPermission,
} from './permission-catalog';

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

  /**
   * Idempotent: ensures an active snapshot at `PERMISSION_POLICY_CURRENT_VERSION`
   * exists. WP-007 Phase A raises that to 2 (identity-admin grants plus the
   * business-domain grants in `permission-catalog.ts`). An environment still
   * on WP-006's version 1 is upgraded in place on boot; without this, every
   * business permission would default-deny after deploy because the v1 row
   * already exists and the old code returned it unconditionally.
   */
  async ensureSeeded(): Promise<PermissionPolicySnapshot> {
    const existing = await this.prisma.permissionPolicySnapshot.findFirst({
      where: { is_active: true },
      orderBy: { version: 'desc' },
    });
    if (existing && existing.version >= PERMISSION_POLICY_CURRENT_VERSION) return existing;

    try {
      const created = await this.prisma.permissionPolicySnapshot.create({
        data: {
          version: PERMISSION_POLICY_CURRENT_VERSION,
          grants: ALL_ROLE_PERMISSIONS as unknown as Prisma.InputJsonValue,
          is_active: true,
        },
      });
      if (existing) {
        await this.prisma.permissionPolicySnapshot.update({
          where: { id: existing.id },
          data: { is_active: false },
        });
      }
      return created;
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

  async getGrants(role: MembershipRole): Promise<readonly AthrPermission[]> {
    const snapshot = await this.ensureSeeded();
    const grants = snapshot.grants as Record<string, readonly AthrPermission[]>;
    return grants[role] ?? [];
  }

  /** Allow-only (ADR-0005 / Matrix §3 rule 1): absent means denied. */
  async hasPermission(role: MembershipRole, permission: AthrPermission): Promise<boolean> {
    const grants = await this.getGrants(role);
    return grants.includes(permission);
  }
}
