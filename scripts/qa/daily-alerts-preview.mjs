import { chromium } from 'playwright';
import { encode } from '@auth/core/jwt';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
const base = 'http://192.168.0.77:5275';
const db = new pg.Client({ connectionString: 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local' });
await db.connect();
const noteId = randomUUID();
const conversationId = randomUUID();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const token = await encode({ secret: 'jkai-preview-local-only', salt: 'authjs.session-token', token: { email: 'preview@example.test', name: 'Local preview', sub: 'local-preview' } });
await page.context().addCookies([{ name: 'authjs.session-token', value: token, url: base }]);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await db.query('insert into jkai_conversations (id, title) values ($1, $2)', [conversationId, 'Synthetic daily alerts welcome preview']);
  await db.query('insert into intel_notes (id, raw_content, source) values ($1, $2, $3)', [noteId, 'Synthetic daily alerts preview', 'test']);
  for (let i = 0; i < 7; i++) {
    await db.query('insert into intel_alerts (note_id, type, title, content, significance) values ($1, $2, $3, $4, $5)', [noteId, 'connection', `Synthetic preview alert ${i}: a longer title to check wrapping on a phone`, 'Synthetic evidence for local preview only.', i === 0 ? 'high' : i < 4 ? 'medium' : 'low']);
  }
  await page.goto(base + '/jkai?c=' + conversationId, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('heading', { name: 'What are we making today?' }).waitFor();
  const region = page.locator('.hero').getByRole('region', { name: 'Daily alerts', exact: true });
  if (await page.getByRole('region', { name: 'Daily alerts', exact: true }).count() !== 1) throw new Error('Duplicate alerts panel');
  await region.getByText(/7 undismissed alerts/).waitFor();
  if (await page.getByText('Pick up where you left off').count()) throw new Error('Recent thread section remains');
  const libraryButton = page.locator('.hero').getByRole('button', { name: '05 Library' });
  await libraryButton.click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Close thread library', exact: true }).last().click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  if (await region.locator('li').count() !== 6) throw new Error('Expected six preview alerts');
  await page.locator('.msg-list').evaluate(el => { el.scrollTop = 0; });
  const fits = await region.locator('li').evaluateAll(rows => {
    const panel = rows[0].closest('.msg-list').getBoundingClientRect();
    return rows.every(row => { const box = row.getBoundingClientRect(); return box.top >= panel.top && box.bottom <= panel.bottom; });
  });
  if (!fits) throw new Error('Six full alerts must fit above the composer on desktop');
  if (await region.locator('.priority').count() !== 6) throw new Error('Missing alert priorities');
  await page.screenshot({ path: '/tmp/jkai-daily-alerts-wide.png' , fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await libraryButton.scrollIntoViewIfNeeded();
  await libraryButton.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Close thread library', exact: true }).last().click();
  await page.locator('.msg-list').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: '/tmp/jkai-daily-alerts-narrow.png', fullPage: true, animations: 'disabled' });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Viewport overflow');
  // Exercise cancellation, failed saves, and persisted reasons through the real API.
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    const row = region.locator('li').first();
    const title = await row.locator('strong').innerText();
    await row.getByRole('button', { name: `Dismiss ${title}`, exact: true }).click();
    const input = row.getByLabel('Reason for dismissal (optional)');
    await input.fill('Read and already resolved.');
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (await row.locator('textarea').count()) throw new Error('Cancel did not close the form');
    await row.getByRole('button', { name: `Dismiss ${title}`, exact: true }).focus();
    await page.keyboard.press('Enter');
    await input.fill('Read and already resolved.');
    await page.route('**/api/jkai/intel/alerts/*', route => route.fulfill({ status: 500, body: '{}' }));
    await row.getByRole('button', { name: 'Dismiss alert', exact: true }).click();
    await row.getByRole('alert').waitFor();
    if (await input.inputValue() !== 'Read and already resolved.') throw new Error('Failed save lost reason');
    await page.screenshot({ path: `/tmp/jkai-dismiss-${width}.png`, fullPage: true });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Dismiss form overflows viewport');
    await page.unroute('**/api/jkai/intel/alerts/*');
    await row.getByRole('button', { name: 'Dismiss alert', exact: true }).click();
    await region.getByText('Alert dismissed.', { exact: true }).waitFor();
    const saved = await db.query('select dismissed, dismissed_reason from intel_alerts where note_id = $1 and title = $2', [noteId, title]);
    if (!saved.rows[0]?.dismissed || saved.rows[0]?.dismissed_reason !== 'Read and already resolved.') throw new Error('Dismissal and reason not persisted');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await region.getByText(width === 1366 ? /6 undismissed alerts/ : /5 undismissed alerts/).waitFor();
    if (await region.getByText(title, { exact: true }).count()) throw new Error('Dismissed alert returned after reload');
    if (width === 1366 && await region.locator('li').count() !== 6) throw new Error('Summary did not refill preview');
  }
  await region.getByRole('link', { name: 'Daily alerts', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL('**/jkai/intel/alerts');
  await db.query('delete from intel_notes where id = $1', [noteId]);
  await page.goto(base + '/jkai?c=' + conversationId, { waitUntil: 'domcontentloaded' });
  await page.getByText('No undismissed alerts in the last 24 hours.').waitFor();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: populated/empty summary, ranked preview, desktop/mobile, overflow, keyboard navigation, cancellation, failed save recovery and persisted dismissal reasons');
} finally {
  await db.query('delete from intel_notes where id = $1', [noteId]);
  await db.query('delete from jkai_conversations where id = $1', [conversationId]);
  await db.end();
  await browser.close();
}
