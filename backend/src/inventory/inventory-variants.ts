import type { Prisma } from '@prisma/client';

/** What the stock documents (opening balance, adjustment, count, import) need to know about a variant. */
export type StockVariant = {
  id: string;
  sku: string;
  item_type: string;
  tracking: string;
  cost_price: Prisma.Decimal;
  precision: number;
};

/** Why a variant cannot take part in a stock document, in the shape clients read. */
export type LineRefusal = { code: string; message: string; message_ar: string };

/** Variants of the tenant, by id; ids of other tenants are simply absent. */
export async function loadStockVariants(
  db: Pick<Prisma.TransactionClient, 'productVariant'>,
  tenantId: string,
  ids: string[],
): Promise<Map<string, StockVariant>> {
  if (!ids.length) return new Map();
  const rows = await db.productVariant.findMany({
    where: { tenant_id: tenantId, id: { in: [...new Set(ids)] } },
    select: {
      id: true,
      sku: true,
      item_type: true,
      tracking: true,
      cost_price: true,
      base_uom: { select: { precision: true } },
    },
  });
  return new Map(
    rows.map(({ base_uom, ...row }) => [row.id, { ...row, precision: base_uom?.precision ?? 0 }]),
  );
}

/**
 * The refusal for putting `qty` of this variant into a stock document, or null
 * when it is fine. Serial / batch variants are refused for now (their clients
 * come after launch); so are items that hold no stock.
 */
export function refuseVariant(variant: StockVariant | undefined, qty: Prisma.Decimal): LineRefusal | null {
  if (!variant) {
    return { code: 'VARIANT_NOT_FOUND', message: 'Variant not found', message_ar: 'الصنف غير موجود.' };
  }
  if (variant.item_type !== 'stocked') {
    return {
      code: 'ITEM_NOT_STOCKED',
      message: `${variant.sku} is not a stocked item`,
      message_ar: 'هذا الصنف لا يحتفظ برصيد مخزون (خدمة أو صنف بلا مخزون).',
    };
  }
  if (variant.tracking !== 'none') {
    return {
      code: 'TRACKED_VARIANT_NOT_SUPPORTED',
      message: `${variant.sku} is tracked by ${variant.tracking}; it cannot be handled here yet`,
      message_ar: 'الأصناف المتتبعة بالسيريال أو بالدفعات لا تدعمها هذه العملية حاليًا.',
    };
  }
  if (qty.decimalPlaces() > variant.precision) {
    return {
      code: 'QUANTITY_PRECISION_EXCEEDED',
      message: `${variant.sku}: quantity allows at most ${variant.precision} decimal place(s)`,
      message_ar: 'الكمية تحتوي على كسور أكثر مما تسمح به وحدة القياس.',
    };
  }
  return null;
}
