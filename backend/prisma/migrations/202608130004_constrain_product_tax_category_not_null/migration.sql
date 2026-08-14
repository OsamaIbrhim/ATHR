-- WP-008 Phase C -- VALIDATE + CONSTRAIN step.
--
-- BR-TAX-201: a Product must always resolve to a tax category. NULL would
-- reintroduce exactly the implicit-rate hole this phase closes -- a line that
-- resolves to no category has no defined rate, and the safest-looking
-- handling (treat as zero) is the silent untaxed sale.
--
-- The explicit validate-before-constrain is not redundant with ALTER TABLE's
-- own check: the ALTER's error names the column but not the rows, and a
-- deploy that fails here needs the offending tenant to act on.

DO $$
DECLARE
  orphan_count INT;
  orphan_sample TEXT;
BEGIN
  SELECT count(*) INTO orphan_count FROM "Product" WHERE "tax_category_id" IS NULL;

  IF orphan_count > 0 THEN
    SELECT string_agg(sample, E'\n  ')
      INTO orphan_sample
      FROM (
        SELECT format('product %s (tenant %s, sku_base %s)', "id", "tenant_id", coalesce("sku_base", '-')) AS sample
        FROM "Product"
        WHERE "tax_category_id" IS NULL
        ORDER BY "tenant_id", "id"
        LIMIT 20
      ) AS s;

    -- RAISE's format argument must be a single string literal (an expression
    -- there is a syntax error); the remediation goes in HINT.
    RAISE EXCEPTION
      'WP-008 Phase C: % Product row(s) still have no tax_category_id after the 202608130003 backfill. First rows:%',
      orphan_count, E'\n  ' || orphan_sample
      USING HINT =
        'The tenant owns products but was skipped by the backfill. Assign a TaxCategory explicitly -- do not default-assign.';
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "tax_category_id" SET NOT NULL;
