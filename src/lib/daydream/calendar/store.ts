// src/lib/daydream/calendar/store.ts
//
// Storage for the diary filter — the READ half. The decisions all live in
// `exclusions.ts`. The think loop's `diary` tool reads through this; the
// write half (the calendar room's hide / note / restore) went with the room
// in P4a (2026-09-25), so the rules already stored keep applying and no new
// ones are written.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamCalendarExclusions } from '$lib/db/schema';
import { ExclusionSet, NO_EXCLUSIONS } from './exclusions';

/**
 * The matcher, built from the stored rules.
 *
 * FAILS OPEN. If this query throws, the engine sees the whole diary rather
 * than none of it. The alternative — failing closed — would leave it quietly
 * believing the owner has no commitments at all, which is the more dangerous
 * of the two wrong answers by a distance.
 */
export async function loadExclusionSet(): Promise<ExclusionSet> {
  try {
    // Only rows that HIDE. A note-only row explains an event and must not
    // remove it — hiding a PE day would hide the kit reminder with it.
    const rows = await db
      .select({ matchKey: daydreamCalendarExclusions.matchKey })
      .from(daydreamCalendarExclusions)
      .where(eq(daydreamCalendarExclusions.hidden, true));
    return new ExclusionSet(rows.map((r) => r.matchKey));
  } catch (err) {
    console.error('[daydream] calendar exclusions unreadable, showing the whole diary:', err);
    return NO_EXCLUSIONS;
  }
}
