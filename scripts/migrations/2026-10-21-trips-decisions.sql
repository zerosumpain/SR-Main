-- Trips v8 (2026-10-21): propose, research, ask.
-- Four new tables (proposals, questions, the research pack's places, durable
-- jobs) and three new columns (trip.provenance, trip.pack,
-- trip_plan.constraints). Shapes: src/lib/trips/decisions.ts.
--
-- In production `drizzle-kit push` creates the tables and columns when the
-- release ships (creates only — no drops, so no rename prompt). A new table
-- gets NO automatic grant, so the GRANT block below is applied by hand right
-- after the release, as for 2026-10-13-trips-runtime-grant.sql. New columns
-- on existing tables are covered by their table grants.
--
-- The CREATE / ALTER statements are idempotent and are what a local preview
-- database runs (it has no drizzle push). Apply as the owner:
--   docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < this-file
-- (production: only after the release has created the tables; it is safe to
-- run whole, the creates are IF NOT EXISTS).

ALTER TABLE public.trip ADD COLUMN IF NOT EXISTS provenance jsonb;
ALTER TABLE public.trip ADD COLUMN IF NOT EXISTS pack jsonb;
ALTER TABLE public.trip_plan ADD COLUMN IF NOT EXISTS constraints jsonb;

CREATE TABLE IF NOT EXISTS public.trip_proposal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  group_id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  why text NOT NULL DEFAULT '',
  scope jsonb NOT NULL,
  ops jsonb NOT NULL DEFAULT '[]'::jsonb,
  diff jsonb NOT NULL,
  tradeoffs jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  place jsonb,
  image jsonb,
  pack_place_id uuid,
  shape jsonb,
  preview jsonb NOT NULL DEFAULT '[]'::jsonb,
  based_on_version integer,
  status text NOT NULL DEFAULT 'open',
  reason text,
  author_email text,
  decided_by_email text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_proposal_trip_idx ON public.trip_proposal (trip_id, status);
CREATE INDEX IF NOT EXISTS trip_proposal_group_idx ON public.trip_proposal (trip_id, group_id);

CREATE TABLE IF NOT EXISTS public.trip_question (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  key text NOT NULL,
  source text NOT NULL,
  prompt text NOT NULL,
  why text NOT NULL DEFAULT '',
  answers jsonb NOT NULL,
  default_answer_id text NOT NULL,
  applied_default boolean NOT NULL DEFAULT false,
  if_skipped text NOT NULL DEFAULT '',
  affects jsonb NOT NULL,
  impact double precision NOT NULL DEFAULT 0,
  audience text NOT NULL DEFAULT 'owner',
  deadline date,
  status text NOT NULL DEFAULT 'open',
  answer_id text,
  answered_by_email text,
  answered_by_name text,
  votes jsonb NOT NULL DEFAULT '{}'::jsonb,
  based_on_version integer,
  pushed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz
);
CREATE INDEX IF NOT EXISTS trip_question_trip_idx ON public.trip_question (trip_id, status);
CREATE INDEX IF NOT EXISTS trip_question_key_idx ON public.trip_question (trip_id, key);

CREATE TABLE IF NOT EXISTS public.trip_place (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  place jsonb NOT NULL,
  why text,
  neighbourhood text,
  duration_min integer,
  indoor boolean,
  kid_friendly boolean,
  cost_text text,
  less_visited boolean NOT NULL DEFAULT false,
  booking_required boolean,
  book_ahead_days integer,
  facts jsonb,
  image jsonb,
  wikidata text,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'candidate',
  reject_reason text,
  wish_id uuid,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_place_trip_idx ON public.trip_place (trip_id, status);

CREATE TABLE IF NOT EXISTS public.trip_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid,
  owner_email text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  error text,
  cancel_requested boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS trip_job_owner_idx ON public.trip_job (owner_email, started_at);

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.trip_proposal') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_proposal TO sr_main_runtime;
    END IF;
    IF to_regclass('public.trip_question') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_question TO sr_main_runtime;
    END IF;
    IF to_regclass('public.trip_place') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_place TO sr_main_runtime;
    END IF;
    IF to_regclass('public.trip_job') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_job TO sr_main_runtime;
    END IF;
  END IF;
END $$;
