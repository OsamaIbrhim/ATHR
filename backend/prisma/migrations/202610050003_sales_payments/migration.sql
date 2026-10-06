-- W3: split payments. `SalesInvoice.payment_method` becomes `SalesPayment` rows and a
-- return records how it was refunded. The DDL is what `prisma migrate diff` produces; the
-- data carry-over, which must run before the column is dropped, and the CHECKs are hand-written.

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'card', 'wallet', 'bank_transfer', 'credit', 'other');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('cash', 'credit', 'card', 'wallet', 'other');

-- CreateTable
CREATE TABLE "SalesPayment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sales_invoice_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "tendered" DECIMAL(14,2),
    "reference" VARCHAR(100),

    CONSTRAINT "SalesPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SalesPayment_amount_nonnegative" CHECK ("amount" >= 0)
);

-- CreateIndex
CREATE INDEX "SalesPayment_tenant_id_sales_invoice_id_idx" ON "SalesPayment"("tenant_id", "sales_invoice_id");

-- CreateIndex
CREATE INDEX "SalesPayment_tenant_id_method_idx" ON "SalesPayment"("tenant_id", "method");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPayment_sales_invoice_id_sequence_key" ON "SalesPayment"("sales_invoice_id", "sequence");

-- AddForeignKey
ALTER TABLE "SalesPayment" ADD CONSTRAINT "SalesPayment_tenant_id_sales_invoice_id_fkey" FOREIGN KEY ("tenant_id", "sales_invoice_id") REFERENCES "SalesInvoice"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing invoices: one payment of the whole total, in the method they were paid with.
INSERT INTO "SalesPayment" ("id", "tenant_id", "sales_invoice_id", "sequence", "method", "amount")
SELECT gen_random_uuid(), "tenant_id", "id", 1,
  CASE "payment_method"
    WHEN 'cash' THEN 'cash'
    WHEN 'card' THEN 'card'
    WHEN 'instapay' THEN 'bank_transfer'
    WHEN 'vodafone_cash' THEN 'wallet'
    ELSE 'other'
  END::"PaymentMethod",
  "total"
FROM "SalesInvoice";

-- AlterTable
ALTER TABLE "Return" ADD COLUMN "refund_method" "RefundMethod" NOT NULL DEFAULT 'cash';

-- Existing returns were refunded the way the original invoice was paid.
UPDATE "Return" r
SET "refund_method" = CASE i."payment_method"
    WHEN 'cash' THEN 'cash'
    WHEN 'card' THEN 'card'
    WHEN 'vodafone_cash' THEN 'wallet'
    ELSE 'other'
  END::"RefundMethod"
FROM "SalesInvoice" i
WHERE i."tenant_id" = r."tenant_id" AND i."id" = r."original_invoice_id";

-- DropIndex
DROP INDEX "SalesInvoice_branch_id_payment_method_occurred_at_idx";

-- AlterTable
ALTER TABLE "SalesInvoice" DROP COLUMN "payment_method";
