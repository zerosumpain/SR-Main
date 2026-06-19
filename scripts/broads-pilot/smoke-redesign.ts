import { chromium } from '@playwright/test';
const URL = process.env.BP_URL || 'http://localhost:5180/projects/broads-pilot';
const errors: string[] = [];
const b = await chromium.launch();

// ---- desktop ----
const dctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
const p = await dctx.newPage();
p.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForTimeout(3000);
await p.getByText('Start planning').click().catch(() => {});
await p.waitForTimeout(500);
await p.screenshot({ path: '/tmp/bp-rd-explore.png' });

// boat sheet
await p.getByRole('button', { name: /Choose boat|air draft/ }).first().click().catch(() => {});
await p.waitForTimeout(500);
const boatSheet = await p.getByText('Boat & bridge fit').count();
await p.screenshot({ path: '/tmp/bp-rd-boatsheet.png' });
await p.getByRole('button', { name: 'Close' }).click().catch(() => {});
await p.waitForTimeout(300);

// route mode — click a reachable destination
let routeShown = false, allClear = false;
const rows = p.locator('button', { hasText: /min/ });
if (await rows.count()) {
  await rows.first().click().catch(() => {});
  await p.waitForTimeout(1200);
  const t = await p.locator('body').innerText();
  routeShown = /Cruising|Distance|Planned leg|reachable/i.test(t);
  allClear = /All bridges clear/i.test(t);
}
await p.screenshot({ path: '/tmp/bp-rd-route.png' });

// ---- mobile ----
const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await mctx.newPage();
mp.on('pageerror', (e) => errors.push('MOBILE PAGEERROR: ' + e.message));
await mp.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
await mp.waitForTimeout(3000);
await mp.getByText('Start planning').click().catch(() => {});
await mp.waitForTimeout(500);
await mp.screenshot({ path: '/tmp/bp-rd-mobile-peek.png' });
// tap the grip to expand
await mp.locator('.grip').click().catch(() => {});
await mp.waitForTimeout(700);
await mp.screenshot({ path: '/tmp/bp-rd-mobile-half.png' });

await b.close();
console.log(JSON.stringify({ boatSheetOpens: boatSheet > 0, routeShown, allClearShown: allClear, consoleErrors: errors.length }, null, 2));
errors.slice(0, 12).forEach((e) => console.log('  ⚠', e.slice(0, 160)));
