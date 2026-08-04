-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "ProductVariant"."product_id" -> "Product" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "ProductVariant".tenant_id
-- differs from the referenced "Product" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "ProductVariant" c
  JOIN "Product" p ON p."id" = c."product_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "ProductVariant" reference a "Product" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_product_id_fkey";
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "Product"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
