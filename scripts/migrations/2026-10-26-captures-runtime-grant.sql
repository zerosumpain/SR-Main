-- Captures (dictation and recorded conversations from the iPhone app) for
-- Main's restricted runtime role. `drizzle-kit push` creates `capture` and
-- `capture_action` as the owner when this release ships, and a new table gets
-- NO automatic grant: without this every capture the phone uploads is
-- "permission denied" inside the handler, and the phone keeps retrying it.
-- Text primary keys (`cap_…`, `cact_…`): no sequence to grant. DELETE because
-- the owner deletes a capture from the phone, and its actions go by cascade.
-- Narrow on purpose. Apply as the owner after the deploy that creates the tables:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
-- SR-Infra's registry/runtime-tables.json must list "capture" and
-- "capture_action" and merge WITH this release: runtime-grants.py revokes every
-- table it does not list, so a later run would undo this grant.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.capture') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.capture TO sr_main_runtime;
    END IF;
    IF to_regclass('public.capture_action') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.capture_action TO sr_main_runtime;
    END IF;
  END IF;
END $$;
