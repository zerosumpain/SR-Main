-- Family photos' table for Main's restricted runtime role.
-- `drizzle-kit push` creates `family_photo` as the owner when this release
-- ships, and since the 2026-09-28 runtime-role rollout a new table gets NO
-- automatic grant — so without this every photo upload or read from the app
-- would be "permission denied" inside the handler, answered as 500 "Something
-- went wrong" (as family_alarm was on 2026-10-02). UPDATE because a new photo
-- replaces the old (upsert); DELETE because a member can clear theirs and
-- account erasure (people/erase.ts) removes a person's photo in-process.
-- Apply as the owner right after the release:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
-- SR-Infra's registry/runtime-tables.json must list "family_photo" and merge
-- WITH this release: runtime-grants.py revokes every table it does not list,
-- so a later run would undo this grant.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.family_photo') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_photo TO sr_main_runtime;
    END IF;
  END IF;
END $$;
