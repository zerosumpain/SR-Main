// src/lib/daydream/think/subjects.server.ts — reads and writes behind `subjects.ts`.

import { and, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { DEFAULT_SUBJECT } from '../types';
import { isDecline, reasonOf } from '../reasons';
import { REPLACES_KIND, replacesEntry } from './topics';
import { SEEN_AGAIN_KIND, SUBJECT_EVIDENCE_KIND, SUBJECT_WINDOW_DAYS, subjectOf, withSeenAgain, type EarlierNote } from './subjects';
import type { Coverage } from './interests';

/** Statuses a newer note may archive: still a card he could act on. An
 *  expired note was filed — by him, or by the past-its-date sweep — and stays put. */
const OPEN_STATUSES = ['new', 'delivered', 'seen', 'suppressed'];

function hasSubject(key: string) {
  return sql`${daydreamThoughts.evidence} @> ${JSON.stringify([{ kind: SUBJECT_EVIDENCE_KIND, id: key }])}::jsonb`;
}

interface SubjectRow extends EarlierNote {
  key: string;
  feedback: string | null;
  feedbackNote: string | null;
}

/**
 * Every think note on these subjects from the window — EVERY status, which is
 * the point: an expired note was still said, and the loop's old ALREADY SAID
 * block forgot it the moment it expired.
 */
export async function loadSubjectNotes(keys: readonly string[], now: Date, days = SUBJECT_WINDOW_DAYS): Promise<SubjectRow[]> {
  if (keys.length === 0) return [];
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({
      id: daydreamThoughts.id,
      title: daydreamThoughts.title,
      narrative: daydreamThoughts.narrative,
      evidence: daydreamThoughts.evidence,
      status: daydreamThoughts.status,
      feedback: daydreamThoughts.feedback,
      feedbackNote: daydreamThoughts.feedbackNote,
      reviewVerdict: daydreamThoughts.reviewVerdict,
      note: daydreamThoughts.note,
      proposedActions: daydreamThoughts.proposedActions,
      createdAt: daydreamThoughts.createdAt,
      checked: sql<boolean>`exists (select 1 from daydream_commissions c where c.thought_id = daydream_thoughts.id)`,
    })
    .from(daydreamThoughts)
    .where(
      and(
        like(daydreamThoughts.kind, 'think_%'),
        eq(daydreamThoughts.subject, DEFAULT_SUBJECT),
        gte(daydreamThoughts.createdAt, since),
        or(...keys.map(hasSubject)),
      ),
    )
    .orderBy(desc(daydreamThoughts.createdAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    key: subjectOf(r.evidence) ?? '',
    title: r.title,
    text: `${r.title}\n${r.narrative ?? ''}`,
    createdAt: r.createdAt,
    feedback: r.feedback,
    feedbackNote: r.feedbackNote,
    answered:
      !!r.feedback || !!r.reviewVerdict || !!r.note || r.checked === true ||
      (Array.isArray(r.proposedActions) &&
        (r.proposedActions as Array<{ kind?: unknown; done?: unknown }>).some((a) => !!a?.done && a.kind !== REPLACES_KIND && a.kind !== SEEN_AGAIN_KIND)),
    open: OPEN_STATUSES.includes(r.status),
  }));
}

/** A repeat: no new note — the earlier one records that it was found again. */
export async function foldInto(id: string, day: string, now: Date): Promise<void> {
  const [row] = await db
    .select({ proposedActions: daydreamThoughts.proposedActions })
    .from(daydreamThoughts)
    .where(eq(daydreamThoughts.id, id))
    .limit(1);
  if (!row) return;
  await db
    .update(daydreamThoughts)
    .set({
      proposedActions: withSeenAgain(row.proposedActions, day, now) as Array<{ kind: string; label: string; payload: string }>,
      recurrenceCount: sql`${daydreamThoughts.recurrenceCount} + 1`,
      updatedAt: now,
    })
    .where(eq(daydreamThoughts.id, id));
}

/**
 * A revision: the older unanswered notes on the subject are archived under the
 * new one, which records what it replaced — the same record `topics.ts` keeps,
 * so the card's "Replaces …" line needs nothing new.
 */
export async function supersedeOnSubject(
  freshId: string,
  older: ReadonlyArray<{ id: string; title: string }>,
  now: Date,
): Promise<number> {
  if (older.length === 0) return 0;
  await db.transaction(async (tx) => {
    await tx
      .update(daydreamThoughts)
      .set({ status: 'archived', suppressedReason: `superseded: ${freshId}`, updatedAt: now })
      .where(inArray(daydreamThoughts.id, older.map((o) => o.id)));
    const [fresh] = await tx
      .select({ proposedActions: daydreamThoughts.proposedActions })
      .from(daydreamThoughts)
      .where(eq(daydreamThoughts.id, freshId))
      .limit(1);
    const actions = Array.isArray(fresh?.proposedActions) ? (fresh!.proposedActions as Array<{ kind?: unknown }>) : [];
    await tx
      .update(daydreamThoughts)
      .set({
        proposedActions: [...actions.filter((a) => a?.kind !== REPLACES_KIND), replacesEntry(older, now)] as Array<{ kind: string; label: string; payload: string }>,
        updatedAt: now,
      })
      .where(eq(daydreamThoughts.id, freshId));
  });
  return older.length;
}

/** Subjects already said in the window, newest first: key → newest title.
 *  `prefix` limits a research cycle to its own `topic:` keys. */
export async function recentSubjects(now: Date, opts: { prefix?: string; limit?: number } = {}): Promise<Array<{ key: string; title: string; at: Date }>> {
  const since = new Date(now.getTime() - SUBJECT_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({ title: daydreamThoughts.title, evidence: daydreamThoughts.evidence, createdAt: daydreamThoughts.createdAt })
    .from(daydreamThoughts)
    .where(
      and(
        like(daydreamThoughts.kind, 'think_%'),
        eq(daydreamThoughts.subject, DEFAULT_SUBJECT),
        gte(daydreamThoughts.createdAt, since),
        sql`${daydreamThoughts.evidence} @> ${JSON.stringify([{ kind: SUBJECT_EVIDENCE_KIND }])}::jsonb`,
      ),
    )
    .orderBy(desc(daydreamThoughts.createdAt))
    .limit(300);
  const seen = new Map<string, { key: string; title: string; at: Date }>();
  for (const r of rows) {
    const key = subjectOf(r.evidence);
    if (!key || seen.has(key)) continue;
    if (opts.prefix && !key.startsWith(opts.prefix)) continue;
    seen.set(key, { key, title: r.title, at: r.createdAt });
  }
  return [...seen.values()].slice(0, opts.limit ?? 30);
}

/** When each research interest was last looked into, and his verdicts on it. */
export async function interestCoverage(now: Date, days = 90): Promise<Map<string, Coverage>> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({
      evidence: daydreamThoughts.evidence,
      createdAt: daydreamThoughts.createdAt,
      feedback: daydreamThoughts.feedback,
      feedbackNote: daydreamThoughts.feedbackNote,
    })
    .from(daydreamThoughts)
    .where(
      and(
        like(daydreamThoughts.kind, 'think_%'),
        gte(daydreamThoughts.createdAt, since),
        sql`${daydreamThoughts.evidence} @> ${JSON.stringify([{ kind: SUBJECT_EVIDENCE_KIND }])}::jsonb`,
      ),
    )
    .orderBy(desc(daydreamThoughts.createdAt))
    .limit(500);
  const out = new Map<string, { lastAt: Date; verdicts: boolean[] }>();
  for (const r of rows) {
    const key = subjectOf(r.evidence);
    if (!key?.startsWith('topic:')) continue;
    const c = out.get(key) ?? { lastAt: r.createdAt, verdicts: [] };
    const reason = reasonOf(r.feedbackNote);
    if (r.feedback === 'not_useful' || r.feedback === 'never_kind' || isDecline(reason)) c.verdicts.push(true);
    else if (r.feedback === 'useful') c.verdicts.push(false);
    out.set(key, c);
  }
  return out;
}
