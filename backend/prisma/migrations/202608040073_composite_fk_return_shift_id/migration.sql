-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "Return"."shift_id" -> "Shift" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "Return".tenant_id
-- differs from the referenced "Shift" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "Return" c
  JOIN "Shift" p ON p."id" = c."shift_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id" AND c."shift_id" IS NOT NULL;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "Return" reference a "Shift" row in a different tenant.', violating;
  END IF;
END $$;

-- Plain "ON DELETE SET NULL" on a composite FK would null out BOTH columns,
-- including tenant_id -- which is NOT NULL as of this WP. PostgreSQL 15+'s
-- column-scoped SET NULL (shift_id) nulls only the business column,
-- preserving the pre-existing behavior.
ALTER TABLE "Return" DROP CONSTRAINT "Return_shift_id_fkey";
ALTER TABLE "Return" ADD CONSTRAINT "Return_tenant_id_shift_id_fkey" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "Shift"("tenant_id", "id") ON DELETE SET NULL ("shift_id") ON UPDATE CASCADE;
