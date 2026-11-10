// src/lib/daydream/act/loops.ts
//
// Open loops: notes that reached him with a step one press would carry out,
// and got no answer. PURE — which notes are loops, when one is due a chase,
// and what the chase says. Sending it is `loops.server.ts`.
//
// Over the 30 days to 2026-11-10, 113 notes were pushed and 13 were answered;
// 168 expired unread. Nothing ever came back to a note: it was said once, at
// whatever moment the clock picked, and then it aged out. A chase is the
// second and LAST time a note speaks — once, when its date is close or it has
// sat two days — and it leads with the step, not the finding.

import { readStored } from './plan';
import { readSolve } from './solution';
import { splitNarrative } from '../think/explain';

/** Chases a day. They come out of the same daily allowance as new notes. */
export const CHASES_PER_DAY = 2;
/** A note is not chased sooner than this after it was sent. */
export const CHASE_MIN_AGE_HOURS = 20;
/** An undated note is chased once it has sat this long … */
export const CHASE_AFTER_DAYS = 2;
/** … and never after this: by then it is past its shelf and being swept. */
export const CHASE_MAX_AGE_DAYS = 7;
const HOUR_MS = 3_600_000;

export interface LoopRow {
  id: string;
  title: string;
  narrative: string | null;
  actions: unknown;
  /** When it reached him. */
  deliveredAt: Date;
  /** The last London day it is worth acting on, `YYYY-MM-DD`, or null. */
  until: string | null;
}

/** The press waiting on a note, in the button's own words, or null. */
export function openStep(actions: unknown): string | null {
  const act = readStored(actions);
  if (act) return act.stored.done ? null : act.stored.label;
  const s = readSolve(actions);
  // A page to open is not a loop: there is nothing to be done FOR him.
  if (!s || s.stored.done || s.plan.kind === 'open') return null;
  return s.stored.label;
}

function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Is this note due its one chase? A dated note on its last day or the day
 * before; an undated one after two days. `chased` is every note already
 * chased — a note is never chased twice.
 */
export function chaseDue(row: LoopRow, opts: { now: Date; today: string; chased: ReadonlySet<string> }): boolean {
  if (opts.chased.has(row.id) || !openStep(row.actions)) return false;
  const ageH = (opts.now.getTime() - row.deliveredAt.getTime()) / HOUR_MS;
  if (ageH < CHASE_MIN_AGE_HOURS || ageH > CHASE_MAX_AGE_DAYS * 24) return false;
  if (row.until) return row.until === opts.today || row.until === nextDay(opts.today);
  return ageH >= CHASE_AFTER_DAYS * 24;
}

/** Dated notes first, soonest date first; then the oldest. */
export function chaseOrder(a: LoopRow, b: LoopRow): number {
  if (a.until && b.until) return a.until.localeCompare(b.until) || a.deliveredAt.getTime() - b.deliveredAt.getTime();
  if (a.until || b.until) return a.until ? -1 : 1;
  return a.deliveredAt.getTime() - b.deliveredAt.getTime();
}

export function chaseText(row: LoopRow, today: string): { title: string; body: string } {
  const step = openStep(row.actions) ?? '';
  const { next } = splitNarrative(row.narrative);
  const when = !row.until ? '' : row.until === today ? ' Today is the last day for it.' : ' Tomorrow is the last day for it.';
  return {
    title: `Still open: ${row.title}`.slice(0, 120),
    body: `${next ? `${next.replace(/\s+$/, '')}${/[.!?]$/.test(next.trim()) ? '' : '.'} ` : ''}One tap does it: ${step}.${when} Or say it is not for you, and it stops.`,
  };
}

// ── The weekly digest ──────────────────────────────────────────────────────

/** Why a note with nothing to do did not interrupt him (`run.ts`). */
export const NO_STEP_REASON = 'feed_only: no step';

/** Sunday evening, London: the one push for a week of notes that asked nothing. */
export function digestDue(now: Date, lastWeek: string | null): { due: boolean; week: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const week = `${get('year')}-${get('month')}-${get('day')}`;
  return { due: get('weekday') === 'Sun' && Number(get('hour')) >= 18 && lastWeek !== week, week };
}

export function digestText(titles: readonly string[], count: number): { title: string; body: string } {
  const shown = titles.slice(0, 3).map((t) => `• ${t}`);
  const more = count - shown.length;
  return {
    title: `This week: ${count} thing${count === 1 ? '' : 's'} noticed, nothing to do`,
    body: [...shown, ...(more > 0 ? [`…and ${more} more on the feed.`] : [])].join('\n'),
  };
}
