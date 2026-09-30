-- The generic sync-change trigger read `tenant_id` from the row, but the
-- "Tenant" table's own id is its tenant id, so a settings update failed with a
-- NULL tenant_id. Fall back to the row id for that table.
CREATE OR REPLACE FUNCTION bold_emit_sync_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  rec jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
BEGIN
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at", "tenant_id")
  VALUES (
    TG_ARGV[0], NULL, rec ->> TG_ARGV[1], CURRENT_TIMESTAMP,
    (CASE WHEN TG_TABLE_NAME = 'Tenant' THEN rec ->> 'id' ELSE rec ->> 'tenant_id' END)::uuid
  );
  RETURN NULL;
END;
$$;
