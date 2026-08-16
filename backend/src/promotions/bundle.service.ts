import { Injectable } from '@nestjs/common';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantContext } from '../identity/tenant-context.type';
import { BundleRepository, type BundleWithComponents } from './bundle.repository';
import type { CreateBundleDto, ListBundlesDto, SupersedeBundleDto, UpdateBundleDraftDto } from './dto/bundle.dto';

/**
 * WP-008 Phase D — `Bundle` (BR-BND-1xx, OD-CAT-009 in the BR doc's own §35
 * numbering — virtual sales bundles only, no stock-kit assembly/
 * disassembly, §36). Lifecycle: draft -> active -> ended, plus `supersede`
 * for a new version (BR-BND-101).
 *
 * Matrix §16 declares only `catalog.bundle.manage` for this whole surface —
 * no maker-checker split the way Promotion/Tax/PriceBook have (schema
 * comment on `BundleComponent`), so every mutating route in
 * `BundleController` is gated on that single key.
 */
@Injectable()
export class BundleService {
  constructor(private readonly repo: BundleRepository) {}

  async list(context: TenantContext, dto: ListBundlesDto = {}) {
    const { rows, total } = await this.repo.list(context, {
      status: dto.status,
      page: dto.page,
      pageSize: dto.page_size,
    });
    return { items: rows, total, page: dto.page ?? 1, page_size: dto.page_size ?? 20 };
  }

  async findOne(context: TenantContext, id: string): Promise<BundleWithComponents> {
    return this.repo.assertInTenant(context, id);
  }

  async create(context: TenantContext, actorId: string, dto: CreateBundleDto): Promise<BundleWithComponents> {
    return this.repo.create(context, {
      name: dto.name.trim(),
      returnPolicy: dto.return_policy ?? null,
      version: 1,
      supersedesId: null,
      createdBy: actorId,
      components: dto.components.map((component) => ({
        variantId: component.variant_id,
        qty: component.qty,
      })),
    });
  }

  async updateDraft(
    context: TenantContext,
    id: string,
    dto: UpdateBundleDraftDto,
  ): Promise<BundleWithComponents> {
    return this.repo.updateDraft(context, id, {
      name: dto.name?.trim(),
      returnPolicy: dto.return_policy,
      components: dto.components?.map((component) => ({
        variantId: component.variant_id,
        qty: component.qty,
      })),
    });
  }

  /**
   * BR-BND-105/OD-CAT-012 analogue: a Bundle cannot activate without a
   * declared `return_policy`, and (not stated by any single BR rule but a
   * direct consequence of BR-BND-103 "Bundle price توزع على Components" —
   * there is nothing to allocate across) a Bundle with zero components.
   */
  async activate(context: TenantContext, actorId: string, id: string): Promise<BundleWithComponents> {
    const current = await this.repo.assertInTenant(context, id);
    if (!current.return_policy) {
      throw new AthrDomainError(
        'BUNDLE_RETURN_POLICY_REQUIRED',
        `Bundle ${id} has no return_policy; BR-BND-105 requires one before activation.`,
      );
    }
    if (current.components.length === 0) {
      throw new AthrDomainError('BUNDLE_EMPTY', `Bundle ${id} has no components.`);
    }
    return this.repo.transition(context, id, ['draft'], 'active', {
      activated_by: actorId,
      activated_at: new Date(),
    });
  }

  async end(context: TenantContext, actorId: string, id: string): Promise<BundleWithComponents> {
    return this.repo.transition(context, id, ['active'], 'ended', {
      ended_by: actorId,
      ended_at: new Date(),
    });
  }

  async supersede(
    context: TenantContext,
    actorId: string,
    id: string,
    dto: SupersedeBundleDto,
  ): Promise<BundleWithComponents> {
    return this.repo.draftNextVersion(context, id, {
      returnPolicy: dto.return_policy ?? null,
      createdBy: actorId,
      components: dto.components.map((component) => ({
        variantId: component.variant_id,
        qty: component.qty,
      })),
    });
  }

  /**
   * BR-BND-103: allocates a bundle's total selling price across its
   * components "بطريقة حتمية" (deterministically) — `proportional_price`
   * (the only MVP `BundleAllocationMethod`): each component's share of the
   * bundle total is proportional to its own standalone unit price × qty,
   * relative to the sum of all components' standalone (price × qty).
   *
   * Pure function, no DB access — callers (tests, a future Sales
   * integration) supply each component's standalone unit price. Rounding:
   * every component but the last is rounded to 2dp; the last absorbs the
   * remainder, so the parts always sum to exactly `bundleTotal` — the same
   * "no half-finished total" requirement `TaxResolutionService`'s inclusive
   * split enforces for net+tax.
   */
  allocatePrice(
    bundleTotal: number,
    components: readonly { variantId: string; qty: number; standaloneUnitPrice: number }[],
  ): { variantId: string; allocatedAmount: number }[] {
    if (components.length === 0) return [];
    const standaloneTotals = components.map((component) => component.qty * component.standaloneUnitPrice);
    const standaloneSum = standaloneTotals.reduce((sum, value) => sum + value, 0);
    if (standaloneSum <= 0) {
      // BR-BND-104 territory (nothing sellable to allocate against) — fail
      // loud rather than divide by zero or split evenly by guess.
      throw new AthrDomainError(
        'BUNDLE_EMPTY',
        'Cannot allocate a bundle price across components with zero total standalone value.',
      );
    }
    const allocations = components.map((component, index) => ({
      variantId: component.variantId,
      allocatedAmount: Math.round((bundleTotal * standaloneTotals[index] * 100) / standaloneSum) / 100,
    }));
    const allocatedSum = allocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
    const remainder = Math.round((bundleTotal - allocatedSum) * 100) / 100;
    if (remainder !== 0) {
      allocations[allocations.length - 1].allocatedAmount =
        Math.round((allocations[allocations.length - 1].allocatedAmount + remainder) * 100) / 100;
    }
    return allocations;
  }
}
