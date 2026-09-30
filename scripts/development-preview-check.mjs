/** Declarative feature checks, executed by the trusted broker in an isolated browser. */
import { readFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Worker-authored plans must never cause the broker to follow a host symlink. */
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

export function localRoute(value) {
  if (typeof value !== 'string' || value.length > 1000 || !value.startsWith('/') || /[\\\s]/.test(value) || value.startsWith('//')) throw new Error('Preview checks need local route paths.');
  const url = new URL(value, 'http://preview.test');
  if (url.origin !== 'http://preview.test') throw new Error('Invalid preview route');
  return value;
}
export function previewPlan(input, routes, required = true) {
  if (!Array.isArray(routes) || routes.length > 12) throw new Error('Provide at most twelve target routes.');
  const targets = routes.map(localRoute);
  if (!input && !required) return { complete: false, routes: targets.length ? targets : ['/jkai/develop'], scenarios: [] };
  if (!targets.length) throw new Error('Set a target route in the accepted brief before building a working preview.');
  if (!input || typeof input.complete !== 'boolean' || !Array.isArray(input.scenarios) || !input.scenarios.length || input.scenarios.length > 12) throw new Error('Create .development-preview.json with complete:false and a core interaction scenario before continuing.');
  const short = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
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

export async function checkPage(browser, base, plan) {
  const evidence = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    const visit = async path => {
      const response = await page.goto(base + localRoute(path), { waitUntil: 'load', timeout: 30000 });
      if (!response?.ok() || new URL(page.url()).pathname !== new URL(base + path).pathname) throw new Error(`Feature route did not open: ${path}`);
      await page.waitForTimeout(200); // Allow hydration without waiting on intentional SSE connections.
      if ((await page.locator('body').innerText()).trim().length < 10) throw new Error(`Feature route is empty: ${path}`);
    };
    try {
      for (const route of plan.routes) await visit(route);
      for (const scenario of plan.scenarios) {
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
            if (new URL(page.url()).origin !== new URL(base).origin) throw new Error('Feature interaction left the isolated preview.');
          }
        } catch (error) {
          throw new Error(await scenarioFailure(page, where, error));
        }
        evidence.push(`${width}px: ${scenario.route} — ${scenario.text}; interaction and visible result passed. Steps: ${JSON.stringify(scenario.steps)}. Observed page: ${(await page.locator('body').innerText()).slice(0, 3000)}`);
      }
      if (errors.length) throw new Error(`Browser runtime error: ${errors.join('; ').slice(0, 1000)}`);
    } finally { await context.close(); }
  }
  return evidence;
}
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
 */
export async function scenarioFailure(page, where, error) {
  const first = String(error?.message ?? error).split('\n')[0].slice(0, 300);
  const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  const controls = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=tab], [role=link]')]
    .slice(0, 40)
    .map((el) => `${el.getAttribute('role') ?? el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('placeholder') ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)}"`)).catch(() => []);
  return [`Browser scenario failed at ${where}: ${first}`,
    `Page text: ${text.replace(/\s+/g, ' ').trim().slice(0, 1200) || '(empty)'}`,
    controls.length ? `Controls on the page: ${controls.join(', ')}` : 'No interactive controls were found on the page.'].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('/workspace/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  // The message alone, not a stack: the broker keeps the TAIL of stderr, and
  // a stack trace printed after the message pushed the message out of it.
  try { console.log(JSON.stringify(await checkPage(browser, 'http://127.0.0.1:5275', JSON.parse(await readFile('/tmp/preview-plan.json', 'utf8'))))); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
  finally { await browser.close(); }
}
