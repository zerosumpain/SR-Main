-- "msg family"'s table for Main's restricted runtime role.
-- `drizzle-kit push` creates `family_message` as the owner when this release
-- ships, and since the 2026-09-28 runtime-role rollout a new table gets NO
-- automatic grant — so without this every message from the app would be
-- "permission denied" inside the handler (as family_alarm was on 2026-10-02).
-- DELETE because account erasure (people/erase.ts) removes a person's messages.
-- Granted by hand right after the release; this file records it.
-- Apply as the owner:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.family_message') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_message TO sr_main_runtime;
    END IF;
  END IF;
END $$;
