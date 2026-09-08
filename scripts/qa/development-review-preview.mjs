/** Synthetic review response, real local UI and saved model attribution. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import pg from 'pg';
const client = new pg.Client({ connectionString: 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local' });
await client.connect();
const id = crypto.randomUUID(), candidate = 'a'.repeat(40), base = 'http://192.168.0.77:5275';
const state = { version: 1, area: 'Platform', stage: 'review', brief: { revision: 1, outcome: 'Synthetic default review', constraints: '', routes: ['/rome-holiday-planner'], acceptedAt: '2026-09-08' },
  criteria: [{ id: 'save', text: 'Save a stop', verdict: 'unverified', evidence: '', revision: null }], decisions: [], session: { engine: 'pi', id: 'fixture', file: null, recovery: null }, candidate, gate: { passed: true, revision: candidate, evidence: 'Synthetic gate' }, preview: { url: 'https://preview-5281.strangeramblings.com/?__sr_grant=fixture', status: 'ready', revision: candidate, kind: 'working', detail: 'Synthetic browser fixture' }, batch: null, acceptedAt: null, releasePolicy: 'preview_only' };
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await client.query("insert into jkai_builds(id,prompt,status) values($1,'Synthetic default review','paused')", [id]);
  await client.query('insert into jkai_build_deliveries(build_id,state) values($1,$2)', [id, JSON.stringify(state)]);
  await page.route('https://preview-5281.strangeramblings.com/**', r => r.fulfill({ contentType: 'text/html', body: '<h1>Synthetic Rome planner</h1><p>Saved stop</p>' }));
  let calls = 0;
  await page.route(`**/api/jkai/development/${id}`, async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().action !== 'continue') return route.continue();
    calls++;
    assert.equal((await client.query('select state from jkai_build_deliveries where build_id=$1', [id])).rows[0].state.criteria[0].verdict, 'unverified');
    state.criteria[0].assessment = { verdict: 'passed', basis: 'inferred', evidence: 'Inspected implementation and observed Saved stop.', model: 'Synthetic reviewer', revision: candidate, at: new Date().toISOString() };
    state.stage = 'accepted'; state.acceptedAt = new Date().toISOString(); state.batch = candidate;
    await client.query('update jkai_build_deliveries set state=$2,revision=revision+1 where build_id=$1', [id, JSON.stringify(state)]);
    await route.fulfill({ json: { ok: true, next: 'accepted' } });
  });
  await page.goto(`${base}/jkai/develop/${id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', {name:'Continue iteration', exact:true}).waitFor();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.frameLocator('iframe').getByRole('heading', { name: 'Synthetic Rome planner' }).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const link = page.getByRole('link', { name: 'Open site preview', exact: false });
    assert.match(await link.getAttribute('href'), /\/rome-holiday-planner\?__sr_grant=fixture/);
    assert.match(await page.locator('iframe').getAttribute('src'), /\/rome-holiday-planner\?__sr_grant=fixture/);
    assert.ok(await page.getByRole('button', { name: 'Continue automatically', exact: true }).isEnabled());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.getByRole('button', { name: 'Continue automatically', exact: true }).click();
  await page.getByRole('button', { name: 'Accepted into batch', exact: true }).waitFor();
  assert.equal(calls, 1);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByText('Model assessment: passed · inferred', { exact: false }).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByText('Model assessment: passed · inferred', { exact: false }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/development-review-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: feature iframe/link routes, blank-criteria default continuation, model attribution and responsive layout. Synthetic review; no provider called.');
} finally { await client.query('delete from jkai_builds where id=$1', [id]); await client.end(); await browser.close(); }
