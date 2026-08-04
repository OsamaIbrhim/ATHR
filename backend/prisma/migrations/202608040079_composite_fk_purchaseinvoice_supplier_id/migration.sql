-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "PurchaseInvoice"."supplier_id" -> "Supplier" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "PurchaseInvoice".tenant_id
-- differs from the referenced "Supplier" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "PurchaseInvoice" c
  JOIN "Supplier" p ON p."id" = c."supplier_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "PurchaseInvoice" reference a "Supplier" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "PurchaseInvoice" DROP CONSTRAINT "PurchaseInvoice_supplier_id_fkey";
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "Supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
