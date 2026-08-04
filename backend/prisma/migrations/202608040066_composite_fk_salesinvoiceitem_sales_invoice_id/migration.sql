-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "SalesInvoiceItem"."sales_invoice_id" -> "SalesInvoice" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "SalesInvoiceItem".tenant_id
-- differs from the referenced "SalesInvoice" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "SalesInvoiceItem" c
  JOIN "SalesInvoice" p ON p."id" = c."sales_invoice_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "SalesInvoiceItem" reference a "SalesInvoice" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "SalesInvoiceItem" DROP CONSTRAINT "SalesInvoiceItem_sales_invoice_id_fkey";
ALTER TABLE "SalesInvoiceItem" ADD CONSTRAINT "SalesInvoiceItem_tenant_id_sales_invoice_id_fkey" FOREIGN KEY ("tenant_id", "sales_invoice_id") REFERENCES "SalesInvoice"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
