-- JKai durable turns, gates, events and presence (overhaul plan 2026-10-28, slice 8).
--
-- SR-Jkai-Core writes these four tables; SR-Main declares them in
-- src/lib/db/schema.ts (jkaiTurns, jkaiGates, jkaiEvents, jkaiPresence) because
-- Main is the schema executor. They are created HERE, by hand, and NOT by
-- drizzle push: a new table can hang CI on the rename prompt, and push exits 0
-- on a TTY prompt having created nothing. The DDL below is drizzle-kit's own
-- export of those declarations, so the next push finds nothing to do.
--
-- Both runtimes get their GRANTs in the same script (the 10-02 family_alarm
-- trap: a new table 500s until granted). `jkai_events.seq` is a bigserial, so
-- the SEQUENCE is granted too (the 10-21 game_results trap). DELETE because
-- Core prunes events after 7 days and stale presence, and Main's account
-- erasure deletes conversations, which cascades here.
--
-- Apply as the schema owner, after a backup, BEFORE any Core build that has
-- JKAI_DURABLE_TURNS=on (the writers ship flagged off and no-op until then):
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling -v ON_ERROR_STOP=1 < this-file
-- Then check, as each runtime (the count(*)s must return, not error):
--   SELECT count(*) FROM jkai_turns; SELECT count(*) FROM jkai_gates;
--   SELECT count(*) FROM jkai_events; SELECT count(*) FROM jkai_presence;
-- SR-Infra's registry/runtime-tables.json lists all four under "main" and
-- "core" and must merge WITH this: runtime-grants.py revokes every table it
-- does not list, so a later full render would silently undo these grants.
-- Idempotent: safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS "jkai_turns" (
	"job_id" text PRIMARY KEY NOT NULL,
	"conversation_id" text,
	"principal_id" text DEFAULT 'owner' NOT NULL,
	"surface" text,
	"slot" text,
	"status" text DEFAULT 'running' NOT NULL,
	"phase" text,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"partial_text" text DEFAULT '' NOT NULL,
	"workload" text DEFAULT 'chat' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"error" text
);

CREATE TABLE IF NOT EXISTS "jkai_gates" (
	"job_id" text NOT NULL,
	"gate_key" text NOT NULL,
	"kind" text NOT NULL,
	"principal_id" text DEFAULT 'owner' NOT NULL,
	"conversation_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"answer" jsonb,
	"answered_by" text,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "jkai_gates_job_id_gate_key_pk" PRIMARY KEY("job_id","gate_key")
);

CREATE TABLE IF NOT EXISTS "jkai_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"conversation_id" text,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "jkai_presence" (
	"principal_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"surface" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jkai_presence_principal_id_conversation_id_surface_pk" PRIMARY KEY("principal_id","conversation_id","surface")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'jkai_turns_conversation_id_jkai_conversations_id_fk') THEN
    ALTER TABLE "jkai_turns" ADD CONSTRAINT "jkai_turns_conversation_id_jkai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jkai_conversations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'jkai_gates_job_id_jkai_turns_job_id_fk') THEN
    ALTER TABLE "jkai_gates" ADD CONSTRAINT "jkai_gates_job_id_jkai_turns_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jkai_turns"("job_id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'jkai_events_conversation_id_jkai_conversations_id_fk') THEN
    ALTER TABLE "jkai_events" ADD CONSTRAINT "jkai_events_conversation_id_jkai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jkai_conversations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "jkai_turns_conversation_idx" ON "jkai_turns" USING btree ("conversation_id","started_at");
CREATE INDEX IF NOT EXISTS "jkai_turns_status_idx" ON "jkai_turns" USING btree ("status","updated_at");
CREATE INDEX IF NOT EXISTS "jkai_gates_open_idx" ON "jkai_gates" USING btree ("answered_at","opened_at");
CREATE INDEX IF NOT EXISTS "jkai_events_principal_idx" ON "jkai_events" USING btree ("principal_id","seq");
CREATE INDEX IF NOT EXISTS "jkai_events_created_idx" ON "jkai_events" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "jkai_presence_seen_idx" ON "jkai_presence" USING btree ("seen_at");

-- Both runtimes, narrowly. Conditional on the role existing, like every grant
-- migration here, so the script also runs on a database without them.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['sr_main_runtime', 'sr_core_runtime'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.jkai_turns, public.jkai_gates, public.jkai_events, public.jkai_presence TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.jkai_events_seq_seq TO %I', r);
    ELSE
      RAISE NOTICE 'role % does not exist here: no grant', r;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Verify (as the owner): every line must say t.
-- SELECT r, t, has_table_privilege(r, t, 'SELECT') AND has_table_privilege(r, t, 'INSERT')
--        AND has_table_privilege(r, t, 'UPDATE') AND has_table_privilege(r, t, 'DELETE') AS ok
--   FROM unnest(ARRAY['sr_main_runtime','sr_core_runtime']) r,
--        unnest(ARRAY['jkai_turns','jkai_gates','jkai_events','jkai_presence']) t;
-- SELECT r, has_sequence_privilege(r, 'jkai_events_seq_seq', 'USAGE') FROM unnest(ARRAY['sr_main_runtime','sr_core_runtime']) r;
