/** Browser journey on the isolated LAN stack. Model/worker/preview execution is simulated. */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
const base = 'http://192.168.0.77:15432';
const screenshots = '/home/john/site-tech-debt-review-2026-09-26/build-ui-screenshots';
await mkdir(screenshots, { recursive: true });
const client = new pg.Client({ connectionString: 'postgresql://workflows_jkai_local:workflows_jkai_local_only@127.0.0.1:15445/workflows_jkai_local' });
await client.connect();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
let id;
const revision = 'a'.repeat(40);
async function edit(change) {
  const row = (await client.query('select state from jkai_build_deliveries where build_id=$1', [id])).rows[0];
  await client.query('update jkai_build_deliveries set state=$2,revision=revision+1 where build_id=$1', [id, JSON.stringify(change(row.state))]);
}
const previewUrl = expired => `${base}/?__sr_grant=${Buffer.from(JSON.stringify({ expires: Date.now() + (expired ? -10000 : 3600000) })).toString('base64url')}.synthetic`;
const demo = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#ede4d4;color:#1a1008;font:18px system-ui;margin:0;padding:24px}input,button{font:inherit;padding:10px;max-width:100%;box-sizing:border-box}label{display:grid;gap:8px;margin:20px 0}button{background:#c4570a;color:#fff;border:0}small{display:block}</style></head><body><small>SYNTHETIC BROWSER FIXTURE</small><h1>Sausage generator</h1><label>Seed<input value="sample" id="seed"></label><button onclick="document.getElementById('result').textContent='Generated: '+document.getElementById('seed').value">Generate sausage</button><p id="result" role="status">Choose a seed.</p></body></html>`;
await context.route('**/demo/**', route => route.fulfill({ contentType: 'text/html', body: demo }));
// Grooming is the only substituted service during real UI creation and brief acceptance.
await context.route('**/api/jkai/development/*', async route => {
  const request = route.request();
  if (request.method() !== 'POST') return route.continue();
  const body = request.postDataJSON();
  if (body.action !== 'groom') return route.continue();
  id = new URL(request.url()).pathname.split('/').at(-1);
  await edit(s => ({ ...s, brief: { ...s.brief, revision: s.brief.revision + 1, outcome: body.outcome, routes: ['/demo/sausage', '/demo/help'] }, criteria: [{ id: 'criterion-1', text: 'Generate changes the result for the chosen seed', verdict: 'unverified', evidence: '', revision: null }], grooming: { summary: 'Synthetic proposal for browser testing; no model was called.', model: 'fixture', at: new Date().toISOString() } }));
  await route.fulfill({ json: { ok: true } });
});
try {
  await page.goto(`${base}/jkai/build`, { waitUntil: 'networkidle' });
  assert.equal(new URL(page.url()).pathname, '/jkai/develop');
  await expect(page.getByRole('button', { name: 'Shape this idea →' })).toBeDisabled();
  const area = await page.getByLabel('Product area', { exact: true }).boundingBox();
  const model = await page.getByLabel('Build model', { exact: true }).boundingBox();
  assert.ok(Math.abs(area.y - model.y) < 2, 'starting selectors align at their top edges');
  assert.ok(Math.abs(area.height - model.height) < 2, 'starting selectors have equal heights');
  await page.screenshot({ path: `${screenshots}/start-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${screenshots}/start-phone.png`, fullPage: true });
  await page.getByLabel('Intended outcome', { exact: true }).fill('Synthetic build journey: generate a sausage');
  await page.getByRole('button', { name: 'Shape this idea →' }).click();
  await expect(page.getByText('Synthetic proposal for browser testing; no model was called.')).toBeVisible();
  assert.ok(id, 'created build reached grooming');
  await page.getByRole('button', { name: 'Accept brief', exact: true }).click();
  await expect(page).toHaveURL(/tab=build/);
  const saved = (await client.query('select state from jkai_build_deliveries where build_id=$1', [id])).rows[0].state;
  assert.ok(saved.brief.acceptedAt);
  await page.getByRole('button', { name: 'Build first working page', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('development worker is not ready');
  // The stack has no matching live model worker. Supply its saved-candidate outcome.
  await edit(s => ({ ...s, candidate: revision, preview: { url: previewUrl(true), revision, status: 'ready', kind: 'working', detail: 'Synthetic expiry regression' } }));
  await page.goto(`${base}/jkai/develop/${id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Refresh access to your preview' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.screenshot({ path: `${screenshots}/expired-phone.png`, fullPage: true });
  // Simulate a provisioning failure through the same API action the button sends.
  let attempts = 0;
  let finishPreparation;
  await context.route(`**/api/jkai/development/${id}`, async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().action !== 'preview') return route.fallback();
    attempts++;
    if (attempts === 1) {
      await edit(s => ({ ...s, preview: { ...s.preview, status: 'failed', lastError: 'Synthetic preview host unavailable.' } }));
      return route.fulfill({ status: 400, json: { error: 'Synthetic preview host unavailable.' } });
    }
    if (attempts === 3) {
      await edit(s => ({ ...s, preview: { ...s.preview, status: 'starting', detail: 'Synthetic replacement preparation' } }));
      await new Promise(resolve => finishPreparation = resolve);
      await edit(s => ({ ...s, preview: { ...s.preview, status: 'ready' } }));
      return route.fulfill({ json: { ok: true } });
    }
    await edit(s => ({ ...s, preview: { url: previewUrl(false), revision, status: 'ready', kind: 'working', number: 1, detail: 'Synthetic browser fixture only' } }));
    await route.fulfill({ json: { ok: true } });
  });
  await page.getByRole('button', { name: 'Refresh preview access', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic preview host unavailable.');
  await page.getByRole('button', { name: 'Refresh preview access', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your preview is ready to try' })).toBeVisible();
  await page.frameLocator('iframe').getByLabel('Seed').fill('pepper');
  await page.frameLocator('iframe').getByRole('button', { name: 'Generate sausage' }).click();
  await expect(page.frameLocator('iframe').getByRole('status')).toHaveText('Generated: pepper');
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Phone', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Page to test').selectOption('/demo/help');
  assert.match(await page.locator('iframe').getAttribute('src'), /\/demo\/help\?/);
  await page.getByRole('button', { name: 'Reload preview' }).click();
  await expect(page.frameLocator('iframe').getByRole('status')).toHaveText('Choose a seed.');
  // Refreshing another revision must not block observations on the retained version.
  await edit(s => ({ ...s, stage: 'review', candidate: 'b'.repeat(40) }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Prepare latest preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preparing preview…', exact: true })).toBeDisabled();
  await page.getByLabel('Verdict for Generate changes the result for the chosen seed').selectOption('passed');
  await page.getByLabel('Evidence for Generate changes the result for the chosen seed').fill('Generated pepper after changing the seed.');
  await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
  await expect(page.getByText(`Recorded: passed on ${revision.slice(0, 8)}`)).toBeVisible();
  assert.ok(finishPreparation, 'preparation stayed in flight while evidence was saved');
  finishPreparation();
  await expect(page.getByRole('heading', { name: 'Your preview is ready to try' })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Evidence for Generate changes the result for the chosen seed')).toHaveValue('Generated pepper after changing the seed.');
  await edit(s => ({ ...s, preview: { ...s.preview, status: 'ready' } }));
  await page.reload({ waitUntil: 'networkidle' });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.locator('.jkai-body').evaluate(el => el.scrollTop = 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no horizontal overflow at ${width}`);
    assert.equal(await page.locator('.wk').evaluate(el => el.scrollWidth > el.clientWidth), false, `workspace fits at ${width}`);
    await page.screenshot({ path: `${screenshots}/preview-${width}.png`, fullPage: true });
    if (width === 390) {
      await page.locator('.preview-toolbar').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${screenshots}/preview-phone-testing.png`, fullPage: true });
    }
  }
  await page.getByRole('button', { name: 'Brief', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByLabel('Intended outcome', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fields = await Promise.all(['Product area', 'Build model'].map(name => page.getByLabel(name, { exact: true }).boundingBox()));
  assert.ok(Math.abs(fields[0].y - fields[1].y) < 2, 'brief selectors align');
  assert.ok(Math.abs(fields[0].height - fields[1].height) < 2, 'brief selector heights match');
  await page.screenshot({ path: `${screenshots}/brief-desktop.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: LAN alias, desktop/tablet/phone, input alignment, create/accept/persist, worker-unavailable recovery, expired-link recovery, failed preparation/retry, embedded interaction, route switching, phone mode, reload, evidence during preparation, revision fidelity and tab persistence. Model/worker/preview provisioner simulated; database and feedback API real.');
} finally {
  if (id) await client.query('delete from jkai_builds where id=$1', [id]);
  await client.end(); await browser.close();
}
