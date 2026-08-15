-- WP-008 Phase C (BR-TAX-204) -- inclusive/exclusive, explicit per price
-- context: "لا يمكن لنفس السعر أن يكون شاملًا وغير شامل دون Scope صريحة".
--
-- Expand -> backfill -> constrain in one migration because the backfill is a
-- single UPDATE over a table the application is not yet writing this column
-- to (nothing reads "tax_mode" until this phase's service code ships).
--
-- The backfill value is NOT a default and NOT a guess. The pre-Phase-C engine
-- computed, in "PricingService.priceFromEntry":
--
--     taxAmount    = unit_price * tax_percent / 100
--     sellingPrice = unit_price + taxAmount
--
-- i.e. it added tax ON TOP of the stored price. Every existing row is
-- tax-exclusive by the arithmetic that has already been charged against it.
--
-- The column is then NOT NULL **with no DEFAULT**, deliberately. A default
-- here would let a future INSERT omit the mode and silently inherit one, and
-- getting this wrong on a single entry overcharges or undercharges every sale
-- that resolves to it. Callers must state it.

-- AlterTable: expand
ALTER TABLE "PriceBookEntry" ADD COLUMN "tax_mode" "TaxMode";

-- Backfill
UPDATE "PriceBookEntry" SET "tax_mode" = 'exclusive' WHERE "tax_mode" IS NULL;

-- Validate + constrain
DO $$
DECLARE
  unset_count INT;
BEGIN
  SELECT count(*) INTO unset_count FROM "PriceBookEntry" WHERE "tax_mode" IS NULL;
  IF unset_count > 0 THEN
    RAISE EXCEPTION
      'WP-008 Phase C: % PriceBookEntry row(s) still have a NULL tax_mode after backfill.', unset_count;
  END IF;
END
$$;

ALTER TABLE "PriceBookEntry" ALTER COLUMN "tax_mode" SET NOT NULL;
