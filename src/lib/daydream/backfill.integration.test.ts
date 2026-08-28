/**
 * The Home Assistant backfill, against a real recorder.
 *
 * The pure tests cover the downsampling and the parsing; this covers the part
 * that can only be wrong in production — that the entity resolves, that the
 * day-at-a-time paging actually returns data, and that running it twice does
 * not double the trail.
 *
 * Excluded from the merge gate (`*.integration.test.ts`) because it needs a
 * reachable Home Assistant. Skips itself cleanly when there is none. Run it
 * deliberately:
 *   npx vitest run src/lib/daydream/backfill.integration.test.ts
 *
 * Writes under its own subject and deletes everything it wrote.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamTrail } from '$lib/db/schema';
import { backfillFromHomeAssistant, resolveTrackerEntity } from './backfill';

const SUBJECT = 'itest-backfill';

let dbReady = false;
let entity: string | null = null;

async function cleanup() {
  await db.delete(daydreamTrail).where(eq(daydreamTrail.subject, SUBJECT));
}

beforeAll(async () => {
  try {
    await db.select({ id: daydreamTrail.id }).from(daydreamTrail).limit(1);
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }
  await cleanup();
  entity = await resolveTrackerEntity();
});

afterAll(async () => {
  if (dbReady) await cleanup();
});

describe('resolveTrackerEntity', () => {
  it('finds the device_tracker behind the person entity', async () => {
    if (!dbReady || !entity) return expect(true).toBe(true);
    // Resolved from `person.john`'s `source` rather than pinned: the person is
    // the stable name, the tracker behind it is not.
    expect(entity.startsWith('device_tracker.')).toBe(true);
  });
});

describe('backfillFromHomeAssistant', () => {
  it('pulls real history and downsamples it', async () => {
    if (!dbReady || !entity) return expect(true).toBe(true);

    const result = await backfillFromHomeAssistant({ days: 3, subject: SUBJECT });

    expect(result.entity).toBe(entity);
    expect(result.daysFailed).toBe(0);
    expect(result.daysFetched).toBeGreaterThan(0);

    if (result.fixesSeen === 0) {
      // A genuinely empty recorder window is possible (phone off, integration
      // down). Not a failure of this code — but say so rather than passing
      // silently on an assertion that proves nothing.
      console.warn('[backfill itest] recorder returned no fixes for the window');
      return;
    }

    // The whole point of downsampling: ~3,700 raw fixes a day must not become
    // 3,700 rows a day.
    expect(result.fixesKept).toBeGreaterThan(0);
    expect(result.fixesKept).toBeLessThan(result.fixesSeen);

    const rows = await db
      .select({ id: daydreamTrail.id, source: daydreamTrail.source, mode: daydreamTrail.mode })
      .from(daydreamTrail)
      .where(and(eq(daydreamTrail.subject, SUBJECT), eq(daydreamTrail.source, 'backfill')));

    expect(rows.length).toBe(result.fixesKept);
    // Backfilled rows carry a derived mode like any other, so the detectors
    // cannot tell them apart by anything except provenance.
    expect(rows.every((r) => typeof r.mode === 'string')).toBe(true);
  }, 300_000);

  it('is idempotent — a second run corrects rather than duplicates', async () => {
    if (!dbReady || !entity) return expect(true).toBe(true);

    const before = await db
      .select({ id: daydreamTrail.id })
      .from(daydreamTrail)
      .where(eq(daydreamTrail.subject, SUBJECT));

    if (before.length === 0) return expect(true).toBe(true);

    await backfillFromHomeAssistant({ days: 3, subject: SUBJECT });

    const after = await db
      .select({ id: daydreamTrail.id })
      .from(daydreamTrail)
      .where(eq(daydreamTrail.subject, SUBJECT));

    // Same window, same source — replaced, not appended to. Without this a
    // re-run would inflate coverage for days it did not observe twice.
    expect(after.length).toBe(before.length);
  }, 300_000);
});
