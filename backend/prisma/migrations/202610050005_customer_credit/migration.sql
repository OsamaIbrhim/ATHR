-- W3: sales on credit. A customer carries a balance (what they owe) and an optional credit limit; every change
-- is a CustomerLedgerEntry. The DDL is what `prisma migrate diff` produces; the sign CHECKs and the append-only
-- trigger are hand-written.

-- CreateEnum
CREATE TYPE "CustomerLedgerType" AS ENUM ('sale_credit', 'payment', 'refund_credit', 'adjustment');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "credit_limit" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "CustomerLedgerEntry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "CustomerLedgerType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balance_after" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod",
    "sales_invoice_id" UUID,
    "return_id" UUID,
    "shift_id" UUID,
    "idempotency_key" VARCHAR(191),
    "note" VARCHAR(300),
    "created_by" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerLedgerEntry_tenant_id_customer_id_occurred_at_id_idx" ON "CustomerLedgerEntry"("tenant_id", "customer_id", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "CustomerLedgerEntry_tenant_id_shift_id_idx" ON "CustomerLedgerEntry"("tenant_id", "shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerLedgerEntry_tenant_id_idempotency_key_key" ON "CustomerLedgerEntry"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "Customer_tenant_id_balance_idx" ON "Customer"("tenant_id", "balance");

-- AddForeignKey
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "Customer"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_tenant_id_sales_invoice_id_fkey" FOREIGN KEY ("tenant_id", "sales_invoice_id") REFERENCES "SalesInvoice"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_tenant_id_return_id_fkey" FOREIGN KEY ("tenant_id", "return_id") REFERENCES "Return"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_tenant_id_shift_id_fkey" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "Shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A sale on credit adds to what the customer owes; a payment or a refund to the account takes from it.
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_amount_sign" CHECK (
  ("type" = 'sale_credit' AND "amount" > 0)
  OR ("type" IN ('payment', 'refund_credit') AND "amount" < 0)
  OR ("type" = 'adjustment' AND "amount" <> 0)
);

-- Append-only: a correction is a new entry.
CREATE FUNCTION athr_customer_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CustomerLedgerEntry is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER athr_customer_ledger_no_change BEFORE UPDATE OR DELETE ON "CustomerLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION athr_customer_ledger_immutable();
