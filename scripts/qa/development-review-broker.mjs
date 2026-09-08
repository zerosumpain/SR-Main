/** Local-only: inspect a retained synthetic preview without rebuilding it. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
if (process.env.BUILDER_PREVIEW_DOMAIN) throw new Error('Synthetic local runtime required.');
const id = 'ba19e5c0-9359-4873-80bb-53bb71eddd61';
const file = `/var/lib/development-broker/${id}-preview.json`;
const before = await readFile(file, 'utf8'), receipt = JSON.parse(before);
const response = await fetch('http://127.0.0.1:5280/inspect', { method: 'POST', headers: { authorization: `Bearer ${process.env.BUILDER_WORKSPACE_BROKER_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ buildId: id, revision: receipt.revision }), signal: AbortSignal.timeout(125000) });
const result = await response.json();
assert.ok(response.ok, result.error);
assert.equal(result.revision, receipt.revision);
assert.equal(result.evidence.length, 2);
assert.ok(result.evidence.every(e => e.includes('Observed page:') && e.includes('Preference saved')));
assert.ok(result.changes.patch.includes('working-preview-example'));
assert.equal(await readFile(file, 'utf8'), before, 'Inspection must retain the published preview');
console.log('PASS: fresh desktop/phone inspection, implementation diff, and retained preview receipt.');
