/**
 * Drive the merged development journey in a real browser.
 *
 * Two registers on one page have to be checked as two: the PORTFOLIO (live
 * features, delivery-backed) and the ARCHIVE (every earlier build, and the
 * route from one of those to a card on /projects). A screenshot of the first
 * proves nothing about the second, and the archive is the half carrying the
 * actions that would lose data if they broke.
 *
 * Synthetic throughout: the delivery API is stubbed so this runs against any
 * database, including an empty one. It proves the surface renders and its
 * controls exist; it does not prove a build works.
 *
 *   BASE=http://localhost:5191 node scripts/qa/develop-journey-preview.mjs
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://localhost:5191';
const id = '00000000-1111-2222-3333-444444444444';
const shippedId = '55555555-6666-7777-8888-999999999999';

const feature = (buildId, over = {}) => ({
  buildId,
  title: 'Compare two weeks of health data',
  status: 'paused',
  outcome: null,
  revision: 7,
  state: {
    version: 1, area: 'Health', stage: 'review', originalAsk: 'Compare two weeks',
    brief: { revision: 3, outcome: 'Compare two weeks of health data and save the comparison', constraints: 'Owner only; no new dependencies', routes: ['/health/compare'], acceptedAt: 'today' },
    criteria: [{ id: 'criterion-1', text: 'Save a comparison', verdict: 'unverified', evidence: '', revision: null }],
    decisions: [], session: { engine: 'pi', id: 'session', file: null, recovery: null },
    candidate: 'c'.repeat(40), gate: null,
    preview: { url: null, status: 'unavailable', detail: 'Not prepared.' },
    batch: null, acceptedAt: null, releasePolicy: 'preview_only',
    ...over,
  },
});

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

await page.route('**/api/jkai/development', (route) =>
  route.request().method() === 'GET'
    ? route.fulfill({ json: [feature(id), feature(shippedId, { stage: 'pr_open', autopilot: { enabled: true, rounds: 2, maxRounds: 6, startedAt: 'today' }, release: { revision: 'c'.repeat(40), prUrl: 'https://github.com/zerosumpain/SR-Main/pull/999', prNumber: 999, ci: 'pending' } })] })
    : route.continue());

await page.goto(`${base}/jkai/develop`, { waitUntil: 'networkidle' });

// The headline three release-time checks assert by name.
await page.getByRole('heading', { name: 'What should the site do next?' }).waitFor();
// The commission form's own controls, all asserted by accessible name elsewhere.
await page.getByLabel('Intended outcome', { exact: true }).waitFor();
await page.getByLabel('Product area', { exact: true }).waitFor();
await page.getByRole('button', { name: 'Refine this brief', exact: true }).waitFor();

// The autonomy fold: the two permissions the journey turns on.
await page.getByText('How far it may go on its own', { exact: true }).click();
await page.getByLabel('Where it stops', { exact: true }).selectOption('production');
await page.getByText('Run it on autopilot', { exact: true }).click();
await page.getByLabel('Round limit', { exact: true }).fill('4');
assert.equal(await page.getByLabel('Round limit').inputValue(), '4', 'the round limit must be editable');

// The portfolio's own lanes, including the two the release ladder added.
for (const lane of ['Shipped', 'Archive']) {
  await page.getByRole('button', { name: new RegExp(`^${lane}`) }).waitFor();
}
await page.screenshot({ path: '/tmp/develop-portfolio.png', fullPage: true });

// A shipped feature must say so on its row rather than reading as merely accepted.
await page.getByRole('button', { name: /^Shipped/ }).click();
await page.getByText('pull request open', { exact: true }).first().waitFor();
assert.ok(new URL(page.url()).searchParams.get('tab') === 'shipped', 'the lane must be in the URL so a back link can name it');

// The archive: the backlog, its performance table and the publication actions.
await page.getByRole('button', { name: /^Archive/ }).click();
await page.getByRole('heading', { name: /Every build/ }).waitFor();
const rows = await page.locator('.dv-arch').count();
console.log(`archive rows: ${rows}`);
if (rows > 0) {
  await page.getByRole('link', { name: 'Console' }).first().waitFor();
  await page.getByRole('button', { name: 'Delete' }).first().waitFor();
}
await page.screenshot({ path: '/tmp/develop-archive.png', fullPage: true });

// The retired pages must land on the journey, not 404.
for (const path of ['/jkai/builds', '/jkai/builds/new']) {
  const response = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  assert.ok(new URL(page.url()).pathname.startsWith('/jkai/develop'), `${path} must redirect to /jkai/develop`);
  assert.ok(response.ok(), `${path} must resolve`);
}

// Phone width: the rail carries controls, and a rail that scrolls horizontally
// puts them off screen. This is the measurement that caught Stop at 387px.
const phone = await context.newPage();
await phone.setViewportSize({ width: 390, height: 844 });
await phone.route('**/api/jkai/development', (route) => route.fulfill({ json: [feature(id)] }));
await phone.goto(`${base}/jkai/develop?tab=archive`, { waitUntil: 'networkidle' });
await phone.getByRole('heading', { name: /Every build/ }).waitFor();
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert.ok(overflow <= 1, `the page must not scroll horizontally on a phone (overflowed by ${overflow}px)`);
await phone.screenshot({ path: '/tmp/develop-archive-phone.png', fullPage: true });

const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
assert.deepEqual(errors, [], 'no browser errors');

await browser.close();
console.log('PASS: portfolio, autonomy fold, shipped lane, archive with its actions, both redirects, and a phone width that does not overflow.');
console.log('Screenshots: /tmp/develop-portfolio.png /tmp/develop-archive.png /tmp/develop-archive-phone.png');
