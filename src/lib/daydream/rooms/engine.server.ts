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
import { agentActions, daydreamThoughts, heartbeatActions, heartbeatPulses } from '$lib/db/schema';
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
  /** What the ledger holds under this activity's tag, or null when nothing. */
  ledger: LedgerLine | null;
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
  const tag = ledgerTagFor(clean);
  const ledger = (await ledgerByActivity(new Date(), sql`${ACTIVITY} = ${tag}`)).get(tag) ?? null;
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
    ledger,
  };
}

// ── Cash, from the ledger ────────────────────────────────────────────────
//
// The Codex caps govern quota, not money, and the quota tiles hide when the
// caps do not apply — which is exactly when cash is the question. The pulses
// cannot answer it: self-improve priced its own calls from a catalogue that
// has no row for the model it runs on, so every night's cost was a fabricated
// zero. The ledger (`agent_actions`, kept by the usage capture on every client)
// carries the provider's own price per call and the activity that made it, so
// the figure here is that ledger's, and a Codex call shows as quota, not $0.

export interface LedgerLine {
  activity: string;
  calls7: number;
  calls30: number;
  cashUsd7: number;
  cashUsd30: number;
  /** Calls served by the Codex bridge — subscription quota, priced null. */
  quota7: number;
  quota30: number;
  /** Cash-provider calls the ledger could not price — an honest blank, not $0. */
  unpriced30: number;
  models: string[];
}

const ACTIVITY = sql<string>`coalesce(${agentActions.input} ->> 'activity', '')`;

async function ledgerByActivity(now: Date, only: ReturnType<typeof sql>): Promise<Map<string, LedgerLine>> {
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await db
    .select({
      activity: ACTIVITY,
      calls7: sql<number>`count(*) filter (where ${agentActions.createdAt} >= ${since7})::int`,
      calls30: sql<number>`count(*)::int`,
      cash7: sql<string>`coalesce(sum(${agentActions.costUsd}) filter (where ${agentActions.createdAt} >= ${since7}), 0)::text`,
      cash30: sql<string>`coalesce(sum(${agentActions.costUsd}), 0)::text`,
      quota7: sql<number>`count(*) filter (where ${agentActions.provider} = 'codex' and ${agentActions.createdAt} >= ${since7})::int`,
      quota30: sql<number>`count(*) filter (where ${agentActions.provider} = 'codex')::int`,
      unpriced30: sql<number>`count(*) filter (where ${agentActions.costUsd} is null and coalesce(${agentActions.provider}, '') <> 'codex')::int`,
      models: sql<string | null>`string_agg(distinct ${agentActions.model}, ',')`,
    })
    .from(agentActions)
    .where(and(gte(agentActions.createdAt, since30), only))
    .groupBy(ACTIVITY);
  const out = new Map<string, LedgerLine>();
  for (const r of rows) {
    out.set(r.activity, {
      activity: r.activity,
      calls7: r.calls7,
      calls30: r.calls30,
      cashUsd7: Number(r.cash7),
      cashUsd30: Number(r.cash30),
      quota7: r.quota7,
      quota30: r.quota30,
      unpriced30: r.unpriced30,
      models: (r.models ?? '').split(',').filter(Boolean).sort(),
    });
  }
  return out;
}

/** The ledger tag an activity's calls carry: self-improve tags its own. */
export function ledgerTagFor(activityName: string): string {
  return activityName === 'daydream-improve' ? 'selfimprove' : activityName;
}

export interface DaydreamSpend {
  /** Self-improve's line, or null when the ledger has no call of its in 30 days. */
  improve: LedgerLine | null;
  /** Every `daydream-*` tagged activity folded into one line. */
  daydream: LedgerLine;
  /** The per-activity lines behind `daydream`, most calls first. */
  lines: LedgerLine[];
}

export async function loadDaydreamSpend(now = new Date()): Promise<DaydreamSpend> {
  const byActivity = await ledgerByActivity(
    now,
    sql`(${ACTIVITY} = 'selfimprove' or ${ACTIVITY} like 'daydream-%')`,
  );
  const improve = byActivity.get('selfimprove') ?? null;
  const lines = [...byActivity.values()].filter((l) => l.activity.startsWith('daydream-')).sort((a, b) => b.calls30 - a.calls30);
  const daydream: LedgerLine = {
    activity: 'daydream-*',
    calls7: 0,
    calls30: 0,
    cashUsd7: 0,
    cashUsd30: 0,
    quota7: 0,
    quota30: 0,
    unpriced30: 0,
    models: [],
  };
  const models = new Set<string>();
  for (const l of lines) {
    daydream.calls7 += l.calls7;
    daydream.calls30 += l.calls30;
    daydream.cashUsd7 += l.cashUsd7;
    daydream.cashUsd30 += l.cashUsd30;
    daydream.quota7 += l.quota7;
    daydream.quota30 += l.quota30;
    daydream.unpriced30 += l.unpriced30;
    for (const m of l.models) models.add(m);
  }
  daydream.models = [...models].sort();
  return { improve, daydream, lines };
}
