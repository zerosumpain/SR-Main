-- The enrolled-phones table for Main's restricted runtime role.
-- `drizzle-kit push` created `app_device` as the owner on 2026-10-20 (#1211),
-- and since the 2026-09-28 runtime-role rollout a new table gets NO automatic
-- grant — the same trap as route_session (2026-09-30) and family_alarm
-- (2026-10-02). Until granted, recording an enrolment failed quietly (the
-- handler catches it), the fleet page warned, and removing or erasing a
-- person 500'd. DELETE because account erasure (people/erase.ts) removes a
-- person's enrolled phones in-process.
-- Granted by hand on 2026-10-20, straight after the release's push; this file
-- records it. Narrow on purpose. Apply as the owner:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.app_device') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_device TO sr_main_runtime;
    END IF;
  END IF;
END $$;
