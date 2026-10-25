// src/lib/home/presence/health-week.ts
//
// A person's week of health from the app, in four numbers: steps a day,
// sleep a night, workouts and their minutes. Read off the pilot's day
// timelines (`pilotDay`) — whatever the person chose to upload, nothing
// inferred. PURE.
//
// Who sees it is the caller's business: the owner sees everyone's, each
// person their own (decided 2026-10-25, replacing "members' health is shown
// nowhere").

import type { DayTimeline } from './companion-accounts';

export interface HealthDay {
  /** Local date. */
  date: string;
  /** The day's window, epoch seconds. */
  from: number;
  to: number;
  timeline: DayTimeline;
}

export interface WeekHealth {
  days: number;
  /** Mean over the days that had a step count; null when none did. */
  steps: number | null;
  stepDays: number;
  /** Mean hours asleep over the nights that had sleep; null when none did. */
  sleepHours: number | null;
  nights: number;
  workouts: number;
  workoutMinutes: number;
}

/**
 * A day's step count from the pilot's records: it keeps ONE cumulative record
 * per local day, so pick, never sum — the largest among those starting in the
 * window. The same rule as the steps board (`$lib/family/steps`), restated
 * here because family already imports home and the reverse would be a cycle.
 */
function daySteps(records: DayTimeline['steps'], from: number, to: number): number | null {
  let best: number | null = null;
  for (const r of records) {
    const at = Date.parse(r.start) / 1000;
    if (!Number.isFinite(at) || at < from || at >= to || !Number.isFinite(r.value) || r.value < 0) continue;
    best = Math.max(best ?? 0, Math.round(r.value));
  }
  return best;
}

/** Stages that are not sleep: lying awake, or merely in bed. */
const NOT_ASLEEP = new Set(['awake', 'inbed', 'in_bed', 'in bed']);

/** Total length of a set of intervals, overlaps counted once. */
function unionMs(spans: Array<[number, number]>): number {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, start = -Infinity, end = -Infinity;
  for (const [a, b] of sorted) {
    if (a > end) { total += end - start > 0 ? end - start : 0; start = a; end = b; } else end = Math.max(end, b);
  }
  return total + (end - start > 0 ? end - start : 0);
}

/** One person's week. Sleep spans are read once however many day reads they appear in. PURE. */
export function weekHealth(days: readonly HealthDay[]): WeekHealth {
  const steps = days.map((d) => daySteps(d.timeline.steps, d.from, d.to)).filter((n): n is number => n != null);
  const sleep = new Map<string, [number, number]>();
  const workouts = new Map<string, number>();
  for (const d of days) {
    for (const s of d.timeline.sleep) {
      if (NOT_ASLEEP.has(s.stage.toLowerCase())) continue;
      sleep.set(`${s.start}|${s.end}|${s.stage}`, [Date.parse(s.start), Date.parse(s.end)]);
    }
    for (const w of d.timeline.workouts) workouts.set(`${w.start}|${w.activity}`, w.seconds);
  }
  // A night is the wake-up day it ends on.
  const nights = new Map<string, Array<[number, number]>>();
  for (const span of sleep.values()) {
    const night = new Date(span[1] + 6 * 3_600_000).toISOString().slice(0, 10);
    const list = nights.get(night) ?? [];
    list.push(span); nights.set(night, list);
  }
  const hours = [...nights.values()].map((spans) => unionMs(spans) / 3_600_000).filter((h) => h >= 1);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    days: days.length,
    steps: steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null,
    stepDays: steps.length,
    sleepHours: hours.length ? round1(hours.reduce((a, b) => a + b, 0) / hours.length) : null,
    nights: hours.length,
    workouts: workouts.size,
    workoutMinutes: Math.round([...workouts.values()].reduce((a, b) => a + b, 0) / 60),
  };
}
