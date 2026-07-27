CREATE TYPE "PosSaleReviewStatus" AS ENUM (
  'pending',
  'processing',
  'approved',
  'rejected',
  'linked'
);

CREATE TYPE "PosSaleReviewDecision" AS ENUM (
  'approve_reissue',
  'reject_void',
  'link_existing'
);

CREATE TABLE "PosSaleReview" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sync_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "terminal_id" UUID NOT NULL,
  "origin_cashier_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "shift_id" UUID NOT NULL,
  "terminal_sequence" BIGINT NOT NULL,
  "local_invoice_number" VARCHAR(120) NOT NULL,
  "local_total" DECIMAL(12,2) NOT NULL,
  "command" JSONB NOT NULL,
  "command_fingerprint" VARCHAR(64) NOT NULL,
  "ticket_key_id" VARCHAR(32),
  "error_code" VARCHAR(100) NOT NULL,
  "error_message" VARCHAR(1000) NOT NULL,
  "source_request_id" VARCHAR(100),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "status" "PosSaleReviewStatus" NOT NULL DEFAULT 'pending',
  "decision" "PosSaleReviewDecision",
  "submitted_by" UUID NOT NULL,
  "reviewed_by" UUID,
  "review_reason" VARCHAR(500),
  "resolution_error" VARCHAR(1000),
  "linked_invoice_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PosSaleReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PosSaleReview_local_total_nonnegative"
    CHECK ("local_total" >= 0),
  CONSTRAINT "PosSaleReview_attempt_count_nonnegative"
    CHECK ("attempt_count" >= 0),
  CONSTRAINT "PosSaleReview_terminal_sequence_positive"
    CHECK ("terminal_sequence" > 0)
);

CREATE TABLE "PosTerminalSequenceVoid" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sync_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "terminal_id" UUID NOT NULL,
  "sequence" BIGINT NOT NULL,
  "approved_by" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PosTerminalSequenceVoid_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PosTerminalSequenceVoid_sequence_positive"
    CHECK ("sequence" > 0)
);

CREATE UNIQUE INDEX "PosTerminalSequenceVoid_sync_id_key"
  ON "PosTerminalSequenceVoid"("sync_id");
CREATE UNIQUE INDEX "PosTerminalSequenceVoid_terminal_sequence_key"
  ON "PosTerminalSequenceVoid"("terminal_id", "sequence");
CREATE INDEX "PosTerminalSequenceVoid_branch_created_idx"
  ON "PosTerminalSequenceVoid"("branch_id", "created_at" DESC);
CREATE INDEX "PosTerminalSequenceVoid_terminal_created_idx"
  ON "PosTerminalSequenceVoid"("terminal_id", "created_at" DESC);

CREATE UNIQUE INDEX "PosSaleReview_sync_id_key"
  ON "PosSaleReview"("sync_id");
CREATE UNIQUE INDEX "PosSaleReview_linked_invoice_id_key"
  ON "PosSaleReview"("linked_invoice_id");
CREATE INDEX "PosSaleReview_branch_status_created_idx"
  ON "PosSaleReview"("branch_id", "status", "created_at" DESC);
CREATE INDEX "PosSaleReview_terminal_status_created_idx"
  ON "PosSaleReview"("terminal_id", "status", "created_at" DESC);
CREATE INDEX "PosSaleReview_shift_status_idx"
  ON "PosSaleReview"("shift_id", "status");
CREATE INDEX "PosSaleReview_origin_cashier_created_idx"
  ON "PosSaleReview"("origin_cashier_id", "created_at" DESC);

ALTER TABLE "PosSaleReview"
  ADD CONSTRAINT "PosSaleReview_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSaleReview"
  ADD CONSTRAINT "PosSaleReview_terminal_id_fkey"
  FOREIGN KEY ("terminal_id") REFERENCES "PosTerminal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSaleReview"
  ADD CONSTRAINT "PosSaleReview_origin_cashier_id_fkey"
  FOREIGN KEY ("origin_cashier_id") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSaleReview"
  ADD CONSTRAINT "PosSaleReview_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSaleReview"
  ADD CONSTRAINT "PosSaleReview_shift_id_fkey"
  FOREIGN KEY ("shift_id") REFERENCES "Shift"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSaleReview"
  ADD CONSTRAINT "PosSaleReview_submitted_by_fkey"
  FOREIGN KEY ("submitted_by") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSaleReview"
  ADD CONSTRAINT "PosSaleReview_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PosSaleReview"
  ADD CONSTRAINT "PosSaleReview_linked_invoice_id_fkey"
  FOREIGN KEY ("linked_invoice_id") REFERENCES "SalesInvoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PosTerminalSequenceVoid"
  ADD CONSTRAINT "PosTerminalSequenceVoid_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosTerminalSequenceVoid"
  ADD CONSTRAINT "PosTerminalSequenceVoid_terminal_id_fkey"
  FOREIGN KEY ("terminal_id") REFERENCES "PosTerminal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosTerminalSequenceVoid"
  ADD CONSTRAINT "PosTerminalSequenceVoid_approved_by_fkey"
  FOREIGN KEY ("approved_by") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
