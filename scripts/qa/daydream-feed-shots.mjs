// Screenshot the one daydream feed against a local dev server seeded with
// `daydream-feed-seed.sql`, and measure overflow at desk and phone widths.
//
//   PORT=5197 OUT=scratch/shots node scripts/qa/daydream-feed-shots.mjs
//
// The /jkai layout scrolls inside `.jkai-body`, so `fullPage` captures only the
// viewport: use a tall viewport, and measure overflow on the document AND
// `.jkai-body` (see daydream-rooms-shots.mjs).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import os from 'node:os';

const port = process.env.PORT ?? '5197';
const base = `http://localhost:${port}`;
const out = process.env.OUT ?? 'scratch/shots';
mkdirSync(out, { recursive: true });

const sizes = [
  { name: 'desk', width: 1440, height: 3000 },
  { name: 'phone', width: 390, height: 3200 },
];
const exe = process.env.CHROME ?? `${os.homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const browser = await chromium.launch({ executablePath: exe });
const results = [];

async function measure(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.jkai-body');
    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inner: el ? el.scrollWidth - el.clientWidth : null,
      notes: document.querySelectorAll('li[id^="note-"]').length,
      days: [...document.querySelectorAll('h3.day')].map((h) => h.textContent?.trim()),
      tabs: [...document.querySelectorAll('a')].filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent?.trim()),
      strip: document.querySelector('.strip-band .strip')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    };
  });
}

for (const size of sizes) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
  });

  // The feed.
  let res = await page.goto(`${base}/jkai/daydreams`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('li[id^="note-"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/feed-${size.name}.png` });
  results.push({ shot: `feed-${size.name}`, status: res?.status(), ...(await measure(page)), errors: errors.splice(0) });

  // Interaction proves hydration: open a note by its title.
  await page.locator('#note-uiseed-n-03 .card-title').click();
  await page.waitForSelector('#note-uiseed-n-03 .read', { timeout: 10_000 });
  const opened = await page.locator('#note-uiseed-n-03 .read').isVisible();
  results.push({ shot: `open-click-${size.name}`, opened });

  // A verdict round-trips (desk only — it writes, and the seed resets it).
  if (size.name === 'desk') {
    await page.locator('#note-uiseed-n-03 button', { hasText: /^Useful$/ }).click();
    await page.waitForSelector('#note-uiseed-n-03 .card-meta >> text=you said useful', { timeout: 15_000 });
    results.push({ shot: 'rate-useful', rated: true, errors: errors.splice(0) });
  }

  // A deep link opens and scrolls to its note.
  res = await page.goto(`${base}/jkai/daydreams?note=uiseed-n-04`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#note-uiseed-n-04 .read', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  const inView = await page.evaluate(() => {
    const r = document.getElementById('note-uiseed-n-04')?.getBoundingClientRect();
    return r ? r.top >= 0 && r.top < window.innerHeight : false;
  });
  await ctx.close();
  const vctx = await browser.newContext({ viewport: { width: size.width, height: size.name === 'phone' ? 844 : 900 } });
  const vpage = await vctx.newPage();
  await vpage.goto(`${base}/jkai/daydreams?note=uiseed-n-04`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await vpage.waitForSelector('#note-uiseed-n-04 .read', { timeout: 30_000 });
  await vpage.waitForTimeout(1500);
  await vpage.screenshot({ path: `${out}/deeplink-${size.name}.png` });
  const scrolled = await vpage.evaluate(() => {
    const r = document.getElementById('note-uiseed-n-04')?.getBoundingClientRect();
    return r ? Math.round(r.top) : null;
  });
  results.push({ shot: `deeplink-${size.name}`, status: res?.status(), openedByLink: true, inView, topInSmallViewport: scrolled, errors: errors.splice(0) });
  await vctx.close();
}

// Old links still land where they did.
const ctx = await browser.newContext();
const page = await ctx.newPage();
for (const path of ['/jkai/daydreams?tab=places', '/jkai/daydreams?rate=abc', '/jkai/daydreams/memory']) {
  const res = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  results.push({ shot: path, status: res?.status(), landed: page.url().replace(base, '') });
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
const bad = results.filter(
  (r) => (r.status && r.status >= 400) || (r.doc ?? 0) > 0 || (r.inner ?? 0) > 0 || (r.errors?.length ?? 0) > 0 || r.opened === false,
);
if (bad.length) {
  console.error('FAILURES:', JSON.stringify(bad, null, 2));
  process.exit(1);
}
