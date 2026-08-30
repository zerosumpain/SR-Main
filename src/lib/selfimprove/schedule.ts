// src/lib/selfimprove/schedule.ts
//
// What the two improvement dashboards should say about when the engine runs.
//
// They used to print `CRON_EXPR` + a hardcoded '03:30 Europe/London' string.
// That was already two copies of one fact, and once the schedule moved onto the
// heartbeat it became a third thing: wrong. A page that confidently states a
// schedule nothing keeps is worse than one that says nothing, because it is the
// first place anybody looks when they think a job has stopped.
//
// So read the row. It is editable from the heartbeat admin UI, which means any
// constant here can drift from it within one click; the declared defaults on
// the handler are the fallback for a cold database that has not been seeded
// yet, never the answer when a real row exists.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { heartbeatActions } from '$lib/db/schema';
import { daydreamImprove } from '$lib/heartbeat/activities/daydream-improve';

export interface ImprovementSchedule {
  /** 'HH:MM Zone' — the moment the window opens. */
  display: string;
  /** 'HH:MM–HH:MM Zone', the whole window. */
  window: string;
  /** False when the heartbeat row is paused, so the UI can say so. */
  active: boolean;
  /** When the engine is next due to look, if the row knows. */
  nextRunAt: string | null;
  /** 'row' when this came from the database, 'default' on a cold seed. */
  source: 'row' | 'default';
}

function fromDefaults(): ImprovementSchedule {
  const w = daydreamImprove.defaultActiveHours;
  return {
    display: w ? `${w.start} ${w.tz}` : 'any time',
    window: w ? `${w.start}–${w.end} ${w.tz}` : 'any time',
    active: daydreamImprove.defaultEnabled,
    nextRunAt: null,
    source: 'default',
  };
}

/**
 * The live schedule of the `daydream-improve` heartbeat activity. Never throws
 * — a dashboard must still render when the database is unhappy, and the
 * declared defaults are a truthful description of what a fresh install does.
 */
export async function improvementSchedule(): Promise<ImprovementSchedule> {
  try {
    const [row] = await db
      .select({
        status: heartbeatActions.status,
        start: heartbeatActions.activeHoursStart,
        end: heartbeatActions.activeHoursEnd,
        tz: heartbeatActions.activeHoursTz,
        nextRunAt: heartbeatActions.nextRunAt,
      })
      .from(heartbeatActions)
      .where(eq(heartbeatActions.name, daydreamImprove.name))
      .limit(1);

    if (!row) return fromDefaults();

    const tz = row.tz ?? 'UTC';
    const start = row.start;
    const end = row.end;
    return {
      display: start ? `${start} ${tz}` : 'any time',
      window: start && end ? `${start}–${end} ${tz}` : 'any time',
      active: row.status === 'active',
      nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
      source: 'row',
    };
  } catch {
    return fromDefaults();
  }
}
