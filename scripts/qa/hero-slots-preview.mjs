import { chromium } from 'playwright';
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const base = 'http://192.168.0.77:5275';
const slots = ['default', 'weekday-inactive', 'weekday-average', 'weekday-very-active', 'weekend-inactive', 'weekend-average', 'weekend-very-active'];
const labels = ['Default', 'Weekday · Inactive', 'Weekday · Averagely active', 'Weekday · Very active', 'Weekend · Inactive', 'Weekend · Averagely active', 'Weekend · Very active'];
const slotKey = slot => slot === 'default' ? 'landing.hero.selected' : `landing.hero.slot.${slot}`;
const keys = [...slots.map(slotKey), 'landing.hero.preparation', 'landing.hero.activity'];
const db = new pg.Client({ connectionString: 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local' });
await db.connect();
const previous = (await db.query('select key,value from app_settings where key=any($1)', [keys])).rows;
const priorAssets = new Set((await db.query("select key from app_settings where key like 'landing.hero.prepared.%'")).rows.map(r => r.key));
const work = await mkdtemp(join(tmpdir(), 'sr-hero-slots-'));
const browser = await chromium.launch({ headless: true });
const files = [];
let stepId;
let context;
try {
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const colour of ['blue', 'orange']) {
    const path = join(work, colour + '.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=${colour}:size=640x360:rate=24:duration=1`, '-c:v', 'libx264', path]);
    const r = await context.request.post(base + '/api/files/upload', { multipart: { name: `siteherobackground/Synthetic ${colour} slot.mp4`, file: { name: colour + '.mp4', mimeType: 'video/mp4', buffer: await readFile(path) } } });
    assert.equal(r.status(), 200);
    files.push((await r.json()).file.id);
  }
  await page.goto(base + '/admin/content/hero', { waitUntil: 'networkidle', timeout: 120000 });
  const section = page.getByRole('region', { name: 'Background video', exact: true });
  const select = section.getByLabel('MP4 from siteherobackground', { exact: true });
  const assigned = {};
  for (let i = 0; i < slots.length; i++) {
    await section.getByRole('button', { name: labels[i], exact: true }).click();
    await select.selectOption(files[i % 2]);
    await section.getByRole('button', { name: 'Prepare & apply', exact: true }).click();
    await section.getByRole('status').filter({ hasText: `${labels[i]} updated.` }).waitFor({ timeout: 120000 });
    assigned[slots[i]] = (await db.query('select value from app_settings where key=$1', [slotKey(slots[i])])).rows[0].value;
    assert.equal(assigned[slots[i]].sourceId, files[i % 2]);
    for (let j = 0; j < i; j++) {
      assert.equal((await db.query('select value from app_settings where key=$1', [slotKey(slots[j])])).rows[0].value.asset.desktop, assigned[slots[j]].asset.desktop);
    }
  }
  const badSlot = await context.request.post(base + '/admin/content/hero/background', { data: { sourceId: files[0], slot: 'invalid-slot' } });
  assert.equal(badSlot.status(), 400);
  await page.reload({ waitUntil: 'networkidle' });
  for (let i = 0; i < slots.length; i++) {
    await section.getByRole('button', { name: labels[i], exact: true }).click();
    assert.equal(await select.inputValue(), files[i % 2]);
  }
  await page.screenshot({ path: '/tmp/sr-hero-slots-wide.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await section.getByRole('button', { name: 'Default', exact: true }).focus();
  await section.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '/tmp/sr-hero-slots-narrow.png' });

  const rules = page.getByRole('region', { name: 'Activity rules', exact: true });
  const baseline = Number((await db.query("select coalesce(sum(round(value/100.0)),0) as steps from apple_health_metrics where metric_name='step_count' and date >= extract(epoch from (date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London')) and date <= extract(epoch from now()) and value>=0")).rows[0].steps);
  assert(baseline < 80000, 'Local step fixtures are too large for this test');
  const average = baseline + 3000, very = baseline + 10000;
  await rules.locator('[name=averageSteps]').fill(String(average));
  await rules.locator('[name=veryActiveSteps]').fill(String(very));
  await rules.getByRole('button', { name: 'Save activity rules' }).click();
  await rules.getByRole('status').waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await rules.locator('[name=averageSteps]').inputValue(), String(average));
  const stamp = Math.floor(Date.now() / 1000) - 1;
  const inserted = await db.query("insert into apple_health_metrics(metric_name,date,date_local,value,units) values('step_count',$1,$2,0,'count') returning id", [stamp, 'Synthetic hero slot test']);
  stepId = inserted.rows[0].id;
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(new Date());
  const period = ['Sat', 'Sun'].includes(day) ? 'weekend' : 'weekday';
  async function checkHome(expected) {
    const home = await context.newPage();
    await home.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const video = home.locator('.hero-copy video');
    await video.waitFor();
    await home.waitForFunction(src => document.querySelector('.hero-copy video')?.getAttribute('src') === src, expected, { timeout: 30000 });
    await home.close();
  }
  for (const [increment, level] of [[0, 'inactive'], [3000, 'average'], [10000, 'very-active']]) {
    await db.query('update apple_health_metrics set value=$1 where id=$2', [increment * 100, stepId]);
    await checkHome(assigned[`${period}-${level}`].asset.desktop);
  }
  const match = `${period}-very-active`;
  await page.reload({ waitUntil: 'networkidle' });
  await section.getByRole('button', { name: labels[slots.indexOf(match)], exact: true }).click();
  await select.selectOption('');
  await section.getByRole('button', { name: 'Use Default', exact: true }).click();
  await section.getByRole('status').filter({ hasText: 'now uses Default' }).waitFor();
  await checkHome(assigned.default.asset.desktop);
  assert.equal((await db.query('select key from app_settings where key=any($1)', [slots.map(slotKey)])).rowCount, 6);
  const invalid = await context.request.post(base + '/admin/content/hero?/activity', { form: { averageSteps: '100', veryActiveSteps: '50' }, headers: { origin: base, 'x-sveltekit-action': 'true' } });
  assert((await invalid.text()).includes('Very active must start above'));
  assert.deepEqual(errors, []);
  console.log('PASS: seven independent assignments; persistent slot choices; per-slot conversion; invalid slot rejection; saved thresholds; real step-based homepage selection; empty-slot default fallback; desktop/mobile controls.');
} finally {
  const prepared = (await db.query("select key,value from app_settings where key like 'landing.hero.prepared.%'")).rows.filter(r => !priorAssets.has(r.key));
  const derivatives = prepared.flatMap(r => Object.values(r.value.paths));
  const sources = (await db.query('select disk_path from workflow_files where id=any($1)', [files])).rows;
  await db.query('delete from workflow_files where id=any($1) or disk_path=any($2)', [files, derivatives]);
  await db.query('delete from app_settings where key=any($1)', [[...keys, ...prepared.map(r => r.key)]]);
  for (const row of previous) await db.query('insert into app_settings(key,value) values($1,$2)', [row.key, row.value]);
  if (stepId) await db.query('delete from apple_health_metrics where id=$1', [stepId]);
  const paths = [...sources.map(r => r.disk_path), ...derivatives];
  if (paths.length) execFileSync('docker', ['exec', 'porkserv-local-jkai-1', 'node', '-e', "const fs=require('fs');for(const path of process.argv.slice(1)){try{fs.unlinkSync(path)}catch{}}", ...paths]);
  await browser.close(); await db.end(); await rm(work, { recursive: true, force: true });
}
