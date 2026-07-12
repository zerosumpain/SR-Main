-- Manual-arrange mode (batch 9): per-slide block frames. Null = the layout
-- archetype positions blocks; set = the owner hand-laid this slide in the
-- editor ({ "<blockIdx>": {x, y, w} } as % of the stage).
-- Apply manually (drizzle-kit push is blocked non-interactively):
--   local:  psql "$DATABASE_URL" -f scripts/migrations/2026-07-12-deck-geometry.sql
--   VPS:    docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < scripts/migrations/2026-07-12-deck-geometry.sql

ALTER TABLE deck_slides ADD COLUMN IF NOT EXISTS geometry jsonb;
