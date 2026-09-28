/** Synthetic fixtures and browser checks against the cumulative local stack only. */
import { chromium, expect } from '@playwright/test';
import pg from 'pg';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.PEOPLE_PREVIEW_URL;
const output = process.env.PEOPLE_EVIDENCE_DIR || '/tmp/sr-people-insights-evidence';
const connectionString = process.env.DATABASE_URL;
if (!base || !connectionString) throw new Error('Set PEOPLE_PREVIEW_URL and DATABASE_URL for the isolated local preview.');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname)) throw new Error('Synthetic fixtures require a loopback database.');
if (!/^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(new URL(base).hostname)) throw new Error('Use a local preview URL.');
const client = new pg.Client({ connectionString });
await client.connect();
await mkdir(output, { recursive: true });
const subject = 'sample-insights-alex', other = 'sample-insights-sam';
const home = 'sample-insights-home', school = 'sample-insights-college', coffee = 'sample-insights-coffee';
const now = Date.now(), minute = 60000, day = 86400000;
const route = async (start, who, reverse = false, live = false) => {
  const a = reverse ? 51.59 : 51.5, sign = reverse ? -1 : 1;
  const points = [];
  for (let m = -12; m <= 0; m += 2) points.push([m, a, 0, reverse ? school : home]);
  for (let m = 2; m <= 18; m += 2) points.push([m, a + sign * m / 2 * .01, 33, m === 18 ? reverse ? home : school : null]);
  if (!live) for (let m = 20; m <= 30; m += 2) points.push([m, a + sign * .09, 0, reverse ? home : school]);
  for (const [m, lat, speed, place] of points) {
    const t = start + m * minute;
    if (t > now) continue;
    await client.query(`insert into daydream_trail(subject,source,ts,lat,lon,accuracy_m,reading_age_s,speed_kmh,mode,place_id,is_home)
      values($1,'poll',$2,$3,-0.12,10,0,$4,$5,$6,$7)`, [who, new Date(t), lat, speed, speed ? 'vehicle' : 'still', place, place === home]);
  }
};
try {
  await client.query('begin');
  for (const [s, name] of [[subject, 'Sample Alex'], [other, 'Sample Sam']]) {
    await client.query(`insert into household_member(subject,display_name,source,ha_person_entity) values($1,$2,'life360',null)
      on conflict(subject) do update set display_name=excluded.display_name`, [s, name]);
  }
  // Only this script's synthetic rows are replaced; earlier local fixtures remain intact.
  await client.query('delete from daydream_trail where subject=any($1)', [[subject, other]]);
  for (const [id, label, kind, lat] of [[home, 'Sample Home', 'home', 51.5], [school, 'Sample Carmel College', 'school', 51.59], [coffee, null, 'unknown', 51.52]]) {
    await client.query(`insert into daydream_places(id,label,kind,lat,lon,radius_m,source,status,visit_count,distinct_days,median_dwell_mins,last_seen_at,suggested_label,suggested_address,suggested_provider,suggested_precision)
      values($1,$2,$3,$4,-0.12,100,$5,'active',12,6,35,now(),$6,$7,$8,$9)
      on conflict(id) do update set label=excluded.label, kind=excluded.kind, source=excluded.source, status='active',last_seen_at=now(),suggested_label=excluded.suggested_label,suggested_address=excluded.suggested_address`,
      [id,label,kind,lat,label?'confirmed':'geocoded',id===coffee?'42 Sample High Street':null,id===coffee?'42 Sample High Street, Exampletown · synthetic address':null,id===coffee?'Mapbox':null,id===coffee?'address':null]);
  }
  let count = 0;
  for (let offset = 1; offset <= 12 && count < 5; offset++) {
    const date = new Date(now - offset * day);
    if ([0,6].includes(date.getUTCDay())) continue;
    date.setUTCHours(7,20,0,0);
    await route(+date, subject); await route(+date, other);
    await route(+date + 8 * 3600000, subject, true);
    // A slow afternoon wander, observed outdoors in daylight, together.
    for (let m = 0; m <= 20; m += 2) for (const who of [subject, other]) await client.query(`insert into daydream_trail(subject,source,ts,lat,lon,accuracy_m,reading_age_s,speed_kmh,mode,is_home)
      values($1,'poll',$2,$3,-0.12,10,0,5,'walking',false)`, [who, new Date(+date + 6 * 3600000 + m * minute), 51.515 + m * .0007]);
    count++;
  }
  await route(now - 8 * minute, subject, false, true);
  for (let m = -12; m <= 0; m += 2) await client.query(`insert into daydream_trail(subject,source,ts,lat,lon,accuracy_m,reading_age_s,speed_kmh,mode,is_home,place_id)
    values($1,'poll',$2,51.52,-0.12,10,0,0,'still',false,$3)`, [other, new Date(now + m * minute), coffee]);
  await client.query('commit');
  if (process.argv.includes('--seed-only')) { console.log('Synthetic people insight fixtures seeded.'); process.exitCode = 0; }
  else {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
      page.setDefaultTimeout(25000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      // Insights folded into the travel desk (/home/people) on 2026-09-28; the
      // old URL 308s there. The dashboard polls every 30 s, so wait on `load`.
      await expect.poll(async () => (await page.request.get(`${base}/home/people`)).status(), { timeout: 30000 }).toBe(200);
      await page.goto(`${base}/home/people/insights`, { waitUntil: 'load' });
      await expect(page).toHaveURL(/\/home\/people$/);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole('heading', { name: /Learned routes/ })).toBeVisible();
      await expect(page.getByRole('link', { name: '28d', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('listbox', { name: 'Learned routes' })).toContainText('Sample Home → Sample Carmel College');
      await expect(page.getByText(/weekdays, leaves 08:/).first()).toBeVisible();
      await page.screenshot({ path: `${output}/desk-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${output}/desk-mobile.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desk fits mobile');
      await page.goto(`${base}/home/people?person=${subject}`, { waitUntil: 'load' });
      await expect(page.getByRole('listbox', { name: 'Learned routes' })).not.toContainText('Sample Sam');
      await page.goto(`${base}/home/people/places`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: /^Ready to name/ }).click();
      const card = page.locator('.place-row').filter({ has: page.getByRole('heading', { name: '42 Sample High Street' }) });
      await expect(card).toBeVisible();
      await card.getByLabel('Family name', { exact: true }).fill('Sample favourite café');
      await card.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('cafe');
      await card.getByRole('button', { name: 'Save name', exact: true }).click();
      await expect(page.locator('.message[role="status"]')).toContainText(/saved/i);
      await page.getByRole('button', { name: 'All places', exact: true }).click();
      await page.getByLabel('Find a place').fill('Sample favourite');
      const named = page.locator('.place-row').filter({ has: page.getByRole('heading', { name: 'Sample favourite café' }) });
      await expect(named).toContainText('42 Sample High Street');
      await expect(page.getByRole('heading', { name: 'Your places on the map' })).toBeVisible();
      await named.getByRole('button', { name: 'View on map & edit →' }).click();
      await expect(page.getByRole('region', { name: 'Edit Sample favourite café' })).toBeVisible();
      await page.screenshot({ path: `${output}/places-mobile-editor.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'place editor fits mobile');
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByLabel('Find a place').fill('');
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.screenshot({ path: `${output}/places-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${output}/places-mobile.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'places fits mobile');
      await page.getByLabel('Find a place').fill('no such synthetic place');
      await expect(page.getByText('No places match this filter.', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Add place', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Add a familiar place' })).toBeVisible();
      await page.goto(`${base}/home/people`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Expected arrivals' })).toBeVisible();
      await expect(page.locator('.home-lede')).toHaveCSS('background-color', 'rgb(26, 16, 8)');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${output}/overview-mobile.png`, fullPage: true });
      const saved = (await client.query('select label,suggested_address from daydream_places where id=$1', [coffee])).rows[0];
      assert.equal(saved.label, 'Sample favourite café'); assert.ok(saved.suggested_address.includes('42 Sample High Street'));
      assert.deepEqual(errors, []);
      await writeFile(`${output}/browser-check.json`, JSON.stringify({ base, checkedAt: new Date().toISOString(), checks: ['school ETA', 'directional route averages', 'morning routine', 'shared time', 'person filter', 'quick naming persists', 'address preserved', 'editor and manual add', 'empty search', 'mobile overflow', 'overview navigation'], errors }, null, 2));
      console.log('People insights desktop/mobile browser checks passed.');
    } finally { await browser.close(); }
  }
} finally { await client.end(); }
