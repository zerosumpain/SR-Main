import { test, expect } from '@playwright/test';

// Synthetic provider responses exercise the real WebGL renderer without a token
// or billable requests. Live Mapbox styling is separately verified after setup.
const syntheticStyle = { version: 8, sources: {}, layers: [{ id: 'paper', type: 'background', paint: { 'background-color': '#ede4d4' } }] };

async function harness(page: import('@playwright/test').Page) {
  await page.route('**/api/maps/config', (route) => route.fulfill({ json: { accessToken: 'pk.synthetic.signature', style: '/mapbox-test-style.json' } }));
  await page.route('**/mapbox-test-style.json', (route) => route.fulfill({ json: syntheticStyle }));
  await page.route('https://api.mapbox.com/**', (route) => route.fulfill({ json: syntheticStyle }));
  await page.route('https://events.mapbox.com/**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.goto('/');
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'map-test';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg)';
    document.body.appendChild(host);
  });
}

test('Mapbox preserves route geometry, labels, theme reloads and disposal', async ({ page }) => {
  test.setTimeout(120_000);
  await harness(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(async () => {
    const { loadMapbox } = await import(/* @vite-ignore */ String('/src/lib/maps/loader.ts'));
    const M = await loadMapbox();
    const host = document.getElementById('map-test')!;
    const view = M.map(host, { scrollWheelZoom: false });
    view.setView([52.63, 1.3], 12);
    const group = M.layerGroup().addTo(view);
    M.polyline([[52.63, 1.3], [52.66, 1.34]], { color: '#c4570a', weight: 4 }).addTo(group);
    M.circle([52.64, 1.31], { radius: 200 }).addTo(group);
    M.polygon([[[52.63, 1.30], [52.65, 1.30], [52.65, 1.33]], [[52.638, 1.308], [52.64, 1.308], [52.64, 1.31]]], { hatch: 'diag', color: '#0e5b66' }).addTo(group);
    M.marker([52.63, 1.3]).bindTooltip('<img src=x onerror=alert(1)>', { permanent: true }).addTo(group);
    (window as any).mapTest = { view, group };
  });
  await expect(page.locator('#map-test canvas.mapboxgl-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => ((window as any).mapTest.view.styleReady ? Object.keys((window as any).mapTest.view.native.getStyle().sources).length : 0))).toBe(3);
  expect(await page.evaluate(() => {
    const source: any = Object.values((window as any).mapTest.view.native.getStyle().sources)[0];
    return source.data.geometry.coordinates[0];
  })).toEqual([1.3, 52.63]);
  await expect(page.locator('#map-test .mapboxgl-popup-content')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#map-test .mapboxgl-popup-content img')).toHaveCount(0);
  await page.evaluate(() => (window as any).mapTest.view.setTheme('schematic'));
  await expect.poll(() => page.evaluate(() => ((window as any).mapTest.view.styleReady ? Object.keys((window as any).mapTest.view.native.getStyle().sources).length : 0))).toBe(3);
  await page.evaluate(() => (window as any).mapTest.group.clearLayers());
  await expect(page.locator('#map-test .mapboxgl-marker')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys((window as any).mapTest.view.native.getStyle().sources))).toEqual([]);
  await page.evaluate(() => (window as any).mapTest.view.remove());
  await expect(page.locator('#map-test canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const width of [1280, 390]) {
  test(`chat map fullscreen and setup state at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 800 });
    await harness(page);
    await page.evaluate(async () => {
      const { mountArtifact } = await import(/* @vite-ignore */ String('/src/lib/components/maps/__tests__/mapbox.browser-fixture.ts'));
      mountArtifact(document.getElementById('map-test')!);
    });
    await expect(page.locator('.map-artifact .mapboxgl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Expand map' }).click();
    await expect(page.locator('.map-artifact')).toHaveClass(/fullscreen/);
    await expect.poll(async () => Math.round((await page.locator('.map-artifact').boundingBox())!.width)).toBe(width);
    await page.keyboard.press('Escape');
    await expect(page.locator('.map-artifact')).not.toHaveClass(/fullscreen/);
    await page.screenshot({ path: `/tmp/sr-mapbox-${width}.png` });
    await page.route('**/api/maps/config', (route) => route.fulfill({ status: 503, json: { message: 'Not configured' } }));
    await page.evaluate(async () => {
      const { mountPlace } = await import(/* @vite-ignore */ String('/src/lib/components/maps/__tests__/mapbox.browser-fixture.ts'));
      mountPlace(document.getElementById('map-test')!);
    });
    await expect(page.getByText(/Add a Mapbox public token/)).toBeVisible();
  });
}

test('downloaded OSM imagery renders in Mapbox when the connection drops', async ({ page, context }) => {
  test.setTimeout(120_000);
  await harness(page);
  await page.evaluate(async () => {
    const { mountOffline } = await import(/* @vite-ignore */ String('/src/lib/components/maps/__tests__/mapbox.browser-fixture.ts'));
    (window as any).offlineTest = await mountOffline(document.getElementById('map-test')!);
  });
  await expect(page.locator('#map-test .mapboxgl-canvas')).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Offline · downloaded © OpenStreetMap contributors')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).offlineTest.view.native.getStyle().sources).filter((id) => id.startsWith('offline-tile')).length)).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const map = (window as any).offlineTest.view.native;
    const id = Object.keys(map.getStyle().sources).find((id) => id.startsWith('offline-tile'));
    return id ? map.getSource(id).image?.width : 0;
  })).toBe(256);
  await context.setOffline(false);
  await expect(page.getByText('Offline · downloaded © OpenStreetMap contributors')).toBeHidden();
  await page.evaluate(() => (window as any).offlineTest.remove());
  await expect(page.locator('#map-test .mapboxgl-canvas')).toHaveCount(0);
});

test('Broads Pilot renders its overlays and switches map themes', async ({ page }) => {
  test.setTimeout(120_000);
  await harness(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/projects/broads-pilot');
  await expect(page.locator('.bp-map .mapboxgl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.bp-map .mapboxgl-marker').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Start planning', exact: true }).click();
  await page.getByRole('button', { name: 'Map options' }).click();
  await page.getByRole('button', { name: 'Schematic', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Schematic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.bp-map .mapboxgl-marker').first()).toBeVisible();
  expect(errors).toEqual([]);
});
