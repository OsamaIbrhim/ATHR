-- W2a: generic catalog (product types, variant attributes, barcode table) and
-- the SyncChange redesign (commit-order-safe cursor, per-entity triggers).

-- ======================================================================
-- 1. Tenant settings, sync floor, terminal cursor
-- ======================================================================
ALTER TABLE "Tenant"
  ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "sync_floor" TEXT NOT NULL DEFAULT '0:0';

ALTER TABLE "PosTerminal" ADD COLUMN "sync_cursor" TEXT;

-- ======================================================================
-- 2. Product types
-- ======================================================================
CREATE TABLE "ProductType" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductType_tenant_id_id_key" ON "ProductType"("tenant_id", "id");
CREATE UNIQUE INDEX "ProductType_tenant_id_name_en_key" ON "ProductType"("tenant_id", "name_en");
CREATE INDEX "ProductType_tenant_id_idx" ON "ProductType"("tenant_id");

ALTER TABLE "Product" ADD COLUMN "product_type_id" UUID;
CREATE INDEX "Product_tenant_id_product_type_id_idx" ON "Product"("tenant_id", "product_type_id");
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenant_id_product_type_id_fkey"
  FOREIGN KEY ("tenant_id", "product_type_id") REFERENCES "ProductType"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ======================================================================
-- 3. Variant attributes + label (converts the old size/color columns)
-- ======================================================================
ALTER TABLE "ProductVariant"
  ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "label" TEXT NOT NULL DEFAULT '';

-- Tenants that used size/color get one clothing type carrying both axes.
INSERT INTO "ProductType" ("id", "tenant_id", "name_ar", "name_en", "attributes", "updated_at")
SELECT gen_random_uuid(), t."tenant_id", 'ملابس', 'Clothing',
  '[{"key":"size","label_ar":"المقاس","label_en":"Size","kind":"text","axis":true},
    {"key":"color","label_ar":"اللون","label_en":"Color","kind":"text","axis":true}]'::jsonb,
  CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "tenant_id" FROM "ProductVariant" WHERE "size" IS NOT NULL OR "color" IS NOT NULL) t;

UPDATE "Product" p SET "product_type_id" = pt."id"
FROM "ProductType" pt
WHERE pt."tenant_id" = p."tenant_id" AND pt."name_en" = 'Clothing'
  AND EXISTS (SELECT 1 FROM "ProductVariant" v
              WHERE v."product_id" = p."id" AND (v."size" IS NOT NULL OR v."color" IS NOT NULL));

UPDATE "ProductVariant" SET
  "attributes" = jsonb_strip_nulls(jsonb_build_object('size', "size", 'color', "color")),
  "label" = concat_ws(' · ', "size", "color")
WHERE "size" IS NOT NULL OR "color" IS NOT NULL;

-- ======================================================================
-- 4. Barcodes
-- ======================================================================
CREATE TYPE "BarcodeKind" AS ENUM ('standard', 'scale_plu');

CREATE TABLE "ProductBarcode" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "variant_id" UUID NOT NULL,
    "pack_qty" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "kind" "BarcodeKind" NOT NULL DEFAULT 'standard',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductBarcode_tenant_id_code_key" ON "ProductBarcode"("tenant_id", "code");
CREATE INDEX "ProductBarcode_tenant_id_variant_id_idx" ON "ProductBarcode"("tenant_id", "variant_id");
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_tenant_id_variant_id_fkey"
  FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProductBarcode" ("id", "tenant_id", "code", "variant_id")
SELECT gen_random_uuid(), "tenant_id", "barcode_ean13", "id"
FROM "ProductVariant" WHERE "barcode_ean13" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "ProductBarcode" ("id", "tenant_id", "code", "variant_id")
SELECT gen_random_uuid(), "tenant_id", "barcode_internal", "id"
FROM "ProductVariant" WHERE "barcode_internal" IS NOT NULL
ON CONFLICT DO NOTHING;

DROP INDEX "ProductVariant_barcode_ean13_idx";
DROP INDEX "ProductVariant_tenant_id_barcode_internal_key";
ALTER TABLE "ProductVariant"
  DROP COLUMN "barcode_ean13",
  DROP COLUMN "barcode_internal",
  DROP COLUMN "size",
  DROP COLUMN "color",
  DROP COLUMN "style";

-- ======================================================================
-- 5. Sale line snapshot
-- ======================================================================
ALTER TABLE "SalesInvoiceItem" ADD COLUMN "variant_label_snapshot" VARCHAR(200);
UPDATE "SalesInvoiceItem"
SET "variant_label_snapshot" = NULLIF(concat_ws(' · ', "size_snapshot", "color_snapshot"), '');
ALTER TABLE "SalesInvoiceItem" DROP COLUMN "size_snapshot", DROP COLUMN "color_snapshot";

-- ======================================================================
-- 6. SyncChange: commit-order-safe cursor + delta-by-entity triggers
-- ======================================================================
ALTER TABLE "SyncChange" ADD COLUMN "txid" xid8 DEFAULT pg_current_xact_id();

DROP INDEX "SyncChange_branch_id_sequence_idx";
DROP INDEX "SyncChange_sequence_kind_idx";
DROP INDEX "SyncChange_tenant_id_idx";
CREATE INDEX "SyncChange_tenant_id_txid_sequence_idx" ON "SyncChange"("tenant_id", "txid", "sequence");
CREATE INDEX "SyncChange_tenant_id_branch_id_sequence_idx" ON "SyncChange"("tenant_id", "branch_id", "sequence");

-- One emitter for every entity: TG_ARGV[0] is the change kind, TG_ARGV[1] the
-- column holding the entity key. Product/variant/barcode/price/tax changes
-- name the row they concern; the POS re-reads just that entity.
DROP TRIGGER bold_product_tax_category_sync_change ON "Product";
DROP TRIGGER bold_variant_tax_category_sync_change ON "ProductVariant";
DROP TRIGGER bold_price_book_entry_sync_change ON "PriceBookEntry";
DROP TRIGGER bold_product_sync_change ON "Product";
DROP TRIGGER bold_variant_sync_change ON "ProductVariant";
DROP FUNCTION bold_emit_product_sync_change();
DROP FUNCTION bold_emit_variant_sync_change();

CREATE FUNCTION bold_emit_sync_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  rec jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
BEGIN
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
  VALUES (TG_ARGV[0], NULL, rec ->> TG_ARGV[1], CURRENT_TIMESTAMP, (rec ->> 'tenant_id')::uuid);
  RETURN NULL;
END;
$$;

CREATE TRIGGER bold_product_sync_change AFTER INSERT OR UPDATE OR DELETE ON "Product"
  FOR EACH ROW EXECUTE FUNCTION bold_emit_sync_change('product', 'id');
CREATE TRIGGER bold_variant_sync_change AFTER INSERT OR UPDATE OR DELETE ON "ProductVariant"
  FOR EACH ROW EXECUTE FUNCTION bold_emit_sync_change('variant', 'id');
CREATE TRIGGER bold_barcode_sync_change AFTER INSERT OR UPDATE OR DELETE ON "ProductBarcode"
  FOR EACH ROW EXECUTE FUNCTION bold_emit_sync_change('variant', 'variant_id');
CREATE TRIGGER bold_uom_sync_change AFTER UPDATE ON "UnitOfMeasure"
  FOR EACH ROW EXECUTE FUNCTION bold_emit_sync_change('uom', 'id');
CREATE TRIGGER bold_tenant_settings_sync_change AFTER UPDATE ON "Tenant"
  FOR EACH ROW WHEN (OLD."settings" IS DISTINCT FROM NEW."settings")
  EXECUTE FUNCTION bold_emit_sync_change('settings', 'id');

-- A price entry scoped to one variant/product only concerns that entity;
-- brand/category/global entries, rules and tax codes change many prices, so
-- they emit a catalog-wide 'pricing' change (the POS takes a fresh snapshot).
CREATE OR REPLACE FUNCTION bold_emit_pricing_sync_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  rec jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  scope text := rec ->> 'scope_type';
BEGIN
  IF TG_TABLE_NAME = 'PriceBookEntry' AND scope IN ('variant', 'product') THEN
    INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
    VALUES (scope, NULL, rec ->> 'scope_id', CURRENT_TIMESTAMP, (rec ->> 'tenant_id')::uuid);
  ELSE
    INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
    VALUES ('pricing', NULL, rec ->> 'id', CURRENT_TIMESTAMP, (rec ->> 'tenant_id')::uuid);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER bold_price_book_entry_sync_change AFTER INSERT OR UPDATE OR DELETE ON "PriceBookEntry"
  FOR EACH ROW EXECUTE FUNCTION bold_emit_pricing_sync_change();

-- The branch's seller list is sent only when it can have changed.
CREATE FUNCTION bold_emit_sellers_sync_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'Membership' THEN
    INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
    VALUES ('sellers', NULL, NULL, CURRENT_TIMESTAMP,
            CASE WHEN TG_OP = 'DELETE' THEN OLD."tenant_id" ELSE NEW."tenant_id" END);
  ELSIF TG_TABLE_NAME = 'AccessScopeAssignment' THEN
    INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
    SELECT 'sellers', NULL, NULL, CURRENT_TIMESTAMP, m."tenant_id"
    FROM "Membership" m
    WHERE m."id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."membership_id" ELSE NEW."membership_id" END;
  ELSE
    INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
    SELECT 'sellers', NULL, NULL, CURRENT_TIMESTAMP, m."tenant_id"
    FROM "Membership" m WHERE m."user_id" = NEW."id";
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER bold_sellers_membership_sync AFTER INSERT OR UPDATE OR DELETE ON "Membership"
  FOR EACH ROW EXECUTE FUNCTION bold_emit_sellers_sync_change();
CREATE TRIGGER bold_sellers_scope_sync AFTER INSERT OR UPDATE OR DELETE ON "AccessScopeAssignment"
  FOR EACH ROW EXECUTE FUNCTION bold_emit_sellers_sync_change();
CREATE TRIGGER bold_sellers_user_sync AFTER UPDATE ON "User"
  FOR EACH ROW WHEN (OLD."name" IS DISTINCT FROM NEW."name" OR OLD."is_active" IS DISTINCT FROM NEW."is_active")
  EXECUTE FUNCTION bold_emit_sellers_sync_change();

-- Stock changes keep the inventory engine's branch-targeted trigger; the txid
-- column default stamps them like every other change.
