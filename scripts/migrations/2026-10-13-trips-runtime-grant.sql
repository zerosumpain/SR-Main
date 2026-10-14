-- The trip planner's tables for Main's restricted runtime role.
-- `drizzle-kit push` creates them as the owner when this release ships, and a
-- new table gets NO automatic grant — so without this /trips and
-- /api/native/trips are "permission denied" the moment they read a trip.
-- DELETE because deleting a trip removes its rows (trip_plan and trip_event
-- are append-only in the app, but go with their trip).
-- Granted by hand right after the release; this file records it.
-- Apply as the owner:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.trip') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip TO sr_main_runtime;
    END IF;
    IF to_regclass('public.trip_stay') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_stay TO sr_main_runtime;
    END IF;
    IF to_regclass('public.trip_wish') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_wish TO sr_main_runtime;
    END IF;
    IF to_regclass('public.trip_booking') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_booking TO sr_main_runtime;
    END IF;
    IF to_regclass('public.trip_plan') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_plan TO sr_main_runtime;
    END IF;
    IF to_regclass('public.trip_event') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_event TO sr_main_runtime;
    END IF;
    -- v2 (2026-10-14): the planning conversation.
    IF to_regclass('public.trip_message') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_message TO sr_main_runtime;
    END IF;
  END IF;
END $$;
