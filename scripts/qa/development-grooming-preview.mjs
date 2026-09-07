/** Synthetic model responses; real LAN UI, creation, reload and acceptance API. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import pg from 'pg';
const base = 'http://192.168.0.77:5275';
const client = new pg.Client({ connectionString: 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local' });
await client.connect();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let id, calls = 0;
try {
  await page.route('**/api/jkai/development/*', async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().action !== 'groom') return route.continue();
    calls++;
    const body = route.request().postDataJSON();
    if (calls === 1) return route.fulfill({ status: 503, json: { error: 'Synthetic provider unavailable. Your ask is saved; try again.' } });
    id = new URL(route.request().url()).pathname.split('/').pop();
    const { rows } = await client.query('select state from jkai_build_deliveries where build_id=$1', [id]);
    const state = rows[0].state;
    state.brief = { ...state.brief, revision: state.brief.revision + 1, outcome: 'Save weekly health comparisons', constraints: 'Owner only', routes: ['/health'], scope: 'Compare two selected weeks', dependencies: 'Verify existing health data access', assumptions: 'Reuse existing measurements', validation: 'Save and reload the comparison', questions: 'Which layout works best?' };
    if (calls === 3) assert.equal(body.message, 'Steps only.');
    state.criteria = [{ id: 'criterion-1', text: 'A saved comparison survives reload', verdict: 'unverified', evidence: '', revision: null }];
    state.grooming = { model: 'Synthetic browser fixture', at: new Date().toISOString(), summary: calls === 2 ? 'Choose the metrics before building.' : 'Steps only; ready for your review.' };
    await client.query('update jkai_build_deliveries set state=$2::jsonb, revision=revision+1 where build_id=$1', [id, JSON.stringify(state)]);
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(`${base}/jkai/develop`, { waitUntil: 'networkidle' });
  await page.getByLabel('Intended outcome', { exact: true }).fill('Synthetic ask: compare my weeks');
  await page.getByRole('button', { name: 'Refine this brief', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Synthetic provider unavailable' }).waitFor();
  id = new URL(page.url()).pathname.split('/').pop();
  assert.equal(await page.getByLabel('Intended outcome', { exact: true }).inputValue(), 'Synthetic ask: compare my weeks');
  assert.equal(calls, 1);
  await page.getByRole('button', { name: 'Propose a brief', exact: true }).click();
  await page.getByRole('heading', { name: 'Proposed brief' }).waitFor();
  assert.equal(await page.getByLabel('Dependencies to verify').inputValue(), 'Verify existing health data access');
  assert.equal(await page.getByRole('button', { name: 'Accept brief with open questions', exact: true }).isEnabled(), true);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('.jkai-body').evaluate(el => el.scrollTop = 0);
    await page.screenshot({ path: `/tmp/development-grooming-${width}.png`, fullPage: true });
    await page.getByLabel('Open questions', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/development-grooming-details-${width}.png`, fullPage: true });
  }
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(calls, 2, 'Reload must not start another model call');
  assert.equal(await page.getByLabel('Acceptance criteria', { exact: true }).inputValue(), 'A saved comparison survives reload');
  // A proposal finishing after navigation/reload must populate untouched fields.
  await client.query("update jkai_build_deliveries set state=jsonb_set(jsonb_set(state,'{brief,validation}','\"Late saved validation\"'::jsonb),'{brief,revision}',to_jsonb((state->'brief'->>'revision')::int+1)),revision=revision+1 where build_id=$1", [id]);
  await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some(el => el.value === 'Late saved validation'));
  await page.getByLabel('Answers or changes for the model').fill('Steps only.');
  await page.getByRole('button', { name: 'Refine with my answers', exact: true }).click();
  await page.getByText('Steps only; ready for your review.').waitFor();
  await page.getByRole('button', { name: 'Accept brief with open questions', exact: true }).click();
  await page.getByText('Revision 5 · accepted').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Build to preview', exact: true }).isEnabled(), true);
  const accepted = await client.query('select state from jkai_build_deliveries where build_id=$1', [id]);
  assert.equal(accepted.rows[0].state.brief.questions, 'Which layout works best?');
  console.log('PASS: automatic grooming request, failure recovery, populated proposal, follow-up answers, persistence, approval and desktop/mobile layout. Synthetic model responses; no provider invoked.');
} finally {
  if (id) await client.query('delete from jkai_builds where id=$1', [id]);
  await client.end(); await browser.close();
}
