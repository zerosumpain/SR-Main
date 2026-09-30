-- The route planner's two tables (route_session: live walks; route_gift:
-- routes sent to a family member) for Main's restricted runtime role.
-- `drizzle-kit push` creates tables as the owner, and since the 2026-09-28
-- runtime-role rollout new tables get NO automatic grant: without this the
-- service's first read is "permission denied" (it was, for route_session, on
-- 2026-09-30 — granted by hand at 06:53Z; this file records it).
-- Narrow on purpose: SR-Infra's runtime-grants.py re-renders EVERYTHING and its
-- registry lacks the daydream_commission* grants that are live, so a full
-- render would revoke them. Apply as the owner:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.route_session') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_session TO sr_main_runtime;
    END IF;
    IF to_regclass('public.route_gift') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_gift TO sr_main_runtime;
    END IF;
  END IF;
END $$;
