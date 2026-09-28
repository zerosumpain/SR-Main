import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

const mock = vi.hoisted(() => ({ read: vi.fn(), runtime: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
vi.mock('./think/tools', () => ({ PRIVATE_TOOLS: ['spend'], createToolbox: () => ({ call: mock.read }) }));
vi.mock('$lib/workflows/runtime-client', () => ({ invokeWorkflowRuntime: mock.runtime }));
vi.mock('$lib/server/notify/push-dispatch', () => ({ kickPushDispatch: vi.fn() }));
vi.mock('$lib/events/platform-bus', () => ({ emit: vi.fn() }));
import { db } from '$lib/db';
import { prepareCommission, decideCommission } from './commission-service.server';
import { loadCommission } from './commission-store.server';
import { flushCommissionOutbox, invokeCommissionOperation, reconcileCommissions } from './commission-executor.server';
import { notifyOwner } from '$lib/server/notify';

const enabled = /(?:127\.0\.0\.1|localhost):15445\//.test(process.env.DATABASE_URL ?? '');
const thoughts: string[] = [];
const runs: string[] = [];
const notificationIds: string[] = [];
async function thought() {
  const id = randomUUID(); thoughts.push(id);
  const evidence = [{ kind: 'think-card', id: 'spend:[["days",30]]@2026-09-28' }];
  await db.execute(sql`INSERT INTO daydream_thoughts(id,kind,title,explanation,dedupe_key,evidence)
    VALUES (${id},'think_money_analysis','Synthetic commissioning test','These records need checking.',${id},
    ${JSON.stringify(evidence)}::jsonb)`);
  return id;
}
const approval = (c: Awaited<ReturnType<typeof prepareCommission>>) => ({ decision: 'approve' as const, revision: c.revision, specHash: c.specHash, operationKey: randomUUID() });
async function runFor(c: Awaited<ReturnType<typeof prepareCommission>>) {
  const runId = `commission-test-${randomUUID()}`; runs.push(runId);
  const versionId = randomUUID();
  await db.execute(sql`INSERT INTO workflows(id,name) VALUES ('daydream-commission-execution-v1','Daydream commissioning test adapter') ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO workflow_versions(id,workflow_id,hash,definition)
    VALUES (${versionId},'daydream-commission-execution-v1',${versionId},'{"nodes":[{"type":"daydream-commission","config":{"operation":"execute"}}]}'::jsonb)`);
  const metadata = { __srQueuedInputV1: { input: {}, context: { commission: { commissionId: c.id, generation: 1, specHash: c.specHash } } } };
  await db.execute(sql`INSERT INTO workflow_runs(id,workflow_id,status,trigger,version_id,input_data,lease_expires_at)
    VALUES (${runId},'daydream-commission-execution-v1','running','daydream-commission',${versionId},${JSON.stringify(metadata)}::jsonb,now()+interval '5 minutes')`);
  return runId;
}

describe.skipIf(!enabled)('commission transactions against isolated local Postgres', () => {
  beforeEach(async () => {
    process.env.DAYDREAM_COMMISSIONING = '1';
    mock.read.mockReset().mockResolvedValue({ failed: false, card: { text: 'Synthetic source: one payment and its receipt.' } });
    mock.runtime.mockReset().mockResolvedValue({ runId: 'synthetic-runtime-receipt' });
    await db.execute(sql`INSERT INTO datastore_collections(slug,name,is_system,created_by,default_permissions)
      VALUES ('improvement_backlog','Improvement backlog',true,'system',
        '{"read":["owner","jkai","system"],"write":["system","owner"],"delete":["owner","system"]}'::jsonb)
      ON CONFLICT (slug) DO NOTHING`);
  });
  afterAll(async () => {
    for (const id of thoughts) {
      await db.execute(sql`DELETE FROM notification_events WHERE data->>'thoughtId'=${id}`);
      await db.execute(sql`DELETE FROM datastore_records WHERE data->>'commissionId' IN (SELECT id::text FROM daydream_commissions WHERE thought_id=${id})`);
      await db.execute(sql`DELETE FROM daydream_thoughts WHERE id=${id}`);
    }
    for (const id of runs) {
      await db.execute(sql`DELETE FROM workflow_versions WHERE id=(SELECT version_id FROM workflow_runs WHERE id=${id})`);
      await db.execute(sql`DELETE FROM workflow_runs WHERE id=${id}`);
    }
    for (const id of notificationIds) await db.execute(sql`DELETE FROM notification_events WHERE id=${id}::uuid`);
  });
  it('concurrent preparation creates one backlog proposal and no dispatch', async () => {
    const id = await thought();
    const proposals = await Promise.all(Array.from({ length: 5 }, () => prepareCommission(id)));
    expect(new Set(proposals.map(p => p.id)).size).toBe(1);
    expect(proposals[0].state).toBe('awaiting_approval');
    const outbox = await db.execute(sql`SELECT kind FROM daydream_commission_outbox WHERE commission_id=${proposals[0].id}::uuid`);
    expect(outbox.rows.map(r => r.kind)).toEqual(['notification']);
  });
  it('replayed approval is idempotent, changed input and stale competing decisions fail', async () => {
    const c = await prepareCommission(await thought()); const input = approval(c);
    const replies = await Promise.all([decideCommission(c.id, input), decideCommission(c.id, input)]);
    expect(replies.every(r => r.state === 'queued')).toBe(true);
    await expect(decideCommission(c.id, { ...input, decision: 'decline' })).rejects.toMatchObject({ status: 409 });
    await expect(decideCommission(c.id, approval(c))).rejects.toMatchObject({ status: 409 });
    const dispatch = await db.execute(sql`SELECT id FROM daydream_commission_outbox WHERE commission_id=${c.id}::uuid AND kind='dispatch'`);
    expect(dispatch.rows).toHaveLength(1);
  });
  it('a new owner correction invalidates the old approval', async () => {
    const c = await prepareCommission(await thought());
    await db.execute(sql`UPDATE daydream_thoughts SET note='This is one payment and its receipt.' WHERE id=${c.thoughtId}`);
    await expect(decideCommission(c.id, approval(c))).rejects.toMatchObject({ status: 409 });
    expect((await loadCommission(c.id)).state).toBe('awaiting_approval');
    const replacement = await prepareCommission(c.thoughtId);
    expect(replacement.id).not.toBe(c.id);
    expect(replacement.spec.ownerCorrection).toBe('This is one payment and its receipt.');
    expect((await loadCommission(c.id)).state).toBe('cancelled');
    expect((await loadCommission(c.id)).events.at(-1)?.data.replacementId).toBe(replacement.id);
  });
  it('a workflow records source provenance once and keeps the claim unverified', async () => {
    const proposal = await prepareCommission(await thought());
    const c = await decideCommission(proposal.id, approval(proposal)); const runId = await runFor(c);
    await invokeCommissionOperation({ operation: 'execute', runId });
    await invokeCommissionOperation({ operation: 'execute', runId });
    const result = await loadCommission(c.id);
    expect(result.state).toBe('completed'); expect(mock.read).toHaveBeenCalledTimes(1);
    expect(result.result?.evidence[0]).toMatchObject({ provenance: 'query_result', status: 'available' });
    expect(result.result?.summary).toContain('does not independently verify');
  });
  it('cancellation while a source read is in flight fences its completion', async () => {
    const proposal = await prepareCommission(await thought());
    const c = await decideCommission(proposal.id, approval(proposal)); const runId = await runFor(c);
    let release!: (value: unknown) => void;
    mock.read.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const execution = invokeCommissionOperation({ operation: 'execute', runId });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const current = await loadCommission(c.id);
    await decideCommission(c.id, { ...approval(current), decision: 'cancel' });
    release({ failed: false, card: { text: 'A late result' } }); await execution;
    expect((await loadCommission(c.id)).state).toBe('cancelled');
    expect((await loadCommission(c.id)).result).toBeNull();
  });
  it('expired execution leases become a visible blocker', async () => {
    const c = await prepareCommission(await thought());
    await db.execute(sql`UPDATE daydream_commissions SET state='running',lease_until=now()-interval '1 minute' WHERE id=${c.id}::uuid`);
    await reconcileCommissions();
    expect((await loadCommission(c.id)).state).toBe('needs_attention');
  });
  it('an interrupted approved read recovers autonomously within its attempt budget', async () => {
    const proposal = await prepareCommission(await thought());
    const c = await decideCommission(proposal.id, approval(proposal));
    await db.execute(sql`UPDATE daydream_commissions SET state='running',attempts=1,lease_until=now()-interval '1 minute' WHERE id=${c.id}::uuid`);
    await reconcileCommissions();
    expect((await loadCommission(c.id)).state).toBe('queued');
    const dispatch = await db.execute(sql`SELECT id FROM daydream_commission_outbox WHERE commission_id=${c.id}::uuid AND kind='dispatch'`);
    expect(dispatch.rows).toHaveLength(2);
    await db.execute(sql`UPDATE daydream_commissions SET state='running',attempts=3,lease_until=now()-interval '1 minute' WHERE id=${c.id}::uuid`);
    await reconcileCommissions();
    expect((await loadCommission(c.id)).state).toBe('needs_attention');
  });
  it('failed workflows that never reached Main do not strand an approved commission', async () => {
    const proposal = await prepareCommission(await thought());
    const c = await decideCommission(proposal.id, approval(proposal)); const runId = await runFor(c);
    await db.execute(sql`UPDATE workflow_runs SET status='failed' WHERE id=${runId}`);
    await db.execute(sql`UPDATE daydream_commissions SET workflow_run_id=${runId} WHERE id=${c.id}::uuid`);
    await reconcileCommissions();
    const result = await loadCommission(c.id);
    expect(result.state).toBe('queued');
    expect(result.events.at(-1)?.kind).toBe('execution.recovery_queued');
  });
  it('the same domain event projects only one notification under concurrency', async () => {
    const eventId = randomUUID(); notificationIds.push(eventId);
    const input = { eventId, dedupeKey: `commission-test:${eventId}`, category: 'daydream', title: 'Synthetic commission milestone', body: 'Idempotent projection', channels: { native: false, whatsapp: false } };
    const result = await Promise.all([notifyOwner(input), notifyOwner(input)]);
    expect(result.every(r => r.id === eventId)).toBe(true);
    const found = await db.execute(sql`SELECT id FROM notification_events WHERE id=${eventId}::uuid`);
    expect(found.rows).toHaveLength(1);
  });
  it('disabled commissioning refuses worker execution', async () => {
    process.env.DAYDREAM_COMMISSIONING = '0';
    expect(await invokeCommissionOperation({ operation: 'execute', runId: 'anything' })).toMatchObject({ success: false });
  });
});
