import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname)) {
  throw new Error('TEST_DATABASE_URL must name an isolated loopback PostgreSQL database');
}
const migration = readFileSync(new URL('./migrations/2026-09-27-retire-integrations.sql', import.meta.url), 'utf8');
const guard = new URL('./check-retired-integration-storage.mjs', import.meta.url);
const execFileAsync = promisify(execFile);

async function fixture(t) {
  const schema = `retirement_test_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString });
  await client.connect();
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  t.after(async () => {
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  });
  const scopedUrl = new URL(connectionString);
  scopedUrl.searchParams.set('options', `-csearch_path=${schema}`);
  return { client, scopedUrl };
}

const tables = `
  CREATE TABLE activities (
    id text PRIMARY KEY, source text NOT NULL, external_id text NOT NULL,
    name text NOT NULL, activity_type text NOT NULL, raw_type text,
    start_date integer NOT NULL, end_date integer NOT NULL,
    start_date_local text NOT NULL, timezone text, distance_m double precision,
    duration_s integer NOT NULL, active_duration_s integer, elevation_gain_m double precision,
    avg_heartrate integer, max_heartrate integer, active_energy_kj double precision,
    avg_pace_s_per_km double precision, has_track boolean DEFAULT false,
    metadata jsonb, synced_at integer, UNIQUE(source, external_id)
  );
  CREATE TABLE activity_tracks (activity_id text REFERENCES activities(id), coordinates jsonb);
  CREATE TABLE strava_activities (
    id bigint PRIMARY KEY, name text, sport_type text, start_date integer,
    start_date_local text, timezone text, elapsed_time integer, moving_time integer,
    distance integer, total_elevation_gain integer, average_heartrate integer,
    max_heartrate integer, calories integer, synced_at integer,
    featured boolean, featured_caption text, map_data text
  );
  CREATE TABLE webdav_credentials (id text PRIMARY KEY, secret_hash text);
  CREATE TABLE oauth_tokens (service text);
  CREATE TABLE health_sync_state (service text);
  CREATE TABLE health_sync_jobs (service text);
  INSERT INTO webdav_credentials VALUES ('retired', 'synthetic-hash');
  INSERT INTO oauth_tokens VALUES ('strava'), ('whoop');
  INSERT INTO health_sync_state VALUES ('strava'), ('whoop');
  INSERT INTO health_sync_jobs VALUES ('strava'), ('whoop'), ('all');
  INSERT INTO strava_activities VALUES
    (1, 'Old trail', 'TrailRun', 1700000000, '2023-11-14T22:13:20', 'UTC',
     4000, 3600, 10000, 300, 140, 180, 500, 1700000001, true, 'Keep this caption', '{"summary_polyline":"abc"}'),
    (2, 'Existing native ride', 'Ride', 1700000000, '2023-11-14T22:13:20', 'UTC',
     5000, 4500, 20000, 200, NULL, NULL, NULL, 1700000001, false, NULL, NULL),
    (3, 'Other activity', 'Kayak', 1700000000, '2023-11-14T22:13:20', 'UTC',
     1000, 900, 0, 0, NULL, NULL, NULL, 1700000001, false, NULL, NULL);
  INSERT INTO activities (id, source, external_id, name, activity_type, start_date,
    end_date, start_date_local, duration_s, metadata, has_track)
    VALUES ('strava:2', 'strava', '2', 'Owner corrected title', 'ride', 1700000000,
      1700005000, '2023-11-14T22:13:20', 5000, '{"ownerNote":"keep"}', true);
  INSERT INTO activity_tracks VALUES ('strava:2', '[[1,2,3,4]]');
`;

test('retirement preserves native history and attachments, removes storage, and is repeatable', async (t) => {
  const { client, scopedUrl } = await fixture(t);
  await client.query(tables);
  const env = { ...process.env, DATABASE_URL: scopedUrl.href };
  await assert.rejects(execFileAsync(process.execPath, [guard.pathname], { env }), /Retired integration storage still exists/);
  await client.query(migration);
  const { rows } = await client.query('SELECT * FROM activities ORDER BY id');
  assert.equal(rows.length, 3);
  const imported = rows.find((r) => r.id === 'imported:fitness-1');
  assert.equal(imported.activity_type, 'trail_run');
  assert.equal(imported.distance_m, 10000);
  assert.equal(imported.duration_s, 4000);
  assert.equal(imported.active_duration_s, 3600);
  assert.equal(imported.active_energy_kj, 2092);
  assert.equal(imported.avg_pace_s_per_km, 360);
  assert.equal(imported.metadata.importedRecord.featured_caption, 'Keep this caption');
  assert.equal(imported.metadata.importedRecord.map_data, '{"summary_polyline":"abc"}');
  const existing = rows.find((r) => r.id === 'strava:2');
  assert.equal(existing.source, 'imported');
  assert.equal(existing.name, 'Owner corrected title');
  assert.equal(existing.metadata.ownerNote, 'keep');
  assert.equal(existing.metadata.importedRecord.id, 2);
  assert.equal((await client.query('SELECT * FROM activity_tracks')).rowCount, 1);
  assert.equal(rows.find((r) => r.id === 'imported:fitness-3').avg_pace_s_per_km, null);
  assert.deepEqual((await client.query('SELECT service FROM oauth_tokens')).rows, [{ service: 'whoop' }]);
  assert.equal((await client.query('SELECT * FROM health_sync_jobs')).rowCount, 2);
  assert.equal((await client.query("SELECT to_regclass('strava_activities') AS old, to_regclass('webdav_credentials') AS credentials")).rows[0].old, null);
  await client.query(migration);
  assert.equal((await client.query('SELECT * FROM activities')).rowCount, 3);
  await execFileAsync(process.execPath, [guard.pathname], { env });
});

test('identity conflicts roll back history and credentials instead of skipping data', async (t) => {
  const { client } = await fixture(t);
  await client.query(tables);
  await client.query(`INSERT INTO activities (id,source,external_id,name,activity_type,
    start_date,end_date,start_date_local,duration_s) VALUES
    ('imported:fitness-1','manual','unrelated','Keep me','walk',0,1,'2020-01-01',1)`);
  await assert.rejects(client.query(migration), /duplicate key/);
  await client.query('ROLLBACK');
  assert.equal((await client.query('SELECT * FROM strava_activities')).rowCount, 3);
  assert.equal((await client.query('SELECT * FROM webdav_credentials')).rowCount, 1);
  assert.equal((await client.query("SELECT source FROM activities WHERE id='strava:2'")).rows[0].source, 'strava');
});

test('a fresh database with neither retired table needs no migration', async (t) => {
  const { client } = await fixture(t);
  await client.query(migration);
  await client.query(migration);
});

test('missing native schema refuses retirement without deleting the source', async (t) => {
  const { client } = await fixture(t);
  await client.query('CREATE TABLE strava_activities (id bigint)');
  await assert.rejects(client.query(migration), /Native activities table is required/);
  await client.query('ROLLBACK');
  assert.ok((await client.query("SELECT to_regclass('strava_activities') AS old")).rows[0].old);
});
