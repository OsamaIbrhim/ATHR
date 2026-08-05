-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "SalesInvoice"."shift_id" -> "Shift" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "SalesInvoice".tenant_id
-- differs from the referenced "Shift" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "SalesInvoice" c
  JOIN "Shift" p ON p."id" = c."shift_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id" AND c."shift_id" IS NOT NULL;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "SalesInvoice" reference a "Shift" row in a different tenant.', violating;
  END IF;
END $$;

-- Plain "ON DELETE SET NULL" on a composite FK would null out BOTH columns,
-- including tenant_id -- which is NOT NULL as of this WP. PostgreSQL 15+'s
-- column-scoped SET NULL (shift_id) nulls only the business column,
-- preserving the pre-existing behavior.
ALTER TABLE "SalesInvoice" DROP CONSTRAINT "SalesInvoice_shift_id_fkey";
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_tenant_id_shift_id_fkey" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "Shift"("tenant_id", "id") ON DELETE SET NULL ("shift_id") ON UPDATE CASCADE;
