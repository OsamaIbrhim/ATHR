-- WP-007 Phase B (MT-MIG-006): tenant-scoped uniqueness for "SellerCommissionPeriod"("period_start", "period_end_exclusive") -- was global.
-- Pre-migration validation: zero duplicate (tenant_id, period_start, period_end_exclusive)
-- groups under the new scope (today's single-tenant data already satisfied
-- the old global constraint, so this is expected to be a no-op guard).
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM (
    SELECT "tenant_id", "period_start", "period_end_exclusive" FROM "SellerCommissionPeriod"
    WHERE "period_start" IS NOT NULL AND "period_end_exclusive" IS NOT NULL
    GROUP BY "tenant_id", "period_start", "period_end_exclusive"
    HAVING count(*) > 1
  ) dup;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % duplicate (tenant_id, period_start, period_end_exclusive) group(s) in "SellerCommissionPeriod".', violating;
  END IF;
END $$;

-- Explicit shortened name: the natural "..._tenant_id_period_start_period_end_exclusive_key"
-- name is 70 bytes, over PostgreSQL's 63-byte identifier limit (NAMEDATALEN).
DROP INDEX "SellerCommissionPeriod_period_start_period_end_exclusive_key";
CREATE UNIQUE INDEX "SellerCommissionPeriod_tenant_period_dates_key" ON "SellerCommissionPeriod"("tenant_id", "period_start", "period_end_exclusive");
