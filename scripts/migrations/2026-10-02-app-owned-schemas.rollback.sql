-- ROLLBACK for 2026-10-02-app-owned-schemas.sql. Not run by any release script:
-- apply by hand, as the migration owner, only when the app-owned schemas must be
-- undone:
--   psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file
--
-- Order:
--  1. Roll back Drive, Policy Engine, DfE Data Strategy and Data Standard
--     Designer to releases that read public.<table> (the compatibility views
--     serve them until step 2).
--  2. Run this file. It moves each table back to public in place of its
--     compatibility view, restores Main's runtime grant, and removes each app
--     schema once it is empty.
--  3. Only then redeploy a Main release whose schema.ts declares these tables
--     with pgTable(...) in public. Pushing such a release BEFORE this file runs
--     fails safely: drizzle-kit tries to CREATE TABLE over the view and errors,
--     and ci-release.sh refuses the release.
--
-- Idempotent and guarded. It refuses to move a table back over a public TABLE
-- of the same name, which would mean a release recreated an empty copy: compare
-- the two and drop the copy by hand first. No rows are copied or deleted.
DO $$
DECLARE
  item record;
  grant_row record;
  public_kind "char";
  moved regclass;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('drive', 'rag_collections'),
      ('drive', 'rag_messages'),
      ('policy', 'policy_indicator_snapshots'),
      ('dfe', 'keystone_intel'),
      ('dfe', 'keystone_intel_runs'),
      ('dsd', 'standard_registry_entries'),
      ('dsd', 'standard_registry_source_runs')
    ) AS moves(schema_name, table_name)
  LOOP
    moved := to_regclass(format('%I.%I', item.schema_name, item.table_name));
    CONTINUE WHEN moved IS NULL;

    SELECT c.relkind INTO public_kind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = item.table_name;

    IF public_kind = 'v' THEN
      EXECUTE format('DROP VIEW public.%I', item.table_name);
    ELSIF public_kind IS NOT NULL THEN
      RAISE EXCEPTION 'public.% already exists (relkind %); reconcile it with %.% by hand',
        item.table_name, public_kind, item.schema_name, item.table_name;
    END IF;

    -- Schema USAGE was only for this table; the table ACL itself travels back.
    FOR grant_row IN
      SELECT DISTINCT r.rolname
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(c.relacl) a
      JOIN pg_roles r ON r.oid = a.grantee
      WHERE c.oid = moved AND a.grantee <> c.relowner
    LOOP
      EXECUTE format('REVOKE USAGE ON SCHEMA %I FROM %I', item.schema_name, grant_row.rolname);
    END LOOP;

    EXECUTE format('ALTER TABLE %s SET SCHEMA public', moved);
    RAISE NOTICE 'moved %.% back to public', item.schema_name, item.table_name;

    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO sr_main_runtime', item.table_name);
    END IF;
  END LOOP;

  -- RESTRICT semantics: a schema that still holds anything is left in place.
  FOR item IN SELECT unnest(ARRAY['drive', 'policy', 'dfe', 'dsd']) AS schema_name LOOP
    IF EXISTS (SELECT FROM pg_namespace WHERE nspname = item.schema_name)
       AND NOT EXISTS (
         SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = item.schema_name) THEN
      EXECUTE format('DROP SCHEMA %I', item.schema_name);
    END IF;
  END LOOP;
END $$;
