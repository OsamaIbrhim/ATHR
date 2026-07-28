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
CREATE OR REPLACE FUNCTION "record_inventory_cost_movement"(
  p_variant_id UUID,
  p_branch_id UUID,
  p_movement_type "InventoryCostMovementType",
  p_quantity_delta INTEGER,
  p_movement_value NUMERIC(18, 2),
  p_reference_type TEXT,
  p_reference_id TEXT,
  p_reference_line_id TEXT,
  p_purchase_invoice_id UUID,
  p_purchase_invoice_item_id UUID,
  p_supplier_return_id UUID,
  p_supplier_return_item_id UUID,
  p_idempotency_key TEXT,
  p_occurred_at TIMESTAMP(3),
  p_created_by UUID,
  p_restore_cost NUMERIC(12, 2),
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  existing "InventoryCostMovement"%ROWTYPE;
  existing_found BOOLEAN := false;
  latest "InventoryCostMovement"%ROWTYPE;
  current_cost NUMERIC(12, 2);
  current_quantity_big BIGINT;
  current_quantity INTEGER;
  previous_quantity BIGINT;
  calculated_cost NUMERIC;
  next_cost NUMERIC(12, 2);
  value_before NUMERIC(18, 2);
  value_after NUMERIC(18, 2);
  rounding_delta NUMERIC(18, 2);
  movement_id UUID;
BEGIN
  IF p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'Inventory cost movement quantity delta cannot be zero';
  END IF;

  SELECT variant."cost_price"
  INTO current_cost
  FROM "ProductVariant" variant
  WHERE variant."id" = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ProductVariant % does not exist', p_variant_id;
  END IF;

  SELECT *
  INTO existing
  FROM "InventoryCostMovement"
  WHERE "idempotency_key" = p_idempotency_key;
  existing_found := FOUND;

  IF existing_found THEN
    IF existing."variant_id" <> p_variant_id
       OR existing."branch_id" IS DISTINCT FROM p_branch_id
       OR existing."movement_type" <> p_movement_type
       OR existing."quantity_delta" <> p_quantity_delta
       OR existing."movement_value" <> p_movement_value
       OR existing."reference_type" <> p_reference_type
       OR existing."reference_id" <> p_reference_id
       OR existing."reference_line_id" IS DISTINCT FROM p_reference_line_id
       OR existing."purchase_invoice_id" IS DISTINCT FROM p_purchase_invoice_id
       OR existing."purchase_invoice_item_id" IS DISTINCT FROM p_purchase_invoice_item_id
       OR existing."supplier_return_id" IS DISTINCT FROM p_supplier_return_id
       OR existing."supplier_return_item_id" IS DISTINCT FROM p_supplier_return_item_id
       OR (
         p_movement_type = 'purchase_reversal'
         AND existing."cost_after" IS DISTINCT FROM p_restore_cost
       ) THEN
      RAISE EXCEPTION
        'Inventory cost movement idempotency key belongs to a different command: %',
        p_idempotency_key;
    END IF;
  END IF;

  SELECT
    COALESCE((
      SELECT SUM(stock."qty_on_hand")
      FROM "InventoryStock" stock
      WHERE stock."variant_id" = p_variant_id
    ), 0)
    +
    COALESCE((
      SELECT SUM(
        item."shipped_qty" - item."received_qty" -
        item."damaged_qty" - item."missing_qty"
      )
      FROM "TransferItem" item
      WHERE item."variant_id" = p_variant_id
    ), 0)
  INTO current_quantity_big;

  IF current_quantity_big < -2147483648
     OR current_quantity_big > 2147483647 THEN
    RAISE EXCEPTION
      'Invalid global inventory quantity for variant %: %',
      p_variant_id,
      current_quantity_big;
  END IF;

  current_quantity := current_quantity_big::integer;

  SELECT *
  INTO latest
  FROM "InventoryCostMovement"
  WHERE "variant_id" = p_variant_id
  ORDER BY "sequence" DESC
  LIMIT 1;

  IF existing_found THEN
    IF latest."id" IS NULL
       OR latest."cost_after" <> current_cost THEN
      RAISE EXCEPTION
        'Inventory cost ledger mismatch after idempotent replay for variant %: ledger cost %, materialized cost %',
        p_variant_id,
        latest."cost_after",
        current_cost;
    END IF;

    RETURN existing."id";
  END IF;

  previous_quantity := current_quantity_big - p_quantity_delta::bigint;

  IF previous_quantity < -2147483648
     OR previous_quantity > 2147483647 THEN
    RAISE EXCEPTION
      'Invalid global inventory quantity transition for variant %: previous %, delta %, current %',
      p_variant_id,
      previous_quantity,
      p_quantity_delta,
      current_quantity_big;
  END IF;

  IF latest."id" IS NULL AND previous_quantity > 0 THEN
    INSERT INTO "InventoryCostMovement" (
      "variant_id",
      "movement_type",
      "quantity_delta",
      "global_quantity_before",
      "global_quantity_after",
      "unit_cost",
      "cost_before",
      "cost_after",
      "inventory_value_before",
      "movement_value",
      "inventory_value_after",
      "rounding_adjustment",
      "reference_type",
      "reference_id",
      "idempotency_key",
      "occurred_at",
      "metadata"
    ) VALUES (
      p_variant_id,
      'opening_balance',
      previous_quantity::integer,
      0,
      previous_quantity::integer,
      current_cost::numeric(18, 6),
      0,
      current_cost,
      0,
      ROUND(previous_quantity * current_cost, 2),
      ROUND(previous_quantity * current_cost, 2),
      0,
      'InventoryStock',
      p_variant_id::text,
      'cost-auto-opening:' || p_variant_id::text,
      p_occurred_at,
      jsonb_build_object(
        'reason', 'first post-cost-ledger receipt on an uninitialized variant'
      )
    )
    ON CONFLICT ("idempotency_key") DO NOTHING;

    SELECT *
    INTO latest
    FROM "InventoryCostMovement"
    WHERE "variant_id" = p_variant_id
    ORDER BY "sequence" DESC
    LIMIT 1;
  END IF;

  IF latest."id" IS NOT NULL
     AND latest."cost_after" <> current_cost THEN
    RAISE EXCEPTION
      'Inventory cost ledger mismatch for variant %: ledger cost %, materialized cost %',
      p_variant_id,
      latest."cost_after",
      current_cost;
  END IF;

  IF p_movement_type IN ('purchase_receipt', 'customer_return') THEN
    IF p_quantity_delta <= 0 OR p_movement_value < 0 THEN
      RAISE EXCEPTION 'Invalid incoming inventory cost movement';
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
    END IF;
    IF calculated_cost < 0 OR calculated_cost > 9999999999.99 THEN
      RAISE EXCEPTION
        'Calculated moving-average cost is outside DECIMAL(12,2) range for variant %',
        p_variant_id;
    END IF;
    next_cost := ROUND(calculated_cost, 2);
  ELSIF p_movement_type = 'purchase_reversal' THEN
    IF p_quantity_delta >= 0 OR p_movement_value > 0 OR p_restore_cost IS NULL THEN
      RAISE EXCEPTION 'Invalid purchase reversal cost movement';
    END IF;

    next_cost := p_restore_cost;
  ELSIF p_movement_type = 'supplier_return' THEN
    IF p_quantity_delta >= 0
       OR p_movement_value > 0
       OR p_restore_cost IS NOT NULL
       OR p_movement_value <> ROUND(p_quantity_delta * current_cost, 2) THEN
      RAISE EXCEPTION
        'Supplier return must remove inventory at the current moving-average cost';
    END IF;

    next_cost := current_cost;
  ELSE
    RAISE EXCEPTION
      'Unsupported inventory cost movement type for posting function: %',
      p_movement_type;
  END IF;

  IF p_quantity_delta < 0 AND current_quantity < 0 THEN
    RAISE EXCEPTION
      'Outgoing cost movement cannot deepen a negative inventory deficit';
  END IF;

  IF next_cost < 0 THEN
    RAISE EXCEPTION 'Inventory cost cannot become negative';
  END IF;

  IF previous_quantity < 0
     AND p_movement_type IN ('purchase_receipt', 'customer_return') THEN
    p_metadata :=
      COALESCE(p_metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'negative_inventory_units_covered',
        LEAST(p_quantity_delta::bigint, ABS(previous_quantity))
      );
  END IF;

  IF previous_quantity * current_cost > 9999999999999999.99
     OR current_quantity_big * next_cost > 9999999999999999.99
     OR ABS(p_movement_value) > 9999999999999999.99 THEN
    RAISE EXCEPTION
      'Inventory value is outside DECIMAL(18,2) range for variant %',
      p_variant_id;
  END IF;

  value_before := ROUND(GREATEST(previous_quantity, 0) * current_cost, 2);
  value_after := ROUND(GREATEST(current_quantity_big, 0) * next_cost, 2);
  rounding_delta := value_after - (value_before + p_movement_value);

  INSERT INTO "InventoryCostMovement" (
    "variant_id",
    "branch_id",
    "movement_type",
    "quantity_delta",
    "global_quantity_before",
    "global_quantity_after",
    "unit_cost",
    "cost_before",
    "cost_after",
    "inventory_value_before",
    "movement_value",
    "inventory_value_after",
    "rounding_adjustment",
    "reference_type",
    "reference_id",
    "reference_line_id",
    "purchase_invoice_id",
    "purchase_invoice_item_id",
    "supplier_return_id",
    "supplier_return_item_id",
    "idempotency_key",
    "occurred_at",
    "created_by",
    "metadata"
  ) VALUES (
    p_variant_id,
    p_branch_id,
    p_movement_type,
    p_quantity_delta,
    previous_quantity::integer,
    current_quantity,
    CASE
      WHEN p_quantity_delta = 0 THEN 0
      ELSE ABS(p_movement_value / p_quantity_delta)::numeric(18, 6)
    END,
    current_cost,
    next_cost,
    value_before,
    p_movement_value,
    value_after,
    rounding_delta,
    p_reference_type,
    p_reference_id,
    p_reference_line_id,
    p_purchase_invoice_id,
    p_purchase_invoice_item_id,
    p_supplier_return_id,
    p_supplier_return_item_id,
    p_idempotency_key,
    p_occurred_at,
    p_created_by,
    p_metadata
  )
  RETURNING "id" INTO movement_id;

  IF p_movement_type = 'purchase_receipt' THEN
    IF p_purchase_invoice_id IS NULL
       OR p_purchase_invoice_item_id IS NULL THEN
      RAISE EXCEPTION
        'Purchase receipt cost movements require invoice and line references';
    END IF;

    PERFORM set_config(
      'bold.purchase_accounting_document_write',
      'on',
      true
    );
    UPDATE "PurchaseInvoiceItem"
    SET
      "global_qty_before" = previous_quantity::integer,
      "global_qty_after" = current_quantity,
      "cost_before" = current_cost,
      "cost_after" = next_cost
    WHERE "id" = p_purchase_invoice_item_id
      AND "purchase_invoice_id" = p_purchase_invoice_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'PurchaseInvoiceItem % does not belong to PurchaseInvoice %',
        p_purchase_invoice_item_id,
        p_purchase_invoice_id;
    END IF;

    PERFORM set_config(
      'bold.purchase_accounting_document_write',
      'off',
      true
    );
  END IF;

  PERFORM set_config(
    'bold.inventory_cost_materialization_write',
    'on',
    true
  );
  UPDATE "ProductVariant"
  SET "cost_price" = next_cost
  WHERE "id" = p_variant_id;
  PERFORM set_config(
    'bold.inventory_cost_materialization_write',
    'off',
    true
  );

  RETURN movement_id;
END
$$;
