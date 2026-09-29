import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { deviceTenantContext } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { PosTerminal, Prisma } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { SalesTaxSnapshotService } from '../tax/sales-tax-snapshot.service';
import { CreateSaleDto, CreateSaleItemDto } from './dto/create-sale.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { createHash, randomUUID } from 'crypto';
import { assertBranchAccess, canAccessAllBranches, hasBranchAccess, toScopeSet } from '../auth/branch-access';
import { CreateReturnDto } from './dto/create-return.dto';
import { ListReturnsDto } from './dto/list-returns.dto';
import {
  getErrorMessage,
  getPrismaErrorCode,
  getSaleTransactionOptions,
  isExpiredSaleTransactionError,
} from './sale-transaction';
import {
  decimal,
  lineMoney,
  money,
  moneyNumber,
  moneyString,
  sameMoney,
  sumMoney,
  unitCost,
} from '../common/money';
import {
  assertQuantityPrecision,
  quantity,
  quantityNumber,
  variantQuantityPrecision,
} from '../common/quantity';
import { InventoryService } from '../inventory/inventory.service';

/** A sale line after merging duplicate variants; the quantity is exact (Decimal(14,3)). */
type SaleLine = Omit<CreateSaleItemDto, 'qty'> & { qty: Prisma.Decimal };

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

  async getInvoice(context: TenantContext, id: string, actor: AuthenticatedUser) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, tenant_id: context.tenantId },
      include: {
        items: { include: { variant: { include: { product: true } }, return_items: { where: { return_record: { status: 'completed' } } } } },
        branch: true, customer: true,
        cashier: { select: { id: true, name: true } },
        seller: { select: { id: true, name: true } },
        receiver: { select: { id: true, name: true } },
        shift: true,
        terminal: { select: { id: true, terminal_code: true, name: true } },
        original_returns: { include: { items: true }, orderBy: { created_at: 'desc' } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    assertBranchAccess(actor, invoice.branch_id);
    // BR-CST-101 / Matrix §17 §51: this row discloses exact cost four ways —
    // `items[].unit_cost` (cost at the moment of sale), the joined
    // `items[].variant.cost_price` (cost today), and the same sale-line cost
    // carried onto the return through *either* join, `items[].return_items[]`
    // and `original_returns[].items[]`. Both return joins matter: they reach
    // the same `ReturnItem` rows from opposite ends, so masking one leaves the
    // figure reachable through the other. `cashier` clears this endpoint on
    // `sales.sale.view` and does not hold `sales.sale.view-cost-margin`, so
    // all four are stripped for the till. Only the response is projected; the
    // stored rows keep the true values, and the margin reports that need them
    // read those rows directly behind their own `reports.*.view-cost-margin`
    // guard.
    if (await this.costVisibility.canViewSaleCostMargin(actor)) return invoice;
    const withoutLineCost = <T extends { unit_cost?: unknown }>({ unit_cost: _unitCost, ...line }: T) =>
      line;
    return {
      ...invoice,
      items: invoice.items.map(({ unit_cost: _unitCost, variant, return_items, ...item }) => {
        const { cost_price: _costPrice, ...visibleVariant } = variant;
        return { ...item, variant: visibleVariant, return_items: return_items.map(withoutLineCost) };
      }),
      original_returns: invoice.original_returns.map((record) => ({
        ...record,
        items: record.items.map(withoutLineCost),
      })),
    };
  }

  private saleCommandFingerprint(
    dto: CreateSaleDto,
    terminalId: string,
    occurredAt: Date,
    normalized: ReturnType<SalesService['normalizeLines']>,
  ) {
    const canonicalMoney = (value: number) => moneyString(value);
    const payload = {
      v: dto.event_version,
      branch_id: dto.branch_id,
      terminal_id: terminalId,
      shift_id: dto.shift_id,
      origin_cashier_id: dto.origin_cashier_id,
      cashier_name_snapshot: dto.cashier_name_snapshot.trim(),
      seller_id: dto.seller_id,
      seller_name_snapshot: dto.seller_name_snapshot.trim(),
      offline_session_id: dto.offline_session_id,
      terminal_sequence: dto.terminal_sequence,
      occurred_at: occurredAt.toISOString(),
      customer_phone: dto.customer_phone || null,
      payment_method: dto.payment_method,
      language: dto.language || 'ar',
      local_total: canonicalMoney(dto.local_total),
      items: normalized.lines
        .map((item) => ({
          variant_id: item.variant_id,
          qty: quantityNumber(item.qty),
          unit_price: canonicalMoney(item.unit_price),
          unit_tax: canonicalMoney(item.unit_tax),
          sku_snapshot: item.sku_snapshot.trim(),
          name_ar_snapshot: item.name_ar_snapshot.trim(),
          name_en_snapshot: item.name_en_snapshot?.trim() || null,
          variant_label_snapshot: item.variant_label_snapshot?.trim() || null,
        }))
        .sort((left, right) => left.variant_id.localeCompare(right.variant_id)),
    };
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private normalizeLines(items: CreateSaleItemDto[]) {
    const lines = new Map<string, SaleLine>();
    for (const item of items) {
      const existing = lines.get(item.variant_id);
      if (!existing) lines.set(item.variant_id, { ...item, qty: quantity(item.qty) });
      else {
        if (
          !sameMoney(existing.unit_price, item.unit_price) ||
          !sameMoney(existing.unit_tax, item.unit_tax) ||
          existing.sku_snapshot.trim() !== item.sku_snapshot.trim() ||
          existing.name_ar_snapshot.trim() !== item.name_ar_snapshot.trim() ||
          (existing.name_en_snapshot?.trim() || '') !== (item.name_en_snapshot?.trim() || '') ||
          (existing.variant_label_snapshot?.trim() || '') !== (item.variant_label_snapshot?.trim() || '')
        ) {
          throw new UnprocessableEntityException({
            code: 'CONFLICTING_ITEM_SNAPSHOTS',
            message_ar: 'الصنف نفسه يحمل بيانات تاريخية مختلفة داخل الفاتورة.',
            message: 'The same variant has conflicting historical snapshots',
          });
        }
        existing.qty = existing.qty.plus(quantity(item.qty));
      }
    }
    return { lines: [...lines.values()] };
  }

  private async runSaleTransaction<T>(
    dto: CreateSaleDto,
    terminal: Pick<PosTerminal, 'id'>,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const options = getSaleTransactionOptions();
    const startedAt = Date.now();

    try {
      return await this.prisma.$transaction(operation, options);
    } catch (error: unknown) {
      const prismaCode = getPrismaErrorCode(error);
      const expired = isExpiredSaleTransactionError(error);

      if (expired || prismaCode) {
        this.logger.error(
          JSON.stringify({
            level: 'error',
            errorCode: expired
              ? 'SALE_TRANSACTION_EXPIRED'
              : 'SALE_DATABASE_OPERATION_FAILED',
            component: 'database',
            status: 'rolled_back',
            operation: 'create_sale',
            syncId: dto.sync_id,
            branchId: dto.branch_id,
            terminalId: terminal.id,
            terminalSequence: dto.terminal_sequence,
            itemCount: dto.items.length,
            prismaCode,
            elapsedMs: Date.now() - startedAt,
            maxWaitMs: options.maxWait,
            timeoutMs: options.timeout,
            message: expired
              ? 'The sale transaction expired before completion and was rolled back.'
              : 'The sale transaction failed during a database operation and was rolled back.',
            originalMessage: getErrorMessage(error),
          }),
          error instanceof Error ? error.stack : undefined,
        );
      }

      if (expired) {
        throw new ServiceUnavailableException({
          code: 'SALE_TRANSACTION_EXPIRED',
          retryable: true,
          retry_after_ms: 2_000,
          message_ar:
            'تعذر إتمام عملية البيع داخل مهلة قاعدة البيانات. أعد المحاولة بنفس رقم المزامنة.',
          message:
            'The sale transaction exceeded the database timeout and was rolled back. Retry using the same sync_id.',
        });
      }

      throw error;
    }
  }

  async createSale(
    dto: CreateSaleDto,
    terminal: Pick<PosTerminal, 'id' | 'branch_id' | 'tenant_id'>,
  ) {
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
    const normalized = this.normalizeLines(dto.items);
    const commandFingerprint = this.saleCommandFingerprint(
      dto,
      terminal.id,
      occurredAt,
      normalized,
    );

    const result = await this.runSaleTransaction(dto, terminal, async (tx) => {
      // One statement locks the terminal row, advances its sale sequence and
      // reads the branch code. Advancing up front is safe: it is monotonic
      // (a replay or an older sequence changes nothing) and a failed sale
      // rolls the whole transaction back. The CTE reads the row after the lock
      // is granted, so `previous_sequence` is what the last committed sale left.
      const [claimed] = await tx.$queryRaw<Array<{
        branch_id: string;
        branch_code: string | null;
        previous_sequence: bigint;
      }>>`
        WITH locked AS (
          SELECT "id", "last_sale_sequence" FROM "PosTerminal"
          WHERE "id" = ${terminal.id}::uuid AND "tenant_id" = ${context.tenantId}::uuid
          FOR UPDATE
        )
        UPDATE "PosTerminal" t
        SET "last_sale_sequence" = GREATEST(t."last_sale_sequence", ${terminalSequence}), "updated_at" = now()
        FROM locked
        WHERE t."id" = locked."id"
        RETURNING t."branch_id",
          (SELECT b."code" FROM "Branch" b WHERE b."id" = t."branch_id" AND b."tenant_id" = t."tenant_id") AS "branch_code",
          locked."last_sale_sequence" AS "previous_sequence"
      `;
      if (!claimed || claimed.branch_id !== dto.branch_id) {
        throw new ForbiddenException('The terminal is not assigned to the sale branch');
      }

      // The replay (same sync_id) and the terminal-sequence owner (same
      // terminal + sequence, different sync_id) are found by one query.
      const matches = await tx.salesInvoice.findMany({
        where: {
          tenant_id: context.tenantId,
          OR: [
            { sync_id: dto.sync_id },
            { terminal_id: terminal.id, terminal_sequence: terminalSequence },
          ],
        },
        include: { items: true },
      });
      const existing = matches.find((invoice) => invoice.sync_id === dto.sync_id);
      const sequenceOwner = matches.find((invoice) => invoice.sync_id !== dto.sync_id);
      if (existing) {
        if (
          existing.branch_id !== dto.branch_id ||
          existing.terminal_id !== terminal.id ||
          existing.offline_session_id !== dto.offline_session_id ||
          existing.terminal_sequence !== terminalSequence ||
          existing.command_fingerprint !== commandFingerprint
        ) {
          throw new ConflictException({
            code: 'SALE_IDEMPOTENCY_CONTEXT_CONFLICT',
            message_ar: 'رقم المزامنة مستخدم لعملية مختلفة في الهوية أو الوردية أو الجهاز.',
            message: 'sync_id already belongs to a different accounting context',
          });
        }
        return existing;
      }

      const warningCodes = new Set<string>();
      const [shift, staff] = await Promise.all([
        tx.shift.findFirst({ where: { id: dto.shift_id, tenant_id: context.tenantId } }),
        // Staff are resolved through their Membership — `User` has no tenant data.
        tx.membership.findMany({
          where: {
            tenant_id: context.tenantId,
            user_id: { in: [dto.origin_cashier_id, dto.seller_id] },
          },
          select: { user_id: true, role: true, access_scope_assignments: true },
        }),
      ]);
      if (claimed.branch_code === null) throw new NotFoundException('Branch not found');
      const originCashier = staff.find((m) => m.user_id === dto.origin_cashier_id);
      const seller = staff.find((m) => m.user_id === dto.seller_id);
      const worksInBranch = (m: typeof originCashier) =>
        !!m && hasBranchAccess({ scope_set: toScopeSet(m.access_scope_assignments) }, dto.branch_id);
      const linkedCashier = originCashier && worksInBranch(originCashier) ? { id: originCashier.user_id } : null;
      if (!linkedCashier) {
        warningCodes.add('CASHIER_REFERENCE_MISSING');
      }
      const linkedSeller =
        seller && seller.role === 'seller' && worksInBranch(seller) ? { id: seller.user_id } : null;
      if (!linkedSeller) {
        warningCodes.add('SELLER_REFERENCE_MISSING');
      }
      const linkedShift = shift?.branch_id === dto.branch_id ? shift : null;
      if (!linkedShift) {
        warningCodes.add('SHIFT_REFERENCE_MISSING');
      } else if (
        linkedShift.status === 'closed' ||
        occurredAt < linkedShift.opened_at ||
        (linkedShift.closed_at && occurredAt > linkedShift.closed_at)
      ) {
        warningCodes.add('LATE_SYNC');
      }
      if (sequenceOwner) {
        throw new ConflictException({
          code: 'TERMINAL_SEQUENCE_CONFLICT',
          message_ar: 'رقم ترتيب العملية مستخدم بالفعل لعملية أخرى على هذا الجهاز.',
          message: 'Terminal sequence already belongs to another sale',
        });
      }

      if (terminalSequence > claimed.previous_sequence + 1n) {
        warningCodes.add('SEQUENCE_GAP');
      } else if (terminalSequence <= claimed.previous_sequence) {
        warningCodes.add('OUT_OF_ORDER_SEQUENCE');
      }

      const variantIds = normalized.lines.map((item) => item.variant_id);
      const variants = await tx.productVariant.findMany({
        where: {
          id: { in: variantIds },
          tenant_id: context.tenantId,
          product: { tenant_id: context.tenantId },
        },
        include: { product: true, base_uom: { select: { precision: true } } },
      });
      if (variants.length !== variantIds.length) {
        const found = new Set(variants.map((variant) => variant.id));
        const missing = variantIds.find((id) => !found.has(id));
        throw new NotFoundException(`Variant not found: ${missing}`);
      }
      const variantsById = new Map<string, any>(
        variants.map((variant: any) => [variant.id, variant]),
      );
      for (const line of normalized.lines) {
        const variant = variantsById.get(line.variant_id)!;
        assertQuantityPrecision(line.qty, variantQuantityPrecision(variant), line.sku_snapshot);
      }
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
        };
      });

      const subtotal = sumMoney(
        saleItems.map((item) => lineMoney(item.unit_price, item.qty)),
      );
      const taxAmount = sumMoney(
        saleItems.map((item) => lineMoney(item.tax, item.qty)),
      );
      const total = money(subtotal.plus(taxAmount));

      if (
        !sameMoney(dto.local_total, total)
      ) {
        throw new UnprocessableEntityException({
          code: 'LOCAL_TOTAL_MISMATCH',
          message_ar: 'إجمالي الفاتورة لا يطابق مجموع سطورها المحفوظة محليًا.',
          message: 'The local invoice total does not match its immutable lines',
          local_total: dto.local_total,
          calculated_total: moneyNumber(total),
        });
      }

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
              })),
          })
        ).map((stock) => [stock.variantId, stock]),
      );
      for (const stock of stockAfter.values()) {
        if (stock.qtyAfter.minus(stock.reserved).isNegative()) warningCodes.add('NEGATIVE_STOCK');
      }
      // Cost of goods at the moment of sale: the warehouse average; catalog cost for items without stock.
      const costOf = (variantId: string) =>
        unitCost(stockAfter.get(variantId)?.avgCost ?? variantsById.get(variantId).cost_price);

      // Find-or-create the customer and book this sale on it in one statement.
      // The (tenant_id, phone) unique key makes concurrent first sales safe.
      let customerId: string | undefined;
      if (dto.customer_phone) {
        const [customer] = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "Customer" ("id", "tenant_id", "phone", "whatsapp", "total_invoices", "total_spent")
          VALUES (${randomUUID()}::uuid, ${context.tenantId}::uuid, ${dto.customer_phone}, ${dto.customer_phone}, 1, ${total})
          ON CONFLICT ("tenant_id", "phone") DO UPDATE SET
            "total_invoices" = "Customer"."total_invoices" + 1,
            "total_spent" = "Customer"."total_spent" + EXCLUDED."total_spent"
          RETURNING "id"
        `;
        customerId = customer.id;
      }

      const invoiceNumber =
        `B-${claimed.branch_code}-${receivedAt.getTime()}-${randomUUID().slice(0, 8)}`;
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
          tax_amount: taxAmount,
          total,
          payment_method: dto.payment_method,
          language: dto.language || 'ar',
          sync_id: dto.sync_id,
        },
      });
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
          return {
            salesInvoiceItemId: itemIds.get(item.variant_id)!,
            tax: {
              ...quote.tax,
              base_amount: lineMoney(quote.tax.base_amount, item.qty),
              tax_amount: lineMoney(quote.tax.tax_amount, item.qty),
            },
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

      // A sale may legitimately arrive after its shift was closed because the
      // till was offline. Keep the immutable close count, but reconcile the
      // stored expected cash and variance so the closed shift remains
      // financially correct instead of silently omitting the late command.
      if (
        linkedShift?.status === 'closed' &&
        dto.payment_method === 'cash' &&
        linkedShift.expected_cash !== null &&
        linkedShift.difference !== null
      ) {
        // Atomic Decimal updates prevent two late tills from overwriting each
        // other's shift reconciliation when they reconnect concurrently.
        await tx.shift.update({
          where: { id: linkedShift.id },
          data: {
            expected_cash: { increment: total },
            difference: { decrement: total },
          },
        });
        await tx.auditLog.create({
          data: {
            tenant_id: context.tenantId,
            user_id: linkedCashier?.id || null,
            action: 'shift.late_offline_sale.reconciled',
            entity: 'Shift',
            entity_id: linkedShift.id,
            meta: {
              invoice_id: invoice.id,
              sync_id: dto.sync_id,
              terminal_sequence: dto.terminal_sequence,
              expected_cash_increment: total,
              difference_decrement: total,
            },
          },
        });
      }

      return { ...invoice, items };
    });
    // Unconditional, unlike `getInvoice`: this response goes to a POS terminal
    // authenticated by device token, so there is no membership to resolve a
    // permission against and no actor the gate could answer for. The till has
    // no use for `unit_cost` either — it echoes back the sale it just posted —
    // so the field is dropped outright rather than gated. Both branches of the
    // transaction are covered: the idempotent replay returns the same shape.
    return { ...result, items: result.items.map(({ unit_cost: _unitCost, ...item }) => item) };
  }

  async createReturn(context: TenantContext, dto: CreateReturnDto, actor: AuthenticatedUser) {
    const requested = new Map<string, Prisma.Decimal>();
    for (const item of dto.items) {
      requested.set(
        item.sales_invoice_item_id,
        (requested.get(item.sales_invoice_item_id) ?? new Prisma.Decimal(0)).plus(quantity(item.qty)),
      );
    }
    const saleItemIds = [...requested.keys()].sort();

    const result = await this.prisma.$transaction(async (tx) => {
      const original = await tx.salesInvoice.findFirst({
        where: { tenant_id: context.tenantId, id: dto.original_invoice_id },
        include: {
          items: {
            include: { variant: { select: { item_type: true, base_uom: { select: { precision: true } } } } },
          },
        },
      });
      if (!original) throw new NotFoundException('Original invoice not found');
      if (!hasBranchAccess(actor, original.branch_id)) {
        throw new ForbiddenException('You cannot return a sale from another branch');
      }

      let shiftId: string | null = null;
      // A tenant-wide actor (owner) may return without a till shift.
      if (!canAccessAllBranches(actor)) {
        const currentShift = await tx.shift.findFirst({
          where: {
            tenant_id: context.tenantId, branch_id: original.branch_id, status: 'open' },
          select: { id: true },
        });
        if (!currentShift) {
          throw new ConflictException('An open shift is required to record a POS return');
        }
        shiftId = currentShift.id;
      }

      const saleOccurredAt = original.occurred_at || original.created_at;
      const ageDays = (Date.now() - saleOccurredAt.getTime()) / 86_400_000;
      if (ageDays > 14) {
        throw new BadRequestException('Return window expired (14 days)');
      }

      const soldById = new Map(original.items.map((item) => [item.id, item]));
      for (const saleItemId of saleItemIds) {
        if (!soldById.has(saleItemId)) {
          throw new BadRequestException(
            `Item ${saleItemId} does not belong to the original invoice`,
          );
        }
      }
      // Two statements for every line: lock the sold lines, then read what was already returned.
      await tx.$queryRaw`
        SELECT "id"
        FROM "SalesInvoiceItem"
        WHERE "tenant_id" = ${context.tenantId}::uuid AND "id" = ANY(${saleItemIds}::uuid[])
        ORDER BY "id"
        FOR UPDATE
      `;
      const returnedRows = await tx.returnItem.groupBy({
        by: ['sales_invoice_item_id'],
        where: {
          tenant_id: context.tenantId,
          sales_invoice_item_id: { in: saleItemIds },
          return_record: { status: 'completed' },
        },
        _sum: { qty: true },
      });
      const returnedBefore = new Map(
        returnedRows.map((row) => [row.sales_invoice_item_id, row._sum.qty ?? new Prisma.Decimal(0)]),
      );

      const returnItems: {
        sales_invoice_item_id: string;
        variant_id: string;
        qty: Prisma.Decimal;
        unit_price: Prisma.Decimal;
        unit_cost: Prisma.Decimal;
        unit_tax: Prisma.Decimal;
      }[] = [];

      for (const [saleItemId, qty] of requested) {
        const soldItem = soldById.get(saleItemId)!;
        assertQuantityPrecision(qty, variantQuantityPrecision(soldItem.variant), saleItemId);
        const remaining = soldItem.qty.minus(returnedBefore.get(saleItemId) ?? 0);
        if (qty.gt(remaining)) {
          throw new ConflictException(
            `Only ${quantityNumber(remaining)} unit(s) remain returnable for item ${saleItemId}`,
          );
        }

        let unitTax = money(soldItem.unit_tax);
        if (unitTax.isZero() && decimal(original.subtotal).gt(0)) {
          unitTax = money(
            decimal(soldItem.unit_price)
              .mul(original.tax_amount)
              .div(original.subtotal),
          );
        }

        returnItems.push({
          sales_invoice_item_id: saleItemId,
          variant_id: soldItem.variant_id,
          qty,
          unit_price: money(soldItem.unit_price),
          unit_cost: unitCost(soldItem.unit_cost),
          unit_tax: unitTax,
        });
      }

      const refundSubtotal = sumMoney(
        returnItems.map((item) => lineMoney(item.unit_price, item.qty)),
      );
      const refundTax = sumMoney(
        returnItems.map((item) => lineMoney(item.unit_tax, item.qty)),
      );
      const refundTotal = money(refundSubtotal.plus(refundTax));
      const sumQty = (values: Prisma.Decimal[]) =>
        values.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
      const totalReturnedQty = sumQty(returnItems.map((item) => item.qty));
      const originalQty = sumQty(original.items.map((item) => item.qty));

      const returnRecord = await tx.return.create({
        data: {
          tenant_id: context.tenantId,
          original_invoice_id: original.id,
          branch_id: original.branch_id,
          shift_id: shiftId,
          return_invoice_number: `R-${Date.now()}-${randomUUID().slice(0, 8)}`,
          reason: dto.reason,
          is_partial: totalReturnedQty.lt(originalQty),
          created_by: actor.sub,
          refund_subtotal: refundSubtotal,
          refund_tax: refundTax,
          refund_total: refundTotal,
          status: 'completed',
          items: { create: returnItems },
        },
        include: { items: true },
      });

      // Goods come back at the cost they were sold at (moving average), one
      // line per variant.
      const stockLines = new Map<string, { qty: Prisma.Decimal; value: Prisma.Decimal; lineId: string }>();
      for (const item of returnRecord.items) {
        if (soldById.get(item.sales_invoice_item_id)!.variant.item_type !== 'stocked') continue;
        const line = stockLines.get(item.variant_id) ?? { qty: new Prisma.Decimal(0), value: new Prisma.Decimal(0), lineId: item.id };
        line.qty = line.qty.plus(item.qty);
        line.value = line.value.plus(item.unit_cost.mul(item.qty));
        stockLines.set(item.variant_id, line);
      }
      await this.inventory.apply(tx, {
        tenantId: context.tenantId,
        warehouseId: await this.inventory.defaultWarehouseId(tx, context.tenantId, original.branch_id),
        occurredAt: returnRecord.created_at,
        actorId: actor.sub,
        type: 'return',
        costType: 'customer_return',
        reference: { type: 'Return', id: returnRecord.id },
        idempotencyKey: `return:${returnRecord.id}`,
        allowNegative: true,
        metadata: {
          return_invoice_number: returnRecord.return_invoice_number,
          original_invoice_id: original.id,
        },
        lines: [...stockLines].map(([variantId, line]) => ({
          variantId,
          qtyDelta: line.qty,
          referenceLineId: line.lineId,
          unitCost: unitCost(line.value.div(line.qty)),
          value: line.value,
        })),
      });

      // A variant returned three or more times is flagged for QA.
      const returnedUnits = new Map<string, number>();
      for (const item of returnItems) {
        returnedUnits.set(
          item.variant_id,
          (returnedUnits.get(item.variant_id) ?? 0) + Math.ceil(item.qty.toNumber()),
        );
      }
      await tx.$executeRaw`
        UPDATE "ProductVariant" v
        SET "return_count" = v."return_count" + u."units",
            "qa_flag" = v."qa_flag" OR v."return_count" + u."units" >= 3
        FROM unnest(${[...returnedUnits.keys()]}::uuid[], ${[...returnedUnits.values()]}::int[]) AS u("variant_id", "units")
        WHERE v."tenant_id" = ${context.tenantId}::uuid AND v."id" = u."variant_id"
      `;

      if (original.customer_id) {
        const customer = await tx.customer.findFirst({
          where: { tenant_id: context.tenantId, id: original.customer_id },
        });
        if (customer) {
          await tx.customer.update({
            where: { id: customer.id },
            data: {
              total_spent: Prisma.Decimal.max(
                new Prisma.Decimal(0),
                new Prisma.Decimal(customer.total_spent).minus(refundTotal),
              ),
            },
          });
        }
      }

      return returnRecord;
    }, {
      maxWait: 5_000,
      timeout: 20_000,
    });

    // `ReturnItem.unit_cost` is copied from the sale line it reverses, so the
    // return response is the same disclosure under a different table. Gated,
    // not unconditional: unlike `POST /pos/sale` this endpoint authenticates an
    // actor, so a `location_manager` posting a return still sees the figure.
    if (await this.costVisibility.canViewSaleCostMargin(actor)) return result;
    return { ...result, items: result.items.map(({ unit_cost: _unitCost, ...item }) => item) };
  }

  async findReturnableInvoice(context: TenantContext, reference: string, actor: AuthenticatedUser) {
    const byId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        reference,
      );
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: {
        tenant_id: context.tenantId,
        ...(byId ? { id: reference } : { invoice_number: reference }),
      },
      select: {
        id: true,
        invoice_number: true,
        branch_id: true,
        total: true,
        occurred_at: true,
        created_at: true,
        items: {
          select: {
            id: true,
            variant_id: true,
            qty: true,
            unit_price: true,
            unit_tax: true,
            variant: {
              select: {
                sku: true,
                product: { select: { name_en: true, name_ar: true } },
              },
            },
            return_items: {
              where: { return_record: { status: 'completed' } },
              select: { qty: true },
            },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    assertBranchAccess(actor, invoice.branch_id);
    return {
      ...invoice,
      items: invoice.items.map((item) => {
        const returnedQty = item.return_items.reduce(
          (sum, record) => sum.plus(record.qty),
          new Prisma.Decimal(0),
        );
        const { return_items: _returnItems, ...safe } = item;
        return {
          ...safe,
          returned_qty: quantityNumber(returnedQty),
          returnable_qty: quantityNumber(item.qty.minus(returnedQty)),
        };
      }),
    };
  }

  async listReturns(context: TenantContext, dto: ListReturnsDto, branchId?: string) {
    const q = dto.q.trim();
    const where: Prisma.ReturnWhereInput = {
      tenant_id: context.tenantId,
      ...(branchId ? { branch_id: branchId } : {}),
      ...(q
        ? {
            OR: [
              {
                return_invoice_number: {
                  contains: q,
                  mode: 'insensitive',
                },
              },
              {
                original_invoice: {
                  invoice_number: {
                    contains: q,
                    mode: 'insensitive',
                  },
                },
              },
              {
                original_invoice: {
                  customer: { phone: { contains: q } },
                },
              },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.return.count({ where }),
      this.prisma.return.findMany({
        where,
        select: {
          id: true,
          return_invoice_number: true,
          original_invoice_id: true,
          branch_id: true,
          reason: true,
          is_partial: true,
          created_by: true,
          refund_subtotal: true,
          refund_tax: true,
          refund_total: true,
          status: true,
          created_at: true,
          _count: { select: { items: true } },
          original_invoice: {
            select: {
              id: true,
              invoice_number: true,
              total: true,
              payment_method: true,
              customer: {
                select: { id: true, name: true, phone: true },
              },
              terminal: {
                select: { id: true, terminal_code: true, name: true },
              },
            },
          },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (dto.page - 1) * dto.page_size,
        take: dto.page_size,
      }),
    ]);

    return {
      items,
      total,
      page: dto.page,
      page_size: dto.page_size,
      total_pages: Math.max(1, Math.ceil(total / dto.page_size)),
      server_time: new Date().toISOString(),
    };
  }

}
