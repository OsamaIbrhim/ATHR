-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "SupplierReturn"."purchase_invoice_id" -> "PurchaseInvoice" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "SupplierReturn".tenant_id
-- differs from the referenced "PurchaseInvoice" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "SupplierReturn" c
  JOIN "PurchaseInvoice" p ON p."id" = c."purchase_invoice_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "SupplierReturn" reference a "PurchaseInvoice" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "SupplierReturn" DROP CONSTRAINT "SupplierReturn_purchase_invoice_id_fkey";
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_tenant_id_purchase_invoice_id_fkey" FOREIGN KEY ("tenant_id", "purchase_invoice_id") REFERENCES "PurchaseInvoice"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
