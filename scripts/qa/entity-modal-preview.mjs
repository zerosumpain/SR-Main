import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Browser-only synthetic responses: no graph writes, model calls or production data.
const base = process.env.ENTITY_PREVIEW_URL || 'http://192.168.0.77:5275';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const name = 'Synthetic North Atlantic Research Organisation with a long entity name';
const now = new Date().toISOString();
const data = {
  entity: { id: 'preview-drag', name, summary: 'Synthetic preview only. A densely documented entity with sources, properties and dated evidence.', properties: { website: 'https://example.test/' + 'long-path-'.repeat(12), region: 'North Atlantic', status: 'Synthetic preview' }, confidence: 'moderate', confirmed: false, type: { id: 'org', name: 'Organisation', icon: '◆', color: '#0e5b66' }, createdAt: now, updatedAt: now, confidenceScore: 0.7 },
  metrics: { degree: 12, importance: 0.23, betweenness: 0, brokerage: 0, community: 1, noteCount: 8, evidenceAt: now, relevance: { score: 0.7, confidence: 0.7, freshness: 1, ageDays: 0 } },
  neighbours: [], histogram: [], timeline: [{ id: 'event', date: '2026-09-06', title: 'Synthetic observation', type: 'test' }],
  notes: Array.from({ length: 8 }, (_, i) => ({ id: `note-${i}`, title: `Synthetic evidence ${i + 1}: a long source title that remains fully readable`, source: 'test', createdAt: now, observedAt: now, href: '#evidence', excerpt: `Synthetic source ${i + 1} explains the entity and its relevant information.`, relevance: null })),
};
await page.route('**/api/jkai/intel/entity-card?*', async route => {
  const id = new URL(route.request().url()).searchParams.get('id');
  if (id === 'preview-error') return route.fulfill({ status: 500, body: '{}' });
  if (id?.startsWith('preview-')) {
    if (id === 'preview-loading') await new Promise(resolve => setTimeout(resolve, 900));
    return route.fulfill({ json: id === 'preview-empty' ? { ...data, notes: [], timeline: [], entity: { ...data.entity, summary: null, properties: {} } } : data });
  }
  return route.continue();
});
await page.route('**/api/jkai/intel/trust?*', route => route.fulfill({ status: 404, body: '{}' }));
async function open(id, x = 1200, y = 700) {
  await page.evaluate(async ({ id, x, y }) => {
    const { entityHover } = await import('/src/lib/components/intel/entity-hover.svelte.ts');
    entityHover.pinAt(id, { left: x, right: x, top: y, bottom: y });
  }, { id, x, y });
}
async function bounded(dialog) {
  await page.waitForFunction(el => {
    const r = el.getBoundingClientRect();
    return r.x >= 11 && r.y >= 11 && r.right <= innerWidth - 11 && r.bottom <= innerHeight - 11;
  }, await dialog.elementHandle(), { timeout: 5000 });
  const box = await dialog.boundingBox();
  const view = page.viewportSize();
  assert(box && box.x >= 11 && box.y >= 11 && box.x + box.width <= view.width - 11 && box.y + box.height <= view.height - 11, JSON.stringify({ box, view }));
  assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
}
async function drag(handle, dx, dy) {
  const box = await handle.boundingBox();
  const x = box.x + 30, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}
try {
  await page.goto(`${base}/jkai/intel`, { waitUntil: 'networkidle', timeout: 120000 });
  await open('preview-loading');
  const dialog = page.getByRole('dialog', { name: 'Entity details', exact: true });
  await dialog.getByText('Loading…').waitFor();
  await dialog.getByRole('heading', { name }).waitFor();
  await page.waitForFunction(() => document.querySelector('.hover-card')?.getBoundingClientRect().height > 500);
  assert.equal(await dialog.evaluate(el => el.parentElement === document.body), true);
  await bounded(dialog);
  assert.match(await dialog.locator('.entity-card').evaluate(el => getComputedStyle(el).fontFamily), /Selawik/);
  const handle = dialog.getByRole('button', { name: 'Move entity details' });
  const before = await dialog.boundingBox();
  await drag(handle, -250, -80);
  const after = await dialog.boundingBox();
  assert(after.x < before.x - 200);
  await bounded(dialog);
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  assert(Math.abs((await dialog.boundingBox()).x - after.x - 10) < 1);
  await dialog.locator('.scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await dialog.getByRole('button', { name: 'Show 2 more' }).click();
  await dialog.locator('.evidence').getByText('Synthetic evidence 8:', { exact: false }).waitFor();
  await bounded(dialog);
  assert.equal(await handle.isVisible(), true);
  await dialog.locator('.scroll').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: '/tmp/sr-entity-modal-wide.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await bounded(dialog);
  await page.screenshot({ path: '/tmp/sr-entity-modal-narrow.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 240 });
  await bounded(dialog);
  await handle.focus();
  await page.keyboard.press('Home');
  await bounded(dialog);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await open('preview-error', 100, 100);
  await dialog.getByText('Could not load this entity.').waitFor();
  await drag(handle, 100, 100);
  await bounded(dialog);
  await open('preview-empty', 500, 300);
  await dialog.getByRole('heading', { name }).waitFor();
  await bounded(dialog);
  // Real touch pointer capture, including release outside the original handle.
  const touch = await page.context().newCDPSession(page);
  const grip = await handle.boundingBox();
  const touchBefore = await dialog.boundingBox();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: grip.x + 35, y: grip.y + 15 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: grip.x + 135, y: grip.y + 45 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert((await dialog.boundingBox()).x > touchBefore.x + 90);
  await touch.detach();
  await bounded(dialog);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });

  // Exercise the actual rail's double-click entry point with a synthetic thread graph.
  console.log('Entity card checks passed; opening JKAI rail.');
  await page.goto(`${base}/jkai`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const graph = { nodes: [{ id: 'entity:preview-drag', kind: 'concept', type: 'Organisation', name, note: null, href: null, provenance: 'known', lastSeen: now, turns: [1], mentions: 1 }], edges: [], conceptsReady: true, intelEnabled: true, conceptTotal: 1 };
  await page.route('**/api/jkai/conversations/preview-rail/graph*', route => route.fulfill({ json: graph }));
  await page.evaluate(async () => {
    const { mount } = await import('/node_modules/.vite/deps/svelte.js');
    const { default: Rail } = await import('/src/lib/components/jkai/ThreadGraphCard.svelte');
    const target = document.createElement('div');
    target.style.cssText = 'position:fixed;right:20px;top:140px;width:360px;z-index:99;background:var(--bg)';
    document.body.appendChild(target);
    mount(Rail, { target, props: { conversationId: 'preview-rail' } });
  });
  console.log('Synthetic rail mounted.');
  await page.locator('.tg-node').last().dblclick();
  const graphDialog = page.getByRole('dialog', { name: 'Thread knowledge graph' });
  await graphDialog.getByRole('heading', { name }).waitFor();
  await bounded(graphDialog);
  await drag(graphDialog.getByRole('button', { name: 'Move knowledge graph' }), -20, -30);
  await bounded(graphDialog);
  await page.screenshot({ path: '/tmp/sr-entity-rail-wide.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await bounded(graphDialog);
  await page.screenshot({ path: '/tmp/sr-entity-rail-narrow.png', animations: 'disabled' });
  await graphDialog.locator('.gm-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await graphDialog.getByRole('button', { name: 'Show 2 more' }).click();
  const lastEvidence = graphDialog.locator('.evidence .title').last();
  await lastEvidence.scrollIntoViewIfNeeded();
  const lastBox = await lastEvidence.boundingBox();
  assert(lastBox.y + lastBox.height < page.viewportSize().height - 12);
  await bounded(graphDialog);
  assert.equal(await graphDialog.getByRole('button', { name: 'Move knowledge graph' }).isVisible(), true);
  await graphDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await graphDialog.waitFor({ state: 'hidden' });
  if (process.env.ENTITY_PREVIEW_DRILL === '1') {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/context-panel/drill?*', route => route.fulfill({ json: {
      target: 'entity:preview-drag', kind: 'entity', entityId: 'preview-drag',
      eyebrow: 'Synthetic entity', title: name, facts: [], sections: [], actions: [],
    } }));
    await page.evaluate(async () => {
      const { mount, unmount } = await import('/node_modules/.vite/deps/svelte.js');
      const { default: Drill } = await import('/src/lib/components/jkai/context/ContextDrillModal.svelte');
      const target = document.createElement('div');
      document.body.appendChild(target);
      const component = mount(Drill, { target, props: {
        conversationId: 'preview-rail', target: 'entity:preview-drag',
        onClose: () => { void unmount(component); target.remove(); }, onAsk: () => {},
      } });
    });
    const drill = page.locator('.dm-panel');
    await drill.locator('.entity-card h3').waitFor();
    await bounded(drill);
    const start = await drill.boundingBox();
    const grip = drill.getByRole('button', { name: 'Move details' });
    await drag(grip, 40, 20);
    assert((await drill.boundingBox()).x > start.x + 30);
    await grip.focus();
    await page.keyboard.press('ArrowLeft');
    await bounded(drill);
    await page.screenshot({ path: '/tmp/sr-entity-drill-wide.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await bounded(drill);
    await page.screenshot({ path: '/tmp/sr-entity-drill-narrow.png', animations: 'disabled' });
    await drill.getByRole('button', { name: 'Show 2 more' }).click();
    const last = drill.locator('.evidence .title').last();
    await last.scrollIntoViewIfNeeded();
    const lastBox = await last.boundingBox();
    assert(lastBox.y + lastBox.height < 832);
    await grip.focus();
    await page.keyboard.press('Home');
    await bounded(drill);
    await drill.getByRole('button', { name: 'Close', exact: true }).click();
    await drill.waitFor({ state: 'hidden' });
    console.log('PASS: current inspector drill dragging, keyboard, mobile reflow, final evidence and close.');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: drag, keyboard move/reset, bounds after resize/growth, readable overflow, loading/error/empty states, rail double-click, desktop and phone. Synthetic browser fixtures only.');
} finally { await browser.close(); }
