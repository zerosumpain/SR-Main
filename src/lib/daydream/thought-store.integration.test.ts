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
import { TITLE_ECHO_SIMILARITY, titleSimilarity } from './refutations';
import type { Candidate } from './snapshot-types';

const PREFIX = 'itest_dd';
let dbReady = false;
let savedMuted: unknown = undefined;

/**
 * A fixture candidate whose CLAIM is unique per dedupe key.
 *
 * The title and explanation used to be fixed strings, so every row this file
 * wrote made the same claim as every other. That was harmless until
 * `persistCandidates` learned to FOLD a candidate into a live row saying the
 * same thing: from then on the second fixture row in the file was merged into
 * the first instead of inserted, `created` was 0, and the row the test then
 * looked up did not exist — `Cannot read properties of undefined (reading
 * 'id')`, every nightly.
 *
 * Deriving the claim from the key keeps the fixtures distinct claims, which is
 * what they were always meant to be. A caller that wants to exercise folding
 * passes an explicit title, and a caller that wants an UPDATE passes the same
 * `dedupeKey` — which is what identity means here.
 */
/**
 * An unrelated noun phrase per dedupe key.
 *
 * NOT decoration. `persistCandidates` folds a candidate into a live row that
 * makes the same claim, and "same claim" is a trigram similarity on the TITLE
 * at `TITLE_ECHO_SIMILARITY` (0.6). Every fixture in this file used to be
 * titled "A test thought", so the second row written was folded into the
 * first: `created` came back 0, the row the test then looked up did not exist,
 * and `row.id` threw. That is one of the five failures that had the nightly
 * red from 2026-08-19.
 *
 * A shared stem is not enough to separate them — `A test thought about
 * <key>` still scores **0.944** against its sibling, because trigrams over a
 * long common prefix swamp the difference. So the title has to share no stem
 * at all. `fixtureTitles` below asserts that this actually holds rather than
 * trusting it.
 */
function claimPhrase(dedupeKey: string): string {
  let h = 0;
  for (const c of dedupeKey) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const subject = ['otter', 'kettle', 'harbour', 'lantern', 'quarry', 'bramble', 'satchel', 'meridian'];
  const verb = ['drifts', 'hums', 'folds', 'settles', 'rusts', 'waits', 'tilts', 'burns'];
  return `${subject[h % subject.length]} ${verb[Math.floor(h / 8) % verb.length]} ${h % 9973}`;
}

function candidate(over: Partial<Candidate> = {}): Candidate {
  const dedupeKey = over.dedupeKey ?? `${PREFIX}:one`;
  const phrase = claimPhrase(dedupeKey);
  return {
    kind: `${PREFIX}_kind`,
    title: `The ${phrase}`,
    explanation: `Because the fixture said so about the ${phrase}.`,
    rawScore: 0.9,
    components: { fixture: 1 },
    evidence: [{ kind: 'place', id: 'p1' }],
    placeId: null,
    proposedActions: [],
    ...over,
    dedupeKey,
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

// The guard on the fixture itself. Without it, a later edit that gives two
// keys similar titles reintroduces exactly the fold that made this file fail
// every night for a fortnight — and it would fail in a way that points at
// `recordFeedback` rather than at the fixture.
describe('the fixtures are distinct claims', () => {
  it('no two keys in this file are within the title-echo threshold', () => {
    const keys = [
      `${PREFIX}:one`,
      `${PREFIX}:weak`,
      `${PREFIX}:mute-me`,
      `${PREFIX}:mute-me-2`,
      ...PROTECTED_STATUSES.map((s) => `${PREFIX}:protected:${s}`),
    ];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const score = titleSimilarity(candidate({ dedupeKey: keys[i] }).title, candidate({ dedupeKey: keys[j] }).title);
        // The pair is named in the message so a failure says WHICH two keys
        // collided rather than only that one pair did.
        expect({ pair: `${keys[i]} vs ${keys[j]}`, under: score < TITLE_ECHO_SIMILARITY }).toEqual({
          pair: `${keys[i]} vs ${keys[j]}`,
          under: true,
        });
      }
    }
  });
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
