import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, type PermissionPolicySnapshot } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALL_ROLE_PERMISSIONS,
  PERMISSION_POLICY_CURRENT_VERSION,
  type AthrPermission,
} from './permission-catalog';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Versions the platform-wide role grants (ADR-0005). System roles are not
 * tenant-editable in MVP, so there is exactly one active snapshot at a time.
 * Effective permissions themselves are computed in code from the catalog by
 * `effectivePermissions`; the snapshot records which grant set was in force.
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
}
