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

const srcRoot = path.join(process.cwd(), 'src');
const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

/** Production sources outside the inventory module (specs may build fixtures freely). */
function nonInventorySources() {
  return sourceFiles(srcRoot)
    .filter((file) => !file.endsWith('.spec.ts'))
    .map((file) => ({
      relative: path.relative(srcRoot, file).replaceAll('\\', '/'),
      source: fs.readFileSync(file, 'utf8'),
    }))
    .filter(({ relative }) => !relative.startsWith('inventory/'));
}

describe('inventory single-writer contract', () => {
  it('lets only InventoryService write stock, the two ledgers and the batch / serial / lot tables', () => {
    const ledgerWrite =
      /\b(?:inventoryStock|inventoryMovement|inventoryCostMovement|inventoryBatch|inventorySerial|inventoryLotMovement)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"Inventory(?:Stock|Movement|CostMovement|Batch|Serial|LotMovement)"/i;
    const writers = nonInventorySources()
      .filter(({ source }) => ledgerWrite.test(source))
      .map(({ relative }) => relative);

    // Every writer goes through `inventory.apply`; a new entry here means a
    // module writes stock behind the engine's back (no ledger row, no lock order).
    expect(writers).toEqual([]);
  });

  it('keeps the lot ledger append-only and the unallocated batch the only negative one', () => {
    const migration = read('prisma/migrations/202610020001_tracking_serial_batch/migration.sql');
    expect(migration).toContain('"InventoryLotMovement_append_only" BEFORE DELETE OR UPDATE');
    expect(migration).toContain(`CHECK ("qty" >= 0 OR "batch_no" = '')`);
    expect(migration).toContain('CHECK (("batch_id" IS NULL) <> ("serial_id" IS NULL))');
  });

  it('has no PL/pgSQL ledger function left to call', () => {
    const callers = nonInventorySources()
      .filter(({ source }) => /record_inventory(?:_cost)?_movement/.test(source))
      .map(({ relative }) => relative);
    expect(callers).toEqual([]);

    const migration = read('prisma/migrations/202609300001_site_model_inventory_engine/migration.sql');
    expect(migration).toContain('DROP FUNCTION record_inventory_movement');
    expect(migration).toContain('DROP FUNCTION record_inventory_cost_movement');
    expect(migration).toContain('DROP TRIGGER "ReturnItem_inventory_movement"');
    expect(migration).toContain('DROP TRIGGER "TransferItem_inventory_and_transit_movements"');
  });

  it('keeps the cheap append-only guards and stock constraints', () => {
    const baseline = read('prisma/migrations/000000000000_baseline/migration.sql');
    const migration = read('prisma/migrations/202609300001_site_model_inventory_engine/migration.sql');

    // Never dropped by the engine migration.
    expect(baseline).toContain('"InventoryMovement_append_only"');
    expect(baseline).toContain('"InventoryCostMovement_append_only"');
    expect(baseline).toContain('"InventoryStock_reserved_not_above_available_on_hand"');
    expect(baseline).toContain('"InventoryMovement_reserved_not_above_available_on_hand"');
    expect(migration).not.toContain('DROP TRIGGER "InventoryMovement_append_only"');
    expect(migration).not.toContain('DROP TRIGGER "InventoryCostMovement_append_only"');
  });

  it('allows acceptance-first sales to drive stock below zero through the engine', () => {
    const baseline = read('prisma/migrations/000000000000_baseline/migration.sql');
    const sales = read('src/sales/sales.service.ts');

    // No non-negative constraint on stock or the ledger; the sale opts in explicitly.
    expect(baseline).not.toContain('"InventoryStock_qty_on_hand_nonnegative"');
    expect(baseline).not.toContain('"InventoryMovement_nonnegative_balances"');
    expect(sales).toContain('allowNegative: true');
    expect(sales).toContain("idempotencyKey: `sale:${dto.sync_id}`");
  });

  it('keys stock by warehouse and scopes command idempotency to the tenant', () => {
    const schema = read('prisma/schema.prisma');
    const stock = schema.slice(schema.indexOf('model InventoryStock'), schema.indexOf('enum InventoryMovementType'));
    expect(stock).toContain('@@id([warehouse_id, variant_id])');
    expect(stock).not.toContain('branch_id');
    expect(schema).toContain('@@unique([tenant_id, idempotency_key, variant_id])');
  });

  it('seeds through the engine: no ledger backfill scripts remain', () => {
    const packageJson = JSON.parse(read('package.json'));
    expect(packageJson.scripts['prisma:seed']).not.toContain('ensure-seeded');
    expect(packageJson.prisma.seed).not.toContain('ensure-seeded');
    expect(fs.existsSync(path.join(process.cwd(), 'prisma', 'ensure-seeded-inventory-ledger.mjs'))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), 'prisma', 'ensure-seeded-cost-ledger.mjs'))).toBe(false);
  });
});
