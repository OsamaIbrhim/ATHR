-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "SellerCommissionPeriodRow"."period_id" -> "SellerCommissionPeriod" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "SellerCommissionPeriodRow".tenant_id
-- differs from the referenced "SellerCommissionPeriod" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "SellerCommissionPeriodRow" c
  JOIN "SellerCommissionPeriod" p ON p."id" = c."period_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "SellerCommissionPeriodRow" reference a "SellerCommissionPeriod" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "SellerCommissionPeriodRow" DROP CONSTRAINT "SellerCommissionPeriodRow_period_id_fkey";
ALTER TABLE "SellerCommissionPeriodRow" ADD CONSTRAINT "SellerCommissionPeriodRow_tenant_id_period_id_fkey" FOREIGN KEY ("tenant_id", "period_id") REFERENCES "SellerCommissionPeriod"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
