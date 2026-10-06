-- W3: a return refunds what was paid for the units (after the line's discount), taken from the
-- stored line amounts. The refunded net and tax are kept on the return line, because
-- unit price x quantity no longer says what a discounted line refunds.

-- AlterTable
ALTER TABLE "ReturnItem" ADD COLUMN     "net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Existing return lines were refunded at unit price and unit tax (no discounts existed).
UPDATE "ReturnItem" SET "net_amount" = ROUND("unit_price" * "qty", 2), "tax_amount" = ROUND("unit_tax" * "qty", 2);
