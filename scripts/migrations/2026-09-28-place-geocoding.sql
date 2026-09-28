-- Additive: confirmed names and existing suggestions remain untouched.
ALTER TABLE daydream_places ADD COLUMN IF NOT EXISTS suggested_provider text;
ALTER TABLE daydream_places ADD COLUMN IF NOT EXISTS suggested_precision text;
-- Compatibility with local snapshots predating close-tracking preferences.
ALTER TABLE daydream_places ADD COLUMN IF NOT EXISTS track_on_leave boolean;
