import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { LIMITS, type LimitKey } from './catalog';
import { EntitlementService } from './entitlement.service';

/**
 * ADR-0005 "Limit": exceeding a plan limit only blocks creating more; existing
 * data is never touched. Counts are cheap COUNTs over tenant-indexed columns
 * and cover only what is in use (an archived product or a revoked terminal
 * frees its slot).
 */
@Injectable()
export class LimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  /** Call at every creation point, inside the creating transaction where there is one. */
  async assertCanCreate(tenantId: string, key: LimitKey, tx?: Prisma.TransactionClient): Promise<void> {
    const { limits } = await this.entitlements.resolve(tenantId);
    const limit = limits[key];
    if (limit === null || limit === undefined) return;

    const current = await this.count(tenantId, key, tx);
    if (current >= limit) {
      throw new AthrDomainError(
        'ENTITLEMENT_LIMIT_REACHED',
        `Your plan allows ${limit} ${key} and you already have ${current}. Upgrade your plan to add more.`,
        undefined,
        {
          messageAr: `باقتك تسمح بعدد ${limit} من (${key}) ولديك بالفعل ${current}. قم بترقية الباقة لإضافة المزيد.`,
          data: { limit_key: key, limit, current },
        },
      );
    }
  }

  /** Current usage of every limited resource, for the status endpoint. */
  async usage(tenantId: string): Promise<Record<LimitKey, number>> {
    const keys = LIMITS.map((limit) => limit.key);
    const counts = await Promise.all(keys.map((key) => this.count(tenantId, key)));
    return Object.fromEntries(keys.map((key, index) => [key, counts[index]])) as Record<LimitKey, number>;
  }

  private count(tenantId: string, key: LimitKey, tx?: Prisma.TransactionClient): Promise<number> {
    const db = tx ?? this.prisma;
    switch (key) {
      case 'branches':
        return db.branch.count({ where: { tenant_id: tenantId, is_active: true } });
      case 'terminals':
        return db.posTerminal.count({ where: { tenant_id: tenantId, is_revoked: false } });
      case 'users':
        return db.membership.count({
          where: { tenant_id: tenantId, status: { notIn: ['deactivated', 'expired'] } },
        });
      case 'products':
        return db.product.count({ where: { tenant_id: tenantId, is_active: true } });
    }
  }
}
