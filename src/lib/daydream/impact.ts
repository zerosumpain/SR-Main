// src/lib/daydream/impact.ts
//
// Is daydream worth having? PURE aggregation behind /jkai/daydreams/impact and
// the phone's Impact card. The reads are in `impact.server.ts`.
//
// ── What is measured, and why these ─────────────────────────────────────────
//
// * A note COUNTS when it reached him: on the feed (think notes, `isOnFeed`)
//   or, for the retired engine, delivered or rated. Notes the audit threw away
//   were never his to judge.
// * HIT RATE = useful ÷ rated. Unrated notes are not failures, they are
//   unknown — so the decided share is reported beside it, never folded in.
// * ACTED ON = a fact check he approved, or a build idea he accepted into the
//   build queue. RESULT = the check's report came back, or the build shipped.
// * Weeks include the retired engine (before 25 Sep 2026) on purpose: it is the
//   only baseline that says whether the question-led loop is any better.

import { isOnFeed, isThinkKind, outcomeLabel, channelLabel, outcomeOf, thinkChannelOf } from './think/notes';

export const IMPACT_WINDOW_DAYS = 28;
export const IMPACT_WEEKS = 12;
/** P1 of the 2026-09-25 simplification: the first think note. */
export const LOOP_START = '2026-09-25';

export interface ImpactRow {
  kind: string;
  status: string;
  suppressedReason: string | null;
  feedback: string | null;
  feedbackAt: Date | null;
  createdAt: Date;
  deliveredAt: Date | null;
  evidence: unknown;
}

export interface ImpactCommission {
  state: string;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ImpactBuild {
  status: string;
  accepted: boolean;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WindowStats {
  noticed: number;
  rated: number;
  useful: number;
  /** useful ÷ rated; null with nothing rated. */
  hitRate: number | null;
  /** rated ÷ noticed; null with nothing noticed. */
  decidedShare: number | null;
  /** Median hours from note to verdict, over notes rated in the window. */
  medianHoursToDecide: number | null;
}

export interface WeekBar {
  /** Monday, UTC, `YYYY-MM-DD`. */
  start: string;
  noticed: number;
  useful: number;
  notUseful: number;
  undecided: number;
  /** Which engine wrote the week's notes. */
  engine: 'loop' | 'legacy' | 'mixed' | 'none';
}

export interface Breakdown {
  key: string;
  label: string;
  noticed: number;
  rated: number;
  useful: number;
}

export interface Funnel {
  spotted: number;
  decided: number;
  useful: number;
  actedOn: number;
  result: number;
}

export interface Impact {
  windowDays: number;
  loopStart: string;
  current: WindowStats;
  previous: WindowStats;
  weeks: WeekBar[];
  byArea: Breakdown[];
  byKind: Breakdown[];
  funnel: Funnel;
  /** Pipeline right now, across every note on the feed. */
  checks: { awaiting: number; running: number; completed: number };
  builds: { proposed: number; accepted: number; shipped: number };
}

const DAY = 86_400_000;

/** Did this note reach him? */
export function counts(r: Pick<ImpactRow, 'kind' | 'status' | 'suppressedReason' | 'feedback' | 'deliveredAt'>): boolean {
  if (isThinkKind(r.kind)) return isOnFeed(r);
  return r.deliveredAt != null || r.feedback != null;
}

export function isUseful(feedback: string | null): boolean {
  return feedback === 'useful';
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function windowStats(rows: ImpactRow[], from: Date, to: Date): WindowStats {
  const inWin = rows.filter((r) => r.createdAt >= from && r.createdAt < to);
  const rated = inWin.filter((r) => r.feedback != null);
  const useful = rated.filter((r) => isUseful(r.feedback)).length;
  const waits = rated
    .filter((r) => r.feedbackAt)
    .map((r) => Math.max(0, (r.feedbackAt!.getTime() - r.createdAt.getTime()) / 3_600_000));
  return {
    noticed: inWin.length,
    rated: rated.length,
    useful,
    hitRate: rated.length ? useful / rated.length : null,
    decidedShare: inWin.length ? rated.length / inWin.length : null,
    medianHoursToDecide: median(waits),
  };
}

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7;
  return new Date(x.getTime() - dow * DAY);
}

export function weekBars(rows: ImpactRow[], now: Date, weeks = IMPACT_WEEKS): WeekBar[] {
  const last = weekStart(now);
  const out: WeekBar[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(last.getTime() - i * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    const wk = rows.filter((r) => r.createdAt >= start && r.createdAt < end);
    const loop = wk.filter((r) => isThinkKind(r.kind)).length;
    const useful = wk.filter((r) => isUseful(r.feedback)).length;
    const notUseful = wk.filter((r) => r.feedback != null && !isUseful(r.feedback)).length;
    out.push({
      start: start.toISOString().slice(0, 10),
      noticed: wk.length,
      useful,
      notUseful,
      undecided: wk.length - useful - notUseful,
      engine: wk.length === 0 ? 'none' : loop === wk.length ? 'loop' : loop === 0 ? 'legacy' : 'mixed',
    });
  }
  return out;
}

function breakdown(rows: ImpactRow[], keyOf: (r: ImpactRow) => string, labelOf: (k: string) => string): Breakdown[] {
  const m = new Map<string, Breakdown>();
  for (const r of rows) {
    const key = keyOf(r);
    const b = m.get(key) ?? { key, label: labelOf(key), noticed: 0, rated: 0, useful: 0 };
    b.noticed++;
    if (r.feedback != null) b.rated++;
    if (isUseful(r.feedback)) b.useful++;
    m.set(key, b);
  }
  return [...m.values()].sort((a, b) => b.noticed - a.noticed || a.label.localeCompare(b.label));
}

export function computeImpact(
  allRows: ImpactRow[],
  commissions: ImpactCommission[],
  builds: ImpactBuild[],
  now: Date,
  windowDays = IMPACT_WINDOW_DAYS,
): Impact {
  const rows = allRows.filter(counts);
  const from = new Date(now.getTime() - windowDays * DAY);
  const prevFrom = new Date(from.getTime() - windowDays * DAY);
  const current = windowStats(rows, from, now);
  const previous = windowStats(rows, prevFrom, from);

  // Area and kind are the loop's own vocabulary, so only its notes.
  const loopRows = rows.filter((r) => isThinkKind(r.kind) && r.createdAt >= from);
  const byArea = breakdown(
    loopRows,
    (r) => thinkChannelOf(r.evidence, outcomeOf(r.kind)) ?? 'mixed',
    (k) => channelLabel(k === 'mixed' ? null : k),
  );
  const byKind = breakdown(loopRows, (r) => outcomeOf(r.kind), outcomeLabel);

  const inWindow = (d: Date | null) => !!d && d >= from && d < now;
  const approved = commissions.filter((c) => inWindow(c.approvedAt)).length;
  const reported = commissions.filter((c) => c.state === 'completed' && inWindow(c.updatedAt)).length;
  const accepted = builds.filter((b) => inWindow(b.acceptedAt)).length;
  const shipped = builds.filter((b) => b.status === 'shipped' && inWindow(b.updatedAt)).length;

  return {
    windowDays,
    loopStart: LOOP_START,
    current,
    previous,
    weeks: weekBars(rows, now),
    byArea,
    byKind,
    funnel: {
      spotted: current.noticed,
      decided: current.rated,
      useful: current.useful,
      actedOn: approved + accepted,
      result: reported + shipped,
    },
    checks: {
      awaiting: commissions.filter((c) => c.state === 'awaiting_approval' || c.state === 'needs_attention').length,
      running: commissions.filter((c) => c.state === 'queued' || c.state === 'running' || c.state === 'deferred').length,
      completed: commissions.filter((c) => c.state === 'completed').length,
    },
    builds: {
      proposed: builds.filter((b) => b.status === 'open' && !b.accepted).length,
      accepted: builds.filter((b) => b.status === 'open' && b.accepted).length,
      shipped: builds.filter((b) => b.status === 'shipped').length,
    },
  };
}

/** The phone's compact Impact card. Optional on the wire. */
export interface NativeImpact {
  windowDays: number;
  hitRate: number | null;
  previousHitRate: number | null;
  noticed: number;
  rated: number;
  useful: number;
  actedOn: number;
  result: number;
  weeks: Array<{ start: string; useful: number; notUseful: number; undecided: number }>;
}

export function toNativeImpact(i: Impact): NativeImpact {
  return {
    windowDays: i.windowDays,
    hitRate: i.current.hitRate,
    previousHitRate: i.previous.hitRate,
    noticed: i.current.noticed,
    rated: i.current.rated,
    useful: i.current.useful,
    actedOn: i.funnel.actedOn,
    result: i.funnel.result,
    weeks: i.weeks.map(({ start, useful, notUseful, undecided }) => ({ start, useful, notUseful, undecided })),
  };
}
