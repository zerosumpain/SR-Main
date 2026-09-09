/** Synthetic paused development; exercises the real broker, database and LAN UI. */
import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const id = 'c0de9009-0000-4000-8000-000000000001';
const base = 'http://192.168.0.77:5275';
const client = new pg.Client({ connectionString: 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local' });
await client.connect();
const state = { version: 1, area: 'Platform', stage: 'brief', originalAsk: 'Synthetic CodeGraph context example',
  brief: { revision: 1, outcome: 'Synthetic example: review src/lib/jkai/development.ts and the development workspace', constraints: 'Sample only; no model calls or acceptance.', routes: ['/jkai/develop'], acceptedAt: null },
  criteria: [], decisions: [], session: { engine: 'pi', id: null, file: null, recovery: null }, candidate: null, gate: null,
  preview: { url: null, status: 'unavailable', detail: 'Synthetic context example; no feature runtime commissioned.' }, batch: null, acceptedAt: null, releasePolicy: 'preview_only' };
await client.query("insert into jkai_builds(id,prompt,title,status) values($1,$2,$2,'paused') on conflict(id) do nothing", [id, state.originalAsk]);
await client.query('insert into jkai_build_deliveries(build_id,state) values($1,$2) on conflict(build_id) do nothing', [id, JSON.stringify(state)]);
async function broker(action) {
  const code = `const r = await fetch('http://127.0.0.1:5280/${action}', {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer development-local-only'},body:JSON.stringify({buildId:'${id}'})}); const result = await r.json(); if(!r.ok) throw new Error(result.error); console.log(JSON.stringify(result));`;
  const { stdout } = await exec('docker', ['exec', 'porkserv-local-development-broker-1', 'node', '--input-type=module', '-e', code], { timeout: 180000, maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout);
}
console.log('Preparing isolated context fixture…');
await broker('prepare');
const snapshot = await broker('snapshot');
assert.ok(snapshot.codegraph.files.includes('src/lib/jkai/development.ts'));
const refreshed = await fetch(`${base}/api/jkai/development/${id}/context`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'refresh' }) });
assert.equal(refreshed.status, 200, await refreshed.text());
const browser = await chromium.launch({ headless: true });
let page = await browser.newPage(); const errors = [];
try {
  for (const width of [1440, 390]) {
    await page.close(); page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/jkai/develop/${id}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByText('Code context', { exact: false }).first().waitFor({ timeout: 60000 });
    await page.locator('summary').filter({ hasText: /^Code context/ }).click();
    await page.getByRole('heading', { name: 'Relevant files', exact: true }).waitFor({ timeout: 30000 });
    assert.ok(await page.getByText('src/lib/jkai/development.ts', { exact: true }).count());
    await page.getByRole('button', { name: 'Open source src/lib/jkai/development.ts', exact: true }).click();
    await page.getByRole('region', { name: 'Source viewer' }).waitFor();
    assert.ok((await page.getByRole('region', { name: 'Source viewer' }).textContent()).includes('newDelivery'));
    await page.getByRole('button', { name: 'Close source', exact: true }).click();
    await page.getByRole('button', { name: 'Pin src/lib/jkai/development.ts', exact: true }).click();
    await page.getByText('Pin or assess evidence', { exact: true }).click();
    await page.getByLabel('Reason', { exact: true }).fill('Synthetic preview: retain the implementation as context.');
    await page.getByRole('button', { name: 'Save assessment', exact: true }).click();
    await page.getByText('Synthetic preview: retain the implementation as context.', { exact: false }).last().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('summary').filter({ hasText: /^Code context/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/codegraph-development-${width}.png`, fullPage: true });
    console.log(`PASS: ${width}px context, source and pin.`);
  }
  for (const route of ['ask', 'sources', 'improvement', 'serves']) {
    const response = await page.goto(`${base}/jkai/codegraph/${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    assert.equal(response.status(), 200, route);
    if (route === 'sources') {
      await page.getByText('Add a reference', { exact: true }).click();
      for (const [label, value] of Object.entries({ Repository: 'codegraph-browser-fixture', Title: 'Synthetic reference', 'Source URL': 'https://example.test/codegraph-fixture', 'Commit or package version': 'fixture-v1', 'Licence or reuse terms': 'Synthetic test data', 'Relevant source excerpt': 'Synthetic reference content; no external source was fetched.' })) await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByRole('button', { name: 'Save reference', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Reference saved with version and provenance.' }).waitFor();
      const reference = await client.query("select status, access, revision, payload from codegraph_sources where repo='codegraph-browser-fixture'");
      assert.equal(reference.rows[0].status, 'reference'); assert.equal(reference.rows[0].access, 'owner'); assert.equal(reference.rows[0].revision, 'fixture-v1');
      assert.ok(reference.rows[0].payload.trust.includes('not build instructions'));
    }
  }
  // Vite's existing private-network bypass means this fixture cannot prove production authentication.
  assert.deepEqual(errors, []);
  const persisted = await client.query('select status from jkai_builds where id=$1', [id]); assert.equal(persisted.rows[0].status, 'paused');
  console.log(`PASS: real snapshot, persisted pin, desktop/mobile layout, CodeGraph routes, paused fixture. ${base}/jkai/develop/${id}`);
} finally { await browser.close(); await client.query("delete from codegraph_sources where repo='codegraph-browser-fixture' and url='https://example.test/codegraph-fixture'"); await client.end(); }
