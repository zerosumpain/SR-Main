/**
 * Tell the owner when a connector needs them — within half an hour, on the
 * phone and on WhatsApp, and again every twelve hours until it is fixed.
 *
 * This replaces the 06:45 daily check (`monitor.ts`, retired). Gmail's refresh
 * token dies on a seven-day cycle while the Google app is in Testing mode, and
 * on 25 September it died at 07:40 — fifty-five minutes after the only check of
 * the day, so it went unnoticed for twenty-three hours, and the daily message
 * went to WhatsApp only.
 *
 * Modelled on `notify/health-watch.ts`:
 *
 * - Polls every 30 minutes, and on request (`requestConnectorCheck`, called
 *   where a refresh is refused) no sooner than a minute later.
 * - Keeps a per-connector watermark (`watch-store.ts`) — status, brokenSince,
 *   lastNotifiedAt — so a restart neither forgets nor repeats.
 * - Says something only on a TRANSITION into the `needsOwner` set, and then a
 *   reminder each time the category's floor (12h by default) has passed. The
 *   same floor is enforced again inside `notifyOwner` against the ledger,
 *   scoped by `dedupeKey: connector:<key>`, which is the half that survives
 *   anything this file gets wrong.
 * - Says nothing on recovery; the watermark is cleared and `connector.recovered`
 *   is emitted for any workflow that wants it.
 *
 * Unlike the health watcher it DOES speak on its first reading: a connector
 * already broken at deploy time is exactly what the owner has not been told.
 *
 * Kill switch `connectors.monitor.enabled` (the old monitor's, kept so a
 * setting already made still holds): false → the watcher does nothing at all.
 * Production only, like the monitor: `CONNECTOR_MONITOR_ALLOW_DEV=1` locally.
 */

import os from 'os';
import { getSetting } from '$lib/server/models/settings';
import { notifyOwner, routeFor } from '$lib/server/notify';
import { emit as emitPlatformEvent } from '$lib/events/platform-bus';
import { probeAll } from './probes';
import { alertFor, planWatch, type ConnectorMark } from './watch-core';
import { clearMarks, readMarks, writeMarks, writeSweep } from './watch-store';
import { noteConnectorCheckRan, registerConnectorCheck } from '$lib/server/connector-check';

export const SETTINGS_ENABLED_KEY = 'connectors.monitor.enabled';
export const CATEGORY = 'connections';

/** Thirty minutes. A token that dies at 07:40 is reported by 08:10. */
const DEFAULT_MS = 30 * 60 * 1000;
/** Whatever the phone's floor says, never remind more often than hourly. */
const MIN_REMIND_MS = 60 * 60 * 1000;
/** The shipped reminder cadence, used if the route cannot be read. */
const DEFAULT_REMIND_MS = 12 * 60 * 60 * 1000;

let interval: ReturnType<typeof setInterval> | undefined;
let startTimeout: ReturnType<typeof setTimeout> | undefined;
let running = false;
let inFlight: Promise<TickResult> | null = null;

export interface TickResult {
  skipped?: 'disabled' | 'error';
  probed: number;
  needsOwner: number;
  notified: string[];
  recovered: string[];
}

export function startConnectorWatch(): void {
  if (running) return;

  if (os.hostname() === 'homeserv' && process.env.CONNECTOR_MONITOR_ALLOW_DEV !== '1') {
    console.log('[connector-watch] host is homeserv — not watching. Set CONNECTOR_MONITOR_ALLOW_DEV=1 to enable locally.');
    return;
  }
  running = true;

  const raw = parseInt(process.env.CONNECTOR_WATCH_MS || '', 10);
  const ms = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MS;
  console.log(`[connector-watch] checking every ${Math.round(ms / 60000)}m`);

  registerConnectorCheck(() => tick());

  // After boot settles: the probes touch Home Assistant, WhatsApp's bridge and
  // Gmail, some of which are still connecting in the first minute.
  startTimeout = setTimeout(() => {
    startTimeout = undefined;
    void tick();
    interval = setInterval(() => void tick(), ms);
    interval.unref?.();
  }, 90_000);
  startTimeout.unref?.();
}

export function stopConnectorWatch(): void {
  if (startTimeout) clearTimeout(startTimeout);
  startTimeout = undefined;
  if (interval) clearInterval(interval);
  interval = undefined;
  registerConnectorCheck(null);
  running = false;
}

/** One check. Concurrent callers share the one in flight. Never throws. */
export function tick(now: () => Date = () => new Date()): Promise<TickResult> {
  if (inFlight) return inFlight;
  inFlight = runTick(now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function reminderMs(): Promise<number> {
  try {
    const route = await routeFor(CATEGORY);
    return Math.max(route.minIntervalSeconds * 1000, MIN_REMIND_MS);
  } catch {
    return DEFAULT_REMIND_MS;
  }
}

async function runTick(now: () => Date): Promise<TickResult> {
  const empty: TickResult = { probed: 0, needsOwner: 0, notified: [], recovered: [] };
  try {
    if ((await getSetting<boolean>(SETTINGS_ENABLED_KEY)) === false) return { ...empty, skipped: 'disabled' };

    const reports = await probeAll();
    const at = now();
    const [previous, remindAfter] = await Promise.all([readMarks(), reminderMs()]);
    const plan = planWatch(reports, previous, at, remindAfter);

    for (const mark of plan.broke) emitPlatformEvent('connector.broken', eventPayload(mark), { source: 'connector-watch' });
    for (const mark of plan.recovered) emitPlatformEvent('connector.recovered', eventPayload(mark), { source: 'connector-watch' });

    const notified: string[] = [];
    const byKey = new Map(plan.marks.map((m) => [m.key, m]));
    for (const mark of plan.due) {
      const { title, body, url } = alertFor(mark);
      const result = await notifyOwner({
        category: CATEGORY,
        severity: 'alert',
        title,
        body,
        url,
        dedupeKey: `connector:${mark.key}`,
        data: { connector: mark.key, status: mark.auth ? 'auth_expired' : 'broken', since: mark.brokenSince },
      });
      // A row was written (raised, or silently logged because both channels
      // are off): that is "told", and the next reminder counts from here. A
      // ledger duplicate is not — try again next tick, and let the ledger say
      // when the floor has passed.
      if (result.id) {
        byKey.get(mark.key)!.lastNotifiedAt = at.toISOString();
        if (result.raised) notified.push(mark.key);
      }
    }

    await writeMarks([...byKey.values()]);
    await clearMarks(plan.clear);
    await writeSweep(at, reports.length);
    noteConnectorCheckRan(at.getTime());

    if (plan.broke.length || plan.recovered.length || notified.length) {
      console.log(
        `[connector-watch] ${reports.length} probed · ${plan.marks.length} need you · notified [${notified.join(', ')}] · recovered [${plan.recovered.map((m) => m.key).join(', ')}]`,
      );
    }

    return {
      probed: reports.length,
      needsOwner: plan.marks.length,
      notified,
      recovered: plan.recovered.map((m) => m.key),
    };
  } catch (error) {
    console.error('[connector-watch] check failed', error);
    return { ...empty, skipped: 'error' };
  }
}

function eventPayload(mark: ConnectorMark): Record<string, unknown> {
  const { title, url } = alertFor(mark);
  return {
    key: mark.key,
    label: mark.label,
    group: mark.group,
    status: mark.auth ? 'auth_expired' : 'broken',
    title,
    detail: mark.detail,
    fixUrl: url,
    since: mark.brokenSince,
  };
}
