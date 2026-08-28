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
  /** False when this row explains the event rather than hiding it. */
  hidden: boolean;
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
    hidden: r.hidden,
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

export interface AddExclusionInput {
  /** False writes a note that explains the event without hiding it. */
  hidden?: boolean;
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
    hidden: input.hidden !== false,
    matchKey,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(daydreamCalendarExclusions)
    .values(values)
    .onConflictDoUpdate({
      target: daydreamCalendarExclusions.matchKey,
      set: {
        reason: values.reason,
        title: values.title,
        // Upsert carries the visibility too: noting an event you had already
        // hidden must not silently un-hide it, and hiding one you had only
        // annotated must actually hide it.
        hidden: values.hidden,
        updatedAt: values.updatedAt,
      },
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

/**
 * What the owner has told the engine about specific diary entries.
 *
 * Only the note-only rows: a hidden event is gone from every prompt, so
 * carding its reason would describe something the model cannot see. Read by
 * the ponder pack, which is the whole reason a note-without-hiding exists.
 */
export async function diaryNotes(limit = 20): Promise<Array<{ id: string; title: string | null; reason: string; scope: ExclusionScope }>> {
  try {
    const rows = await db
      .select({
        id: daydreamCalendarExclusions.id,
        title: daydreamCalendarExclusions.title,
        reason: daydreamCalendarExclusions.reason,
        scope: daydreamCalendarExclusions.scope,
      })
      .from(daydreamCalendarExclusions)
      .where(eq(daydreamCalendarExclusions.hidden, false))
      .orderBy(desc(daydreamCalendarExclusions.updatedAt))
      .limit(limit);
    return rows
      .filter((r): r is typeof r & { reason: string } => !!r.reason?.trim())
      .map((r) => ({ id: r.id, title: r.title, reason: r.reason, scope: r.scope as ExclusionScope }));
  } catch {
    return [];
  }
}
