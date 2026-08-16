import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type Coupon, type CouponRedemption, type CouponStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export interface CouponFilters {
  readonly promotionId?: string;
  readonly status?: CouponStatus;
  readonly page?: number;
  readonly pageSize?: number;
}

/** BR-CPN-201/OD-CAT-002: same normalized-uppercase-trimmed pattern SKU already uses. */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * WP-008 Phase D — tenant-scoped repository for `Coupon`/`CouponRedemption`.
 *
 * BR-CPN-206: no method here logs or throws with the raw code embedded — a
 * caller-facing failure names the coupon's resolved `id` (once known) or
 * says nothing more specific than "invalid or expired", never the string the
 * caller typed.
 */
@Injectable()
export class CouponRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<Coupon | null> {
    return this.prisma.coupon.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async assertInTenant(context: TenantScope, id: string): Promise<Coupon> {
    const coupon = await this.findById(context, id);
    if (!coupon) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Coupon ${id} not found.`);
    return coupon;
  }

  /** Never throws on "not found" — a lookup-by-code failure must read as invalid, not confirm/deny existence. */
  async findByCode(context: TenantScope, rawCode: string): Promise<Coupon | null> {
    return this.prisma.coupon.findFirst({
      where: { tenant_id: context.tenantId, code_normalized: normalizeCouponCode(rawCode) },
    });
  }

  async list(context: TenantScope, filters: CouponFilters = {}): Promise<{ rows: Coupon[]; total: number }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 20;
    const where: Prisma.CouponWhereInput = {
      tenant_id: context.tenantId,
      ...(filters.promotionId ? { promotion_id: filters.promotionId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.coupon.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.coupon.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * BR-CPN-201: `code_normalized` uniqueness is enforced by
   * `Coupon_tenant_id_code_normalized_key` (real Postgres only —
   * `verify-promotion-behaviour.cjs`; `fakePrisma` enforces no unique
   * constraint, backlog item F7c). A collision surfaces as a registered
   * domain error, never the raw Prisma `P2002`, and never echoes the code.
   */
  async create(
    context: TenantScope,
    data: {
      promotionId: string;
      codeDisplay: string;
      type: Coupon['type'];
      customerId: string | null;
      maxTotalUses: number | null;
      maxUsesPerCustomer: number | null;
      expiresAt: Date | null;
      createdBy: string;
    },
  ): Promise<Coupon> {
    try {
      return await this.prisma.coupon.create({
        data: {
          tenant_id: context.tenantId,
          promotion_id: data.promotionId,
          code_normalized: normalizeCouponCode(data.codeDisplay),
          code_display: data.codeDisplay.trim(),
          type: data.type,
          customer_id: data.customerId,
          max_total_uses: data.maxTotalUses,
          max_uses_per_customer: data.maxUsesPerCustomer,
          expires_at: data.expiresAt,
          created_by: data.createdBy,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AthrDomainError(
          'COUPON_INVALID_OR_EXPIRED',
          'A coupon with this code already exists for this tenant.',
        );
      }
      throw error;
    }
  }

  async update(
    context: TenantScope,
    id: string,
    data: Prisma.CouponUpdateManyMutationInput,
  ): Promise<Coupon> {
    const changed = await this.prisma.coupon.updateMany({
      where: { id, tenant_id: context.tenantId },
      data,
    });
    if (changed.count !== 1) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Coupon ${id} not found.`);
    }
    return this.assertInTenant(context, id);
  }

  /**
   * BR-CPN-204: idempotent, structural, never a read-then-write race
   * (Task brief item 4).
   *
   * Two-phase, each phase itself atomic, with the second phase compensating
   * if it loses:
   *
   *   1. `CouponRedemption.create` for `(tenant_id, coupon_id,
   *      idempotency_key)`. If that unique triple already has a row, Postgres
   *      rejects this INSERT with P2002 — caught here and treated as an
   *      idempotent REPLAY: the existing row is returned unchanged, the
   *      coupon's `use_count` is NOT touched a second time. This step alone
   *      is what makes "redeem the same code twice" structurally incapable
   *      of double-applying — it does not depend on any check the caller
   *      could race.
   *   2. Only reached when step 1 inserted a genuinely NEW row: an atomic
   *      conditional `UPDATE ... WHERE use_count < max_total_uses OR
   *      max_total_uses IS NULL` (raw SQL — a column-to-column comparison
   *      Prisma's fluent `where` builder cannot express, same bound-parameter
   *      discipline `TransfersService` already uses for stock decrements).
   *      If the predicate excludes every row (limit reached, or the coupon
   *      was disabled/expired concurrently), step 1's row is deleted to
   *      compensate — a redemption that didn't count must not be left behind
   *      — and a registered error is thrown.
   *
   * The narrow residual race this does NOT close: `max_uses_per_customer` is
   * enforced by `CouponService.redeem`'s pre-flight count, which is a
   * read-then-write check and CAN race under concurrent redemptions by the
   * same customer with different idempotency keys. This is documented as an
   * accepted gap, not silently claimed atomic — see the Phase D PR
   * description. `max_total_uses` (the tenant-wide cap) and the
   * never-double-apply guarantee are both fully structural.
   */
  async redeem(
    context: TenantScope,
    couponId: string,
    idempotencyKey: string,
    data: { customerId: string | null; amountApplied: Prisma.Decimal.Value | null; redeemedBy: string | null },
  ): Promise<{ redemption: CouponRedemption; replay: boolean }> {
    const id = randomUUID();
    let inserted: CouponRedemption;
    try {
      inserted = await this.prisma.couponRedemption.create({
        data: {
          id,
          tenant_id: context.tenantId,
          coupon_id: couponId,
          idempotency_key: idempotencyKey,
          customer_id: data.customerId,
          amount_applied: data.amountApplied,
          redeemed_by: data.redeemedBy,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.couponRedemption.findFirst({
          where: { tenant_id: context.tenantId, coupon_id: couponId, idempotency_key: idempotencyKey },
        });
        if (!existing) {
          // Should be unreachable — the P2002 target IS this triple — but
          // never silently invent a redemption row (CLAUDE.md §6 "fail loud").
          throw new AthrDomainError(
            'COUPON_INVALID_OR_EXPIRED',
            `Coupon redemption conflict for coupon ${couponId} could not be resolved to an existing row.`,
          );
        }
        return { redemption: existing, replay: true };
      }
      throw error;
    }

    const capacity = await this.prisma.$executeRaw`
      UPDATE "Coupon"
      SET "use_count" = "use_count" + 1, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${couponId}::uuid
        AND "tenant_id" = ${context.tenantId}::uuid
        AND "status" = 'active'::"CouponStatus"
        AND ("max_total_uses" IS NULL OR "use_count" < "max_total_uses")
    `;
    if (capacity !== 1) {
      // Compensate: this redemption must not count if capacity could not be reserved.
      await this.prisma.couponRedemption.delete({ where: { id: inserted.id } });
      const current = await this.findById(context, couponId);
      if (!current || current.status !== 'active') {
        throw new AthrDomainError('COUPON_INVALID_OR_EXPIRED', `Coupon ${couponId} is not active.`);
      }
      throw new AthrDomainError(
        'COUPON_USAGE_LIMIT_EXCEEDED',
        `Coupon ${couponId} has reached its total usage limit (BR-CPN-205).`,
      );
    }
    return { redemption: inserted, replay: false };
  }

  /** For `CouponService.redeem`'s per-customer cap pre-flight — see that method's own caveat. */
  async countRedemptionsForCustomer(
    context: TenantScope,
    couponId: string,
    customerId: string,
  ): Promise<number> {
    return this.prisma.couponRedemption.count({
      where: { tenant_id: context.tenantId, coupon_id: couponId, customer_id: customerId },
    });
  }
}
