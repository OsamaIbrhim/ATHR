import fs from 'fs';
import path from 'path';

describe('purchasing cost accounting contract', () => {
  const read = (...segments: string[]) =>
    fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8');
  const baseline = read('prisma', 'migrations', '000000000000_baseline', 'migration.sql');
  const engineMigration = read(
    'prisma',
    'migrations',
    '202609300001_site_model_inventory_engine',
    'migration.sql',
  );
  const service = read('src', 'purchasing', 'purchasing.service.ts');

  it('pins immutable per-warehouse moving-average cost movements and exact receipt identity', () => {
    // The cost ledger stays append-only and arithmetically exact.
    expect(baseline).toContain('CREATE TABLE "InventoryCostMovement"');
    expect(baseline).toContain('"InventoryCostMovement_append_only"');
    expect(baseline).toContain('"InventoryCostMovement_value_equation"');
    expect(engineMigration).toContain('"InventoryCostMovement_quantity_consistency"');
    expect(engineMigration).toContain('"InventoryCostMovement_type_direction"');
    expect(engineMigration).toContain('DROP FUNCTION record_inventory_cost_movement');
    expect(engineMigration).toContain('"InventoryCostMovement_tenant_id_idempotency_key_variant_id_key"');
    // Purchase documents keep their exact identity and immutability.
    expect(baseline).toContain('"PurchaseInvoice_supplier_normalized_number_key"');
    expect(baseline).toContain('command_fingerprint character varying(64)');
    expect(baseline).toContain('accounting_version integer');
    expect(baseline).toContain('CREATE TABLE "SupplierReturn"');
    expect(baseline).toContain('CREATE TABLE "SupplierReturnItem"');
    expect(baseline).toContain('"PurchaseInvoiceItem_financial_snapshot"');
    expect(baseline).toContain('"PurchaseInvoice_immutable"');
    expect(baseline).toContain('"PurchaseInvoiceItem_immutable"');
    expect(baseline).toContain('"SupplierReturn_immutable"');
    expect(baseline).toContain('"ProductVariant_cost_ledger_guard"');
    expect(engineMigration).toContain('CREATE TRIGGER "ProductVariant_cost_ledger_guard"');
    expect(baseline).toContain('ProductVariant.cost_price is maintained by the inventory cost ledger');
  });

  it('serializes concurrent receipt posting and posts stock and cost as one inventory command', () => {
    expect(service).toContain('Prisma.TransactionIsolationLevel.Serializable');
    expect(service).toContain('FOR UPDATE');
    expect(service).toContain('this.inventory.apply(tx');
    expect(service).toContain("costType: 'purchase_receipt'");
    expect(service).toContain('purchase.receipt.posted');
    // No hand-written ledger or stock SQL in purchasing any more.
    expect(service).not.toContain('record_inventory_movement');
    expect(service).not.toContain('record_inventory_cost_movement');
    expect(service).not.toMatch(/UPDATE "InventoryStock"/);
  });

  it('posts partial supplier returns at current average cost and records purchase-price variance', () => {
    expect(service).toContain('returnToSupplier');
    expect(service).toContain('supplier-return:${dto.command_id}');
    expect(service).toContain('purchase.supplier_return.posted');
    expect(service).toContain('supplier-return-stock:');
    expect(service).toContain("costType: 'supplier_return'");
    expect(service).toContain('purchase_price_variance');
  });

  it('allows only an untouched latest receipt to be fully reversed', () => {
    expect(service).toContain(
      'Purchase receipt has downstream inventory activity',
    );
    expect(service).toContain('purchase-reversal-stock:');
    expect(service).toContain("costType: 'purchase_reversal'");
    expect(service).toContain('purchase.receipt.reversed');
  });
});
