import { Injectable } from '@nestjs/common';
import { PriceBookRepository } from './price-book.repository';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantContext } from '../identity/tenant-context.type';
import {
  CreatePriceBookDto,
  ListPriceBooksDto,
  SchedulePriceBookDto,
  UpdatePriceBookDraftDto,
} from './dto/price-book.dto';
import { CreatePriceEntryDto, SupersedePriceEntryDto } from './dto/price-book-entry.dto';

/**
 * WP-008 Phase B (BR-PRB-1xx, Permission Matrix §17): the Price Book
 * maker-checker lifecycle. Each transition method enforces its own previous
 * status via `PriceBookRepository.transition` (repository-level, so a race
 * between two callers can never double-apply a transition); this service
 * layers the *business* checks a bare status check can't express —
 * self-approval, currency, and the "one default book" invariant.
 */
@Injectable()
export class PriceBookService {
  constructor(
    private readonly repository: PriceBookRepository,
    private readonly prisma: PrismaService,
  ) {}

  list(context: TenantContext, dto: ListPriceBooksDto) {
    return this.repository.list(context, { status: dto.status, page: dto.page, pageSize: dto.page_size });
  }

  findOne(context: TenantContext, id: string) {
    return this.repository.assertInTenant(context, id);
  }

  async create(context: TenantContext, actorId: string, dto: CreatePriceBookDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: context.tenantId } });
    if (!tenant) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', `Tenant ${context.tenantId} not found.`);
    }
    // BR-PRB-100/OD-CAT-005: Phase B is single-operating-currency — a Price
    // Book's currency must equal the tenant's `default_currency`.
    const currency = dto.currency ?? tenant.default_currency;
    if (currency !== tenant.default_currency) {
      throw new AthrDomainError(
        'PRICING_CURRENCY_MISMATCH',
        `Price Book currency must be the tenant's operating currency ("${tenant.default_currency}"), not "${currency}".`,
      );
    }
    return this.repository.create(context, {
      name: dto.name,
      currency,
      scope: dto.scope ?? 'tenant_default',
      scopeRefId: dto.scope_ref_id ?? null,
      isDefault: dto.is_default ?? false,
      createdBy: actorId,
    });
  }

  async updateDraft(context: TenantContext, id: string, dto: UpdatePriceBookDraftDto) {
    const book = await this.repository.assertInTenant(context, id);
    if (book.status !== 'draft') {
      throw new AthrDomainError(
        'PRICING_PRICE_BOOK_INVALID_TRANSITION',
        `Price Book ${id} is "${book.status}"; only a "draft" book can be edited directly.`,
      );
    }
    return this.repository.updateDraftName(context, id, dto.name);
  }

  submit(context: TenantContext, actorId: string, id: string) {
    return this.repository.transition(context, id, ['draft'], 'submitted', {
      submitted_by: actorId,
      submitted_at: new Date(),
    });
  }

  /** Permission Matrix §17 "Separation": the submitter cannot also approve. */
  async approve(context: TenantContext, actorId: string, id: string) {
    const book = await this.repository.assertInTenant(context, id);
    if (book.submitted_by && book.submitted_by === actorId) {
      throw new AthrDomainError(
        'PRICING_PRICE_BOOK_SELF_APPROVAL_FORBIDDEN',
        `Price Book ${id} was submitted by this same actor; an independent approver is required.`,
      );
    }
    return this.repository.transition(context, id, ['submitted'], 'approved', {
      approved_by: actorId,
      approved_at: new Date(),
    });
  }

  schedule(context: TenantContext, actorId: string, id: string, dto: SchedulePriceBookDto) {
    return this.repository.transition(context, id, ['approved'], 'scheduled', {
      scheduled_by: actorId,
      scheduled_at: new Date(),
      ...(dto.effective_from ? { effective_from: new Date(dto.effective_from) } : {}),
    });
  }

  /**
   * BR-PRB-104: activating a book flagged `is_default` ends whatever book
   * currently holds that default for the same (currency, scope,
   * scope_ref_id), atomically, so there is never a window with two "active
   * default" books nor zero.
   */
  async activate(context: TenantContext, actorId: string, id: string) {
    const book = await this.repository.assertInTenant(context, id);
    if (book.status !== 'scheduled') {
      throw new AthrDomainError(
        'PRICING_PRICE_BOOK_INVALID_TRANSITION',
        `Price Book ${id} is "${book.status}"; expected "scheduled" to activate.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (book.is_default) {
        const previousDefault = await tx.priceBook.findFirst({
          where: {
            tenant_id: context.tenantId,
            currency: book.currency,
            scope: book.scope,
            scope_ref_id: book.scope_ref_id,
            is_default: true,
            status: 'active',
            id: { not: book.id },
          },
        });
        if (previousDefault) {
          await tx.priceBook.update({
            where: { id: previousDefault.id },
            data: { status: 'ended', ended_by: actorId, ended_at: new Date(), is_default: false },
          });
        }
      }
      const changed = await tx.priceBook.updateMany({
        where: { id, tenant_id: context.tenantId, status: 'scheduled' },
        data: { status: 'active', activated_by: actorId, activated_at: new Date() },
      });
      if (changed.count !== 1) {
        throw new AthrDomainError(
          'PRICING_PRICE_BOOK_INVALID_TRANSITION',
          `Price Book ${id} could not be activated — it was changed concurrently.`,
        );
      }
      return tx.priceBook.findFirst({ where: { id, tenant_id: context.tenantId } });
    });
  }

  end(context: TenantContext, actorId: string, id: string) {
    return this.repository.endBook(context, id, actorId);
  }

  // --- Entries -------------------------------------------------------------

  listEntries(context: TenantContext, priceBookId?: string) {
    return this.repository.listEntries(context, { priceBookId });
  }

  async createEntry(context: TenantContext, actorId: string, dto: CreatePriceEntryDto) {
    const book = await this.repository.assertInTenant(context, dto.price_book_id);
    this.assertEntriesManageable(book.status);
    if (dto.scope_type !== 'global' && !dto.scope_id) {
      throw new AthrDomainError(
        'REQUEST_FIELD_VALUE_INVALID',
        'scope_id is required unless scope_type is "global".',
      );
    }
    this.assertValidPrice(dto.unit_price, dto.allow_zero_price ?? false);
    return this.repository.createEntry(context, {
      priceBookId: book.id,
      scopeType: dto.scope_type,
      scopeId: dto.scope_type === 'global' ? null : dto.scope_id!,
      minQty: dto.min_qty ?? 1,
      unitPrice: dto.unit_price,
      allowZeroPrice: dto.allow_zero_price ?? false,
      taxPercent: dto.tax_percent ?? 14,
      floorPrice: dto.floor_price ?? null,
      createdBy: actorId,
    });
  }

  async supersedeEntry(context: TenantContext, actorId: string, id: string, dto: SupersedePriceEntryDto) {
    const entry = await this.repository.assertEntryInTenant(context, id);
    const book = await this.repository.assertInTenant(context, entry.price_book_id);
    this.assertEntriesManageable(book.status);
    this.assertValidPrice(dto.unit_price, dto.allow_zero_price ?? false);
    return this.repository.supersedeEntry(context, id, {
      unitPrice: dto.unit_price,
      allowZeroPrice: dto.allow_zero_price ?? false,
      taxPercent: dto.tax_percent ?? 14,
      floorPrice: dto.floor_price ?? null,
      createdBy: actorId,
    });
  }

  private assertEntriesManageable(status: string) {
    if (status !== 'draft' && status !== 'active') {
      throw new AthrDomainError(
        'PRICING_PRICE_BOOK_INVALID_TRANSITION',
        `Entries can only be managed on a "draft" or "active" Price Book (current status: "${status}").`,
      );
    }
  }

  // BR-PSL-102/103: negative is never valid; zero requires the explicit allowance.
  private assertValidPrice(unitPrice: number, allowZeroPrice: boolean) {
    if (unitPrice < 0) {
      throw new AthrDomainError('PRICING_ZERO_OR_NEGATIVE_PRICE_NOT_ALLOWED', 'unit_price must not be negative.');
    }
    if (unitPrice === 0 && !allowZeroPrice) {
      throw new AthrDomainError(
        'PRICING_ZERO_OR_NEGATIVE_PRICE_NOT_ALLOWED',
        'A zero unit_price requires allow_zero_price.',
      );
    }
  }
}
