-- WP-008 Phase A (BR-CLS-103): expand -> backfill -> validate for
-- "Product"."brand" (free text) -> "Product"."brand_id" (FK to "Brand").
-- "Product"."brand" is left completely untouched (additive-only phase, no
-- column removal); this only adds the new column and reconciles it.
ALTER TABLE "Product" ADD COLUMN "brand_id" UUID;

-- Backfill: exactly one Brand row per distinct (tenant_id, trimmed brand
-- string) pair that has ever existed on Product. Blank/whitespace-only and
-- NULL brand values are not a "value" and get no Brand row / stay NULL.
INSERT INTO "Brand" ("id", "tenant_id", "name", "is_active", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  d."tenant_id",
  d."name",
  true,
  now(),
  now()
FROM (
  SELECT DISTINCT "tenant_id", TRIM("brand") AS "name"
  FROM "Product"
  WHERE "brand" IS NOT NULL AND TRIM("brand") <> ''
) d;

UPDATE "Product" p
SET "brand_id" = b."id"
FROM "Brand" b
WHERE b."tenant_id" = p."tenant_id"
  AND b."name" = TRIM(p."brand")
  AND p."brand" IS NOT NULL
  AND TRIM(p."brand") <> '';

CREATE INDEX "Product_brand_id_idx" ON "Product"("brand_id");

-- AddForeignKey: same-tenant composite FK, matching the pattern already
-- established for "Product"."category_id" -> "Category".
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenant_id_brand_id_fkey" FOREIGN KEY ("tenant_id", "brand_id") REFERENCES "Brand"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Post-step invariant guard (zero data loss, zero duplication):
-- 1. every Product with a non-blank "brand" string now resolves to a
--    "brand_id" -- no row loses its brand data.
-- 2. every distinct (tenant_id, trimmed brand) pair maps to exactly one
--    Brand row -- no duplicate Brand rows were created for the same value.
DO $$
DECLARE
  unresolved INT;
  distinct_values INT;
  brand_rows INT;
BEGIN
  SELECT count(*) INTO unresolved
  FROM "Product"
  WHERE "brand" IS NOT NULL AND TRIM("brand") <> '' AND "brand_id" IS NULL;

  IF unresolved <> 0 THEN
    RAISE EXCEPTION 'WP-008 Phase A precondition failed: % "Product" row(s) with a non-blank "brand" string did not resolve to a "brand_id".', unresolved;
  END IF;

  SELECT count(*) INTO distinct_values
  FROM (
    SELECT DISTINCT "tenant_id", TRIM("brand") AS "name"
    FROM "Product"
    WHERE "brand" IS NOT NULL AND TRIM("brand") <> ''
  ) d;

  SELECT count(*) INTO brand_rows FROM "Brand";

  IF distinct_values <> brand_rows THEN
    RAISE EXCEPTION 'WP-008 Phase A precondition failed: % distinct (tenant_id, brand) value(s) in "Product" but % row(s) in "Brand" -- expected a 1:1 mapping.', distinct_values, brand_rows;
  END IF;
END $$;
