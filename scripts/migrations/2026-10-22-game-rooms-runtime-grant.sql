-- Durable game rooms for Main's restricted runtime role. `drizzle-kit push`
-- creates `game_rooms` as the owner and a new table gets NO grant: without
-- this every durable room's write fails and every lobby read of one is lost
-- (the game_results trap, 2026-10-21). Text primary key: no sequence to grant.
-- DELETE because the retention sweep and account erasure run in-process.
-- Narrow on purpose. Apply as the owner after the deploy that creates the table:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
-- Until it is applied, starting a durable game (Homestead) is a 503 and the
-- lobby and room sweep log the denied query. SR-Infra's
-- registry/runtime-tables.json must list "game_rooms" (right after
-- "game_results") and merge WITH this release: runtime-grants.py revokes every
-- table it does not list, so a later run would silently undo this grant.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.game_rooms') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_rooms TO sr_main_runtime;
    END IF;
  END IF;
END $$;
