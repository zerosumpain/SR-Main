/** Local-only real container regression: working page, failed replacement, isolated gates. */
import { Agent } from 'undici';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const buildId = process.env.WORKING_PREVIEW_BUILD_ID;
if (!/^[a-f0-9-]{36}$/.test(buildId ?? '') || process.env.BUILDER_PREVIEW_DOMAIN) throw new Error('A synthetic local build ID is required.');
const dispatcher = new Agent({ headersTimeout: 1800000, bodyTimeout: 1800000 });
const path = `/home/jkai/workspace/${buildId}/dev`;
const routes = ['/working-preview-example'];
async function call(action, fields = {}) {
  const response = await fetch('http://127.0.0.1:5280/' + action, { method: 'POST', dispatcher, headers: { authorization: `Bearer ${process.env.BUILDER_WORKSPACE_BROKER_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ buildId, ...fields }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
if (process.argv.includes('--refresh-only')) {
  const receipt = JSON.parse(await readFile(`/var/lib/development-broker/${buildId}-preview.json`, 'utf8'));
  const result = await call('preview', { revision: receipt.revision, routes, working: true });
  assert.equal(result.revision, receipt.revision);
  console.log('PASS retained preview refresh:', JSON.stringify(result));
  await dispatcher.close(); process.exit(0);
}
const page = `<script>import PageHeader from '$lib/components/PageHeader.svelte'; let saved = $state(false);</script><PageHeader /><h1>Synthetic working preview</h1><p>Local sample data only.</p><button onclick={() => saved = true}>Save preference</button><p>{saved ? "Preference saved" : "No preference saved yet"}</p>`;
if (!process.argv.includes('--verify-only')) {
  await call('prepare');
  await mkdir(`${path}/src/routes/working-preview-example`, { recursive: true });

  await writeFile(`${path}/src/routes/working-preview-example/+page.svelte`, page);
  await writeFile(`${path}/.development-preview.json`, JSON.stringify({ complete: false, scenarios: [{ route: routes[0], text: 'Synthetic working preview', steps: [{ action: 'click', role: 'button', name: 'Save preference' }, { action: 'text', text: 'Preference saved' }] }] }));
  const first = await call('snapshot');
  const preview = await call('preview', { revision: first.revision, routes, working: true });
  assert.equal(preview.evidence.length, 2);
  console.log('PASS first working preview:', JSON.stringify(preview));
  // Real Bubblewrap-backed authored-handler tests in the exact preview runtime.
  const receipt = JSON.parse(await readFile(`/var/lib/development-broker/${buildId}-preview.json`, 'utf8'));
  const tests = execFileSync('docker', ['exec', '-e', 'JKAI_SERVICE_ROLE=web', receipt.name, 'npx', '--no-install', 'vitest', 'run', 'src/lib/jkai/grounding/authored.test.ts'], { encoding: 'utf8', timeout: 120000 });
  console.log('Namespace test result:', tests.slice(-1800));
  await writeFile(`${path}/src/routes/working-preview-example/+page.svelte`, '<script> this is deliberately invalid syntax </script>');
  const bad = await call('snapshot');
  await assert.rejects(call('preview', { revision: bad.revision, routes, working: true }));
  assert.equal(JSON.parse(await readFile(`/var/lib/development-broker/${buildId}-preview.json`, 'utf8')).revision, first.revision);
  const response = await fetch(preview.url.replace('127.0.0.1', 'development-docker') + routes[0], { headers: { host: '127.0.0.1' } });
  assert.equal(response.status, 200); assert.match(await response.text(), /Synthetic working preview/);
  console.log('PASS failed replacement retained the previous running page and receipt.');
  await writeFile(`${path}/src/routes/working-preview-example/+page.svelte`, page);
}
if (process.argv.includes('--verify') || process.argv.includes('--verify-only')) {
  await writeFile(`${path}/src/routes/working-preview-example/+page.svelte`, page);
  const manifest = JSON.parse(await readFile(`${path}/.development-preview.json`, 'utf8')); manifest.complete = true;
  await writeFile(`${path}/.development-preview.json`, JSON.stringify(manifest));
  const candidate = await call('snapshot');
  const verified = await call('verify', { revision: candidate.revision, routes });
  console.log('PASS full isolated verification:', JSON.stringify(verified));
}
await dispatcher.close();
