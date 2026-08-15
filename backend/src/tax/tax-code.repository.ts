import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma, TaxCategory, TaxCode, TaxCodeStatus, TaxMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export interface TaxCodeFilters {
  readonly status?: TaxCodeStatus;
  readonly taxCategoryId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface TaxCategoryFilters {
  readonly activeOnly?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * WP-008 Phase C — tenant-scoped repository for `TaxCategory`/`TaxCode`,
 * following the `findById(context,id)/list(context,filters)/save(context,
 * aggregate)` contract from Multi-tenancy Blueprint §29 that Phases A and B
 * already established.
 *
 * Structurally this is `PriceBookRepository` with `supersede` where `end` was
 * (WP-008 compliance item 2.3: the versioned-entity pattern must be the same
 * across Price Book, Tax Code and Promotion so a fourth versioned type needs
 * no new plumbing). The two idioms worth copying deliberately rather than
 * re-deriving are marked on `transition` and `activate` below.
 */
@Injectable()
export class TaxCodeRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- TaxCategory ---------------------------------------------------------

  async findCategoryById(context: TenantScope, id: string): Promise<TaxCategory | null> {
    return this.prisma.taxCategory.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async assertCategoryInTenant(context: TenantScope, id: string): Promise<TaxCategory> {
    const category = await this.findCategoryById(context, id);
    if (!category) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Tax category ${id} not found.`);
    }
    return category;
  }

  async listCategories(
    context: TenantScope,
    filters: TaxCategoryFilters = {},
  ): Promise<{ rows: TaxCategory[]; total: number }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 20;
    const where: Prisma.TaxCategoryWhereInput = {
      tenant_id: context.tenantId,
      ...(filters.activeOnly ? { is_active: true } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.taxCategory.findMany({
        where,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.taxCategory.count({ where }),
    ]);
    return { rows, total };
  }

  async createCategory(
    context: TenantScope,
    data: {
      code: string;
      nameEn: string;
      nameAr: string | null;
      description: string | null;
      createdBy: string;
    },
  ): Promise<TaxCategory> {
    return this.prisma.taxCategory.create({
      data: {
        tenant_id: context.tenantId,
        code: data.code,
        name_en: data.nameEn,
        name_ar: data.nameAr,
        description: data.description,
        created_by: data.createdBy,
      },
    });
  }

  // --- TaxCode -------------------------------------------------------------

  async findById(context: TenantScope, id: string): Promise<TaxCode | null> {
    return this.prisma.taxCode.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async assertInTenant(context: TenantScope, id: string): Promise<TaxCode> {
    const code = await this.findById(context, id);
    if (!code) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Tax code ${id} not found.`);
    return code;
  }

  async list(
    context: TenantScope,
    filters: TaxCodeFilters = {},
  ): Promise<{ rows: TaxCode[]; total: number }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 20;
    const where: Prisma.TaxCodeWhereInput = {
      tenant_id: context.tenantId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.taxCategoryId ? { tax_category_id: filters.taxCategoryId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.taxCode.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.taxCode.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * The currently active code for a category. This is what a transaction
   * snapshots (BR-TAX-202) — `TaxCode_one_active_per_category` guarantees at
   * most one row can match, so there is no tie to break.
   */
  async findActiveForCategory(
    context: TenantScope,
    taxCategoryId: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<TaxCode | null> {
    const db = transaction ?? this.prisma;
    return db.taxCode.findFirst({
      where: { tenant_id: context.tenantId, tax_category_id: taxCategoryId, status: 'active' },
    });
  }

  /** Every active code in the tenant, for bulk paths (POS catalog snapshot). */
  async listActive(
    context: TenantScope,
    transaction?: Prisma.TransactionClient,
  ): Promise<TaxCode[]> {
    const db = transaction ?? this.prisma;
    return db.taxCode.findMany({
      where: { tenant_id: context.tenantId, status: 'active' },
    });
  }

  async createDraft(
    context: TenantScope,
    data: {
      taxCategoryId: string;
      code: string;
      nameEn: string;
      nameAr: string | null;
      jurisdiction: string;
      rate: Prisma.Decimal.Value;
      taxMode: TaxMode;
      roundingPolicy: 'line' | 'document';
      exemptionAllowed: boolean;
      effectiveFrom: Date | null;
      version: number;
      supersedesId: string | null;
      createdBy: string;
    },
  ): Promise<TaxCode> {
    return this.prisma.taxCode.create({
      data: {
        tenant_id: context.tenantId,
        tax_category_id: data.taxCategoryId,
        code: data.code,
        name_en: data.nameEn,
        name_ar: data.nameAr,
        jurisdiction: data.jurisdiction,
        rate: data.rate,
        tax_mode: data.taxMode,
        rounding_policy: data.roundingPolicy,
        exemption_allowed: data.exemptionAllowed,
        effective_from: data.effectiveFrom,
        version: data.version,
        supersedes_id: data.supersedesId,
        created_by: data.createdBy,
        status: 'draft',
      },
    });
  }

  /**
   * BR-TAX-203: a draft's rate may still be edited; an **active** code's rate
   * is immutable — changing what was charged is what a new version is for.
   * The `status` predicate is inside the `updateMany`, so a draft that was
   * concurrently submitted is not silently edited underneath the submitter.
   */
  async updateDraft(
    context: TenantScope,
    id: string,
    data: {
      nameEn?: string;
      nameAr?: string | null;
      rate?: Prisma.Decimal.Value;
      taxMode?: TaxMode;
      roundingPolicy?: 'line' | 'document';
      exemptionAllowed?: boolean;
      effectiveFrom?: Date | null;
    },
  ): Promise<TaxCode> {
    const changed = await this.prisma.taxCode.updateMany({
      where: { id, tenant_id: context.tenantId, status: 'draft' },
      data: {
        ...(data.nameEn !== undefined ? { name_en: data.nameEn } : {}),
        ...(data.nameAr !== undefined ? { name_ar: data.nameAr } : {}),
        ...(data.rate !== undefined ? { rate: data.rate } : {}),
        ...(data.taxMode !== undefined ? { tax_mode: data.taxMode } : {}),
        ...(data.roundingPolicy !== undefined ? { rounding_policy: data.roundingPolicy } : {}),
        ...(data.exemptionAllowed !== undefined
          ? { exemption_allowed: data.exemptionAllowed }
          : {}),
        ...(data.effectiveFrom !== undefined ? { effective_from: data.effectiveFrom } : {}),
      },
    });
    if (changed.count !== 1) {
      const current = await this.findById(context, id);
      if (!current) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Tax code ${id} not found.`);
      throw new AthrDomainError(
        'TAX_CODE_INVALID_TRANSITION',
        `Tax code ${id} is "${current.status}"; only a "draft" may be edited. Create a new version to change an active rate (BR-TAX-203).`,
      );
    }
    return this.assertInTenant(context, id);
  }

  /**
   * Applies a single lifecycle transition inside one write. The previous
   * `status` is part of the `updateMany` predicate — the idiom
   * `PriceBookRepository.transition` established — so a concurrent transition
   * (or a stale client retrying an already-applied one) affects zero rows and
   * is rejected, instead of two callers both "succeeding".
   */
  async transition(
    context: TenantScope,
    id: string,
    fromStatuses: readonly TaxCodeStatus[],
    toStatus: TaxCodeStatus,
    data: Prisma.TaxCodeUpdateManyMutationInput = {},
  ): Promise<TaxCode> {
    const changed = await this.prisma.taxCode.updateMany({
      where: { id, tenant_id: context.tenantId, status: { in: [...fromStatuses] } },
      data: { ...data, status: toStatus },
    });
    if (changed.count !== 1) {
      const current = await this.findById(context, id);
      if (!current) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Tax code ${id} not found.`);
      throw new AthrDomainError(
        'TAX_CODE_INVALID_TRANSITION',
        `Tax code ${id} is "${current.status}"; expected one of [${fromStatuses.join(', ')}] to move to "${toStatus}".`,
      );
    }
    return this.assertInTenant(context, id);
  }

  /**
   * BR-TAX-203 — activation, the one transition that changes what a till
   * charges.
   *
   * **Statement order matters.** `TaxCode_one_active_per_category` is a
   * partial unique index over `(tenant_id, tax_category_id) WHERE status =
   * 'active'`, and a non-deferrable unique index is checked per statement,
   * not at COMMIT. Activating the successor first therefore raises P2002
   * against a real database even though both writes are in one transaction —
   * so the incumbent is demoted to `superseded` *before* the successor is
   * promoted. This is the exact trap `PriceBookRepository.supersedeEntry`
   * documents; it cost Phase B a review cycle and is not re-derivable from a
   * green `fakePrisma` spec, which is why
   * `scripts/verify-tax-code-behaviour.cjs` proves it against real Postgres.
   *
   * Both writes are `updateMany`s predicated on the status they expect, so two
   * concurrent activations cannot both win: the loser sees `count === 0`.
   */
  async activate(context: TenantScope, id: string, actorId: string): Promise<TaxCode> {
    const candidate = await this.assertInTenant(context, id);
    if (candidate.status !== 'approved' && candidate.status !== 'scheduled') {
      throw new AthrDomainError(
        'TAX_CODE_INVALID_TRANSITION',
        `Tax code ${id} is "${candidate.status}"; expected one of [approved, scheduled] to move to "active".`,
      );
    }

    const activatedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      // 1. Demote the incumbent, if any, out of the partial index first.
      const incumbent = await tx.taxCode.findFirst({
        where: {
          tenant_id: context.tenantId,
          tax_category_id: candidate.tax_category_id,
          status: 'active',
        },
      });
      if (incumbent) {
        if (incumbent.id === id) return incumbent;
        const demoted = await tx.taxCode.updateMany({
          where: { id: incumbent.id, tenant_id: context.tenantId, status: 'active' },
          data: {
            status: 'superseded',
            superseded_at: activatedAt,
            superseded_by_id: candidate.id,
            effective_to: activatedAt,
          },
        });
        if (demoted.count !== 1) {
          throw new AthrDomainError(
            'TAX_CODE_INVALID_TRANSITION',
            `Tax code ${incumbent.id} was superseded concurrently; retry the activation.`,
          );
        }
      }

      // 2. Only now promote the successor into the index.
      const promoted = await tx.taxCode.updateMany({
        where: {
          id,
          tenant_id: context.tenantId,
          status: { in: ['approved', 'scheduled'] },
        },
        data: {
          status: 'active',
          activated_by: actorId,
          activated_at: activatedAt,
          // Never overwrite an explicitly scheduled effective_from.
          ...(candidate.effective_from ? {} : { effective_from: activatedAt }),
          ...(incumbent ? { supersedes_id: incumbent.id } : {}),
        },
      });
      if (promoted.count !== 1) {
        throw new AthrDomainError(
          'TAX_CODE_INVALID_TRANSITION',
          `Tax code ${id} was transitioned concurrently; retry the activation.`,
        );
      }

      const result = await tx.taxCode.findFirst({ where: { id, tenant_id: context.tenantId } });
      if (!result) throw new AthrDomainError('RESOURCE_NOT_FOUND', `Tax code ${id} not found.`);
      return result;
    });
  }

  /**
   * Creates the next draft version of an active code. The predecessor is left
   * untouched and stays active until the successor is activated — BR-TAX-203
   * means a rate change must never be visible before it is deliberately
   * switched on, and must never retroactively touch what the predecessor
   * already stamped onto documents.
   */
  async draftNextVersion(
    context: TenantScope,
    previousId: string,
    data: {
      rate: Prisma.Decimal.Value;
      taxMode: TaxMode;
      effectiveFrom: Date | null;
      createdBy: string;
    },
  ): Promise<TaxCode> {
    const previous = await this.assertInTenant(context, previousId);
    if (previous.status !== 'active') {
      throw new AthrDomainError(
        'TAX_CODE_INVALID_TRANSITION',
        `Tax code ${previousId} is "${previous.status}"; only an active version may be superseded.`,
      );
    }
    return this.createDraft(context, {
      taxCategoryId: previous.tax_category_id,
      code: previous.code,
      nameEn: previous.name_en,
      nameAr: previous.name_ar,
      jurisdiction: previous.jurisdiction,
      rate: data.rate,
      taxMode: data.taxMode,
      roundingPolicy: previous.rounding_policy,
      exemptionAllowed: previous.exemption_allowed,
      effectiveFrom: data.effectiveFrom,
      version: previous.version + 1,
      supersedesId: previous.id,
      createdBy: data.createdBy,
    });
  }

  /** `randomUUID` is exposed for callers that need to pre-generate ids. */
  static newId(): string {
    return randomUUID();
  }
}
