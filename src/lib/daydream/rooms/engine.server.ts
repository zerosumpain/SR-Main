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
import { mechanicsFor, spendsQuota, type Mechanics } from '$lib/daydream/mechanics';

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

// ── One instrument, opened ───────────────────────────────────────────────
//
// What the Engine room shows when a cell is clicked: the row as scheduled,
// the handler as written, the mechanics as documented (`mechanics.ts`), and
// the last ten pulses with their cost. On demand — twenty-three of these on
// every arrival would be the old page again.

export interface ActivityDetail {
  name: string;
  short: string;
  row: {
    description: string;
    status: string;
    cadenceSeconds: number | null;
    activeHours: { start: string | null; end: string | null; tz: string | null };
    config: Record<string, unknown>;
    totalRuns: number;
    totalCostUsd: number;
    consecutiveFailures: number;
    lastError: string | null;
    lastRunAt: string | null;
    nextRunAt: string | null;
  } | null;
  handler: {
    description: string;
    defaultCadenceSeconds: number;
    defaultConfig: Record<string, unknown>;
    defaultActiveHours: { start: string; end: string; tz: string } | null;
  } | null;
  mechanics: Mechanics | null;
  spendsQuota: boolean;
  pulses: Array<{ ts: string; outcome: string; summary: string; costUsd: number; details: Record<string, unknown> | null }>;
  cost7dUsd: number;
  cost30dUsd: number;
}

export async function loadActivityDetail(name: string): Promise<ActivityDetail> {
  const clean = name.startsWith('daydream-') ? name : `daydream-${name}`;
  // The registry pulls every handler in; loaded on demand so this module stays
  // light for the page load that only wants schedules.
  const { getHandler } = await import('$lib/heartbeat/registry');
  const [row] = await db
    .select()
    .from(heartbeatActions)
    .where(eq(heartbeatActions.name, clean))
    .limit(1);
  const handler = getHandler(clean);
  const pulses = row
    ? await db
        .select({ ts: heartbeatPulses.ts, outcome: heartbeatPulses.outcome, summary: heartbeatPulses.summary, costUsd: heartbeatPulses.costUsd, details: heartbeatPulses.details })
        .from(heartbeatPulses)
        .where(eq(heartbeatPulses.actionId, row.id))
        .orderBy(desc(heartbeatPulses.ts))
        .limit(10)
    : [];
  const since7 = new Date(Date.now() - 7 * DAY_MS);
  const since30 = new Date(Date.now() - 30 * DAY_MS);
  const [cost] = row
    ? await db
        .select({
          d7: sql<string>`coalesce(sum(case when ${heartbeatPulses.ts} >= ${since7} then ${heartbeatPulses.costUsd} else 0 end), 0)::text`,
          d30: sql<string>`coalesce(sum(case when ${heartbeatPulses.ts} >= ${since30} then ${heartbeatPulses.costUsd} else 0 end), 0)::text`,
        })
        .from(heartbeatPulses)
        .where(eq(heartbeatPulses.actionId, row.id))
    : [{ d7: '0', d30: '0' }];
  return {
    name: clean,
    short: clean.replace(/^daydream-/, ''),
    row: row
      ? {
          description: row.description,
          status: row.status,
          cadenceSeconds: row.cadenceSeconds,
          activeHours: { start: row.activeHoursStart, end: row.activeHoursEnd, tz: row.activeHoursTz },
          config: (row.config ?? {}) as Record<string, unknown>,
          totalRuns: row.totalRuns,
          totalCostUsd: Number(row.totalCostUsd ?? 0),
          consecutiveFailures: row.consecutiveFailures ?? 0,
          lastError: row.lastError,
          lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
          nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
        }
      : null,
    handler: handler
      ? {
          description: handler.description,
          defaultCadenceSeconds: handler.defaultCadenceSeconds,
          defaultConfig: (handler.defaultConfig ?? {}) as Record<string, unknown>,
          defaultActiveHours: handler.defaultActiveHours ?? null,
        }
      : null,
    mechanics: mechanicsFor(clean),
    spendsQuota: spendsQuota(clean),
    pulses: pulses.map((p) => ({
      ts: p.ts.toISOString(),
      outcome: p.outcome,
      summary: p.summary,
      costUsd: Number(p.costUsd ?? 0),
      details: (p.details ?? null) as Record<string, unknown> | null,
    })),
    cost7dUsd: Number(cost?.d7 ?? 0),
    cost30dUsd: Number(cost?.d30 ?? 0),
  };
}

// ── Cash, as a cell ──────────────────────────────────────────────────────
//
// The Codex caps govern quota, not money. The one activity that spends cash
// is `daydream-improve` (OpenRouter), and its pulses carry the cost; this is
// that figure beside the quota lines, plus everything daydream-* recorded.

export interface DaydreamSpend {
  improve7dUsd: number;
  improve30dUsd: number;
  all30dUsd: number;
  improveRuns30d: number;
}

export async function loadDaydreamSpend(now = new Date()): Promise<DaydreamSpend> {
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await db
    .select({
      name: heartbeatActions.name,
      d7: sql<string>`coalesce(sum(case when ${heartbeatPulses.ts} >= ${since7} then ${heartbeatPulses.costUsd} else 0 end), 0)::text`,
      d30: sql<string>`coalesce(sum(${heartbeatPulses.costUsd}), 0)::text`,
      runs30: sql<number>`count(*)::int`,
    })
    .from(heartbeatPulses)
    .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
    .where(and(sql`${heartbeatActions.name} like 'daydream%'`, gte(heartbeatPulses.ts, since30)))
    .groupBy(heartbeatActions.name);
  let improve7 = 0;
  let improve30 = 0;
  let improveRuns = 0;
  let all30 = 0;
  for (const r of rows) {
    all30 += Number(r.d30);
    if (r.name === 'daydream-improve') {
      improve7 = Number(r.d7);
      improve30 = Number(r.d30);
      improveRuns = r.runs30;
    }
  }
  return { improve7dUsd: improve7, improve30dUsd: improve30, all30dUsd: all30, improveRuns30d: improveRuns };
}
