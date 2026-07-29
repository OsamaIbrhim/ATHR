-- SalesService owns the complete acceptance-first sale transaction: it updates
-- InventoryStock and then records one idempotent InventoryMovement per line.
-- The legacy deferred trigger performed the same ledger write a second time at
-- COMMIT, causing the transaction to roll back after the HTTP handler had built
-- an invoice response. Retire that competing writer so stock, invoice, and
-- ledger remain atomic under one explicit transaction boundary.
DROP TRIGGER IF EXISTS "SalesInvoiceItem_inventory_movement"
ON "SalesInvoiceItem";

DROP FUNCTION IF EXISTS "record_sale_inventory_movement"();

COMMENT ON FUNCTION "record_inventory_movement"(
  UUID,
  UUID,
  "InventoryMovementType",
  INTEGER,
  INTEGER,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TIMESTAMP WITHOUT TIME ZONE,
  UUID,
  JSONB
) IS
  'Audits an inventory balance already mutated inside the owning business transaction. Sales are written explicitly by SalesService; returns and transfers retain their semantic database triggers.';
