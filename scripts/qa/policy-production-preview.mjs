// Same built SvelteKit application on loopback, with the isolated local database.
// Exercises production authentication and adapter-node's real upload ceiling.
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import assert from 'node:assert/strict';
import { encode } from '@auth/core/jwt';
import pg from 'pg';
const base = 'http://127.0.0.1:5291';
const database = 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local';
const log = openSync('/tmp/policy-production-preview.log', 'w');
const child = spawn(process.execPath, ['scripts/server-with-ws.mjs'], {
  env: { ...process.env, TZ: 'UTC', HOST: '127.0.0.1', PORT: '5291', NODE_ENV: 'production', DATABASE_URL: database,
    ORIGIN: base, AUTH_URL: base, AUTH_SECRET: 'jkai-preview-local-only', AUTH_TRUST_HOST: 'true', AUTH_ALLOWED_EMAILS: 'preview@example.test,second@example.test',
    JKAI_SERVICE_ROLE: 'builder', POLICY_ANALYSIS_WORKER: '0', POLICY_ANALYSIS_ENABLED: '1', PUBLIC_VAPID_PUBLIC_KEY: '' },
  stdio: ['ignore', log, log],
});
let id;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(`${base}/api/policy-analysis`); if (response.status === 401) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(ready, 'production preview did not become ready');
  const cookie = async (email) => `authjs.session-token=${await encode({ token: { email, name: 'Synthetic preview owner' }, secret: 'jkai-preview-local-only', salt: 'authjs.session-token', maxAge: 3600 })}`;
  const owner = await cookie('preview@example.test');
  const list = await fetch(`${base}/api/policy-analysis`, { headers: { cookie: owner } });
  assert.equal(list.status, 200); assert.match(list.headers.get('cache-control'), /private.*no-store/);
  assert.equal((await fetch(`${base}/api/policy-analysis`, { headers: { cookie: await cookie('guest@example.test') } })).status, 403);
  const form = new FormData(); form.set('title', 'Synthetic production upload fixture');
  form.set('document', new Blob(['Synthetic policy larger than adapter-node default.\n' + 'a'.repeat(540000)], { type: 'text/plain' }), 'large-fixture.txt');
  const created = await fetch(`${base}/api/policy-analysis`, { method: 'POST', headers: { cookie: owner, origin: base }, body: form });
  assert.equal(created.status, 201, await created.clone().text()); id = (await created.json()).id;
  assert.equal((await fetch(`${base}/api/policy-analysis/${id}`, { headers: { cookie: await cookie('second@example.test') } })).status, 404);
  assert.equal((await fetch(`${base}/api/policy-analysis/${id}/document`, { headers: { cookie: await cookie('second@example.test') } })).status, 404);
  assert.equal((await fetch(`${base}/api/policy-analysis/${id}/cancel`, { method: 'POST', headers: { cookie: owner, origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(`${base}/api/policy-analysis/${id}/cancel`, { method: 'POST', headers: { cookie: owner, origin: base } })).status, 200);
  console.log('PASS: production owner/guest/anonymous access, cross-owner privacy, CSRF, no-store, >512 KB multipart upload and cancellation. No provider calls.');
} finally {
  if (id) {
    const client = new pg.Client({ connectionString: database }); await client.connect();
    try { await client.query('delete from policy_analyses where id=$1 and owner=$2', [id, 'preview@example.test']); await client.query("delete from workflow_runs where input_data->>'analysisId'=$1", [id]); }
    finally { await client.end(); }
  }
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  closeSync(log);
}
