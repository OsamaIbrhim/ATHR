-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "Transfer"."from_branch_id" -> "Branch" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "Transfer".tenant_id
-- differs from the referenced "Branch" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "Transfer" c
  JOIN "Branch" p ON p."id" = c."from_branch_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "Transfer" reference a "Branch" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "Transfer" DROP CONSTRAINT "Transfer_from_branch_id_fkey";
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_tenant_id_from_branch_id_fkey" FOREIGN KEY ("tenant_id", "from_branch_id") REFERENCES "Branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
