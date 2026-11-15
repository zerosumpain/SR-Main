-- Source backlog (2026-11-15): the table SR-Jkai-Core fills from Gmail,
-- Calendar and Drive and daydream works through
-- (docs/superpowers/specs/2026-11-15-source-backlog.md).
--
-- Created here by hand and not by `drizzle-kit push`: a new table can hang CI
-- on the rename prompt, and push exits 0 on a TTY prompt having created
-- nothing. The DDL is drizzle-kit's own for the declaration in schema.ts, so
-- the push that follows sees no difference.
--
--   sr_core_runtime  read/write: intake inserts, the extractor updates, a
--                    mailbox purge deletes.
--   sr_main_runtime  SELECT, and UPDATE for daydream's consideration columns.
--                    Never INSERT or DELETE.
--
-- The id is a text uuid, so there is no sequence to grant. Conditional on each
-- role existing, like every grant migration here. Idempotent.
--
-- Apply as the owner BEFORE the Core release that starts the engines:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
--
-- SR-Infra's registry/runtime-tables.json must list source_backlog under main
-- and core and merge WITH this release: runtime-grants.py revokes every table
-- it does not list.
BEGIN;

CREATE TABLE IF NOT EXISTS "source_backlog" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"space_id" text NOT NULL,
	"source" text NOT NULL,
	"ref_id" text NOT NULL,
	"account_email" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"kind" text,
	"title" text,
	"sender_domain" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"content_hash" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"facts" jsonb,
	"model" text,
	"extracted_at" timestamp with time zone,
	"category" text,
	"needs_action" boolean DEFAULT false NOT NULL,
	"action_by" date,
	"considered_at" timestamp with time zone,
	"consideration" text,
	"thought_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "source_backlog_space_ref_key" ON "source_backlog" USING btree ("space_id","ref_id");
CREATE INDEX IF NOT EXISTS "source_backlog_state_observed_idx" ON "source_backlog" USING btree ("state","observed_at");
CREATE INDEX IF NOT EXISTS "source_backlog_queue_idx" ON "source_backlog" USING btree ("state","priority" DESC NULLS LAST,"observed_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "source_backlog_considered_idx" ON "source_backlog" USING btree ("space_id","considered_at","observed_at");
CREATE INDEX IF NOT EXISTS "source_backlog_action_idx" ON "source_backlog" USING btree ("space_id","needs_action","action_by");

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_core_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_backlog TO sr_core_runtime;
  ELSE
    RAISE NOTICE 'role sr_core_runtime does not exist here: no grant';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    GRANT SELECT, UPDATE ON public.source_backlog TO sr_main_runtime;
  ELSE
    RAISE NOTICE 'role sr_main_runtime does not exist here: no grant';
  END IF;
END $$;

COMMIT;

-- Verify (as the owner):
-- SELECT r, has_table_privilege(r, 'source_backlog', 'SELECT') AS sel,
--        has_table_privilege(r, 'source_backlog', 'UPDATE') AS upd,
--        has_table_privilege(r, 'source_backlog', 'INSERT') AS ins
--   FROM unnest(ARRAY['sr_main_runtime','sr_core_runtime']) r;
-- Expect: main t,t,f — core t,t,t.
