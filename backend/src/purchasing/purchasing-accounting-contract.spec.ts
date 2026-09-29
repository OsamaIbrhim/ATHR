import fs from 'fs';
import path from 'path';

describe('purchasing cost accounting contract', () => {
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      'prisma',
      'migrations',
      '000000000000_baseline',
      'migration.sql',
    ),
    'utf8',
  );
  const service = fs.readFileSync(
    path.join(
      process.cwd(),
      'src',
      'purchasing',
      'purchasing.service.ts',
    ),
    'utf8',
  );

  it('pins immutable global moving-average cost movements and exact receipt identity', () => {
    expect(migration).toContain('CREATE TABLE "InventoryCostMovement"');
    expect(migration).toContain('"InventoryCostMovement_append_only"');
    expect(migration).toContain('record_inventory_cost_movement');
    expect(migration).toContain('"InventoryMovement_sequence_key"');
    expect(migration).toContain('"InventoryMovement_variant_sequence_idx"');
    expect(migration).toContain('"InventoryCostMovement_sequence_key"');
    expect(migration).toContain(
      'Inventory value is outside DECIMAL(18,2) range',
    );
    expect(migration).toContain(
      'Inventory cost ledger mismatch after idempotent replay',
    );
    expect(migration).toContain(
      '"PurchaseInvoice_supplier_normalized_number_key"',
    );
    expect(migration).toContain('command_fingerprint character varying(64)');
    expect(migration).toContain('accounting_version integer');
    expect(migration).toContain('CREATE TABLE "SupplierReturn"');
    expect(migration).toContain('CREATE TABLE "SupplierReturnItem"');
    expect(migration).toContain('"InventoryCostMovement_value_equation"');
    expect(migration).toContain('"PurchaseInvoiceItem_financial_snapshot"');
    expect(migration).toContain('"PurchaseInvoice_immutable"');
    expect(migration).toContain('"PurchaseInvoiceItem_immutable"');
    expect(migration).toContain('"SupplierReturn_immutable"');
    expect(migration).toContain('"ReturnItem_cost_movement"');
    expect(migration).toContain(
      "'customer_return'::\"InventoryCostMovementType\"",
    );
    expect(migration).toContain('"ProductVariant_cost_ledger_guard"');
    expect(migration).toContain(
      'ProductVariant.cost_price is maintained by the inventory cost ledger',
    );
  });

  it('serializes concurrent receipt posting and keeps stock and both ledgers in one transaction', () => {
    expect(service).toContain(
      'Prisma.TransactionIsolationLevel.Serializable',
    );
    expect(service).toContain('FOR UPDATE');
    expect(service).toContain('record_inventory_movement');
    expect(service).toContain('record_inventory_cost_movement');
    expect(service).toContain('purchase.receipt.posted');
  });

  it('posts partial supplier returns at current average cost and records purchase-price variance', () => {
    expect(service).toContain('returnToSupplier');
    expect(service).toContain('supplier-return:${dto.command_id}');
    expect(service).toContain('purchase.supplier_return.posted');
    expect(service).toContain('supplier-return-stock:');
    expect(service).toContain('supplier-return-cost:');
    expect(service).toContain('purchase_price_variance');
  });

  it('allows only an untouched latest receipt to be fully reversed', () => {
    expect(service).toContain(
      'Purchase receipt has downstream inventory activity',
    );
    expect(service).toContain('purchase-reversal-stock:');
    expect(service).toContain('purchase-cost-reversal:');
    expect(service).toContain('purchase.receipt.reversed');
  });
});
