-- WP-007 Phase B (MT-MIG-006): tenant-scoped uniqueness for "Branch"("code") -- was global.
-- Pre-migration validation: zero duplicate (tenant_id, code)
-- groups under the new scope (today's single-tenant data already satisfied
-- the old global constraint, so this is expected to be a no-op guard).
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM (
    SELECT "tenant_id", "code" FROM "Branch"
    WHERE "code" IS NOT NULL
    GROUP BY "tenant_id", "code"
    HAVING count(*) > 1
  ) dup;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % duplicate (tenant_id, code) group(s) in "Branch".', violating;
  END IF;
END $$;

DROP INDEX "Branch_code_key";
CREATE UNIQUE INDEX "Branch_tenant_id_code_key" ON "Branch"("tenant_id", "code");
