// Landgrab, after it took the HealthShell register.
//
//   SP=<dir> [BASE=<url>] node scripts/qa/landgrab-preview.mjs
//
// Run a `vite dev` first — a BUILD cannot use the LAN owner bypass, so the page
// 404s against the built service.
//
// Asserts the things only a render witnesses:
//
//   * nothing escapes the viewport at any width from 360 to 1920. Checking
//     `scrollWidth > innerWidth` alone is NOT enough — a clipped child reports
//     no document scroll while being cut off, which is how the contested
//     board's fourth column ran 13px past a 360px phone unnoticed;
//   * the cover band is actually ink (a paper token there is invisible);
//   * five section heads, i.e. the page is still sectioned;
//   * the owner-only card is on /projects.
//
// It does NOT wait for networkidle: without a Mapbox token the map retries
// tiles forever and the page never goes idle.

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://127.0.0.1:5199';
const out = process.env.SP ?? '/tmp';
const WIDTHS = [360, 390, 480, 600, 768, 900, 1024, 1280, 1440, 1920];
const SHOT_AT = new Set([390, 1440]);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const problems = [];

try {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/projects/landgrab`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    // The dev overlay is not part of the page and covers the band being checked.
    await page.evaluate(() => document.querySelector('vite-error-overlay')?.remove());

    const r = await page.evaluate(() => {
      const escapees = [];
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        if (b.right <= innerWidth + 1 && b.left >= -1) continue;
        // A deliberate horizontal scroller is allowed to hold wider content.
        let p = el.parentElement;
        let scoped = false;
        while (p) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') { scoped = true; break; }
          p = p.parentElement;
        }
        if (!scoped) {
          escapees.push(`<${el.tagName.toLowerCase()} class="${(el.className || '').toString().slice(0, 40)}"> ${Math.round(b.left)}..${Math.round(b.right)}`);
        }
      }
      return { docW: document.documentElement.scrollWidth, innerW: innerWidth, escapees: escapees.slice(0, 6) };
    });

    if (r.docW > r.innerW + 1) problems.push(`${width}px: document scrolls horizontally (${r.docW})`);
    for (const e of r.escapees) problems.push(`${width}px: ${e}`);

    if (width === 1440) {
      assert.equal(await page.locator('.site-nav-bar').count(), 1, 'one shared nav bar');
      const ground = await page.locator('section.lede').evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.equal(ground, 'rgb(26, 16, 8)', `cover band ink, got ${ground}`);
      assert.equal(await page.locator('.hd-kicker').count(), 5, 'five section heads');
    }
    if (SHOT_AT.has(width)) {
      await page.screenshot({ path: `${out}/landgrab-${width}.png`, fullPage: true });
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/projects`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  assert.equal(await page.getByText('Owner only').count(), 1, 'the owner-only card marker');
  await page.locator('.pc', { hasText: 'Owner only' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/projects-card.png` });

  if (problems.length) {
    console.error('LAYOUT PROBLEMS:\n  ' + problems.join('\n  '));
    process.exitCode = 1;
  } else {
    console.log(`PASS: nothing escapes the viewport at ${WIDTHS.join('/')}px; ink cover, five section heads, owner-only card on /projects`);
  }
} finally {
  await browser.close();
}
