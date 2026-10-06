-- W1c: index cleanup. No table or column changes.
--
-- Dropped: every plain (tenant_id) index that is a strict prefix of a
-- tenant-led unique or index the same table already has (the (tenant_id, id)
-- unique that backs the composite tenant foreign keys, or another
-- (tenant_id, ...) index), so it only cost write time.
--
-- Added / made tenant-led, each for a query in the code:
--   SalesInvoice (tenant_id, occurred_at DESC, id DESC)    sales list order + report windows
--   SalesInvoice (tenant_id, branch_id, occurred_at)       branch-scoped list and reports
--   Return       (tenant_id, created_at)                   report window over returns
--   ReturnItem   (tenant_id, return_id)                    report join Return -> ReturnItem
--   AuditLog     (tenant_id, created_at)                   per-tenant audit trail by time
--   Shift        (tenant_id, opened_at DESC)               shifts list (tenant-wide)
--   Transfer     (tenant_id, created_at)                   transfers list
--   PurchaseInvoice (tenant_id, received_at)               purchase invoice list
--   OfferSuggestion (tenant_id, status, created_at DESC)   pending suggestions page
--
-- DropIndex
DROP INDEX "Assortment_tenant_id_idx";
-- DropIndex
DROP INDEX "AuditLog_tenant_id_idx";
-- DropIndex
DROP INDEX "Branch_tenant_id_idx";
-- DropIndex
DROP INDEX "Brand_tenant_id_idx";
-- DropIndex
DROP INDEX "Bundle_tenant_id_idx";
-- DropIndex
DROP INDEX "BundleComponent_tenant_id_idx";
-- DropIndex
DROP INDEX "Category_tenant_id_idx";
-- DropIndex
DROP INDEX "Coupon_tenant_id_idx";
-- DropIndex
DROP INDEX "CouponRedemption_tenant_id_idx";
-- DropIndex
DROP INDEX "Customer_tenant_id_idx";
-- DropIndex
DROP INDEX "Discount_tenant_id_idx";
-- DropIndex
DROP INDEX "InventoryCostMovement_tenant_id_idx";
-- DropIndex
DROP INDEX "InventoryMovement_tenant_id_idx";
-- DropIndex
DROP INDEX "InventoryStock_tenant_id_idx";
-- DropIndex
DROP INDEX "Invitation_tenant_id_idx";
-- DropIndex
DROP INDEX "OfferSuggestion_tenant_id_idx";
-- DropIndex
DROP INDEX "PosTerminal_tenant_id_idx";
-- DropIndex
DROP INDEX "PriceBook_tenant_id_idx";
-- DropIndex
DROP INDEX "PriceBookEntry_tenant_id_idx";
-- DropIndex
DROP INDEX "PriceOverride_tenant_id_idx";
-- DropIndex
DROP INDEX "PriceOverridePolicy_tenant_id_idx";
-- DropIndex
DROP INDEX "Promotion_tenant_id_idx";
-- DropIndex
DROP INDEX "PurchaseInvoice_tenant_id_idx";
-- DropIndex
DROP INDEX "PurchaseInvoiceItem_tenant_id_idx";
-- DropIndex
DROP INDEX "Return_tenant_id_idx";
-- DropIndex
DROP INDEX "ReturnItem_tenant_id_idx";
-- DropIndex
DROP INDEX "SalesInvoice_branch_id_occurred_at_idx";
-- DropIndex
DROP INDEX "SalesInvoice_occurred_at_id_idx";
-- DropIndex
DROP INDEX "SalesInvoice_tenant_id_idx";
-- DropIndex
DROP INDEX "SalesInvoiceItem_tenant_id_idx";
-- DropIndex
DROP INDEX "SalesTaxSnapshot_tenant_id_idx";
-- DropIndex
DROP INDEX "SellerCommissionPeriod_tenant_id_idx";
-- DropIndex
DROP INDEX "Shift_tenant_id_idx";
-- DropIndex
DROP INDEX "Supplier_tenant_id_idx";
-- DropIndex
DROP INDEX "SupplierReturn_tenant_id_idx";
-- DropIndex
DROP INDEX "SupplierReturnItem_tenant_id_idx";
-- DropIndex
DROP INDEX "SupportAccessGrant_tenant_id_idx";
-- DropIndex
DROP INDEX "TaxCategory_tenant_id_idx";
-- DropIndex
DROP INDEX "TaxCode_tenant_id_idx";
-- DropIndex
DROP INDEX "TaxExemption_tenant_id_idx";
-- DropIndex
DROP INDEX "Transfer_tenant_id_idx";
-- DropIndex
DROP INDEX "TransferCommand_tenant_id_idx";
-- DropIndex
DROP INDEX "TransferItem_tenant_id_idx";
-- DropIndex
DROP INDEX "TransferTransitMovement_tenant_id_idx";
-- DropIndex
DROP INDEX "UnitOfMeasure_tenant_id_idx";
-- DropIndex
DROP INDEX "UomConversion_tenant_id_idx";
-- DropIndex
DROP INDEX "Warehouse_tenant_id_idx";
-- CreateIndex
CREATE INDEX "AuditLog_tenant_id_created_at_idx" ON "AuditLog"("tenant_id", "created_at");
-- CreateIndex
CREATE INDEX "OfferSuggestion_tenant_id_status_created_at_idx" ON "OfferSuggestion"("tenant_id", "status", "created_at" DESC);
-- CreateIndex
CREATE INDEX "PurchaseInvoice_tenant_id_received_at_idx" ON "PurchaseInvoice"("tenant_id", "received_at");
-- CreateIndex
CREATE INDEX "Return_tenant_id_created_at_idx" ON "Return"("tenant_id", "created_at");
-- CreateIndex
CREATE INDEX "ReturnItem_tenant_id_return_id_idx" ON "ReturnItem"("tenant_id", "return_id");
-- CreateIndex
CREATE INDEX "SalesInvoice_tenant_id_branch_id_occurred_at_idx" ON "SalesInvoice"("tenant_id", "branch_id", "occurred_at");
-- CreateIndex
CREATE INDEX "SalesInvoice_tenant_id_occurred_at_id_idx" ON "SalesInvoice"("tenant_id", "occurred_at" DESC, "id" DESC);
-- CreateIndex
CREATE INDEX "Shift_tenant_id_opened_at_idx" ON "Shift"("tenant_id", "opened_at" DESC);
-- CreateIndex
CREATE INDEX "Transfer_tenant_id_created_at_idx" ON "Transfer"("tenant_id", "created_at");
