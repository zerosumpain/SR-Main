// src/lib/daydream/think/notes.server.ts
//
// The reads behind every surface that shows think notes. The mapping and every
// rule about what is shown live in `notes.ts` (pure, tested); this file only
// fetches the rows those rules run over.
//
// Why fetch-then-filter rather than one clever WHERE: the rules (which held-back
// notes still belong on the feed, what the phone may show, the channel read back
// from evidence) are the thing that must not drift between the page, the phone
// and the briefing. Written once in TypeScript they are tested; written again as
// SQL they would be three copies. The think loop writes at most ~30 notes a day,
// so a few hundred newest rows is the whole of any window a reader asks for.

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts, heartbeatActions, heartbeatPulses } from '$lib/db/schema';
import { localDayStart } from '../budget';
import { DEFAULT_SUBJECT } from '../types';
import { mutedKinds } from '../thought-store';
import { loadNoteContexts } from './context.server';
import { REPLACES_KIND, TOPIC_KINDS, TOPIC_WINDOW_DAYS, replacesEntry, supersededBy, type TopicCandidate } from './topics';
import { THINK_CADENCE_MS, questionAt, type Channel, type Outcome } from './questions';
import {
  channelLabel,
  inScope,
  isForPhone,
  isOnFeed,
  outcomeLabel,
  todayNotes,
  toFeedNote,
  toNativeDetail,
  toNativeNote,
  type NativeNoteDetail,
  type FeedNote,
  type NativeNote,
  type NoteScope,
  type ThinkRow,
} from './notes';

const THINK_KIND = sql`${daydreamThoughts.kind} like 'think\\_%'`;

/** Exactly `ThinkRow`'s columns. */
const ROW_COLUMNS = {
  id: daydreamThoughts.id,
  kind: daydreamThoughts.kind,
  title: daydreamThoughts.title,
  narrative: daydreamThoughts.narrative,
  explanation: daydreamThoughts.explanation,
  evidence: daydreamThoughts.evidence,
  status: daydreamThoughts.status,
  suppressedReason: daydreamThoughts.suppressedReason,
  feedback: daydreamThoughts.feedback,
  createdAt: daydreamThoughts.createdAt,
  deliveredAt: daydreamThoughts.deliveredAt,
  note: daydreamThoughts.note,
  reviewVerdict: daydreamThoughts.reviewVerdict,
  reviewReasoning: daydreamThoughts.reviewReasoning,
  reviewNarrative: daydreamThoughts.reviewNarrative,
  reviewModel: daydreamThoughts.reviewModel,
  proposedActions: daydreamThoughts.proposedActions,
};

/** The newest think rows for the owner, before any reader's rules. */
async function loadThinkRows(opts: { since?: Date; limit: number }): Promise<ThinkRow[]> {
  const where = [THINK_KIND, eq(daydreamThoughts.subject, DEFAULT_SUBJECT)];
  if (opts.since) where.push(gte(daydreamThoughts.createdAt, opts.since));
  return db
    .select(ROW_COLUMNS)
    .from(daydreamThoughts)
    .where(and(...where))
    .orderBy(desc(daydreamThoughts.createdAt))
    .limit(opts.limit);
}

/** The phone's Today card: the newest two from the last 48 hours. */
export async function loadTodayNotes(now = new Date()): Promise<NativeNote[]> {
  const [rows, muted] = await Promise.all([
    loadThinkRows({ since: new Date(now.getTime() - 48 * 3_600_000), limit: 100 }),
    mutedKinds(),
  ]);
  return todayNotes(rows, muted, now).map(toNativeNote);
}

/** The phone's scoped list (`/api/native/daydream`). Newest first. */
export async function loadNativeNotes(opts: { scope: NoteScope; limit: number }): Promise<NativeNote[]> {
  const [rows, muted] = await Promise.all([loadThinkRows({ limit: 300 }), mutedKinds()]);
  const out: NativeNote[] = [];
  for (const row of rows) {
    if (!isForPhone(row, muted)) continue;
    const note = toNativeNote(row);
    if (!inScope(note, opts.scope)) continue;
    out.push(note);
    if (out.length >= opts.limit) break;
  }
  return out;
}

/** The web feed. Newest first; the page groups by day. */
export async function loadFeedNotes(opts: { days?: number; now?: Date } = {}): Promise<FeedNote[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.days ?? 30) * 86_400_000);
  const [rows, muted] = await Promise.all([loadThinkRows({ since, limit: 400 }), mutedKinds()]);
  const shown = rows.filter(isOnFeed);
  const ctx = await loadNoteContexts(shown);
  return shown.map((r) => toFeedNote(r, muted, ctx.get(r.id)));
}

/** The phone's Daydream page: its notes with stage, next step and sources,
 *  and the pipeline counted over EVERY note the phone may show — not just the
 *  page it was sent — so "3 to decide" is the truth, not the page's share. */
export async function loadNativeDetail(opts: { limit: number }): Promise<{
  notes: NativeNoteDetail[];
  pipeline: Record<'decide' | 'motion' | 'done', number>;
}> {
  const [rows, muted] = await Promise.all([loadThinkRows({ limit: 300 }), mutedKinds()]);
  const shown = rows.filter((r) => isForPhone(r, muted));
  const ctx = await loadNoteContexts(shown);
  const all = shown.map((r) => toNativeDetail(r, ctx.get(r.id)));
  const pipeline = { decide: 0, motion: 0, done: 0 };
  for (const n of all) pipeline[n.bucket]++;
  return { notes: all.slice(0, opts.limit), pipeline };
}

/** One note by id, for `?note=` when it sits outside the loaded window. */
export async function loadFeedNote(id: string): Promise<FeedNote | null> {
  const [row] = await db
    .select(ROW_COLUMNS)
    .from(daydreamThoughts)
    .where(and(eq(daydreamThoughts.id, id), THINK_KIND))
    .limit(1);
  if (!row) return null;
  const [muted, ctx] = await Promise.all([mutedKinds(), loadNoteContexts([row])]);
  return toFeedNote(row, muted, ctx.get(row.id));
}

/** Think rows by dedupe key — the keys `persistCandidates` reports as newly
 *  created. Read AFTER the cycle, so each row carries the status it ended on. */
export async function loadThinkRowsByKeys(keys: readonly string[]): Promise<ThinkRow[]> {
  if (keys.length === 0) return [];
  return db
    .select(ROW_COLUMNS)
    .from(daydreamThoughts)
    .where(and(THINK_KIND, inArray(daydreamThoughts.dedupeKey, [...keys])));
}

/** The kind of a think note, or null when the id is not one. The native
 *  feedback endpoint's 404. */
export async function thinkNoteKind(id: string): Promise<string | null> {
  const [row] = await db
    .select({ kind: daydreamThoughts.kind })
    .from(daydreamThoughts)
    .where(and(eq(daydreamThoughts.id, id), THINK_KIND))
    .limit(1);
  return row?.kind ?? null;
}

/**
 * Think notes that INTERRUPTED him today — raised on the phone-shaped channel.
 * The daily cap in `run.ts` spends against this, and the feed's engine strip
 * reports it, so the two can never disagree about what "today" held.
 */
export async function countRaisedToday(now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(daydreamThoughts)
    .where(and(THINK_KIND, eq(daydreamThoughts.channel, 'push'), gte(daydreamThoughts.deliveredAt, localDayStart(now))));
  return row?.n ?? 0;
}

// ── The engine strip ───────────────────────────────────────────────────────

export interface EngineStrip {
  /** The last cycle that actually ran (not a skip). */
  last: {
    at: string;
    channel: string | null;
    outcome: string | null;
    /** `Health · A connection` — the question in the reader's words. */
    question: string | null;
    summary: string;
    ok: boolean;
  } | null;
  /** Cycles that ran today, local day. */
  cyclesToday: number;
  raisedToday: number;
  /** The question the next cycle will ask. The rotation is clock-derived, so
   *  this is knowable now: the slot a cycle one cadence after the last lands in. */
  next: { channel: Channel; outcome: Outcome; question: string };
}

/** The question in the reader's words, the order the phone labels a note. */
function questionLabel(channel: string | null, outcome: string | null): string | null {
  return channel && outcome ? `${channelLabel(channel)} · ${outcomeLabel(outcome).toLowerCase()}` : null;
}

const THINK_ACTION = 'daydream-think';

export async function loadEngineStrip(now = new Date()): Promise<EngineStrip> {
  const ran = inArray(heartbeatPulses.outcome, ['ok', 'error']);
  const [lastRows, cycleRows, raisedToday] = await Promise.all([
    db
      .select({
        ts: heartbeatPulses.ts,
        outcome: heartbeatPulses.outcome,
        summary: heartbeatPulses.summary,
        details: heartbeatPulses.details,
      })
      .from(heartbeatPulses)
      .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
      .where(and(eq(heartbeatActions.name, THINK_ACTION), ran))
      .orderBy(desc(heartbeatPulses.ts))
      .limit(1),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(heartbeatPulses)
      .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
      .where(and(eq(heartbeatActions.name, THINK_ACTION), ran, gte(heartbeatPulses.ts, localDayStart(now)))),
    countRaisedToday(now),
  ]);
  const p = lastRows[0];
  const details = (p?.details ?? {}) as { channel?: unknown; outcome?: unknown };
  const lastChannel = typeof details.channel === 'string' ? details.channel : null;
  const lastOutcome = typeof details.outcome === 'string' ? details.outcome : null;
  const nextAt = Math.max(now.getTime(), p ? p.ts.getTime() + THINK_CADENCE_MS : 0);
  const next = questionAt(new Date(nextAt));
  return {
    last: p
      ? {
          at: p.ts.toISOString(),
          channel: lastChannel,
          outcome: lastOutcome,
          question: questionLabel(lastChannel, lastOutcome),
          summary: p.summary,
          ok: p.outcome === 'ok',
        }
      : null,
    cyclesToday: cycleRows[0]?.n ?? 0,
    raisedToday,
    next: { channel: next.channel, outcome: next.outcome, question: questionLabel(next.channel, next.outcome) ?? '' },
  };
}

/**
 * A new research note replaces older, unanswered notes on the same subject
 * (`topics.ts`). The older rows are archived with the reason, never deleted;
 * the new one records what it replaced so the card can say so. Returns how
 * many were replaced. Soft: a failure here must not cost the cycle.
 */
export async function supersedeOnTopic(createdKeys: readonly string[], now = new Date()): Promise<number> {
  if (createdKeys.length === 0) return 0;
  const fresh = (await loadThinkRowsByKeys(createdKeys)).filter((r) => (TOPIC_KINDS as readonly string[]).includes(r.kind));
  if (fresh.length === 0) return 0;
  const since = new Date(now.getTime() - TOPIC_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: daydreamThoughts.id,
      kind: daydreamThoughts.kind,
      title: daydreamThoughts.title,
      createdAt: daydreamThoughts.createdAt,
      feedback: daydreamThoughts.feedback,
      reviewVerdict: daydreamThoughts.reviewVerdict,
      note: daydreamThoughts.note,
      proposedActions: daydreamThoughts.proposedActions,
      status: daydreamThoughts.status,
      // A check he commissioned is an answer too.
      checked: sql<boolean>`exists (select 1 from daydream_commissions c where c.thought_id = daydream_thoughts.id)`,
    })
    .from(daydreamThoughts)
    .where(
      and(
        inArray(daydreamThoughts.kind, [...TOPIC_KINDS]),
        eq(daydreamThoughts.subject, DEFAULT_SUBJECT),
        gte(daydreamThoughts.createdAt, since),
        inArray(daydreamThoughts.status, ['new', 'delivered', 'seen', 'suppressed']),
      ),
    );
  const older: TopicCandidate[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    createdAt: r.createdAt,
    answered:
      !!r.feedback || !!r.reviewVerdict || !!r.note || r.checked === true ||
      (Array.isArray(r.proposedActions) && (r.proposedActions as Array<{ done?: unknown }>).some((a) => !!a?.done)),
  }));
  let replaced = 0;
  for (const f of fresh) {
    const gone = supersededBy({ id: f.id, kind: f.kind, title: f.title, createdAt: f.createdAt }, older);
    if (gone.length === 0) continue;
    await db.transaction(async (tx) => {
      await tx
        .update(daydreamThoughts)
        .set({ status: 'archived', suppressedReason: `superseded: ${f.id}`, updatedAt: now })
        .where(inArray(daydreamThoughts.id, gone.map((g) => g.id)));
      const actions = Array.isArray(f.proposedActions) ? (f.proposedActions as unknown[]) : [];
      await tx
        .update(daydreamThoughts)
        .set({ proposedActions: [...actions.filter((a) => (a as { kind?: unknown })?.kind !== REPLACES_KIND), replacesEntry(gone, now)] as Array<{ kind: string; label: string; payload: string }>, updatedAt: now })
        .where(eq(daydreamThoughts.id, f.id));
    });
    // Each older note is replaced once, by the first new note that claims it.
    for (const g of gone) g.answered = true;
    replaced += gone.length;
  }
  return replaced;
}
