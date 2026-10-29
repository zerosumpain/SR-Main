// src/lib/daydream/act/track.server.ts
//
// Trackers, stored and checked (`track.ts`). They live in one `app_settings`
// row — a dozen small objects at most, so no table and no grant — and are
// written through one in-process queue so two presses never lose each other.

import { randomUUID } from 'node:crypto';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { localDay } from '../features/build';
import { noteHref } from '../think/notes';
import type { TrackPlan } from './solution';
import {
  BASELINE_DAYS,
  MAX_RUNNING_TRACKERS,
  dueForReport,
  newTracker,
  progress,
  progressLine,
  resultText,
  type DayValue,
  type Tracker,
  type TrackerProgress,
} from './track';

export const TRACKERS_KEY = 'daydream.trackers';
/** Finished and stopped trackers kept for the register. */
const KEEP_ENDED = 60;

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

export async function loadTrackers(): Promise<Tracker[]> {
  const v = await getSetting<Tracker[]>(TRACKERS_KEY);
  return Array.isArray(v) ? v.filter((t) => t && typeof t.id === 'string') : [];
}

async function save(list: Tracker[]): Promise<void> {
  const running = list.filter((t) => !t.stoppedAt && !t.reportedAt);
  const ended = list.filter((t) => t.stoppedAt || t.reportedAt).slice(-KEEP_ENDED);
  await setSetting(TRACKERS_KEY, [...ended, ...running]);
}

export async function startTracker(plan: TrackPlan, note: { id: string; title: string }, now = new Date()): Promise<{ ok: true; tracker: Tracker; already: boolean } | { ok: false; reason: string }> {
  return serial(async () => {
    const list = await loadTrackers();
    const mine = list.find((t) => t.thoughtId === note.id && !t.stoppedAt && !t.reportedAt);
    if (mine) return { ok: true, tracker: mine, already: true };
    if (list.filter((t) => !t.stoppedAt && !t.reportedAt).length >= MAX_RUNNING_TRACKERS) {
      return { ok: false, reason: `${MAX_RUNNING_TRACKERS} trackers are already running. Stop one on the Solutions page first.` };
    }
    const tracker = newTracker(plan, note, localDay(now), randomUUID(), now);
    await save([...list, tracker]);
    return { ok: true, tracker, already: false };
  });
}

export async function stopTracker(id: string, now = new Date()): Promise<boolean> {
  return serial(async () => {
    const list = await loadTrackers();
    const t = list.find((x) => x.id === id);
    if (!t || t.stoppedAt || t.reportedAt) return false;
    t.stoppedAt = now.toISOString();
    await save(list);
    return true;
  });
}

/** The series a tracker reads, from the 28 days before it began to today. */
export async function trackerSeries(t: Tracker, now = new Date()): Promise<DayValue[]> {
  const span = Math.round((now.getTime() - Date.parse(`${t.startDay}T00:00:00Z`)) / 86_400_000) + BASELINE_DAYS + 2;
  const window = Math.min(120, Math.max(BASELINE_DAYS + 2, span));
  const { seriesDays } = await import('$lib/owner-data/health.server');
  return (await seriesDays(t.metric, window, now)) ?? [];
}

export interface TrackerView extends Tracker {
  progress: TrackerProgress;
  line: string;
}

export async function trackerViews(now = new Date()): Promise<TrackerView[]> {
  const today = localDay(now);
  const list = await loadTrackers();
  return Promise.all(
    list.map(async (t) => {
      const days = await trackerSeries(t, now).catch(() => [] as DayValue[]);
      const p = progress(t, days, today);
      return { ...t, progress: p, line: t.result ?? progressLine(t, p) };
    }),
  );
}

/**
 * Send the result of every tracker that has ended, once. Called by the think
 * activity each cycle; costs no model call, and nothing at all on a day no
 * tracker ends.
 */
export async function reportFinishedTrackers(now = new Date()): Promise<number> {
  const today = localDay(now);
  const due = dueForReport(await loadTrackers(), today);
  if (!due.length) return 0;
  const { notifyOwner } = await import('$lib/server/notify');
  let sent = 0;
  for (const t of due) {
    const days = await trackerSeries(t, now).catch(() => [] as DayValue[]);
    const text = resultText(t, progress(t, days, today));
    await notifyOwner({
      category: 'daydream',
      title: `Tracker finished: ${t.label}`.slice(0, 120),
      body: text,
      url: noteHref(t.thoughtId),
      dedupeKey: `daydream-tracker:${t.id}`,
      data: { thoughtId: t.thoughtId, trackerId: t.id },
    }).catch(() => null);
    await serial(async () => {
      const list = await loadTrackers();
      const row = list.find((x) => x.id === t.id);
      if (row && !row.reportedAt) {
        row.reportedAt = now.toISOString();
        row.result = text;
        await save(list);
      }
    });
    sent++;
  }
  return sent;
}
