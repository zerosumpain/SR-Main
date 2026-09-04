import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { dependencyStatusSamples } from '$lib/db/schema';
import {
  DEPENDENCIES,
  DEPENDENCY_HISTORY_DAYS,
  DEPENDENCY_POLL_INTERVAL_MS,
  DEPENDENCY_RETENTION_DAYS,
  worstState,
  type DependencyCard,
  type DependencyObservation,
  type DependencyOverview,
  type DependencyState,
} from './catalog';

interface LatestRow {
  dependency_id: string;
  status: string;
  summary: string;
  checked_at: Date | string;
}

interface StatsRow {
  dependency_id: string;
  total_checks: number | string;
  known_checks: number | string;
  green_checks: number | string;
  amber_checks: number | string;
  red_checks: number | string;
  unknown_checks: number | string;
  first_checked_at: Date | string;
  last_degraded_at: Date | string | null;
  largest_gap_seconds: number | string | null;
}

interface DayRow {
  dependency_id: string;
  day: string;
  status: string;
}

function asState(value: string | null | undefined): DependencyState {
  return value === 'green' || value === 'amber' || value === 'red' ? value : 'unknown';
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 100_000) / 1_000;
}

function dayKeys(now: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  cursor.setUTCDate(cursor.getUTCDate() - (DEPENDENCY_HISTORY_DAYS - 1));
  for (let i = 0; i < DEPENDENCY_HISTORY_DAYS; i++) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export async function recordDependencyObservations(observations: DependencyObservation[]): Promise<void> {
  if (!observations.length) return;
  await db.transaction(async (tx) => {
    await tx
      .insert(dependencyStatusSamples)
      .values(observations.map((item) => ({
        dependencyId: item.dependencyId,
        status: item.state,
        summary: item.summary.slice(0, 1_000),
        latencyMs: item.latencyMs,
        checkedAt: item.checkedAt,
      })))
      .onConflictDoNothing();
    await tx.execute(sql`
      delete from dependency_status_samples
      where checked_at < now() - (${DEPENDENCY_RETENTION_DAYS} * interval '1 day')
    `);
  });
}

/**
 * Read a compact 30-day view. Aggregation happens in Postgres so a dashboard
 * refresh does not ship tens of thousands of five-minute samples to Node.
 */
export async function readDependencyOverview(now = new Date()): Promise<DependencyOverview> {
  const [latestResult, statsResult, daysResult] = await Promise.all([
    db.execute(sql`
      select distinct on (dependency_id)
        dependency_id, status, summary, checked_at
      from dependency_status_samples
      order by dependency_id, checked_at desc
    `),
    db.execute(sql`
      with windowed as (
        select
          dependency_id,
          status,
          checked_at,
          lag(checked_at) over (partition by dependency_id order by checked_at) as previous_checked_at
        from dependency_status_samples
        where checked_at >= now() - (${DEPENDENCY_HISTORY_DAYS} * interval '1 day')
      )
      select
        dependency_id,
        count(*)::int as total_checks,
        count(*) filter (where status <> 'unknown')::int as known_checks,
        count(*) filter (where status = 'green')::int as green_checks,
        count(*) filter (where status = 'amber')::int as amber_checks,
        count(*) filter (where status = 'red')::int as red_checks,
        count(*) filter (where status = 'unknown')::int as unknown_checks,
        min(checked_at) as first_checked_at,
        max(checked_at) filter (where status in ('amber', 'red')) as last_degraded_at,
        max(extract(epoch from (checked_at - previous_checked_at))) as largest_gap_seconds
      from windowed
      group by dependency_id
    `),
    db.execute(sql`
      select
        dependency_id,
        to_char(checked_at at time zone 'UTC', 'YYYY-MM-DD') as day,
        case
          when bool_or(status = 'red') then 'red'
          when bool_or(status = 'amber') then 'amber'
          when bool_or(status = 'green') then 'green'
          else 'unknown'
        end as status
      from dependency_status_samples
      where checked_at >= now() - (${DEPENDENCY_HISTORY_DAYS} * interval '1 day')
      group by dependency_id, to_char(checked_at at time zone 'UTC', 'YYYY-MM-DD')
      order by day
    `),
  ]);

  const latest = new Map(
    (latestResult.rows as unknown as LatestRow[]).map((row) => [row.dependency_id, row]),
  );
  const stats = new Map(
    (statsResult.rows as unknown as StatsRow[]).map((row) => [row.dependency_id, row]),
  );
  const dayStates = new Map<string, Map<string, DependencyState>>();
  for (const row of daysResult.rows as unknown as DayRow[]) {
    const byDay = dayStates.get(row.dependency_id) ?? new Map<string, DependencyState>();
    byDay.set(row.day, asState(row.status));
    dayStates.set(row.dependency_id, byDay);
  }

  const keys = dayKeys(now);
  const staleAfterMs = DEPENDENCY_POLL_INTERVAL_MS * 3;
  const cards: DependencyCard[] = DEPENDENCIES.map((definition) => {
    const last = latest.get(definition.id);
    const stat = stats.get(definition.id);
    const checkedAt = iso(last?.checked_at);
    const stale = !checkedAt || now.getTime() - new Date(checkedAt).getTime() > staleAfterMs;
    const known = Number(stat?.known_checks ?? 0);
    const green = Number(stat?.green_checks ?? 0);
    const amber = Number(stat?.amber_checks ?? 0);
    const red = Number(stat?.red_checks ?? 0);
    const total = Number(stat?.total_checks ?? 0);
    const firstCheckedAt = iso(stat?.first_checked_at);
    const expected = firstCheckedAt
      ? Math.floor((now.getTime() - new Date(firstCheckedAt).getTime()) / DEPENDENCY_POLL_INTERVAL_MS) + 1
      : 0;
    const largestGapMinutes = stat?.largest_gap_seconds == null
      ? null
      : Math.round((Number(stat.largest_gap_seconds) / 60) * 10) / 10;

    return {
      ...definition,
      state: stale ? 'unknown' : asState(last?.status),
      summary: stale && last
        ? `Last update is stale · ${last.summary}`
        : last?.summary ?? 'Waiting for the first observation',
      checkedAt,
      stale,
      healthyPct: pct(green, known),
      availablePct: pct(green + amber, known),
      coveragePct: pct(Math.min(total, expected), expected),
      largestGapMinutes,
      knownChecks: known,
      degradedChecks: amber,
      downChecks: red,
      unknownChecks: Number(stat?.unknown_checks ?? 0),
      lastDegradedAt: iso(stat?.last_degraded_at),
      days: keys.map((date) => ({
        date,
        state: dayStates.get(definition.id)?.get(date) ?? 'unknown',
      })),
    };
  });

  const checkedAt = cards
    .map((card) => card.checkedAt)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1) ?? null;
  const observedFrom = [...stats.values()]
    .map((row) => iso(row.first_checked_at))
    .filter((value): value is string => !!value)
    .sort()[0] ?? null;
  const userFacing = cards.filter((card) => card.impact !== 'operations');
  const publicJourney = cards.find((card) => card.id === 'public-site');
  const affected = userFacing.filter((card) => card.degradedChecks + card.downChecks > 0);
  const currentState = worstState(userFacing.map((card) => card.state));
  const confirmed = !!publicJourney && publicJourney.degradedChecks + publicJourney.downChecks > 0;
  const evidenceGap = !!publicJourney && (
    publicJourney.stale
    || (publicJourney.coveragePct ?? 0) < 90
    || (publicJourney.largestGapMinutes ?? 0) > (DEPENDENCY_POLL_INTERVAL_MS / 60_000) * 3
  );

  let summary: string;
  if (!observedFrom) {
    summary = 'Waiting for the first scheduled dependency check';
  } else if (publicJourney?.state === 'red' || publicJourney?.state === 'amber') {
    summary = 'The public user journey is degraded now';
  } else if (publicJourney?.state === 'unknown') {
    summary = 'The current public experience is unknown because monitoring evidence is stale or unavailable';
  } else if (confirmed) {
    summary = 'Public degradation was observed during this window; the site is answering now';
  } else if (affected.length) {
    summary = `No public failure was caught; ${affected.length} user-facing ${affected.length === 1 ? 'dependency has' : 'dependencies have'} reported degradation`;
  } else if (evidenceGap) {
    summary = 'No public failure was caught, but a monitoring gap means the window is not complete';
  } else {
    summary = 'No user-facing degradation observed during the recorded window';
  }

  return {
    dependencies: cards,
    checkedAt,
    observedFrom,
    pollEveryMs: DEPENDENCY_POLL_INTERVAL_MS,
    userImpact: {
      state: currentState,
      confirmed,
      evidenceGap,
      affectedDependencies: affected.length,
      summary,
    },
  };
}
