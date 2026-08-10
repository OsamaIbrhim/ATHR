import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Admin half of the cross-application financial precision contract.
 *
 * These assertions used to live in `backend/src/common/money-contract.spec.ts`,
 * where an invoice-page edit failed the backend CI job with no visible cause.
 * They assert about Admin source only and therefore belong to the Admin
 * workspace; `scripts/check-workspace.mjs` enforces that a test may only read
 * files inside its own application workspace.
 */
describe('financial precision contract', () => {
  const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

  it('does not recompute invoice money with floats in Admin', () => {
    const invoicePage = source('app/sales/[id]/page.tsx')

    expect(invoicePage).toContain('lineTotal(i.unit_price,i.unit_tax,i.qty)')
    expect(invoicePage).not.toMatch(/Number\(i\.unit_price\)\s*\*\s*i\.qty/)
  })
})
