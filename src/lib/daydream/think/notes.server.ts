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
import { THINK_CADENCE_MS, questionAt, type Channel, type Outcome } from './questions';
import {
  channelLabel,
  inScope,
  isForPhone,
  isOnFeed,
  outcomeLabel,
  todayNotes,
  toFeedNote,
  toNativeNote,
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
  return rows.filter(isOnFeed).map((r) => toFeedNote(r, muted));
}

/** One note by id, for `?note=` when it sits outside the loaded window. */
export async function loadFeedNote(id: string): Promise<FeedNote | null> {
  const [row] = await db
    .select(ROW_COLUMNS)
    .from(daydreamThoughts)
    .where(and(eq(daydreamThoughts.id, id), THINK_KIND))
    .limit(1);
  if (!row) return null;
  return toFeedNote(row, await mutedKinds());
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
