/**
 * The ledger, against a real database.
 *
 * What matters here is not that rows get written — it is that the owner's
 * decisions survive recomputation. The detectors re-derive the same findings
 * every ten minutes, so without a durable identity a dismissal would last
 * exactly one tick.
 *
 * Excluded from the merge gate (`*.integration.test.ts`). Run deliberately:
 *   npx vitest run src/lib/daydream/thought-store.integration.test.ts
 *
 * Self-cleaning: every row it writes carries an identifiable dedupe-key prefix
 * and is deleted again. It never truncates a table.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings, daydreamThoughts } from '$lib/db/schema';
import {
  buildScoringContext,
  loadFeedback,
  persistCandidates,
  PROTECTED_STATUSES,
  recordFeedback,
} from './thought-store';
import { SETTINGS_MUTED_KINDS_KEY } from './types';
import type { Candidate } from './snapshot-types';

const PREFIX = 'itest_dd';
let dbReady = false;
let savedMuted: unknown = undefined;

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    kind: `${PREFIX}_kind`,
    title: 'A test thought',
    explanation: 'Because the fixture said so.',
    rawScore: 0.9,
    components: { fixture: 1 },
    evidence: [{ kind: 'place', id: 'p1' }],
    placeId: null,
    dedupeKey: `${PREFIX}:one`,
    proposedActions: [],
    ...over,
  };
}

async function cleanup() {
  await db.delete(daydreamThoughts).where(like(daydreamThoughts.dedupeKey, `${PREFIX}%`));
  // Restore whatever the mute list was before this file ran.
  if (savedMuted === undefined) {
    await db.delete(appSettings).where(eq(appSettings.key, SETTINGS_MUTED_KINDS_KEY));
  } else {
    const { setSetting } = await import('$lib/server/models/settings');
    await setSetting(SETTINGS_MUTED_KINDS_KEY, savedMuted);
  }
}

beforeAll(async () => {
  try {
    await db.select({ id: daydreamThoughts.id }).from(daydreamThoughts).limit(1);
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, SETTINGS_MUTED_KINDS_KEY));
  savedMuted = row?.value;
  await cleanup();
});

afterAll(async () => {
  if (dbReady) await cleanup();
});

describe('persistCandidates', () => {
  it('writes a candidate once and updates it thereafter', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    const first = await persistCandidates([candidate()], { runId: 'r1' });
    expect(first.created).toBe(1);

    const second = await persistCandidates(
      [candidate({ title: 'Refreshed title' })],
      { runId: 'r2' },
    );
    // Same dedupe key: an update, not a second row. Otherwise a ten-minute
    // cadence produces 144 copies of the same thought a day.
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);

    const rows = await db
      .select()
      .from(daydreamThoughts)
      .where(eq(daydreamThoughts.dedupeKey, `${PREFIX}:one`));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Refreshed title');
  });

  it('never overwrites a decision the owner already made', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    for (const status of PROTECTED_STATUSES) {
      const key = `${PREFIX}:protected:${status}`;
      await persistCandidates([candidate({ dedupeKey: key })], { runId: 'r1' });
      await db
        .update(daydreamThoughts)
        .set({ status })
        .where(eq(daydreamThoughts.dedupeKey, key));

      const again = await persistCandidates(
        [candidate({ dedupeKey: key, title: 'SHOULD NOT APPEAR' })],
        { runId: 'r2' },
      );
      expect(again.protectedSkipped).toBe(1);

      const [row] = await db
        .select()
        .from(daydreamThoughts)
        .where(eq(daydreamThoughts.dedupeKey, key));
      // "I decided this doesn't matter" must not become "I decided this OTHER
      // thing doesn't matter".
      expect(row.status).toBe(status);
      expect(row.title).not.toBe('SHOULD NOT APPEAR');
    }
  });

  it('records a sub-threshold thought as suppressed, with the reason', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    const key = `${PREFIX}:weak`;
    const res = await persistCandidates(
      [candidate({ dedupeKey: key, rawScore: 0.1 })],
      { runId: 'r1' },
    );
    expect(res.suppressed).toBe(1);

    const [row] = await db
      .select()
      .from(daydreamThoughts)
      .where(eq(daydreamThoughts.dedupeKey, key));
    // A ledger that only records what got through cannot tell you whether the
    // feature is any good.
    expect(row.status).toBe('suppressed');
    expect(row.suppressedReason).toContain('below_threshold');
  });
});

describe('feedback', () => {
  it('never_kind silences the kind outright, not statistically', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    const key = `${PREFIX}:mute-me`;
    await persistCandidates([candidate({ dedupeKey: key, kind: `${PREFIX}_mutable` })], {
      runId: 'r1',
    });
    const [row] = await db
      .select({ id: daydreamThoughts.id })
      .from(daydreamThoughts)
      .where(eq(daydreamThoughts.dedupeKey, key));

    const res = await recordFeedback(row.id, 'never_kind');
    expect(res.muted).toBe(true);

    // The escape hatch has to be one tap, and one tap has to be final — the
    // kind must not reappear on the next tick at a lower weight.
    const after = await persistCandidates(
      [candidate({ dedupeKey: `${PREFIX}:mute-me-2`, kind: `${PREFIX}_mutable` })],
      { runId: 'r2' },
    );
    expect(after.muted).toBe(1);
    expect(after.created).toBe(0);
  });

  it('a useful vote lifts the kind, an unhelpful one lowers it', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    const now = new Date();
    const up = buildScoringContext(
      [{ kind: 'k', feedback: 'useful', feedbackAt: now }],
      now,
    );
    const down = buildScoringContext(
      [{ kind: 'k', feedback: 'not_useful', feedbackAt: now }],
      now,
    );
    expect(up.weightFor('k')).toBeGreaterThan(1);
    expect(down.weightFor('k')).toBeLessThan(1);
    // An unseen kind is neutral, never punished for being new.
    expect(up.weightFor('never-seen')).toBe(1);
  });

  it('loads its own feedback back out of the database', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    const rows = await loadFeedback();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.every((r) => r.feedbackAt instanceof Date)).toBe(true);
  });
});
