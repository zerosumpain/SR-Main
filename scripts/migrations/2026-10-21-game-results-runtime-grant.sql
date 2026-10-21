-- The games leaderboard's table for Main's restricted runtime role.
-- `drizzle-kit push` created `game_results` as the owner on 2026-09-29 (#1075),
-- the day after the 2026-09-28 runtime-role rollout, and a new table gets NO
-- automatic grant — so every finished round's write was "permission denied"
-- (logged by rooms.server's recorder, never shown) and every leaderboard read
-- 500'd in the app and on /games/leaderboard. Found 2026-10-21 with 0 rows
-- ever recorded. Same trap as route_session (2026-09-30), family_alarm
-- (2026-10-02) and app_device (2026-10-20). DELETE because account erasure
-- (people/erase.ts) removes a person's results in-process.
-- Narrow on purpose. Apply as the owner:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
--
-- The table grant alone was not enough: `id` is a serial, and an INSERT also
-- needs USAGE on its sequence. With only the table granted (2026-10-21
-- morning) every finish still failed, "permission denied for sequence
-- game_results_id_seq" — seven games that evening recorded nothing. The
-- sequence was granted by hand the same night; SR-Infra's registry renders
-- both (`runtime-grants.py` grants every serial's sequence), so this file is
-- the full record. Any table with a serial id needs BOTH grants.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.game_results') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_results TO sr_main_runtime;
    END IF;
    IF to_regclass('public.game_results_id_seq') IS NOT NULL THEN
      GRANT USAGE, SELECT ON SEQUENCE public.game_results_id_seq TO sr_main_runtime;
    END IF;
  END IF;
END $$;
