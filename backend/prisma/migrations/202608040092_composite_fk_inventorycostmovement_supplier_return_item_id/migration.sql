-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "InventoryCostMovement"."supplier_return_item_id" -> "SupplierReturnItem" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "InventoryCostMovement".tenant_id
-- differs from the referenced "SupplierReturnItem" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "InventoryCostMovement" c
  JOIN "SupplierReturnItem" p ON p."id" = c."supplier_return_item_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id" AND c."supplier_return_item_id" IS NOT NULL;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "InventoryCostMovement" reference a "SupplierReturnItem" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "InventoryCostMovement" DROP CONSTRAINT "InventoryCostMovement_supplier_return_item_id_fkey";
ALTER TABLE "InventoryCostMovement" ADD CONSTRAINT "InventoryCostMovement_tenant_id_supplier_return_item_id_fkey" FOREIGN KEY ("tenant_id", "supplier_return_item_id") REFERENCES "SupplierReturnItem"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
