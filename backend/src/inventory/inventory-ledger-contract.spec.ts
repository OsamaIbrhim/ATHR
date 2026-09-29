import * as fs from 'fs';
import * as path from 'path';
import {
  AUDITED_STOCK_WRITERS,
  AUDITED_STOCK_WRITERS_MODULE,
} from './audited-stock-writers';

function sourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(absolute);
  }
  return result;
}

describe('inventory movement ledger contract', () => {
  it('keeps every current central stock writer inside the audited mutation surface', () => {
    const srcRoot = path.join(process.cwd(), 'src');
    const mutationPattern =
      /\binventoryStock\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"InventoryStock"/i;
    const writers = sourceFiles(srcRoot)
      .filter((file) => !file.endsWith('.spec.ts'))
      .map((file) => ({
        file,
        relative: path.relative(srcRoot, file).replaceAll('\\', '/'),
      }))
      .filter(({ relative }) => relative !== AUDITED_STOCK_WRITERS_MODULE)
      .filter(({ file }) => mutationPattern.test(fs.readFileSync(file, 'utf8')))
      .map(({ relative }) => relative)
      .sort();

    // The expectation is the declared allowlist, not a literal inlined here.
    // A diff to `audited-stock-writers.ts` is the intended way to widen the
    // audited stock mutation surface; read that file before changing this.
    expect(writers).toEqual([...AUDITED_STOCK_WRITERS].sort());
  });

  it('keeps the ledger function, append-only guards, and stock constraints in the baseline', () => {
    const baseline = fs.readFileSync(
      path.join(
        process.cwd(),
        'prisma',
        'migrations',
        '000000000000_baseline',
        'migration.sql',
      ),
      'utf8',
    );

    expect(baseline).toContain('FUNCTION record_inventory_movement');
    expect(baseline).toContain('FUNCTION record_inventory_cost_movement');
    expect(baseline).toContain('"ReturnItem_inventory_movement"');
    expect(baseline).toContain('"InventoryMovement_append_only"');
    expect(baseline).toContain('"InventoryCostMovement_append_only"');
    expect(baseline).toContain(
      '"InventoryStock_reserved_not_above_available_on_hand"',
    );
    expect(baseline).toContain(
      '"InventoryMovement_reserved_not_above_available_on_hand"',
    );
    expect(baseline).toContain(
      'Outgoing cost movement cannot deepen a negative inventory deficit',
    );
  });

  it('allows acceptance-first sales to create an audited inventory deficit', () => {
    const baseline = fs.readFileSync(
      path.join(
        process.cwd(),
        'prisma',
        'migrations',
        '000000000000_baseline',
        'migration.sql',
      ),
      'utf8',
    );
    const hardLoad = fs.readFileSync(
      path.join(process.cwd(), 'perf', 'hard-load.mjs'),
      'utf8',
    );

    expect(baseline).not.toContain('"InventoryStock_qty_on_hand_nonnegative"');
    expect(baseline).not.toContain('"InventoryMovement_nonnegative_balances"');
    expect(baseline).toContain('negative_inventory_units_covered');
    expect(hardLoad).toContain(
      'Negative-stock sale must be accepted with a warning and replay idempotently',
    );
    expect(hardLoad).toContain('deficitStock?.qty_on_hand !== -1');
    expect(hardLoad).toContain(
      'Negative inventory cost coverage policy failed',
    );
    expect(hardLoad).toContain(
      'const coverageVariant = await tx.productVariant.create',
    );
    expect(hardLoad).toContain('qty_on_hand: -1');
  });

  it('keeps acceptance-first sales on one explicit inventory writer', () => {
    const baseline = fs.readFileSync(
      path.join(
        process.cwd(),
        'prisma',
        'migrations',
        '000000000000_baseline',
        'migration.sql',
      ),
      'utf8',
    );
    const salesService = fs.readFileSync(
      path.join(process.cwd(), 'src', 'sales', 'sales.service.ts'),
      'utf8',
    );
    const ledgerSmoke = fs.readFileSync(
      path.join(process.cwd(), 'perf', 'inventory-ledger-smoke.mjs'),
      'utf8',
    );

    expect(baseline).not.toContain('SalesInvoiceItem_inventory_movement');
    expect(baseline).not.toContain('record_sale_inventory_movement');
    expect(salesService).toContain('qty_on_hand: { decrement: item.qty }');
    expect(salesService).toContain(
      '${`sale:${dto.sync_id}:${item.variant_id}`}::text',
    );
    expect(ledgerSmoke).toContain(
      'SELECT "record_inventory_movement"(',
    );
    expect(ledgerSmoke).toContain(
      'const saleMovementKey = `sale:${saleSyncId}:${variant.id}`',
    );
  });

  it('allows the cost ledger to cover a negative sales deficit without weakening quantity arithmetic', () => {
    const baseline = fs.readFileSync(
      path.join(
        process.cwd(),
        'prisma',
        'migrations',
        '000000000000_baseline',
        'migration.sql',
      ),
      'utf8',
    );

    expect(baseline).toContain(
      'CONSTRAINT "InventoryCostMovement_quantity_consistency" CHECK (((quantity_delta <> 0) AND ((global_quantity_before + quantity_delta) = global_quantity_after)))',
    );
  });

  it('keeps the remote-database smoke transaction bounded, configurable, and always disconnected', () => {
    const smoke = fs.readFileSync(
      path.join(process.cwd(), 'perf', 'inventory-ledger-smoke.mjs'),
      'utf8',
    );

    expect(smoke).toContain('INVENTORY_LEDGER_SMOKE_TIMEOUT_MS');
    expect(smoke).toContain('INVENTORY_LEDGER_SMOKE_MAX_WAIT_MS');
    expect(smoke).toContain('120_000');
    expect(smoke).toContain('300_000');
    expect(smoke).toContain('finally {');
    expect(smoke).toContain('await prisma.$disconnect()');
    expect(smoke).not.toContain("timeout: 30_000");
  });



  it('keeps normal and volume seed workflows reconciled with the inventory ledger', () => {
    const helper = fs.readFileSync(
      path.join(process.cwd(), 'prisma', 'ensure-seeded-inventory-ledger.mjs'),
      'utf8',
    );
    const volumeSeed = fs.readFileSync(
      path.join(process.cwd(), 'perf', 'volume-seed.mjs'),
      'utf8',
    );
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    );

    expect(helper).toContain(`'opening_balance'::"InventoryMovementType"`);
    expect(helper).toContain('AND NOT EXISTS');
    expect(helper).toContain('FULL OUTER JOIN ledger');
    expect(helper).toContain('Seed inventory ledger reconciliation failed');
    expect(volumeSeed).toContain('ensureSeededInventoryLedger');
    expect(packageJson.scripts['prisma:seed']).toContain(
      'ensure-seeded-inventory-ledger.mjs',
    );
    expect(packageJson.prisma.seed).toContain(
      'ensure-seeded-inventory-ledger.mjs',
    );
  });

});
