CREATE TABLE IF NOT EXISTS "hermes_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"hermes_session_id" text NOT NULL,
	"kind" text NOT NULL,
	"kind_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "hermes_sessions_kind_kind_id_idx" ON "hermes_sessions" USING btree ("kind","kind_id") WHERE closed_at IS NULL;
