import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureDelivery, loadDelivery, mutateDelivery, deliveryEvents } from '$lib/jkai/development-state.server';
import { enqueuePendingMessage, instructionHistory, markInstructionsApplied, removePendingMessage } from '$lib/jkai/pending-messages';

const local = process.env.JKAI_LOCAL_TESTS === '1' && /(?:127\.0\.0\.1:15435|jkai-db:5432)\/jkai_local/.test(process.env.DATABASE_URL ?? '');
describe.skipIf(!local)('durable development state in isolated Postgres', () => {
  const id = crypto.randomUUID();
  beforeAll(async () => { await db.insert(jkaiBuilds).values({ id, prompt: 'Synthetic development test', status: 'paused' }); });
  afterAll(async () => { await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, id)); });
  it('serialises updates and rejects stale forms without losing the accepted brief', async () => {
    const initial = await ensureDelivery(id, 'Health', ['Reload retains the comparison']);
    await mutateDelivery(id, 'brief_accepted', (s) => ({ ...s, brief: { ...s.brief, acceptedAt: '2026-09-07T00:00:00Z' } }), initial.revision);
    await expect(mutateDelivery(id, 'stale_edit', (s) => ({ ...s, area: 'News' }), initial.revision)).rejects.toThrow('changed');
    expect((await loadDelivery(id))!.state.area).toBe('Health');
    expect((await deliveryEvents(id)).map((e) => e.kind)).toEqual(['brief_accepted']);
  });
  it('retains instruction receipts across reload, and deduplicates applied messages', async () => {
    const message = await enqueuePendingMessage(id, 'Preserve the public/owner split');
    expect((await instructionHistory(id))[0].consumedAt).toBeNull();
    await markInstructionsApplied(id, [message.id]);
    const appliedAt = (await instructionHistory(id))[0].consumedAt;
    await markInstructionsApplied(id, [message.id]);
    expect((await instructionHistory(id))[0].consumedAt).toEqual(appliedAt);
    expect((await instructionHistory(id))).toHaveLength(1);
    expect((await instructionHistory(id))[0].consumedAt).not.toBeNull();
    expect(await removePendingMessage(id, message.id)).toBe(false);
  });
  it('holds review state stable during integration and releases it after failure', async () => {
    const current = (await loadDelivery(id))!;
    await mutateDelivery(id, 'integration_started', (s) => ({ ...s, stage: 'integrating' }), current.revision);
    await expect(mutateDelivery(id, 'brief_accepted', (s) => ({ ...s, area: 'News' }))).rejects.toThrow('integration');
    await mutateDelivery(id, 'integration_failed', (s) => ({ ...s, stage: 'review' }));
    expect((await loadDelivery(id))!.state.stage).toBe('review');
  });

});
