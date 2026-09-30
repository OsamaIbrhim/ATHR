import { Prisma } from '@prisma/client';

export type CountScope = {
  scope_type: 'all' | 'category' | 'product_type';
  category_id: string | null;
  product_type_id: string | null;
};

/**
 * SQL condition on a product alias `p` that keeps the products of a scope.
 * Interpolate it into a `$queryRaw` template next to the tenant predicate.
 */
export function scopePredicate(scope: CountScope): Prisma.Sql {
  if (scope.scope_type === 'category') return Prisma.sql`p."category_id" = ${scope.category_id}::uuid`;
  if (scope.scope_type === 'product_type') return Prisma.sql`p."product_type_id" = ${scope.product_type_id}::uuid`;
  return Prisma.sql`TRUE`;
}

/** The value stored in `StockCount.scope_key` (what the one-open-count index keys on). */
export function scopeKey(scope: CountScope): string {
  if (scope.scope_type === 'category') return scope.category_id!;
  if (scope.scope_type === 'product_type') return scope.product_type_id!;
  return 'all';
}

/**
 * Two open counts of one warehouse may coexist only when they cannot count the
 * same item: both by category (different categories) or both by product type
 * (different types). Anything else can overlap, and an item counted twice would
 * have its variance applied twice.
 */
export function scopesOverlap(a: CountScope, b: CountScope): boolean {
  if (a.scope_type === 'all' || b.scope_type === 'all') return true;
  if (a.scope_type !== b.scope_type) return true;
  return scopeKey(a) === scopeKey(b);
}

/** Items a count of this scope can cover: active, stocked, not serial / batch tracked. */
export async function countScopeItems(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  tenantId: string,
  scope: CountScope,
): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ items: bigint }>>`
    SELECT COUNT(*) AS "items"
    FROM "ProductVariant" v
    JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
    WHERE v."tenant_id" = ${tenantId}::uuid
      AND v."is_active" AND p."is_active"
      AND v."item_type" = 'stocked' AND v."tracking" = 'none'
      AND ${scopePredicate(scope)}
  `;
  return Number(row?.items ?? 0);
}
