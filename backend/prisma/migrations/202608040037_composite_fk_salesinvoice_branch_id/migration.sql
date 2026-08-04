-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "SalesInvoice"."branch_id" -> "Branch" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "SalesInvoice".tenant_id
-- differs from the referenced "Branch" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "SalesInvoice" c
  JOIN "Branch" p ON p."id" = c."branch_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "SalesInvoice" reference a "Branch" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "SalesInvoice" DROP CONSTRAINT "SalesInvoice_branch_id_fkey";
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "Branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
