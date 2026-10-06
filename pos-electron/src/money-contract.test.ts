import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * POS half of the cross-application financial precision contract.
 *
 * These assertions used to live in `backend/src/common/money-contract.spec.ts`,
 * where a cashier-screen edit failed the backend CI job with no visible cause.
 * They assert about POS source only and therefore belong to the POS workspace;
 * `scripts/check-workspace.mjs` enforces that a test may only read files inside
 * its own application workspace.
 */
describe('financial precision contract', () => {
  const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

  it('keeps POS totals in integer cents', () => {
    const main = source('electron/ipc/sales.ts')
    const command = source('electron/sale-command.ts')
    const math = source('electron/sale-math.ts')
    const utils = source('src/utils.ts')
    const register = source('src/screens/RegisterScreen.tsx')

    // The total is priced by the one shared sale arithmetic and compared in cents.
    expect(math).toContain('priceSale(')
    expect(command).toContain('toCents(sale.localTotal) !== toCents(priced.total)')
    expect(main).toContain('priceAndCheckSale(')
    expect(main).not.toMatch(/Math\.round\s*\(\s*localTotal\s*\*\s*100/)
    expect(command).not.toMatch(/Math\.round\s*\(\s*localTotal\s*\*\s*100/)
    expect(utils).not.toMatch(/\*\s*100/)
    expect(register).not.toContain('item.unit_price*item.qty')
  })
})
