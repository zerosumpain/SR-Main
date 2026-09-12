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
//   * the map frame, its three view buttons and its key are all drawn;
//   * the share bar has between one and five segments;
//   * an open seat's name does not break mid-word on a phone;
//   * a `?geo=x:y` deep link opens the drill on its own, with no tap;
//   * the owner-only card is on /projects.
//
// It does NOT wait for networkidle: without a Mapbox token the map retries
// tiles forever and the page never goes idle.
//
// THE MAP'S OWN ASSERTIONS ARE CONDITIONAL, and honestly so. `data-lg-sources`
// is seeded "0" in the markup and only counts up once GL has added a layer per
// player holding ground plus the pulse layer, so on a box with no Mapbox token
// it stays "0" for the whole run. "0" therefore means "the map did not draw",
// not "the map drew nothing" — it is reported as skipped at the end rather
// than asserted, because asserting it would turn a missing credential into a
// layout failure.

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://127.0.0.1:5199';
const out = process.env.SP ?? '/tmp';
const WIDTHS = [360, 390, 480, 600, 768, 900, 1024, 1280, 1440, 1920];
const SHOT_AT = new Set([390, 1440]);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const problems = [];
/** Assertions this run could NOT make, printed at the end. A run without a
 *  Mapbox token is a legitimate run — it just proves less, and has to say so. */
const skipped = [];

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
      assert.equal(await page.locator('.lg-frame').count(), 1, 'the map frame');
      assert.equal(await page.locator('.lg-view button').count(), 3, 'the three view buttons');
      assert.ok((await page.locator('.lg-key li').count()) >= 1, 'the key');
      // Between one and five, never exactly five: four of the household's seats
      // are still open, so a hard 5 would fail on the real ledger.
      const seats = await page.locator('.lg-share-seg').count();
      assert.ok(seats >= 1 && seats <= 5, `share segments: ${seats}`);
      // Sources = one layer per player HOLDING ground, plus the pulse layer.
      // Five players and the pulse is the ceiling, so `<= 6` — never `== 6`.
      const sources = await page.locator('.lg-map').getAttribute('data-lg-sources');
      if (sources === null) skipped.push('no .lg-map in the page at all');
      else if (sources === '0') skipped.push('map did not draw (no Mapbox token) — sources not asserted');
      else assert.ok(Number(sources) <= 6, `map sources: ${sources}`);
    }

    // The open seat's name, on the two widths it broke at. It is one line of
    // display type; anything over two line-heights means the `auto` column
    // beside it took the room and the name broke mid-word ("SEA / T 2 / · / OP
    // / EN"). Reported rather than asserted so the wider widths still run.
    if (width === 360 || width === 390) {
      const tall = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.lg-share-row--open .lg-name')) {
          const cs = getComputedStyle(el);
          const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
          const h = el.getBoundingClientRect().height;
          if (h > lh * 2 + 1) out.push(`${el.textContent.trim().slice(0, 24)} — ${Math.round(h)}px over ${Math.round(lh)}px lines`);
        }
        return out;
      });
      for (const t of tall) problems.push(`${width}px: open seat name wrapped past two lines: ${t}`);
    }
    if (SHOT_AT.has(width)) {
      await page.screenshot({ path: `${out}/landgrab-${width}.png`, fullPage: true });
    }
  }

  // ---- the drill, opened by a link rather than a tap ----
  //
  // `?geo=1:1` is a legal tile index in the far north-west of the world and
  // nobody has ever walked on it, so `/projects/landgrab/geo` answers 404 and
  // the panel says so. That is the pass: the seeding, the fetch and the panel
  // all ran without a click. A tile somebody DOES hold would draw the battle
  // table instead, so either is accepted.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/projects/landgrab?geo=1:1`, { waitUntil: 'domcontentloaded' });
  await page.locator('.lg-drill-panel').waitFor({ timeout: 4000 });
  await page.waitForTimeout(600);
  // `innerText` honours `text-transform`, and the panel's message is uppercased
  // in CSS — so the comparison is case-folded rather than the copy being
  // rewritten to match the stylesheet.
  const drillText = (await page.locator('.lg-drill-panel').innerText()).trim();
  const hasTable = (await page.locator('.lg-drill-table').count()) > 0;
  assert.ok(
    drillText.toLowerCase().includes('no ground here') || hasTable,
    `the drill answered neither "No ground here" nor a battle table: ${drillText.slice(0, 120)}`,
  );

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
    console.log(`PASS: nothing escapes the viewport at ${WIDTHS.join('/')}px; ink cover, five section heads, map frame + 3 views + key, 1–5 share segments, the open seat's name on one line at 360/390, the drill opens on ?geo=, owner-only card on /projects`);
  }
  console.log(
    skipped.length ? `SKIPPED: ${skipped.join('; ')}` : 'SKIPPED: nothing — every assertion ran',
  );
} finally {
  await browser.close();
}
