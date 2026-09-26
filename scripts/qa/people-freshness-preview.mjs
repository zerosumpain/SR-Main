/** Synthetic household on the isolated LAN preview; never connects to a phone. */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';

const base = 'http://192.168.0.77:15432';
const screenshots = '/home/john/site-tech-debt-review-2026-09-26/people-freshness-screenshots';
const db = new pg.Client({ connectionString: 'postgresql://workflows_jkai_local:workflows_jkai_local_only@127.0.0.1:15445/workflows_jkai_local' });
await db.connect();
await mkdir(screenshots, { recursive: true });
const samples = [
  ['sample-alex', 'companion'], ['sample-sam', 'life360'],
  ['sample-robin', 'companion'], ['sample-casey', 'life360'],
];
const email = (subject) => `${subject}@people-preview.example.test`;
const browser = await chromium.launch({ headless: true });
try {
  await db.query('begin');
  for (const [subject, source] of samples) {
    await db.query(`insert into household_member (subject, display_name, email, source, ha_person_entity)
      values ($1, $1, $2, $3, $4) on conflict (subject) do nothing`, [subject, email(subject), source, `person.${subject}`]);
  }
  const old = (await db.query("select value from app_settings where key='home.presence.companionUsers'")).rows[0]?.value ?? [];
  const users = [...old.filter(u => !u.email.endsWith('@people-preview.example.test')),
    { email: email('sample-alex'), name: 'Sample Alex', sharing: true },
    { email: email('sample-robin'), name: 'Sample Robin', sharing: false }];
  await db.query(`insert into app_settings (key,value) values ('home.presence.companionUsers',$1)
    on conflict (key) do update set value=excluded.value`, [JSON.stringify(users)]);
  await db.query(`insert into app_settings (key,value) values ('home.presence.membersSeeded','true') on conflict do nothing`);
  await db.query('delete from daydream_trail where subject=any($1)', [samples.map(s => s[0])]);
  for (const subject of ['sample-alex', 'sample-robin', 'sample-sam']) {
    await db.query(`insert into daydream_trail (subject, source, ts, lat, lon, is_home, battery_pct)
      values ($1, $2, now() - $3::interval, 51.5, -0.12, true, 80)`,
    [subject, subject === 'sample-sam' ? 'poll' : 'companion', subject === 'sample-sam' ? '1 minute' : '3 hours']);
  }
  const actionIds = {};
  for (const [name, cadence] of [['household-live', 30], ['daydream-observe', 120]]) {
    await db.query(`insert into heartbeat_actions (id,name,description,cadence_seconds,status,source)
      values ($1,$2,'Synthetic people freshness preview; no live source',$3,'paused','manual') on conflict (name) do nothing`,
    [`qa-people-${name}`, name, cadence]);
    actionIds[name] = (await db.query('select id from heartbeat_actions where name=$1', [name])).rows[0].id;
  }
  const pulse = async (name, details, age = '0 seconds') => db.query(`insert into heartbeat_pulses (action_id,ts,outcome,summary,details)
    values ($1,now()-$2::interval,'ok','Synthetic people freshness preview',$3)`, [actionIds[name], age, JSON.stringify(details)]);
  await pulse('household-live', { companion: { pages: 1, written: 0, more: false } }, '20 seconds');
  await pulse('daydream-observe', { 'sample-sam': { trailId: 1 } });
  await db.query('commit');

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60_000);
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/home/people`, { waitUntil: 'domcontentloaded' });
  const alex = page.locator('.rg-cell').filter({ has: page.locator('.rg-label', { hasText: 'Sample-alex' }) });
  const robin = page.locator('.rg-cell').filter({ has: page.locator('.rg-label', { hasText: 'Sample-robin' }) });
  const casey = page.locator('.rg-cell').filter({ has: page.locator('.rg-label', { hasText: 'Sample-casey' }) });
  await expect(alex.locator('.rg-value')).toHaveText('last known');
  await expect(alex.locator('.rg-sub')).toContainText('Last at home · location 3h ago');
  await expect(alex.locator('.rg-detail')).toContainText('App feed checked');
  await expect(robin.locator('.rg-value')).toHaveText('off');
  await expect(robin.locator('.rg-detail')).toHaveCount(0);
  await expect(casey.locator('.rg-value')).toHaveText('no location');
  await expect(casey.locator('.rg-detail')).toHaveText('HA feed check unavailable');
  // Map pins only render after mount: SSR alone cannot satisfy this check.
  await expect(page.locator('.circle-map .dot').first()).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.screenshot({ path: `${screenshots}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${screenshots}/phone.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
  const detail = await alex.locator('.rg-detail').boundingBox();
  const box = await alex.boundingBox();
  assert.ok(detail.y + detail.height <= box.y + box.height, 'check time stays inside the mobile card');
  await alex.focus();
  assert.ok(await alex.evaluate(el => getComputedStyle(el).outlineStyle !== 'none'), 'keyboard focus remains visible');

  // A real new source check appears automatically without changing the old
  // location. The source read below simulates a completed empty app poll.
  await pulse('household-live', { companion: { pages: 1, written: 0, more: false } });
  let refreshes = 0;
  page.on('request', request => { if (request.url().includes('/home/people/__data.json')) refreshes++; });
  await expect.poll(() => refreshes, { timeout: 40_000 }).toBeGreaterThan(0);
  await expect(alex.locator('.rg-sub')).toContainText('location 3h ago');
  await expect(alex.locator('.rg-value')).toHaveText('last known');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);

  // Failed source checks leave the last successful timestamp untouched.
  const before = await alex.locator('.rg-detail').innerText();
  await pulse('household-live', { companion: { pages: 1, more: false, error: 'Synthetic failure' } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(alex.locator('.rg-detail')).not.toHaveText('App feed checked just now');
  await expect(alex.locator('.rg-value')).toHaveText('last known');
  assert.ok(before.startsWith('App feed checked '));
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log(`PASS: separate location/check times, automatic refresh, failed checks, sharing off, missing location, keyboard focus, desktop and mobile. Synthetic preview retained: ${base}/home/people`);
} finally {
  await browser.close();
  await db.end();
}
