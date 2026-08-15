#!/usr/bin/env node
// verify-chat-tabs.mjs — manual verification for /jkai conversation tabs.
//
// NOT a CI gate. It drives a real browser against a running dev server and sends
// real messages, so it costs a few pence of tokens per run. It exists because the
// claim being made cannot be checked by reading code: "two threads run at once
// and neither one's reply lands in the other's transcript" is only demonstrable
// by sending into one tab, switching away while it works, sending into a second,
// and reading both transcripts back. The chat's older one-message-behind bug was
// diagnosed the same way — never by reasoning (see the turn-desync notes).
//
// Run:  npx vite dev --port 5188
//       node scripts/verify-chat-tabs.mjs
//       BASE=http://localhost:5173 node scripts/verify-chat-tabs.mjs
//       node scripts/verify-chat-tabs.mjs overlap     (one section)
//
// Sections: overlap · limits · reattach · typeahead · viewports
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5188';
const SHOTS = process.env.SHOTS ?? '/tmp/jkai-tab-shots';
const STRIP = '[role="tablist"][aria-label="Open conversations"]';

const wanted = process.argv.slice(2);
const runs = (name) => wanted.length === 0 || wanted.includes(name);

mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log(...a);
const failures = [];
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const paneFor = (page) => page.locator('.pane.on-screen');
const tabsOf = (page) =>
  page.locator(`${STRIP} [role="tab"]`).evaluateAll((els) =>
    els.map((el) => ({
      label: el.querySelector('.tab-label')?.textContent?.trim() ?? '',
      selected: el.getAttribute('aria-selected') === 'true',
      activity: el.querySelector('.dot')?.getAttribute('data-activity') ?? '?',
    })),
  );
const transcript = (page) =>
  paneFor(page)
    .locator('.msg-slot')
    .evaluateAll((els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));

async function send(page, text) {
  const pane = paneFor(page);
  const box = pane.locator('textarea.composer-textarea');
  await box.waitFor({ state: 'visible', timeout: 20_000 });
  await box.fill(text);
  await pane.locator('button[aria-label="Send"]').click();
}

/** `networkidle` never fires here — the page holds SSE connections open. */
async function openChat(page, query = '?new=1') {
  await page.goto(`${BASE}/jkai${query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.locator(`${STRIP} [role="tab"]`).first().waitFor({ timeout: 60_000 });
  await paneFor(page).locator('textarea.composer-textarea').waitFor({ timeout: 30_000 });
}

const activeJobs = (page) =>
  page.evaluate(async () => {
    const r = await fetch('/api/workflows/orchestrator/chat/active');
    return r.ok ? (await r.json()).jobs : [];
  });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => log(`  [page error] ${String(e).slice(0, 240)}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) log(`  [console] ${m.text().slice(0, 200)}`);
});

// ---------------------------------------------------------------- overlap ----
if (runs('overlap')) {
  log('\n=== overlap: two threads at once, no cross-talk ===');
  await openChat(page);
  let tabs = await tabsOf(page);
  check('a fresh visit opens exactly one tab', tabs.length === 1, JSON.stringify(tabs));

  await page.locator('button[aria-label="New conversation tab"]').click();
  await page.locator(`${STRIP} [role="tab"]`).nth(1).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  tabs = await tabsOf(page);
  check('the + cell opens a second tab and puts it on screen', tabs.length === 2 && tabs[1].selected);
  check('exactly one pane is on screen', (await page.locator('.pane.on-screen').count()) === 1);
  check('both panes stay mounted', (await page.locator('.pane').count()) === 2);

  await send(page, 'Reply with exactly the word BRAVO and nothing else.');
  await page.waitForTimeout(1200);

  const tabList = page.locator(`${STRIP} [role="tab"]`);
  await tabList.nth(0).click();
  await page.waitForTimeout(600);
  tabs = await tabsOf(page);
  check('switching away leaves the first thread running', tabs[1].activity === 'running',
    JSON.stringify(tabs));

  await send(page, 'Reply with exactly the word ALPHA and nothing else.');
  await page.waitForTimeout(1000);
  tabs = await tabsOf(page);
  check('both tabs report running at the same time',
    tabs[0].activity === 'running' && tabs[1].activity === 'running', JSON.stringify(tabs));
  await page.screenshot({ path: `${SHOTS}/both-running-1440.png` });

  const deadline = Date.now() + 180_000;
  let settled = [];
  while (Date.now() < deadline) {
    settled = await tabsOf(page);
    if (settled.every((t) => t.activity !== 'running')) break;
    await page.waitForTimeout(3000);
  }
  check('both turns finished', settled.every((t) => t.activity !== 'running'), JSON.stringify(settled));
  check('the background tab is badged as having replied',
    settled[1]?.activity === 'reply', `tab2=${settled[1]?.activity}`);

  const t1 = (await transcript(page)).join(' | ');
  check('tab 1 carries its own question', t1.includes('ALPHA'));
  check("tab 1 did NOT receive tab 2's answer", !t1.includes('BRAVO'),
    'a BRAVO reply in the ALPHA thread is the cross-talk bug');

  await tabList.nth(1).click();
  await page.waitForTimeout(800);
  const t2 = (await transcript(page)).join(' | ');
  check('tab 2 carries its own question', t2.includes('BRAVO'));
  check("tab 2 did NOT receive tab 1's answer", !t2.includes('ALPHA'),
    'an ALPHA reply in the BRAVO thread is the cross-talk bug');

  tabs = await tabsOf(page);
  check('looking at the replied tab clears its badge', tabs[1].activity === 'idle', JSON.stringify(tabs));

  await paneFor(page).locator('textarea.composer-textarea').fill('a half-typed thought');
  await tabList.nth(0).click();
  await page.waitForTimeout(400);
  await tabList.nth(1).click();
  await page.waitForTimeout(400);
  check('a half-typed message survives switching away and back',
    (await paneFor(page).locator('textarea.composer-textarea').inputValue()) === 'a half-typed thought');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.locator(`${STRIP} [role="tab"]`).first().waitFor({ timeout: 60_000 });
  await paneFor(page).locator('textarea.composer-textarea').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  tabs = await tabsOf(page);
  check('the working set is restored after a reload', tabs.length === 2, JSON.stringify(tabs));
  check('the restored tab still has its history', (await transcript(page)).length > 0);

  await page.locator(`${STRIP} .cell-close`).nth(0).click();
  await page.waitForTimeout(600);
  tabs = await tabsOf(page);
  check('closing a tab removes it and keeps one on screen', tabs.length === 1 && tabs[0].selected);
  check('only the surviving pane is mounted', (await page.locator('.pane').count()) === 1);
}

// ----------------------------------------------------------------- limits ----
if (runs('limits')) {
  log('\n=== limits and keyboard ===');
  await openChat(page);
  const plus = page.locator('button[aria-label="New conversation tab"]');
  for (let i = 0; i < 4; i++) {
    await plus.click();
    await page.locator(`${STRIP} [role="tab"]`).nth(i + 1).waitFor({ timeout: 30_000 });
  }
  let tabs = await tabsOf(page);
  check('five tabs open', tabs.length === 5, `${tabs.length}`);
  check('the + cell disables itself at the limit', await plus.isDisabled());

  // A full strip must not squeeze the tab you are looking at, and `+` must stay
  // reachable — both were broken when the notice shared the cells' row.
  const currentCell = await page.locator(`${STRIP} .cell.current`).boundingBox();
  check('the current tab keeps a readable width at the limit',
    currentCell !== null && currentCell.width > 90, JSON.stringify(currentCell));
  check('the + cell stays in view at the limit', await plus.isVisible());

  await page.locator('.thread-row').nth(6).click();
  await page.waitForTimeout(800);
  check('a rail click cannot exceed the limit', (await tabsOf(page)).length === 5);
  check('the refusal is stated, not silent',
    await page.locator(`${STRIP} .limit`).isVisible().catch(() => false));
  await page.screenshot({ path: `${SHOTS}/limit-hit-1440.png` });

  const tabList = page.locator(`${STRIP} [role="tab"]`);
  await tabList.nth(0).click();
  await page.waitForTimeout(300);
  // Alt+Shift+arrow, because browsers reserve ⌘1–⌘4 and Ctrl+Tab, and GNOME
  // takes Ctrl+Alt+arrow for workspaces.
  await page.keyboard.press('Alt+Shift+ArrowRight');
  await page.waitForTimeout(300);
  check('Alt+Shift+→ moves to the next tab', (await tabsOf(page))[1].selected);
  await page.keyboard.press('Alt+Shift+ArrowLeft');
  await page.waitForTimeout(300);
  check('Alt+Shift+← moves back', (await tabsOf(page))[0].selected);

  check("the layout's floating palette button stays stood down",
    (await page.locator('.launcher-fab').count()) === 0);
}

// --------------------------------------------------------------- reattach ----
if (runs('reattach')) {
  log('\n=== closing a working tab leaves the job running ===');
  await openChat(page);
  await send(page, 'Write a 400-word description of a Victorian railway station. Take your time.');
  await page.waitForTimeout(3000);
  check('the thread is working', (await tabsOf(page))[0].activity === 'running');

  const jobs = await activeJobs(page);
  if (jobs.length === 0) {
    check('the turn was still running when the tab closed', false,
      'it finished first — rerun, or ask for something longer');
  } else {
    const convId = jobs[0].conversationId;
    await page.locator(`${STRIP} .cell-close`).nth(0).click();
    await page.waitForTimeout(1000);
    check('closing the tab does not cancel the job', (await activeJobs(page)).length > 0);

    await openChat(page, `?c=${convId}`);
    await page.waitForTimeout(4000);
    const stillRunning = (await activeJobs(page)).length > 0;
    const tabs = await tabsOf(page);
    if (!stillRunning) {
      log('SKIP  reattach — the job finished before the page reopened');
    } else {
      check('reopening re-attaches the pane to the running job',
        tabs.some((t) => t.activity === 'running'), JSON.stringify(tabs));
    }
  }
}

// -------------------------------------------------------------- typeahead ----
// Typing a follow-up while a reply is still streaming.
//
// The composer used to be `disabled={loading}`, so a second message simply could
// not be sent and the gateway's queue/interrupt setting was unreachable from the
// UI. Follow-ups are now held client-side and sent when the current turn closes,
// which also means the gateway never sees an overlap from the composer — the one
// it drops on the floor in `busy_input_mode: queue`.
if (runs('typeahead')) {
  log('\n=== typeahead: a follow-up typed mid-reply ===');
  await openChat(page);
  const box = paneFor(page).locator('textarea.composer-textarea');

  await send(page, 'Count from 1 to 60, one number per line, nothing else.');
  await page.waitForTimeout(2500);

  check('the composer stays usable while a reply streams', !(await box.isDisabled()));

  await box.fill('Afterwards, reply with exactly the word DELTA.');
  await paneFor(page).locator('button[aria-label="Send"]').click();
  await page.waitForTimeout(600);

  const queued = paneFor(page).locator('.queued-strip .queued-text');
  check('the follow-up is held and shown as queued', (await queued.count()) === 1,
    `${await queued.count()} queued rows`);
  check('the composer is cleared ready for the next one', (await box.inputValue()) === '');

  // It must be sent once the current turn finishes, and not before.
  const deadline = Date.now() + 240_000;
  let cleared = false;
  while (Date.now() < deadline) {
    if ((await queued.count()) === 0) { cleared = true; break; }
    await page.waitForTimeout(2000);
  }
  check('the queued follow-up is sent once the reply finishes', cleared);

  // Both answers, each under its own question.
  const settleBy = Date.now() + 240_000;
  let text = '';
  while (Date.now() < settleBy) {
    text = (await transcript(page)).join(' | ');
    if (/DELTA/.test(text)) break;
    await page.waitForTimeout(3000);
  }
  check('the first message keeps its own answer', /\b1\b[\s\S]*\b60\b/.test(text),
    'the count should still be there in full');
  check('the follow-up gets its own answer', /DELTA/.test(text));

  await page.screenshot({ path: `${SHOTS}/typeahead.png` });
}

// -------------------------------------------------------------- viewports ----
if (runs('viewports')) {
  log('\n=== viewports ===');
  await openChat(page);
  await page.locator('button[aria-label="New conversation tab"]').click();
  await page.locator(`${STRIP} [role="tab"]`).nth(1).waitFor({ timeout: 30_000 });
  for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/vp-${w}.png` });
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check(`no sideways page scroll at ${w}px`, scrollW <= w, `scrollWidth=${scrollW}`);
    const strip = await page.locator(STRIP).boundingBox();
    check(`the strip fits at ${w}px`, strip !== null && strip.width <= w, JSON.stringify(strip));
  }
}

await browser.close();
log(`\nshots in ${SHOTS}`);
log(failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED: ${failures.join('; ')}`);
process.exit(failures.length === 0 ? 0 : 1);
