import * as fs from 'fs';
import * as path from 'path';

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
      .filter((file) => mutationPattern.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(srcRoot, file).replaceAll('\\', '/'))
      .sort();

    expect(writers).toEqual([
      'purchasing/purchasing.service.ts',
      'sales/sales.service.ts',
      'transfers/transfers.service.ts',
    ]);
  });

  it('keeps the database function, semantic triggers, reconciliation backfill, and append-only guard in the migration', () => {
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        'prisma',
        'migrations',
        '202607220002_inventory_movement_ledger',
        'migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain('record_inventory_movement');
    expect(migration).toContain('SalesInvoiceItem_inventory_movement');
    expect(migration).toContain('ReturnItem_inventory_movement');
    expect(migration).toContain('Transfer_inventory_movement');
    expect(migration).toContain('migration-opening:');
    expect(migration).toContain('InventoryMovement_append_only');
    expect(migration).toContain('InventoryStock_reserved_not_above_on_hand');
  });

  it('pins every trigger call to the exact ledger-writer PostgreSQL signature', () => {
    const correction = fs.readFileSync(
      path.join(
        process.cwd(),
        'prisma',
        'migrations',
        '202607220003_inventory_ledger_trigger_casts',
        'migration.sql',
      ),
      'utf8',
    );

    expect(correction).toContain(`'sale'::"InventoryMovementType"`);
    expect(correction).toContain(`'return'::"InventoryMovementType"`);
    expect(correction).toContain(`'transfer_out'::"InventoryMovementType"`);
    expect(correction).toContain(`'transfer_in'::"InventoryMovementType"`);
    expect(correction).toContain(`'SalesInvoice'::text`);
    expect(correction).toContain(`'Return'::text`);
    expect(correction).toContain(`'Transfer'::text`);
    expect(correction).toContain('CURRENT_TIMESTAMP::timestamp(3)');
    expect(correction).toContain(')::timestamp(3)');
  });

  it('allows acceptance-first sales to create an audited inventory deficit', () => {
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        'prisma',
        'migrations',
        '202607280002_acceptance_first_negative_stock',
        'migration.sql',
      ),
      'utf8',
    );
    const hardLoad = fs.readFileSync(
      path.join(process.cwd(), 'perf', 'hard-load.mjs'),
      'utf8',
    );

    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "InventoryStock_qty_on_hand_nonnegative"',
    );
    expect(migration).toContain(
      '"InventoryStock_reserved_not_above_available_on_hand"',
    );
    expect(migration).toContain(
      'negative_inventory_units_covered',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "record_inventory_cost_movement"',
    );
    expect(migration).not.toContain('pg_get_functiondef');
    expect(migration).not.toContain('definition := replace');
    expect(migration).toContain(
      'Outgoing cost movement cannot deepen a negative inventory deficit',
    );
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
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        'prisma',
        'migrations',
        '202607290001_sales_inventory_single_writer',
        'migration.sql',
      ),
      'utf8',
    );
    const salesService = fs.readFileSync(
      path.join(process.cwd(), 'src', 'sales', 'sales.service.ts'),
      'utf8',
    );
    const negativeBalanceMigration = fs.readFileSync(
      path.join(
        process.cwd(),
        'prisma',
        'migrations',
        '202607290002_inventory_movement_negative_balance',
        'migration.sql',
      ),
      'utf8',
    );
    const ledgerSmoke = fs.readFileSync(
      path.join(process.cwd(), 'perf', 'inventory-ledger-smoke.mjs'),
      'utf8',
    );

    expect(migration).toContain(
      'DROP TRIGGER IF EXISTS "SalesInvoiceItem_inventory_movement"',
    );
    expect(migration).toContain(
      'DROP FUNCTION IF EXISTS "record_sale_inventory_movement"()',
    );
    expect(migration).not.toContain('DROP FUNCTION IF EXISTS "record_inventory_movement"');
    expect(salesService).toContain('qty_on_hand: { decrement: item.qty }');
    expect(salesService).toContain(
      '${`sale:${dto.sync_id}:${item.variant_id}`}::text',
    );
    expect(negativeBalanceMigration).toContain(
      'DROP CONSTRAINT IF EXISTS "InventoryMovement_nonnegative_balances"',
    );
    expect(negativeBalanceMigration).toContain(
      '"InventoryMovement_reserved_not_above_available_on_hand"',
    );
    expect(negativeBalanceMigration).toContain(
      'GREATEST("on_hand_after", 0)',
    );
    expect(ledgerSmoke).toContain(
      'SELECT "record_inventory_movement"(',
    );
    expect(ledgerSmoke).toContain(
      'const saleMovementKey = `sale:${saleSyncId}:${variant.id}`',
    );
  });

  it('allows the cost ledger to cover a negative sales deficit without weakening quantity arithmetic', () => {
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        'prisma',
        'migrations',
        '202607290003_inventory_cost_negative_balance',
        'migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "InventoryCostMovement_quantity_consistency"',
    );
    expect(migration).toContain('"quantity_delta" <> 0');
    expect(migration).toContain(
      '"global_quantity_before" + "quantity_delta" =',
    );
    expect(migration).toContain('"global_quantity_after"');
    expect(migration).not.toContain('"global_quantity_before" >= 0');
    expect(migration).not.toContain('"global_quantity_after" >= 0');
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
