-- WP-007 Phase B (MT-MIG-006) fix-forward: several pre-existing PL/pgSQL
-- functions insert into now-NOT-NULL tenant-owned tables without ever
-- setting "tenant_id" -- harmless while those columns were nullable, but
-- each would now fail a NOT NULL violation the moment it runs after this
-- WP's constraint migrations land. Discovered while implementing this WP,
-- fixed forward in the same migration set rather than editing the applied
-- historical migrations that first defined them:
--   1. bold_record_catalog_change/bold_record_inventory_change
--      (20260719202000_incremental_sync_log) and bold_emit_*_sync_change
--      (202607210001_phase5a_price_sync_triggers) insert into "SyncChange"
--      on every Product/ProductVariant/PricingRule/InventoryStock write.
--   2. record_inventory_movement (202607220002_inventory_movement_ledger)
--      inserts into "InventoryMovement" from the sale/return/transfer
--      triggers and from purchasing/sales application code.
--   3. record_inventory_cost_movement, latest definition in
--      202607280002_acceptance_first_negative_stock, inserts into
--      "InventoryCostMovement" from the same call sites plus purchasing
--      reversal/return cost postings.
--   4. record_transfer_item_movements (202607230002_transfer_state_machine)
--      inserts into "TransferTransitMovement" on every ship/receive/damage/
--      missing quantity update.
-- Each fix derives tenant_id from a row already being read in the same
-- function (the InventoryStock/ProductVariant/Transfer row driving the
-- movement), so the inserted movement's tenant is always the same tenant as
-- the record it is derived from -- exactly the invariant this WP's composite
-- foreign keys enforce elsewhere.
CREATE OR REPLACE FUNCTION bold_record_catalog_change()
RETURNS TRIGGER AS $$
DECLARE
  changed_id TEXT;
  changed_tenant UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    changed_id := OLD."id"::text;
    changed_tenant := OLD."tenant_id";
  ELSE
    changed_id := NEW."id"::text;
    changed_tenant := NEW."tenant_id";
  END IF;
  INSERT INTO "SyncChange" ("kind", "entity_key", "tenant_id")
  VALUES (TG_ARGV[0], changed_id, changed_tenant);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bold_record_inventory_change()
RETURNS TRIGGER AS $$
DECLARE
  changed_branch UUID;
  changed_variant TEXT;
  changed_tenant UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    changed_branch := OLD."branch_id";
    changed_variant := OLD."variant_id"::text;
    changed_tenant := OLD."tenant_id";
  ELSE
    changed_branch := NEW."branch_id";
    changed_variant := NEW."variant_id"::text;
    changed_tenant := NEW."tenant_id";
  END IF;
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "tenant_id")
  VALUES ('inventory', changed_branch, changed_variant, changed_tenant);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "bold_emit_pricing_sync_change"()
RETURNS trigger AS $$
DECLARE
  entity_id uuid;
  entity_tenant uuid;
BEGIN
  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  entity_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD."tenant_id" ELSE NEW."tenant_id" END;
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
  VALUES ('pricing', NULL, entity_id::text, CURRENT_TIMESTAMP, entity_tenant);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "bold_emit_product_sync_change"()
RETURNS trigger AS $$
DECLARE
  entity_id uuid;
  entity_tenant uuid;
BEGIN
  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  entity_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD."tenant_id" ELSE NEW."tenant_id" END;
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
  VALUES ('product', NULL, entity_id::text, CURRENT_TIMESTAMP, entity_tenant);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "bold_emit_variant_sync_change"()
RETURNS trigger AS $$
DECLARE
  entity_id uuid;
  entity_tenant uuid;
BEGIN
  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  entity_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD."tenant_id" ELSE NEW."tenant_id" END;
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
  VALUES ('variant', NULL, entity_id::text, CURRENT_TIMESTAMP, entity_tenant);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "bold_emit_inventory_sync_change"()
RETURNS trigger AS $$
DECLARE
  target_branch uuid;
  target_variant uuid;
  target_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_branch := OLD."branch_id";
    target_variant := OLD."variant_id";
    target_tenant := OLD."tenant_id";
  ELSE
    target_branch := NEW."branch_id";
    target_variant := NEW."variant_id";
    target_tenant := NEW."tenant_id";
  END IF;

  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
  VALUES ('inventory', target_branch, target_variant::text, CURRENT_TIMESTAMP, target_tenant);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "record_inventory_movement"(
  p_branch_id UUID,
  p_variant_id UUID,
  p_movement_type "InventoryMovementType",
  p_on_hand_delta INTEGER,
  p_reserved_delta INTEGER,
  p_reference_type TEXT,
  p_reference_id TEXT,
  p_reference_line_id TEXT,
  p_idempotency_key TEXT,
  p_occurred_at TIMESTAMP(3),
  p_created_by UUID,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  existing "InventoryMovement"%ROWTYPE;
  existing_found BOOLEAN := false;
  current_on_hand INTEGER;
  current_reserved INTEGER;
  v_tenant_id UUID;
  movement_count BIGINT;
  ledger_on_hand BIGINT;
  ledger_reserved BIGINT;
  previous_on_hand BIGINT;
  previous_reserved BIGINT;
  movement_id UUID;
BEGIN
  IF p_on_hand_delta = 0 AND p_reserved_delta = 0 THEN
    RAISE EXCEPTION 'Inventory movement must change on-hand or reserved quantity';
  END IF;

  SELECT *
  INTO existing
  FROM "InventoryMovement"
  WHERE "idempotency_key" = p_idempotency_key;
  existing_found := FOUND;

  SELECT stock."qty_on_hand", stock."qty_reserved", stock."tenant_id"
  INTO current_on_hand, current_reserved, v_tenant_id
  FROM "InventoryStock" stock
  WHERE stock."branch_id" = p_branch_id
    AND stock."variant_id" = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'InventoryStock row does not exist for branch % and variant %', p_branch_id, p_variant_id;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(movement."on_hand_delta"), 0),
    COALESCE(SUM(movement."reserved_delta"), 0)
  INTO movement_count, ledger_on_hand, ledger_reserved
  FROM "InventoryMovement" movement
  WHERE movement."branch_id" = p_branch_id
    AND movement."variant_id" = p_variant_id;

  IF existing_found THEN
    IF existing."branch_id" <> p_branch_id
       OR existing."variant_id" <> p_variant_id
       OR existing."movement_type" <> p_movement_type
       OR existing."on_hand_delta" <> p_on_hand_delta
       OR existing."reserved_delta" <> p_reserved_delta
       OR existing."reference_type" <> p_reference_type
       OR existing."reference_id" <> p_reference_id
       OR existing."reference_line_id" IS DISTINCT FROM p_reference_line_id THEN
      RAISE EXCEPTION 'Inventory movement idempotency key belongs to a different command: %', p_idempotency_key;
    END IF;

    IF ledger_on_hand <> current_on_hand OR ledger_reserved <> current_reserved THEN
      RAISE EXCEPTION
        'Inventory ledger mismatch after idempotent replay for branch % variant %: ledger=(%,%), stock=(%,%)',
        p_branch_id,
        p_variant_id,
        ledger_on_hand,
        ledger_reserved,
        current_on_hand,
        current_reserved;
    END IF;
    RETURN existing."id";
  END IF;

  IF movement_count = 0 THEN
    previous_on_hand := current_on_hand::BIGINT - p_on_hand_delta::BIGINT;
    previous_reserved := current_reserved::BIGINT - p_reserved_delta::BIGINT;

    IF previous_on_hand < 0
       OR previous_reserved < 0
       OR previous_reserved > previous_on_hand
       OR previous_on_hand > 2147483647
       OR previous_reserved > 2147483647 THEN
      RAISE EXCEPTION 'Cannot infer a valid opening inventory balance for branch % and variant %', p_branch_id, p_variant_id;
    END IF;

    IF previous_on_hand <> 0 OR previous_reserved <> 0 THEN
      INSERT INTO "InventoryMovement" (
        "branch_id",
        "variant_id",
        "movement_type",
        "on_hand_delta",
        "reserved_delta",
        "on_hand_after",
        "reserved_after",
        "reference_type",
        "reference_id",
        "idempotency_key",
        "occurred_at",
        "metadata",
        "tenant_id"
      ) VALUES (
        p_branch_id,
        p_variant_id,
        'opening_balance',
        previous_on_hand::INTEGER,
        previous_reserved::INTEGER,
        previous_on_hand::INTEGER,
        previous_reserved::INTEGER,
        'InventoryStock',
        p_branch_id::text || ':' || p_variant_id::text,
        'auto-opening:' || p_branch_id::text || ':' || p_variant_id::text,
        p_occurred_at,
        jsonb_build_object(
          'reason', 'first post-ledger movement on an uninitialized stock row'
        ),
        v_tenant_id
      )
      ON CONFLICT ("idempotency_key") DO NOTHING;
    END IF;

    ledger_on_hand := previous_on_hand;
    ledger_reserved := previous_reserved;
  END IF;

  IF ledger_on_hand + p_on_hand_delta <> current_on_hand
     OR ledger_reserved + p_reserved_delta <> current_reserved THEN
    RAISE EXCEPTION
      'Inventory ledger mismatch for branch % variant %: ledger=(%,%), delta=(%,%), stock=(%,%)',
      p_branch_id,
      p_variant_id,
      ledger_on_hand,
      ledger_reserved,
      p_on_hand_delta,
      p_reserved_delta,
      current_on_hand,
      current_reserved;
  END IF;

  INSERT INTO "InventoryMovement" (
    "branch_id",
    "variant_id",
    "movement_type",
    "on_hand_delta",
    "reserved_delta",
    "on_hand_after",
    "reserved_after",
    "reference_type",
    "reference_id",
    "reference_line_id",
    "idempotency_key",
    "occurred_at",
    "created_by",
    "metadata",
    "tenant_id"
  ) VALUES (
    p_branch_id,
    p_variant_id,
    p_movement_type,
    p_on_hand_delta,
    p_reserved_delta,
    current_on_hand,
    current_reserved,
    p_reference_type,
    p_reference_id,
    p_reference_line_id,
    p_idempotency_key,
    p_occurred_at,
    p_created_by,
    p_metadata,
    v_tenant_id
  )
  RETURNING "id" INTO movement_id;

  RETURN movement_id;
END
$$;

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
  v_tenant_id UUID;
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

  SELECT variant."cost_price", variant."tenant_id"
  INTO current_cost, v_tenant_id
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
      "metadata",
      "tenant_id"
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
      ),
      v_tenant_id
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

    next_cost := ROUND(calculated_cost, 2);
  ELSIF p_movement_type = 'purchase_reversal' THEN
    next_cost := p_restore_cost;
  ELSE
    next_cost := current_cost;
  END IF;

  IF current_quantity_big * next_cost < -9999999999999999.99
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
    "metadata",
    "tenant_id"
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
    p_metadata,
    v_tenant_id
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

CREATE OR REPLACE FUNCTION "record_transfer_item_movements"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transfer_record "Transfer"%ROWTYPE;
  shipped_delta INTEGER;
  received_delta INTEGER;
  damaged_delta INTEGER;
  missing_delta INTEGER;
  transit_cursor INTEGER;
  final_transit INTEGER;
BEGIN
  SELECT * INTO transfer_record
  FROM "Transfer"
  WHERE "id" = NEW."transfer_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % does not exist', NEW."transfer_id";
  END IF;

  shipped_delta := NEW."shipped_qty" - OLD."shipped_qty";
  received_delta := NEW."received_qty" - OLD."received_qty";
  damaged_delta := NEW."damaged_qty" - OLD."damaged_qty";
  missing_delta := NEW."missing_qty" - OLD."missing_qty";

  IF shipped_delta < 0
     OR received_delta < 0
     OR damaged_delta < 0
     OR missing_delta < 0 THEN
    RAISE EXCEPTION
      'Transfer item cumulative quantities cannot decrease outside a correction workflow';
  END IF;

  IF shipped_delta > 0
     AND transfer_record."status"::text NOT IN (
       'shipped',
       'partially_received',
       'received'
     ) THEN
    RAISE EXCEPTION
      'Transfer item shipment requires a shipped transfer state';
  END IF;

  IF (received_delta > 0 OR damaged_delta > 0 OR missing_delta > 0)
     AND transfer_record."status"::text NOT IN (
       'partially_received',
       'received'
     ) THEN
    RAISE EXCEPTION
      'Transfer item resolution requires a receiving transfer state';
  END IF;

  transit_cursor :=
    OLD."shipped_qty" - OLD."received_qty" -
    OLD."damaged_qty" - OLD."missing_qty";
  final_transit :=
    NEW."shipped_qty" - NEW."received_qty" -
    NEW."damaged_qty" - NEW."missing_qty";

  IF shipped_delta > 0 THEN
    transit_cursor := transit_cursor + shipped_delta;

    PERFORM "record_inventory_movement"(
      transfer_record."from_branch_id"::uuid,
      NEW."variant_id"::uuid,
      'transfer_out'::"InventoryMovementType",
      (-shipped_delta)::integer,
      0::integer,
      'Transfer'::text,
      NEW."transfer_id"::text,
      NEW."id"::text,
      (
        'transfer-out:' || NEW."id"::text || ':' ||
        NEW."shipped_qty"::text
      )::text,
      COALESCE(
        transfer_record."shipped_at",
        CURRENT_TIMESTAMP::timestamp(3)
      )::timestamp(3),
      transfer_record."shipped_by"::uuid,
      jsonb_build_object(
        'transfer_number', transfer_record."transfer_number"
      )::jsonb
    );

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by", "metadata", "tenant_id"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'shipped'::"TransferTransitMovementType",
      shipped_delta,
      transit_cursor,
      'transit-shipped:' || NEW."id"::text || ':' || NEW."shipped_qty"::text,
      COALESCE(
        transfer_record."shipped_at",
        CURRENT_TIMESTAMP::timestamp(3)
      )::timestamp(3),
      transfer_record."shipped_by",
      jsonb_build_object(
        'transfer_number', transfer_record."transfer_number"
      ),
      transfer_record."tenant_id"
    );
  END IF;

  IF received_delta > 0 THEN
    transit_cursor := transit_cursor - received_delta;

    PERFORM "record_inventory_movement"(
      transfer_record."to_branch_id"::uuid,
      NEW."variant_id"::uuid,
      'transfer_in'::"InventoryMovementType",
      received_delta::integer,
      0::integer,
      'Transfer'::text,
      NEW."transfer_id"::text,
      NEW."id"::text,
      (
        'transfer-in:' || NEW."id"::text || ':' ||
        NEW."received_qty"::text
      )::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by"::uuid,
      jsonb_build_object(
        'transfer_number', transfer_record."transfer_number"
      )::jsonb
    );

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by", "tenant_id"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'received'::"TransferTransitMovementType",
      -received_delta,
      transit_cursor,
      'transit-received:' || NEW."id"::text || ':' || NEW."received_qty"::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by",
      transfer_record."tenant_id"
    );
  END IF;

  IF damaged_delta > 0 THEN
    transit_cursor := transit_cursor - damaged_delta;

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by", "tenant_id"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'damaged'::"TransferTransitMovementType",
      -damaged_delta,
      transit_cursor,
      'transit-damaged:' || NEW."id"::text || ':' || NEW."damaged_qty"::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by",
      transfer_record."tenant_id"
    );
  END IF;

  IF missing_delta > 0 THEN
    transit_cursor := transit_cursor - missing_delta;

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by", "tenant_id"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'missing'::"TransferTransitMovementType",
      -missing_delta,
      transit_cursor,
      'transit-missing:' || NEW."id"::text || ':' || NEW."missing_qty"::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by",
      transfer_record."tenant_id"
    );
  END IF;

  IF transit_cursor <> final_transit THEN
    RAISE EXCEPTION
      'Transfer transit balance mismatch for item %: calculated %, materialized %',
      NEW."id",
      transit_cursor,
      final_transit;
  END IF;

  RETURN NEW;
END
$$;
