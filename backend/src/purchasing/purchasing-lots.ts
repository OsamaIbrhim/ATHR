import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { quantityNumber } from '../common/quantity'
import type { StockLots } from '../inventory/inventory.types'

/**
 * The serials / batches a purchase or supplier-return line names. These are
 * online admin documents, so unlike a sale they are strict: the engine refuses
 * a tracked line whose lots are missing or do not add up.
 */
export type ItemLots = {
  serials: string[]
  batches: Array<{ batchNo: string; expiryDate?: string; qty: Prisma.Decimal }>
}

export const emptyLots = (): ItemLots => ({ serials: [], batches: [] })

type LotInput = { serials?: string[]; batch_no?: string; expiry_date?: string }

/** Adds what one submitted item names; `qty` is that item's quantity (the batch quantity). */
export function addItemLots(into: ItemLots, item: LotInput, qty: Prisma.Decimal) {
  const batchNo = item.batch_no?.trim()
  if (item.expiry_date && !batchNo) {
    throw new Error('expiry_date needs a batch_no')
  }
  if (item.serials?.length && batchNo) {
    throw new Error('A line names serial numbers or a batch, not both')
  }
  into.serials.push(...(item.serials ?? []).map((serial) => serial.trim()).filter(Boolean))
  if (batchNo) {
    into.batches.push({ batchNo, ...(item.expiry_date ? { expiryDate: item.expiry_date } : {}), qty })
  }
}

/** The engine's view; undefined when the line names nothing. */
export function toStockLots(lots: ItemLots): StockLots | undefined {
  if (!lots.serials.length && !lots.batches.length) return undefined
  return {
    ...(lots.serials.length ? { serials: lots.serials } : {}),
    ...(lots.batches.length ? { batches: lots.batches } : {}),
  }
}

/**
 * Lots in a command fingerprint: nothing when the line names none, so a
 * command without tracking hashes exactly as it did before tracking existed.
 */
export function lotsFingerprint(lots: ItemLots) {
  return {
    ...(lots.serials.length ? { serials: [...lots.serials].sort() } : {}),
    ...(lots.batches.length
      ? {
          batches: lots.batches
            .map((batch) => ({
              batch_no: batch.batchNo,
              expiry_date: batch.expiryDate?.slice(0, 10) ?? null,
              qty: quantityNumber(batch.qty),
            }))
            .sort((left, right) =>
              `${left.batch_no}|${left.expiry_date}`.localeCompare(`${right.batch_no}|${right.expiry_date}`),
            ),
        }
      : {}),
  }
}

/**
 * A line may name only what its variant is tracked by: serials for a serial
 * variant, batches for a batch variant, nothing for an untracked one (the
 * engine would silently ignore it, which would hide a mistake).
 */
export function assertLotsMatchTracking(
  lines: Array<{ variantId: string; sku: string; lots: ItemLots }>,
  trackingOf: Map<string, string | undefined>,
) {
  for (const { variantId, sku, lots } of lines) {
    const tracking = trackingOf.get(variantId)
    const wrong =
      (lots.serials.length > 0 && tracking !== 'serial') ||
      (lots.batches.length > 0 && tracking !== 'batch')
    if (wrong) {
      throw new BadRequestException({
        code: 'TRACKING_DATA_NOT_EXPECTED',
        message: `${sku} is ${tracking === 'serial' || tracking === 'batch' ? `tracked by ${tracking}` : 'not tracked'}; the line names ${lots.serials.length ? 'serial numbers' : 'a batch'}`,
        message_ar: 'بيانات التتبع في هذا البند لا تناسب نوع تتبع الصنف.',
        variant_id: variantId,
      })
    }
  }
}
