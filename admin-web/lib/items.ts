import { apiGet } from './api'

export interface PickedItem {
  id: string
  sku: string
  label: string | null
  name: string
  barcodes: { code: string; pack_qty: number }[]
  /** Present only when the API returned it (catalog.product.view-cost-sensitive). */
  costPrice: string | null
  baseUomId: string | null
  tracked: boolean
  stocked: boolean
  /** On-hand in the requested branch, when the list was asked for one. */
  available: number | null
}

/** A variant row of `GET /products` as the L1 screens need it. */
export function toPickedItem(raw: any): PickedItem {
  return {
    id: String(raw.id),
    sku: String(raw.sku ?? ''),
    label: raw.label || null,
    name: raw.product?.name_ar || raw.product?.name_en || raw.name_ar || raw.name_en || String(raw.sku ?? ''),
    barcodes: (raw.barcodes ?? []).map((b: any) => ({ code: String(b.code), pack_qty: Number(b.pack_qty) || 1 })),
    costPrice: raw.cost_price === undefined || raw.cost_price === null ? null : String(raw.cost_price),
    baseUomId: raw.base_uom_id ?? raw.product?.base_uom_id ?? null,
    tracked: !!raw.tracking && raw.tracking !== 'none',
    stocked: raw.item_type === undefined || raw.item_type === 'stocked',
    available: typeof raw.available_here === 'number' ? raw.available_here : null,
  }
}

/** The item and pack multiplier for an exact barcode, or null. */
export function matchBarcode(items: PickedItem[], code: string): { item: PickedItem; packQty: number } | null {
  const wanted = code.trim()
  if (!wanted) return null
  for (const item of items) {
    const hit = item.barcodes.find(b => b.code === wanted)
    if (hit) return { item, packQty: hit.pack_qty }
  }
  return null
}

/** Server-side search (name, SKU, barcode); never a fixed first-N list. */
export async function searchItems(query: string, branchId?: string): Promise<PickedItem[]> {
  const params = new URLSearchParams({ q: query.trim(), page: '1', page_size: '20' })
  if (branchId) params.set('branch_id', branchId)
  const response = await apiGet(`/products?${params.toString()}`)
  return (response.items ?? []).map(toPickedItem)
}

export function itemTitle(item: Pick<PickedItem, 'name' | 'label'>): string {
  return item.label ? `${item.name} - ${item.label}` : item.name
}

/** Decimals a unit allows, from `GET /uom` (piece 0, kg 3). Without a known unit: 0. */
export function quantityPrecision(item: Pick<PickedItem, 'baseUomId'>, uoms: Map<string, UomInfo>): number {
  if (!item.baseUomId) return 0
  return uoms.get(item.baseUomId)?.precision ?? 0
}

export interface UomInfo { id: string; name: string; precision: number }

let uomCache: Promise<Map<string, UomInfo>> | null = null

/** Units of measure, fetched once per page load; a failure is not cached and gives an empty map. */
export function loadUoms(): Promise<Map<string, UomInfo>> {
  if (!uomCache) {
    uomCache = apiGet('/uom')
      .then((rows: any) => new Map<string, UomInfo>((Array.isArray(rows) ? rows : rows?.items ?? []).map((u: any) => [
        String(u.id), { id: String(u.id), name: u.name_ar || u.name_en || u.code, precision: Number(u.precision) || 0 },
      ])))
      .catch(() => { uomCache = null; return new Map<string, UomInfo>() })
  }
  return uomCache
}
