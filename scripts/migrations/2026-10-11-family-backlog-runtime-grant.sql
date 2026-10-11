-- The family backlog's table for Main's restricted runtime role.
-- `drizzle-kit push` creates `family_backlog_item` as the owner when this
-- release ships, and a new table gets NO automatic grant — so without this
-- every share from the app is "permission denied" inside the handler.
-- DELETE because account erasure (people/erase.ts) removes a person's shares.
-- Granted by hand right after the release; this file records it.
-- Apply as the owner:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.family_backlog_item') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_backlog_item TO sr_main_runtime;
    END IF;
  END IF;
END $$;
