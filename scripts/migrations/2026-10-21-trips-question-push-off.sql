-- Trips v8.1 (2026-10-21): turn a trip's question notifications off, per person.
-- One new column on `trip` (covered by its table grant — no GRANT needed).
-- In production `drizzle-kit push` adds it with the release; this file is what
-- a local preview database runs, and the record.
ALTER TABLE public.trip ADD COLUMN IF NOT EXISTS question_push_off jsonb;
