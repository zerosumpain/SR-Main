-- Drive workbench (2026-11-01): runtime grants for `file_analyses` and
-- `mail_attachment_files` (build map §1B.1, §2.3).
--
-- `drizzle-kit push` creates both tables as the owner when this release ships,
-- and a new table gets NO automatic grant: without this every "Analyse" on
-- /drive and every attachment the mail rules file is "permission denied".
--
--   sr_drive_runtime  file_analyses: read/write (on-demand Analyse writes it).
--                     mail_attachment_files: READ only (Properties > Mail
--                     source); Core is the only writer.
--   sr_core_runtime   both: read/write (the mail-filing engine and purgeMailbox).
--   sr_main_runtime   nothing. Main's native Drive lane relays to SR-Drive and
--                     never reads either table; ON DELETE CASCADE / SET NULL
--                     from workflow_files run as the table owner, not the caller.
--
-- Both have `serial` ids, so USAGE on the sequence goes with any INSERT.
-- Conditional on each role and table existing, like every grant migration
-- here, so it also runs on a database without them. Idempotent.
--
-- Apply as the owner after the deploy that creates the tables:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
--
-- SR-Infra's registry/runtime-tables.json must list the same tables (drive:
-- file_analyses, mail_attachment_files; core: file_analyses,
-- mail_attachment_files) and merge WITH this release: runtime-grants.py
-- revokes every table it does not list, so a later run would undo this. Its
-- renderer grants SELECT/INSERT/UPDATE/DELETE to whatever it lists, so Drive's
-- read-only use of mail_attachment_files is narrower here than the registry
-- can express unless the registry learns a per-service read-only entry.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_drive_runtime') THEN
    IF to_regclass('public.file_analyses') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.file_analyses TO sr_drive_runtime;
      GRANT USAGE, SELECT ON SEQUENCE public.file_analyses_id_seq TO sr_drive_runtime;
    END IF;
    IF to_regclass('public.mail_attachment_files') IS NOT NULL THEN
      GRANT SELECT ON public.mail_attachment_files TO sr_drive_runtime;
    END IF;
  ELSE
    RAISE NOTICE 'role sr_drive_runtime does not exist here: no grant';
  END IF;

  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_core_runtime') THEN
    IF to_regclass('public.file_analyses') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.file_analyses TO sr_core_runtime;
      GRANT USAGE, SELECT ON SEQUENCE public.file_analyses_id_seq TO sr_core_runtime;
    END IF;
    IF to_regclass('public.mail_attachment_files') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.mail_attachment_files TO sr_core_runtime;
      GRANT USAGE, SELECT ON SEQUENCE public.mail_attachment_files_id_seq TO sr_core_runtime;
    END IF;
  ELSE
    RAISE NOTICE 'role sr_core_runtime does not exist here: no grant';
  END IF;
END $$;

COMMIT;

-- Verify (as the owner): every line must say t.
-- SELECT r, t, p, has_table_privilege(r, t, p)
--   FROM (VALUES ('sr_drive_runtime','file_analyses','SELECT'), ('sr_drive_runtime','file_analyses','INSERT'),
--                ('sr_drive_runtime','file_analyses','UPDATE'), ('sr_drive_runtime','mail_attachment_files','SELECT'),
--                ('sr_core_runtime','file_analyses','INSERT'), ('sr_core_runtime','mail_attachment_files','INSERT'),
--                ('sr_core_runtime','mail_attachment_files','DELETE')) v(r, t, p);
-- SELECT r, s, has_sequence_privilege(r, s, 'USAGE')
--   FROM (VALUES ('sr_drive_runtime','file_analyses_id_seq'), ('sr_core_runtime','file_analyses_id_seq'),
--                ('sr_core_runtime','mail_attachment_files_id_seq')) v(r, s);
