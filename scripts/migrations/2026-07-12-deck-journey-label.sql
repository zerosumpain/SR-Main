-- Deck journeys (batch 6): a slide with children advertises the branch with a
-- pill; journey_label names that side story ("down for <label>").
-- Apply manually (drizzle-kit push is blocked non-interactively by the
-- pre-existing jkai_conversations prompt):
--   local:  psql "$DATABASE_URL" -f scripts/migrations/2026-07-12-deck-journey-label.sql
--   VPS:    docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < scripts/migrations/2026-07-12-deck-journey-label.sql

ALTER TABLE deck_slides ADD COLUMN IF NOT EXISTS journey_label text;
