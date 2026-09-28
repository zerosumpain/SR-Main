/** Real WebGL interaction checks with a browser-only offline map style. No provider credentials or saved-place mutations. */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.PEOPLE_PREVIEW_URL;
const output = process.env.PEOPLE_EVIDENCE_DIR || '/tmp/sr-people-insights-evidence';
if (!base || !/^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(new URL(base).hostname)) throw new Error('Set PEOPLE_PREVIEW_URL to a local preview.');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(25000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
try {
  await expect.poll(async () => (await page.request.get(`${base}/home/people/places`)).status(), { timeout: 30000 }).toBe(200);
  await page.goto(`${base}/home/people/places`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Your places on the map' })).toBeVisible();
  await expect(page.locator('.places-map .map-status')).toContainText(/mapbox|credentials|unavailable/i);
  await expect(page.getByRole('button', { name: 'Add on map', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add place', exact: true })).toBeEnabled();
  await page.screenshot({ path: `${output}/places-map-unavailable.png`, fullPage: true });

  // Serve a minimal style to the actual Mapbox renderer. Every provider request is intercepted.
  // Evidence is explicitly labelled: this exercises interaction, not live imagery coverage.
  await page.route(/https:\/\/[^/]*mapbox\.com\//, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const roads = Array.from({ length: 12 }, (_, i) => ({ type: 'Feature', properties: {}, geometry: {
    type: 'LineString', coordinates: [[-.18, 51.49 + i * .01], [-.06, 51.49 + i * .01]],
  } }));
  roads.push(...Array.from({ length: 9 }, (_, i) => ({ type: 'Feature', properties: {}, geometry: {
    type: 'LineString', coordinates: [[-.16 + i * .01, 51.48], [-.16 + i * .01, 51.61]],
  } })));
  await page.route('**/api/maps/config', route => route.fulfill({ json: {
    accessToken: 'pk.local-offline-browser-fixture',
    style: { version: 8, sources: { roads: { type: 'geojson', data: { type: 'FeatureCollection', features: roads } } },
      layers: [ { id: 'paper', type: 'background', paint: { 'background-color': '#ede4d4' } },
        { id: 'sample-roads', type: 'line', source: 'roads', paint: { 'line-color': '#c8bda9', 'line-width': 3 } } ] },
  } }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Add on map', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const label = document.createElement('p');
    label.textContent = 'Browser test · synthetic offline map style, not live Mapbox imagery';
    label.style.cssText = 'padding:12px;background:#1a1008;color:#ede4d4;margin:0;font-size:14px';
    document.querySelector('.map-heading').after(label);
  });
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Select Sample Carmel College', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Edit Sample Carmel College', exact: true });
  await expect(editor).toBeVisible();
  await expect(page.locator('.place-row.selected')).toContainText('Sample Carmel College');
  await expect.poll(() => page.locator('.mapboxgl-canvas').evaluate(el => Math.abs(el.clientWidth - el.closest('.canvas').clientWidth))).toBeLessThan(2);
  await expect(page.locator('.pm-centre')).toBeVisible();
  const originalLat = await editor.locator('input[name="lat"]').inputValue();
  await page.locator('.pm-centre').hover();
  const handle = await page.locator('.pm-centre').boundingBox();
  assert.ok(handle);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 28, handle.y + handle.height / 2 + 24, { steps: 8 });
  // Wait for Mapbox's render queue to consume the move before releasing the pointer.
  await expect(editor.getByRole('button', { name: 'Undo move' })).toBeEnabled();
  await page.mouse.up();
  await expect(editor.getByRole('button', { name: 'Undo move' })).toBeEnabled();
  assert.notEqual(await editor.locator('input[name="lat"]').inputValue(), originalLat);
  await editor.getByRole('button', { name: 'Undo move' }).click();
  await expect(editor.locator('input[name="lat"]')).toHaveValue(originalLat);
  await editor.getByLabel('Radius (m)', { exact: true }).fill('250');
  await expect(editor.getByRole('button', { name: 'Undo move' })).toBeEnabled();
  await editor.getByRole('button', { name: 'Undo move' }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.locator('.home-lede')).toBeInViewport();
  await page.screenshot({ path: `${output}/places-map-desktop.png`, fullPage: true });
  assert.ok(await fits(), 'desktop fits viewport');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Show all places', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Sample Home', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add on map', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel placement', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.mapboxgl-canvas').click({ position: { x: 150, y: 130 } });
  const add = page.locator('.add-form');
  await expect(add.getByLabel('Name', { exact: true })).toBeFocused();
  assert.ok(Number(await add.getByLabel('Latitude').inputValue()) > 50);
  assert.ok(Number(await add.getByLabel('Longitude').inputValue()) < 0);
  await add.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.pm-centre')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.place-row').filter({ has: page.getByRole('heading', { name: 'Sample Home', exact: true }) }).getByRole('button', { name: 'View on map & edit →' }).click();
  await expect(page.getByRole('region', { name: 'Edit Sample Home', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.mapboxgl-canvas').evaluate(el => Math.abs(el.clientWidth - el.closest('.canvas').clientWidth))).toBeLessThan(2);
  assert.ok(await fits(), 'mobile fits viewport');
  await page.screenshot({ path: `${output}/places-map-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Show all places', exact: true }).click();
  const marker = page.getByRole('button', { name: 'Select Sample Home', exact: true });
  await marker.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Edit Sample Home', exact: true })).toBeFocused();
  assert.deepEqual(errors, []);
  await writeFile(`${output}/places-map-check.json`, JSON.stringify({ base, checkedAt: new Date().toISOString(), imagery: 'offline browser-only synthetic style', checks: ['map visible by default', 'missing credentials state', 'marker/list selection', 'responsive canvas resize', 'boundary drag and undo', 'radius draft', 'fit all', 'point placement', 'cancel clears draft', 'desktop/mobile overflow', 'keyboard marker selection'], errors }, null, 2));
  console.log('Places map desktop/mobile interaction checks passed.');
} catch (error) {
  console.error(await page.locator('.pm-label').evaluateAll(labels => labels.map(el => el.outerHTML)));
  await page.screenshot({ path: `${output}/places-map-failure.png`, fullPage: true });
  throw error;
} finally { await browser.close(); }
