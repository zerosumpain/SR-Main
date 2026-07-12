-- sr. decks batch 17: share slide-reach analytics + deck OG poster.
-- Applied manually (non-interactive drizzle-kit push is blocked by a
-- pre-existing unrelated prompt — see scripts/migrations/2026-07-11-decks-tables.sql).
-- Local:  psql "$DATABASE_URL" -f scripts/migrations/2026-07-12-decks-batch17.sql
-- VPS:    docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < scripts/migrations/2026-07-12-decks-batch17.sql

ALTER TABLE deck_share ADD COLUMN IF NOT EXISTS slides_reached jsonb;
ALTER TABLE decks ADD COLUMN IF NOT EXISTS og_image text;
