-- WP-007 Phase B (MT-MIG-006) fix-forward: "SyncChange" rows are not only
-- written by application code (already tenant-aware since WP-007 Phase A)
-- but also auto-inserted by pre-existing database triggers
-- (bold_record_catalog_change/bold_record_inventory_change from
-- 20260719202000_incremental_sync_log, bold_emit_*_sync_change from
-- 202607210001_phase5a_price_sync_triggers) whenever a Product,
-- ProductVariant, PricingRule, or InventoryStock row changes. Those trigger
-- functions never set tenant_id (the bug fixed forward in
-- 202608040112_fix_ledger_triggers_tenant_id) -- but that fix only prevents
-- *future* null rows. Any row already inserted by those triggers before
-- this migration set is applied (e.g. by a `prisma:seed` run against an
-- unpatched database) is backfilled here, the same expand/backfill/validate
-- discipline as WP-005 Phase B's original MT-MIG-004 backfill, scoped to
-- this one table because it is the only one populated by an automatic
-- trigger rather than directly by application/seed code.
--
-- kind values are fixed by the trigger definitions themselves:
--   'product'   -> entity_key is Product.id
--   'variant'   -> entity_key is ProductVariant.id
--   'pricing'   -> entity_key is PricingRule.id
--   'inventory' -> entity_key is ProductVariant.id; branch_id is also
--                  already populated directly on the row by both trigger
--                  generations, so branch_id -> Branch.tenant_id is used
--                  (avoids relying on a UUID cast of entity_key that may be
--                  absent for `kind`s introduced later, if ever).
UPDATE "SyncChange" x
SET "tenant_id" = p."tenant_id"
FROM "Product" p
WHERE x."tenant_id" IS NULL
  AND x."kind" = 'product'
  AND p."id" = x."entity_key"::uuid;

UPDATE "SyncChange" x
SET "tenant_id" = v."tenant_id"
FROM "ProductVariant" v
WHERE x."tenant_id" IS NULL
  AND x."kind" = 'variant'
  AND v."id" = x."entity_key"::uuid;

UPDATE "SyncChange" x
SET "tenant_id" = pr."tenant_id"
FROM "PricingRule" pr
WHERE x."tenant_id" IS NULL
  AND x."kind" = 'pricing'
  AND pr."id" = x."entity_key"::uuid;

UPDATE "SyncChange" x
SET "tenant_id" = b."tenant_id"
FROM "Branch" b
WHERE x."tenant_id" IS NULL
  AND x."kind" = 'inventory'
  AND b."id" = x."branch_id";

-- Fail loud rather than let the next migration's precondition check report
-- a bare count with no way to see which rows or why.
DO $$
DECLARE
  remaining INT;
BEGIN
  SELECT count(*) INTO remaining FROM "SyncChange" WHERE "tenant_id" IS NULL;
  IF remaining <> 0 THEN
    RAISE EXCEPTION
      'MT-MIG-006 backfill failed: % row(s) in "SyncChange" still have tenant_id IS NULL after backfill (kinds present: %).',
      remaining,
      (SELECT string_agg(DISTINCT "kind", ', ') FROM "SyncChange" WHERE "tenant_id" IS NULL);
  END IF;
END $$;
