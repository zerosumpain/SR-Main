#!/usr/bin/env node
/**
 * Studio shots — what does this explainer actually LOOK like?
 *
 * The studio gate answers "does it teach": reachable, visual, interactive,
 * cited. All four are structural, and a page can pass every one of them and
 * still be ugly — nothing in the build loop had ever looked at a rendered
 * pixel. This is the capture half of that: it drives the same served build the
 * gate drives and returns JPEGs, which src/lib/jkai/design-review.ts hands to a
 * vision model along with the kit's own design rubric.
 *
 * Contract, copied from studio-gate.mjs: a harness that could not run prints
 * { ran: false }. Never { passed: false } — this script makes no judgement at
 * all, it only carries pixels.
 *
 *   echo '<base64 spec>' | node scripts/studio-shots.mjs <baseUrl>
 *
 * Spec shape (JSON, base64-encoded on stdin):
 *   {
 *     chapters: Array<{ n: number, title: string, path: string }>,
 *     maxShots?: number,     // default 4
 *     width?: number,        // viewport width, default 1280
 *     maxHeight?: number,    // clip tall pages, default 3000
 *     quality?: number,      // JPEG quality, default 55
 *     budgetBytes?: number,  // total base64 ceiling, default 3.5MB
 *   }
 *
 * Output: { ran: true, shots: [{ n, title, path, mime, base64 }], skipped: [...] }
 *
 * WHY JPEG AND WHY CLIPPED. The caller reads this over `execInSandbox`, whose
 * exec buffer is 5MB (see sandbox.ts). A full-page PNG of a single explainer
 * chapter measured 1.4MB on its own, so three of them silently truncated the
 * JSON and the whole stage reported "printed nothing". JPEG at q55 clipped to
 * 3000px is ~90KB a page, and a design judgement does not need lossless.
 */
// @ts-nocheck — a standalone node script, deliberately untyped, run by
// `node scripts/studio-shots.mjs` and never bundled. Same reason as
// studio-gate.mjs, whose injectBaseHref this imports.
import { pathToFileURL } from 'node:url';
import { injectBaseHref } from './studio-gate.mjs';

let out = { ran: false, reason: 'harness did not start' };

const stripAnsi = (s) => String(s).replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
const firstLine = (s) => stripAnsi(s).split('\n')[0].slice(0, 300);

/**
 * Serve the page the way a reader sees it.
 *
 * Lifted wholesale from studio-gate.mjs's serveLikeAHuman, and load-bearing for
 * exactly the same reason: both surfaces a reader reaches inject a <base href>
 * at the project root, and the bare static server this drives does not. Without
 * it every project-root-relative URL — which the system prompt MANDATES —
 * resolves against the chapter directory and 404s, so the stylesheet and the
 * kit never load.
 *
 * For the gate that produced wrong findings. Here it would be worse: an
 * unstyled page screenshots as black-on-white Times New Roman, and a vision
 * model would correctly report that every token, font and palette rule is
 * violated. The build would then be handed a wall of findings about a page
 * that is, on every surface anyone looks at, fine — and would "fix" its
 * working stylesheet in response.
 */
async function serveLikeAHuman(page, baseUrl) {
  const projectRoot = new URL('/', baseUrl).toString();
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    let response;
    try {
      response = await route.fetch();
    } catch {
      return route.continue();
    }
    const type = response.headers()['content-type'] || '';
    if (!type.includes('html')) return route.fulfill({ response });
    let body;
    try {
      body = await response.text();
    } catch {
      return route.fulfill({ response });
    }
    return route.fulfill({ response, body: injectBaseHref(body, projectRoot) });
  });
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    out = { ran: false, reason: 'no base url given' };
    return;
  }

  const stdin = await new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => resolve(buf));
    setTimeout(() => resolve(buf), 5000);
  });

  let spec;
  try {
    spec = JSON.parse(Buffer.from(stdin.trim(), 'base64').toString('utf8'));
  } catch {
    out = { ran: false, reason: 'could not parse the spec on stdin' };
    return;
  }

  const chapters = Array.isArray(spec.chapters) ? spec.chapters : [];
  if (chapters.length === 0) {
    out = { ran: false, reason: 'no chapters in the spec' };
    return;
  }
  const maxShots = Number.isFinite(spec.maxShots) ? Math.max(1, spec.maxShots) : 4;
  const width = Number.isFinite(spec.width) ? spec.width : 1280;
  const maxHeight = Number.isFinite(spec.maxHeight) ? spec.maxHeight : 3000;
  const quality = Number.isFinite(spec.quality) ? spec.quality : 55;
  const budgetBytes = Number.isFinite(spec.budgetBytes) ? spec.budgetBytes : 3_500_000;

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    out = { ran: false, reason: `playwright is not available: ${firstLine(e.message)}` };
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
  } catch (e) {
    out = { ran: false, reason: `could not launch chromium: ${firstLine(e.message)}` };
    return;
  }

  const shots = [];
  const skipped = [];
  let spent = 0;
  try {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await serveLikeAHuman(page, baseUrl);

    for (const ch of chapters.slice(0, maxShots)) {
      const url = new URL(ch.path, baseUrl).toString();
      try {
        const res = await page.goto(url, { waitUntil: 'load', timeout: 20000 });
        if (res && res.status() >= 400) {
          skipped.push({ n: ch.n, reason: `HTTP ${res.status()}` });
          continue;
        }
        // The kit paints canvases and diagrams after load — sim.js and
        // diagram.js both run on DOMContentLoaded and animate in. Shooting at
        // `load` catches an empty <canvas>, which reads to the reviewer as a
        // missing visual. A fixed settle is cruder than waiting on a signal
        // the pages do not emit, and 1.2s is what the kit's own worked example
        // needed to finish its first frame.
        await page.waitForTimeout(1200);

        const scrollHeight = await page
          .evaluate(() => document.documentElement.scrollHeight)
          .catch(() => 900);
        const height = Math.max(400, Math.min(scrollHeight, maxHeight));
        const buf = await page.screenshot({
          type: 'jpeg',
          quality,
          clip: { x: 0, y: 0, width, height },
        });
        const base64 = buf.toString('base64');
        // Stop before the exec buffer does. A truncated JSON line is reported
        // by the caller as "printed nothing", which loses every shot already
        // taken; dropping the last one and saying so keeps the rest.
        if (spent + base64.length > budgetBytes) {
          skipped.push({ n: ch.n, reason: 'output budget reached before this chapter' });
          break;
        }
        spent += base64.length;
        shots.push({ n: ch.n, title: ch.title ?? '', path: ch.path, mime: 'image/jpeg', base64 });
      } catch (e) {
        skipped.push({ n: ch.n, reason: firstLine(e.message) });
      }
    }

    if (shots.length === 0) {
      out = {
        ran: false,
        reason: `no chapter could be captured (${skipped.map((s) => `#${s.n}: ${s.reason}`).join('; ') || 'no reason recorded'})`,
      };
      return;
    }
    out = { ran: true, shots, skipped };
  } catch (e) {
    out = { ran: false, reason: `the shots harness failed: ${firstLine(e.message)}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

// Run only when invoked as a script, so a test can import from this file
// without starting a browser and consuming stdin — same guard, and same
// reasoning, as studio-gate.mjs.
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .catch((e) => {
      out = { ran: false, reason: `unexpected: ${e.message}` };
    })
    .finally(() => {
      process.stdout.write(JSON.stringify(out) + '\n');
    });
}
