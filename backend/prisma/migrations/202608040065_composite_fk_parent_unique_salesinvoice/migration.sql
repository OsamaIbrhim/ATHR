-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK support for "SalesInvoice".
-- No runtime pre-migration validation query is needed: "id" is already this
-- table's primary key, so (tenant_id, id) is trivially unique -- a duplicate
-- is structurally impossible, not merely improbable.
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_tenant_id_id_key" UNIQUE ("tenant_id", "id");
