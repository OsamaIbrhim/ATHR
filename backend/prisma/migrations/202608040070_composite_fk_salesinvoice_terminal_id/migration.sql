-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "SalesInvoice"."terminal_id" -> "PosTerminal" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "SalesInvoice".tenant_id
-- differs from the referenced "PosTerminal" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "SalesInvoice" c
  JOIN "PosTerminal" p ON p."id" = c."terminal_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id" AND c."terminal_id" IS NOT NULL;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "SalesInvoice" reference a "PosTerminal" row in a different tenant.', violating;
  END IF;
END $$;

-- Plain "ON DELETE SET NULL" on a composite FK would null out BOTH columns,
-- including tenant_id -- which is NOT NULL as of this WP. PostgreSQL 15+'s
-- column-scoped SET NULL (terminal_id) nulls only the business column,
-- preserving the pre-existing behavior.
ALTER TABLE "SalesInvoice" DROP CONSTRAINT "SalesInvoice_terminal_id_fkey";
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_tenant_id_terminal_id_fkey" FOREIGN KEY ("tenant_id", "terminal_id") REFERENCES "PosTerminal"("tenant_id", "id") ON DELETE SET NULL ("terminal_id") ON UPDATE CASCADE;
