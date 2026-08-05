-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "ReturnItem"."return_id" -> "Return" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "ReturnItem".tenant_id
-- differs from the referenced "Return" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "ReturnItem" c
  JOIN "Return" p ON p."id" = c."return_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "ReturnItem" reference a "Return" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "ReturnItem" DROP CONSTRAINT "ReturnItem_return_id_fkey";
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_tenant_id_return_id_fkey" FOREIGN KEY ("tenant_id", "return_id") REFERENCES "Return"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
