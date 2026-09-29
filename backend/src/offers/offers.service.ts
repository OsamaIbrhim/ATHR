import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';
import { decimal, moneyNumber } from '../common/money';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '../identity/tenant-context.type';
import { FIRST_PAGE, pageArgs, pageOf, type PageQuery } from '../common/pagination';

const MAX_SLOW_ROWS = 200;

@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private costVisibility: CostVisibilityService,
  ) {}

  async suggestions(
    context: TenantContext,
    actor: AuthenticatedUser,
    branch_id?: string,
    paging: PageQuery = FIRST_PAGE,
  ) {
    await this.generate(context, branch_id);

    const where: Prisma.OfferSuggestionWhereInput = {
      tenant_id: context.tenantId,
      status: 'pending',
      ...(branch_id ? { branch_id } : {}),
    };
    const [page, total] = await Promise.all([
      this.prisma.offerSuggestion.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        ...pageArgs(paging),
      }),
      this.prisma.offerSuggestion.count({ where }),
    ]);
    const stock = page.length
      ? await this.prisma.inventoryStock.findMany({
          where: {
            tenant_id: context.tenantId,
            variant_id: { in: [...new Set(page.map((item) => item.variant_id))] },
            warehouse: { is_default: true, branch_id: { in: [...new Set(page.map((item) => item.branch_id))] } },
          },
          include: { warehouse: { select: { branch_id: true } } },
        })
      : [];
    const qtyByStock = new Map(stock.map((row) => [`${row.warehouse.branch_id}:${row.variant_id}`, row.qty_on_hand]));
    const rows = page.map((item) => ({
      ...item,
      qty: qtyByStock.get(`${item.branch_id}:${item.variant_id}`) || 0,
    }));
    // BR-CST-101: the persisted row keeps the true floor and the true suggested
    // price for audit; only the HTTP projection drops them. `suggested_price`
    // is max(floor, current x 0.90), so on the clamped branch it equals the
    // floor exactly -- the gate drops it there too, and leaves it alone on the
    // x 0.90 branch where it discloses nothing. See `maskOfferSuggestion`.
    return pageOf(await this.costVisibility.maskOfferSuggestions(actor, rows), total, paging);
  }

  /**
   * Suggests a price cut for the longest-unsold stock that has no pending
   * suggestion yet. Set-based: one pass to price every candidate and one
   * statement to insert them, instead of a pricing round trip plus a
   * transaction per row.
   */
  private async generate(context: TenantContext, branch_id?: string) {
    const cutoff = new Date(Date.now() - 90 * 86400000);
    // Offers are per branch: the stock of each branch's default (selling) warehouse.
    const slowRows = await this.prisma.inventoryStock.findMany({
      where: {
        tenant_id: context.tenantId,
        OR: [{ last_sold_at: { lt: cutoff } }, { last_sold_at: null }],
        qty_on_hand: { gt: 0 },
        warehouse: { is_default: true, branch_id: branch_id ?? { not: null } },
      },
      include: { warehouse: { select: { branch_id: true } } },
      // Longest-unsold first; a bounded batch keeps one request cheap.
      orderBy: [{ last_sold_at: { sort: 'asc', nulls: 'first' } }, { variant_id: 'asc' }],
      take: MAX_SLOW_ROWS,
    });
    if (!slowRows.length) return;
    const slow = slowRows.map(({ warehouse, ...stock }) => ({ ...stock, branch_id: warehouse.branch_id! }));
    const variantIds = [...new Set(slow.map((stock) => stock.variant_id))];

    const pending = await this.prisma.offerSuggestion.findMany({
      where: { tenant_id: context.tenantId, status: 'pending', variant_id: { in: variantIds } },
      select: { branch_id: true, variant_id: true },
    });
    const pendingKeys = new Set(pending.map((item) => `${item.branch_id}:${item.variant_id}`));
    const fresh = slow.filter((stock) => !pendingKeys.has(`${stock.branch_id}:${stock.variant_id}`));
    if (!fresh.length) return;

    const variants = await this.prisma.productVariant.findMany({
      where: { tenant_id: context.tenantId, id: { in: [...new Set(fresh.map((stock) => stock.variant_id))] } },
      include: { product: true },
      relationLoadStrategy: 'join',
    });
    // WP-008 Phase B: BR-PSL-101 -- a variant with no resolvable Price Book
    // entry is not eligible for a suggestion; one unpriced slow-mover must not
    // abort the batch, so `quoteAvailable` leaves it out.
    const quotes = await this.pricing.quoteAvailable(context, variants);
    const data = fresh.flatMap((stock) => {
      const quote = quotes.get(stock.variant_id);
      if (!quote) {
        this.logger.warn(`Skipping offer suggestion for unpriced variant ${stock.variant_id}`);
        return [];
      }
      const currentPrice = quote.selling_price;
      return [{
        tenant_id: context.tenantId,
        variant_id: stock.variant_id,
        branch_id: stock.branch_id,
        status: 'pending',
        days_unsold: stock.last_sold_at
          ? Math.floor((Date.now() - stock.last_sold_at.getTime()) / 86400000)
          : 999,
        current_price: currentPrice,
        suggested_price: moneyNumber(
          Prisma.Decimal.max(decimal(quote.min_allowed_price), decimal(currentPrice).mul('0.90')),
        ),
        min_allowed_price: quote.min_allowed_price,
      }];
    });
    // `OfferSuggestion_one_pending_per_stock` is unique per (branch, variant)
    // while pending, so a concurrent request cannot create a duplicate: the
    // loser's rows are skipped.
    if (data.length) await this.prisma.offerSuggestion.createMany({ data, skipDuplicates: true });
  }

  async review(
    context: TenantContext,
    id: string,
    status: 'approved' | 'rejected',
    actor: AuthenticatedUser,
  ) {
    const reviewed = await this.prisma.$transaction(async (tx) => {
      const suggestion = await tx.offerSuggestion.findFirst({
        where: { id, tenant_id: context.tenantId },
      });
      if (!suggestion) throw new NotFoundException('Offer suggestion not found');
      assertBranchAccess(actor, suggestion.branch_id);
      // The tenant predicate is repeated on the write, not just the read: a
      // conditional `updateMany` is the actual mutation, so scoping only the
      // preceding lookup would leave the write itself unguarded.
      const changed = await tx.offerSuggestion.updateMany({
        where: { id, tenant_id: context.tenantId, status: 'pending' },
        data: { status, reviewed_by: actor.sub },
      });
      if (changed.count !== 1) throw new ConflictException('Offer suggestion was already reviewed');
      await tx.auditLog.create({
        data: {
          tenant_id: context.tenantId,
          user_id: actor.sub,
          action: `offer.${status}`,
          entity: 'OfferSuggestion',
          entity_id: id,
          meta: { branch_id: suggestion.branch_id, suggested_price: suggestion.suggested_price },
        },
      });
      return tx.offerSuggestion.findFirst({ where: { id, tenant_id: context.tenantId } });
    });
    // Same row, same fields, same gate as `suggestions()` -- masked outside the
    // transaction so the permission lookup never widens it. The audit row above
    // is written from the pre-mask `suggestion`, so it keeps the true value.
    return reviewed ? this.costVisibility.maskOfferSuggestion(actor, reviewed) : reviewed;
  }
}
