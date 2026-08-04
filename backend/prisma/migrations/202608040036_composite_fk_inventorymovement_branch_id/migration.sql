-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "InventoryMovement"."branch_id" -> "Branch" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "InventoryMovement".tenant_id
-- differs from the referenced "Branch" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "InventoryMovement" c
  JOIN "Branch" p ON p."id" = c."branch_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "InventoryMovement" reference a "Branch" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "InventoryMovement" DROP CONSTRAINT "InventoryMovement_branch_id_fkey";
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "Branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
