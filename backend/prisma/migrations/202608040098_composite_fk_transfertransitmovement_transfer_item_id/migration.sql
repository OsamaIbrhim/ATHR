-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "TransferTransitMovement"."transfer_item_id" -> "TransferItem" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "TransferTransitMovement".tenant_id
-- differs from the referenced "TransferItem" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "TransferTransitMovement" c
  JOIN "TransferItem" p ON p."id" = c."transfer_item_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "TransferTransitMovement" reference a "TransferItem" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "TransferTransitMovement" DROP CONSTRAINT "TransferTransitMovement_transfer_item_id_fkey";
ALTER TABLE "TransferTransitMovement" ADD CONSTRAINT "TransferTransitMovement_tenant_id_transfer_item_id_fkey" FOREIGN KEY ("tenant_id", "transfer_item_id") REFERENCES "TransferItem"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
