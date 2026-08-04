-- WP-007 Phase B (MT-MIG-006): tenant-scoped uniqueness for "Transfer"("transfer_number") -- was global.
-- Pre-migration validation: zero duplicate (tenant_id, transfer_number)
-- groups under the new scope (today's single-tenant data already satisfied
-- the old global constraint, so this is expected to be a no-op guard).
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM (
    SELECT "tenant_id", "transfer_number" FROM "Transfer"
    WHERE "transfer_number" IS NOT NULL
    GROUP BY "tenant_id", "transfer_number"
    HAVING count(*) > 1
  ) dup;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % duplicate (tenant_id, transfer_number) group(s) in "Transfer".', violating;
  END IF;
END $$;

DROP INDEX "Transfer_transfer_number_key";
CREATE UNIQUE INDEX "Transfer_tenant_id_transfer_number_key" ON "Transfer"("tenant_id", "transfer_number");
