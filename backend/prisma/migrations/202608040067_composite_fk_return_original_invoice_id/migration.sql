-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "Return"."original_invoice_id" -> "SalesInvoice" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "Return".tenant_id
-- differs from the referenced "SalesInvoice" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "Return" c
  JOIN "SalesInvoice" p ON p."id" = c."original_invoice_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "Return" reference a "SalesInvoice" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "Return" DROP CONSTRAINT "Return_original_invoice_id_fkey";
ALTER TABLE "Return" ADD CONSTRAINT "Return_tenant_id_original_invoice_id_fkey" FOREIGN KEY ("tenant_id", "original_invoice_id") REFERENCES "SalesInvoice"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
