-- WP-007 Phase B (MT-MIG-006): tenant-scoped uniqueness for "SupplierReturn"("return_number") -- was global.
-- Pre-migration validation: zero duplicate (tenant_id, return_number)
-- groups under the new scope (today's single-tenant data already satisfied
-- the old global constraint, so this is expected to be a no-op guard).
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM (
    SELECT "tenant_id", "return_number" FROM "SupplierReturn"
    WHERE "return_number" IS NOT NULL
    GROUP BY "tenant_id", "return_number"
    HAVING count(*) > 1
  ) dup;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % duplicate (tenant_id, return_number) group(s) in "SupplierReturn".', violating;
  END IF;
END $$;

DROP INDEX "SupplierReturn_return_number_key";
CREATE UNIQUE INDEX "SupplierReturn_tenant_id_return_number_key" ON "SupplierReturn"("tenant_id", "return_number");
