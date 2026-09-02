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

import { and, gte, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { heartbeatActions, heartbeatPulses } from '$lib/db/schema';

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
