import { toCatalogProduct } from './db/product-row'
import { get, q, run, tx } from './db/queries'
import { isValidCatalogProduct } from './catalog-format'
import {
  HeldSaleScope,
  parseHeldSaleItems,
  sanitizeHeldSaleCustomer,
} from './held-sale'
import { fromCents, lineCents } from './money'
import { isValidQuantity } from './quantity'
import { readSecureState } from './secure-state'

/** The branch/cashier/shift the current secure state authorizes, or throws. */
export function currentHeldSaleScope(): HeldSaleScope {
  const state = readSecureState()
  const user = state.auth?.session?.user
  const device = state.device
  const context = state.accounting
  if (
    !user ||
    !device ||
    !context ||
    context.user_id !== user.id ||
    context.branch_id !== user.branch_id ||
    context.branch_id !== device.branch_id ||
    context.terminal_id !== device.terminal_id ||
    !context.shift_id
  ) {
    throw new Error(
      'لا يمكن الوصول إلى الفواتير المعلقة قبل تسجيل الكاشير وتجهيز الوردية على هذا الجهاز.',
    )
  }
  return {
    branch_id: context.branch_id,
    cashier_id: context.user_id,
    shift_id: context.shift_id,
  }
}

function parseHeldCustomer(value: unknown) {
  if (!value) return null
  try {
    return sanitizeHeldSaleCustomer(JSON.parse(String(value)))
  } catch {
    throw new Error('بيانات عميل الفاتورة المعلقة تالفة. احذف المسودة وأعد إنشاءها.')
  }
}

/** Rebuilds every line from the current catalog and stock; throws if a line is no longer sellable. */
export function hydrateHeldSale(row: any) {
  const items = parseHeldSaleItems(row.items_json).map((stored) => {
    const row = get(
      `SELECT p.*,COALESCE(s.qty,0) AS available_qty
       FROM products p
       LEFT JOIN stock s ON s.variant_id=p.id
       WHERE p.id=?`,
      [stored.variant_id],
    )
    const product = row && toCatalogProduct(row)
    const available = Number(product?.available_qty)
    const price = Number(product?.selling_price)
    const tax = Number(product?.unit_tax)
    if (
      !product ||
      !isValidCatalogProduct(product) ||
      !isValidQuantity(stored.qty, Number(product.uom_precision) || 0) ||
      !Number.isFinite(available) ||
      available < stored.qty ||
      price <= 0
    ) {
      throw new Error(
        `الصنف ${stored.variant_id} تغير أو لم تعد كميته كافية. احذف المسودة أو أعد بناءها من الكتالوج الحالي.`,
      )
    }
    return {
      ...product,
      id: String(product.id),
      variant_id: String(product.id),
      name: String(product.name_ar || product.name_en || product.sku || product.id),
      qty: stored.qty,
      unit_price: price,
      unit_tax: tax,
      available_qty: available,
    }
  })
  const totalCents = items.reduce(
    (sum, item) =>
      sum + lineCents(item.unit_price, item.qty) + lineCents(item.unit_tax, item.qty),
    0,
  )
  return {
    id: String(row.id),
    customer: parseHeldCustomer(row.customer_json),
    items,
    item_count: items.length,
    total: fromCents(totalCents),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    resume_error: null,
  }
}

function summarizeHeldSale(row: any) {
  try {
    return hydrateHeldSale(row)
  } catch (error) {
    let itemCount = 0
    try {
      itemCount = parseHeldSaleItems(row.items_json).length
    } catch {}
    let customer = null
    try {
      customer = parseHeldCustomer(row.customer_json)
    } catch {}
    return {
      id: String(row.id),
      customer,
      items: [],
      item_count: itemCount,
      total: 0,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      resume_error:
        error instanceof Error ? error.message : 'تعذر استعادة الفاتورة المعلقة.',
    }
  }
}

const scopeParams = (scope: HeldSaleScope) => [scope.branch_id, scope.cashier_id, scope.shift_id]

export function listHeldSales(scope: HeldSaleScope) {
  return q(
    `SELECT * FROM held_sales
     WHERE branch_id=? AND cashier_id=? AND shift_id=?
     ORDER BY created_at DESC
     LIMIT 50`,
    scopeParams(scope),
  ).map(summarizeHeldSale)
}

export function findHeldSale(scope: HeldSaleScope, id: string) {
  return get(
    `SELECT * FROM held_sales WHERE id=? AND branch_id=? AND cashier_id=? AND shift_id=?`,
    [id, ...scopeParams(scope)],
  )
}

const DELETE_HELD_SQL = `DELETE FROM held_sales WHERE id=? AND branch_id=? AND cashier_id=? AND shift_id=?`

export function deleteHeldSale(scope: HeldSaleScope, id: string) {
  return run(DELETE_HELD_SQL, [id, ...scopeParams(scope)]) === 1
}

/** Inserts the draft and trims the scope to the newest 50, atomically. */
export function insertHeldSale(scope: HeldSaleScope, row: Record<string, unknown>) {
  tx(() => {
    run(
      `INSERT INTO held_sales (
        id,branch_id,cashier_id,shift_id,
        customer_json,items_json,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        row.id,
        row.branch_id,
        row.cashier_id,
        row.shift_id,
        row.customer_json,
        row.items_json,
        row.created_at,
        row.updated_at,
      ],
    )
    const stale = q(
      `SELECT id FROM held_sales
       WHERE branch_id=? AND cashier_id=? AND shift_id=?
       ORDER BY created_at DESC
       LIMIT -1 OFFSET 50`,
      scopeParams(scope),
    )
    for (const draft of stale) run(DELETE_HELD_SQL, [draft.id, ...scopeParams(scope)])
  })
}
