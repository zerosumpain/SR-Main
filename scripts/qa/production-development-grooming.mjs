/** One bounded live model smoke per grooming implementation; never starts Pi. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
export async function verifyGrooming(headers) {
  const fingerprint = createHash('sha256').update(await readFile(new URL('../../src/lib/jkai/development-grooming.server.ts', import.meta.url))).digest('hex');
  const stamp = '/opt/sr-development/verified-grooming.sha256';
  if ((await readFile(stamp, 'utf8').catch(() => '')).trim() === fingerprint) {
    console.log('PASS: this grooming implementation already passed the live model smoke.');
    return;
  }
  const prompt = 'Deployment smoke: let the signed-in owner save a named comparison of two weeks of step counts on the Health page. Use the existing measurements; no new external service. Propose a small first version.';
  const endpoint = 'http://127.0.0.1:4173/api/jkai/development';
  const options = { headers: { ...headers, origin: 'https://strangeramblings.com', 'content-type': 'application/json' }, redirect: 'manual' };
  let id;
  try {
    const created = await fetch(endpoint, { ...options, method: 'POST', body: JSON.stringify({ outcome: prompt, area: 'Health' }), signal: AbortSignal.timeout(30000) });
    assert.equal(created.status, 201, 'Synthetic draft creation must succeed');
    id = (await created.json()).buildId;
    assert.match(id, /^[a-f0-9-]{36}$/);
    const current = await fetch(`${endpoint}/${id}`, options);
    assert.equal(current.status, 200);
    const { delivery } = await current.json();
    const groomed = await fetch(`${endpoint}/${id}`, { ...options, method: 'POST', body: JSON.stringify({ action: 'groom', area: 'Health', outcome: prompt,
      revision: delivery.revision, briefRevision: delivery.state.brief.revision }), signal: AbortSignal.timeout(100000) });
    if (groomed.status !== 200) {
      // Error text is bounded; never log request credentials or model context.
      const result = await groomed.json().catch(() => ({}));
      throw new Error(`Live grooming failed (${groomed.status}): ${String(result.error ?? 'no detail').slice(0, 300)}`);
    }
    const saved = await fetch(`${endpoint}/${id}`, options);
    assert.equal(saved.status, 200);
    const { delivery: result, build } = await saved.json();
    assert.ok(result.state.criteria.length > 0, 'Model must propose acceptance criteria');
    assert.ok(result.state.brief.validation?.trim(), 'Model must propose validation');
    assert.equal(typeof result.state.brief.dependencies, 'string');
    assert.ok(result.state.grooming?.model, 'Model attribution must be saved');
    assert.equal(result.state.brief.acceptedAt, null, 'Grooming must not approve implementation');
    assert.equal(build.status, 'paused', 'Grooming must not start Pi');
    assert.equal(result.state.originalAsk, prompt);
    await writeFile(stamp, `${fingerprint}\n`, { mode: 0o600 });
    console.log(`PASS: live model grooming saved ${result.state.criteria.length} criteria, dependencies and validation; original ask retained, brief unaccepted, Pi not started.`);
  } finally {
    if (id) {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try { await client.query('delete from jkai_builds where id=$1 and prompt=$2 and status=$3', [id, prompt, 'paused']); }
      finally { await client.end(); }
    }
  }
}
