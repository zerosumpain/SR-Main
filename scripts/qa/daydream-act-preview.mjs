/** Synthetic local acceptance for "Take it further" (2026-10-05).
 *  Needs `daydream/act-seed.sql` applied to the isolated preview database.
 *  The preview holds no model, calendar, Gmail, Home Assistant or builder
 *  credential, so taps that need one must REFUSE with a reason — that is
 *  asserted too; the writes behind them are covered by
 *  `src/lib/daydream/act/follow.integration.test.ts`. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = process.env.DAYDREAM_PREVIEW_URL ?? 'http://100.83.68.108:15440';
const output = process.env.DAYDREAM_EVIDENCE_DIR ?? '/tmp/daydream-act-preview';
assert.ok(['127.0.0.1', '100.83.68.108'].includes(new URL(base).hostname), 'Only the isolated local preview is supported');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const card = (page, id) => page.locator(`#note-uiseed-act5-${id}`);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 }, reducedMotion: 'reduce' });
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. The walk: one card for the subject, the booking page, dig deeper, an enquiry, hold the date.
  await page.goto(`${base}/jkai/daydreams?note=uiseed-act5-walk`, { waitUntil: 'domcontentloaded' });
  const walk = card(page, 'walk');
  await expect(walk).toBeVisible();
  await expect(walk.getByText(/Replaces 2 earlier notes on the same subject/)).toBeVisible();
  await expect(walk.getByRole('link', { name: /Open the booking page/ })).toHaveAttribute('href', 'https://example.org/geology-walks');
  await expect(walk.getByRole('button', { name: /Do it for me/ })).toBeVisible();
  await expect(walk.getByRole('button', { name: 'Draft a message to them' })).toBeVisible();
  await expect(walk.getByText(/about 9 web searches/)).toBeVisible();
  await walk.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/1-walk.png`, fullPage: false });
  await walk.getByRole('button', { name: 'Dig deeper' }).click();
  await expect(walk.getByText('Research started').first()).toBeVisible({ timeout: 20_000 });
  await expect(walk.getByRole('link', { name: 'Open', exact: true }).first()).toHaveAttribute('href', /^\/research\//);
  // No model locally: drafting refuses with a reason rather than inventing.
  await walk.getByRole('button', { name: 'Draft a message to them' }).click();
  await expect(walk.locator('.said.bad')).toContainText(/could not draft|unusable/, { timeout: 60_000 });
  await page.screenshot({ path: `${output}/2-walk-after.png` });

  // 2. The physics note (rated worth knowing): backlog and a prototype on offer.
  await page.goto(`${base}/jkai/daydreams?note=uiseed-act5-physics`, { waitUntil: 'domcontentloaded' });
  const physics = card(page, 'physics');
  await expect(physics.getByRole('button', { name: 'Sketch a quick prototype' })).toBeVisible();
  await physics.getByRole('button', { name: 'Put it on the build backlog' }).click();
  await expect(physics.getByText(/Build queue/)).toBeVisible({ timeout: 20_000 });
  await expect(physics.getByRole('button', { name: 'Draft the build brief' })).toBeVisible();
  await physics.getByRole('button', { name: 'Sketch a quick prototype' }).click();
  await expect(physics.getByText('Start a prototype now?')).toBeVisible();
  await physics.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/3-physics.png` });
  await physics.getByRole('button', { name: 'Cancel' }).click();

  // 3. The watchdog: accept for build, a Watch instead (worded first), Home Assistant.
  await page.goto(`${base}/jkai/daydreams?note=uiseed-act5-watchdog`, { waitUntil: 'domcontentloaded' });
  const dog = card(page, 'watchdog');
  await expect(dog.getByText(/draft and accept its brief below/)).toBeVisible();
  await dog.getByRole('button', { name: 'Watch for this instead' }).click();
  const box = dog.locator('textarea');
  await expect(box).toHaveValue(/^Tell me when this needs attention: Add a home coverage watchdog/);
  await dog.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/4-watchdog-watch.png` });
  await dog.getByRole('button', { name: 'Cancel' }).click();
  await dog.getByRole('button', { name: 'Check what has dropped out' }).click();
  await expect(dog.locator('.said.bad')).toContainText(/Home Assistant could not be read/, { timeout: 30_000 });

  // 4. A turned-down note offers nothing to take further.
  await page.goto(`${base}/jkai/daydreams?note=uiseed-act5-week`, { waitUntil: 'domcontentloaded' });
  const week = card(page, 'week');
  await expect(week.getByRole('button', { name: /Do it for me/ })).toBeVisible();

  // 4b. Drafted states (seeded — no model runs locally): the brief to read
  // before accepting, the devices to pick, and a message to send himself.
  await page.goto(`${base}/jkai/daydreams?note=uiseed-act5-brief`, { waitUntil: 'domcontentloaded' });
  const brief = card(page, 'brief');
  await expect(brief.getByText('The brief it would build from')).toBeVisible();
  await expect(brief.getByText(/No heating set-point is changed/)).toBeVisible();
  await expect(brief.getByRole('button', { name: 'Accept for build' })).toBeVisible();
  await expect(brief.getByText(/pick up to five to refresh/)).toBeVisible();
  await brief.getByLabel(/Downstairs Hallway/).check();
  await expect(brief.getByRole('button', { name: 'Refresh 1' })).toBeEnabled();
  await brief.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/4b-brief-home.png` });
  await page.goto(`${base}/jkai/daydreams?note=uiseed-act5-msg`, { waitUntil: 'domcontentloaded' });
  const msg = card(page, 'msg');
  await expect(msg.getByRole('link', { name: 'Open in WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/447700900456\?text=Hello/);
  await expect(msg.getByRole('link', { name: 'Open in Mail' })).toHaveAttribute('href', /^mailto:hello@example\.org\?subject=/);
  await expect(msg.getByRole('button', { name: 'Draft it in Gmail' })).toBeVisible();
  await msg.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/4c-message.png` });

  // 5. Phone width: nothing overflows on the busiest card.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/jkai/daydreams?note=uiseed-act5-walk`, { waitUntil: 'domcontentloaded' });
  await card(page, 'walk').scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => {
    const el = document.querySelector('.jkai-body');
    return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, el ? el.scrollWidth - el.clientWidth : 0);
  });
  assert.ok(overflow <= 0, `mobile overflow ${overflow}px`);
  await page.screenshot({ path: `${output}/5-phone.png` });

  // 6. The Engine Room describes the new kinds and follow-ups.
  await page.setViewportSize({ width: 1440, height: 1400 });
  const er = await page.goto(`${base}/projects/engine-room/daydream/inbox`, { waitUntil: 'domcontentloaded' });
  assert.equal(er?.status(), 200);
  await expect(page.getByText('Taking it further')).toBeVisible();

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log(`ok — evidence in ${output}`);
} finally {
  await browser.close();
}
