// Visual + functional smoke test for the Broads Pilot planner.
import { chromium } from '@playwright/test';

const URL = 'http://localhost:5180/projects/broads-pilot';
const errors: string[] = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(3500); // Leaflet + dataset load
// dismiss onboarding
await page.getByText('Start planning').click().catch(() => {});
await page.waitForTimeout(400);

// boat picker present?
const hasBoat = await page.locator('select').first().count();
// set origin by clicking the map (right side, away from the left panel)
await page.mouse.click(900, 430);
await page.waitForTimeout(1200);
const reachTxt = await page.locator('body').innerText();
const hasReach = /\bmin\b|\bh\b/.test(reachTxt);

// click the first reachable destination row if present
let hasPlan = false;
const rows = page.locator('button', { hasText: /min|mi|km/ });
if (await rows.count()) {
  await rows.first().click().catch(() => {});
  await page.waitForTimeout(1000);
  const t = await page.locator('body').innerText();
  hasPlan = /Distance|Cruising|reachable/i.test(t);
}
await page.screenshot({ path: '/tmp/bp-desktop.png' });

// mobile
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await mctx.newPage();
mp.on('pageerror', (e) => errors.push('MOBILE PAGEERROR: ' + e.message));
await mp.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
await mp.waitForTimeout(3000);
await mp.getByText('Start planning').click().catch(() => {});
await mp.waitForTimeout(400);
await mp.screenshot({ path: '/tmp/bp-mobile.png' });

await browser.close();
console.log(JSON.stringify({ hasBoatSelect: !!hasBoat, originClickReachable: hasReach, planPanelShown: hasPlan, consoleErrors: errors.length }, null, 2));
errors.slice(0, 15).forEach((e) => console.log('  ⚠', e.slice(0, 180)));
