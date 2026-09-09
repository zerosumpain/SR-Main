import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base = process.env.POLICY_PREVIEW_ORIGIN ?? 'http://localhost:5275';
const form = new FormData(); form.set('title', 'Synthetic autonomous worker check');
form.set('document', new Blob([readFileSync('tests/fixtures/policy-analysis/policy.txt')], { type: 'text/plain' }), 'fixture.txt');
const response = await fetch(`${base}/api/policy-analysis`, { method: 'POST', headers: { origin: base }, body: form });
assert.equal(response.status, 201, await response.clone().text());
const { id } = await response.json(); console.log(`Created ${base}/policy-analysis/${id}`);
try {
  let result;
  for (let i = 0; i < 120; i++) {
    const status = await fetch(`${base}/api/policy-analysis/${id}`); assert.equal(status.status, 200);
    result = await status.json();
    if (result.analysis.status === 'failed') break;
    if (result.stages[0].status === 'completed' && result.stages[1].attempts > 0 && i > 10) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(result.stages[0].status, 'completed');
  assert.ok(result.artefacts.some((a) => a.kind === 'passage'));
  assert.ok(result.stages[1].attempts > 0, 'the real background worker did not continue autonomously');
  console.log(`PASS: autonomous worker persisted ingestion and advanced to ${result.stages[1].name}; status ${result.analysis.status}, ${result.calls.length} audited provider call(s).`);
} finally {
  const cancelled = await fetch(`${base}/api/policy-analysis/${id}/cancel`, { method: 'POST', headers: { origin: base } });
  assert.equal(cancelled.status, 200);
  console.log('Stopped the synthetic check; the private audit and source remain available.');
}
