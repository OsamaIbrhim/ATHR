-- WP-007 Phase B (MT-MIG-006): tenant-scoped uniqueness for "Return"("return_invoice_number") -- was global.
-- Pre-migration validation: zero duplicate (tenant_id, return_invoice_number)
-- groups under the new scope (today's single-tenant data already satisfied
-- the old global constraint, so this is expected to be a no-op guard).
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM (
    SELECT "tenant_id", "return_invoice_number" FROM "Return"
    WHERE "return_invoice_number" IS NOT NULL
    GROUP BY "tenant_id", "return_invoice_number"
    HAVING count(*) > 1
  ) dup;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % duplicate (tenant_id, return_invoice_number) group(s) in "Return".', violating;
  END IF;
END $$;

DROP INDEX "Return_return_invoice_number_key";
CREATE UNIQUE INDEX "Return_tenant_id_return_invoice_number_key" ON "Return"("tenant_id", "return_invoice_number");
