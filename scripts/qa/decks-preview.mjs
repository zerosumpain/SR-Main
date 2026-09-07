import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = 'http://192.168.0.77:5275';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let deckId;
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/decks`, { waitUntil: 'networkidle' });
    await page.getByLabel('New deck title').fill('Synthetic deck creation preview');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `/tmp/decks-${width}.png` });
  }
  await page.getByRole('button', { name: 'Create deck', exact: true }).click();
  await page.waitForURL('**/decks/*/edit', { timeout: 60000 });
  const slug = new URL(page.url()).pathname.split('/')[2];
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local' });
  await client.connect();
  try {
    const rows = await client.query('select id, is_public from decks where slug=$1', [slug]);
    deckId = rows.rows[0].id;
    assert.equal(rows.rows[0].is_public, false);
    const slides = await client.query('select blocks from deck_slides where deck_id=$1', [deckId]);
    assert.equal(slides.rows.length, 1);
    assert.equal(slides.rows[0].blocks[0].title, 'Synthetic deck creation preview');
  } finally { await client.end(); }
  await page.goto(`${base}/decks`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Commission in JKAI', exact: true }).click();
  await page.waitForURL('**/jkai**');
  await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some(el => el.value.includes('Commission a new sr. deck')));
  console.log('PASS: desktop/mobile, persisted private deck and title slide, editor redirect, JKAI commission draft. No model call made.');
} finally {
  if (deckId) await page.request.delete(`${base}/api/decks/${deckId}`);
  await browser.close();
}
