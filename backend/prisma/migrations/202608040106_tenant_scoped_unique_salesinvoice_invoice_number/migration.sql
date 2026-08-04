-- WP-007 Phase B (MT-MIG-006): tenant-scoped uniqueness for "SalesInvoice"("invoice_number") -- was global.
-- Pre-migration validation: zero duplicate (tenant_id, invoice_number)
-- groups under the new scope (today's single-tenant data already satisfied
-- the old global constraint, so this is expected to be a no-op guard).
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM (
    SELECT "tenant_id", "invoice_number" FROM "SalesInvoice"
    WHERE "invoice_number" IS NOT NULL
    GROUP BY "tenant_id", "invoice_number"
    HAVING count(*) > 1
  ) dup;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % duplicate (tenant_id, invoice_number) group(s) in "SalesInvoice".', violating;
  END IF;
END $$;

DROP INDEX "SalesInvoice_invoice_number_key";
CREATE UNIQUE INDEX "SalesInvoice_tenant_id_invoice_number_key" ON "SalesInvoice"("tenant_id", "invoice_number");
