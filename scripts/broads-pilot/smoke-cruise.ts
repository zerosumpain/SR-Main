// Mobile + cruise-mode smoke test: mock a moving GPS track through Horning
// (POI-dense) and assert the responsive layout + nearby-attraction banners.
import { chromium } from '@playwright/test';

const URL = process.env.BP_URL || 'http://localhost:5180/projects/broads-pilot';
const errors: string[] = [];
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  permissions: ['geolocation'], geolocation: { latitude: 52.7086, longitude: 1.4172, accuracy: 18 },
});
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await p.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForTimeout(3000);
await p.getByText('Start planning').click().catch(() => {});
await p.waitForTimeout(400);

// responsive: the planning panel should start COLLAPSED on mobile (no boat select visible)
const selVisible = await p.locator('select').first().isVisible().catch(() => false);
const panelCollapsed = !selVisible;
await p.screenshot({ path: '/tmp/bp-mobile2.png' });

// go live, then simulate ~6 mph movement NE along the Bure at Horning
await p.getByRole('button', { name: /Go live/i }).click().catch(() => {});
await p.waitForTimeout(900);
let lat = 52.7086, lng = 1.4172;
for (let i = 0; i < 7; i++) {
  lat += 0.00002; lng += 0.00003; // ~4 m per fix
  await ctx.setGeolocation({ latitude: lat, longitude: lng, accuracy: 14 });
  await p.waitForTimeout(1500);
}
await p.waitForTimeout(800);
const txt = await p.locator('body').innerText();
const cruising = /Cruising/i.test(txt);
const nearbyBanner = /Coming up nearby/i.test(txt);
const onBroads = !/not on the Broads/i.test(txt);
await p.screenshot({ path: '/tmp/bp-cruise.png' });

await b.close();
console.log(JSON.stringify({ panelCollapsedOnMobile: panelCollapsed, onBroads, cruisingDetected: cruising, nearbyAttractionBanner: nearbyBanner, consoleErrors: errors.length }, null, 2));
errors.slice(0, 10).forEach((e) => console.log('  ⚠', e.slice(0, 160)));
