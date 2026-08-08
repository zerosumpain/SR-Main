#!/usr/bin/env node
/**
 * Load a static app in a headless browser and report whether it works.
 *
 * Run as a subprocess by `$lib/jkai/static-smoke.ts`, never imported: playwright
 * is a devDependency, and pulling it into the SvelteKit server bundle would make
 * a production runtime dependency out of a dev package. Shelling out is also the
 * existing precedent — `publishBuild` already runs `npm install` / `npm run build`
 * inside a workspace the same way.
 *
 *   node scripts/smoke-static-app.mjs <workspace-dir>   # checks JSON on stdin
 *
 * Must be run from INSIDE the repo — `import('playwright')` resolves from this
 * file's own directory, not the working directory, so a copy of this script in
 * /tmp reports "playwright is not available" on a machine that has it.
 *
 * Always prints one JSON object to stdout, whatever happens. Exit code is 0 for
 * "the run completed" (pass or fail) and 1 only for "the run could not happen",
 * so the caller can tell a broken app from a broken harness.
 */

const dir = process.argv[2];
if (!dir) {
  process.stdout.write(JSON.stringify({ ran: false, reason: 'no workspace directory given' }));
  process.exit(1);
}

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf-8').trim();
};

const fail = (reason) => {
  process.stdout.write(JSON.stringify({ ran: false, reason }));
  process.exit(1);
};

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // Not installed here. A missing harness must never read as a failing app.
  fail('playwright is not available in this environment');
}

let checks = [];
try {
  const raw = await readStdin();
  if (raw) checks = JSON.parse(raw);
  if (!Array.isArray(checks)) checks = [];
} catch {
  fail('checks payload was not valid JSON');
}

const OVERALL_MS = 45_000;
const guard = setTimeout(() => fail(`smoke run exceeded ${OVERALL_MS}ms`), OVERALL_MS);

let browser;
try {
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // Anything the page says about itself. `pageerror` is an uncaught exception;
  // console errors catch the handler that swallowed one and logged instead.
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  const response = await page.goto(`file://${dir}/index.html`, {
    waitUntil: 'load',
    timeout: 15_000,
  });
  if (response === null && !page.url().startsWith('file://')) {
    throw new Error('index.html did not load');
  }
  // Give deferred setup (rAF, setTimeout(0), canvas sizing) a moment to settle.
  await page.waitForTimeout(250);

  const shape = await page.evaluate(() => ({
    elements: document.body ? document.body.querySelectorAll('*').length : 0,
    text: document.body ? document.body.innerText.trim().length : 0,
  }));

  const baseline = [
    { name: 'loads without an uncaught error', passed: pageErrors.length === 0, detail: pageErrors.join(' | ') },
    { name: 'logs no console error', passed: consoleErrors.length === 0, detail: consoleErrors.slice(0, 3).join(' | ') },
    {
      name: 'renders something',
      passed: shape.elements >= 3 && shape.text > 0,
      detail: `${shape.elements} elements, ${shape.text} chars of text`,
    },
  ];

  // Behavioural checks, authored by whoever knows what the app is FOR.
  // The baseline alone is not enough: the calculator this was written for threw
  // nothing, logged nothing, rendered fine — and answered 0 to every sum.
  const results = [];
  for (const check of checks.slice(0, 12)) {
    const description = String(check?.description ?? 'unnamed check');
    const script = String(check?.script ?? '');
    if (!script) {
      results.push({ name: description, passed: false, detail: 'check had no script' });
      continue;
    }
    try {
      const value = await page.evaluate(
        `(async () => { ${script} })()`,
      );
      const passed = value === true;
      results.push({
        name: description,
        passed,
        // A check that returns a value rather than true is usually the model
        // returning what it measured — show it, that IS the diagnosis.
        detail: passed ? '' : `returned ${JSON.stringify(value)?.slice(0, 200) ?? 'undefined'}`,
      });
    } catch (err) {
      results.push({ name: description, passed: false, detail: `threw: ${String(err?.message ?? err).slice(0, 200)}` });
    }
  }

  const all = [...baseline, ...results];
  clearTimeout(guard);
  await browser.close();
  process.stdout.write(
    JSON.stringify({
      ran: true,
      passed: all.every((c) => c.passed),
      checks: all,
      failures: all.filter((c) => !c.passed).map((c) => (c.detail ? `${c.name} — ${c.detail}` : c.name)),
    }),
  );
  process.exit(0);
} catch (err) {
  clearTimeout(guard);
  await browser?.close().catch(() => {});
  fail(`smoke harness error: ${String(err?.message ?? err).slice(0, 300)}`);
}
