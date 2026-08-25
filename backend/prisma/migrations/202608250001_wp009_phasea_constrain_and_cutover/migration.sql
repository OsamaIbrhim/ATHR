-- WP-009 Phase A, PR2 -- constrain + application-code cutover. The atomic
-- half PR1 deferred: PR1 (202608220001-3) added a NULLABLE warehouse_id,
-- backfilled it, and changed nothing else. This migration does the part that
-- cannot be split further -- Prisma generates the compound-key `where` shape
-- directly from `@@id`/`@@unique`, so the InventoryStock primary-key swap and
-- every application-code call site that keys off it have to ship together
-- (see docs/wp/WP-009-inventory-and-stock.md §9.6).
--
-- Order inside this transaction, and why it is this order:
--   1. Precondition: zero NULL warehouse_id remain (PR1's own contract; this
--      is the migration that is about to rely on it structurally, so it gets
--      its own fail-loud check rather than surfacing as a bare NOT NULL
--      violation with no diagnostic).
--   2. Constrain both columns NOT NULL.
--   3. Swap InventoryStock's primary key from (branch_id, variant_id) to
--      (warehouse_id, variant_id). branch_id stays a real, stored, NOT NULL
--      column -- see the comment on InventoryStock.branch_id in
--      schema.prisma for why it is not derived at read time.
--   4. Drop the old 12-arg record_inventory_movement() and create the new
--      13-arg version (adds p_warehouse_id). No DEFAULT on the new
--      parameter, and the old signature is dropped explicitly in the same
--      transaction -- an old 12-arg call cannot resolve to anything (wrong
--      arg count) and cannot silently resolve to a stale overload (the old
--      overload no longer exists). This must happen before step 5, because
--      both trigger functions below call it.
--   5. Update the two triggers that call record_inventory_movement() from
--      inside the database, invisible from any service file:
--       - record_return_inventory_movement() (AFTER INSERT ON ReturnItem)
--       - record_transfer_item_movements() (AFTER UPDATE OF shipped_qty/
--         received_qty/damaged_qty/missing_qty ON TransferItem -- this is
--         record_transfer_inventory_movement's replacement: that function
--         and its AFTER UPDATE ON Transfer trigger were dropped by
--         202607230002_transfer_state_machine in favour of this one, which
--         resolves from_branch_id/to_branch_id from the Transfer row it
--         reads via TransferItem.transfer_id. Same risk, same fix, different
--         name than WP-009 Phase A's original framing -- see the PR
--         description.)
--      Each resolves its own warehouse from the branch id it already reads
--      off Return/Transfer, the same way 202608220003 backfilled: the
--      Location a Branch id-shares with, then that Location's default
--      Warehouse. Fails loud, naming the branch and tenant, if it cannot
--      resolve one -- never inserts a movement with a NULL or guessed
--      warehouse_id (CLAUDE.md §6).
--
-- No application data is touched by this migration -- every statement is
-- DDL or a function/trigger body replacement. The application-code call
-- sites (purchasing/sales/transfers services) ship in this same PR but are
-- plain TypeScript changes, not migration SQL.

BEGIN;

-- 1. Precondition -----------------------------------------------------------
DO $$
DECLARE
  stock_null INT;
  movement_null INT;
BEGIN
  SELECT count(*) INTO stock_null FROM "InventoryStock" WHERE "warehouse_id" IS NULL;
  IF stock_null <> 0 THEN
    RAISE EXCEPTION 'WP-009 Phase A PR2 precondition failed: % InventoryStock row(s) still have warehouse_id IS NULL. PR1''s backfill (202608220003) must have run and its post-check must have passed before this migration can apply.', stock_null;
  END IF;

  SELECT count(*) INTO movement_null FROM "InventoryMovement" WHERE "warehouse_id" IS NULL;
  IF movement_null <> 0 THEN
    RAISE EXCEPTION 'WP-009 Phase A PR2 precondition failed: % InventoryMovement row(s) still have warehouse_id IS NULL. PR1''s backfill (202608220003) must have run and its post-check must have passed before this migration can apply.', movement_null;
  END IF;
END $$;

-- 2. Constrain ----------------------------------------------------------------
ALTER TABLE "InventoryStock" ALTER COLUMN "warehouse_id" SET NOT NULL;
ALTER TABLE "InventoryMovement" ALTER COLUMN "warehouse_id" SET NOT NULL;

-- 3. Key swap on InventoryStock ----------------------------------------------
ALTER TABLE "InventoryStock" DROP CONSTRAINT "InventoryStock_pkey";
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_pkey" PRIMARY KEY ("warehouse_id", "variant_id");

-- 4. record_inventory_movement(): add p_warehouse_id -------------------------
DROP FUNCTION IF EXISTS "record_inventory_movement"(
  UUID, UUID, "InventoryMovementType", INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TIMESTAMP(3), UUID, JSONB
);

CREATE OR REPLACE FUNCTION "record_inventory_movement"(
  p_branch_id UUID,
  p_warehouse_id UUID,
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

  -- WP-009 Phase A PR2: InventoryStock's identity is now (warehouse_id,
  -- variant_id) -- lock and read keyed on that, not branch_id. branch_id is
  -- still read from the row (below, via v_tenant_id's sibling select is not
  -- needed -- tenant_id comes off the same row) purely to keep the
  -- signature's p_branch_id/p_warehouse_id both meaningful for the INSERT.
  SELECT stock."qty_on_hand", stock."qty_reserved", stock."tenant_id"
  INTO current_on_hand, current_reserved, v_tenant_id
  FROM "InventoryStock" stock
  WHERE stock."warehouse_id" = p_warehouse_id
    AND stock."variant_id" = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'InventoryStock row does not exist for warehouse % and variant % (branch %)', p_warehouse_id, p_variant_id, p_branch_id;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(movement."on_hand_delta"), 0),
    COALESCE(SUM(movement."reserved_delta"), 0)
  INTO movement_count, ledger_on_hand, ledger_reserved
  FROM "InventoryMovement" movement
  WHERE movement."warehouse_id" = p_warehouse_id
    AND movement."variant_id" = p_variant_id;

  IF existing_found THEN
    IF existing."branch_id" <> p_branch_id
       OR existing."warehouse_id" <> p_warehouse_id
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
        'Inventory ledger mismatch after idempotent replay for warehouse % variant %: ledger=(%,%), stock=(%,%)',
        p_warehouse_id,
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
      RAISE EXCEPTION 'Cannot infer a valid opening inventory balance for warehouse % and variant %', p_warehouse_id, p_variant_id;
    END IF;

    IF previous_on_hand <> 0 OR previous_reserved <> 0 THEN
      INSERT INTO "InventoryMovement" (
        "branch_id",
        "warehouse_id",
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
        p_warehouse_id,
        p_variant_id,
        'opening_balance',
        previous_on_hand::INTEGER,
        previous_reserved::INTEGER,
        previous_on_hand::INTEGER,
        previous_reserved::INTEGER,
        'InventoryStock',
        p_warehouse_id::text || ':' || p_variant_id::text,
        'auto-opening:' || p_warehouse_id::text || ':' || p_variant_id::text,
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
      'Inventory ledger mismatch for warehouse % variant %: ledger=(%,%), delta=(%,%), stock=(%,%)',
      p_warehouse_id,
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
    "warehouse_id",
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
    p_warehouse_id,
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

COMMENT ON FUNCTION "record_inventory_movement"(
  UUID,
  UUID,
  UUID,
  "InventoryMovementType",
  INTEGER,
  INTEGER,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TIMESTAMP WITHOUT TIME ZONE,
  UUID,
  JSONB
) IS
  'Audits an inventory balance already mutated inside the owning business transaction, keyed on (warehouse_id, variant_id) since WP-009 Phase A PR2. Sales are written explicitly by SalesService; returns and transfers retain their semantic database triggers, which resolve warehouse_id themselves from the branch id on the Return/Transfer row.';

-- 5. Trigger functions: resolve warehouse_id from the branch already read ---

-- record_return_inventory_movement(): fires AFTER INSERT ON ReturnItem,
-- deferred to end of transaction. Resolves branch_id from Return already;
-- now also resolves that branch's default Warehouse the same way
-- 202608220003 backfilled existing rows (Warehouse.location_id = branch id,
-- is_default = true), and fails loud, naming the branch and tenant, if none
-- resolves -- never records a movement with a guessed or NULL warehouse_id.
CREATE OR REPLACE FUNCTION "record_return_inventory_movement"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  return_branch_id UUID;
  return_tenant_id UUID;
  return_number TEXT;
  return_status "ReturnStatus";
  return_created_at TIMESTAMP(3);
  return_created_by UUID;
  original_invoice_id UUID;
  v_warehouse_id UUID;
BEGIN
  SELECT
    return_record."branch_id",
    return_record."tenant_id",
    return_record."return_invoice_number",
    return_record."status",
    return_record."created_at",
    return_record."created_by",
    return_record."original_invoice_id"
  INTO
    return_branch_id,
    return_tenant_id,
    return_number,
    return_status,
    return_created_at,
    return_created_by,
    original_invoice_id
  FROM "Return" return_record
  WHERE return_record."id" = NEW."return_id";

  IF return_status <> 'completed'::"ReturnStatus" THEN
    RETURN NEW;
  END IF;

  SELECT w."id"
  INTO v_warehouse_id
  FROM "Warehouse" w
  WHERE w."location_id" = return_branch_id
    AND w."is_default" = true
    AND w."tenant_id" = return_tenant_id;

  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve a default Warehouse for Return % (branch %, tenant %) -- inventory movement cannot be recorded without a warehouse', NEW."return_id", return_branch_id, return_tenant_id;
  END IF;

  PERFORM "record_inventory_movement"(
    return_branch_id,
    v_warehouse_id,
    NEW."variant_id",
    'return'::"InventoryMovementType",
    NEW."qty"::integer,
    0::integer,
    'Return'::text,
    NEW."return_id"::text,
    NEW."id"::text,
    ('return:' || NEW."id"::text)::text,
    return_created_at::timestamp(3),
    return_created_by::uuid,
    jsonb_build_object(
      'return_invoice_number', return_number,
      'original_invoice_id', original_invoice_id
    )::jsonb
  );

  RETURN NEW;
END
$$;

-- record_transfer_item_movements(): fires AFTER UPDATE OF shipped_qty,
-- received_qty, damaged_qty, missing_qty ON TransferItem, deferred. This is
-- record_transfer_inventory_movement's replacement (that function and its
-- AFTER UPDATE ON Transfer trigger were dropped by
-- 202607230002_transfer_state_machine) -- same risk WP-009 Phase A named
-- (branch resolved inside the database, invisible from any service file),
-- different function/table than the original framing.
--
-- Two independent warehouse resolutions, not one: shipped_delta debits
-- from_branch_id's warehouse, received_delta credits to_branch_id's
-- warehouse, and a single UPDATE can in principle move both deltas at once.
-- Each is resolved only inside the branch that needs it, so a transfer that
-- only ships never depends on the destination branch having a resolvable
-- warehouse, and vice versa.
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
  v_from_warehouse_id UUID;
  v_to_warehouse_id UUID;
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

    SELECT w."id"
    INTO v_from_warehouse_id
    FROM "Warehouse" w
    WHERE w."location_id" = transfer_record."from_branch_id"
      AND w."is_default" = true
      AND w."tenant_id" = transfer_record."tenant_id";

    IF v_from_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'Cannot resolve a default Warehouse for Transfer % (from_branch %, tenant %) -- inventory movement cannot be recorded without a warehouse', NEW."transfer_id", transfer_record."from_branch_id", transfer_record."tenant_id";
    END IF;

    PERFORM "record_inventory_movement"(
      transfer_record."from_branch_id"::uuid,
      v_from_warehouse_id,
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

    SELECT w."id"
    INTO v_to_warehouse_id
    FROM "Warehouse" w
    WHERE w."location_id" = transfer_record."to_branch_id"
      AND w."is_default" = true
      AND w."tenant_id" = transfer_record."tenant_id";

    IF v_to_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'Cannot resolve a default Warehouse for Transfer % (to_branch %, tenant %) -- inventory movement cannot be recorded without a warehouse', NEW."transfer_id", transfer_record."to_branch_id", transfer_record."tenant_id";
    END IF;

    PERFORM "record_inventory_movement"(
      transfer_record."to_branch_id"::uuid,
      v_to_warehouse_id,
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

COMMIT;
