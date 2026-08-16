import { Injectable } from '@nestjs/common';
import type { Promotion } from '@prisma/client';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantContext } from '../identity/tenant-context.type';
import { PromotionRepository } from './promotion.repository';
import type { CreatePromotionDto, ListPromotionsDto, UpdatePromotionDraftDto } from './dto/promotion.dto';

/**
 * WP-008 Phase D — the `Promotion` lifecycle (BR-PMT-1xx, Permission Matrix
 * §19):
 *
 *   draft -[submit: sets submitted_by/at, status unchanged]->
 *   draft -[approve: sets approved_by/at, status unchanged]->
 *   draft -[schedule, requires both submitted_by AND approved_by]-> scheduled
 *   -> active -> paused <-> active -> ended
 *   draft/scheduled -> cancelled
 *
 * "submitted"/"approved" are never visible `status` values — see the
 * schema's `PromotionStatus` comment for why (BR-PMT-100 lists exactly seven
 * states and neither is one of them). `cancel()` is gated by
 * `promotion.end` at the controller — the Matrix declares no dedicated
 * `promotion.cancel` key for the `cancelled` state BR-PMT-100 lists, and
 * reusing `promotion.end` ("stop this promotion from applying further") was
 * judged the closer fit over leaving `cancel` completely ungated; flagged as
 * a discrepancy in the Phase D PR description. `archive()` is not
 * implemented at all in this phase — no Matrix key names it and no BR rule
 * describes a manual transition into it, so `archived` stays a documented,
 * currently-unreachable value in the enum (same "declared-but-unwired"
 * posture Phase C used for `tax.calculation.override`/`tax.export`).
 */
@Injectable()
export class PromotionService {
  constructor(private readonly repo: PromotionRepository) {}

  async list(context: TenantContext, dto: ListPromotionsDto = {}) {
    const { rows, total } = await this.repo.list(context, {
      status: dto.status,
      page: dto.page,
      pageSize: dto.page_size,
    });
    return { items: rows, total, page: dto.page ?? 1, page_size: dto.page_size ?? 20 };
  }

  async findOne(context: TenantContext, id: string): Promise<Promotion> {
    return this.repo.assertInTenant(context, id);
  }

  async create(context: TenantContext, actorId: string, dto: CreatePromotionDto): Promise<Promotion> {
    this.assertBenefitShape(dto);
    return this.repo.create(context, {
      name: dto.name.trim(),
      timezone: dto.timezone?.trim() ?? undefined,
      starts_at: new Date(dto.starts_at),
      ends_at: dto.ends_at ? new Date(dto.ends_at) : null,
      priority: dto.priority ?? undefined,
      stackability: dto.stackability ?? undefined,
      stack_group: dto.stack_group ?? null,
      benefit_type: dto.benefit_type,
      benefit_value: dto.benefit_value ?? null,
      bogo_buy_qty: dto.bogo_buy_qty ?? null,
      bogo_get_qty: dto.bogo_get_qty ?? null,
      bogo_get_discount_percent: dto.bogo_get_discount_percent ?? null,
      max_discount_amount: dto.max_discount_amount ?? null,
      max_units_per_order: dto.max_units_per_order ?? null,
      max_uses_per_customer: dto.max_uses_per_customer ?? null,
      scope_type: dto.scope_type ?? undefined,
      scope_id: dto.scope_id ?? null,
      min_qty: dto.min_qty ?? null,
      min_spend: dto.min_spend ?? null,
      min_spend_basis: dto.min_spend_basis ?? null,
      branch_id: dto.branch_id ?? null,
      customer_id: dto.customer_id ?? null,
      requires_coupon: dto.requires_coupon ?? undefined,
      return_policy: dto.return_policy ?? null,
      created_by: actorId,
    });
  }

  async updateDraft(
    context: TenantContext,
    id: string,
    dto: UpdatePromotionDraftDto,
  ): Promise<Promotion> {
    return this.repo.updateDraft(context, id, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.timezone !== undefined ? { timezone: dto.timezone.trim() } : {}),
      ...(dto.starts_at !== undefined ? { starts_at: new Date(dto.starts_at) } : {}),
      ...(dto.ends_at !== undefined ? { ends_at: dto.ends_at ? new Date(dto.ends_at) : null } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.stackability !== undefined ? { stackability: dto.stackability } : {}),
      ...(dto.stack_group !== undefined ? { stack_group: dto.stack_group } : {}),
      ...(dto.benefit_type !== undefined ? { benefit_type: dto.benefit_type } : {}),
      ...(dto.benefit_value !== undefined ? { benefit_value: dto.benefit_value } : {}),
      ...(dto.bogo_buy_qty !== undefined ? { bogo_buy_qty: dto.bogo_buy_qty } : {}),
      ...(dto.bogo_get_qty !== undefined ? { bogo_get_qty: dto.bogo_get_qty } : {}),
      ...(dto.bogo_get_discount_percent !== undefined
        ? { bogo_get_discount_percent: dto.bogo_get_discount_percent }
        : {}),
      ...(dto.max_discount_amount !== undefined ? { max_discount_amount: dto.max_discount_amount } : {}),
      ...(dto.max_units_per_order !== undefined ? { max_units_per_order: dto.max_units_per_order } : {}),
      ...(dto.max_uses_per_customer !== undefined
        ? { max_uses_per_customer: dto.max_uses_per_customer }
        : {}),
      ...(dto.scope_type !== undefined ? { scope_type: dto.scope_type } : {}),
      ...(dto.scope_id !== undefined ? { scope_id: dto.scope_id } : {}),
      ...(dto.min_qty !== undefined ? { min_qty: dto.min_qty } : {}),
      ...(dto.min_spend !== undefined ? { min_spend: dto.min_spend } : {}),
      ...(dto.min_spend_basis !== undefined ? { min_spend_basis: dto.min_spend_basis } : {}),
      ...(dto.branch_id !== undefined ? { branch_id: dto.branch_id } : {}),
      ...(dto.customer_id !== undefined ? { customer_id: dto.customer_id } : {}),
      ...(dto.requires_coupon !== undefined ? { requires_coupon: dto.requires_coupon } : {}),
      ...(dto.return_policy !== undefined ? { return_policy: dto.return_policy } : {}),
    });
  }

  async submit(context: TenantContext, actorId: string, id: string): Promise<Promotion> {
    return this.repo.markSubmitted(context, id, actorId);
  }

  /**
   * Permission Matrix §19: the actor who submitted a Promotion cannot also
   * approve it, same separation `TaxCodeService.approve` enforces for §18.
   */
  async approve(context: TenantContext, actorId: string, id: string): Promise<Promotion> {
    const current = await this.repo.assertInTenant(context, id);
    if (current.submitted_by && current.submitted_by === actorId) {
      throw new AthrDomainError(
        'PROMOTION_SELF_APPROVAL_FORBIDDEN',
        `Promotion ${id} was submitted by this user; approval requires an independent approver (Permission Matrix §19).`,
      );
    }
    return this.repo.markApproved(context, id, actorId);
  }

  async schedule(context: TenantContext, actorId: string, id: string): Promise<Promotion> {
    const current = await this.repo.assertInTenant(context, id);
    if (!current.submitted_by || !current.approved_by) {
      throw new AthrDomainError(
        'PROMOTION_INVALID_TRANSITION',
        `Promotion ${id} must be both submitted and approved before it can be scheduled (Permission Matrix §19).`,
      );
    }
    return this.repo.transition(context, id, ['draft'], 'scheduled', {
      scheduled_by: actorId,
      scheduled_at: new Date(),
    });
  }

  /**
   * OD-CAT-012 / BR-BEN-104: a Promotion cannot activate without a declared
   * `return_policy` — see the schema's `PromotionReturnPolicy` comment. This
   * is enforced here, not as a `NOT NULL` column, mirroring
   * `BundleService.activate`'s identical gate on `Bundle.return_policy`.
   */
  async activate(context: TenantContext, actorId: string, id: string): Promise<Promotion> {
    const current = await this.repo.assertInTenant(context, id);
    if (!current.return_policy) {
      throw new AthrDomainError(
        'PROMOTION_RETURN_POLICY_REQUIRED',
        `Promotion ${id} has no return_policy; OD-CAT-012 requires one before activation.`,
      );
    }
    return this.repo.transition(context, id, ['scheduled'], 'active', {
      activated_by: actorId,
      activated_at: new Date(),
    });
  }

  /** BR-PMT-104: pause blocks new use without rewriting anything already applied. */
  async pause(context: TenantContext, actorId: string, id: string): Promise<Promotion> {
    return this.repo.transition(context, id, ['active'], 'paused', {
      paused_by: actorId,
      paused_at: new Date(),
    });
  }

  async resume(context: TenantContext, actorId: string, id: string): Promise<Promotion> {
    return this.repo.transition(context, id, ['paused'], 'active', {
      resumed_by: actorId,
      resumed_at: new Date(),
    });
  }

  /** BR-PMT-103: ending never reprices a sale that already completed. */
  async end(context: TenantContext, actorId: string, id: string): Promise<Promotion> {
    return this.repo.transition(context, id, ['active', 'paused'], 'ended', {
      ended_by: actorId,
      ended_at: new Date(),
    });
  }

  async cancel(context: TenantContext, actorId: string, id: string): Promise<Promotion> {
    return this.repo.transition(context, id, ['draft', 'scheduled'], 'cancelled', {
      cancelled_by: actorId,
      cancelled_at: new Date(),
    });
  }

  /** BR-BEN-100/OD-CAT-007: `benefit_value` XOR `bogo_*`, never both, never neither. */
  private assertBenefitShape(dto: CreatePromotionDto): void {
    if (dto.benefit_type === 'bogo') {
      if (!dto.bogo_buy_qty || !dto.bogo_get_qty || dto.bogo_get_discount_percent === undefined) {
        throw new AthrDomainError(
          'REQUEST_FIELD_VALUE_INVALID',
          'A "bogo" promotion requires bogo_buy_qty, bogo_get_qty and bogo_get_discount_percent.',
        );
      }
    } else if (dto.benefit_value === undefined) {
      throw new AthrDomainError(
        'REQUEST_FIELD_VALUE_INVALID',
        `A "${dto.benefit_type}" promotion requires benefit_value.`,
      );
    }
  }
}
