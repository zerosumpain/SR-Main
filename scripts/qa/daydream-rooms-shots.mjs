// Screenshot every daydream room against a local server and measure overflow.
//
//   PORT=5199 node scripts/qa/daydream-rooms-shots.mjs
//
// The /jkai layout is `height: 100dvh; overflow: hidden` with the scroll inside
// `.jkai-body`, so `fullPage: true` captures the viewport and nothing more —
// use a tall viewport instead, and measure overflow on BOTH the document and
// `.jkai-body`. Chromium path per the worktree's playwright quirk.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import os from 'node:os';

const port = process.env.PORT ?? '5199';
const base = `http://localhost:${port}`;
const out = process.env.OUT ?? 'scratch/shots';
mkdirSync(out, { recursive: true });

const rooms = ['feed', 'memory', 'briefing', 'watches', 'family', 'discoveries', 'calendar', 'places', 'money', 'engine', 'improvement'];
const sizes = [
  { name: 'desk', width: 1440, height: 3600 },
  { name: 'phone', width: 390, height: 2400 },
];

const exe = `${os.homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const browser = await chromium.launch({ channel: 'chromium', executablePath: exe });
const results = [];
for (const size of sizes) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  for (const room of rooms) {
    errors.length = 0;
    const res = await page.goto(`${base}/jkai/daydreams/${room}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('.jkai-body');
      return {
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        inner: el ? el.scrollWidth - el.clientWidth : null,
        h1: document.querySelector('h1')?.textContent?.trim().slice(0, 40) ?? null,
        title: document.title,
      };
    });
    await page.screenshot({ path: `${out}/${room}-${size.name}.png` });
    results.push({ room, size: size.name, status: res?.status(), ...overflow, errors: errors.slice(0, 3) });
  }
  await ctx.close();
}
// The bare path must redirect to the feed; an old ?tab= link to its room.
const ctx = await browser.newContext();
const page = await ctx.newPage();
for (const path of ['/jkai/daydreams', '/jkai/daydreams?tab=places', '/jkai/briefing']) {
  const res = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  results.push({ room: path, size: 'redirect', status: res?.status(), landed: page.url().replace(base, '') });
}
await browser.close();
console.table(results);
const bad = results.filter((r) => (r.status && r.status >= 400) || (r.doc ?? 0) > 0 || (r.inner ?? 0) > 0 || (r.errors?.length ?? 0) > 0);
if (bad.length) {
  console.error('FAILURES:', JSON.stringify(bad, null, 2));
  process.exit(1);
}
