/** Run inside the local broker; retains the synthetic preview for inspection. */
import { Agent } from 'undici';
const dispatcher = new Agent({ headersTimeout: 1800000, bodyTimeout: 1800000 });
import assert from 'node:assert/strict';
import { writeFile, readFile, unlink } from 'node:fs/promises';
const buildId = 'development-smoke-final';
async function call(action, fields = {}) {
  const response = await fetch(`http://127.0.0.1:5280/${action}`, { method: 'POST', dispatcher, headers: { authorization: `Bearer ${process.env.BUILDER_WORKSPACE_BROKER_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ buildId, ...fields }), signal: AbortSignal.timeout(action === 'accept' ? 1800000 : 600000) });
  const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); console.log(action, result); return result;
}
if (!process.argv.includes('--accept-only')) {
await call('prepare');
await writeFile('/home/jkai/workspace/development-smoke-final/dev/static/development-smoke.txt', 'Isolated local feature preview\n');
const { revision } = await call('snapshot');
const result = await call('preview', { revision });
const response = await fetch(result.url.replace('127.0.0.1', 'development-docker') + '/development-smoke.txt', { headers: { host: '127.0.0.1' } });
assert.equal(await response.text(), 'Isolated local feature preview\n');
// The broker must refuse executable git configuration before running git.
const path = '/home/jkai/workspace/development-smoke-final/dev/.git/config';
const original = await readFile(path, 'utf8');
try {
  await writeFile(path, original + '\n[core]\n fsmonitor = /bin/false\n');
  await assert.rejects(call('snapshot'), /Untrusted repository configuration/);
} finally { await writeFile(path, original); }
console.log('PASS: cumulative snapshot, candidate commit, isolated full-site preview and untrusted git configuration rejection.');

}
if (process.argv.includes('--accept') || process.argv.includes('--accept-only')) {
  await unlink('/home/jkai/workspace/development-smoke-final/dev/static/development-smoke.txt').catch((e) => { if (e.code !== 'ENOENT') throw e; });
  const candidate = await call('snapshot');
  const accepted = await call('accept', { revision: candidate.revision });
  assert.equal((await call('accept', { revision: candidate.revision })).batch, accepted.batch);
  console.log('PASS: combined repository gates and idempotent batch acceptance; synthetic marker removed before integration.');
}
