-- Sales protocol v2 makes the locally completed sale the immutable commercial
-- record. Price/catalog drift is stored as a warning instead of rejecting the
-- invoice, while sync_id and terminal sequence uniqueness remain enforced.
ALTER TABLE "ProductVariant"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SalesInvoice"
  ADD COLUMN "event_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "warning_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "cashier_name_snapshot" VARCHAR(200),
  ADD COLUMN "seller_name_snapshot" VARCHAR(200);

ALTER TABLE "SalesInvoiceItem"
  ADD COLUMN "sku_snapshot" VARCHAR(191),
  ADD COLUMN "name_ar_snapshot" VARCHAR(300),
  ADD COLUMN "name_en_snapshot" VARCHAR(300),
  ADD COLUMN "size_snapshot" VARCHAR(100),
  ADD COLUMN "color_snapshot" VARCHAR(100);

DROP TABLE IF EXISTS "PosTerminalSequenceVoid";
DROP TABLE IF EXISTS "PosSaleReview";
DROP TYPE IF EXISTS "PosSaleReviewDecision";
DROP TYPE IF EXISTS "PosSaleReviewStatus";
