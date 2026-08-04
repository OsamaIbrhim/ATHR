-- WP-007 Phase B (MT-MIG-006): tenant-scoped uniqueness for "ProductVariant"("barcode_internal") -- was global.
-- Pre-migration validation: zero duplicate (tenant_id, barcode_internal)
-- groups under the new scope (today's single-tenant data already satisfied
-- the old global constraint, so this is expected to be a no-op guard).
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM (
    SELECT "tenant_id", "barcode_internal" FROM "ProductVariant"
    WHERE "barcode_internal" IS NOT NULL
    GROUP BY "tenant_id", "barcode_internal"
    HAVING count(*) > 1
  ) dup;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % duplicate (tenant_id, barcode_internal) group(s) in "ProductVariant".', violating;
  END IF;
END $$;

DROP INDEX "ProductVariant_barcode_internal_key";
CREATE UNIQUE INDEX "ProductVariant_tenant_id_barcode_internal_key" ON "ProductVariant"("tenant_id", "barcode_internal");
