-- WP-009 Phase A, PR1 -- InventoryStock/InventoryMovement/InventoryCostMovement
-- warehouse_id backfill.
--
-- Depends on 202608220002 (every Branch now maps to a Location with at
-- least one default Warehouse). Still not enough on its own: nothing in the
-- schema stops a Location from having MORE than one default Warehouse
-- (measured zero such cases today, but not schema-guaranteed), and picking
-- one arbitrarily among several is exactly the silent-assignment failure
-- CLAUDE.md §6 forbids. That case is checked HERE, as an explicit pre-check
-- that runs and fails BEFORE the backfill UPDATE below -- not after. An
-- `UPDATE ... FROM "Warehouse" w WHERE w.is_default` join does not error and
-- does not fan out when w matches more than one row per target; Postgres
-- just applies the update using whichever match it processes, silently. A
-- post-check would report a fully "resolved" InventoryStock table sitting on
-- top of an arbitrary, unrecorded choice. Checking first, with a scalar
-- subquery that Postgres itself refuses to evaluate against more than one
-- row, is the only version of this guard that cannot pass by accident.

-- Pre-check: no Branch may resolve to more than one default Warehouse via
-- its Location.
DO $$
DECLARE
  offending TEXT;
BEGIN
  SELECT string_agg(
    format('branch %s (default warehouses: %s)', t.branch_id, t.warehouse_ids),
    '; '
  )
  INTO offending
  FROM (
    SELECT
      b."id" AS branch_id,
      string_agg(w."id"::text, ', ') AS warehouse_ids
    FROM "Branch" b
    JOIN "Warehouse" w ON w."location_id" = b."id" AND w."is_default" = true
    GROUP BY b."id"
    HAVING count(w."id") > 1
  ) t;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'WP-009 Phase A warehouse_id backfill precondition failed: a Branch resolves to more than one default Warehouse via its Location -- ambiguous, cannot silently pick one (CLAUDE.md §6). Offending branch(es) and their default Warehouse ids: %.', offending;
  END IF;
END $$;

-- The append-only guards on InventoryMovement/InventoryCostMovement reject
-- any UPDATE outside their normal command path. This migration's UPDATEs
-- only touch the new warehouse_id column; each flag is transaction-local
-- (SET LOCAL) and reverts automatically at commit. InventoryStock carries no
-- such guard (only an unconditional AFTER trigger that logs a SyncChange row
-- on every write, which is expected and harmless here).
SET LOCAL "bold.inventory_ledger_maintenance" = 'on';
SET LOCAL "bold.inventory_cost_ledger_maintenance" = 'on';

-- Backfill: warehouse_id = the branch's (now-confirmed-unique) default
-- Warehouse. The scalar subquery form is deliberate -- see the header
-- comment: Postgres raises "more than one row returned by a subquery used as
-- an expression" if the pre-check above somehow missed a case, instead of
-- silently applying an arbitrary match.
UPDATE "InventoryStock" s
SET "warehouse_id" = (
  SELECT w."id" FROM "Warehouse" w
  WHERE w."location_id" = s."branch_id" AND w."is_default" = true AND w."tenant_id" = s."tenant_id"
)
WHERE s."warehouse_id" IS NULL;

UPDATE "InventoryMovement" m
SET "warehouse_id" = (
  SELECT w."id" FROM "Warehouse" w
  WHERE w."location_id" = m."branch_id" AND w."is_default" = true AND w."tenant_id" = m."tenant_id"
)
WHERE m."warehouse_id" IS NULL;

-- InventoryCostMovement mirrors its existing optional branch_id: populated
-- only where branch_id is populated, left NULL where it already was. No
-- change to costing semantics (global_quantity_before/after untouched).
UPDATE "InventoryCostMovement" c
SET "warehouse_id" = (
  SELECT w."id" FROM "Warehouse" w
  WHERE w."location_id" = c."branch_id" AND w."is_default" = true AND w."tenant_id" = c."tenant_id"
)
WHERE c."warehouse_id" IS NULL AND c."branch_id" IS NOT NULL;

-- Post-step invariant guard: zero NULL warehouse_id remain on InventoryStock
-- or InventoryMovement (both required, unconditionally, after this PR's
-- backfill). InventoryCostMovement is checked for the mirrored invariant:
-- warehouse_id is NULL exactly where branch_id is NULL, nowhere else.
DO $$
DECLARE
  stock_unresolved INT;
  movement_unresolved INT;
  cost_mismatch INT;
BEGIN
  SELECT count(*) INTO stock_unresolved FROM "InventoryStock" WHERE "warehouse_id" IS NULL;
  IF stock_unresolved <> 0 THEN
    RAISE EXCEPTION 'WP-009 Phase A warehouse_id backfill invariant failed: % InventoryStock row(s) still have warehouse_id IS NULL.', stock_unresolved;
  END IF;

  SELECT count(*) INTO movement_unresolved FROM "InventoryMovement" WHERE "warehouse_id" IS NULL;
  IF movement_unresolved <> 0 THEN
    RAISE EXCEPTION 'WP-009 Phase A warehouse_id backfill invariant failed: % InventoryMovement row(s) still have warehouse_id IS NULL.', movement_unresolved;
  END IF;

  SELECT count(*) INTO cost_mismatch
  FROM "InventoryCostMovement"
  WHERE ("warehouse_id" IS NULL) IS DISTINCT FROM ("branch_id" IS NULL);
  IF cost_mismatch <> 0 THEN
    RAISE EXCEPTION 'WP-009 Phase A warehouse_id backfill invariant failed: % InventoryCostMovement row(s) have warehouse_id nullness diverging from branch_id nullness.', cost_mismatch;
  END IF;
END $$;
