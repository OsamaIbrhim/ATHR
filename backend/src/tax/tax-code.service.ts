import { Injectable } from '@nestjs/common';
import type { TaxCategory, TaxCode } from '@prisma/client';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantContext } from '../identity/tenant-context.type';
import { TaxCodeRepository } from './tax-code.repository';
import type {
  CreateTaxCategoryDto,
  CreateTaxCodeDto,
  ListTaxCategoriesDto,
  ListTaxCodesDto,
  ScheduleTaxCodeDto,
  SupersedeTaxCodeDto,
  UpdateTaxCodeDraftDto,
} from './dto/tax-code.dto';

/**
 * WP-008 Phase C — the `TaxCode` maker-checker lifecycle
 * (BR-TAX-200, Permission Matrix §18):
 *
 *   draft -> submitted -> approved -> scheduled -> active -> superseded
 *
 * Structurally identical to `PriceBookService` (WP-008 compliance item 2.3),
 * with `supersede` where `end` was: a tax code is never "ended", it is
 * replaced by a successor version, because BR-TAX-203 requires the version a
 * document was taxed under to remain readable forever.
 */
@Injectable()
export class TaxCodeService {
  constructor(private readonly repo: TaxCodeRepository) {}

  // --- Categories ----------------------------------------------------------

  async listCategories(context: TenantContext, dto: ListTaxCategoriesDto = {}) {
    const { rows, total } = await this.repo.listCategories(context, {
      activeOnly: dto.active_only,
      page: dto.page,
      pageSize: dto.page_size,
    });
    return { items: rows, total, page: dto.page ?? 1, page_size: dto.page_size ?? 20 };
  }

  /**
   * The service-layer contract `ProductsService` uses to attach a category to
   * a new product (CLAUDE.md §2.2 / WP-008 item 2.2: `products` goes through
   * this, never into `TaxCodeRepository` directly).
   */
  async findCategoryInTenant(context: TenantContext, id: string): Promise<TaxCategory | null> {
    return this.repo.findCategoryById(context, id);
  }

  /**
   * The tenant's `STANDARD` category — the one migration `202608130003`
   * created for every tenant that owned products. Returns null rather than
   * creating one: silently inventing a tax category for a tenant that has
   * none would be the kind of default this phase exists to remove.
   */
  async findDefaultCategory(context: TenantContext): Promise<TaxCategory | null> {
    const { rows } = await this.repo.listCategories(context, { activeOnly: true, pageSize: 100 });
    return rows.find((category) => category.code === 'STANDARD') ?? rows[0] ?? null;
  }

  async createCategory(
    context: TenantContext,
    actorId: string,
    dto: CreateTaxCategoryDto,
  ): Promise<TaxCategory> {
    return this.repo.createCategory(context, {
      code: dto.code.trim().toUpperCase(),
      nameEn: dto.name_en.trim(),
      nameAr: dto.name_ar?.trim() ?? null,
      description: dto.description?.trim() ?? null,
      createdBy: actorId,
    });
  }

  // --- Codes ---------------------------------------------------------------

  async list(context: TenantContext, dto: ListTaxCodesDto = {}) {
    const { rows, total } = await this.repo.list(context, {
      status: dto.status,
      taxCategoryId: dto.tax_category_id,
      page: dto.page,
      pageSize: dto.page_size,
    });
    return { items: rows, total, page: dto.page ?? 1, page_size: dto.page_size ?? 20 };
  }

  async findOne(context: TenantContext, id: string): Promise<TaxCode> {
    return this.repo.assertInTenant(context, id);
  }

  async create(context: TenantContext, actorId: string, dto: CreateTaxCodeDto): Promise<TaxCode> {
    // Tenant-scoped existence check before the FK would reject it, so a
    // cross-tenant category id reads as "not found" rather than leaking that
    // the id exists somewhere else (Multi-tenancy Blueprint §32).
    await this.repo.assertCategoryInTenant(context, dto.tax_category_id);

    return this.repo.createDraft(context, {
      taxCategoryId: dto.tax_category_id,
      code: dto.code.trim().toUpperCase(),
      nameEn: dto.name_en.trim(),
      nameAr: dto.name_ar?.trim() ?? null,
      jurisdiction: dto.jurisdiction?.trim().toUpperCase() ?? 'EG',
      rate: dto.rate,
      taxMode: dto.tax_mode,
      roundingPolicy: dto.rounding_policy ?? 'line',
      exemptionAllowed: dto.exemption_allowed ?? false,
      effectiveFrom: dto.effective_from ? new Date(dto.effective_from) : null,
      version: 1,
      supersedesId: null,
      createdBy: actorId,
    });
  }

  async updateDraft(
    context: TenantContext,
    id: string,
    dto: UpdateTaxCodeDraftDto,
  ): Promise<TaxCode> {
    return this.repo.updateDraft(context, id, {
      nameEn: dto.name_en?.trim(),
      nameAr: dto.name_ar === undefined ? undefined : (dto.name_ar?.trim() ?? null),
      rate: dto.rate,
      taxMode: dto.tax_mode,
      roundingPolicy: dto.rounding_policy,
      exemptionAllowed: dto.exemption_allowed,
      effectiveFrom:
        dto.effective_from === undefined ? undefined : new Date(dto.effective_from),
    });
  }

  async submit(context: TenantContext, actorId: string, id: string): Promise<TaxCode> {
    return this.repo.transition(context, id, ['draft'], 'submitted', {
      submitted_by: actorId,
      submitted_at: new Date(),
    });
  }

  /**
   * Permission Matrix §18: tax rule activation is H/A2/P2 — an independent
   * approver. The submitter of a version cannot approve it, even when their
   * role holds both keys; the permission catalog expresses "may this role call
   * this endpoint", never the per-instance separation (same reasoning as
   * `PriceBookService.approve`, Matrix §17 "Separation").
   */
  async approve(context: TenantContext, actorId: string, id: string): Promise<TaxCode> {
    const current = await this.repo.assertInTenant(context, id);
    if (current.submitted_by && current.submitted_by === actorId) {
      throw new AthrDomainError(
        'TAX_CODE_SELF_APPROVAL_FORBIDDEN',
        `Tax code ${id} was submitted by this user; approval requires an independent approver (Permission Matrix §18, H/A2/P2).`,
      );
    }
    return this.repo.transition(context, id, ['submitted'], 'approved', {
      approved_by: actorId,
      approved_at: new Date(),
    });
  }

  async schedule(
    context: TenantContext,
    actorId: string,
    id: string,
    dto: ScheduleTaxCodeDto = {},
  ): Promise<TaxCode> {
    return this.repo.transition(context, id, ['approved'], 'scheduled', {
      scheduled_by: actorId,
      scheduled_at: new Date(),
      ...(dto.effective_from ? { effective_from: new Date(dto.effective_from) } : {}),
    });
  }

  /**
   * The transition that changes what a till charges. `TaxCodeRepository
   * .activate` demotes the incumbent before promoting the successor (partial
   * unique index ordering), and migration `202608130008`'s trigger turns the
   * resulting status change into a `SyncChange` so POS terminals actually
   * receive the new rate — Phase B shipped without that and tills would have
   * served stale prices indefinitely.
   */
  async activate(context: TenantContext, actorId: string, id: string): Promise<TaxCode> {
    return this.repo.activate(context, id, actorId);
  }

  /**
   * BR-TAX-203: creates the next DRAFT version. The live version keeps
   * charging until the successor is separately approved and activated —
   * drafting a successor must never change a rate on its own.
   */
  async supersede(
    context: TenantContext,
    actorId: string,
    id: string,
    dto: SupersedeTaxCodeDto,
  ): Promise<TaxCode> {
    return this.repo.draftNextVersion(context, id, {
      rate: dto.rate,
      taxMode: dto.tax_mode,
      effectiveFrom: dto.effective_from ? new Date(dto.effective_from) : null,
      createdBy: actorId,
    });
  }
}
