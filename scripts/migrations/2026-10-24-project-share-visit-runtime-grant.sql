-- Share-link visitors for Main's restricted runtime role. `drizzle-kit push`
-- creates `project_share_visit` as the owner and a new table gets NO grant:
-- without this every visitor write is "permission denied" (logged at most once
-- a minute by $lib/projects/shares, never shown, and the link still opens) and
-- the owner's Share panel lists every link with its old use count and no
-- visitors.
-- Same trap as game_results (2026-10-21) and game_rooms (2026-10-22). Text
-- primary key: no sequence to grant. DELETE for the cascade from project_share.
-- Narrow on purpose. Apply as the owner after the deploy that creates the table:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
-- SR-Infra's registry/runtime-tables.json lists "project_share_visit" (right
-- after "project_share") and must merge WITH this release: runtime-grants.py
-- revokes every table it does not list, so a later run would undo this grant.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.project_share_visit') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_share_visit TO sr_main_runtime;
    END IF;
  END IF;
END $$;
