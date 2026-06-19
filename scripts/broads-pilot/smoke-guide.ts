// End-to-end test of the AI day-planner: open chat → answer questions → real
// LLM plan → apply to map.
import { chromium } from '@playwright/test';

const URL = process.env.BP_URL || 'http://localhost:5180/projects/broads-pilot';
const errors: string[] = [];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await p.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForTimeout(3000);
await p.getByText('Start planning').click().catch(() => {});
await p.waitForTimeout(400);

await p.getByRole('button', { name: /Plan my day/ }).click();
await p.waitForTimeout(500);
const opened = await p.getByText('Plan my day on the Broads').count();

await p.getByRole('button', { name: /Most of the day/ }).click();
await p.waitForTimeout(300);
await p.getByRole('button', { name: /Dog walk/ }).click();
await p.getByRole('button', { name: /Pub lunch/ }).click();
await p.waitForTimeout(200);
await p.getByRole('button', { name: /^Next/ }).click();
await p.waitForTimeout(300);
await p.getByPlaceholder(/Type anything/).fill('a really good long walk for the dogs');
await p.getByRole('button', { name: /Plan it/ }).click();

// wait for the LLM plan
await p.getByText('Put this trip on the map').waitFor({ timeout: 90000 }).catch(() => {});
await p.waitForTimeout(800);
const planShown = await p.getByText('Put this trip on the map').count();
const summaryText = await p.locator('.summary').first().innerText().catch(() => '');
await p.screenshot({ path: '/tmp/bp-guide-plan.png' });

// apply to the map
await p.getByText('Put this trip on the map').click().catch(() => {});
await p.waitForTimeout(1800);
const itineraryOnMap = await p.locator('.bp-stop-pin').count();
await p.screenshot({ path: '/tmp/bp-guide-map.png' });

await b.close();
console.log(JSON.stringify({ chatOpened: opened > 0, planShown: planShown > 0, summary: summaryText.slice(0, 120), stopPinsOnMap: itineraryOnMap, consoleErrors: errors.length }, null, 2));
errors.slice(0, 10).forEach((e) => console.log('  ⚠', e.slice(0, 160)));
