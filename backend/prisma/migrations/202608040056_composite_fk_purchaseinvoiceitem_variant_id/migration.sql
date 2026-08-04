-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK -- "PurchaseInvoiceItem"."variant_id" -> "ProductVariant" now also enforces tenant_id equality.
-- Pre-migration validation: zero existing rows where "PurchaseInvoiceItem".tenant_id
-- differs from the referenced "ProductVariant" row's tenant_id.
DO $$
DECLARE
  violating INT;
BEGIN
  SELECT count(*) INTO violating
  FROM "PurchaseInvoiceItem" c
  JOIN "ProductVariant" p ON p."id" = c."variant_id"
  WHERE c."tenant_id" IS DISTINCT FROM p."tenant_id";
  IF violating <> 0 THEN
    RAISE EXCEPTION 'MT-MIG-006 precondition failed: % row(s) in "PurchaseInvoiceItem" reference a "ProductVariant" row in a different tenant.', violating;
  END IF;
END $$;

ALTER TABLE "PurchaseInvoiceItem" DROP CONSTRAINT "PurchaseInvoiceItem_variant_id_fkey";
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
