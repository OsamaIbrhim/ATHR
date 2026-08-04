#!/usr/bin/env node
// WP-007 Phase B (MT-MIG-006) — B.6 dedicated database-level proof.
//
// Proves the database itself (not just application code) rejects:
//   1. every composite same-tenant foreign key's cross-tenant reference, and
//   2. a duplicate value within the same tenant scope for every tenant-scoped
//      uniqueness constraint added by this WP -- while also proving the same
//      value IS allowed across two different tenants (the constraint is
//      scoped, not still effectively global).
//
// Runs against a real, freshly-migrated Postgres (wired into the CI
// migration-gate job's `athr_migrations_clean` database). Not a jest spec:
// the `backend` CI job has no live database, matching the existing
// perf/*.mjs convention for tests that need one.
'use strict';

const crypto = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

const results = [];
let failed = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}\n`);
}

async function expectForeignKeyViolation(name, attempt) {
  try {
    await attempt();
    record(name, false, 'expected a foreign key violation but the write succeeded');
  } catch (error) {
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
    const isForeignKeyViolation = code === 'P2003' || code === 'P2025' || /foreign key constraint/i.test(String(error?.message));
    record(name, isForeignKeyViolation, isForeignKeyViolation ? undefined : `unexpected error: ${error?.code ?? ''} ${error?.message ?? error}`);
  }
}

async function expectUniqueViolation(name, attempt) {
  try {
    await attempt();
    record(name, false, 'expected a unique constraint violation but the write succeeded');
  } catch (error) {
    const isUniqueViolation = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    record(name, isUniqueViolation, isUniqueViolation ? undefined : `unexpected error: ${error?.code ?? ''} ${error?.message ?? error}`);
  }
}

async function expectSuccess(name, attempt) {
  try {
    await attempt();
    record(name, true);
  } catch (error) {
    record(name, false, `expected success but got: ${error?.code ?? ''} ${error?.message ?? error}`);
  }
}

/** One full, self-consistent row per tenant-owned parent/child table used in
 * this proof, all belonging to a single tenant. Built with Prisma's typed
 * client (not raw SQL) so the "happy path" shape is trustworthy by
 * construction, matching how the real application writes these rows. */
async function buildChain(tenantId, label, sharedUser, periodStart) {
  const branch = await prisma.branch.create({
    data: { tenant_id: tenantId, code: `${label}-BR`, name_ar: 'فرع اختبار' },
  });
  const category = await prisma.category.create({
    data: { tenant_id: tenantId, name_ar: 'تصنيف اختبار' },
  });
  const product = await prisma.product.create({
    data: { tenant_id: tenantId, name_en: `${label} product`, category_id: category.id },
  });
  const variant = await prisma.productVariant.create({
    data: { tenant_id: tenantId, product_id: product.id, sku: `${label}-SKU`, cost_price: 10 },
  });
  const customer = await prisma.customer.create({ data: { tenant_id: tenantId } });
  const supplier = await prisma.supplier.create({
    data: { tenant_id: tenantId, name: `${label} supplier`, alias_names: [] },
  });
  const posTerminal = await prisma.posTerminal.create({
    data: {
      tenant_id: tenantId,
      device_id: crypto.randomUUID(),
      terminal_code: `${label}-TERM`,
      name: `${label} terminal`,
      branch_id: branch.id,
    },
  });
  await prisma.posTerminalEnrollment.create({
    data: {
      tenant_id: tenantId,
      code_hash: `${label}-enroll-hash`,
      branch_id: branch.id,
      created_by: sharedUser.id,
      expires_at: new Date(Date.now() + 3600_000),
    },
  });
  const shift = await prisma.shift.create({
    data: { tenant_id: tenantId, branch_id: branch.id, opened_by: sharedUser.id },
  });
  const inventoryStock = await prisma.inventoryStock.create({
    data: { tenant_id: tenantId, branch_id: branch.id, variant_id: variant.id, qty_on_hand: 5 },
  });
  // sync_id left unset so the SalesInvoiceItem AFTER INSERT trigger treats
  // this as a historical/imported invoice and skips the derived-InventoryMovement
  // cascade -- this proof writes rows directly, not through the POS command path.
  const salesInvoice = await prisma.salesInvoice.create({
    data: {
      tenant_id: tenantId,
      invoice_number: `${label}-INV`,
      branch_id: branch.id,
      subtotal: 10,
      tax_amount: 0,
      total: 10,
      payment_method: 'cash',
    },
  });
  const salesInvoiceItem = await prisma.salesInvoiceItem.create({
    data: {
      tenant_id: tenantId,
      sales_invoice_id: salesInvoice.id,
      variant_id: variant.id,
      qty: 1,
      unit_price: 10,
      unit_cost: 10,
    },
  });
  // status 'voided' so the ReturnItem AFTER INSERT triggers (inventory +
  // cost movement cascades) no-op -- this proof is not exercising the
  // accounting ledger, only the composite foreign keys.
  const returnRecord = await prisma.return.create({
    data: {
      tenant_id: tenantId,
      original_invoice_id: salesInvoice.id,
      branch_id: branch.id,
      return_invoice_number: `${label}-RET`,
      status: 'voided',
    },
  });
  const returnItem = await prisma.returnItem.create({
    data: {
      tenant_id: tenantId,
      return_id: returnRecord.id,
      sales_invoice_item_id: salesInvoiceItem.id,
      variant_id: variant.id,
      qty: 1,
      unit_price: 10,
      unit_cost: 10,
      unit_tax: 0,
    },
  });
  const purchaseInvoice = await prisma.purchaseInvoice.create({
    data: { tenant_id: tenantId, supplier_id: supplier.id, branch_id: branch.id, subtotal: 10, total: 10 },
  });
  const purchaseInvoiceItem = await prisma.purchaseInvoiceItem.create({
    data: { tenant_id: tenantId, purchase_invoice_id: purchaseInvoice.id, variant_id: variant.id, qty: 1, unit_cost: 10 },
  });
  const supplierReturn = await prisma.supplierReturn.create({
    data: {
      tenant_id: tenantId,
      purchase_invoice_id: purchaseInvoice.id,
      supplier_id: supplier.id,
      branch_id: branch.id,
      return_number: `${label}-SR`,
      idempotency_key: `${label}-sr-idem`,
      command_fingerprint: label.padEnd(64, '0'),
      reason: 'constraint proof',
      credit_total: 1,
      inventory_value_removed: 1,
      purchase_price_variance: 0,
      occurred_at: new Date(),
    },
  });
  const supplierReturnItem = await prisma.supplierReturnItem.create({
    data: {
      tenant_id: tenantId,
      supplier_return_id: supplierReturn.id,
      purchase_invoice_item_id: purchaseInvoiceItem.id,
      variant_id: variant.id,
      qty: 1,
      credit_unit_cost: 1,
      credit_total: 1,
      inventory_unit_cost: 1,
      inventory_value_removed: 1,
      purchase_price_variance: 0,
    },
  });
  const transfer = await prisma.transfer.create({
    data: { tenant_id: tenantId, from_branch_id: branch.id, to_branch_id: branch.id, transfer_number: `${label}-TR` },
  });
  const transferItem = await prisma.transferItem.create({
    data: { tenant_id: tenantId, transfer_id: transfer.id, variant_id: variant.id, qty: 1 },
  });
  await prisma.transferCommand.create({
    data: {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      transfer_id: transfer.id,
      command_type: 'ship',
      idempotency_key: `${label}-cmd-idem`,
      command_fingerprint: label.padEnd(64, '0'),
      result_status: 'ok',
    },
  });
  const transferTransitMovement = await prisma.transferTransitMovement.create({
    data: {
      tenant_id: tenantId,
      transfer_id: transfer.id,
      transfer_item_id: transferItem.id,
      variant_id: variant.id,
      movement_type: 'shipped',
      quantity_delta: 1,
      in_transit_after: 1,
      idempotency_key: `${label}-transit-idem`,
      occurred_at: new Date(),
    },
  });
  const periodEndExclusive = new Date(periodStart.getTime() + 31 * 86_400_000);
  const sellerCommissionPeriod = await prisma.sellerCommissionPeriod.create({
    data: {
      tenant_id: tenantId,
      period_start: periodStart,
      period_end_exclusive: periodEndExclusive,
      period_length_days: 31,
      default_rate: 1,
      default_bonus: 0,
      closed_by: sharedUser.id,
    },
  });
  await prisma.sellerCommissionPeriodRow.create({
    data: {
      tenant_id: tenantId,
      period_id: sellerCommissionPeriod.id,
      seller_id: sharedUser.id,
      seller_name: 'seller',
      invoice_count: 0,
      gross_sales_before_tax: 0,
      return_count: 0,
      returns_before_tax: 0,
      net_sales_before_tax: 0,
      commission_rate: 0,
      percentage_commission: 0,
      target_achieved: false,
      target_bonus: 0,
      estimated_total: 0,
    },
  });
  const inventoryMovement = await prisma.inventoryMovement.create({
    data: {
      tenant_id: tenantId,
      branch_id: branch.id,
      variant_id: variant.id,
      movement_type: 'adjustment',
      on_hand_delta: 1,
      reserved_delta: 0,
      on_hand_after: 1,
      reserved_after: 0,
      reference_type: 'Manual',
      reference_id: `${label}-movement`,
      idempotency_key: `${label}-movement-idem`,
      occurred_at: new Date(),
    },
  });
  const inventoryCostMovement = await prisma.inventoryCostMovement.create({
    data: {
      tenant_id: tenantId,
      variant_id: variant.id,
      branch_id: branch.id,
      movement_type: 'adjustment',
      quantity_delta: 1,
      global_quantity_before: 0,
      global_quantity_after: 1,
      unit_cost: 1,
      cost_before: 1,
      cost_after: 1,
      inventory_value_before: 0,
      movement_value: 1,
      inventory_value_after: 1,
      reference_type: 'Manual',
      reference_id: `${label}-cost-movement`,
      idempotency_key: `${label}-cost-movement-idem`,
      occurred_at: new Date(),
      purchase_invoice_id: purchaseInvoice.id,
      purchase_invoice_item_id: purchaseInvoiceItem.id,
      supplier_return_id: supplierReturn.id,
      supplier_return_item_id: supplierReturnItem.id,
    },
  });
  const offerSuggestion = await prisma.offerSuggestion.create({
    data: {
      tenant_id: tenantId,
      variant_id: variant.id,
      branch_id: branch.id,
      days_unsold: 1,
      current_price: 1,
      suggested_price: 1,
      min_allowed_price: 1,
    },
  });

  return {
    branch, category, product, variant, customer, supplier, posTerminal, shift, inventoryStock,
    salesInvoice, salesInvoiceItem, returnRecord, returnItem, purchaseInvoice, purchaseInvoiceItem,
    supplierReturn, supplierReturnItem, transfer, transferItem, transferTransitMovement,
    sellerCommissionPeriod, inventoryMovement, inventoryCostMovement, offerSuggestion,
  };
}

/** Every composite same-tenant foreign key added by this WP: {name, table,
 * data(chainA, chainB) -> the create() payload for a row belonging to tenant
 * A whose named FK column is redirected to tenant B's row}. */
function foreignKeyCases(chainA, chainB) {
  return [
    { table: 'inventoryStock', name: 'InventoryStock.branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, branch_id: chainB.branch.id, variant_id: chainA.variant.id, qty_on_hand: 1 }) },
    { table: 'inventoryStock', name: 'InventoryStock.variant_id -> ProductVariant', data: () => ({ tenant_id: chainA.tenant, branch_id: chainA.branch.id, variant_id: chainB.variant.id, qty_on_hand: 1 }) },
    { table: 'inventoryMovement', name: 'InventoryMovement.branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, branch_id: chainB.branch.id, variant_id: chainA.variant.id, movement_type: 'adjustment', on_hand_delta: 1, reserved_delta: 0, on_hand_after: 1, reserved_after: 0, reference_type: 'Manual', reference_id: 'x', idempotency_key: `${chainA.label}-fk-im-branch`, occurred_at: new Date() }) },
    { table: 'inventoryMovement', name: 'InventoryMovement.variant_id -> ProductVariant', data: () => ({ tenant_id: chainA.tenant, branch_id: chainA.branch.id, variant_id: chainB.variant.id, movement_type: 'adjustment', on_hand_delta: 1, reserved_delta: 0, on_hand_after: 1, reserved_after: 0, reference_type: 'Manual', reference_id: 'x', idempotency_key: `${chainA.label}-fk-im-variant`, occurred_at: new Date() }) },
    { table: 'inventoryCostMovement', name: 'InventoryCostMovement.branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, branch_id: chainB.branch.id, variant_id: chainA.variant.id, movement_type: 'adjustment', quantity_delta: 1, global_quantity_before: 0, global_quantity_after: 1, unit_cost: 1, cost_before: 1, cost_after: 1, inventory_value_before: 0, movement_value: 1, inventory_value_after: 1, reference_type: 'Manual', reference_id: 'x', idempotency_key: `${chainA.label}-fk-icm-branch`, occurred_at: new Date() }) },
    { table: 'inventoryCostMovement', name: 'InventoryCostMovement.variant_id -> ProductVariant', data: () => ({ tenant_id: chainA.tenant, variant_id: chainB.variant.id, movement_type: 'adjustment', quantity_delta: 1, global_quantity_before: 0, global_quantity_after: 1, unit_cost: 1, cost_before: 1, cost_after: 1, inventory_value_before: 0, movement_value: 1, inventory_value_after: 1, reference_type: 'Manual', reference_id: 'x', idempotency_key: `${chainA.label}-fk-icm-variant`, occurred_at: new Date() }) },
    { table: 'inventoryCostMovement', name: 'InventoryCostMovement.purchase_invoice_id -> PurchaseInvoice', data: () => ({ tenant_id: chainA.tenant, variant_id: chainA.variant.id, movement_type: 'adjustment', quantity_delta: 1, global_quantity_before: 0, global_quantity_after: 1, unit_cost: 1, cost_before: 1, cost_after: 1, inventory_value_before: 0, movement_value: 1, inventory_value_after: 1, reference_type: 'Manual', reference_id: 'x', idempotency_key: `${chainA.label}-fk-icm-pi`, occurred_at: new Date(), purchase_invoice_id: chainB.purchaseInvoice.id }) },
    { table: 'inventoryCostMovement', name: 'InventoryCostMovement.purchase_invoice_item_id -> PurchaseInvoiceItem', data: () => ({ tenant_id: chainA.tenant, variant_id: chainA.variant.id, movement_type: 'adjustment', quantity_delta: 1, global_quantity_before: 0, global_quantity_after: 1, unit_cost: 1, cost_before: 1, cost_after: 1, inventory_value_before: 0, movement_value: 1, inventory_value_after: 1, reference_type: 'Manual', reference_id: 'x', idempotency_key: `${chainA.label}-fk-icm-pii`, occurred_at: new Date(), purchase_invoice_item_id: chainB.purchaseInvoiceItem.id }) },
    { table: 'inventoryCostMovement', name: 'InventoryCostMovement.supplier_return_id -> SupplierReturn', data: () => ({ tenant_id: chainA.tenant, variant_id: chainA.variant.id, movement_type: 'adjustment', quantity_delta: 1, global_quantity_before: 0, global_quantity_after: 1, unit_cost: 1, cost_before: 1, cost_after: 1, inventory_value_before: 0, movement_value: 1, inventory_value_after: 1, reference_type: 'Manual', reference_id: 'x', idempotency_key: `${chainA.label}-fk-icm-sr`, occurred_at: new Date(), supplier_return_id: chainB.supplierReturn.id }) },
    { table: 'inventoryCostMovement', name: 'InventoryCostMovement.supplier_return_item_id -> SupplierReturnItem', data: () => ({ tenant_id: chainA.tenant, variant_id: chainA.variant.id, movement_type: 'adjustment', quantity_delta: 1, global_quantity_before: 0, global_quantity_after: 1, unit_cost: 1, cost_before: 1, cost_after: 1, inventory_value_before: 0, movement_value: 1, inventory_value_after: 1, reference_type: 'Manual', reference_id: 'x', idempotency_key: `${chainA.label}-fk-icm-sri`, occurred_at: new Date(), supplier_return_item_id: chainB.supplierReturnItem.id }) },
    { table: 'salesInvoice', name: 'SalesInvoice.branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, invoice_number: `${chainA.label}-fk-si-branch`, branch_id: chainB.branch.id, subtotal: 1, tax_amount: 0, total: 1, payment_method: 'cash' }) },
    { table: 'salesInvoice', name: 'SalesInvoice.customer_id -> Customer', data: () => ({ tenant_id: chainA.tenant, invoice_number: `${chainA.label}-fk-si-customer`, branch_id: chainA.branch.id, customer_id: chainB.customer.id, subtotal: 1, tax_amount: 0, total: 1, payment_method: 'cash' }) },
    { table: 'salesInvoice', name: 'SalesInvoice.terminal_id -> PosTerminal', data: () => ({ tenant_id: chainA.tenant, invoice_number: `${chainA.label}-fk-si-terminal`, branch_id: chainA.branch.id, terminal_id: chainB.posTerminal.id, subtotal: 1, tax_amount: 0, total: 1, payment_method: 'cash' }) },
    { table: 'salesInvoice', name: 'SalesInvoice.shift_id -> Shift', data: () => ({ tenant_id: chainA.tenant, invoice_number: `${chainA.label}-fk-si-shift`, branch_id: chainA.branch.id, shift_id: chainB.shift.id, subtotal: 1, tax_amount: 0, total: 1, payment_method: 'cash' }) },
    { table: 'posTerminal', name: 'PosTerminal.branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, device_id: crypto.randomUUID(), terminal_code: `${chainA.label}-fk-pt`, name: 'x', branch_id: chainB.branch.id }) },
    { table: 'posTerminalEnrollment', name: 'PosTerminalEnrollment.branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, code_hash: `${chainA.label}-fk-pte`, branch_id: chainB.branch.id, created_by: chainA.sharedUserId, expires_at: new Date(Date.now() + 3600_000) }) },
    { table: 'return', name: 'Return.branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, original_invoice_id: chainA.salesInvoice.id, branch_id: chainB.branch.id, return_invoice_number: `${chainA.label}-fk-ret-branch`, status: 'voided' }) },
    { table: 'return', name: 'Return.original_invoice_id -> SalesInvoice', data: () => ({ tenant_id: chainA.tenant, original_invoice_id: chainB.salesInvoice.id, branch_id: chainA.branch.id, return_invoice_number: `${chainA.label}-fk-ret-orig`, status: 'voided' }) },
    { table: 'return', name: 'Return.new_invoice_id -> SalesInvoice', data: () => ({ tenant_id: chainA.tenant, original_invoice_id: chainA.salesInvoice.id, new_invoice_id: chainB.salesInvoice.id, branch_id: chainA.branch.id, return_invoice_number: `${chainA.label}-fk-ret-new`, status: 'voided' }) },
    { table: 'return', name: 'Return.shift_id -> Shift', data: () => ({ tenant_id: chainA.tenant, original_invoice_id: chainA.salesInvoice.id, shift_id: chainB.shift.id, branch_id: chainA.branch.id, return_invoice_number: `${chainA.label}-fk-ret-shift`, status: 'voided' }) },
    { table: 'salesInvoiceItem', name: 'SalesInvoiceItem.sales_invoice_id -> SalesInvoice', data: () => ({ tenant_id: chainA.tenant, sales_invoice_id: chainB.salesInvoice.id, variant_id: chainA.variant.id, qty: 1, unit_price: 1, unit_cost: 1 }) },
    { table: 'salesInvoiceItem', name: 'SalesInvoiceItem.variant_id -> ProductVariant', data: () => ({ tenant_id: chainA.tenant, sales_invoice_id: chainA.salesInvoice.id, variant_id: chainB.variant.id, qty: 1, unit_price: 1, unit_cost: 1 }) },
    { table: 'returnItem', name: 'ReturnItem.return_id -> Return', data: () => ({ tenant_id: chainA.tenant, return_id: chainB.returnRecord.id, sales_invoice_item_id: chainA.salesInvoiceItem.id, variant_id: chainA.variant.id, qty: 1, unit_price: 1, unit_cost: 1, unit_tax: 0 }) },
    { table: 'returnItem', name: 'ReturnItem.sales_invoice_item_id -> SalesInvoiceItem', data: () => ({ tenant_id: chainA.tenant, return_id: chainA.returnRecord.id, sales_invoice_item_id: chainB.salesInvoiceItem.id, variant_id: chainA.variant.id, qty: 1, unit_price: 1, unit_cost: 1, unit_tax: 0 }) },
    { table: 'returnItem', name: 'ReturnItem.variant_id -> ProductVariant', data: () => ({ tenant_id: chainA.tenant, return_id: chainA.returnRecord.id, sales_invoice_item_id: chainA.salesInvoiceItem.id, variant_id: chainB.variant.id, qty: 1, unit_price: 1, unit_cost: 1, unit_tax: 0 }) },
    { table: 'purchaseInvoice', name: 'PurchaseInvoice.supplier_id -> Supplier', data: () => ({ tenant_id: chainA.tenant, supplier_id: chainB.supplier.id, branch_id: chainA.branch.id, subtotal: 1, total: 1 }) },
    { table: 'purchaseInvoice', name: 'PurchaseInvoice.branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, supplier_id: chainA.supplier.id, branch_id: chainB.branch.id, subtotal: 1, total: 1 }) },
    { table: 'purchaseInvoiceItem', name: 'PurchaseInvoiceItem.purchase_invoice_id -> PurchaseInvoice', data: () => ({ tenant_id: chainA.tenant, purchase_invoice_id: chainB.purchaseInvoice.id, variant_id: chainA.variant.id, qty: 1, unit_cost: 1 }) },
    { table: 'purchaseInvoiceItem', name: 'PurchaseInvoiceItem.variant_id -> ProductVariant', data: () => ({ tenant_id: chainA.tenant, purchase_invoice_id: chainA.purchaseInvoice.id, variant_id: chainB.variant.id, qty: 1, unit_cost: 1 }) },
    { table: 'supplierReturn', name: 'SupplierReturn.purchase_invoice_id -> PurchaseInvoice', data: () => ({ tenant_id: chainA.tenant, purchase_invoice_id: chainB.purchaseInvoice.id, supplier_id: chainA.supplier.id, branch_id: chainA.branch.id, return_number: `${chainA.label}-fk-sr-pi`, idempotency_key: `${chainA.label}-fk-sr-pi-idem`, command_fingerprint: chainA.label.padEnd(64, '0'), reason: 'x', credit_total: 1, inventory_value_removed: 1, purchase_price_variance: 0, occurred_at: new Date() }) },
    { table: 'supplierReturn', name: 'SupplierReturn.supplier_id -> Supplier', data: () => ({ tenant_id: chainA.tenant, purchase_invoice_id: chainA.purchaseInvoice.id, supplier_id: chainB.supplier.id, branch_id: chainA.branch.id, return_number: `${chainA.label}-fk-sr-sup`, idempotency_key: `${chainA.label}-fk-sr-sup-idem`, command_fingerprint: chainA.label.padEnd(64, '0'), reason: 'x', credit_total: 1, inventory_value_removed: 1, purchase_price_variance: 0, occurred_at: new Date() }) },
    { table: 'supplierReturn', name: 'SupplierReturn.branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, purchase_invoice_id: chainA.purchaseInvoice.id, supplier_id: chainA.supplier.id, branch_id: chainB.branch.id, return_number: `${chainA.label}-fk-sr-branch`, idempotency_key: `${chainA.label}-fk-sr-branch-idem`, command_fingerprint: chainA.label.padEnd(64, '0'), reason: 'x', credit_total: 1, inventory_value_removed: 1, purchase_price_variance: 0, occurred_at: new Date() }) },
    { table: 'supplierReturnItem', name: 'SupplierReturnItem.supplier_return_id -> SupplierReturn', data: () => ({ tenant_id: chainA.tenant, supplier_return_id: chainB.supplierReturn.id, purchase_invoice_item_id: chainA.purchaseInvoiceItem.id, variant_id: chainA.variant.id, qty: 1, credit_unit_cost: 1, credit_total: 1, inventory_unit_cost: 1, inventory_value_removed: 1, purchase_price_variance: 0 }) },
    { table: 'supplierReturnItem', name: 'SupplierReturnItem.purchase_invoice_item_id -> PurchaseInvoiceItem', data: () => ({ tenant_id: chainA.tenant, supplier_return_id: chainA.supplierReturn.id, purchase_invoice_item_id: chainB.purchaseInvoiceItem.id, variant_id: chainA.variant.id, qty: 1, credit_unit_cost: 1, credit_total: 1, inventory_unit_cost: 1, inventory_value_removed: 1, purchase_price_variance: 0 }) },
    { table: 'supplierReturnItem', name: 'SupplierReturnItem.variant_id -> ProductVariant', data: () => ({ tenant_id: chainA.tenant, supplier_return_id: chainA.supplierReturn.id, purchase_invoice_item_id: chainA.purchaseInvoiceItem.id, variant_id: chainB.variant.id, qty: 1, credit_unit_cost: 1, credit_total: 1, inventory_unit_cost: 1, inventory_value_removed: 1, purchase_price_variance: 0 }) },
    { table: 'transfer', name: 'Transfer.from_branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, from_branch_id: chainB.branch.id, to_branch_id: chainA.branch.id, transfer_number: `${chainA.label}-fk-tr-from` }) },
    { table: 'transfer', name: 'Transfer.to_branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, from_branch_id: chainA.branch.id, to_branch_id: chainB.branch.id, transfer_number: `${chainA.label}-fk-tr-to` }) },
    { table: 'transferItem', name: 'TransferItem.transfer_id -> Transfer', data: () => ({ tenant_id: chainA.tenant, transfer_id: chainB.transfer.id, variant_id: chainA.variant.id, qty: 1 }) },
    { table: 'transferItem', name: 'TransferItem.variant_id -> ProductVariant', data: () => ({ tenant_id: chainA.tenant, transfer_id: chainA.transfer.id, variant_id: chainB.variant.id, qty: 1 }) },
    { table: 'transferCommand', name: 'TransferCommand.transfer_id -> Transfer', data: () => ({ id: crypto.randomUUID(), tenant_id: chainA.tenant, transfer_id: chainB.transfer.id, command_type: 'ship', idempotency_key: `${chainA.label}-fk-tc-idem`, command_fingerprint: chainA.label.padEnd(64, '0'), result_status: 'ok' }) },
    { table: 'transferTransitMovement', name: 'TransferTransitMovement.transfer_id -> Transfer', data: () => ({ tenant_id: chainA.tenant, transfer_id: chainB.transfer.id, transfer_item_id: chainA.transferItem.id, variant_id: chainA.variant.id, movement_type: 'shipped', quantity_delta: 1, in_transit_after: 1, idempotency_key: `${chainA.label}-fk-ttm-transfer-idem`, occurred_at: new Date() }) },
    { table: 'transferTransitMovement', name: 'TransferTransitMovement.transfer_item_id -> TransferItem', data: () => ({ tenant_id: chainA.tenant, transfer_id: chainA.transfer.id, transfer_item_id: chainB.transferItem.id, variant_id: chainA.variant.id, movement_type: 'shipped', quantity_delta: 1, in_transit_after: 1, idempotency_key: `${chainA.label}-fk-ttm-item-idem`, occurred_at: new Date() }) },
    { table: 'transferTransitMovement', name: 'TransferTransitMovement.variant_id -> ProductVariant', data: () => ({ tenant_id: chainA.tenant, transfer_id: chainA.transfer.id, transfer_item_id: chainA.transferItem.id, variant_id: chainB.variant.id, movement_type: 'shipped', quantity_delta: 1, in_transit_after: 1, idempotency_key: `${chainA.label}-fk-ttm-variant-idem`, occurred_at: new Date() }) },
    { table: 'offerSuggestion', name: 'OfferSuggestion.variant_id -> ProductVariant', data: () => ({ tenant_id: chainA.tenant, variant_id: chainB.variant.id, branch_id: chainA.branch.id, days_unsold: 1, current_price: 1, suggested_price: 1, min_allowed_price: 1 }) },
    { table: 'offerSuggestion', name: 'OfferSuggestion.branch_id -> Branch', data: () => ({ tenant_id: chainA.tenant, variant_id: chainA.variant.id, branch_id: chainB.branch.id, days_unsold: 1, current_price: 1, suggested_price: 1, min_allowed_price: 1 }) },
    { table: 'product', name: 'Product.category_id -> Category', data: () => ({ tenant_id: chainA.tenant, name_en: `${chainA.label}-fk-product`, category_id: chainB.category.id }) },
    { table: 'productVariant', name: 'ProductVariant.product_id -> Product', data: () => ({ tenant_id: chainA.tenant, product_id: chainB.product.id, sku: `${chainA.label}-fk-variant`, cost_price: 1 }) },
    { table: 'sellerCommissionPeriodRow', name: 'SellerCommissionPeriodRow.period_id -> SellerCommissionPeriod', data: () => ({ tenant_id: chainA.tenant, period_id: chainB.sellerCommissionPeriod.id, seller_id: chainA.secondSharedUserId, seller_name: 'x', invoice_count: 0, gross_sales_before_tax: 0, return_count: 0, returns_before_tax: 0, net_sales_before_tax: 0, commission_rate: 0, percentage_commission: 0, target_achieved: false, target_bonus: 0, estimated_total: 0 }) },
  ];
}

/** Every tenant-scoped uniqueness constraint added by this WP. */
function uniquenessCases(chainA, chainB) {
  return [
    { table: 'branch', name: 'Branch (tenant_id, code)', valueA: () => ({ code: `${chainA.label}-dup-code` }), rowA: () => ({ tenant_id: chainA.tenant, name_ar: 'x' }), rowB: () => ({ tenant_id: chainB.tenant, name_ar: 'x' }) },
    { table: 'product', name: 'Product (tenant_id, sku_base)', valueA: () => ({ sku_base: `${chainA.label}-dup-skubase` }), rowA: () => ({ tenant_id: chainA.tenant, name_en: 'x' }), rowB: () => ({ tenant_id: chainB.tenant, name_en: 'x' }) },
    { table: 'productVariant', name: 'ProductVariant (tenant_id, sku)', valueA: () => ({ sku: `${chainA.label}-dup-sku` }), rowA: () => ({ tenant_id: chainA.tenant, product_id: chainA.product.id, cost_price: 1 }), rowB: () => ({ tenant_id: chainB.tenant, product_id: chainB.product.id, cost_price: 1 }) },
    { table: 'productVariant', name: 'ProductVariant (tenant_id, barcode_internal)', valueA: () => ({ barcode_internal: `${chainA.label}-dup-barcode` }), rowA: () => ({ tenant_id: chainA.tenant, product_id: chainA.product.id, cost_price: 1, sku: `${chainA.label}-barcode-dup-a-${crypto.randomUUID()}` }), rowB: () => ({ tenant_id: chainB.tenant, product_id: chainB.product.id, cost_price: 1, sku: `${chainA.label}-barcode-dup-b-${crypto.randomUUID()}` }) },
    { table: 'customer', name: 'Customer (tenant_id, phone)', valueA: () => ({ phone: `${chainA.label}-dup-phone` }), rowA: () => ({ tenant_id: chainA.tenant }), rowB: () => ({ tenant_id: chainB.tenant }) },
    { table: 'posTerminal', name: 'PosTerminal (tenant_id, terminal_code)', valueA: () => ({ terminal_code: `${chainA.label}-dup-term` }), rowA: () => ({ tenant_id: chainA.tenant, device_id: crypto.randomUUID(), name: 'x', branch_id: chainA.branch.id }), rowB: () => ({ tenant_id: chainB.tenant, device_id: crypto.randomUUID(), name: 'x', branch_id: chainB.branch.id }) },
    { table: 'salesInvoice', name: 'SalesInvoice (tenant_id, invoice_number)', valueA: () => ({ invoice_number: `${chainA.label}-dup-inv` }), rowA: () => ({ tenant_id: chainA.tenant, branch_id: chainA.branch.id, subtotal: 1, tax_amount: 0, total: 1, payment_method: 'cash' }), rowB: () => ({ tenant_id: chainB.tenant, branch_id: chainB.branch.id, subtotal: 1, tax_amount: 0, total: 1, payment_method: 'cash' }) },
    { table: 'return', name: 'Return (tenant_id, return_invoice_number)', valueA: () => ({ return_invoice_number: `${chainA.label}-dup-ret` }), rowA: () => ({ tenant_id: chainA.tenant, original_invoice_id: chainA.salesInvoice.id, branch_id: chainA.branch.id, status: 'voided' }), rowB: () => ({ tenant_id: chainB.tenant, original_invoice_id: chainB.salesInvoice.id, branch_id: chainB.branch.id, status: 'voided' }) },
    { table: 'supplierReturn', name: 'SupplierReturn (tenant_id, return_number)', valueA: () => ({ return_number: `${chainA.label}-dup-sr` }), rowA: () => ({ tenant_id: chainA.tenant, purchase_invoice_id: chainA.purchaseInvoice.id, supplier_id: chainA.supplier.id, branch_id: chainA.branch.id, idempotency_key: `${chainA.label}-dup-sr-idem-a`, command_fingerprint: chainA.label.padEnd(64, '0'), reason: 'x', credit_total: 1, inventory_value_removed: 1, purchase_price_variance: 0, occurred_at: new Date() }), rowB: () => ({ tenant_id: chainB.tenant, purchase_invoice_id: chainB.purchaseInvoice.id, supplier_id: chainB.supplier.id, branch_id: chainB.branch.id, idempotency_key: `${chainA.label}-dup-sr-idem-b`, command_fingerprint: chainA.label.padEnd(64, '0'), reason: 'x', credit_total: 1, inventory_value_removed: 1, purchase_price_variance: 0, occurred_at: new Date() }) },
    { table: 'transfer', name: 'Transfer (tenant_id, transfer_number)', valueA: () => ({ transfer_number: `${chainA.label}-dup-tr` }), rowA: () => ({ tenant_id: chainA.tenant, from_branch_id: chainA.branch.id, to_branch_id: chainA.branch.id }), rowB: () => ({ tenant_id: chainB.tenant, from_branch_id: chainB.branch.id, to_branch_id: chainB.branch.id }) },
    // Uses dates distinct from either chain's buildChain() period so this
    // case's own two inserts are the only source of truth for the assertion
    // (chainA/chainB already used different period windows from each other,
    // which separately proves the composite key isn't accidentally global).
    { table: 'sellerCommissionPeriod', name: 'SellerCommissionPeriod (tenant_id, period_start, period_end_exclusive)', valueA: () => ({ period_start: new Date('2030-01-01'), period_end_exclusive: new Date('2030-02-01') }), rowA: () => ({ tenant_id: chainA.tenant, period_length_days: 31, default_rate: 1, default_bonus: 0, closed_by: chainA.sharedUserId }), rowB: () => ({ tenant_id: chainB.tenant, period_length_days: 31, default_rate: 1, default_bonus: 0, closed_by: chainB.sharedUserId }) },
  ];
}

async function main() {
  const sharedUser = await prisma.user.create({
    data: { name: 'constraint-proof', password_hash: 'not-a-real-hash', role: 'owner' },
  });
  // A second, otherwise-unused User: the SellerCommissionPeriodRow FK case
  // below targets chain B's own period with a foreign tenant-A row, and
  // chain B's buildChain() already used sharedUser as (period_id, seller_id)
  // for its own row -- reusing sharedUser there would collide on the
  // composite primary key before the foreign key is ever evaluated.
  const secondSharedUser = await prisma.user.create({
    data: { name: 'constraint-proof-2', password_hash: 'not-a-real-hash', role: 'owner' },
  });

  const tenantA = await prisma.tenant.create({ data: { name: 'MT-MIG-006 proof tenant A' } });
  const tenantB = await prisma.tenant.create({ data: { name: 'MT-MIG-006 proof tenant B' } });

  process.stdout.write('Building tenant A fixture chain...\n');
  const rawChainA = await buildChain(tenantA.id, 'TENANT-A', sharedUser, new Date('2026-01-01'));
  process.stdout.write('Building tenant B fixture chain...\n');
  const rawChainB = await buildChain(tenantB.id, 'TENANT-B', sharedUser, new Date('2026-06-01'));

  const chainA = { ...rawChainA, tenant: tenantA.id, label: 'TENANT-A', sharedUserId: sharedUser.id, secondSharedUserId: secondSharedUser.id };
  const chainB = { ...rawChainB, tenant: tenantB.id, label: 'TENANT-B', sharedUserId: sharedUser.id, secondSharedUserId: secondSharedUser.id };

  process.stdout.write('\n-- Composite same-tenant foreign keys: cross-tenant reference must be rejected --\n');
  for (const testCase of foreignKeyCases(chainA, chainB)) {
    await expectForeignKeyViolation(testCase.name, () => prisma[testCase.table].create({ data: testCase.data() }));
  }

  process.stdout.write('\n-- Tenant-scoped uniqueness: duplicate within a tenant must be rejected, same value across tenants must be allowed --\n');
  for (const testCase of uniquenessCases(chainA, chainB)) {
    const value = testCase.valueA();
    // Establish the first row under tenant A with this value -- not itself
    // an assertion, just the fixture the next two checks depend on.
    await prisma[testCase.table].create({ data: { ...testCase.rowA(), ...value } });
    await expectUniqueViolation(
      `${testCase.name}: duplicate within tenant A rejected`,
      () => prisma[testCase.table].create({ data: { ...testCase.rowA(), ...value } }),
    );
    await expectSuccess(
      `${testCase.name}: same value under tenant B allowed`,
      () => prisma[testCase.table].create({ data: { ...testCase.rowB(), ...value } }),
    );
  }

  process.stdout.write(
    `\n${JSON.stringify({
      suite: 'verify-tenant-constraints',
      total: results.length,
      passed: results.length - failed,
      failed,
    })}\n`,
  )

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
