-- W3: discounts. A sale line stores the discount it was given (its own plus its share of the
-- invoice discount, as a reduction of the tax-exclusive amount) and the tax of the whole line
-- after that discount, so a return can refund what was actually paid from stored figures.

-- AlterTable
ALTER TABLE "SalesInvoiceItem" ADD COLUMN     "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Existing lines had no discount: their tax is the quoted tax of the unit times the quantity.
UPDATE "SalesInvoiceItem" SET "tax_amount" = ROUND("unit_tax" * "qty", 2);

ALTER TABLE "SalesInvoiceItem" ADD CONSTRAINT "SalesInvoiceItem_discount_nonnegative" CHECK ("discount_amount" >= 0 AND "tax_amount" >= 0);
