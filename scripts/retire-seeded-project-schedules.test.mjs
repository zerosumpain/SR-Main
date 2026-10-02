// node --test scripts/retire-seeded-project-schedules.test.mjs
// Needs TEST_DATABASE_URL naming a disposable loopback PostgreSQL database.
// Each test works in its own throwaway schema and drops it afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname)) {
  throw new Error('TEST_DATABASE_URL must name an isolated loopback PostgreSQL database');
}
const migration = readFileSync(
  new URL('./migrations/2026-10-02-retire-seeded-project-schedules.sql', import.meta.url),
  'utf8',
);

// The columns the migration reads, with Main's cascades.
const tables = `
  CREATE TABLE workflows (id text PRIMARY KEY, name text NOT NULL, principal_id text NOT NULL DEFAULT 'owner');
  CREATE TABLE workflow_nodes (id text PRIMARY KEY, workflow_id text NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    type text NOT NULL, config jsonb NOT NULL DEFAULT '{}', label text NOT NULL DEFAULT '');
  CREATE TABLE workflow_edges (id text PRIMARY KEY, workflow_id text NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    source_node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
    target_node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE);
  CREATE TABLE workflow_schedules (id text PRIMARY KEY, workflow_id text NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    type text NOT NULL, config jsonb NOT NULL DEFAULT '{}', enabled boolean NOT NULL DEFAULT true);
  CREATE TABLE workflow_runs (id text PRIMARY KEY, workflow_id text NOT NULL REFERENCES workflows(id) ON DELETE CASCADE);
`;

async function fixture(t) {
  const schema = `retire_sched_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString });
  await client.connect();
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  await client.query(tables);
  const notices = [];
  client.on('notice', (n) => notices.push(n.message));
  t.after(async () => {
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  });
  return { client, notices };
}

/** The thin graph a seed route built: cron trigger -> http-request POST to the app. */
async function seeded(client, name, path, extra = {}) {
  const id = randomUUID();
  await client.query('INSERT INTO workflows (id, name, principal_id) VALUES ($1, $2, $3)', [id, name, extra.principal ?? 'owner']);
  await client.query(`INSERT INTO workflow_nodes (id, workflow_id, type, config) VALUES
    ($1, $3, 'trigger', '{"kind":"cron","cron":"0 6 * * 1"}'),
    ($2, $3, 'http-request', $4)`,
  [`${id}:t`, `${id}:h`, id, JSON.stringify({ method: 'POST', url: `https://strangeramblings.com${path}`, auth: 'bearer', authToken: 'x' })]);
  await client.query('INSERT INTO workflow_edges VALUES ($1, $2, $3, $4)', [`${id}:e`, id, `${id}:t`, `${id}:h`]);
  await client.query(`INSERT INTO workflow_schedules (id, workflow_id, type, config) VALUES ($1, $2, 'cron', '{"expression":"0 6 * * 1"}')`, [`${id}:s`, id]);
  await client.query('INSERT INTO workflow_runs VALUES ($1, $2)', [`${id}:r`, id]);
  if (extra.edited) await client.query(`INSERT INTO workflow_nodes (id, workflow_id, type) VALUES ($1, $2, 'notify')`, [`${id}:n`, id]);
  return id;
}

/** A schedule SR-Workflows registered for an app. */
async function registered(client, app, key, enabled = true) {
  const id = randomUUID();
  await client.query('INSERT INTO workflows (id, name) VALUES ($1, $2)', [id, `canvas:reg--${app}--${key}`]);
  await client.query(`INSERT INTO workflow_schedules (id, workflow_id, type, enabled) VALUES ($1, $2, 'cron', $3)`, [`${id}:s`, id, enabled]);
  return id;
}

const names = async (client) => (await client.query('SELECT name FROM workflows ORDER BY name')).rows.map((r) => r.name);
const count = async (client, table) => Number((await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

const ALL = [
  ['canvas:pe-track-ees', '/api/policy-engine/ingest'],
  ['canvas:pe-track-neet', '/api/policy-engine/ingest'],
  ['canvas:pe-track-context', '/api/policy-engine/ingest'],
  ['canvas:pe-track-annual', '/api/policy-engine/ingest'],
  ['canvas:keystone-intel-radar', '/api/dfe-data-strategy/intel'],
  ['canvas:dsd-standards-discovery', '/api/data-standard-designer/ingest'],
];

test('does nothing until the app has registered its replacement schedules', async (t) => {
  const { client, notices } = await fixture(t);
  for (const [name, path] of ALL) await seeded(client, name, path);
  await registered(client, 'policy-engine', 'track-ees', false); // disabled does not count
  await client.query(migration);
  assert.equal((await names(client)).filter((n) => !n.startsWith('canvas:reg--')).length, 6);
  assert.ok(notices.some((n) => n.includes('no enabled registered schedule')));
});

test('retires the seeded rows of registered apps only, with their graph, schedule and runs; repeatable', async (t) => {
  const { client } = await fixture(t);
  for (const [name, path] of ALL) await seeded(client, name, path);
  await registered(client, 'policy-engine', 'track-ees');
  await registered(client, 'data-standard-designer', 'standards-discovery');
  await client.query('INSERT INTO workflows (id, name) VALUES ($1, $2)', [randomUUID(), 'canvas:my-own-tracker']);
  await client.query(migration);
  assert.deepEqual(await names(client), [
    'canvas:keystone-intel-radar', // DfE has not registered yet
    'canvas:my-own-tracker',
    'canvas:reg--data-standard-designer--standards-discovery',
    'canvas:reg--policy-engine--track-ees',
  ]);
  // One seeded graph left: 2 nodes, 1 edge, 1 seeded + 2 registered schedules, 1 run.
  assert.equal(await count(client, 'workflow_nodes'), 2);
  assert.equal(await count(client, 'workflow_edges'), 1);
  assert.equal(await count(client, 'workflow_schedules'), 3);
  assert.equal(await count(client, 'workflow_runs'), 1);
  const before = await names(client);
  await client.query(migration);
  assert.deepEqual(await names(client), before);
});

test('keeps a seeded canvas the owner has edited, or one that is not the owner\'s, and says so', async (t) => {
  const { client, notices } = await fixture(t);
  await registered(client, 'policy-engine', 'track-ees');
  await seeded(client, 'canvas:pe-track-ees', '/api/policy-engine/ingest', { edited: true });
  await seeded(client, 'canvas:pe-track-neet', '/api/somewhere-else');
  await seeded(client, 'canvas:pe-track-context', '/api/policy-engine/ingest', { principal: 'u_member' });
  await seeded(client, 'canvas:pe-track-annual', '/api/policy-engine/ingest');
  await client.query(migration);
  assert.deepEqual(await names(client), [
    'canvas:pe-track-context', 'canvas:pe-track-ees', 'canvas:pe-track-neet', 'canvas:reg--policy-engine--track-ees',
  ]);
  assert.equal(notices.filter((n) => n.includes('review by hand')).length, 2);
});

test('is a no-op where the workflow tables do not exist', async (t) => {
  const { client, notices } = await fixture(t);
  await client.query('DROP TABLE workflow_runs, workflow_edges, workflow_schedules, workflow_nodes, workflows');
  await client.query(migration);
  assert.ok(notices.some((n) => n.includes('absent')));
});
