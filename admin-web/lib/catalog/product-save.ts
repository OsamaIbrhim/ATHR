import type { EditOperation } from './product-plan'

export interface CatalogApi {
  post: (path: string, body: unknown) => Promise<unknown>
  patch: (path: string, body: unknown) => Promise<unknown>
  del: (path: string) => Promise<unknown>
}

/** Runs one planned call. Paths are those of backend/src/products/products.controller.ts. */
export function runOperation(api: CatalogApi, productId: string, operation: EditOperation): Promise<unknown> {
  switch (operation.kind) {
    case 'patch-product': return api.patch(`/products/${productId}`, operation.body)
    case 'patch-variant': return api.patch(`/products/variants/${operation.id}`, operation.body)
    case 'deactivate-variant': return api.del(`/products/variants/${operation.id}`)
    case 'add-variant': return api.post(`/products/${productId}/variants`, operation.body)
    case 'add-barcode': return api.post(`/products/variants/${operation.variantId}/barcodes`, operation.body)
    case 'patch-barcode': return api.patch(`/products/barcodes/${operation.id}`, operation.body)
    case 'remove-barcode': return api.del(`/products/barcodes/${operation.id}`)
  }
}

export interface SaveResult {
  done: number
  total: number
  error?: string
}

/**
 * Applies the plan in order and stops at the first failure, reporting how many
 * calls already went through (the backend has no transaction across calls).
 */
export async function applyPlan(
  api: CatalogApi,
  productId: string,
  operations: readonly EditOperation[],
): Promise<SaveResult> {
  let done = 0
  for (const operation of operations) {
    try {
      await runOperation(api, productId, operation)
      done += 1
    } catch (error) {
      return { done, total: operations.length, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return { done, total: operations.length }
}
