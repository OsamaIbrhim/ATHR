import { Injectable } from '@nestjs/common';
import type { Prisma, Promotion, PromotionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export interface PromotionFilters {
  readonly status?: PromotionStatus;
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * WP-008 Phase D — tenant-scoped repository for `Promotion`, following the
 * `findById(context,id)/list(context,filters)/save(context,aggregate)`
 * contract Phases A-C already established (Multi-tenancy Blueprint §29).
 *
 * Unlike `TaxCodeRepository.activate`, `activate()` here needs no
 * demote-before-promote dance: `Promotion` carries no "only one active"
 * partial unique index (BR-STK-100 allows several promotions to be `active`
 * simultaneously; MVP evaluation still applies at most one — see
 * `PromotionEvaluationService`). Every transition below is therefore a single
 * `transition()` call, the same predicate-in-`updateMany` idiom
 * `TaxCodeRepository.transition` uses so a concurrent or stale transition
 * affects zero rows instead of racing.
 */
@Injectable()
export class PromotionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(context: TenantScope, id: string): Promise<Promotion | null> {
    return this.prisma.promotion.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async assertInTenant(context: TenantScope, id: string): Promise<Promotion> {
    const promotion = await this.findById(context, id);
    if (!promotion) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Promotion ${id} not found.`);
    return promotion;
  }

  async list(
    context: TenantScope,
    filters: PromotionFilters = {},
  ): Promise<{ rows: Promotion[]; total: number }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 20;
    const where: Prisma.PromotionWhereInput = {
      tenant_id: context.tenantId,
      ...(filters.status ? { status: filters.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.promotion.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.promotion.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * Every currently-effective `active` promotion, deterministically ordered
   * (BR-PMT-105: "لا يعتمد الاختيار على ترتيب Database عشوائي" — priority
   * first, then a stable, non-DB-order-dependent tiebreak) for
   * `PromotionEvaluationService.evaluate` to walk. `starts_at`/`ends_at` are
   * filtered here so a promotion outside its own window is never even
   * offered as a candidate.
   */
  async listActiveForEvaluation(
    context: TenantScope,
    at: Date = new Date(),
  ): Promise<Promotion[]> {
    return this.prisma.promotion.findMany({
      where: {
        tenant_id: context.tenantId,
        status: 'active',
        starts_at: { lte: at },
        OR: [{ ends_at: null }, { ends_at: { gte: at } }],
      },
      orderBy: [{ priority: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
    });
  }

  async create(
    context: TenantScope,
    data: Omit<Prisma.PromotionUncheckedCreateInput, 'tenant_id' | 'status'>,
  ): Promise<Promotion> {
    return this.prisma.promotion.create({
      data: { ...data, tenant_id: context.tenantId, status: 'draft' },
    });
  }

  /** BR-PMT-101: only a `draft` promotion may be edited. */
  async updateDraft(
    context: TenantScope,
    id: string,
    data: Prisma.PromotionUpdateManyMutationInput,
  ): Promise<Promotion> {
    const changed = await this.prisma.promotion.updateMany({
      where: { id, tenant_id: context.tenantId, status: 'draft' },
      data,
    });
    if (changed.count !== 1) {
      const current = await this.findById(context, id);
      if (!current) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Promotion ${id} not found.`);
      throw new AthrDomainError(
        'PROMOTION_INVALID_TRANSITION',
        `Promotion ${id} is "${current.status}"; only a "draft" may be edited (BR-PMT-101).`,
      );
    }
    return this.assertInTenant(context, id);
  }

  /**
   * Sets `submitted_by/at` or `approved_by/at` WITHOUT changing `status` —
   * BR-PMT-100's status enum has no visible "submitted"/"approved" state (see
   * the schema's `PromotionStatus` comment). Both `updateMany`s are still
   * predicated on `status = 'draft'` so neither can touch a promotion that
   * has already moved on.
   */
  async markSubmitted(context: TenantScope, id: string, actorId: string): Promise<Promotion> {
    const changed = await this.prisma.promotion.updateMany({
      where: { id, tenant_id: context.tenantId, status: 'draft' },
      data: { submitted_by: actorId, submitted_at: new Date() },
    });
    if (changed.count !== 1) {
      const current = await this.findById(context, id);
      if (!current) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Promotion ${id} not found.`);
      throw new AthrDomainError(
        'PROMOTION_INVALID_TRANSITION',
        `Promotion ${id} is "${current.status}"; only a "draft" may be submitted.`,
      );
    }
    return this.assertInTenant(context, id);
  }

  async markApproved(context: TenantScope, id: string, actorId: string): Promise<Promotion> {
    const changed = await this.prisma.promotion.updateMany({
      where: { id, tenant_id: context.tenantId, status: 'draft', submitted_by: { not: null } },
      data: { approved_by: actorId, approved_at: new Date() },
    });
    if (changed.count !== 1) {
      const current = await this.findById(context, id);
      if (!current) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Promotion ${id} not found.`);
      throw new AthrDomainError(
        'PROMOTION_INVALID_TRANSITION',
        `Promotion ${id} is "${current.status}"; a "draft" must be submitted before it can be approved.`,
      );
    }
    return this.assertInTenant(context, id);
  }

  /**
   * Applies a single lifecycle transition inside one write — the same
   * predicate-in-`updateMany` idiom `TaxCodeRepository.transition` uses.
   */
  async transition(
    context: TenantScope,
    id: string,
    fromStatuses: readonly PromotionStatus[],
    toStatus: PromotionStatus,
    data: Prisma.PromotionUpdateManyMutationInput = {},
  ): Promise<Promotion> {
    const changed = await this.prisma.promotion.updateMany({
      where: { id, tenant_id: context.tenantId, status: { in: [...fromStatuses] } },
      data: { ...data, status: toStatus },
    });
    if (changed.count !== 1) {
      const current = await this.findById(context, id);
      if (!current) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Promotion ${id} not found.`);
      throw new AthrDomainError(
        'PROMOTION_INVALID_TRANSITION',
        `Promotion ${id} is "${current.status}"; expected one of [${fromStatuses.join(', ')}] to move to "${toStatus}".`,
      );
    }
    return this.assertInTenant(context, id);
  }
}
