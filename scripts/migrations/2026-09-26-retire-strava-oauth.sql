-- Strava ingestion and OAuth routes were removed on 2026-09-13. Discard the
-- retired connector's credentials and status after its route ownership is
-- reconciled. Historical activities and sync job records stay available.
-- Apply as a reviewed one-off migration; Main's schema push does not run SQL.
BEGIN;
DELETE FROM oauth_tokens WHERE service = 'strava';
DELETE FROM health_sync_state WHERE service = 'strava';
COMMIT;
