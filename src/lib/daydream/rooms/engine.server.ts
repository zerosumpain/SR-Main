// src/lib/daydream/rooms/engine.server.ts
//
// The two facts the engine room's activity panel needs that `loadTelemetry`
// does not return.
//
// `loadTelemetry` selects `next_run_at` and then drops it on the floor, and it
// never reads `cost_usd` at all. A panel built on it alone can say "last ran
// four hours ago" and nothing about whether the next run is DUE — which is the
// difference between an activity that is idle and one whose schedule has
// stopped moving — and nothing about what the thinking cost.
//
// Two grouped queries for the whole board, not one per activity: the pulse
// spend is summed in the database, keyed on the ts index.

import { and, desc, gte, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts, heartbeatActions, heartbeatPulses } from '$lib/db/schema';
import { MAX_PER_DAY, MIN_GAP_HOURS, QUIET_HOURS, isInterruptingChannel } from '$lib/daydream/deliver';
import { localDayStart } from '$lib/daydream/budget';

export interface JobSchedule {
  name: string;
  /** What the activity says it is for. The panel shows it on the table row. */
  description: string;
  /** `active` | `paused` | `failed` | `done`. A paused activity is a choice. */
  status: string;
  /** ISO, or null when nothing is scheduled — which is not the same as idle. */
  nextRunAt: string | null;
  /** Cash recorded against this activity's pulses in the last 24 hours. */
  costUsd24h: number;
  runs24h: number;
}

const DAY_MS = 86_400_000;

export async function loadJobSchedules(): Promise<JobSchedule[]> {
  const since = new Date(Date.now() - DAY_MS);
  const [actions, spend] = await Promise.all([
    db
      .select({
        id: heartbeatActions.id,
        name: heartbeatActions.name,
        description: heartbeatActions.description,
        status: heartbeatActions.status,
        nextRunAt: heartbeatActions.nextRunAt,
      })
      .from(heartbeatActions)
      .where(sql`${heartbeatActions.name} like 'daydream%'`)
      .orderBy(heartbeatActions.name),
    db
      .select({
        actionId: heartbeatPulses.actionId,
        // `sum()` over a numeric column comes back as a string through the pg
        // driver whatever the cast, so it is cast explicitly and parsed once
        // here rather than in the component.
        cost: sql<string>`coalesce(sum(${heartbeatPulses.costUsd}), 0)::text`,
        runs: sql<number>`count(*)::int`,
      })
      .from(heartbeatPulses)
      .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
      .where(and(gte(heartbeatPulses.ts, since), sql`${heartbeatActions.name} like 'daydream%'`))
      .groupBy(heartbeatPulses.actionId),
  ]);

  const byAction = new Map(spend.map((s) => [s.actionId, s]));
  return actions.map((a) => {
    const s = byAction.get(a.id);
    const cost = Number(s?.cost ?? 0);
    return {
      name: a.name,
      description: a.description,
      status: a.status,
      nextRunAt: a.nextRunAt ? a.nextRunAt.toISOString() : null,
      costUsd24h: Number.isFinite(cost) ? cost : 0,
      runs24h: s?.runs ?? 0,
    };
  });
}

// ── Delivery, as a cell ──────────────────────────────────────────────────
//
// Sent against the cap, held by reason, and when the next slot opens. The
// held-reason breakdown has existed in the data since the reviewer shipped
// and was shown nowhere.


export interface DeliveryStats {
  sentToday: number;
  cap: number;
  sent7d: number;
  heldToday: Array<{ reason: string; n: number }>;
  held7d: Array<{ reason: string; n: number }>;
  lastSentAt: string | null;
  /** When the next interruption could go out, or why it cannot today. */
  nextSlot: { at: string | null; why: string };
  quietHours: { start: number; end: number };
}

function reasonKey(r: string | null): string {
  if (!r) return 'unknown';
  return r.replace(/\s*\(.*\)$/, '');
}

export async function loadDeliveryStats(now = new Date()): Promise<DeliveryStats> {
  const dayStart = localDayStart(now);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [sent, heldRows] = await Promise.all([
    db
      .select({ channel: daydreamThoughts.channel, deliveredAt: daydreamThoughts.deliveredAt })
      .from(daydreamThoughts)
      .where(and(isNotNull(daydreamThoughts.deliveredAt), gte(daydreamThoughts.deliveredAt, weekAgo)))
      .orderBy(desc(daydreamThoughts.deliveredAt)),
    db
      .select({ reason: daydreamThoughts.suppressedReason, updatedAt: daydreamThoughts.updatedAt, n: sql<number>`count(*)::int` })
      .from(daydreamThoughts)
      .where(and(sql`${daydreamThoughts.status} = 'suppressed'`, gte(daydreamThoughts.updatedAt, weekAgo)))
      .groupBy(daydreamThoughts.suppressedReason, daydreamThoughts.updatedAt),
  ]);
  const interrupting = sent.filter((r) => isInterruptingChannel(r.channel) && r.deliveredAt);
  const sentToday = interrupting.filter((r) => (r.deliveredAt as Date) >= dayStart).length;
  const lastSentAt = interrupting[0]?.deliveredAt ?? null;

  const tally = (rows: typeof heldRows) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(reasonKey(r.reason), (m.get(reasonKey(r.reason)) ?? 0) + r.n);
    return [...m.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n);
  };
  const heldToday = tally(heldRows.filter((r) => r.updatedAt >= dayStart));
  const held7d = tally(heldRows);

  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).format(now)) % 24;
  let nextSlot: DeliveryStats['nextSlot'];
  if (sentToday >= MAX_PER_DAY) nextSlot = { at: null, why: `daily cap of ${MAX_PER_DAY} reached` };
  else if (hour < QUIET_HOURS.start || hour >= QUIET_HOURS.end) nextSlot = { at: null, why: `quiet until ${String(QUIET_HOURS.start).padStart(2, '0')}:00` };
  else if (lastSentAt && now.getTime() - lastSentAt.getTime() < MIN_GAP_HOURS * 3_600_000) {
    nextSlot = { at: new Date(lastSentAt.getTime() + MIN_GAP_HOURS * 3_600_000).toISOString(), why: `minimum gap of ${MIN_GAP_HOURS}h` };
  } else nextSlot = { at: now.toISOString(), why: 'open now' };

  return {
    sentToday,
    cap: MAX_PER_DAY,
    sent7d: interrupting.length,
    heldToday,
    held7d,
    lastSentAt: lastSentAt ? lastSentAt.toISOString() : null,
    nextSlot,
    quietHours: QUIET_HOURS,
  };
}
