/** How a scanned or typed term was resolved (see `db/scan.ts`). */
export type ScanKind = 'barcode' | 'sku' | 'scale' | 'search'

export interface ScanResult {
  kind: ScanKind
  /** How much of the (single) matched product one scan adds to the cart. */
  qty: number
  products: Array<Record<string, any>>
}
