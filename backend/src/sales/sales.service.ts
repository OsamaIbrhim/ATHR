import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { deviceTenantContext } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { PosTerminal, Prisma } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { SalesTaxSnapshotService } from '../tax/sales-tax-snapshot.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { randomUUID } from 'crypto';
import { runSaleTransaction } from './sale-transaction-runner';
import { loadInvoiceView } from './sale-invoice-view';
import { claimTerminalSequence } from './sale-terminal-claim';
import { bookCustomerSale } from './sale-customer';
import { loadSaleVariants } from './sale-variants';
import { resolveSaleActors } from './sale-actors';
import { assertSameSaleContext } from './sale-replay';
import { reconcileLateShiftSale } from './sale-late-shift';
import { money, sameMoney, unitCost } from '../common/money';
import { InventoryService } from '../inventory/inventory.service';
import { stockLots } from './sale-lots';
import { planPayments } from './sale-payments';
import { discountLimitPercent } from './sale-discounts';
import { isDiscountAboveLimit } from '@athr/domain-core';
import { priceSaleCommand } from './sale-command-pricing';
import { effectivePermissions } from '../identity/permission-catalog';
import { readTenantSettings } from '../catalog/tenant-settings';
import { normalizeLines, saleCommandFingerprint } from './sale-command';
import { derivedInvoiceNumber, invoiceNumberCandidates, pickInvoiceNumber } from './invoice-number';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private costVisibility: CostVisibilityService,
    private taxSnapshots: SalesTaxSnapshotService,
    private inventory: InventoryService,
  ) {}

  getInvoice(context: TenantContext, id: string, actor: AuthenticatedUser) {
    return loadInvoiceView(this.prisma, this.costVisibility, context, id, actor);
  }

  /** The checks and the values a sale needs before any statement runs. */
  private prepareSale(dto: CreateSaleDto, terminal: Pick<PosTerminal, 'id' | 'branch_id' | 'tenant_id'>) {
    if (!terminal || terminal.branch_id !== dto.branch_id) {
      throw new ForbiddenException('The terminal is not assigned to the sale branch');
    }

    // WP-007 Phase A: this route is device-authenticated (@Public + PosProtocolGuard),
    // so there is no session for TenantContextGuard to work from. The tenant
    // comes from the enrolled terminal's own tenant_id, backfilled for every
    // existing terminal by WP-005 Phase B, and fails closed if absent. Reading
    // that existing column is not an enrollment change (Phase C, §A.4).
    const context = deviceTenantContext(terminal);

    const receivedAt = new Date();
    const occurredAt = new Date(dto.occurred_at);
    const terminalSequence = BigInt(dto.terminal_sequence);
    if (terminalSequence < 1n || terminalSequence > 9_223_372_036_854_775_807n) {
      throw new BadRequestException('terminal_sequence exceeds PostgreSQL BIGINT range');
    }
    const normalized = normalizeLines(dto.items);
    const commandFingerprint = saleCommandFingerprint(
      dto,
      terminal.id,
      occurredAt,
      normalized,
    );

    return { context, receivedAt, occurredAt, terminalSequence, normalized, commandFingerprint };
  }

  async createSale(dto: CreateSaleDto, terminal: Pick<PosTerminal, 'id' | 'branch_id' | 'tenant_id'>) {
    const prepared = this.prepareSale(dto, terminal);
    const result = await runSaleTransaction(this.prisma, this.logger, dto, terminal, (tx) => this.bookSale(tx, dto, terminal, prepared));
    // Unconditional, unlike `getInvoice`: this response goes to a POS terminal
    // authenticated by device token, so there is no membership to resolve a
    // permission against and no actor the gate could answer for. The till has
    // no use for `unit_cost` either — it echoes back the sale it just posted —
    // so the field is dropped outright rather than gated. Both branches of the
    // transaction are covered: the idempotent replay returns the same shape.
    return { ...result, items: result.items.map(({ unit_cost: _unitCost, ...item }) => item) };
  }

  /**
   * Books a sale inside the caller's transaction (an exchange books its new sale
   * and the return in one). Same result as createSale, without the cost-field
   * projection: the caller decides what leaves the server.
   */
  async bookSaleIn(tx: Prisma.TransactionClient, dto: CreateSaleDto, terminal: Pick<PosTerminal, 'id' | 'branch_id' | 'tenant_id'>) {
    return this.bookSale(tx, dto, terminal, this.prepareSale(dto, terminal));
  }

  private async bookSale(
    tx: Prisma.TransactionClient,
    dto: CreateSaleDto,
    terminal: Pick<PosTerminal, 'id' | 'branch_id' | 'tenant_id'>,
    { context, receivedAt, occurredAt, terminalSequence, normalized, commandFingerprint }: ReturnType<SalesService['prepareSale']>,
  ) {
    const claimed = await claimTerminalSequence(tx, terminal.id, context.tenantId, terminalSequence);
    if (!claimed || claimed.branch_id !== dto.branch_id) {
      throw new ForbiddenException('The terminal is not assigned to the sale branch');
    }

    const printedNumber = dto.invoice_number ?? derivedInvoiceNumber(claimed.terminal_code, terminalSequence);
    // The replay (same sync_id) and the invoices already holding the printed
    // number or one of its suffixed variants are found by one query.
    const matches = await tx.salesInvoice.findMany({
      where: {
        tenant_id: context.tenantId,
        OR: [{ sync_id: dto.sync_id }, { invoice_number: { in: invoiceNumberCandidates(printedNumber) } }],
      },
      include: { items: true, payments: { orderBy: { sequence: 'asc' } } },
    });
    const existing = matches.find((invoice) => invoice.sync_id === dto.sync_id);
    if (existing) {
      assertSameSaleContext(existing, dto, terminal.id, terminalSequence, commandFingerprint);
      return existing;
    }

    if (claimed.branch_code === null) throw new NotFoundException('Branch not found');
    const { originCashier, linkedCashier, linkedSeller, linkedShift, warnings } = await resolveSaleActors(tx, context.tenantId, dto, occurredAt);
    const warningCodes = new Set<string>(warnings);
    // The printed number is stored verbatim; a till that restarted its numbering
    // gets a suffix and a warning, never a refusal.
    const invoiceNumber = pickInvoiceNumber(printedNumber, new Set(matches.map((invoice) => invoice.invoice_number)));
    if (invoiceNumber !== dto.invoice_number) warningCodes.add('INVOICE_NUMBER_REASSIGNED');

    if (terminalSequence > claimed.previous_sequence + 1n) {
      warningCodes.add('SEQUENCE_GAP');
    } else if (terminalSequence <= claimed.previous_sequence) {
      warningCodes.add('OUT_OF_ORDER_SEQUENCE');
    }

    const variantsById = await loadSaleVariants(tx, context.tenantId, normalized.lines);
    // WP-008 Phase B: `calculateMany` now prices per (variant, qty) pair
    // (BR-PSL-104 quantity breaks) -- `normalized.lines` already merges
    // duplicate variant_ids into one line with a summed qty
    // (`normalizeLines`), so this is exactly one line per priced variant.
    const currentQuotes = await this.pricing.calculateMany(
      context,
      normalized.lines.map((line) => ({
        variant: variantsById.get(line.variant_id)!,
        qty: line.qty.toNumber(),
      })),
      tx,
    );

    const saleItems = normalized.lines.map((line) => {
      const quote = currentQuotes.get(line.variant_id)!;
      const unitPrice = money(line.unit_price);
      const unitTax = money(line.unit_tax);
      if (
        !sameMoney(unitPrice, quote.net_price) ||
        !sameMoney(unitTax, quote.tax_amount)
      ) {
        warningCodes.add('PRICE_VARIANCE');
      }
      return {
        variant_id: line.variant_id,
        qty: line.qty,
        unit_price: unitPrice,
        tax: unitTax,
        sku_snapshot: line.sku_snapshot.trim(),
        name_ar_snapshot: line.name_ar_snapshot.trim(),
        name_en_snapshot: line.name_en_snapshot?.trim() || null,
        variant_label_snapshot: line.variant_label_snapshot?.trim() || null,
        lots: stockLots(line.lots),
      };
    });

    // Priced as the till prices it (shared domain-core arithmetic): line and
    // invoice discounts, tax after discount. `server` is the same sale at the
    // server's own quote, used only for the tax snapshot below.
    const { till, server } = priceSaleCommand(dto.items, dto.discount, currentQuotes);
    const subtotal = till.subtotal;
    const taxAmount = till.taxTotal;
    // The till's total is what the customer was charged and what the receipt
    // shows, so it is the stored total. A total that does not match its own
    // lines is accepted and flagged: a finished sale is never refused (spec §0).
    const total = money(dto.local_total);
    if (!sameMoney(total, till.total)) warningCodes.add('LOCAL_TOTAL_MISMATCH');
    const settings = readTenantSettings(claimed.settings);
    const originPermissions = originCashier
      ? effectivePermissions(originCashier.role, originCashier.granted_permissions, originCashier.revoked_permissions)
      : null;
    if (isDiscountAboveLimit(till.lines, discountLimitPercent(originPermissions, settings.sales.max_discount_percent))) {
      warningCodes.add('DISCOUNT_ABOVE_LIMIT');
    }
    const paymentPlan = planPayments(dto.payments, total, settings.sales.payment_methods);
    paymentPlan.warnings.forEach((code) => warningCodes.add(code));

    // Acceptance-first: the sale is recorded even when it drives stock below
    // zero (NEGATIVE_STOCK). Only `stocked` variants move stock; the writer
    // ignores service/non_stock lines, so they are not even sent.
    const invoiceId = randomUUID();
    const itemIds = new Map(saleItems.map((item) => [item.variant_id, randomUUID()]));
    const warehouseId = await this.inventory.defaultWarehouseId(tx, context.tenantId, dto.branch_id);
    const stockAfter = new Map(
      (
        await this.inventory.apply(tx, {
          tenantId: context.tenantId,
          warehouseId,
          occurredAt,
          actorId: linkedCashier?.id,
          type: 'sale',
          reference: { type: 'SalesInvoice', id: invoiceId },
          idempotencyKey: `sale:${dto.sync_id}`,
          allowNegative: true,
          metadata: {
            sync_id: dto.sync_id,
            terminal_id: terminal.id,
            terminal_sequence: dto.terminal_sequence,
          },
          lines: saleItems
            .filter((item) => variantsById.get(item.variant_id).item_type === 'stocked')
            .map((item) => ({
              variantId: item.variant_id,
              qtyDelta: item.qty.negated(),
              referenceLineId: itemIds.get(item.variant_id),
              ...(item.lots ? { lots: item.lots } : {}),
            })),
        })
      ).map((stock) => [stock.variantId, stock]),
    );
    for (const stock of stockAfter.values()) {
      if (stock.qtyAfter.minus(stock.reserved).isNegative()) warningCodes.add('NEGATIVE_STOCK');
      // Missing / unknown serials and unallocated batches: accepted, never refused.
      for (const code of stock.warnings ?? []) warningCodes.add(code);
    }
    // Cost of goods at the moment of sale: the warehouse average; catalog cost for items without stock.
    const costOf = (variantId: string) =>
      unitCost(stockAfter.get(variantId)?.avgCost ?? variantsById.get(variantId).cost_price);

    const bookedCustomer = dto.customer_phone
      ? await bookCustomerSale(tx, context.tenantId, dto.customer_phone, total, paymentPlan.credit)
      : undefined;
    const customerId = bookedCustomer?.customerId;
    const balanceAfter = bookedCustomer?.balanceAfter;
    if (bookedCustomer?.creditLimitExceeded) warningCodes.add('CUSTOMER_CREDIT_LIMIT_EXCEEDED');
    if (paymentPlan.credit.greaterThan(0) && !customerId) warningCodes.add('CREDIT_WITHOUT_CUSTOMER');

    const invoice = await tx.salesInvoice.create({
      data: {
        id: invoiceId,
        tenant_id: context.tenantId,
        invoice_number: invoiceNumber,
        event_version: dto.event_version,
        warning_codes: [...warningCodes].sort(),
        branch_id: dto.branch_id,
        customer_id: customerId,
        cashier_id: linkedCashier?.id || null,
        cashier_name_snapshot: dto.cashier_name_snapshot.trim(),
        seller_id: linkedSeller?.id || null,
        seller_name_snapshot: dto.seller_name_snapshot.trim(),
        received_by: linkedCashier?.id || null,
        terminal_id: terminal.id,
        shift_id: linkedShift?.id || null,
        offline_session_id: dto.offline_session_id,
        terminal_sequence: terminalSequence,
        command_fingerprint: commandFingerprint,
        occurred_at: occurredAt,
        received_at: receivedAt,
        subtotal,
        discount_amount: till.discountTotal,
        tax_amount: taxAmount,
        total,
        language: dto.language || 'ar',
        sync_id: dto.sync_id,
      },
    });
    await tx.salesPayment.createMany({
      data: paymentPlan.rows.map((row) => ({ ...row, tenant_id: context.tenantId, sales_invoice_id: invoice.id })),
    });
    // The ledger entry of the credit part (the balance itself moved with the customer row above).
    if (customerId && balanceAfter && paymentPlan.credit.greaterThan(0)) {
      await tx.customerLedgerEntry.create({
        data: {
          tenant_id: context.tenantId,
          customer_id: customerId,
          type: 'sale_credit',
          amount: paymentPlan.credit,
          balance_after: balanceAfter,
          sales_invoice_id: invoice.id,
          created_by: linkedCashier?.id ?? null,
        },
      });
    }
    const items = await tx.salesInvoiceItem.createManyAndReturn({
      data: saleItems.map((item) => ({
        id: itemIds.get(item.variant_id),
        tenant_id: context.tenantId,
        sales_invoice_id: invoice.id,
        variant_id: item.variant_id,
        qty: item.qty,
        unit_price: item.unit_price,
        unit_cost: costOf(item.variant_id),
        unit_tax: item.tax,
        discount_amount: till.byVariant.get(item.variant_id)!.discount,
        tax_amount: till.byVariant.get(item.variant_id)!.tax,
        sku_snapshot: item.sku_snapshot,
        name_ar_snapshot: item.name_ar_snapshot,
        name_en_snapshot: item.name_en_snapshot,
        variant_label_snapshot: item.variant_label_snapshot,
      })),
    });

    // WP-008 Phase C (BR-TAX-202): stamp the resolved code/rate/base/amount/
    // mode/version onto the document, inside the same transaction that
    // created it. `quote.tax` was resolved once in `calculateMany` above, so
    // the snapshot records the version that priced the sale — re-resolving
    // here could pick up a version activated in between and stamp a rate the
    // line was never quoted at.
    //
    // The base is the per-line total (unit net x qty), not the unit net: it
    // is the amount the recorded `tax_amount` was computed over, and a
    // reader reconciling a document should not have to re-multiply.
    //
    // **Both `base_amount` and `tax_amount` come from the SERVER-resolved
    // quote, never from the till's submitted `unit_tax`.** The two can
    // legitimately differ — a till running a stale catalog submits the old
    // rate, which is recorded on `SalesInvoiceItem.unit_tax` (what was
    // actually charged) and flagged with `PRICE_VARIANCE` above. Mixing the
    // two sources here would produce a snapshot where
    // `base_amount x rate_snapshot != tax_amount`, i.e. evidence that
    // contradicts its own arithmetic — which defeats BR-CAT-105
    // ("كل حساب مالي قابل للتفسير") in the one table that exists to be
    // auditable. The snapshot answers "what did the tax rules say"; the
    // invoice line answers "what did the till collect"; the warning code
    // records that they disagreed.
    await this.taxSnapshots.record(
      context,
      tx,
      invoice.id,
      saleItems.map((item) => {
        const quote = currentQuotes.get(item.variant_id)!;
        const priced = server.byVariant.get(item.variant_id)!;
        return {
          salesInvoiceItemId: itemIds.get(item.variant_id)!,
          tax: { ...quote.tax, base_amount: priced.net, tax_amount: priced.tax },
        };
      }),
    );

    await tx.auditLog.create({
      data: {
        tenant_id: context.tenantId,
        user_id: linkedCashier?.id || null,
        action: warningCodes.size
          ? 'sale.accepted_with_warning'
          : 'sale.accepted',
        entity: 'SalesInvoice',
        entity_id: invoice.id,
        meta: {
          sync_id: dto.sync_id,
          event_version: dto.event_version,
          local_total: dto.local_total,
          invoice_total: total,
          warning_codes: [...warningCodes].sort(),
          origin_cashier_id: dto.origin_cashier_id,
          seller_id: dto.seller_id,
          terminal_id: terminal.id,
          terminal_sequence: dto.terminal_sequence,
          command_fingerprint: commandFingerprint,
          shift_id: dto.shift_id,
          offline_session_id: dto.offline_session_id,
          occurred_at: dto.occurred_at,
          received_at: receivedAt.toISOString(),
        },
      },
    });

    await reconcileLateShiftSale(tx, linkedShift, {
      tenantId: context.tenantId,
      actorId: linkedCashier?.id || null,
      invoiceId: invoice.id,
      syncId: dto.sync_id,
      terminalSequence: dto.terminal_sequence,
      cash: paymentPlan.cash,
    });

    return { ...invoice, items, payments: paymentPlan.rows };
  }
}
