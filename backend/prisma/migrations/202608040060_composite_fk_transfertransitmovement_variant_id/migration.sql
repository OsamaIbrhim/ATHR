-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "TransferTransitMovement"."variant_id" -> "ProductVariant" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "TransferTransitMovement".tenant_id
-- differs from the referenced "ProductVariant" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "TransferTransitMovement" c
  JOIN "ProductVariant" p ON p."id" = c."variant_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "TransferTransitMovement" reference a "ProductVariant" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "TransferTransitMovement" DROP CONSTRAINT "TransferTransitMovement_variant_id_fkey";
ALTER TABLE "TransferTransitMovement" ADD CONSTRAINT "TransferTransitMovement_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
