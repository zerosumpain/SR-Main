/**
 * Tell me when my health figures move — and not more often than every three hours.
 *
 * Two halves, and the interesting one is the second.
 *
 * **Did it change?** Not "is it a new day" and not "is the number different to
 * one decimal place at this instant". The summary carries a fingerprint over
 * the four rounded figures and the readiness score; a tick that hashes to the
 * same string says nothing. That is what makes polling every fifteen minutes
 * free: nothing happens on a quiet afternoon.
 *
 * **How often may it speak?** The floor lives on the category, defaults to
 * three hours, and is enforced inside `notifyOwner` against the ledger. It is
 * NOT enforced here with a timestamp of its own — a second copy of the rule
 * would be a second thing to keep in step, and the one in the ledger is the one
 * that survives a restart. This watcher's interval is therefore free to be
 * anything shorter than the floor.
 *
 * The watcher does not notify on the FIRST reading it ever sees. There is no
 * change to report against an absent watermark, and a fresh deploy waking
 * everybody up to say "recovery is 61%" is the sort of thing that gets
 * notifications turned off for good.
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { notificationWatermarks } from '$lib/db/schema';
import { getNativeHealthSummary, type NativeHealthSummary } from '$lib/server/native-health';
import { notifyOwner, pruneEvents } from './index';
import { emit as emitPlatformEvent } from '$lib/events/platform-bus';

const WATERMARK_ID = 'health';

/** Fifteen minutes. Far under the three-hour floor, deliberately — see above. */
const DEFAULT_MS = 15 * 60 * 1000;

let interval: ReturnType<typeof setInterval> | undefined;
let startTimeout: ReturnType<typeof setTimeout> | undefined;
let running = false;

export function startHealthWatch(): void {
  if (running) return;

  // The lane, not the schedule, decides whether this can run at all. Health is
  // a different container reached through its gateway's service lane, and
  // without the token that lane is closed — on a development box it always is.
  // Starting anyway would mean a caught-and-logged failure every fifteen
  // minutes for ever, which is how a log stops being read.
  if (!process.env.HEALTH_SERVICE_TOKEN) {
    console.log('[health-watch] HEALTH_SERVICE_TOKEN is not set — not watching');
    return;
  }

  running = true;

  // A NaN interval makes setInterval fire as fast as it can, which here would
  // be a service-lane call to Health in a tight loop. Same guard as the
  // hero-titles scheduler, and for the same reason.
  const raw = parseInt(process.env.HEALTH_WATCH_MS || '', 10);
  const ms = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MS;
  console.log(`[health-watch] checking every ${Math.round(ms / 60000)}m`);

  // Let the app finish booting first. Health is a different container and may
  // still be coming up behind its own gateway.
  startTimeout = setTimeout(() => {
    startTimeout = undefined;
    void tick();
    interval = setInterval(() => void tick(), ms);
  }, 45_000);
}

export function stopHealthWatch(): void {
  if (startTimeout) clearTimeout(startTimeout);
  startTimeout = undefined;
  if (interval) clearInterval(interval);
  interval = undefined;
  running = false;
}

/** One check. Exported so a test can run it without a timer. */
export async function tick(): Promise<{ changed: boolean; raised: boolean }> {
  try {
    const summary = await getNativeHealthSummary({ fresh: true });

    // A demonstration series is not a measurement, and telling somebody their
    // recovery moved when the numbers are synthetic is worse than silence.
    if (summary.isMock) return { changed: false, raised: false };

    const [previous] = await db
      .select()
      .from(notificationWatermarks)
      .where(eq(notificationWatermarks.id, WATERMARK_ID))
      .limit(1);

    if (previous?.fingerprint === summary.fingerprint) return { changed: false, raised: false };

    await db
      .insert(notificationWatermarks)
      .values({
        id: WATERMARK_ID,
        fingerprint: summary.fingerprint,
        snapshot: snapshotOf(summary),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: notificationWatermarks.id,
        set: { fingerprint: summary.fingerprint, snapshot: snapshotOf(summary), updatedAt: new Date() },
      });

    // Nothing to compare against on the very first reading.
    if (!previous) return { changed: true, raised: false };

    const title = headline(summary);
    const body = sentence(summary, (previous.snapshot ?? {}) as Record<string, unknown>);
    // The event fires on every move; the notification below is still held to
    // the category's three-hour floor. A workflow decides its own cadence.
    emitPlatformEvent(
      'health.summary_changed',
      {
        fingerprint: summary.fingerprint,
        title,
        body,
        readiness: summary.readiness?.score ?? null,
        figures: summary.figures.map((f) => ({ key: f.key, display: f.display, unit: f.unit, improving: f.improving })),
      },
      { source: 'health-watch' },
    );

    const result = await notifyOwner({
      category: 'health',
      title,
      body,
      url: '/health',
      severity: 'info',
      // Scoped to the day, so the floor is per-day-per-category rather than
      // shared with anything else health might want to say later.
      dedupeKey: `health:${new Date().toISOString().slice(0, 10)}`,
      data: {
        figures: summary.figures.map((f) => ({
          key: f.key,
          display: f.display,
          unit: f.unit,
          deltaDisplay: f.deltaDisplay,
          improving: f.improving,
        })),
        readiness: summary.readiness?.score ?? null,
      },
    });

    // Cheap, and it needs somewhere to live. A ledger that only grows is a
    // table somebody finds at 40 million rows.
    if (result.raised) await pruneEvents();

    return { changed: true, raised: result.raised };
  } catch (error) {
    console.error('[health-watch] check failed', error);
    return { changed: false, raised: false };
  }
}

function snapshotOf(summary: NativeHealthSummary): Record<string, unknown> {
  return Object.fromEntries(summary.figures.map((f) => [f.key, f.display]));
}

/** The notification's title: the one figure that moved furthest. */
function headline(summary: NativeHealthSummary): string {
  const readiness = summary.readiness;
  if (readiness) return `Readiness ${Math.round(readiness.score)} · ${readiness.label}`;
  const recovery = summary.figures.find((f) => f.key === 'recovery');
  return recovery ? `Recovery ${recovery.display}%` : 'Your health figures moved';
}

/**
 * The body: every figure that actually changed, with its direction.
 *
 * Compared against the previous SNAPSHOT of rendered strings rather than the
 * raw numbers. The strings are what was last said out loud, so a figure that
 * moved from 51.4 to 51.6 — same rendered `52` — correctly reads as unchanged.
 */
function sentence(summary: NativeHealthSummary, previous: Record<string, unknown>): string {
  const moved = summary.figures.filter((f) => previous[f.key] !== undefined && previous[f.key] !== f.display);
  const lines = (moved.length > 0 ? moved : summary.figures).map((f) => {
    const was = typeof previous[f.key] === 'string' ? ` (was ${previous[f.key]})` : '';
    const arrow = f.improving === null ? '' : f.improving ? ' ↑' : ' ↓';
    return `${f.label}: ${f.display}${f.unit === '%' ? '%' : f.unit === 'h' ? '' : ` ${f.unit}`}${was}${arrow}`;
  });
  return lines.join('\n');
}
