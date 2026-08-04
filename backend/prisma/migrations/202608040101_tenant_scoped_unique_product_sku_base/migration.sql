-- WP-007 Phase B (MT-MIG-006): tenant-scoped uniqueness for "Product"("sku_base") -- was global.
-- Pre-migration validation: zero duplicate (tenant_id, sku_base)
-- groups under the new scope (today's single-tenant data already satisfied
-- the old global constraint, so this is expected to be a no-op guard).
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM (
    SELECT "tenant_id", "sku_base" FROM "Product"
    WHERE "sku_base" IS NOT NULL
    GROUP BY "tenant_id", "sku_base"
    HAVING count(*) > 1
  ) dup;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % duplicate (tenant_id, sku_base) group(s) in "Product".', violating;
  END IF;
END $$;

DROP INDEX "Product_sku_base_key";
CREATE UNIQUE INDEX "Product_tenant_id_sku_base_key" ON "Product"("tenant_id", "sku_base");
