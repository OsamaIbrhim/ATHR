import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertQuantityPrecision, variantQuantityPrecision } from '../common/quantity';
import type { NormalizedLines } from './sale-command';

/** Loads the sold variants (tenant-scoped) and checks each quantity against its unit precision. */
export async function loadSaleVariants(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lines: NormalizedLines['lines'],
) {
  const variantIds = lines.map((item) => item.variant_id);
  const variants = await tx.productVariant.findMany({
    where: { id: { in: variantIds }, tenant_id: tenantId, product: { tenant_id: tenantId } },
    include: { product: true, base_uom: { select: { precision: true } } },
  });
  if (variants.length !== variantIds.length) {
    const found = new Set(variants.map((variant) => variant.id));
    const missing = variantIds.find((id) => !found.has(id));
    throw new NotFoundException(`Variant not found: ${missing}`);
  }
  const variantsById = new Map<string, any>(variants.map((variant: any) => [variant.id, variant]));
  for (const line of lines) {
    assertQuantityPrecision(line.qty, variantQuantityPrecision(variantsById.get(line.variant_id)!), line.sku_snapshot);
  }
  return variantsById;
}
