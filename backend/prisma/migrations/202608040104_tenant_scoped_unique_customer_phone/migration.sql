-- WP-007 Phase B (MT-MIG-006): tenant-scoped uniqueness for "Customer"("phone") -- was global.
-- Pre-migration validation: zero duplicate (tenant_id, phone)
-- groups under the new scope (today's single-tenant data already satisfied
-- the old global constraint, so this is expected to be a no-op guard).
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM (
    SELECT "tenant_id", "phone" FROM "Customer"
    WHERE "phone" IS NOT NULL
    GROUP BY "tenant_id", "phone"
    HAVING count(*) > 1
  ) dup;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % duplicate (tenant_id, phone) group(s) in "Customer".', violating;
  END IF;
END $$;

DROP INDEX "Customer_phone_key";
CREATE UNIQUE INDEX "Customer_tenant_id_phone_key" ON "Customer"("tenant_id", "phone");
