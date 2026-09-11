// Landgrab, after it took the HealthShell register. Asserts the three things a
// render is the only witness to: no horizontal scroll (a child escaping the
// shell's clip), the cover band is actually ink, and the owner-only card is on
// /projects. Run a `vite dev` first — a BUILD cannot use the LAN owner bypass.
// SP=<dir> BASE=<url> node scripts/qa/landgrab-preview.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.BASE ?? 'http://127.0.0.1:5199';
const out = process.env.SP;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/projects/landgrab`, { waitUntil: 'networkidle' });
    // The trap this family keeps meeting: a child escaping the shell's clip.
    // The dev overlay is not part of the page; it hides the band being checked.
    await page.evaluate(() => document.querySelector('vite-error-overlay')?.remove());
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflows, false, `horizontal scroll at ${width}`);
    // The chrome is the shared bar, and the cover band is ink.
    assert.equal(await page.locator('.site-nav-bar').count(), 1, 'one shared nav bar');
    const ground = await page.locator('section.lede').evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(ground, 'rgb(26, 16, 8)', `cover band ink, got ${ground}`);
    assert.equal(await page.locator('.hd-kicker').count(), 5, 'five section heads');
    await page.screenshot({ path: `${out}/landgrab-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/projects`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByText('Owner only').count(), 1, 'the owner-only card marker');
  await page.locator('.pc', { hasText: 'Owner only' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/projects-card.png` });
  console.log('PASS: no h-scroll at 1440/390, ink cover, five section heads, owner-only card on /projects');
} finally { await browser.close(); }
