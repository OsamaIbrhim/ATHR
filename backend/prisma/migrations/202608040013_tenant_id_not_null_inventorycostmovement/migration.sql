-- WP-007 Phase B (MT-MIG-006): tenant_id NOT NULL for "InventoryCostMovement".
-- Pre-migration validation: zero rows with tenant_id IS NULL. WP-005 Phase B
-- (MT-MIG-004) already backfilled every row and WP-007 Phase A proved the
-- application never leaves tenant_id unset on new writes, so this is
-- expected to be a no-op guard, not a live risk -- but it must still be
-- proven, not assumed.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating FROM "InventoryCostMovement" WHERE "tenant_id" IS NULL;
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "InventoryCostMovement" have tenant_id IS NULL.', violating;
  END IF;
END $$;

ALTER TABLE "InventoryCostMovement" ALTER COLUMN "tenant_id" SET NOT NULL;
