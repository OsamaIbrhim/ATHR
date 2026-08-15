-- WP-008 Phase C -- put tax changes into the POS incremental sync stream.
--
-- Phase B shipped the pricing tables with NO trigger and the consequence was
-- silent and total: a price changed cleanly in the admin UI, "SyncChange"
-- never advanced, and every terminal kept selling at its last-pulled price
-- indefinitely. "202608070007" fixed it for "PriceBook"/"PriceBookEntry".
--
-- Activating a TaxCode version has exactly the same property: the POS catalog
-- snapshot carries "unit_tax" per variant (SyncService.productSnapshot), so a
-- rate change that never reaches the terminals means tills charge the old
-- rate until something unrelated forces a catalog reset.
--
-- Reuses "bold_emit_pricing_sync_change" unchanged -- it reads only
-- "id"/"tenant_id", both present on every table below, and kind = 'pricing'
-- is already what makes SyncService.pull set "resetCatalog".

-- ---- TaxCode ---------------------------------------------------------------
-- Only status changes matter, for the same reason the "PriceBook" trigger is
-- WHEN-guarded: kind = 'pricing' forces a FULL catalog reset on every
-- terminal, so the draft -> submitted -> approved -> scheduled churn must stay
-- out of the stream. What a till charges changes when a version becomes
-- 'active' or stops being active ('superseded'/'archived').
--
-- INSERT is not covered: a TaxCode is always born 'draft' (schema default) and
-- cannot be live at insert time, so an insert changes no charged amount.
-- UPDATE of "rate" is not covered either -- the rate of an ACTIVE code is
-- immutable in this design (a rate change is a new version, BR-TAX-203), and
-- "TaxCodeRepository" only ever writes "rate" on a draft row.
DROP TRIGGER IF EXISTS "bold_tax_code_sync_change" ON "TaxCode";
CREATE TRIGGER "bold_tax_code_sync_change"
AFTER UPDATE ON "TaxCode"
FOR EACH ROW
WHEN (OLD."status" IS DISTINCT FROM NEW."status")
EXECUTE FUNCTION "bold_emit_pricing_sync_change"();

-- ---- Product / ProductVariant tax category ---------------------------------
-- Repointing a product at a different tax category changes the charged amount
-- just as much as activating a new version does, and neither table emitted a
-- pricing change before this phase. Guarded to the tax column only: ordinary
-- catalog edits (name, image, is_active) already flow through the catalog
-- snapshot's own versioning and must not each force a full reset.
DROP TRIGGER IF EXISTS "bold_product_tax_category_sync_change" ON "Product";
CREATE TRIGGER "bold_product_tax_category_sync_change"
AFTER UPDATE ON "Product"
FOR EACH ROW
WHEN (OLD."tax_category_id" IS DISTINCT FROM NEW."tax_category_id")
EXECUTE FUNCTION "bold_emit_pricing_sync_change"();

DROP TRIGGER IF EXISTS "bold_variant_tax_category_sync_change" ON "ProductVariant";
CREATE TRIGGER "bold_variant_tax_category_sync_change"
AFTER UPDATE ON "ProductVariant"
FOR EACH ROW
WHEN (OLD."tax_category_id" IS DISTINCT FROM NEW."tax_category_id")
EXECUTE FUNCTION "bold_emit_pricing_sync_change"();
