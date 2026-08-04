-- WP-007 Phase B (MT-MIG-006): same-tenant composite FK support for "Return".
-- No runtime pre-migration validation query is needed: "id" is already this
-- table's primary key, so (tenant_id, id) is trivially unique -- a duplicate
-- is structurally impossible, not merely improbable.
ALTER TABLE "Return" ADD CONSTRAINT "Return_tenant_id_id_key" UNIQUE ("tenant_id", "id");
