-- WP-007 Phase B (MT-MIG-006): tenant-scoped uniqueness for "PosTerminal"("terminal_code") -- was global.
-- Pre-migration validation: zero duplicate (tenant_id, terminal_code)
-- groups under the new scope (today's single-tenant data already satisfied
-- the old global constraint, so this is expected to be a no-op guard).
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM (
    SELECT "tenant_id", "terminal_code" FROM "PosTerminal"
    WHERE "terminal_code" IS NOT NULL
    GROUP BY "tenant_id", "terminal_code"
    HAVING count(*) > 1
  ) dup;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % duplicate (tenant_id, terminal_code) group(s) in "PosTerminal".', violating;
  END IF;
END $$;

DROP INDEX "PosTerminal_terminal_code_key";
CREATE UNIQUE INDEX "PosTerminal_tenant_id_terminal_code_key" ON "PosTerminal"("tenant_id", "terminal_code");
