import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import pg from 'pg';
const base = 'http://192.168.0.77:5275';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const client = new pg.Client({ connectionString: 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local' });
let id;
await client.connect();
try {
  await page.goto(`${base}/jkai/develop`, { waitUntil: 'networkidle' });
  // This suite covers manual acceptance and build controls. Model grooming is
  // exercised separately by development-grooming-preview.mjs.
  const created = await page.request.post(`${base}/api/jkai/development`, { data: { area: 'Health', outcome: 'Synthetic preview: save a weekly comparison' } });
  assert.equal(created.status(), 201);
  id = (await created.json()).buildId;
  await page.goto(`${base}/jkai/develop/${id}`, { waitUntil: 'networkidle' });
  await page.getByLabel('Acceptance criteria', { exact: true }).fill('The saved comparison survives reload\nThe controls remain usable on a phone');
  await page.getByLabel('Target routes', { exact: true }).fill('/health');
  await page.getByLabel('Constraints', { exact: true }).fill('Preserve the public/owner split');
  await page.getByRole('button', { name: 'Accept brief', exact: true }).click();
  await page.getByText('Revision 2 · accepted').waitFor();
  if (process.env.SR_FEATURE_PREVIEW_URL) {
    await client.query("update jkai_build_deliveries set state=jsonb_set(state,'{preview}',$2::jsonb),revision=revision+1 where build_id=$1", [id, JSON.stringify({ url: process.env.SR_FEATURE_PREVIEW_URL, status: 'ready', detail: 'Synthetic browser fixture; no acceptance has been claimed.' })]);
    await page.reload({ waitUntil: 'networkidle' });
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ['Brief', 'Build', 'Preview', 'Delivery']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      if (tab === 'Preview' && process.env.SR_FEATURE_PREVIEW_URL) {
        await page.frameLocator('iframe[title="Isolated feature preview"]').getByRole('heading', { name: 'What should the site do next?' }).waitFor();
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${tab} overflows at ${width}`);
      await page.locator('.jkai-body').evaluate((el) => el.scrollTop = 0);
      await page.screenshot({ path: `/tmp/development-${tab.toLowerCase()}-${width}.png`, fullPage: true });
    }
  }
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByLabel('Guide this build').fill('Keep the date controls visible while scrolling.');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await page.getByText('Saved · waiting for Pi', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByText('Keep the date controls visible while scrolling.', { exact: true }).waitFor();
  await page.getByText('Record a decision or pin a constraint', { exact: true }).click();
  await page.getByLabel('Decision needed', { exact: true }).fill('Who can see saved comparisons?');
  await page.getByRole('button', { name: 'Record decision', exact: true }).click();
  await page.getByLabel('Who can see saved comparisons?', { exact: true }).fill('Only the owner.');
  await page.getByRole('button', { name: 'Save answer', exact: true }).click();
  await page.getByText('Only the owner.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Delivery', exact: true }).click();
  // The Delivery tab's primary control is 'Continue automatically' — the button
  // that assesses the criteria and, only if they all pass, joins the batch. The
  // assertion is unchanged in intent: acceptance must be unreachable here.
  assert.equal(await page.getByRole('button', { name: 'Continue automatically', exact: true }).isDisabled(), true);
  const row = await client.query('select state from jkai_build_deliveries where build_id=$1', [id]);
  assert.equal(row.rows[0].state.brief.constraints, 'Preserve the public/owner split');
  assert.equal(row.rows[0].state.decisions[0].answer, 'Only the owner.');
  console.log('PASS: desktop/phone, persisted brief, decisions, instruction receipts, reload and blocked premature acceptance. No model was called.');
} finally {
  if (id) await client.query('delete from jkai_builds where id=$1', [id]);
  await client.end(); await browser.close();
}
