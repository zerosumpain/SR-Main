// src/lib/monitors/event-monitors.server.ts
//
// "Tell me when <event> happens" (workflow knit 2026-11-11, slice 5). An event
// monitor is the smallest thing that does it: a platform event type from the
// catalogue, an optional filter over the payload's top-level fields
// (`$lib/events/filter`), and a notification to the owner through
// `notifyOwner` when a matching event is raised.
//
// Kept as one list under a settings key: no table, no column. The list is
// small and capped, and is read on each event through the settings cache.
//
// Loops. A monitor's own notification raises `notification.raised`, which a
// monitor on that type would match and notify about again. Three walls:
//   1. each notification is raised under an id chosen here and remembered, and
//      a `notification.raised` carrying a remembered id is never matched;
//   2. an event at the chain depth limit is never matched;
//   3. every monitor has a floor between two notifications, enforced by
//      `notifyOwner` under the monitor's own dedupe key.

import { randomUUID } from 'node:crypto';
import { canonicalEventType, eventEntry, isKnownEventType } from '$lib/events/catalogue';
import { matchesFilter, normaliseFilter, type FilterClause } from '$lib/events/filter';
import { onAll, type PlatformEvent } from '$lib/events/platform-bus';
import { MAX_CHAIN_DEPTH } from '$lib/workflows-client/event-bus';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { notifyOwner } from '$lib/server/notify';

export const EVENT_MONITORS_KEY = 'monitors.events';
export const MAX_EVENT_MONITORS = 20;
/** The least and the default gap between two notifications from one monitor. */
export const MIN_INTERVAL_MINUTES = 1;
export const DEFAULT_INTERVAL_MINUTES = 10;
export const MAX_INTERVAL_MINUTES = 24 * 60;
/** The notification category a monitor raises under. */
export const EVENT_MONITOR_CATEGORY = 'system';

export interface EventMonitor {
  id: string;
  eventType: string;
  filter: FilterClause[];
  label: string;
  minMinutes: number;
  createdAt: string;
}

export interface EventMonitorInput {
  eventType: unknown;
  filter?: unknown;
  label?: unknown;
  minMinutes?: unknown;
}

export async function listEventMonitors(): Promise<EventMonitor[]> {
  const stored = await getSetting<EventMonitor[]>(EVENT_MONITORS_KEY).catch(() => null);
  return Array.isArray(stored) ? stored.filter((m) => m && typeof m.id === 'string' && typeof m.eventType === 'string') : [];
}

/** Validate what chat asked for. PURE. */
export function parseEventMonitor(
  input: EventMonitorInput,
): { ok: true; monitor: Omit<EventMonitor, 'id' | 'createdAt'> } | { ok: false; error: string } {
  const raw = typeof input.eventType === 'string' ? input.eventType.trim() : '';
  if (!raw || !isKnownEventType(raw)) return { ok: false, error: 'event must be an event type from the catalogue (event_monitor_list names them).' };
  const eventType = canonicalEventType(raw);
  const f = normaliseFilter(input.filter);
  if (!f.ok) return { ok: false, error: f.error };
  const asked = typeof input.minMinutes === 'number' && Number.isFinite(input.minMinutes) ? Math.trunc(input.minMinutes) : DEFAULT_INTERVAL_MINUTES;
  const minMinutes = Math.max(MIN_INTERVAL_MINUTES, Math.min(MAX_INTERVAL_MINUTES, asked));
  const label = (typeof input.label === 'string' && input.label.trim() ? input.label.trim() : (eventEntry(eventType)?.label ?? eventType)).slice(0, 120);
  return { ok: true, monitor: { eventType, filter: f.filter, label, minMinutes } };
}

export async function createEventMonitor(input: EventMonitorInput, now = new Date()): Promise<{ ok: true; monitor: EventMonitor } | { ok: false; error: string }> {
  const parsed = parseEventMonitor(input);
  if (!parsed.ok) return parsed;
  const all = await listEventMonitors();
  if (all.length >= MAX_EVENT_MONITORS) return { ok: false, error: `There are already ${MAX_EVENT_MONITORS} event monitors; remove one first.` };
  const monitor: EventMonitor = { id: `em_${randomUUID().replace(/-/g, '').slice(0, 12)}`, ...parsed.monitor, createdAt: now.toISOString() };
  await setSetting(EVENT_MONITORS_KEY, [...all, monitor]);
  return { ok: true, monitor };
}

export async function removeEventMonitor(id: string): Promise<EventMonitor | null> {
  const all = await listEventMonitors();
  const found = all.find((m) => m.id === id) ?? null;
  if (found) await setSetting(EVENT_MONITORS_KEY, all.filter((m) => m.id !== id));
  return found;
}

// ————————————————————————————— firing

/** Ids of notifications raised from here, newest last. */
const ownNotifications = new Set<string>();
const MAX_OWN = 500;
function remember(id: string): void {
  ownNotifications.add(id);
  if (ownNotifications.size > MAX_OWN) ownNotifications.delete(ownNotifications.values().next().value as string);
}

/** Whether this event is one a monitor may be matched against at all. PURE but for the id set. */
export function monitorable(event: PlatformEvent): boolean {
  if ((event.chainDepth ?? 0) >= MAX_CHAIN_DEPTH) return false;
  if (event.type === 'notification.raised') {
    const id = event.payload?.id;
    if (typeof id === 'string' && ownNotifications.has(id)) return false;
  }
  return true;
}

const short = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 160);

/** The few payload fields worth a line in the notification. PURE. */
export function eventLine(event: PlatformEvent): string {
  const p = event.payload ?? {};
  for (const key of ['title', 'summary', 'name', 'message', 'text', 'status']) {
    const v = short(p[key]);
    if (v) return v;
  }
  return eventEntry(event.type)?.description ?? event.type;
}

/** Match one event against the stored monitors and notify. Returns the monitors that raised. */
export async function handleEvent(event: PlatformEvent): Promise<string[]> {
  if (!monitorable(event)) return [];
  const type = canonicalEventType(event.type);
  const monitors = (await listEventMonitors()).filter((m) => m.eventType === type && matchesFilter(event.payload, m.filter));
  const raised: string[] = [];
  for (const m of monitors) {
    const id = randomUUID();
    remember(id);
    const out = await notifyOwner({
      eventId: id,
      category: EVENT_MONITOR_CATEGORY,
      title: m.label,
      body: eventLine(event),
      url: '/jkai/daydreams/watches',
      dedupeKey: `event-monitor:${m.id}`,
      minIntervalSeconds: m.minMinutes * 60,
      data: { monitorId: m.id, eventType: type, eventId: event.id ?? null },
    }).catch(() => ({ raised: false }));
    if (out.raised) raised.push(m.id);
  }
  return raised;
}

let off: (() => void) | null = null;

/** Subscribe once. Called at boot from the monitors tool module. */
export function startEventMonitors(): void {
  if (off) return;
  off = onAll((event) => {
    void handleEvent(event).catch((err) => console.error('[event-monitors]', err instanceof Error ? err.message : err));
  });
}

/** Tests only. */
export function stopEventMonitors(): void {
  off?.();
  off = null;
  ownNotifications.clear();
}
