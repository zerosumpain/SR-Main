// src/lib/daydream/calendar/store.ts
//
// Storage for the diary filter. The decisions all live in `exclusions.ts`;
// this is the thin database half.

import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamCalendarExclusions } from '$lib/db/schema';
import {
  ExclusionSet,
  NO_EXCLUSIONS,
  exclusionKey,
  titleKeyOf,
  type ExclusionScope,
} from './exclusions';

export interface StoredExclusion {
  id: string;
  scope: ExclusionScope;
  uid: string | null;
  occurrenceStart: string | null;
  titleKey: string | null;
  title: string | null;
  calendarName: string | null;
  reason: string | null;
  matchKey: string;
  createdAt: string;
}

/**
 * Every rule, newest first.
 *
 * The page needs the display fields as well as the match key — a year from
 * now "series:04F3A1…" means nothing to anybody, and a list of hidden things
 * that cannot be read is a list nobody will ever revise.
 */
export async function listExclusions(): Promise<StoredExclusion[]> {
  const rows = await db
    .select()
    .from(daydreamCalendarExclusions)
    .orderBy(desc(daydreamCalendarExclusions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope as ExclusionScope,
    uid: r.uid,
    occurrenceStart: r.occurrenceStart?.toISOString() ?? null,
    titleKey: r.titleKey,
    title: r.title,
    calendarName: r.calendarName,
    reason: r.reason,
    matchKey: r.matchKey,
    createdAt: r.createdAt.toISOString(),
  }));
}

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
    const rows = await db
      .select({ matchKey: daydreamCalendarExclusions.matchKey })
      .from(daydreamCalendarExclusions);
    return new ExclusionSet(rows.map((r) => r.matchKey));
  } catch (err) {
    console.error('[daydream] calendar exclusions unreadable, showing the whole diary:', err);
    return NO_EXCLUSIONS;
  }
}

export interface AddExclusionInput {
  scope: ExclusionScope;
  uid?: string | null;
  occurrenceStart?: string | null;
  /** The event's title. Used as the match key for `title` scope, and kept for
   *  display in every scope. */
  title?: string | null;
  calendarName?: string | null;
  reason?: string | null;
}

/**
 * Add one rule, or refresh the one already covering the same thing.
 *
 * Idempotent on `matchKey`: excluding the same series twice updates the reason
 * rather than creating a second row that can never be removed from the page.
 */
export async function addExclusion(
  input: AddExclusionInput,
): Promise<{ ok: true; id: string; matchKey: string } | { ok: false; error: string }> {
  const matchKey = exclusionKey({
    scope: input.scope,
    uid: input.uid,
    occurrenceStart: input.occurrenceStart,
    titleKey: input.title,
  });
  if (!matchKey) {
    // The commonest real cause: a series exclusion on an event whose entry
    // carries no UID. Saying so beats storing a rule that matches nothing.
    return {
      ok: false,
      error:
        input.scope === 'title'
          ? 'That event has no title to match on.'
          : 'That event has no calendar UID, so it can only be hidden by title.',
    };
  }

  const values = {
    scope: input.scope,
    uid: input.uid ?? null,
    occurrenceStart: input.occurrenceStart ? new Date(input.occurrenceStart) : null,
    titleKey: input.scope === 'title' ? titleKeyOf(input.title) : null,
    title: input.title ?? null,
    calendarName: input.calendarName ?? null,
    reason: input.reason?.trim() || null,
    matchKey,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(daydreamCalendarExclusions)
    .values(values)
    .onConflictDoUpdate({
      target: daydreamCalendarExclusions.matchKey,
      set: { reason: values.reason, title: values.title, updatedAt: values.updatedAt },
    })
    .returning({ id: daydreamCalendarExclusions.id });

  return { ok: true, id: row.id, matchKey };
}

/** Restore. One tap on the page; nothing about it is a special case, which is
 *  what makes a total exclusion safe to offer in the first place. */
export async function removeExclusion(id: string): Promise<boolean> {
  const rows = await db
    .delete(daydreamCalendarExclusions)
    .where(eq(daydreamCalendarExclusions.id, id))
    .returning({ id: daydreamCalendarExclusions.id });
  return rows.length > 0;
}
