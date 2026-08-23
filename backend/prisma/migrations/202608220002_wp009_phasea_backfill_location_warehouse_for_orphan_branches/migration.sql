-- WP-009 Phase A, PR1 -- catch-up backfill.
--
-- Migration 202608020002_add_location_from_branch backfilled a Location (id
-- preserved) and one default Location-linked Warehouse for every Branch that
-- existed AT THAT MOMENT. It was a one-time snapshot, not an invariant:
-- `BranchesRepository.save()` (live behind `POST /branches`) never creates a
-- matching Location/Warehouse, so every Branch created since has neither.
--
-- Measured against the demo database on 2026-08-22: 90 of 92 Branch rows
-- have no Location (confirmed test-fixture pollution from WP-T2/WP-009
-- Phase 0.5 guard drills, per Osama -- treated identically to any other
-- Branch here, not special-cased or skipped; CLAUDE.md §6 forbids a backfill
-- that decides which rows "count"). WP-009 Phase A's own InventoryStock/
-- InventoryMovement/InventoryCostMovement warehouse_id backfill (the next
-- migration in this PR) depends on every Branch resolving to exactly one
-- default Warehouse, so this gap must close first.
--
-- This repeats 202608020002's exact transformation (Location id = Branch
-- id; one default, Location-linked Warehouse) generalized to run per-tenant
-- for every Branch lacking a Location today, instead of that migration's
-- one-time hardcoded-tenant-name shortcut. Fails loud, per-tenant, naming
-- the offending tenant IDs, rather than assuming a single demo tenant.

-- Precondition: every tenant that owns a Location-less Branch must have
-- EXACTLY ONE primary LegalEntity. Nothing in the schema enforces
-- `(tenant_id, is_primary = true)` uniqueness, so this cannot be assumed --
-- CLAUDE.md §6: fail loud and name the tenant, never guess or default-pick.
DO $$
DECLARE
  offending TEXT;
BEGIN
  SELECT string_agg(
    format('tenant %s (primary LegalEntity count=%s, orphan Branch count=%s)',
      t.tenant_id, t.primary_count, t.orphan_branch_count),
    '; '
  )
  INTO offending
  FROM (
    SELECT
      b."tenant_id" AS tenant_id,
      count(DISTINCT le."id") FILTER (WHERE le."is_primary") AS primary_count,
      count(DISTINCT b."id") AS orphan_branch_count
    FROM "Branch" b
    LEFT JOIN "Location" l ON l."id" = b."id"
    LEFT JOIN "LegalEntity" le ON le."tenant_id" = b."tenant_id"
    WHERE l."id" IS NULL
    GROUP BY b."tenant_id"
    HAVING count(DISTINCT le."id") FILTER (WHERE le."is_primary") <> 1
  ) t;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'WP-009 Phase A catch-up backfill precondition failed: cannot resolve a single primary LegalEntity for a tenant that owns a Location-less Branch. Offending tenant(s): %. Resolve the LegalEntity data for these tenants before re-running.', offending;
  END IF;
END $$;

-- Backfill: every Branch without a Location gets exactly one, id preserved,
-- owned by its own tenant's (now-confirmed-unique) primary LegalEntity.
INSERT INTO "Location" ("id", "tenantId", "legal_entity_id", "code", "name_ar", "name_en", "address", "phone", "is_active", "created_at", "updated_at")
SELECT
  b."id",
  b."tenant_id",
  le."id",
  b."code",
  b."name_ar",
  b."name_en",
  b."address",
  b."phone",
  b."is_active",
  b."created_at",
  now()
FROM "Branch" b
JOIN "LegalEntity" le ON le."tenant_id" = b."tenant_id" AND le."is_primary" = true
LEFT JOIN "Location" existing ON existing."id" = b."id"
WHERE existing."id" IS NULL;

-- Backfill: every Location that has no default Warehouse yet gets exactly
-- one. Covers both the Locations just inserted above and, defensively, any
-- pre-existing Location that somehow has none (measured zero today).
-- Deliberately does NOT touch a Location that already has a default
-- Warehouse -- ambiguity among multiple existing defaults is not this
-- migration's concern; it is guarded, separately, by the next migration
-- immediately before it picks one to resolve InventoryStock/Movement rows
-- against.
INSERT INTO "Warehouse" ("id", "tenant_id", "location_id", "name", "is_default", "is_centralized", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  l."tenantId",
  l."id",
  l."name_ar" || ' — Default Warehouse',
  true,
  false,
  now(),
  now()
FROM "Location" l
LEFT JOIN "Warehouse" w ON w."location_id" = l."id" AND w."is_default" = true
WHERE w."id" IS NULL;

-- Post-step invariant guard: every Branch now maps to exactly one Location,
-- and every Location now has at least one default Warehouse.
DO $$
DECLARE
  missing_locations INT;
  locations_without_default_warehouse INT;
BEGIN
  SELECT count(*) INTO missing_locations
  FROM "Branch" b
  LEFT JOIN "Location" l ON l."id" = b."id"
  WHERE l."id" IS NULL;

  IF missing_locations <> 0 THEN
    RAISE EXCEPTION 'WP-009 Phase A catch-up backfill invariant failed: % Branch row(s) still have no corresponding Location row.', missing_locations;
  END IF;

  SELECT count(*) INTO locations_without_default_warehouse
  FROM "Location" l
  LEFT JOIN "Warehouse" w ON w."location_id" = l."id" AND w."is_default" = true
  WHERE w."id" IS NULL;

  IF locations_without_default_warehouse <> 0 THEN
    RAISE EXCEPTION 'WP-009 Phase A catch-up backfill invariant failed: % Location row(s) still have no default Warehouse.', locations_without_default_warehouse;
  END IF;
END $$;
