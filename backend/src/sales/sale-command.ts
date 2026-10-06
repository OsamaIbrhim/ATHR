import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { moneyString, sameMoney } from '../common/money';
import { quantity, quantityNumber } from '../common/quantity';
import type { CreateSaleDto, CreateSaleItemDto } from './dto/create-sale.dto';
import { discountFingerprint, type SaleDiscount } from './sale-discounts';
import { addLots, lotsFingerprint, lotsOfItem, type SaleLots } from './sale-lots';
import { paymentsFingerprint } from './sale-payments';

/** A sale line after merging duplicate variants; the quantity is exact (Decimal(14,3)). */
export type SaleLine = Omit<CreateSaleItemDto, 'qty' | 'serials' | 'batch_no' | 'discount'> & {
  qty: Prisma.Decimal;
  lots: SaleLots;
  /** The discounts of the duplicate lines merged into this one (each priced on its own line). */
  discounts: SaleDiscount[];
};

export type NormalizedLines = { lines: SaleLine[] };

/** The hash of everything financial in a sale command: a replay must match it, another content under the same sync_id is a conflict. */
export function saleCommandFingerprint(
  dto: CreateSaleDto,
  terminalId: string,
  occurredAt: Date,
  normalized: NormalizedLines,
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
    invoice_number: dto.invoice_number ?? null,
    occurred_at: occurredAt.toISOString(),
    customer_phone: dto.customer_phone || null,
    payments: paymentsFingerprint(dto.payments),
    ...(dto.discount ? { invoice_discount: discountFingerprint(dto.discount) } : {}),
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
        // Only when named: a POS without tracking keeps its exact fingerprint.
        ...lotsFingerprint(item.lots),
        ...(item.discounts.length
          ? { discounts: item.discounts.map((discount) => discountFingerprint(discount)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }
          : {}),
      }))
      .sort((left, right) => left.variant_id.localeCompare(right.variant_id)),
  };
  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

/** Merges the lines of one variant (quantities and lots add up; conflicting historical snapshots are refused). */
export function normalizeLines(items: CreateSaleItemDto[]) {
  const lines = new Map<string, SaleLine>();
  for (const { serials, batch_no, discount, ...item } of items) {
    const existing = lines.get(item.variant_id);
    const lots = lotsOfItem({ serials, batch_no }, quantity(item.qty));
    const discounts = discount ? [discount] : [];
    if (!existing) lines.set(item.variant_id, { ...item, qty: quantity(item.qty), lots, discounts });
    else {
      existing.discounts.push(...discounts);
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
      addLots(existing.lots, lots);
    }
  }
  return { lines: [...lines.values()] };
}
