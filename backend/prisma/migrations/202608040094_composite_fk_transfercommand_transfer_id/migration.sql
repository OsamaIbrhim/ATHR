-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "TransferCommand"."transfer_id" -> "Transfer" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "TransferCommand".tenant_id
-- differs from the referenced "Transfer" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "TransferCommand" c
  JOIN "Transfer" p ON p."id" = c."transfer_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "TransferCommand" reference a "Transfer" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "TransferCommand" DROP CONSTRAINT "TransferCommand_transfer_id_fkey";
ALTER TABLE "TransferCommand" ADD CONSTRAINT "TransferCommand_tenant_id_transfer_id_fkey" FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "Transfer"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
