-- Run during the coordinated application cutover, before Main's schema push.
-- Preserve activity history in the native model, then remove retired storage.
-- This transaction is repeatable. A conflict or failed copy leaves all old data.
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(27092026, 1);

DO $$
BEGIN
  IF to_regclass('strava_activities') IS NOT NULL THEN
    IF to_regclass('activities') IS NULL THEN
      RAISE EXCEPTION 'Native activities table is required before retiring history';
    END IF;
    LOCK TABLE strava_activities IN ACCESS EXCLUSIVE MODE;
    LOCK TABLE activities IN SHARE ROW EXCLUSIVE MODE;

    -- Existing native imports keep their IDs, tracks, shares and owner edits.
    -- Keep the original record in metadata as well, including editorial fields
    -- and map data which have no direct native-column equivalent.
    UPDATE activities AS a
    SET metadata = coalesce(a.metadata, '{}'::jsonb)
      || jsonb_build_object('importedRecord', to_jsonb(s))
    FROM strava_activities AS s
    WHERE a.source = 'strava' AND a.external_id = s.id::text;

    INSERT INTO activities (
      id, source, external_id, name, activity_type, raw_type,
      start_date, end_date, start_date_local, timezone,
      distance_m, duration_s, active_duration_s, elevation_gain_m,
      avg_heartrate, max_heartrate, active_energy_kj, avg_pace_s_per_km,
      has_track, metadata, synced_at
    )
    SELECT
      'imported:fitness-' || s.id, 'imported', 'fitness-' || s.id,
      s.name,
      CASE lower(s.sport_type)
        WHEN 'run' THEN 'run' WHEN 'trailrun' THEN 'trail_run'
        WHEN 'ride' THEN 'ride' WHEN 'virtualride' THEN 'ride'
        WHEN 'ebikeride' THEN 'ride' WHEN 'mountainbikeride' THEN 'mtb'
        WHEN 'walk' THEN 'walk' WHEN 'hike' THEN 'hike'
        WHEN 'swim' THEN 'swim' ELSE 'other'
      END,
      s.sport_type, s.start_date, s.start_date + s.elapsed_time,
      s.start_date_local, s.timezone, s.distance, s.elapsed_time,
      s.moving_time, s.total_elevation_gain, s.average_heartrate,
      s.max_heartrate, s.calories * 4.184,
      CASE WHEN s.distance > 0 THEN s.moving_time * 1000.0 / s.distance END,
      false, jsonb_build_object('importedRecord', to_jsonb(s)), s.synced_at
    FROM strava_activities AS s
    WHERE NOT EXISTS (
      SELECT 1 FROM activities AS a
      WHERE a.source = 'strava' AND a.external_id = s.id::text
    );

    -- Do not use ON CONFLICT DO NOTHING: an unrelated native row with the same
    -- generated identity must abort, rather than silently losing old history.
    IF EXISTS (
      SELECT 1 FROM strava_activities AS s
      WHERE NOT EXISTS (
        SELECT 1 FROM activities AS a
        WHERE ((a.source = 'strava' AND a.external_id = s.id::text)
          OR (a.source = 'imported' AND a.external_id = 'fitness-' || s.id))
          AND a.metadata->'importedRecord' = to_jsonb(s)
      )
    ) THEN
      RAISE EXCEPTION 'Activity history verification failed; retirement cancelled';
    END IF;
    DROP TABLE strava_activities;
  END IF;

  IF to_regclass('activities') IS NOT NULL THEN
    -- IDs are opaque foreign-key targets; retain them and their attached data.
    UPDATE activities SET source = 'imported' WHERE source = 'strava';
  END IF;
  IF to_regclass('oauth_tokens') IS NOT NULL THEN
    DELETE FROM oauth_tokens WHERE service = 'strava';
  END IF;
  IF to_regclass('health_sync_state') IS NOT NULL THEN
    DELETE FROM health_sync_state WHERE service = 'strava';
  END IF;
  IF to_regclass('health_sync_jobs') IS NOT NULL THEN
    DELETE FROM health_sync_jobs WHERE service = 'strava';
  END IF;
END $$;

DROP TABLE IF EXISTS webdav_credentials;
COMMIT;
