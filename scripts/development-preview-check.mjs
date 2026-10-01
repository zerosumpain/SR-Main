/** Declarative feature checks, executed by the trusted broker in an isolated browser. */
import { readFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Worker-authored plans must never cause the broker to follow a host symlink.
 * @param {string} path
 */
export async function readPreviewManifest(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw new Error('Preview plan must be a regular file, not a symlink.');
  });
  if (!file) return null;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 24000) throw new Error('Preview plan must be a regular file of at most 24,000 bytes.');
    const buffer = Buffer.alloc(24001);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 24000) throw new Error('Preview plan exceeds 24,000 bytes.');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally { await file.close(); }
}

/** @param {unknown} value @returns {string} */
export function localRoute(value) {
  if (typeof value !== 'string' || value.length > 1000 || !value.startsWith('/') || /[\\\s]/.test(value) || value.startsWith('//')) throw new Error('Preview checks need local route paths.');
  const url = new URL(value, 'http://preview.test');
  if (url.origin !== 'http://preview.test') throw new Error('Invalid preview route');
  return value;
}
/**
 * @param {any} input worker-authored `.development-preview.json`, validated here
 * @param {unknown} routes
 * @param {boolean} [required]
 */
export function previewPlan(input, routes, required = true) {
  if (!Array.isArray(routes) || routes.length > 12) throw new Error('Provide at most twelve target routes.');
  const targets = routes.map(localRoute);
  if (!input && !required) return { complete: false, routes: targets.length ? targets : ['/jkai/develop'], scenarios: [] };
  if (!targets.length) throw new Error('Set a target route in the accepted brief before building a working preview.');
  if (!input || typeof input.complete !== 'boolean' || !Array.isArray(input.scenarios) || !input.scenarios.length || input.scenarios.length > 12) throw new Error('Create .development-preview.json with complete:false and a core interaction scenario before continuing.');
  const short = (/** @type {unknown} */ value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
  for (const scenario of input.scenarios) {
    if (!targets.includes(localRoute(scenario.route)) || !short(scenario.text) || !Array.isArray(scenario.steps) || scenario.steps.length < 2 || scenario.steps.length > 20) throw new Error('Each scenario needs a brief route, visible text and bounded interaction steps.');
    let interacted = false, observed = false;
    for (const step of scenario.steps) {
      if (step.action === 'text') {
        if (!short(step.text)) throw new Error('Text checks need expected visible text.');
        if (interacted) observed = true;
      } else if (['click', 'fill', 'select'].includes(step.action)) {
        if (!['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'tab', 'switch', 'spinbutton'].includes(step.role) || !short(step.name) || (step.action !== 'click' && !short(step.value))) throw new Error('Interactions need a supported role, accessible name and value.');
        interacted = true;
      } else if (step.action !== 'reload') throw new Error('Unsupported preview check action.');
    }
    if (!observed) throw new Error('A working preview must check a visible result after a core interaction.');
  }
  return { complete: input.complete, routes: targets, scenarios: input.scenarios };
}

/**
 * What one scenario may add beyond its page text, and why each bound is what
 * it is. The whole check prints to a `docker exec` stdout the broker buffers
 * at 8MB, and the evidence then goes into an LLM request twice per review
 * round (criteria, then the veto) — so every list is capped here, at source,
 * not trusted to be trimmed downstream.
 *
 *  - messages/message: console errors and failed requests. Ten is enough to
 *    show a pattern ("every /api call 500s"); a page that logs hundreds is
 *    making one mistake in a loop.
 *  - outline: the ARIA snapshot. ~1,500 characters holds a page's landmarks,
 *    headings and controls; past that it is the same list rows again.
 *  - screenshotsPerWidth/screenshotBytes: JPEG of the viewport, not the full
 *    page. Four per width x two widths x 300KB is 2.4MB raw, 3.2MB as base64 —
 *    well inside the buffer even at the cap, and a typical text page is ~80KB.
 */
export const OBSERVATION_LIMITS = Object.freeze({ messages: 10, message: 300, outline: 1500, screenshotsPerWidth: 4, screenshotBytes: 300_000 });

/**
 * Append one message unless the list is full. Whitespace is collapsed so a
 * multi-line stack in a console error spends its budget on words.
 * @param {string[]} list
 * @param {unknown} message
 */
export function pushBounded(list, message) {
  if (list.length >= OBSERVATION_LIMITS.messages) return;
  const text = String(message ?? '').replace(/\s+/g, ' ').trim().slice(0, OBSERVATION_LIMITS.message);
  if (text) list.push(text);
}

/**
 * @typedef {{ width: number, route: string, text: string, consoleErrors: string[], failedRequests: string[], outline: string,
 *   screenshot?: { mediaType: string, base64: string } | string }} PreviewObservation
 */

/**
 * The structured half of a scenario's evidence, bounded whatever it was fed.
 * Used by the check itself and again by the broker on what came back over
 * stdout — the second pass is the one that matters, because the process that
 * produced it shares a container with the candidate's own server.
 * @param {Record<string, unknown>} input
 * @returns {PreviewObservation}
 */
export function boundObservation(input) {
  /** @type {string[]} */ const consoleErrors = [];
  /** @type {string[]} */ const failedRequests = [];
  for (const message of Array.isArray(input.consoleErrors) ? input.consoleErrors : []) pushBounded(consoleErrors, message);
  for (const message of Array.isArray(input.failedRequests) ? input.failedRequests : []) pushBounded(failedRequests, message);
  const outline = typeof input.outline === 'string' ? input.outline : '';
  /** @type {PreviewObservation} */
  const observation = {
    width: Number(input.width) || 0,
    route: String(input.route ?? '').slice(0, 1000),
    text: String(input.text ?? '').slice(0, 500),
    consoleErrors, failedRequests,
    outline: outline.length > OBSERVATION_LIMITS.outline ? `${outline.slice(0, OBSERVATION_LIMITS.outline)}\n… (outline truncated)` : outline,
  };
  const shot = /** @type {{ mediaType?: unknown, base64?: unknown } | string | undefined} */ (input.screenshot);
  if (typeof shot === 'string' && /^[a-z0-9-]{1,80}\.jpg$/.test(shot)) observation.screenshot = shot;
  else if (shot && typeof shot === 'object' && shot.mediaType === 'image/jpeg' && typeof shot.base64 === 'string'
    && shot.base64.length <= Math.ceil(OBSERVATION_LIMITS.screenshotBytes / 3) * 4 && /^[A-Za-z0-9+/]+=*$/.test(shot.base64)) {
    observation.screenshot = { mediaType: 'image/jpeg', base64: shot.base64 };
  }
  return observation;
}

/**
 * The check's stdout, old shape or new. Until 2026-10-01 it printed a bare
 * array of evidence strings; a retained preview container can still hold that
 * script, so a bare array reads as "no observations", not as a failure.
 * @param {string} stdout
 * @returns {{ evidence: string[], observations: PreviewObservation[] }}
 */
export function parseCheckOutput(stdout) {
  const parsed = JSON.parse(stdout);
  if (Array.isArray(parsed)) return { evidence: parsed.map(String), observations: [] };
  if (!parsed || !Array.isArray(parsed.evidence)) throw new Error('The browser check returned no evidence.');
  return { evidence: parsed.evidence.map(String), observations: (Array.isArray(parsed.observations) ? parsed.observations : []).slice(0, 24).map(boundObservation) };
}

/**
 * Which screenshots a reviewer gets: the first scenario's end state at each
 * width, at most `limit`. The first scenario is the core interaction the
 * preview plan is required to lead with; desktop and phone are the two views
 * an owner would actually open. More images cost tokens on every review round
 * and mostly repeat the same page.
 * @param {Array<{ width: number, route: string, text: string, screenshot?: unknown }>} observations
 * @param {number} [limit]
 */
export function reviewScreenshotChoice(observations, limit = 2) {
  /** @type {Set<number>} */ const widths = new Set();
  const chosen = [];
  for (const observation of observations) {
    if (chosen.length >= limit) break;
    if (!observation.screenshot || widths.has(observation.width)) continue;
    widths.add(observation.width);
    chosen.push(observation);
  }
  return chosen;
}

/**
 * Run every scenario at desktop and phone widths and return the page-text
 * evidence strings existing consumers read.
 *
 * Pass `report` to also collect the structured observations a reviewer needs
 * and page text cannot carry: console errors and failed same-origin requests
 * (a criterion about working behaviour is not met by a page that 500s behind
 * its own copy), the accessibility outline (what the controls are actually
 * called and how the page is structured), and optionally a viewport JPEG.
 * A `pageerror` still fails the run, as it always has; console errors and
 * 4xx/5xx responses are recorded, not fatal — a synthetic database legitimately
 * 404s some lookups, and the reviewer is the one who knows whether it matters.
 * @param {import('playwright').Browser} browser
 * @param {string} base
 * @param {{ routes: string[], scenarios: Array<{ route: string, text: string, steps: Array<Record<string, any>> }> }} plan
 * @param {{ observations: PreviewObservation[], screenshots?: boolean }} [report]
 */
export async function checkPage(browser, base, plan, report) {
  const evidence = [];
  const origin = new URL(base).origin;
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    /** @type {string[]} */ const errors = [];
    // Reset at each scenario so a console error is attributed to the scenario
    // that caused it, not to whichever one happened to run last.
    /** @type {{ consoleErrors: string[], failedRequests: string[] }} */
    let current = { consoleErrors: [], failedRequests: [] };
    page.on('pageerror', error => { errors.push(error.message); pushBounded(current.consoleErrors, `pageerror: ${error.message}`); });
    page.on('console', message => { if (message.type() === 'error') pushBounded(current.consoleErrors, message.text()); });
    page.on('response', response => {
      const url = new URL(response.url());
      if (response.status() >= 400 && url.origin === origin) pushBounded(current.failedRequests, `${response.status()} ${response.request().method()} ${url.pathname}`);
    });
    page.setDefaultTimeout(10000);
    /** @param {string} path */
    const visit = async path => {
      const response = await page.goto(base + localRoute(path), { waitUntil: 'load', timeout: 30000 });
      if (!response?.ok() || new URL(page.url()).pathname !== new URL(base + path).pathname) throw new Error(`Feature route did not open: ${path}`);
      await page.waitForTimeout(200); // Allow hydration without waiting on intentional SSE connections.
      if ((await page.locator('body').innerText()).trim().length < 10) throw new Error(`Feature route is empty: ${path}`);
    };
    try {
      for (const route of plan.routes) await visit(route);
      for (const [scenarioIndex, scenario] of plan.scenarios.entries()) {
        current = { consoleErrors: [], failedRequests: [] };
        let where = `${width}px ${scenario.route}: opening, expecting text ${JSON.stringify(scenario.text)}`;
        try {
          await visit(scenario.route);
          await page.getByText(scenario.text, { exact: false }).first().waitFor({ state: 'visible' });
          for (const [index, step] of scenario.steps.entries()) {
            where = `${width}px ${scenario.route}: step ${index + 1} ${describeStep(step)}`;
            if (step.action === 'reload') await page.reload({ waitUntil: 'load' });
            else if (step.action === 'text') await page.getByText(step.text, { exact: false }).first().waitFor({ state: 'visible' });
            else {
              const control = page.getByRole(step.role, { name: step.name, exact: true });
              if (step.action === 'click') await control.click();
              else if (step.action === 'fill') await control.fill(step.value);
              else await control.selectOption(step.value);
            }
            if (new URL(page.url()).origin !== origin) throw new Error('Feature interaction left the isolated preview.');
          }
        } catch (error) {
          throw new Error(await scenarioFailure(page, where, error));
        }
        evidence.push(`${width}px: ${scenario.route} — ${scenario.text}; interaction and visible result passed. Steps: ${JSON.stringify(scenario.steps)}. Observed page: ${(await page.locator('body').innerText()).slice(0, 3000)}`);
        if (report) report.observations.push(boundObservation({ width, route: scenario.route, text: scenario.text, ...current,
          outline: await page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '(accessibility outline unavailable)'),
          screenshot: report.screenshots && scenarioIndex < OBSERVATION_LIMITS.screenshotsPerWidth ? await viewportShot(page) : undefined }));
      }
      if (errors.length) throw new Error(`Browser runtime error: ${errors.join('; ').slice(0, 1000)}`);
    } finally { await context.close(); }
  }
  return evidence;
}

/**
 * A viewport JPEG small enough to travel, or nothing. A screenshot that fails
 * or will not fit is missing evidence, never a failed scenario: the page text
 * already proved the interaction.
 * @param {import('playwright').Page} page
 */
async function viewportShot(page) {
  for (const quality of [60, 30]) {
    const image = await page.screenshot({ type: 'jpeg', quality, timeout: 5000 }).catch(() => null);
    if (!image) return undefined;
    if (image.length <= OBSERVATION_LIMITS.screenshotBytes) return { mediaType: 'image/jpeg', base64: image.toString('base64') };
  }
  return undefined;
}
/** @param {Record<string, any>} step */
function describeStep(step) {
  if (step.action === 'text') return `expect text ${JSON.stringify(step.text)}`;
  if (step.action === 'reload') return 'reload';
  return `${step.action} ${step.role} ${JSON.stringify(step.name)}${step.value ? ` with ${JSON.stringify(step.value)}` : ''}`;
}

/**
 * What a failed scenario needs to be repairable: which step, what the page
 * actually said, and which controls it actually offered. A Playwright stack
 * trace alone told the worker none of that — a scenario asking for a button
 * the page had named differently read as a crash, not a naming mismatch.
 * @param {import('playwright').Page} page
 * @param {string} where
 * @param {unknown} error
 */
export async function scenarioFailure(page, where, error) {
  // Bounded to fit whole inside the 1,600 characters the broker keeps.
  const first = String(/** @type {{ message?: unknown } | undefined} */ (error)?.message ?? error).split('\n')[0].slice(0, 200);
  const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  const controls = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=tab], [role=link]')]
    .slice(0, 15)
    .map((el) => `${el.getAttribute('role') ?? el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('placeholder') ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`)).catch(() => []);
  return [`Browser scenario failed at ${where}: ${first}`,
    `Page text: ${text.replace(/\s+/g, ' ').trim().slice(0, 550) || '(empty)'}`,
    controls.length ? `Controls on the page: ${controls.join(', ')}` : 'No interactive controls were found on the page.'].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The preview container's own copy; typed from this checkout's, which is the same lockfile.
  // A variable, not a literal, so the type checker does not try to resolve a
  // path that exists only inside that container.
  const containerPlaywright = '/workspace/node_modules/playwright/index.mjs';
  const { chromium } = /** @type {typeof import('playwright')} */ (await import(/* @vite-ignore */ containerPlaywright));
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  // The message alone, not a stack: the broker keeps the TAIL of stderr, and
  // a stack trace printed after the message pushed the message out of it.
  // An object since 2026-10-01: the evidence strings exactly as before, plus
  // the structured observations (see `parseCheckOutput` for the old shape).
  try {
    /** @type {{ observations: PreviewObservation[], screenshots: boolean }} */
    const report = { observations: [], screenshots: true };
    const evidence = await checkPage(browser, 'http://127.0.0.1:5275', JSON.parse(await readFile('/tmp/preview-plan.json', 'utf8')), report);
    console.log(JSON.stringify({ evidence, observations: report.observations }));
  }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
  finally { await browser.close(); }
}
