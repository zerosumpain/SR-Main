// The page in a real browser engine (spec §12.2, WP6's acceptance list):
//   - WebKit (JavaScriptCore, the WKWebView's engine) and Node agree on a
//     30-day town's hash: the phone predicts exactly what the server computes;
//   - frames on the fixture metropolis stay inside the 8 ms budget;
//   - harness mode founds a town with no network, and is screenshotted.

import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const here = decodeURIComponent(new URL('.', import.meta.url).pathname);
const tsx = decodeURIComponent(new URL('../../../node_modules/.bin/tsx', import.meta.url).pathname);
/** Node's answer, from e2e/reference.ts. */
const node = (...args: string[]) => execFileSync(tsx, [`${here}reference.ts`, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 180_000 });

// window.__hometowns is typed in src/main.ts (harness mode's hooks).

const ready = async (page: import('@playwright/test').Page) => {
  await page.waitForFunction(() => !!window.__hometowns, undefined, { timeout: 60_000 });
};

test('the engine reaches the same 30-day hash as Node', async ({ page }) => {
  const want = node('bot', '7', '0', '30');
  expect(want).toMatch(/^[0-9a-f]{16}$/);
  await page.goto('?harness=1&bot=1&fresh=1&speed=0');
  await ready(page);
  const browser = await page.evaluate(() => window.__hometowns!.botHash(7, 0, 30));
  expect(browser).toBe(want);
});

test('frames on the fixture metropolis stay inside 8 ms', async ({ page }, info) => {
  const f = JSON.parse(node('fixture', 'metropolis')) as { county: unknown; town: number; now: number };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?harness=1&fresh=1&speed=0');
  await ready(page);
  await page.evaluate(([json, town, now]) => window.__hometowns!.show(json as string, town as number, now as number), [JSON.stringify(f.county), f.town, f.now]);
  // The first frames after a new town upload its geometry to the GPU; the budget is for the frames after.
  await page.evaluate(() => window.__hometowns!.frameTimes(10, false));
  const pans = await page.evaluate(() => window.__hometowns!.frameTimes(60, false));
  const repaints = await page.evaluate(() => window.__hometowns!.frameTimes(5, true));
  const p95 = [...pans].sort((a, b) => a - b)[Math.floor(pans.length * 0.95)];
  info.annotations.push({ type: 'frame ms', description: `pan p95 ${p95.toFixed(2)} · whole-town repaint ${Math.max(...repaints).toFixed(1)}` });
  console.log(`[frames] ${info.project.name}: ${info.annotations[0].description}`);
  await page.screenshot({ path: info.outputPath('metropolis.png') });
  expect(p95).toBeLessThanOrEqual(8);
});

test('harness mode founds a town with no network', async ({ page }, info) => {
  const requests: string[] = [];
  await page.goto('?harness=1&fresh=1&speed=0&seed=3');
  await ready(page);
  page.on('request', (r) => requests.push(r.url()));
  await page.getByRole('button', { name: 'Found the town' }).click();
  await expect(page.locator('.tutorial')).toBeVisible();
  await page.getByRole('button', { name: 'Play it all' }).click();
  await page.screenshot({ path: info.outputPath('harness.png') });
  // Founding and the whole fortnight load nothing: every script was in the bundle before the first tap.
  expect(requests).toEqual([]);
});

test('app mode speaks bridge 1 to a mock app', async ({ page }) => {
  const wire = node('wire');
  await page.addInitScript(() => {
    const sent: unknown[] = [];
    (window as unknown as { __sent: unknown[] }).__sent = sent;
    (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { hometowns: { postMessage: (m: unknown) => sent.push(m) } } };
  });
  await page.goto('?app=1');
  await page.waitForFunction(() => (window as unknown as { __sent: { type: string }[] }).__sent.some((m) => m.type === 'ready'));
  const ready = await page.evaluate(() => (window as unknown as { __sent: { type: string }[] }).__sent.find((m) => m.type === 'ready'));
  expect(ready).toMatchObject({ type: 'ready', v: 1, bridge: 1 });
  await page.evaluate((w) => {
    const api = (window as unknown as { hometowns: { boot(a: unknown): void; tool(t: unknown): void; ghost(g: unknown): void; lens(id: string): void } }).hometowns;
    const frame = JSON.parse(w);
    api.boot({ bridge: 1, engineHash: frame.client.engineHash, wire: frame, copyLevel: 'adult', theme: 'light', reduceMotion: true, locale: 'en-GB' });
    api.lens('landValue');
    api.ghost({ plan: [{ op: 'zone', zone: 'homes', rect: [27, 47, 5, 1] }] });
  }, wire);
  // The plan message, then the forecast from the worker: a 1-seed preview and the 5-seed range.
  await page.waitForFunction(() => (window as unknown as { __sent: { type: string; forecast?: { seeds: number } | null }[] }).__sent.some((m) => m.type === 'plan' && m.forecast?.seeds === 5), undefined, { timeout: 60_000 });
  const sent = await page.evaluate(() => (window as unknown as { __sent: { type: string; v: number }[] }).__sent);
  expect(sent.every((m) => m.v === 1)).toBe(true);
  expect(sent.some((m) => m.type === 'lensChanged')).toBe(true);
  expect(sent.filter((m) => m.type === 'error' || m.type === 'needResync')).toEqual([]);
});
