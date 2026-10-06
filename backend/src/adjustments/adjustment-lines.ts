import { Prisma } from '@prisma/client';
import { domainError, UNPROCESSABLE } from '../common/domain-error';
import { quantity } from '../common/quantity';
import { refuseVariant, type StockVariant } from '../inventory/inventory-variants';
import { ADJUSTMENT_REASON_CODES } from './adjustment-reasons';
import type { AdjustmentLineDto } from './dto/adjustment.dto';

export type ValidLine = {
  variant_id: string;
  qty_delta: Prisma.Decimal;
  reason_code: string;
  note: string | null;
};

const lineError = (index: number, variantId: string, code: string, message: string, message_ar: string) =>
  domainError(UNPROCESSABLE, code, message, message_ar, { line_index: index, variant_id: variantId });

/**
 * Checks the lines of a draft against the variants they name and returns them
 * normalised. Each item may appear once (the screen merges scans into one
 * line); `other` needs a note; tracked and non-stocked items are refused.
 * Throws the first problem as a domain error that says which line it is.
 */
export function validateAdjustmentLines(lines: AdjustmentLineDto[], variants: Map<string, StockVariant>): ValidLine[] {
  const seen = new Set<string>();
  return lines.map((line, index) => {
    if (seen.has(line.variant_id)) {
      throw lineError(index, line.variant_id, 'DUPLICATE_LINE', 'The same item appears in two lines', 'الصنف مكرر في أكثر من سطر.');
    }
    seen.add(line.variant_id);
    const qty = quantity(line.qty_delta);
    const refusal = refuseVariant(variants.get(line.variant_id), qty);
    if (refusal) throw lineError(index, line.variant_id, refusal.code, refusal.message, refusal.message_ar);
    if (!ADJUSTMENT_REASON_CODES.includes(line.reason_code)) {
      throw lineError(index, line.variant_id, 'ADJUSTMENT_REASON_INVALID', 'Unknown adjustment reason', 'سبب التسوية غير معروف.');
    }
    const note = line.note?.trim() || null;
    if (line.reason_code === 'other' && !note) {
      throw lineError(index, line.variant_id, 'ADJUSTMENT_NOTE_REQUIRED', 'A note is required when the reason is "other"', 'اكتب ملاحظة عندما يكون السبب "أخرى".');
    }
    return { variant_id: line.variant_id, qty_delta: qty, reason_code: line.reason_code, note };
  });
}
