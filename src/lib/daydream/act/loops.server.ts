// src/lib/daydream/act/loops.server.ts
//
// Chasing open loops, and the weekly digest (`loops.ts`). No model call: both
// run from the think activity before its spare-cycle gates, like tracker
// results, so a busy evening does not hold a chase past its date.

import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings, daydreamThoughts } from '$lib/db/schema';
import { notifyOwner } from '$lib/server/notify';
import { DEFAULT_SUBJECT } from '../types';
import { DAILY_RAISE_CAP, DAYDREAM_CHANNELS, FEED_PATH, noteHref } from '../think/notes';
import { countRaisedToday } from '../think/notes.server';
import { localDayOf } from '../think/shelf';
import { CHASES_PER_DAY, CHASE_MAX_AGE_DAYS, NO_STEP_REASON, chaseDue, chaseOrder, chaseText, digestDue, digestText, type LoopRow } from './loops';

export const LOOPS_KEY = 'daydream.loops';
const KEEP_CHASES = 200;

interface LoopsState {
  /** `raised` false: the route held it back. Still its one chase, but not a push spent. */
  chases: Array<{ id: string; at: string; raised?: boolean }>;
  digestWeek: string | null;
}

function clean(raw: unknown): LoopsState {
  const r = raw && typeof raw === 'object' ? (raw as Partial<LoopsState>) : {};
  return {
    chases: (Array.isArray(r.chases) ? r.chases : []).filter((c) => c && typeof c.id === 'string' && typeof c.at === 'string').slice(-KEEP_CHASES),
    digestWeek: typeof r.digestWeek === 'string' ? r.digestWeek : null,
  };
}

/** Read straight from the table: `getSetting`'s cache is per process. */
async function loadLoops(): Promise<LoopsState> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LOOPS_KEY)).limit(1);
  return clean(row?.value);
}

async function change(fn: (s: LoopsState) => LoopsState): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOOPS_KEY}))`);
    const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LOOPS_KEY)).limit(1);
    const next = fn(clean(row?.value));
    await tx
      .insert(appSettings)
      .values({ key: LOOPS_KEY, value: next })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  });
}

/** Chases sent today — they spend the same allowance as new notes (`run.ts`). */
export async function chasesToday(now = new Date()): Promise<number> {
  const today = localDayOf(now);
  return (await loadLoops()).chases.filter((c) => c.raised !== false && localDayOf(new Date(c.at)) === today).length;
}

const THINK_KIND = sql`${daydreamThoughts.kind} like 'think\\_%'`;

/** Chase the notes due one. Returns how many went. */
export async function chaseOpenLoops(now = new Date()): Promise<{ chased: number; due: number }> {
  const state = await loadLoops();
  const today = localDayOf(now);
  const sentToday = state.chases.filter((c) => c.raised !== false && localDayOf(new Date(c.at)) === today).length;
  if (sentToday >= CHASES_PER_DAY) return { chased: 0, due: 0 };

  const rows = await db
    .select({
      id: daydreamThoughts.id,
      title: daydreamThoughts.title,
      narrative: daydreamThoughts.narrative,
      actions: daydreamThoughts.proposedActions,
      deliveredAt: daydreamThoughts.deliveredAt,
      relevantUntil: daydreamThoughts.relevantUntil,
    })
    .from(daydreamThoughts)
    .where(
      and(
        THINK_KIND,
        eq(daydreamThoughts.subject, DEFAULT_SUBJECT),
        eq(daydreamThoughts.channel, 'push'),
        inArray(daydreamThoughts.status, ['delivered', 'seen']),
        isNull(daydreamThoughts.feedback),
        gte(daydreamThoughts.deliveredAt, new Date(now.getTime() - CHASE_MAX_AGE_DAYS * 86_400_000)),
      ),
    )
    .orderBy(desc(daydreamThoughts.deliveredAt))
    .limit(200);

  const chased = new Set(state.chases.map((c) => c.id));
  const due = rows
    .filter((r): r is typeof r & { deliveredAt: Date } => !!r.deliveredAt)
    .map((r): LoopRow => ({ id: r.id, title: r.title, narrative: r.narrative, actions: r.actions, deliveredAt: r.deliveredAt, until: r.relevantUntil ? localDayOf(r.relevantUntil) : null }))
    .filter((r) => chaseDue(r, { now, today, chased }))
    .sort(chaseOrder);
  if (!due.length) return { chased: 0, due: 0 };

  let budget = Math.min(CHASES_PER_DAY - sentToday, DAILY_RAISE_CAP - (await countRaisedToday(now)) - sentToday);
  let sent = 0;
  for (const row of due) {
    if (budget <= 0) break;
    const text = chaseText(row, today);
    const res = await notifyOwner({
      category: 'daydream',
      title: text.title,
      body: text.body,
      url: noteHref(row.id),
      dedupeKey: `daydream-chase:${row.id}`,
      channels: DAYDREAM_CHANNELS,
      data: { thoughtId: row.id, chase: true },
    }).catch(() => null);
    // Marked whether or not the route let it through: one chase, ever.
    await change((s) => ({ ...s, chases: [...s.chases, { id: row.id, at: now.toISOString(), raised: !!res?.raised }].slice(-KEEP_CHASES) }));
    if (res?.raised) {
      sent++;
      budget--;
    }
  }
  return { chased: sent, due: due.length };
}

/** Sunday evening: one push for the week's notes that had nothing to do. */
export async function sendWeeklyDigest(now = new Date()): Promise<boolean> {
  const state = await loadLoops();
  const { due, week } = digestDue(now, state.digestWeek);
  if (!due) return false;
  const rows = await db
    .select({ title: daydreamThoughts.title })
    .from(daydreamThoughts)
    .where(
      and(
        THINK_KIND,
        eq(daydreamThoughts.subject, DEFAULT_SUBJECT),
        eq(daydreamThoughts.status, 'suppressed'),
        eq(daydreamThoughts.suppressedReason, NO_STEP_REASON),
        isNull(daydreamThoughts.feedback),
        gte(daydreamThoughts.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
      ),
    )
    .orderBy(desc(daydreamThoughts.createdAt))
    .limit(50);
  if (!rows.length) {
    await change((s) => ({ ...s, digestWeek: week }));
    return false;
  }
  const text = digestText(rows.map((r) => r.title), rows.length);
  const res = await notifyOwner({
    category: 'daydream',
    title: text.title,
    body: text.body,
    url: FEED_PATH,
    dedupeKey: `daydream-digest:${week}`,
    channels: DAYDREAM_CHANNELS,
  }).catch(() => null);
  // Stamped only once it went, or was already sent: a failed raise tries again next cycle.
  if (res?.raised || res?.reason === 'duplicate') await change((s) => ({ ...s, digestWeek: week }));
  return !!res?.raised;
}
