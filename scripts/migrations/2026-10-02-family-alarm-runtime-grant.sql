-- The family alarm's table for Main's restricted runtime role.
-- `drizzle-kit push` created `family_alarm` as the owner on 2026-10-02 (#1121),
-- and since the 2026-09-28 runtime-role rollout a new table gets NO automatic
-- grant — so every alarm raised from the app was "permission denied" inside
-- the handler, answered as 500 "Something went wrong". Same trap as
-- route_session (2026-09-30-route-tables-runtime-grants.sql). DELETE because
-- account erasure (people/erase.ts) removes a person's alarms in-process.
-- Granted by hand on 2026-10-02; this file records it.
-- Narrow on purpose (see that file). Apply as the owner:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.family_alarm') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_alarm TO sr_main_runtime;
    END IF;
  END IF;
END $$;
