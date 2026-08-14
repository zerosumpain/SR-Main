// Integration test for the research frontier — hits the REAL local DB. Not part
// of the default suite (it needs DATABASE_URL). Run explicitly:
//   set -a; source .env; set +a; npx vitest run tests/lib/deepdive/frontier.integration.test.ts
//
// What it pins: the dead-end machinery. The old engine could only stop the
// WHOLE run — phase 1 on category saturation, phase 2 on facts-per-twenty-
// sources — both global averages, so a branch going nowhere was never pruned;
// it just dragged the mean down while the run kept paying for it. Follow-up
// queries were an unscored FIFO, so an unproductive query spawned children
// exactly as eagerly as a productive one.
//
// The behaviour that replaced it only means anything if a drifted lead really
// does take its unstarted subtree with it, so that is what this asserts against
// real rows rather than a mock.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '$lib/db';
import { researchSessions, researchLeads } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { addLeads, takeLeads, completeLead, pruneSubtree, frontierExhausted } from '$lib/deepdive/frontier';
import type { LeadOutcome } from '$lib/deepdive/frontier-scoring';

const hasDb = !!process.env.DATABASE_URL;

function outcome(over: Partial<LeadOutcome> = {}): LeadOutcome {
  return {
    sourcesFound: 4,
    novelFacts: 6,
    duplicateFacts: 0,
    novelEntities: 4,
    connectedEntities: 3,
    goalAlignment: 0.8,
    searchFailed: false,
    ...over,
  };
}

/** Off-question AND unconnected — the drift signature. */
function driftedOutcome(): LeadOutcome {
  return outcome({ novelFacts: 9, novelEntities: 8, connectedEntities: 0, goalAlignment: 0.05 });
}

describe.skipIf(!hasDb)('research frontier', () => {
  let sessionId: string;

  beforeAll(async () => {
    const [row] = await db
      .insert(researchSessions)
      .values({ topic: 'frontier integration test', depth: 'investigation', status: 'draft' })
      .returning();
    sessionId = row.id;
  });

  afterAll(async () => {
    if (!sessionId) return;
    await db.delete(researchLeads).where(eq(researchLeads.sessionId, sessionId));
    await db.delete(researchSessions).where(eq(researchSessions.id, sessionId));
  });

  it('seeds leads and hands them out highest-value first', async () => {
    const seeded = await addLeads(sessionId, [
      { query: 'alpha query', origin: 'seed' },
      { query: 'beta query', origin: 'seed' },
    ]);
    expect(seeded).toHaveLength(2);

    const taken = await takeLeads(sessionId, 2);
    expect(taken).toHaveLength(2);
    expect(taken.every((l) => l.status === 'running')).toBe(true);

    // Already claimed — a second worker must not get the same work.
    expect(await takeLeads(sessionId, 2)).toHaveLength(0);
  });

  it('refuses to queue a query this session has already asked', async () => {
    const again = await addLeads(sessionId, [{ query: 'ALPHA Query  ', origin: 'followup' }]);
    expect(again).toHaveLength(0);
  });

  it('marks a productive lead productive and leaves its children alone', async () => {
    const [parent] = await addLeads(sessionId, [{ query: 'productive parent', origin: 'seed' }]);
    await takeLeads(sessionId, 5);
    const children = await addLeads(sessionId, [
      { query: 'good child one', parentId: parent.id, depth: 1, origin: 'followup' },
      { query: 'good child two', parentId: parent.id, depth: 1, origin: 'followup' },
    ]);
    expect(children).toHaveLength(2);

    const verdict = await completeLead(sessionId, parent.id, outcome());
    expect(verdict.status).toBe('productive');

    const after = await db
      .select({ status: researchLeads.status })
      .from(researchLeads)
      .where(and(eq(researchLeads.sessionId, sessionId), eq(researchLeads.parentId, parent.id)));
    expect(after.every((c) => c.status === 'queued')).toBe(true);
  });

  // The headline behaviour: abandoning a branch abandons the BRANCH, not just
  // the node. Pruning only the parent would let its already-queued children
  // carry on down exactly the path just rejected.
  it('prunes the whole subtree when a lead drifts', async () => {
    const [parent] = await addLeads(sessionId, [{ query: 'drifting parent', origin: 'seed' }]);
    await takeLeads(sessionId, 10);

    const [child] = await addLeads(sessionId, [
      { query: 'drift child', parentId: parent.id, depth: 1, origin: 'followup' },
    ]);
    const [grandchild] = await addLeads(sessionId, [
      { query: 'drift grandchild', parentId: child.id, depth: 2, origin: 'followup' },
    ]);

    const verdict = await completeLead(sessionId, parent.id, driftedOutcome());
    expect(verdict.status).toBe('drifted');
    expect(verdict.reason).toMatch(/connected to the question/i);

    const [childAfter] = await db
      .select({ status: researchLeads.status, reason: researchLeads.reason })
      .from(researchLeads)
      .where(eq(researchLeads.id, child.id));
    const [grandAfter] = await db
      .select({ status: researchLeads.status })
      .from(researchLeads)
      .where(eq(researchLeads.id, grandchild.id));

    expect(childAfter.status).toBe('pruned');
    expect(childAfter.reason).toMatch(/abandoned/i);
    expect(grandAfter.status).toBe('pruned');
  });

  // Work already paid for is not thrown away — only unstarted work is cancelled.
  it('does not cancel a child that is already running', async () => {
    const [parent] = await addLeads(sessionId, [{ query: 'parent with busy child', origin: 'seed' }]);
    await takeLeads(sessionId, 20);
    const [child] = await addLeads(sessionId, [
      { query: 'busy child', parentId: parent.id, depth: 1, origin: 'followup' },
    ]);
    await db
      .update(researchLeads)
      .set({ status: 'running' })
      .where(eq(researchLeads.id, child.id));

    await pruneSubtree(sessionId, parent.id, 'test prune');

    const [after] = await db
      .select({ status: researchLeads.status })
      .from(researchLeads)
      .where(eq(researchLeads.id, child.id));
    expect(after.status).toBe('running');
  });

  it('reports the frontier exhausted only once nothing is queued or running', async () => {
    expect(await frontierExhausted(sessionId)).toBe(false);
    await db
      .update(researchLeads)
      .set({ status: 'exhausted' })
      .where(eq(researchLeads.sessionId, sessionId));
    expect(await frontierExhausted(sessionId)).toBe(true);
  });
});
