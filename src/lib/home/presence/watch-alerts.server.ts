// src/lib/home/presence/watch-alerts.server.ts
//
// Tells the owner's phone about what the travel desk notices: someone who has
// not left when they usually do, a journey running long, a phone gone quiet
// away from home, and time to leave for something in the diary. Each KIND is
// off until the owner switches it on at /home/people — a new source of
// interruptions is opt-in, never inherited.
//
// Through `notifyOwner` (category `family`): the ledger, the per-category
// routing the phone controls, and a dedupe key per occurrence, so a run every
// two minutes raises each thing once. Called from the home-observe heartbeat.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { WATCH_KINDS, type WatchItem } from './forecast';
import type { AgendaItem } from './agenda';

export const NOTIFY_KEY = 'home.presence.notify';
export const NOTIFY_KINDS = [...WATCH_KINDS, 'leave-by'] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export type NotifySettings = Record<NotifyKind, boolean>;

export const NOTIFY_LABELS: Record<NotifyKind, string> = {
  overdue: 'Hasn’t left when they usually do',
  'running-long': 'A journey running long',
  quiet: 'A phone quiet for hours away from home',
  'leave-by': 'Time to leave for something in the diary',
};

const OFF: NotifySettings = { overdue: false, 'running-long': false, quiet: false, 'leave-by': false };

export async function loadNotifySettings(): Promise<NotifySettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, NOTIFY_KEY));
  const stored = (row?.value ?? {}) as Partial<NotifySettings>;
  return Object.fromEntries(NOTIFY_KINDS.map((k) => [k, stored[k] === true])) as NotifySettings;
}

export async function saveNotifySettings(settings: NotifySettings): Promise<void> {
  const value = Object.fromEntries(NOTIFY_KINDS.map((k) => [k, settings[k] === true]));
  await db.insert(appSettings).values({ key: NOTIFY_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Leave-by reminders go this long before the leave-by time. */
export const LEAVE_NUDGE_MINS = 10;

/** The raises owed now, from the forecast's watch list and the agenda. PURE. */
export function owedAlerts(
  settings: NotifySettings,
  watch: WatchItem[],
  agenda: AgendaItem[],
  names: Map<string, string>,
  now: Date,
): Array<{ key: string; title: string; body: string; severity: 'info' | 'warn' | 'alert' }> {
  const out: Array<{ key: string; title: string; body: string; severity: 'info' | 'warn' | 'alert' }> = [];
  for (const w of watch) {
    if (!settings[w.kind]) continue;
    out.push({ key: w.key, title: w.title, body: w.detail, severity: w.severity === 'alert' ? 'alert' : 'warn' });
  }
  if (settings['leave-by']) {
    for (const a of agenda) {
      if (!a.leaveBy || !a.travel) continue;
      const until = (+new Date(a.leaveBy) - +now) / 60_000;
      if (until > LEAVE_NUDGE_MINS || until < -5) continue;
      const who = a.subjects.map((s) => names.get(s) ?? s).join(', ');
      const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      out.push({
        key: `leave-by:${a.id}`,
        title: `Leave by ${clock.format(new Date(a.leaveBy))} for ${a.title}`,
        body: `${who} · ${a.place?.label ?? a.location} at ${clock.format(new Date(a.start))} · about ${Math.round(a.travel.median)} min${a.travel.source === 'routed' ? ' (routed)' : ''}.`,
        severity: 'info',
      });
    }
  }
  return out;
}

/** Agenda reads hit the owner's calendar: at most one every ten minutes from here. */
let agendaMemo: { at: number; items: AgendaItem[] } | null = null;

export async function deliverWatchAlerts(now = new Date()): Promise<{ raised: number }> {
  const settings = await loadNotifySettings();
  if (!NOTIFY_KINDS.some((k) => settings[k])) return { raised: 0 };
  const { loadForecast } = await import('./forecast.server');
  const read = await loadForecast({ kind: 'owner' }, 28, null, now);
  const names = new Map(read.insights.people.map((p) => [p.subject, p.displayName]));
  let agenda: AgendaItem[] = [];
  if (settings['leave-by']) {
    if (!agendaMemo || +now - agendaMemo.at > 10 * 60_000) {
      const { loadAgenda } = await import('./agenda.server');
      const a = await loadAgenda({ routes: read.insights.routes, live: read.insights.live, homeId: read.homeId, now });
      agendaMemo = { at: +now, items: a.available ? a.items : [] };
    }
    agenda = agendaMemo.items;
  }
  const { notifyOwner } = await import('$lib/server/notify');
  let raised = 0;
  for (const alert of owedAlerts(settings, read.forecast.watch, agenda, names, now)) {
    const result = await notifyOwner({
      category: 'family', title: alert.title, body: alert.body, url: '/home/people', severity: alert.severity,
      dedupeKey: alert.key,
      // Each key is one occurrence; the floor makes a two-minute cadence raise it once.
      minIntervalSeconds: 12 * 60 * 60,
    });
    if (result.raised) raised++;
  }
  return { raised };
}
