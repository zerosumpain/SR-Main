import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Browser-only synthetic responses: no graph writes, model calls or production data.
const base = process.env.ENTITY_PREVIEW_URL || 'http://192.168.0.77:5277';
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
// Exercise built routes through their real graph/rail entry points; no Vite
// imports or manually mounted components, so the same check runs after build.
await page.addInitScript(() => localStorage.setItem('intel:graph3d', '0'));
await page.route('**/api/jkai/intel/network?*', route => route.fulfill({ json: {
  nodes: [{ ...data.entity, ...data.metrics, type: 'Organisation', typeId: 'org', icon: '◆', color: '#0e5b66', hops: null, categories: [], aliases: [], sources: [], recency: 1 }],
  edges: [], types: [data.entity.type], categories: [], sources: [], matched: [], trimmed: false,
  stats: { totalNodes: 1, totalEdges: 0, shown: 1, communities: 0, modularity: 0, components: 1, largestComponent: 1, isolated: 1 }, communities: [],
} }));
await page.route('**/api/jkai/conversations', route => route.request().method() === 'POST'
  ? route.fulfill({ json: { id: 'preview-rail', title: 'Synthetic drag check', createdAt: now, updatedAt: now } })
  : route.continue());
await page.route('**/api/jkai/conversations/preview-rail/context-panel', route => route.fulfill({ json: {
  revision: 'preview', selectedLens: 'general', automaticLens: 'general', focus: { label: 'Synthetic', reason: 'Browser test' },
  lenses: [{ id: 'general', score: 1, reason: 'Browser test' }],
  cards: [{ id: 'entities', title: 'Synthetic entities', type: 'links', rows: [{ id: 'preview-drag', label: 'Open synthetic entity', drill: 'entity:preview-drag' }] }],
} }));
await page.route('**/context-panel/drill?*', route => route.fulfill({ json: {
  target: 'entity:preview-drag', kind: 'entity', entityId: 'preview-drag',
  eyebrow: 'Synthetic entity', title: name, facts: [], sections: [], actions: [],
} }));
await page.route('**/api/jkai/conversations/preview-rail/graph*', route => route.fulfill({ json: {
  nodes: [{ id: 'entity:preview-drag', kind: 'concept', type: 'Organisation', name, note: null, href: null, provenance: 'known', lastSeen: now, turns: [1], mentions: 1 }],
  edges: [], conceptsReady: true, intelEnabled: true, conceptTotal: 1,
} }));
async function checkTitle(dialog, label) {
  await dialog.getByRole('heading', { name, exact: true }).waitFor();
  await bounded(dialog);
  // Wait out opening animation before comparing coordinates.
  await page.waitForTimeout(220);
  const before = await dialog.boundingBox();
  await drag(dialog.getByRole('heading', { name, exact: true }), -50, -30);
  const after = await dialog.boundingBox();
  assert(after.x < before.x - 15, `${label}: entity title did not move the dialog: ${JSON.stringify({before, after})}`);
  await bounded(dialog);
  console.log(`${label}: entity title drag passed`);
}
try {
  await page.goto(`${base}/jkai/intel`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('g.node circle').first().click();
  const popup = page.getByRole('dialog', { name: 'Entity details', exact: true });
  await checkTitle(popup, 'Intel');
  const handle = popup.getByRole('button', { name: 'Move entity details' });
  await handle.focus();
  const beforeKey = await popup.boundingBox();
  await page.keyboard.press('ArrowRight');
  assert((await popup.boundingBox()).x > beforeKey.x + 9);
  const touch = await page.context().newCDPSession(page);
  const title = await popup.getByRole('heading', { name, exact: true }).boundingBox();
  const beforeTouch = await popup.boundingBox();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: title.x + 30, y: title.y + 15 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: title.x + 80, y: title.y + 35 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert((await popup.boundingBox()).x > beforeTouch.x + 40);
  await touch.detach();
  await page.screenshot({ path: '/tmp/entity-header-release-wide.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await bounded(popup);
  const phoneTouch = await page.context().newCDPSession(page);
  const phoneTitle = await popup.getByRole('heading', { name, exact: true }).boundingBox();
  const beforePhone = await popup.boundingBox();
  await phoneTouch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: phoneTitle.x + 30, y: phoneTitle.y + 15 }] });
  await phoneTouch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: phoneTitle.x + 30, y: phoneTitle.y + 95 }] });
  await phoneTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert((await popup.boundingBox()).y > beforePhone.y + 70, 'Phone title must drag vertically');
  await phoneTouch.detach();
  await bounded(popup);
  await page.screenshot({ path: '/tmp/entity-header-release-phone.png', animations: 'disabled' });
  await popup.getByRole('button', { name: 'Close', exact: true }).click();
  await popup.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/jkai?new=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByText('Open synthetic entity', { exact: true }).dblclick();
  const drill = page.locator('.dm-panel');
  await checkTitle(drill, 'Context rail');
  await drill.getByRole('button', { name: 'Close', exact: true }).click();
  await drill.waitFor({ state: 'hidden' });
  await page.locator('.tg-node').last().dblclick();
  const graph = page.getByRole('dialog', { name: 'Thread knowledge graph' });
  await checkTitle(graph, 'Thread graph');
  await graph.getByRole('button', { name: 'Close', exact: true }).click();
  await graph.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('PASS: built-route title dragging, touch, keyboard, mobile bounds, double-click rail entry points and Close. Synthetic browser responses only.');
} catch (error) {
  await page.screenshot({ path: '/tmp/entity-header-release-failure.png' });
  console.error('Browser errors:', errors);
  throw error;
} finally { await browser.close(); }
