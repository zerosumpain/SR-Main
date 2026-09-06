import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import pg from 'pg';

const base = 'http://192.168.0.77:5275';
const prefix = `cleanup-preview-${crypto.randomUUID()}`;
const id = name => `${prefix}-${name}`;
const client = new pg.Client({ connectionString: 'postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local' });
await client.connect();
const q = (query, values = []) => client.query(query, values);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let runId;
async function api(path, method = 'GET', data) {
  const response = await page.request.fetch(base + path, { method, data });
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}
try {
  await q('INSERT INTO intel_entity_types(id,name) VALUES($1,$1)', [prefix]);
  await q('INSERT INTO drive_folder_settings(path,intel_mode) VALUES($1,\'exclude\')', [prefix + '/excluded']);
  for (const name of ['source', 'move']) {
    await q('INSERT INTO workflow_files(id,name,mime_type,size_bytes,disk_path) VALUES($1,$2,\'text/plain\',0,\'/synthetic-no-bytes\')', [id(name), prefix + (name === 'move' ? '/included/' : '/excluded/') + name + '.txt']);
    await q('INSERT INTO intel_notes(id,title,raw_content,source,status,graph_state,metadata) VALUES($1,$2,\'Synthetic evidence\',\'file\',\'processed\',\'admitted\',$3)', [id(name + '-note'), 'Synthetic cleanup: ' + name, JSON.stringify({ autoKind: 'file', refId: id(name) })]);
    await q('INSERT INTO intel_entities(id,name,type_id,first_seen_in) VALUES($1,$2,$3,$4)', [id(name + '-entity'), 'Synthetic cleanup ' + name, prefix, id(name + '-note')]);
    await q('INSERT INTO intel_note_entities(note_id,entity_id) VALUES($1,$2)', [id(name + '-note'), id(name + '-entity')]);
  }
  // Real move endpoint must reconcile the new folder immediately.
  await api('/api/files/' + id('move'), 'PATCH', { name: prefix + '/excluded/move.txt' });
  assert.equal((await q('SELECT id FROM intel_notes WHERE id=$1', [id('move-note')])).rowCount, 0);
  assert.equal((await q('SELECT id FROM intel_entities WHERE id=$1', [id('move-entity')])).rowCount, 0);

  // Explicit owner edits have independent provenance and survive source removal.
  await q('INSERT INTO intel_entities(id,name,type_id) VALUES($1,\'Synthetic owner-kept entity\',$2)', [id('owner'), prefix]);
  await q('INSERT INTO intel_note_entities(note_id,entity_id) VALUES($1,$2)', [id('source-note'), id('owner')]);
  await api('/api/jkai/intel/entities/' + id('owner'), 'PUT', { summary: 'Owner-kept description', properties: { preference: 'Owner-kept value' } });
  await api('/api/jkai/intel/entities/' + id('owner'), 'PUT', { summary: null, properties: { nullable: null } });
  assert.equal((await q('SELECT summary FROM intel_entities WHERE id=$1', [id('owner')])).rows[0].summary, null);
  await api('/api/jkai/intel/entities/' + id('owner'), 'PUT', { summary: 'Owner-kept description', properties: { preference: 'Updated owner value' } });
  await api('/api/jkai/intel/entities/' + id('owner'), 'PUT', { properties: { preference: 'Updated owner value' } });

  // Unrelated panels use synthetic responses; cleanup itself uses the real API/DB.
  await page.route('**/api/jkai/intel/duplicates?*', route => route.fulfill({ json: { duplicates: [], total: 0 } }));
  await page.route('**/api/jkai/intel/mentions', route => route.fulfill({ json: { mentions: [], assertions: [] } }));
  await page.goto(base + '/jkai/intel/quality', { waitUntil: 'networkidle' });
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Source cleanup', exact: true }) });
  await panel.getByRole('button', { name: 'Preview cleanup', exact: true }).click();
  await panel.getByText('Preview only. Nothing has changed.').waitFor();
  assert.equal((await q('SELECT id FROM intel_notes WHERE id=$1', [id('source-note')])).rowCount, 1);
  await panel.getByText('Sources and entities in this batch', { exact: false }).click();
  await panel.getByText('Synthetic cleanup: source', { exact: true }).waitFor();
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: '/tmp/graph-cleanup-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await panel.screenshot({ path: '/tmp/graph-cleanup-phone.png' });
  const applied = page.waitForResponse(r => r.url().endsWith('/api/jkai/intel/cleanup') && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Run cleanup', exact: true }).click();
  const response = await applied;
  assert.equal(response.status(), 200, await response.text());
  runId = (await response.json()).runId;
  await panel.getByText('Cleanup complete. The counts below show what changed.').waitFor();
  assert.equal((await q('SELECT id FROM intel_notes WHERE id=$1', [id('source-note')])).rowCount, 0);
  assert.equal((await q('SELECT id FROM intel_entities WHERE id=$1', [id('source-entity')])).rowCount, 0);
  assert.deepEqual((await q('SELECT summary,properties FROM intel_entities WHERE id=$1', [id('owner')])).rows[0], { summary: 'Owner-kept description', properties: { preference: 'Updated owner value' } });
  const history = await api('/api/jkai/intel/runs');
  assert.ok(history.runs.some(r => r.id === runId && r.status === 'ok' && r.stages.some(s => s.stage === 'cleanup' && s.ok)));
  await panel.getByRole('button', { name: 'Preview cleanup', exact: true }).click();
  await panel.getByText('Preview only. Nothing has changed.').waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Run cleanup', exact: true }).isDisabled(), true);
  await page.route('**/api/jkai/intel/cleanup', route => route.fulfill({ status: 503, json: { error: 'Synthetic unavailable service' } }));
  await panel.getByRole('button', { name: 'Preview cleanup', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'could not' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: LAN desktop/phone preview, read-only plan, file-move cleanup, owner edits, apply, run history, idempotence and error state.');
} finally {
  await browser.close();
  if (runId) {
    await q('DELETE FROM datastore_audit_log WHERE record_id IN (SELECT id FROM datastore_records WHERE key=$1)', [runId]);
    await q('DELETE FROM datastore_records WHERE key=$1', [runId]);
  }
  await q('DELETE FROM intel_entities WHERE type_id=$1', [prefix]);
  await q('DELETE FROM intel_notes WHERE id LIKE $1', [prefix + '%']);
  await q('DELETE FROM workflow_files WHERE id LIKE $1', [prefix + '%']);
  await q('DELETE FROM drive_folder_settings WHERE path LIKE $1', [prefix + '%']);
  await q('DELETE FROM intel_entity_types WHERE id=$1', [prefix]);
  await client.end();
}
