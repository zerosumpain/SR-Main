import { db } from '$lib/db';
import { heartbeatActivities } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getHandler } from './registry';
import { recordPulse } from './audit';
import { seedDefaultActivities } from './seed';
import type { HeartbeatActivity } from '$lib/db/schema';

// Cadence floor of the engine ticker. Activities can be configured for any
// multiple of this (30s minimum). The DB row's next_tick_at decides when
// each activity actually fires.
const ENGINE_TICK_MS = 30_000;

let engineTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

export async function startHeartbeatEngine(): Promise<void> {
  if (started) return;
  started = true;
  console.log('[heartbeat] starting engine');
  try {
    await seedDefaultActivities();
  } catch (err) {
    console.error('[heartbeat] seed failed:', err);
  }
  // Fire one tick immediately so anything overdue runs without waiting 30s.
  void runTick().catch((e) => console.error('[heartbeat] initial tick failed:', e));
  engineTimer = setInterval(() => {
    void runTick().catch((e) => console.error('[heartbeat] tick failed:', e));
  }, ENGINE_TICK_MS);
}

export function stopHeartbeatEngine(): void {
  if (engineTimer) clearInterval(engineTimer);
  engineTimer = null;
  started = false;
  console.log('[heartbeat] engine stopped');
}

async function runTick(): Promise<void> {
  const now = new Date();
  // Pull all enabled activities. We filter by next_tick_at in JS so we can
  // also handle rows that just got created (next_tick_at null) cleanly.
  const rows = await db
    .select()
    .from(heartbeatActivities)
    .where(eq(heartbeatActivities.enabled, true));

  for (const row of rows) {
    const dueAt = row.nextTickAt ?? new Date(0);
    if (dueAt.getTime() > now.getTime()) continue;
    void runActivity(row, now).catch((e) => console.error(`[heartbeat] activity ${row.name} crashed:`, e));
  }
}

async function runActivity(row: HeartbeatActivity, now: Date): Promise<void> {
  const handler = getHandler(row.name);
  const startedAt = Date.now();
  const nextTickAt = new Date(now.getTime() + row.cadenceSeconds * 1000);

  if (!handler) {
    await recordPulse({
      activityId: row.id,
      activityName: row.name,
      result: { outcome: 'skipped', summary: 'no handler registered' },
      durationMs: Date.now() - startedAt,
      nextTickAt,
    });
    return;
  }

  if (!withinActiveHours(row, now)) {
    await recordPulse({
      activityId: row.id,
      activityName: row.name,
      result: { outcome: 'skipped', summary: 'outside active hours' },
      durationMs: Date.now() - startedAt,
      nextTickAt,
    });
    return;
  }

  let result;
  try {
    result = await handler.run({
      now: now.getTime(),
      config: (row.config as Record<string, unknown>) ?? {},
      activity: row,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { outcome: 'error' as const, summary: msg.slice(0, 200) };
  }

  await recordPulse({
    activityId: row.id,
    activityName: row.name,
    result,
    durationMs: Date.now() - startedAt,
    nextTickAt,
  });
}

function withinActiveHours(row: HeartbeatActivity, now: Date): boolean {
  if (!row.activeHoursStart || !row.activeHoursEnd) return true;
  const tz = row.activeHoursTz ?? 'UTC';
  // Format the current time in the activity's tz as HH:MM, then compare.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const cur = `${hh}:${mm}`;
  const start = row.activeHoursStart;
  const end = row.activeHoursEnd;
  // Window may wrap midnight (e.g. 22:00 → 06:00).
  if (start <= end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}
