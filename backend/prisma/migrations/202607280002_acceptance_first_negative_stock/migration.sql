-- Acceptance-first offline sales must be able to record the commercial fact
-- even when the cloud inventory snapshot is behind the selling terminal.
ALTER TABLE "InventoryStock"
  DROP CONSTRAINT IF EXISTS "InventoryStock_qty_on_hand_nonnegative",
  DROP CONSTRAINT IF EXISTS "InventoryStock_reserved_not_above_on_hand";

ALTER TABLE "InventoryStock"
  ADD CONSTRAINT "InventoryStock_reserved_not_above_available_on_hand"
  CHECK ("qty_reserved" <= GREATEST("qty_on_hand", 0));

COMMENT ON CONSTRAINT "InventoryStock_reserved_not_above_available_on_hand"
ON "InventoryStock" IS
  'Reserved stock remains nonnegative and cannot exceed positive on-hand stock; offline sales may make on-hand negative.';

-- The cost ledger is global and receives only purchases, supplier returns,
-- purchase reversals, and customer returns. Sales can take its quantity
-- snapshot below zero between cost events. Incoming stock first covers that
-- deficit; only the remaining positive stock carries inventory value.
DO $migration$
DECLARE
  definition TEXT;
  original TEXT;
BEGIN
  SELECT pg_get_functiondef(routine.oid)
  INTO definition
  FROM pg_proc routine
  JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'public'
    AND routine.proname = 'record_inventory_cost_movement';

  IF definition IS NULL THEN
    RAISE EXCEPTION 'record_inventory_cost_movement does not exist';
  END IF;

  original := definition;
  definition := replace(
    definition,
    'IF current_quantity_big < 0
     OR current_quantity_big > 2147483647 THEN',
    'IF current_quantity_big < -2147483648
     OR current_quantity_big > 2147483647 THEN'
  );
  definition := replace(
    definition,
    'IF previous_quantity < 0
     OR previous_quantity > 2147483647 THEN',
    'IF previous_quantity < -2147483648
     OR previous_quantity > 2147483647 THEN'
  );
  definition := replace(
    definition,
    'IF p_quantity_delta <= 0 OR p_movement_value < 0 OR current_quantity <= 0 THEN
      RAISE EXCEPTION ''Invalid incoming inventory cost movement'';
    END IF;

    calculated_cost :=
      (
        (current_cost * previous_quantity) + p_movement_value
      ) / current_quantity;',
    'IF p_quantity_delta <= 0 OR p_movement_value < 0 THEN
      RAISE EXCEPTION ''Invalid incoming inventory cost movement'';
    END IF;

    IF current_quantity <= 0 THEN
      calculated_cost := current_cost;
    ELSIF previous_quantity < 0 THEN
      calculated_cost := p_movement_value / p_quantity_delta;
    ELSE
      calculated_cost :=
        (
          (current_cost * previous_quantity) + p_movement_value
        ) / current_quantity;
    END IF;'
  );
  definition := replace(
    definition,
    'IF next_cost < 0 THEN
    RAISE EXCEPTION ''Inventory cost cannot become negative'';
  END IF;',
    'IF p_quantity_delta < 0 AND current_quantity < 0 THEN
    RAISE EXCEPTION
      ''Outgoing cost movement cannot deepen a negative inventory deficit'';
  END IF;

  IF next_cost < 0 THEN
    RAISE EXCEPTION ''Inventory cost cannot become negative'';
  END IF;

  IF previous_quantity < 0
     AND p_movement_type IN (''purchase_receipt'', ''customer_return'') THEN
    p_metadata :=
      COALESCE(p_metadata, ''{}''::jsonb) ||
      jsonb_build_object(
        ''negative_inventory_units_covered'',
        LEAST(p_quantity_delta::bigint, ABS(previous_quantity))
      );
  END IF;'
  );
  definition := replace(
    definition,
    'value_before := ROUND(previous_quantity * current_cost, 2);
  value_after := ROUND(current_quantity_big * next_cost, 2);',
    'value_before := ROUND(GREATEST(previous_quantity, 0) * current_cost, 2);
  value_after := ROUND(GREATEST(current_quantity_big, 0) * next_cost, 2);'
  );

  IF definition = original
     OR position('current_quantity_big < 0
     OR current_quantity_big > 2147483647' IN definition) > 0
     OR position('previous_quantity < 0
     OR previous_quantity > 2147483647' IN definition) > 0
     OR position('current_cost * previous_quantity' IN definition) > 0
     OR position('ROUND(previous_quantity * current_cost, 2)' IN definition) > 0 THEN
    RAISE EXCEPTION
      'record_inventory_cost_movement definition did not match the expected baseline';
  END IF;

  EXECUTE definition;
END
$migration$;
