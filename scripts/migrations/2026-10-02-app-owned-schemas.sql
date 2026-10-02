-- Move the tables that belong to exactly one extracted application out of the
-- shared `public` schema into a schema named for that application:
--
--   drive  : rag_collections, rag_messages                  (SR-Drive)
--   policy : policy_indicator_snapshots                     (SR-Policy-Engine)
--   dfe    : keystone_intel, keystone_intel_runs            (SR-DfE-Data-Strategy)
--   dsd    : standard_registry_entries,
--            standard_registry_source_runs                  (SR-Data-Standard-Designer)
--
-- Nothing in Main reads or writes these tables. `ALTER TABLE ... SET SCHEMA` is
-- a catalogue change: no rows are copied, and the table keeps its owner, its
-- privileges, its indexes, its constraints and the foreign key between the two
-- rag tables.
--
-- ORDER IS LOAD-BEARING. In the same Main release, schema.ts declares these
-- tables with pgSchema(...) and drizzle.config.ts pins schemaFilter to
-- ['public'], so `drizzle-kit push` neither recreates an empty public copy nor
-- manages the moved table. ci-release.sh runs scripts/apply-app-owned-schemas.mjs
-- (this file) BEFORE the push.
--
-- COMPATIBILITY VIEWS. Each moved table leaves behind an auto-updatable view of
-- the same name in `public`, so an application release that still reads
-- public.<table> keeps working (SELECT, INSERT ... RETURNING, UPDATE, DELETE and
-- ON CONFLICT all pass through to the moved table, and the moved table's column
-- defaults apply). Apps are then released to read <schema>.<table> directly, in
-- any order, and an app rollback stays safe. drizzle.config.ts's tablesFilter
-- keeps push from dropping these views. A later release drops the views and the
-- declarations together, after every app reads the new location.
--
-- Idempotent: every step is guarded, so a re-run (or a run after a partial
-- manual application) is a no-op. It refuses to continue when a TABLE exists in
-- both places — someone recreated a public copy, and the two must be reconciled
-- by hand, never silently.
--
-- Grants:
--  * Each non-owner role that already holds a privilege on a moved table keeps
--    it (the ACL travels with the table), receives USAGE on the new schema, and
--    receives the same privileges on the compatibility view. Today that is
--    Drive's restricted runtime role for the rag tables. Policy, DfE and DSD
--    connect with the owner credential, which needs no grant.
--  * The views are security_invoker (PostgreSQL 15+), so a view grant never
--    widens what the caller could do to the table itself.
--  * Main's restricted runtime role (sr_main_runtime) loses its privileges on
--    the moved tables: Main has no reader or writer of them, and SR-Infra's
--    registry/runtime-tables.json drops them from Main's allowlist in the same
--    change. Account erasure (src/lib/people/erase.ts) classifies rag
--    collections as owner-only and never deletes from them.
--  * Nothing is granted on future tables.
--
-- A database where the public table never existed (a fresh push) gets the empty
-- schemas only: creating an app-owned table is the owning application's job.
--
-- Apply as the migration owner (ci-release.sh does this with the deployment-only
-- migration credential). By hand:
--   psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file
-- Rollback: scripts/migrations/2026-10-02-app-owned-schemas.rollback.sql.
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
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', item.schema_name);

    SELECT c.relkind INTO public_kind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = item.table_name;

    IF public_kind = 'r' THEN
      IF to_regclass(format('%I.%I', item.schema_name, item.table_name)) IS NOT NULL THEN
        RAISE EXCEPTION 'Both public.% and %.% are tables; reconcile them by hand before re-running',
          item.table_name, item.schema_name, item.table_name;
      END IF;
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA %I', item.table_name, item.schema_name);
      RAISE NOTICE 'moved public.% to %.%', item.table_name, item.schema_name, item.table_name;
      public_kind := NULL;
    ELSIF public_kind IS NOT NULL AND public_kind <> 'v' THEN
      RAISE EXCEPTION 'public.% exists with unexpected relkind %', item.table_name, public_kind;
    END IF;

    moved := to_regclass(format('%I.%I', item.schema_name, item.table_name));
    CONTINUE WHEN moved IS NULL;

    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON %s FROM sr_main_runtime', moved);
    END IF;

    IF public_kind IS NULL THEN
      -- security_invoker needs PostgreSQL 15. On an older server the view runs
      -- with its owner's rights, which is still bounded by the grants copied
      -- below: only roles that already held the same rights on the table.
      EXECUTE format('CREATE VIEW public.%I %s AS SELECT * FROM %s', item.table_name,
        CASE WHEN current_setting('server_version_num')::int >= 150000
          THEN 'WITH (security_invoker = true)' ELSE '' END,
        moved);
      EXECUTE format('COMMENT ON VIEW public.%I IS %L', item.table_name,
        format('Compatibility view for %s (2026-10-02-app-owned-schemas.sql); drop with Main''s declaration removal.', moved));
    END IF;

    FOR grant_row IN
      SELECT r.rolname, string_agg(DISTINCT a.privilege_type, ', ') AS privileges
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(c.relacl) a
      JOIN pg_roles r ON r.oid = a.grantee
      WHERE c.oid = moved
        AND a.grantee <> c.relowner
        AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      GROUP BY r.rolname
    LOOP
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', item.schema_name, grant_row.rolname);
      EXECUTE format('GRANT %s ON public.%I TO %I', grant_row.privileges, item.table_name, grant_row.rolname);
    END LOOP;
  END LOOP;
END $$;
