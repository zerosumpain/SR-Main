/**
 * Recording a verdict while an unattended run is going.
 *
 * The case that broke: autopilot keeps the worker running and advances the
 * candidate every round, and five separate guards each refused the owner's own
 * observation because of it — a workspace-wide revision lock, a running build, a
 * preview whose revision had been overtaken, a candidate mismatch, and a poll
 * that cleared the box mid-sentence. This drives exactly that state: build
 * RUNNING, candidate ahead of the preview, an assessment already recorded.
 *
 * Synthetic throughout; no database, no worker, no model.
 *
 *   BASE=http://localhost:5194 node scripts/qa/development-evidence-preview.mjs
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://localhost:5194';
const id = '00000000-2222-3333-4444-555555555555';
const previewed = 'a'.repeat(40);
const candidate = 'b'.repeat(40);

const criterion = (n, over = {}) => ({
  id: `criterion-${n}`, text: `Criterion ${n}`, verdict: 'unverified', evidence: '', revision: null, ...over,
});

const snapshot = () => ({
  delivery: { revision: 42, state: {
    version: 1, area: 'Health', stage: 'building',
    brief: { revision: 3, outcome: 'Compare two weeks', constraints: '', routes: ['/health/compare'], acceptedAt: 'today' },
    criteria: [
      criterion(1, { assessment: { verdict: 'passed', basis: 'observed', evidence: 'Clicked Save; the comparison reappeared after reload.', model: 'reviewer/model', independent: true, revision: previewed, at: '2026-09-09T06:00:00.000Z' } }),
      criterion(2, { assessment: { verdict: 'failed', basis: 'inferred', evidence: 'No handler writes the comparison anywhere.', model: 'builder/model', independent: false, revision: previewed, at: '2026-09-09T06:00:00.000Z' } }),
      criterion(3),
    ],
    decisions: [], session: { engine: 'pi', id: 'session', file: null, recovery: null },
    // The candidate has moved past what the preview is serving. That is the
    // designed behaviour — the last working preview is retained — and it used
    // to disable the button.
    candidate, gate: null,
    preview: { url: null, status: 'ready', revision: previewed, kind: 'working', detail: 'Working preview 3' },
    batch: null, acceptedAt: null, releasePolicy: 'preview_only',
    autopilot: { enabled: true, rounds: 2, maxRounds: 6, startedAt: '2026-09-09T05:00:00.000Z' },
  } },
  build: { prompt: 'Compare two weeks', title: 'Compare two weeks of health data', status: 'running', modelId: 'builder/model', iterationsCompleted: 5, costUsd: null, budgetConfig: {} },
  instructions: [], notes: [], events: [], lessons: [],
  progress: { totalTokens: 1000, outputTokens: 100, iterations: [] }, blocker: null,
});

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const posted = [];
await page.route(`**/api/jkai/development/${id}`, async (route) => {
  if (route.request().method() === 'POST') {
    posted.push(JSON.parse(route.request().postData() ?? '{}'));
    return route.fulfill({ json: { ok: true } });
  }
  return route.fulfill({ json: snapshot() });
});

await page.goto(`${base}/jkai/develop/${id}`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Preview', exact: true }).click();
await page.getByRole('heading', { name: 'Acceptance evidence' }).waitFor();

// The reviewer's reasoning is present for every assessed criterion, and says
// which revision it judged and whether it was a second opinion.
const thoughts = page.locator('.wk-assessment');
assert.equal(await thoughts.count(), 2, 'every assessed criterion shows what the reviewer thought');
await page.getByText('Clicked Save; the comparison reappeared after reload.').waitFor();
await page.getByText('Independent reviewer', { exact: false }).first().waitFor();
await page.getByText('Same model that wrote the change', { exact: false }).first().waitFor();
await page.getByText('No separate adversary is pinned', { exact: false }).waitFor();
await page.getByText('Not assessed yet', { exact: false }).waitFor();

// The page says which revision the owner is judging rather than hiding it.
await page.getByText(`You are judging revision ${previewed.slice(0, 8)}`, { exact: false }).waitFor();

// The save works with the build RUNNING and the candidate ahead of the preview.
const save = page.getByRole('button', { name: 'Save evidence' }).first();
assert.equal(await save.isDisabled(), false, 'evidence must be recordable while the worker is running');
await page.getByLabel('Verdict for Criterion 1').selectOption('passed');
await page.getByLabel('Evidence for Criterion 1').fill('I opened the preview and the saved comparison was there.');
await save.click();
await page.waitForTimeout(400);

const verdict = posted.find((p) => p.action === 'criterion');
assert.ok(verdict, 'the verdict must reach the server');
assert.equal(verdict.verdict, 'passed');
assert.equal(verdict.judgedRevision, previewed, 'the verdict judges the revision the preview is serving');
assert.match(verdict.evidence, /saved comparison was there/);

// A follow-up request becomes part of what the feature must do.
await page.getByRole('heading', { name: 'Anything else you want' }).scrollIntoViewIfNeeded();
await page.getByLabel('Feature request').fill('Remember the last comparison and open on it next time.');
await page.getByRole('button', { name: 'Add to this feature', exact: true }).click();
await page.waitForTimeout(400);
const request = posted.find((p) => p.action === 'request');
assert.ok(request, 'the request must reach the server');
assert.match(request.request, /Remember the last comparison/);

await page.screenshot({ path: '/tmp/development-evidence.png', fullPage: true });

// Phone width: the same controls have to be reachable.
const phone = await context.newPage();
await phone.setViewportSize({ width: 390, height: 900 });
await phone.route(`**/api/jkai/development/${id}`, (route) => route.fulfill({ json: snapshot() }));
await phone.goto(`${base}/jkai/develop/${id}`, { waitUntil: 'networkidle' });
await phone.getByRole('button', { name: 'Preview', exact: true }).click();
await phone.getByRole('heading', { name: 'Acceptance evidence' }).waitFor();
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert.ok(overflow <= 1, `the page must not scroll horizontally on a phone (overflowed by ${overflow}px)`);
await phone.screenshot({ path: '/tmp/development-evidence-phone.png', fullPage: true });

assert.deepEqual(errors, [], 'no browser errors');
await browser.close();
console.log('PASS: evidence saves while the worker runs and the candidate has moved on, the reviewer’s reasoning stays visible, and a follow-up request reaches the server.');
console.log('Screenshots: /tmp/development-evidence.png /tmp/development-evidence-phone.png');
