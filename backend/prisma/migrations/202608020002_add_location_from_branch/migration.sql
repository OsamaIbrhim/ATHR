-- WP-005 Phase B, MT-MIG-002 (expand-only): adds Location + Warehouse, then
-- backfills exactly one Location per existing Branch row (preserving
-- Branch.id as Location.id — both are uuid, so no legacy_branch_id mapping
-- column is needed) and exactly one default, Location-linked Warehouse per
-- migrated Location (BR-WHS-202: every selling Location needs a resolvable
-- inventory source). "Branch" itself is left completely untouched.
--
-- Fails loudly (does not silently skip) if the Initial ATHR Demo Tenant or
-- its primary LegalEntity have not been seeded yet — run
-- backend/prisma/seed/initial-tenant-seed.ts before deploying this migration.
DO $$
BEGIN
  IF (SELECT count(*) FROM "Tenant" WHERE name = 'Initial ATHR Demo Tenant') <> 1 THEN
    RAISE EXCEPTION 'MT-MIG-002 precondition failed: expected exactly one "Initial ATHR Demo Tenant" row in "Tenant", found %. Run backend/prisma/seed/initial-tenant-seed.ts first.',
      (SELECT count(*) FROM "Tenant" WHERE name = 'Initial ATHR Demo Tenant');
  END IF;

  IF (SELECT count(*) FROM "LegalEntity" le JOIN "Tenant" t ON t.id = le.tenant_id WHERE t.name = 'Initial ATHR Demo Tenant' AND le.is_primary) <> 1 THEN
    RAISE EXCEPTION 'MT-MIG-002 precondition failed: expected exactly one primary LegalEntity for the Initial ATHR Demo Tenant, found %.',
      (SELECT count(*) FROM "LegalEntity" le JOIN "Tenant" t ON t.id = le.tenant_id WHERE t.name = 'Initial ATHR Demo Tenant' AND le.is_primary);
  END IF;
END $$;

-- CreateTable
CREATE TABLE "Location" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_centralized" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_tenantId_idx" ON "Location"("tenantId");

-- CreateIndex
CREATE INDEX "Location_legal_entity_id_idx" ON "Location"("legal_entity_id");

-- CreateIndex
CREATE INDEX "Warehouse_tenant_id_idx" ON "Warehouse"("tenant_id");

-- CreateIndex
CREATE INDEX "Warehouse_location_id_idx" ON "Warehouse"("location_id");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every Branch row becomes exactly one Location row, id preserved,
-- owned by the Initial ATHR Demo Tenant's primary LegalEntity.
INSERT INTO "Location" ("id", "tenantId", "legal_entity_id", "code", "name_ar", "name_en", "address", "phone", "is_active", "created_at", "updated_at")
SELECT
  b."id",
  t."id",
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
CROSS JOIN (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant') t
CROSS JOIN (
  SELECT le."id"
  FROM "LegalEntity" le
  JOIN "Tenant" t2 ON t2."id" = le."tenant_id"
  WHERE t2."name" = 'Initial ATHR Demo Tenant' AND le."is_primary"
) le;

-- Backfill: exactly one default, Location-linked Warehouse per migrated Location.
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
FROM "Location" l;

-- Post-step invariant guard: every Branch must now map to exactly one
-- Location, and every Location must have exactly one default Warehouse.
-- Mirrors docs/runbooks/tenant-migration-backfill-rollback.md Step C.
DO $$
DECLARE
  missing_locations INT;
  locations_without_warehouse INT;
BEGIN
  SELECT count(*) INTO missing_locations
  FROM "Branch" b
  LEFT JOIN "Location" l ON l."id" = b."id"
  WHERE l."id" IS NULL;

  IF missing_locations <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-002 invariant failed: % Branch row(s) have no corresponding Location row.', missing_locations;
  END IF;

  SELECT count(*) INTO locations_without_warehouse
  FROM "Location" l
  LEFT JOIN "Warehouse" w ON w."location_id" = l."id"
  WHERE w."id" IS NULL;

  IF locations_without_warehouse <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-002 invariant failed: % Location row(s) have no default Warehouse.', locations_without_warehouse;
  END IF;
END $$;
