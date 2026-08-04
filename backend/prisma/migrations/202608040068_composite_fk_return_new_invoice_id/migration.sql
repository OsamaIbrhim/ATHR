-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "Return"."new_invoice_id" -> "SalesInvoice" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "Return".tenant_id
-- differs from the referenced "SalesInvoice" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "Return" c
  JOIN "SalesInvoice" p ON p."id" = c."new_invoice_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id" AND c."new_invoice_id" IS NOT NULL;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "Return" reference a "SalesInvoice" row in a different tenant.', violating;
  END IF;
END $$;

-- Plain "ON DELETE SET NULL" on a composite FK would null out BOTH columns,
-- including tenant_id -- which is NOT NULL as of this WP. PostgreSQL 15+'s
-- column-scoped SET NULL (new_invoice_id) nulls only the business column,
-- preserving the pre-existing behavior.
ALTER TABLE "Return" DROP CONSTRAINT "Return_new_invoice_id_fkey";
ALTER TABLE "Return" ADD CONSTRAINT "Return_tenant_id_new_invoice_id_fkey" FOREIGN KEY ("tenant_id", "new_invoice_id") REFERENCES "SalesInvoice"("tenant_id", "id") ON DELETE SET NULL ("new_invoice_id") ON UPDATE CASCADE;
