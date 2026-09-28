/** Synthetic local acceptance: browser approval, closed browser, real worker, native history. */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { chromium, expect } from '@playwright/test';

const base = process.env.DAYDREAM_PREVIEW_URL ?? 'http://127.0.0.1:15440';
const origin = 'http://127.0.0.1:15431';
const output = process.env.DAYDREAM_EVIDENCE_DIR ?? '/tmp/daydream-commission-preview';
const database = process.env.DATABASE_URL ?? '';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Only the isolated loopback preview is supported');
assert.match(database, /@127\.0\.0\.1:15445\/workflows_jkai_local$/, 'Only the isolated local database is supported');
const db = new Pool({ connectionString: database, max: 2 });
const browser = await chromium.launch({ headless: true });
const deviceToken = randomBytes(32).toString('hex');
const deviceId = randomUUID();
const ids = [0, 1].map(() => `uiseed-commission-${randomUUID()}`);
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.on('pageerror', error => errors.push(error.message));
const native = async (path, body, token = deviceToken) => {
  const response = await fetch(`${origin}/api/native/${path}`, { method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
};
try {
  await mkdir(output, { recursive: true });
  await db.query(`INSERT INTO native_credentials(id,kind,owner_email,token_hash,label,expires_at)
    VALUES ($1,'device','local-owner@example.invalid',$2,'Synthetic Daydream QA',now()+interval '1 hour')`,
  [deviceId, createHash('sha256').update(deviceToken).digest('hex')]);
  for (const [index, id] of ids.entries()) {
    await db.query(`INSERT INTO daydream_thoughts(id,kind,title,explanation,narrative,dedupe_key,status,verified,score,evidence,note)
      VALUES ($1,'think_money_analysis',$2,'Synthetic local records need checking.',
        'This local demonstration refreshes the existing spend summary. It cannot verify original email invoices.',
        $1,'delivered',true,1,$3::jsonb,'A bank record and an invoice may describe the same payment.')`,
    [id, `Synthetic example: ${index ? 'proposal awaiting review' : 'refresh spend evidence'}`,
      JSON.stringify([{ kind: 'think-card', id: 'spend:[["days",30]]@2026-09-28' }, { kind: 'think-question', id: 'money' }])]);
  }
  assert.equal((await native('daydream/commissions', null, 'invalid')).status, 401);
  const noSession = await fetch(`${origin}/api/daydream/commissions`, { redirect: 'manual' });
  assert.ok([302, 303, 307, 401, 403].includes(noSession.status), `Anonymous web must be refused (${noSession.status})`);
  await page.goto(`${base}/jkai/daydreams?note=${ids[0]}`, { waitUntil: 'domcontentloaded' });
  const note = page.locator(`#note-${ids[0]}`);
  await expect(note).toBeVisible();
  await note.getByRole('button', { name: /^Double-check it/ }).click();
  await expect(page).toHaveURL(/commission=/);
  const commissionId = new URL(page.url()).searchParams.get('commission');
  assert.ok(commissionId);
  const panel = page.locator(`#commission-${commissionId}`);
  await expect(panel.getByRole('button', { name: 'Approve and run', exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/proposal-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Proposal fits mobile viewport');
  await page.screenshot({ path: `${output}/proposal-mobile.png`, fullPage: true });
  const before = (await native(`daydream/commissions?id=${commissionId}`)).body.commission;
  assert.equal(before.state, 'awaiting_approval');
  assert.equal(before.workflowRunId, null, 'Backlog intake must not dispatch');
  await panel.getByRole('button', { name: 'Approve and run', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Approve and run', exact: true })).toHaveCount(0);
  await page.close(); // The rest must work with no browser open.
  let completed;
  await expect.poll(async () => {
    completed = (await native(`daydream/commissions?id=${commissionId}`)).body.commission;
    return completed?.state;
  }, { timeout: 90_000, intervals: [500, 1000, 2000] }).toBe('completed');
  assert.ok(completed.result.evidence.length);
  assert.equal(completed.result.evidence[0].provenance, 'query_result');
  assert.match(completed.result.summary, /does not independently verify/);
  const run = await db.query('SELECT status,version_id FROM workflow_runs WHERE id=$1', [completed.workflowRunId]);
  assert.ok(run.rows[0].version_id, 'Execution was pinned');
  await expect.poll(async () => (await db.query('SELECT status FROM workflow_runs WHERE id=$1', [completed.workflowRunId])).rows[0]?.status).toBe('completed');
  let milestones;
  await expect.poll(async () => {
    const inbox = await native('notifications?inbox=200');
    milestones = inbox.body.recent.filter(event => event.data?.commissionId === commissionId);
    return milestones.some(event => event.data?.milestone === 'outcome.recorded');
  }, { timeout: 90_000, intervals: [1000, 2000] }).toBe(true);
  for (const kind of ['approval.requested', 'proposal.approve', 'outcome.recorded']) assert.ok(milestones.some(event => event.data.milestone === kind), kind);
  assert.equal(new Set(milestones.map(event => event.id)).size, milestones.length);
  const stale = await native('daydream/commissions', { action: 'decide', id: commissionId, decision: 'approve', revision: before.revision, specHash: before.specHash, operationKey: randomUUID() });
  assert.equal(stale.status, 409);
  const review = await native('daydream/commissions', { action: 'prepare', thoughtId: ids[1] });
  assert.equal(review.status, 200);
  assert.equal(review.body.commission.state, 'awaiting_approval');
  const reviewPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  reviewPage.on('pageerror', error => errors.push(error.message));
  await reviewPage.goto(`${base}${completed.url}`, { waitUntil: 'domcontentloaded' });
  await expect(reviewPage.locator(`#commission-${commissionId} .result`)).toContainText(completed.result.summary);
  await reviewPage.screenshot({ path: `${output}/outcome-desktop.png`, fullPage: true });
  await reviewPage.setViewportSize({ width: 390, height: 844 });
  await reviewPage.locator(`#commission-${commissionId}`).evaluate(element => element.scrollIntoView({ block: 'start' }));
  assert.ok(await reviewPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Outcome fits mobile viewport');
  await reviewPage.screenshot({ path: `${output}/outcome-mobile.png`, fullPage: true });
  await db.query('UPDATE native_credentials SET revoked_at=now() WHERE id=$1', [deviceId]);
  assert.equal((await native(`daydream/commissions?id=${commissionId}`)).status, 401);
  assert.deepEqual(errors, [], 'No browser runtime errors');
  const result = { passed: true, commissionId, awaitingApprovalId: review.body.commission.id, workflowRunId: completed.workflowRunId,
    milestones: milestones.map(event => ({ id: event.id, kind: event.data.milestone })),
    preview: `${base}${completed.url}`, native: 'HTTP contract checked with a temporary local device credential; no simulator or APNs claim.' };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.query('DELETE FROM native_credentials WHERE id=$1', [deviceId]);
  if (process.env.DAYDREAM_KEEP_FIXTURES !== '1') {
    for (const id of ids) {
      await db.query("DELETE FROM notification_events WHERE data->>'thoughtId'=$1", [id]);
      await db.query("DELETE FROM datastore_records WHERE data->>'commissionId' IN (SELECT id::text FROM daydream_commissions WHERE thought_id=$1)", [id]);
      await db.query('DELETE FROM daydream_thoughts WHERE id=$1', [id]);
    }
  }
  await browser.close();
  await db.end();
}
