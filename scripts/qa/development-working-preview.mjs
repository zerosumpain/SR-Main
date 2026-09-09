/** Synthetic local workspace UI coverage; no model is started. Retains the paused example. */
import { chromium } from 'playwright';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const id = process.env.WORKING_PREVIEW_BUILD_ID;
if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw new Error('Provide the synthetic local broker fixture UUID.');
const receipt = JSON.parse(execFileSync('docker', ['exec', 'porkserv-local-development-broker-1', 'cat', `/var/lib/development-broker/${id}-preview.json`], { encoding: 'utf8' }));
const base = 'http://192.168.0.77:5275';
const client = new pg.Client({ connectionString: 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local' });
await client.connect();
const state = { version: 1, area: 'Platform', stage: 'building', originalAsk: 'Synthetic working-preview example',
  brief: { revision: 1, outcome: 'Synthetic working-preview example', constraints: 'Local sample data only; no model calls.', routes: ['/working-preview-example'], acceptedAt: new Date().toISOString() },
  criteria: [{ id: 'core', text: 'Save preference shows a visible result', verdict: 'unverified', evidence: '', revision: null }],
  decisions: [], session: { engine: 'pi', id: null, file: null, recovery: null }, candidate: receipt.revision, gate: null,
  preview: { url: receipt.url, revision: receipt.revision, number: 1, kind: 'working', status: 'ready', evidence: receipt.evidence, detail: 'Synthetic example: working page checked in a real isolated container. Owner acceptance remains pending.' },
  batch: null, acceptedAt: null, releasePolicy: 'preview_only' };
await client.query("insert into jkai_builds(id,prompt,status) values($1,$2,'paused') on conflict(id) do nothing", [id, state.brief.outcome]);
await client.query('insert into jkai_build_deliveries(build_id,state) values($1,$2) on conflict(build_id) do update set state=excluded.state,revision=jkai_build_deliveries.revision+1', [id, JSON.stringify(state)]);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
let scenario = 'working';
await page.route(`**/api/jkai/development/${id}`, async route => {
  if (route.request().method() !== 'GET') return route.continue();
  const response = await route.fetch(); const data = await response.json();
  // Simulated in-flight states never mark the real database build running.
  if (scenario !== 'paused') data.build.status = 'running';
  data.delivery.state.cycle = { startedAt: '2026-09-08T00:00:00Z', firstPreviewAt: '2026-09-08T00:02:00Z', repairAttempts: 0, modelMs: 60000, previewMs: 60000, verificationMs: 0, phaseMs: { setup: 10000, build: 40000, browser: 10000 }, ...(scenario === 'failed' ? { failureKind: 'infrastructure', failure: 'Synthetic executor unavailable; saved preview retained.' } : {}) }; 
  if (scenario === 'replacing' || scenario === 'failed') {
    data.delivery.state.candidate = 'b'.repeat(40);
    data.delivery.state.preview.status = scenario === 'replacing' ? 'starting' : 'ready';
    data.delivery.state.preview.detail = 'Previous working preview retained while the next revision is checked.';
    if (scenario === 'failed') data.delivery.state.preview.lastError = 'Synthetic replacement failed; previous working page retained.';
  }
  await route.fulfill({ response, json: data });
});
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (scenario of ['working', 'replacing', 'failed']) {
      await page.goto(`${base}/jkai/develop/${id}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Working preview 1 · iterating', exact: true }).waitFor();
      await page.getByText('Checkpoint targets: working preview in 10m · release candidate in 20m.', { exact: true }).waitFor();
      if (scenario === 'working') await page.screenshot({ path: `/tmp/development-working-build-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      const frame = page.frameLocator('iframe[title="Isolated feature preview"]');
      await frame.getByRole('heading', { name: 'Synthetic working preview', exact: true }).waitFor();
      // The SSR button is visible before Svelte attaches its event handler.
      const iframe = await page.locator('iframe[title="Isolated feature preview"]').elementHandle();
      await (await iframe.contentFrame()).waitForLoadState('networkidle');
      await frame.getByRole('button', { name: 'Save preference', exact: true }).click();
      await frame.getByText('Preference saved', { exact: true }).waitFor();
      // Recording an observation about the revision on screen is allowed even
      // while the worker runs — that is the point of a working preview, and
      // refusing it was what stopped an owner progressing. Acceptance is still
      // protected, which is asserted on the Delivery tab below.
      assert.equal(await page.getByRole('button', { name: 'Save evidence', exact: true }).first().isDisabled(), false);
      if (scenario === 'failed') await page.getByRole('alert').filter({ hasText: 'Synthetic replacement failed' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/tmp/development-working-${scenario}-${width}.png`, fullPage: true });
    }
  }
  scenario = 'paused';
  await page.goto(`${base}/jkai/develop/${id}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Delivery', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Continue automatically', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(`PASS: real feature iframe, desktop/phone working/replacing/failed states, retained interaction and acceptance protection. Example: ${base}/jkai/develop/${id}`);
} finally { await browser.close(); await client.end(); }
