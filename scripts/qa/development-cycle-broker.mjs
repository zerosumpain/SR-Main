/** Run inside the local broker after its restart; no model or source mutations. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const id = process.env.WORKING_PREVIEW_BUILD_ID;
if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw new Error('Provide a synthetic local preview UUID.');
async function call(action, extra = {}) {
  const response = await fetch(`http://127.0.0.1:5280/${action}`, {
    method: 'POST', headers: { authorization: `Bearer ${process.env.BUILDER_WORKSPACE_BROKER_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ buildId: id, ...extra }), signal: AbortSignal.timeout(120_000),
  });
  return { status: response.status, body: await response.json() };
}
const ready = await call('preflight');
assert.equal(ready.status, 200); assert.equal(ready.body.ready, true);
assert.equal(typeof ready.body.timings.setup, 'number');
const path = `/var/lib/development-broker/${id}-preview.json`;
const before = await readFile(path, 'utf8');
const receipt = JSON.parse(before);
const expired = await call('preview', { revision: receipt.revision, routes: ['/working-preview-example'], working: true, deadline: Date.now() - 1 });
assert.equal(expired.status, 400); assert.equal(expired.body.kind, 'deadline');
assert.equal(await readFile(path, 'utf8'), before, 'Expired operations must not replace the visible snapshot');
const response = await fetch(receipt.url.replace('127.0.0.1', 'development-docker') + '/working-preview-example', { headers: { host: '127.0.0.1' } });
assert.equal(response.status, 200);
console.log('PASS: executor preflight, structured deadline failure, phase timings and retained preview after expiry.');
