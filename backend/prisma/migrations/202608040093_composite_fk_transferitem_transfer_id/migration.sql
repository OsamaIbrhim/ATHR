-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "TransferItem"."transfer_id" -> "Transfer" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "TransferItem".tenant_id
-- differs from the referenced "Transfer" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "TransferItem" c
  JOIN "Transfer" p ON p."id" = c."transfer_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "TransferItem" reference a "Transfer" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "TransferItem" DROP CONSTRAINT "TransferItem_transfer_id_fkey";
ALTER TABLE "TransferItem" ADD CONSTRAINT "TransferItem_tenant_id_transfer_id_fkey" FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "Transfer"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
