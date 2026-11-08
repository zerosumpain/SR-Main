// src/lib/daydream/act/track.ts
//
// Trackers: the `track` solution (`solution.ts`). PURE — what one is, how its
// progress is judged, and the words of its result.
//
// A tracker follows one measured series against a daily target for a fixed
// run of days, starting the day he presses. It judges itself against the 28
// days BEFORE it started, so "sleep averaged 7.4 h" comes with "against 6.8 h
// before" — the difference an experiment is for. A day with no reading is
// missing, never a miss: a Whoop left on the charger is not a bad night.

import { TRACK_WORDS, type TrackPlan } from './solution';

export const BASELINE_DAYS = 28;
/** At most this many trackers running at once — more is a dashboard nobody reads. */
export const MAX_RUNNING_TRACKERS = 12;

export interface Tracker extends Omit<TrackPlan, 'kind'> {
  id: string;
  thoughtId: string;
  noteTitle: string;
  /** Local days, inclusive. */
  startDay: string;
  endDay: string;
  createdAt: string;
  stoppedAt: string | null;
  /** When the result went to him; set once. */
  reportedAt: string | null;
  /** The result as sent, kept for the register. */
  result: string | null;
}

export interface DayValue {
  day: string;
  value: number;
}

export interface TrackerProgress {
  status: 'running' | 'finished' | 'stopped';
  daysIn: number;
  daysLeft: number;
  recorded: number;
  hits: number;
  average: number | null;
  baseline: number | null;
  /** Hits as a share of recorded days, or null with nothing recorded. */
  rate: number | null;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

export function newTracker(plan: TrackPlan, note: { id: string; title: string }, today: string, id: string, now: Date): Tracker {
  return {
    id,
    thoughtId: note.id,
    noteTitle: note.title.slice(0, 120),
    metric: plan.metric,
    goal: plan.goal,
    target: plan.target,
    days: plan.days,
    label: plan.label,
    startDay: today,
    endDay: addDays(today, plan.days - 1),
    createdAt: now.toISOString(),
    stoppedAt: null,
    reportedAt: null,
    result: null,
  };
}

export function hit(t: Pick<Tracker, 'goal' | 'target'>, v: number): boolean {
  return t.goal === 'at_least' ? v >= t.target : v <= t.target;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Where a tracker stands, from its series. `days` may span before the start. */
export function progress(t: Tracker, days: readonly DayValue[], today: string): TrackerProgress {
  const last = today < t.endDay ? today : t.endDay;
  const inRun = days.filter((d) => d.day >= t.startDay && d.day <= last);
  const before = days.filter((d) => d.day < t.startDay && d.day >= addDays(t.startDay, -BASELINE_DAYS));
  const hits = inRun.filter((d) => hit(t, d.value)).length;
  const status = t.stoppedAt ? 'stopped' : today > t.endDay ? 'finished' : 'running';
  return {
    status,
    daysIn: Math.max(0, Math.min(t.days, daysBetween(t.startDay, last) + 1)),
    daysLeft: Math.max(0, daysBetween(today, t.endDay) + (status === 'running' ? 1 : 0)),
    recorded: inRun.length,
    hits,
    average: mean(inRun.map((d) => d.value)),
    baseline: mean(before.map((d) => d.value)),
    rate: inRun.length ? hits / inRun.length : null,
  };
}

function fmt(n: number | null, unit: string): string {
  if (n == null) return 'no reading';
  const a = Math.abs(n);
  const v = a >= 100 ? Math.round(n) : a >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
  return `${v}${unit ? ` ${unit}` : ''}`;
}

/** One line: how it is going, or how it went. */
export function progressLine(t: Tracker, p: TrackerProgress): string {
  const w = TRACK_WORDS[t.metric];
  const target = `${t.goal === 'at_least' ? 'at least' : 'at most'} ${fmt(t.target, w.unit)}`;
  if (!p.recorded) {
    return p.status === 'running'
      ? `No ${w.label.toLowerCase()} readings since it started (${p.daysIn} day${p.daysIn === 1 ? '' : 's'} in). Target ${target}.`
      : `No ${w.label.toLowerCase()} readings during its ${p.daysIn} days, so there is nothing to judge. Target was ${target}.`;
  }
  const vs = p.baseline != null ? ` against ${fmt(p.baseline, w.unit)} in the ${BASELINE_DAYS} days before` : '';
  return `${p.hits} of ${p.recorded} recorded day${p.recorded === 1 ? '' : 's'} on target (${target}); averaging ${fmt(p.average, w.unit)}${vs}.`;
}

/** The result he is sent when it ends. */
export function resultText(t: Tracker, p: TrackerProgress): string {
  const line = progressLine(t, p);
  let verdict = '';
  if (p.rate != null && p.recorded >= Math.min(5, t.days)) {
    verdict = p.rate >= 0.8 ? ' It held.' : p.rate >= 0.5 ? ' Partly held.' : ' It did not hold.';
    if (p.average != null && p.baseline != null) {
      const better = t.goal === 'at_least' ? p.average > p.baseline : p.average < p.baseline;
      verdict += better ? ' The average moved the way you wanted.' : ' The average did not move the way you wanted.';
    }
  } else if (p.recorded) {
    verdict = ' Too few readings to judge.';
  }
  return `“${t.label}” — ${t.days} days, ${t.startDay} to ${t.endDay}. ${line}${verdict}`;
}

/** Trackers that have ended and not yet been reported. */
export function dueForReport(trackers: readonly Tracker[], today: string): Tracker[] {
  return trackers.filter((t) => !t.stoppedAt && !t.reportedAt && today > t.endDay);
}
