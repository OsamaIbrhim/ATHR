-- The materialized stock table already permits acceptance-first offline sales
-- to take on-hand below zero. Its immutable ledger must be able to represent
-- the same valid state while reservations remain nonnegative and cannot exceed
-- the positive portion of on-hand.
ALTER TABLE "InventoryMovement"
  DROP CONSTRAINT IF EXISTS "InventoryMovement_nonnegative_balances",
  DROP CONSTRAINT IF EXISTS "InventoryMovement_reserved_not_above_on_hand";

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_reserved_nonnegative"
    CHECK ("reserved_after" >= 0),
  ADD CONSTRAINT "InventoryMovement_reserved_not_above_available_on_hand"
    CHECK ("reserved_after" <= GREATEST("on_hand_after", 0));

COMMENT ON CONSTRAINT "InventoryMovement_reserved_not_above_available_on_hand"
ON "InventoryMovement" IS
  'The ledger may record negative on-hand from accepted offline sales; reservations remain bounded by positive available stock.';
