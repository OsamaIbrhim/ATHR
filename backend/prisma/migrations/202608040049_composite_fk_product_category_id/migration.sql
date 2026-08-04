-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "Product"."category_id" -> "Category" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "Product".tenant_id
-- differs from the referenced "Category" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "Product" c
  JOIN "Category" p ON p."id" = c."category_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id" AND c."category_id" IS NOT NULL;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "Product" reference a "Category" row in a different tenant.', violating;
  END IF;
END $$;

-- Plain "ON DELETE SET NULL" on a composite FK would null out BOTH columns,
-- including tenant_id -- which is NOT NULL as of this WP. PostgreSQL 15+'s
-- column-scoped SET NULL (category_id) nulls only the business column,
-- preserving the pre-existing "delete a Category, orphan the Product" behavior.
ALTER TABLE "Product" DROP CONSTRAINT "Product_category_id_fkey";
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "Category"("tenant_id", "id") ON DELETE SET NULL ("category_id") ON UPDATE CASCADE;
