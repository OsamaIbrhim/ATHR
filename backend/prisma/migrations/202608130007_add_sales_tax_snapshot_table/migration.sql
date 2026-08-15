-- WP-008 Phase C (BR-TAX-202/203) -- the tax snapshot.
--
-- BR-TAX-202: "تتضمن code/rate/base/amount/mode/version" -- all six are
-- columns here, denormalised on purpose. Reading what a historical document
-- was taxed must never require a join to a row that may since have changed;
-- that join IS the bug BR-TAX-203 forbids.
--
-- One row per (invoice line, tax component). The MVP writes exactly one row
-- per line, but BR-TAX-207 is classified "Architecture Requirement" and says
-- the domain must not preclude multiple components later:
--   "حتى لو بدأ MVP بضريبة واحدة، يجب ألا يمنع Domain وجود Components متعددة".
-- Six flat columns on "SalesInvoiceItem" would have precluded it; this does
-- not.

-- CreateTable
CREATE TABLE "SalesTaxSnapshot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sales_invoice_id" UUID NOT NULL,
    "sales_invoice_item_id" UUID NOT NULL,
    "tax_code_id" UUID NOT NULL,
    "code_snapshot" TEXT NOT NULL,
    "rate_snapshot" DECIMAL(7,4) NOT NULL,
    "base_amount" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL,
    "mode_snapshot" "TaxMode" NOT NULL,
    "version_snapshot" INTEGER NOT NULL,
    "rounding_policy_snapshot" "TaxRoundingPolicy" NOT NULL,
    "exemption_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesTaxSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesTaxSnapshot_tenant_id_idx" ON "SalesTaxSnapshot"("tenant_id");

-- CreateIndex
CREATE INDEX "SalesTaxSnapshot_tenant_id_sales_invoice_id_idx" ON "SalesTaxSnapshot"("tenant_id", "sales_invoice_id");

-- CreateIndex
CREATE INDEX "SalesTaxSnapshot_sales_invoice_item_id_idx" ON "SalesTaxSnapshot"("sales_invoice_item_id");

-- CreateIndex
CREATE INDEX "SalesTaxSnapshot_tenant_id_tax_code_id_idx" ON "SalesTaxSnapshot"("tenant_id", "tax_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesTaxSnapshot_tenant_id_id_key" ON "SalesTaxSnapshot"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "SalesTaxSnapshot" ADD CONSTRAINT "SalesTaxSnapshot_tenant_id_sales_invoice_id_fkey" FOREIGN KEY ("tenant_id", "sales_invoice_id") REFERENCES "SalesInvoice"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTaxSnapshot" ADD CONSTRAINT "SalesTaxSnapshot_tenant_id_sales_invoice_item_id_fkey" FOREIGN KEY ("tenant_id", "sales_invoice_item_id") REFERENCES "SalesInvoiceItem"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE: a TaxCode any document snapshotted can never be
-- deleted out from under its own evidence.
-- AddForeignKey
ALTER TABLE "SalesTaxSnapshot" ADD CONSTRAINT "SalesTaxSnapshot_tenant_id_tax_code_id_fkey" FOREIGN KEY ("tenant_id", "tax_code_id") REFERENCES "TaxCode"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTaxSnapshot" ADD CONSTRAINT "SalesTaxSnapshot_tenant_id_exemption_id_fkey" FOREIGN KEY ("tenant_id", "exemption_id") REFERENCES "TaxExemption"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BR-TAX-203 enforced by the database, not by convention.
--
-- "تغير المعدل لا يغير الماضي" is the central invariant of this phase. An
-- application-layer rule ("never update this table") holds only as long as
-- every future caller remembers it -- and Phase B shipped a permission key
-- that was declared, granted, and enforced at zero call sites, so "we will
-- remember" has already failed once on this codebase.
--
-- UPDATE is rejected. A correction is a corrective document (BR-TAX-206),
-- never an edit to what was reported.
--
-- DELETE is deliberately NOT blocked. The snapshot's whole purpose is to be
-- evidence for a specific document; if that document is gone, the row has
-- nothing left to attest to, and both FKs above are ON DELETE CASCADE for
-- that reason. Blocking DELETE would also break "prisma/seed.ts", which
-- clears "SalesInvoice" wholesale -- and a trigger that makes the seed fail
-- would be caught in migration-gate's populated path, not in production, so
-- this is a real constraint and not a hypothetical one.
CREATE OR REPLACE FUNCTION "athr_sales_tax_snapshot_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'SalesTaxSnapshot is append-only (BR-TAX-203): updating snapshot % would rewrite the tax a completed document already reported. Issue a corrective document instead.',
    OLD."id"
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "athr_sales_tax_snapshot_no_update"
BEFORE UPDATE ON "SalesTaxSnapshot"
FOR EACH ROW EXECUTE FUNCTION "athr_sales_tax_snapshot_immutable"();
