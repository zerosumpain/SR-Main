import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

// Temporary synthetic video only; restore both the real manifest and local settings.
const base = 'http://192.168.0.77:5275';
const manifestPath = 'src/lib/constants/hero-background-asset.json';
const original = await readFile(manifestPath, 'utf8');
const work = await mkdtemp(join(tmpdir(), 'sr-hero-qa-'));
const db = new pg.Client({ connectionString: 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local' });
await db.connect();
const key = 'landing.hero.background';
const previous = (await db.query('select value from app_settings where key=$1', [key])).rows[0];
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    'testsrc2=size=1280x720:rate=30:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', join(work, 'source.mp4')]);
  execFileSync('python3', ['scripts/prepare-hero-background.py', join(work, 'source.mp4'), '--output', work, '--manifest', join(work, 'manifest.json')]);
  const manifest = JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8'));
  assert(manifest.desktopBytes < 2_000_000 && manifest.mobileBytes < 1_000_000);
  await writeFile(manifestPath, JSON.stringify(manifest));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/hero-background/*', async route => {
    const filename = basename(new URL(route.request().url()).pathname);
    await route.fulfill({ body: await readFile(join(work, filename)), contentType: filename.endsWith('.mp4') ? 'video/mp4' : 'image/webp' });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/admin/content/hero`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const controls = page.getByRole('region', { name: 'Hero animation' });
  await controls.getByText('Web-ready animation', { exact: false }).waitFor();
  console.log('Admin ready');
  await controls.getByLabel('Play on page load', { exact: true }).check();
  await controls.getByLabel('Layer over title after fading', { exact: true }).check();
  await controls.getByLabel('Start delay (ms)', { exact: true }).fill('0');
  await controls.getByLabel('Playback speed', { exact: true }).fill('1');
  await controls.getByLabel('Hold last frame (ms)', { exact: true }).fill('1000');
  await controls.getByLabel('Fade duration (ms)', { exact: true }).fill('1200');
  await controls.getByLabel('Final transparency (%)', { exact: true }).fill('80');
  await controls.getByRole('button', { name: 'Save animation settings', exact: true }).click();
  await controls.getByText('Animation settings saved.', { exact: true }).waitFor();
  assert.equal((await db.query('select value from app_settings where key=$1', [key])).rows[0].value.fadeMs, 1200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await controls.getByLabel('Fade duration (ms)', { exact: true }).inputValue(), '1200');
  await controls.getByRole('button', { name: 'Preview / replay', exact: true }).click();
  await page.locator('.animation-preview').scrollIntoViewIfNeeded();
  await page.locator('.animation-preview [data-phase="settled"]').waitFor();
  await controls.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/sr-hero-admin-wide.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await controls.getByRole('button', { name: 'Preview / replay', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.locator('.animation-preview').scrollIntoViewIfNeeded();
  await page.locator('.animation-preview [data-phase="settled"]').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await controls.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/sr-hero-admin-narrow.png' });

  console.log('Admin desktop/mobile preview passed');
  const home = await context.newPage();
  home.on('pageerror', e => errors.push(e.message));
  await home.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const layer = home.locator('.hero-copy .hero-animation');
  await home.getByRole('button', { name: 'Pause hero animation', exact: true }).click();
  const pausedAt = await home.locator('.hero-copy video').evaluate(v => v.currentTime);
  await home.waitForTimeout(350);
  assert.equal(await home.locator('.hero-copy video').evaluate(v => v.currentTime), pausedAt);
  await home.getByRole('button', { name: 'Resume hero animation', exact: true }).click();
  await home.locator('.hero-copy [data-phase="holding"]').waitFor();
  assert.equal(await layer.evaluate(el => getComputedStyle(el).zIndex), '0');
  await home.locator('.hero-copy [data-phase="fading"]').waitFor();
  assert.equal(await layer.evaluate(el => getComputedStyle(el).zIndex), '0');
  await home.locator('.hero-copy [data-phase="settled"]').waitFor();
  const settled = await layer.evaluate(el => ({ opacity: getComputedStyle(el).opacity, z: getComputedStyle(el).zIndex }));
  assert.deepEqual(settled, { opacity: '0.2', z: '2' });
  assert.equal(await home.locator('.hero-copy video').evaluate(v => v.ended && v.paused && !v.loop && v.muted), true);
  await home.screenshot({ path: '/tmp/sr-hero-home-wide.png' });
  console.log('Homepage sequence passed');
  await home.setViewportSize({ width: 390, height: 844 });
  await home.reload({ waitUntil: 'domcontentloaded' });
  await home.locator('.hero-copy [data-phase="settled"]').waitFor();
  assert((await home.locator('.hero-copy video').getAttribute('src')).includes('mobile'));
  assert.equal(await home.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await home.screenshot({ path: '/tmp/sr-hero-home-narrow.png' });

  await home.emulateMedia({ reducedMotion: 'reduce' });
  const requests = [];
  home.on('request', r => requests.push(r.url()));
  await home.reload({ waitUntil: 'domcontentloaded' });
  await home.locator('.hero-copy [data-phase="poster"] img').waitFor();
  assert.equal(await home.locator('.hero-copy video').count(), 0);
  assert.equal(requests.some(url => url.endsWith('.mp4')), false);
  await home.emulateMedia({ reducedMotion: 'no-preference' });
  await home.addInitScript(() => { HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Autoplay denied', 'NotAllowedError')); });
  await home.reload({ waitUntil: 'domcontentloaded' });
  await home.locator('.hero-copy [data-phase="poster"] img').waitFor();

  const invalid = await page.request.post(`${base}/admin/content/hero?/background`, {
    headers: { origin: base, accept: 'application/json', 'x-sveltekit-action': 'true' },
    form: { enabled: 'on', playbackRate: '-1', delayMs: '0', holdMs: '0', fadeMs: '0', playingOpacity: '100', finalTransparency: '80', positionX: '50', positionY: '50', fit: 'cover' },
  });
  assert.equal((await invalid.json()).status, 400);
  await controls.getByLabel('Play on page load', { exact: true }).uncheck();
  await controls.getByRole('button', { name: 'Save animation settings', exact: true }).click();
  await controls.getByText('Animation settings saved.', { exact: true }).waitFor();
  requests.length = 0;
  await home.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await home.locator('.hero-copy .hero-animation').count(), 0);
  assert.equal(requests.some(url => url.includes('/hero-background/')), false);
  assert.deepEqual(errors, []);
  console.log('PASS: encoding budgets; saved/reloaded controls; desktop and mobile playback; pause/resume; hold → fade → overlay; final frame at 20% opacity; reduced motion; autoplay failure; disabled media; invalid values. Synthetic fixture only.');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.log(page.url(), await page.locator('.hero-animation').evaluateAll(els => els.map(el => ({phase: el.dataset.phase, rect: el.getBoundingClientRect().toJSON(), video: el.querySelector('video') && {time: el.querySelector('video').currentTime, paused: el.querySelector('video').paused, ready: el.querySelector('video').readyState}}))));
    await page.screenshot({ path: '/tmp/sr-hero-failure.png' });
  }
  throw error;
} finally {
  await writeFile(manifestPath, original);
  if (previous) await db.query('insert into app_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value', [key, previous.value]);
  else await db.query('delete from app_settings where key=$1', [key]);
  await db.end();
  await browser.close();
  await rm(work, { recursive: true, force: true });
}
