-- WP-008 Phase C -- BACKFILL step. Migrates the flat "tax_percent" the
-- pre-Phase-C engine charged into the versioned "TaxCode" model.
--
-- ============================ WHAT IS AUTHORITATIVE ========================
-- "PriceBookEntry"."tax_percent", NOT "PricingRule"."tax_percent".
--
-- Both tables still exist and both still hold a rate. Since Phase B, only
-- "PriceBookEntry" is read by "PricingService.loadActiveRules" -- "PricingRule"
-- is dead data kept for audit. Migrating the table that is not charged from
-- would produce a TaxCode that matches no till. On the database this was
-- authored against, both agree (14.00 in each), so the choice is recorded
-- here for the reviewer rather than being load-bearing.
--
-- ============================== FAIL LOUD =================================
-- CLAUDE.md §6: "When a data migration encounters a record that cannot be
-- unambiguously handled, stop and report it with specifics -- never
-- default-assign or guess silently."
--
-- A tenant charging two different rates through its active price book cannot
-- be collapsed into one TaxCode without deciding which products keep which
-- rate, and nothing in the current schema records that intent. So this
-- migration ABORTS rather than choosing. RAISE EXCEPTION is used, not RAISE
-- NOTICE: "prisma migrate deploy" does not surface NOTICE (a Phase B lesson --
-- a "fail loud" mechanism built on NOTICE is silent), but an EXCEPTION fails
-- the deploy visibly and rolls this migration back untouched.
--
-- "scripts/validate-tax-code-migration.cjs" runs BEFORE this in
-- migration-gate and prints the full per-tenant rate breakdown, because the
-- exception text alone is too terse to act on.
--
-- ========================= WHAT IS AND IS NOT CREATED ======================
-- Every tenant with products gets a "STANDARD" TaxCategory -- a category is
-- just a bucket, there is nothing to guess about it, and "Product"
-- ."tax_category_id" becomes NOT NULL in the next migration.
--
-- A TaxCode v1 is created ONLY for tenants where exactly one rate is
-- observable. A tenant with products but no priced entries gets the category
-- and NO code: there is no evidence of what it charges, so inventing 14%
-- would be exactly the silent default this rule forbids. Such a tenant fails
-- loud at transaction time instead ("TAX_NO_ACTIVE_CODE" from
-- TaxResolutionService), the same way Phase B made a missing price block the
-- sale rather than fall back to a hardcoded number.

DO $$
DECLARE
  ambiguous_tenant RECORD;
  ambiguity_report TEXT := '';
  ambiguity_count INT := 0;
BEGIN
  -- ---- Guard: more than one distinct live rate within a single tenant ----
  FOR ambiguous_tenant IN
    SELECT
      e."tenant_id",
      count(DISTINCT e."tax_percent") AS distinct_rates,
      string_agg(DISTINCT e."tax_percent"::text, ', ' ORDER BY e."tax_percent"::text) AS rates
    FROM "PriceBookEntry" e
    JOIN "PriceBook" b
      ON b."id" = e."price_book_id"
     AND b."tenant_id" = e."tenant_id"
    WHERE e."status" = 'active'
      AND b."status" = 'active'
      AND b."is_default" = true
    GROUP BY e."tenant_id"
    HAVING count(DISTINCT e."tax_percent") > 1
  LOOP
    ambiguity_count := ambiguity_count + 1;
    ambiguity_report := ambiguity_report
      || format(E'\n  tenant %s charges %s distinct rates: %s',
                ambiguous_tenant."tenant_id",
                ambiguous_tenant.distinct_rates,
                ambiguous_tenant.rates);
  END LOOP;

  IF ambiguity_count > 0 THEN
    -- The format argument of RAISE must be a single string literal, not an
    -- expression -- `'a' || 'b'` here is a syntax error, and the remediation
    -- prose goes in a HINT clause rather than being concatenated on.
    RAISE EXCEPTION
      'WP-008 Phase C tax backfill aborted: % tenant(s) charge more than one distinct tax rate through the active default Price Book, so a single TaxCode v1 cannot be derived without guessing which products keep which rate.%',
      ambiguity_count, ambiguity_report
      USING HINT =
        'Decide the per-category split explicitly (create the TaxCategory/TaxCode rows and repoint the affected products) before re-running this deploy. Run "node scripts/validate-tax-code-migration.cjs" for the full per-entry breakdown.';
  END IF;
END
$$;

-- ---- 1. One STANDARD TaxCategory per tenant that owns any Product ---------
INSERT INTO "TaxCategory" ("id", "tenant_id", "code", "name_en", "name_ar", "description", "is_active", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  t."id",
  'STANDARD',
  'Standard rate',
  'المعدل القياسي',
  'Created by WP-008 Phase C migration 202608130003 from the pre-Phase-C flat PriceBookEntry.tax_percent.',
  true,
  now(),
  now()
FROM "Tenant" t
WHERE EXISTS (SELECT 1 FROM "Product" p WHERE p."tenant_id" = t."id")
  AND NOT EXISTS (
    SELECT 1 FROM "TaxCategory" c WHERE c."tenant_id" = t."id" AND c."code" = 'STANDARD'
  );

-- ---- 2. TaxCode v1, active, ONLY where exactly one rate is observable -----
-- "effective_from" is backdated to the tenant's earliest price-book entry:
-- the rate has been charged since then, and a later version's snapshot
-- comparison should not imply this one only began at deploy time.
INSERT INTO "TaxCode" (
  "id", "tenant_id", "tax_category_id", "code", "name_en", "name_ar",
  "jurisdiction", "calculation_method", "rate", "tax_mode", "rounding_policy",
  "exemption_allowed", "effective_from", "version", "status", "activated_at",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  observed."tenant_id",
  c."id",
  'STANDARD',
  'Standard rate v1',
  'المعدل القياسي - الإصدار الأول',
  'EG',
  'percentage',
  observed.rate,
  -- The pre-Phase-C engine computed selling_price = unit_price + unit_price *
  -- tax_percent/100, i.e. it treated every stored price as tax-EXCLUSIVE.
  -- This is arithmetic that already ran in production, not an assumption.
  'exclusive',
  'line',
  false,
  observed.earliest_entry,
  1,
  'active',
  now(),
  now(),
  now()
FROM (
  SELECT
    e."tenant_id",
    min(e."tax_percent") AS rate,
    min(e."effective_from") AS earliest_entry
  FROM "PriceBookEntry" e
  JOIN "PriceBook" b
    ON b."id" = e."price_book_id"
   AND b."tenant_id" = e."tenant_id"
  WHERE e."status" = 'active'
    AND b."status" = 'active'
    AND b."is_default" = true
  GROUP BY e."tenant_id"
  -- Redundant with the guard above; kept so this statement is safe in
  -- isolation if anyone ever re-runs it by hand.
  HAVING count(DISTINCT e."tax_percent") = 1
) AS observed
JOIN "TaxCategory" c
  ON c."tenant_id" = observed."tenant_id"
 AND c."code" = 'STANDARD'
WHERE NOT EXISTS (
  SELECT 1 FROM "TaxCode" tc
  WHERE tc."tenant_id" = observed."tenant_id" AND tc."code" = 'STANDARD' AND tc."version" = 1
);

-- ---- 3. Point every existing Product at its tenant's STANDARD category ----
-- Exactly one category exists per tenant at this point, so there is no
-- assignment ambiguity. Variants are deliberately left NULL: NULL means
-- "inherit", and no existing variant carries a recorded override intent.
UPDATE "Product" p
SET "tax_category_id" = c."id"
FROM "TaxCategory" c
WHERE c."tenant_id" = p."tenant_id"
  AND c."code" = 'STANDARD'
  AND p."tax_category_id" IS NULL;
