/** One bounded live model smoke per grooming implementation; never starts Pi. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
export async function verifyGrooming(headers) {
  const fingerprint = createHash('sha256').update(await readFile(new URL('../../src/lib/jkai/development-grooming.server.ts', import.meta.url))).update(await readFile(new URL(import.meta.url))).digest('hex');
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
    const questions = 'Verify the smallest readable mobile layout during implementation.';
    const accepted = await fetch(`${endpoint}/${id}`, { ...options, method: 'POST', body: JSON.stringify({
      ...result.state.brief, action: 'brief', area: 'Health', revision: result.revision,
      briefRevision: result.state.brief.revision, routes: result.state.brief.routes.join('\n'),
      criteria: result.state.criteria.map(c => c.text).join('\n'), questions,
    }), signal: AbortSignal.timeout(30000) });
    assert.equal(accepted.status, 200, 'Owner must be able to accept a brief with remaining questions');
    const confirmation = await fetch(`${endpoint}/${id}`, options);
    assert.equal(confirmation.status, 200);
    const confirmed = await confirmation.json();
    assert.ok(confirmed.delivery.state.brief.acceptedAt);
    assert.equal(confirmed.delivery.state.brief.questions, questions, 'Acceptance must retain unresolved questions');
    assert.equal(confirmed.build.status, 'paused', 'Acceptance alone must not start Pi');
    await writeFile(stamp, `${fingerprint}\n`, { mode: 0o600 });
    console.log(`PASS: live model grooming saved ${result.state.criteria.length} criteria, dependencies and validation; original ask retained, grooming did not approve; explicit acceptance retained open questions; Pi not started.`);
  } finally {
    if (id) {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try { await client.query("delete from jkai_builds where id=$1 and status=$3 and exists (select 1 from jkai_build_deliveries d where d.build_id=jkai_builds.id and d.state->>'originalAsk'=$2)", [id, prompt, 'paused']); }
      finally { await client.end(); }
    }
  }
}
