import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { localRoute, previewPlan, checkPage, readPreviewManifest } from '../development-preview-check.mjs';
const scenario = { route: '/feature', text: 'Synthetic preference', steps: [{ action: 'click', role: 'button', name: 'Save' }, { action: 'text', text: 'Saved preference' }] };
test('rejects external routes and plans without an observable interaction outcome', () => {
  for (const path of ['//external.test', '/\\external.test', 'https://external.test']) assert.throws(() => localRoute(path));
  assert.throws(() => previewPlan(null, ['/feature']));
  assert.throws(() => previewPlan({ complete: false, scenarios: [{ ...scenario, steps: [{ action: 'text', text: 'Saved' }, { action: 'reload' }] }] }, ['/feature']));
  assert.throws(() => previewPlan({ complete: false, scenarios: [scenario] }, ['/different']));
});
test('real browser checks fail on missing routes, broken interactions and runtime errors', async () => {
  let broken = false, runtime = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: connected\n\n'); return; }
    if (req.url !== '/feature') { res.writeHead(404); return res.end('Missing'); }
    res.setHeader('content-type', 'text/html');
    res.end(`<script>new EventSource("/events")</script><h1>Synthetic preference</h1><button onclick="${broken ? '' : "document.querySelector('p').textContent='Saved preference'"}">Save</button><p>Unsaved</p>${runtime ? '<script>throw new Error("Synthetic runtime failure")</script>' : ''}`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const base = `http://127.0.0.1:${server.address().port}`;
  const plan = previewPlan({ complete: false, scenarios: [scenario] }, ['/feature']);
  try {
    assert.equal((await checkPage(browser, base, plan)).length, 2);
    await assert.rejects(checkPage(browser, base, { ...plan, routes: ['/missing'] }), /did not open/);
    broken = true; await assert.rejects(checkPage(browser, base, plan), /Timeout/);
    broken = false; runtime = true; await assert.rejects(checkPage(browser, base, plan), /runtime error/);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

test('reads bounded plans without following worker-controlled symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preview-plan-'));
  try {
    assert.equal(await readPreviewManifest(join(dir, 'missing')), null);
    await writeFile(join(dir, 'plan'), '{"complete":false}');
    assert.deepEqual(await readPreviewManifest(join(dir, 'plan')), { complete: false });
    await symlink(join(dir, 'plan'), join(dir, 'link'));
    await assert.rejects(readPreviewManifest(join(dir, 'link')), /regular file/);
    await writeFile(join(dir, 'big'), ' '.repeat(24001));
    await assert.rejects(readPreviewManifest(join(dir, 'big')), /24,000/);
  } finally { await rm(dir, { recursive: true }); }
});
