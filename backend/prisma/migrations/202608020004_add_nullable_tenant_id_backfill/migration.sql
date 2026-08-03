-- WP-005 Phase B, MT-MIG-004 (expand-only): adds a NULLABLE tenant_id column
-- to every table identified as tenant-owned (Identifier Classification
-- Matrix, Code Gap Analysis 2026-07-29, and a fresh read of schema.prisma),
-- then backfills every row to the Initial ATHR Demo Tenant via its ownership
-- chain where one exists, or unconditionally where none exists (this dataset
-- has exactly one Tenant, so both paths converge on the same value — the
-- pre-migration validator at backend/scripts/validate-tenant-backfill.cjs
-- must be run and pass with zero ambiguous rows before this migration is
-- applied). tenant_id is NOT made NOT NULL here and no composite foreign key
-- or tenant-scoped uniqueness is added — that is MT-MIG-006 (WP-007).
DO $$
BEGIN
  IF (SELECT count(*) FROM "Tenant" WHERE name = 'Initial ATHR Demo Tenant') <> 1 THEN
    RAISE EXCEPTION 'MT-MIG-004 precondition failed: expected exactly one "Initial ATHR Demo Tenant" row in "Tenant", found %.',
      (SELECT count(*) FROM "Tenant" WHERE name = 'Initial ATHR Demo Tenant');
  END IF;
END $$;

-- The tables below carry existing append-only / immutable-document triggers
-- (InventoryMovement, InventoryCostMovement, PurchaseInvoice/Item,
-- SupplierReturn/Item, Transfer/Item/Command/TransitMovement) that reject any
-- UPDATE outside their normal command path. This migration's UPDATEs only
-- touch the new tenant_id column and must bypass those guards; each flag is
-- transaction-local (SET LOCAL) and reverts automatically at commit.
SET LOCAL "bold.inventory_ledger_maintenance" = 'on';
SET LOCAL "bold.inventory_cost_ledger_maintenance" = 'on';
SET LOCAL "bold.purchase_accounting_document_write" = 'on';
SET LOCAL "bold.transfer_maintenance" = 'on';

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "SellerCommissionSettings" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "SellerCommissionOverride" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "SellerCommissionPeriod" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "SellerCommissionPeriodRow" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "PricingRule" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "InventoryStock" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "InventoryCostMovement" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "PosTerminal" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "PosTerminalEnrollment" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "SyncChange" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "SalesInvoiceItem" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "Return" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "ReturnItem" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "PurchaseInvoice" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "SupplierReturn" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "SupplierReturnItem" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "TransferItem" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "TransferCommand" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "TransferTransitMovement" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "OfferSuggestion" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "tenant_id" UUID;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "tenant_id" UUID;

-- CreateIndex
CREATE INDEX "Branch_tenant_id_idx" ON "Branch"("tenant_id");

-- CreateIndex
CREATE INDEX "SellerCommissionSettings_tenant_id_idx" ON "SellerCommissionSettings"("tenant_id");

-- CreateIndex
CREATE INDEX "SellerCommissionOverride_tenant_id_idx" ON "SellerCommissionOverride"("tenant_id");

-- CreateIndex
CREATE INDEX "SellerCommissionPeriod_tenant_id_idx" ON "SellerCommissionPeriod"("tenant_id");

-- CreateIndex
CREATE INDEX "SellerCommissionPeriodRow_tenant_id_idx" ON "SellerCommissionPeriodRow"("tenant_id");

-- CreateIndex
CREATE INDEX "Supplier_tenant_id_idx" ON "Supplier"("tenant_id");

-- CreateIndex
CREATE INDEX "Category_tenant_id_idx" ON "Category"("tenant_id");

-- CreateIndex
CREATE INDEX "Product_tenant_id_idx" ON "Product"("tenant_id");

-- CreateIndex
CREATE INDEX "ProductVariant_tenant_id_idx" ON "ProductVariant"("tenant_id");

-- CreateIndex
CREATE INDEX "PricingRule_tenant_id_idx" ON "PricingRule"("tenant_id");

-- CreateIndex
CREATE INDEX "InventoryStock_tenant_id_idx" ON "InventoryStock"("tenant_id");

-- CreateIndex
CREATE INDEX "InventoryMovement_tenant_id_idx" ON "InventoryMovement"("tenant_id");

-- CreateIndex
CREATE INDEX "InventoryCostMovement_tenant_id_idx" ON "InventoryCostMovement"("tenant_id");

-- CreateIndex
CREATE INDEX "Customer_tenant_id_idx" ON "Customer"("tenant_id");

-- CreateIndex
CREATE INDEX "SalesInvoice_tenant_id_idx" ON "SalesInvoice"("tenant_id");

-- CreateIndex
CREATE INDEX "PosTerminal_tenant_id_idx" ON "PosTerminal"("tenant_id");

-- CreateIndex
CREATE INDEX "PosTerminalEnrollment_tenant_id_idx" ON "PosTerminalEnrollment"("tenant_id");

-- CreateIndex
CREATE INDEX "SyncChange_tenant_id_idx" ON "SyncChange"("tenant_id");

-- CreateIndex
CREATE INDEX "SalesInvoiceItem_tenant_id_idx" ON "SalesInvoiceItem"("tenant_id");

-- CreateIndex
CREATE INDEX "Return_tenant_id_idx" ON "Return"("tenant_id");

-- CreateIndex
CREATE INDEX "ReturnItem_tenant_id_idx" ON "ReturnItem"("tenant_id");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_tenant_id_idx" ON "PurchaseInvoice"("tenant_id");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceItem_tenant_id_idx" ON "PurchaseInvoiceItem"("tenant_id");

-- CreateIndex
CREATE INDEX "SupplierReturn_tenant_id_idx" ON "SupplierReturn"("tenant_id");

-- CreateIndex
CREATE INDEX "SupplierReturnItem_tenant_id_idx" ON "SupplierReturnItem"("tenant_id");

-- CreateIndex
CREATE INDEX "Transfer_tenant_id_idx" ON "Transfer"("tenant_id");

-- CreateIndex
CREATE INDEX "TransferItem_tenant_id_idx" ON "TransferItem"("tenant_id");

-- CreateIndex
CREATE INDEX "TransferCommand_tenant_id_idx" ON "TransferCommand"("tenant_id");

-- CreateIndex
CREATE INDEX "TransferTransitMovement_tenant_id_idx" ON "TransferTransitMovement"("tenant_id");

-- CreateIndex
CREATE INDEX "OfferSuggestion_tenant_id_idx" ON "OfferSuggestion"("tenant_id");

-- CreateIndex
CREATE INDEX "AuditLog_tenant_id_idx" ON "AuditLog"("tenant_id");

-- CreateIndex
CREATE INDEX "Shift_tenant_id_idx" ON "Shift"("tenant_id");

-- Phase 1: tables resolved directly via a (possibly nullable) branch_id/
-- from_branch_id chain to Location (Location.id === legacy Branch.id).
-- COALESCE falls back to the Initial Tenant for rows with no branch link.
UPDATE "Branch" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."id";

UPDATE "InventoryStock" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id";

UPDATE "InventoryMovement" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id";

UPDATE "InventoryCostMovement" x SET "tenant_id" = COALESCE(
  (SELECT l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id"),
  (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant')
);

UPDATE "SalesInvoice" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id";

UPDATE "PosTerminal" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id";

UPDATE "PosTerminalEnrollment" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id";

UPDATE "Return" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id";

UPDATE "PurchaseInvoice" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id";

UPDATE "SupplierReturn" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id";

UPDATE "Transfer" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."from_branch_id";

UPDATE "OfferSuggestion" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id";

UPDATE "Shift" x SET "tenant_id" = l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id";

-- Phase 2: tables with no ownership chain in the current schema — every row
-- is unconditionally assigned to the Initial ATHR Demo Tenant, the only
-- Tenant that exists.
UPDATE "SellerCommissionSettings" SET "tenant_id" = (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant');
UPDATE "SellerCommissionOverride" SET "tenant_id" = (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant');
UPDATE "SellerCommissionPeriod" SET "tenant_id" = (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant');
UPDATE "Supplier" SET "tenant_id" = (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant');
UPDATE "Category" SET "tenant_id" = (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant');
UPDATE "Product" SET "tenant_id" = (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant');
UPDATE "Customer" SET "tenant_id" = (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant');
UPDATE "PricingRule" SET "tenant_id" = (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant');
UPDATE "AuditLog" SET "tenant_id" = (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant');

-- Phase 3: tables resolved via an already-backfilled parent row (phase 1/2
-- above must run first).
UPDATE "SalesInvoiceItem" x SET "tenant_id" = p."tenant_id" FROM "SalesInvoice" p WHERE p."id" = x."sales_invoice_id";
UPDATE "ReturnItem" x SET "tenant_id" = p."tenant_id" FROM "Return" p WHERE p."id" = x."return_id";
UPDATE "PurchaseInvoiceItem" x SET "tenant_id" = p."tenant_id" FROM "PurchaseInvoice" p WHERE p."id" = x."purchase_invoice_id";
UPDATE "SupplierReturnItem" x SET "tenant_id" = p."tenant_id" FROM "SupplierReturn" p WHERE p."id" = x."supplier_return_id";
UPDATE "TransferItem" x SET "tenant_id" = p."tenant_id" FROM "Transfer" p WHERE p."id" = x."transfer_id";
UPDATE "TransferCommand" x SET "tenant_id" = p."tenant_id" FROM "Transfer" p WHERE p."id" = x."transfer_id";
UPDATE "TransferTransitMovement" x SET "tenant_id" = p."tenant_id" FROM "Transfer" p WHERE p."id" = x."transfer_id";
UPDATE "ProductVariant" x SET "tenant_id" = p."tenant_id" FROM "Product" p WHERE p."id" = x."product_id";
UPDATE "SellerCommissionPeriodRow" x SET "tenant_id" = p."tenant_id" FROM "SellerCommissionPeriod" p WHERE p."id" = x."period_id";

-- SyncChange is backfilled last, deliberately, and separately from the
-- direct branch-chain UPDATEs above: Product, PricingRule, ProductVariant and
-- InventoryStock each carry "AFTER INSERT OR UPDATE" triggers
-- (bold_emit_*_sync_change / *_sync_change from earlier migrations) that
-- auto-insert a new SyncChange row on every UPDATE, including this
-- migration's own Phase 2/3 UPDATEs to those four tables. Backfilling
-- SyncChange before those tables would miss the rows those UPDATEs
-- themselves generate, leaving a genuine tenant_id IS NULL gap that the
-- invariant guard below would (correctly) fail on.
UPDATE "SyncChange" x SET "tenant_id" = COALESCE(
  (SELECT l."tenantId" FROM "Location" l WHERE l."id" = x."branch_id"),
  (SELECT "id" FROM "Tenant" WHERE "name" = 'Initial ATHR Demo Tenant')
);

-- Post-step invariant guard: zero rows with tenant_id IS NULL may remain in
-- any of the 32 tenant-owned tables altered above.
DO $$
DECLARE
  remaining INT;
BEGIN
  SELECT
    (SELECT count(*) FROM "Branch" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "SellerCommissionSettings" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "SellerCommissionOverride" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "SellerCommissionPeriod" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "SellerCommissionPeriodRow" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "Supplier" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "Category" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "Product" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "ProductVariant" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "PricingRule" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "InventoryStock" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "InventoryMovement" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "InventoryCostMovement" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "Customer" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "SalesInvoice" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "PosTerminal" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "PosTerminalEnrollment" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "SyncChange" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "SalesInvoiceItem" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "Return" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "ReturnItem" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "PurchaseInvoice" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "PurchaseInvoiceItem" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "SupplierReturn" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "SupplierReturnItem" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "Transfer" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "TransferItem" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "TransferCommand" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "TransferTransitMovement" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "OfferSuggestion" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "AuditLog" WHERE "tenant_id" IS NULL) +
    (SELECT count(*) FROM "Shift" WHERE "tenant_id" IS NULL)
  INTO remaining;

  IF remaining <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-004 invariant failed: % row(s) remain with tenant_id IS NULL across the 32 tenant-owned tables.', remaining;
  END IF;
END $$;
