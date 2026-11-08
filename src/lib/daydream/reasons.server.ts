// src/lib/daydream/reasons.server.ts — the writer and reader behind `reasons.ts`.

import { and, desc, eq, gte, inArray, like, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { DEFAULT_SUBJECT } from './types';
import { REASON_VERDICT, TASTE_IN_PROMPT, type Reason, type TasteRow } from './reasons';
import { QUESTION_EVIDENCE_KIND } from './think/audit';

/** How far back the taste block reads. */
export const TASTE_WINDOW_DAYS = 90;

/**
 * Record his reason. A "yes" or "no" reason goes through `recordFeedback`, the
 * one verdict writer, so it moves the kind's weight exactly as the buttons do.
 * "Not now" files the note away with NO verdict — status `expired`, as "File
 * it" does — so a note that came on the wrong day costs its kind nothing.
 */
export async function recordReason(thoughtId: string, reason: Reason): Promise<{ verdict: 'useful' | 'not_useful' | null }> {
  const verdict = REASON_VERDICT[reason];
  if (verdict) {
    const { recordFeedback } = await import('./thought-store');
    await recordFeedback(thoughtId, verdict, reason, 'explicit');
    return { verdict };
  }
  const now = new Date();
  const [row] = await db
    .update(daydreamThoughts)
    .set({
      feedback: null,
      feedbackNote: reason,
      feedbackSource: 'explicit',
      feedbackAt: now,
      status: 'expired',
      suppressedReason: 'owner: not now',
      updatedAt: now,
    })
    .where(eq(daydreamThoughts.id, thoughtId))
    .returning({ id: daydreamThoughts.id });
  if (!row) throw new Error(`no such thought: ${thoughtId}`);
  return { verdict: null };
}

/**
 * His "already knew" / "not my thing" answers, newest first.
 *
 * `researchOnly` is the injection boundary: a research cycle reads the web, so
 * it may see only the titles research cycles wrote — the same rule as its
 * ALREADY SAID block (`run.ts`).
 */
export async function loadTaste(now: Date, opts: { researchOnly: boolean }): Promise<TasteRow[]> {
  const since = new Date(now.getTime() - TASTE_WINDOW_DAYS * 86_400_000);
  const where = [
    like(daydreamThoughts.kind, 'think_%'),
    eq(daydreamThoughts.subject, DEFAULT_SUBJECT),
    inArray(daydreamThoughts.feedbackNote, ['already_knew', 'not_my_thing']),
    gte(daydreamThoughts.feedbackAt, since),
  ];
  if (opts.researchOnly) {
    where.push(sql`${daydreamThoughts.evidence} @> ${JSON.stringify([{ kind: QUESTION_EVIDENCE_KIND, id: 'research' }])}::jsonb`);
  }
  const rows = await db
    .select({ title: daydreamThoughts.title, note: daydreamThoughts.feedbackNote })
    .from(daydreamThoughts)
    .where(and(...where))
    .orderBy(desc(daydreamThoughts.feedbackAt))
    .limit(TASTE_IN_PROMPT * 2);
  return rows.map((r) => ({ title: r.title, reason: r.note as Reason }));
}
