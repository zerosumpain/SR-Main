/** Synthetic local acceptance for the red-team double-check (2026-10-02).
 *  Needs `daydream/redteam-seed.sql` applied to the isolated preview database. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = process.env.DAYDREAM_PREVIEW_URL ?? 'http://127.0.0.1:15440';
const output = process.env.DAYDREAM_EVIDENCE_DIR ?? '/tmp/daydream-redteam-preview';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Only the isolated loopback preview is supported');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 }, reducedMotion: 'reduce' });
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Double-check the PayPal note: the re-read now shows the reconciled ledger.
  await page.goto(`${base}/jkai/daydreams?note=uiseed-redteam-paypal`, { waitUntil: 'domcontentloaded' });
  const pp = page.locator('#note-uiseed-redteam-paypal');
  await expect(pp).toBeVisible();
  await pp.getByRole('button', { name: /^Double-check it/ }).click();
  await expect(page).toHaveURL(/commission=/);
  const panel = pp.locator('.signoff');
  await expect(panel.getByText('Then argue against the note')).toBeVisible();
  await page.screenshot({ path: `${output}/1-proposal.png` });
  await panel.getByRole('button', { name: 'Approve and run', exact: true }).click();
  await expect.poll(async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    return page.locator('#note-uiseed-redteam-paypal .signoff .result').count();
  }, { timeout: 120_000, intervals: [2000, 3000, 5000] }).toBeGreaterThan(0);
  const result = page.locator('#note-uiseed-redteam-paypal .signoff .result');
  await result.locator('details').first().evaluate((d) => (d.open = true));
  const ledger = await result.locator('pre').first().innerText();
  console.log('--- re-read spend text ---\n' + ledger);
  assert.match(ledger, /\[bank→PayPal top-up\] — funds 4 PayPal payments/);
  assert.match(ledger, /Funded by the bank top-up on 2026-09-08/);
  console.log('--- report summary ---\n' + (await result.innerText()).split('\n').slice(0, 3).join('\n'));
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/2-report.png` });

  // 2. Tell the Apple note it is wrong, and why.
  await page.goto(`${base}/jkai/daydreams?note=uiseed-redteam-apple`, { waitUntil: 'domcontentloaded' });
  const apple = page.locator('#note-uiseed-redteam-apple');
  await apple.getByRole('button', { name: 'More', exact: true }).click();
  await apple.getByRole('menuitem', { name: /It's wrong/ }).click();
  await apple.locator('textarea').fill('One of those is the Apple receipt email for the bank charge, not a second charge. The bank statement is the truth.');
  await apple.getByRole('button', { name: /Tell it it’s wrong/ }).click();
  await expect(apple.getByText('You said this is wrong')).toBeVisible();
  await expect(apple.getByText(/Lesson kept: “One of those is the Apple receipt/)).toBeVisible();
  await apple.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/3-owner-wrong.png` });

  // 3. Phone width: nothing overflows.
  await page.setViewportSize({ width: 390, height: 844 });
  await apple.scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => {
    const el = document.querySelector('.jkai-body');
    return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, el ? el.scrollWidth - el.clientWidth : 0);
  });
  assert.ok(overflow <= 0, `mobile overflow ${overflow}px`);
  await page.screenshot({ path: `${output}/4-owner-wrong-mobile.png` });
  // 4. "Do it for me": the bike note says exactly what it will add.
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto(`${base}/jkai/daydreams?note=uiseed-redteam-bike`, { waitUntil: 'domcontentloaded' });
  const bike = page.locator('#note-uiseed-redteam-bike');
  const doit = bike.getByRole('button', { name: /Do it for me/ });
  await expect(doit).toBeVisible();
  await expect(doit).toContainText('Add “Chase the bike dispatch” to your diary on Sat 10 Oct');
  await bike.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/5-do-it.png` });
  // The preview holds no iCloud credential: the tap must end in a plain
  // message, never a silent failure or a pretend success.
  await doit.click();
  await expect(bike.locator('.act-msg, select')).toBeVisible({ timeout: 30_000 });
  console.log('--- do it (no calendar locally) ---\n' + (await bike.locator('.act-msg').innerText().catch(() => 'calendar chooser shown')));
  await page.screenshot({ path: `${output}/6-do-it-local.png` });

  // 5. A step already done shows it, with Undo.
  await page.goto(`${base}/jkai/daydreams?note=uiseed-redteam-mot`, { waitUntil: 'domcontentloaded' });
  const mot = page.locator('#note-uiseed-redteam-mot');
  await expect(mot.locator('.did')).toContainText('Added “Book the MOT” to your Home calendar');
  await expect(mot.getByRole('button', { name: 'Undo' })).toBeVisible();
  await mot.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/7-done.png` });

  // 6. A reminder that is set, with Undo until it fires.
  await page.goto(`${base}/jkai/daydreams?note=uiseed-redteam-remind`, { waitUntil: 'domcontentloaded' });
  const remind = page.locator('#note-uiseed-redteam-remind');
  await expect(remind.locator('.did')).toContainText('It will remind you on Thu 8 Oct, 09:00');
  await expect(remind.getByRole('button', { name: 'Undo' })).toBeVisible();

  // 7. A diary move, offered with exactly what it will do.
  await page.goto(`${base}/jkai/daydreams?note=uiseed-redteam-move`, { waitUntil: 'domcontentloaded' });
  const move = page.locator('#note-uiseed-redteam-move');
  await expect(move.getByRole('button', { name: /Do it for me/ })).toContainText('Move “Dentist” from Wed 14 Oct to Fri 16 Oct');

  // 8. A drafted email: read it on the card; Send is a second tap.
  await page.goto(`${base}/jkai/daydreams?note=uiseed-redteam-draft`, { waitUntil: 'domcontentloaded' });
  const draft = page.locator('#note-uiseed-redteam-draft');
  await expect(draft.locator('.draft-view')).toContainText('orders@bikeshop.example');
  await expect(draft.locator('.draft-body')).toContainText('Could you let me know when it will ship?');
  await expect(draft.getByRole('button', { name: 'Send it' })).toBeVisible();
  await expect(draft.getByRole('link', { name: 'Edit in Gmail' })).toHaveAttribute('href', /compose=m-synthetic/);
  await draft.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/8-draft.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await draft.scrollIntoViewIfNeeded();
  const overflow2 = await page.evaluate(() => {
    const el = document.querySelector('.jkai-body');
    return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, el ? el.scrollWidth - el.clientWidth : 0);
  });
  assert.ok(overflow2 <= 0, `mobile overflow on the draft ${overflow2}px`);
  await page.screenshot({ path: `${output}/9-draft-mobile.png` });

  assert.deepEqual(errors, [], 'no page errors');
  console.log('OK');
} finally {
  await browser.close();
}
