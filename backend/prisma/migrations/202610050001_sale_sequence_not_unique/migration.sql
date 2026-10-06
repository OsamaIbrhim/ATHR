-- W3: a POS sale is never refused. A till that was wiped and re-enrolled can send a
-- terminal sequence an earlier sale already used; that sale is stored under a distinct
-- invoice number (INVOICE_NUMBER_REASSIGNED) instead of failing on this unique index.
-- Idempotency is carried by SalesInvoice.sync_id, which stays unique.
DROP INDEX "SalesInvoice_terminal_id_terminal_sequence_key";

CREATE INDEX "SalesInvoice_terminal_id_terminal_sequence_idx" ON "SalesInvoice"("terminal_id", "terminal_sequence");
