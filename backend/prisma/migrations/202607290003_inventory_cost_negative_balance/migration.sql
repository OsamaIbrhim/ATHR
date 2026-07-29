-- Acceptance-first offline sales may leave the materialized global quantity
-- below zero before the next incoming cost movement. The cost ledger must
-- preserve that real quantity transition while still enforcing exact
-- arithmetic and rejecting zero-quantity movements.
ALTER TABLE "InventoryCostMovement"
  DROP CONSTRAINT IF EXISTS "InventoryCostMovement_quantity_consistency";

ALTER TABLE "InventoryCostMovement"
  ADD CONSTRAINT "InventoryCostMovement_quantity_consistency"
    CHECK (
      "quantity_delta" <> 0
      AND "global_quantity_before" + "quantity_delta" =
        "global_quantity_after"
    );

COMMENT ON CONSTRAINT "InventoryCostMovement_quantity_consistency"
ON "InventoryCostMovement" IS
  'Global cost quantities may cross a negative offline-sales deficit; every movement must remain nonzero and arithmetically exact.';
