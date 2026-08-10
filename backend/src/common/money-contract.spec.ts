import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Backend half of the cross-application financial precision contract.
 *
 * This spec asserts only about files inside the backend workspace. The POS and
 * Admin halves live with the code they describe —
 * `pos-electron/src/money-contract.test.ts` and
 * `admin-web/app/sales/money-contract.test.ts` — so that editing a cashier
 * screen or an invoice page fails the workspace that owns it instead of the
 * backend CI job. `scripts/check-workspace.mjs` enforces that boundary.
 */
describe('financial precision contract', () => {
  const source = (path: string) =>
    readFileSync(join(process.cwd(), path), 'utf8');

  it('keeps report aggregation on Decimal arithmetic', () => {
    const reports = source('src/reports/reports.service.ts');

    expect(reports).toContain('sumMoney(');
    expect(reports).toContain('lineMoney(');
    expect(reports).not.toMatch(/\bMath\.round\s*\(/);
    expect(reports).not.toMatch(/\bNumber\s*\(\s*(?:invoice|item|record|row)\./);
  });

  it('keeps sale and return reconciliation off binary cent comparisons', () => {
    const sales = source('src/sales/sales.service.ts');

    expect(sales).toContain('sameMoney(dto.local_total, total)');
    expect(sales).not.toMatch(/Math\.round\s*\(\s*dto\.local_total\s*\*\s*100/);
    expect(sales).not.toContain('Number(variant.cost_price)');
    expect(sales).not.toContain('Number(soldItem.unit_price)');
    expect(sales).not.toContain('Number(soldItem.unit_cost)');
    expect(sales).not.toContain('Number(soldItem.unit_tax)');
  });
});
