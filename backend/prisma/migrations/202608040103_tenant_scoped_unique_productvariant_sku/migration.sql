-- WP-007 Phase B (MT-MIG-006): tenant-scoped uniqueness for "ProductVariant"("sku") -- was global.
-- Pre-migration validation: zero duplicate (tenant_id, sku)
-- groups under the new scope (today's single-tenant data already satisfied
-- the old global constraint, so this is expected to be a no-op guard).
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM (
    SELECT "tenant_id", "sku" FROM "ProductVariant"
    WHERE "sku" IS NOT NULL
    GROUP BY "tenant_id", "sku"
    HAVING count(*) > 1
  ) dup;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % duplicate (tenant_id, sku) group(s) in "ProductVariant".', violating;
  END IF;
END $$;

DROP INDEX "ProductVariant_sku_key";
CREATE UNIQUE INDEX "ProductVariant_tenant_id_sku_key" ON "ProductVariant"("tenant_id", "sku");
