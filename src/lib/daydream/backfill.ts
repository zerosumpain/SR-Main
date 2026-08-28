// src/lib/daydream/backfill.ts
//
// Recovering the trail Home Assistant has already been keeping.
//
// The recorder has been logging John's device tracker all along — roughly 3,700
// GPS fixes a day, retained about 30 days. Waiting to accumulate that again
// from scratch would have kept `pattern_break` (28 days) and `free_window`
// (3 weekday afternoons) silent for a month for no reason, when the evidence
// was sitting in a database on the same LAN.
//
// Three things measured before this was written, because each one changes the
// implementation:
//
//   1. **`person.john` is the wrong entity.** Its state is a zone name, so it
//      changes only on zone transitions — 3 rows in 30 days. The GPS lives on
//      the device_tracker behind it, named in the person entity's `source`
//      attribute, which is why that is resolved at run time rather than pinned.
//   2. **`minimal_response` throws the data away.** It returns state changes
//      only, and every position update here is an ATTRIBUTE change against an
//      unchanged state. With it: 37 rows for a day. Without: 3,882.
//   3. **The API returns one day per call.** `/api/history/period/<start>`
//      defaults `end_time` to start + 24h, silently — which is why a 30-day
//      query looks like an empty archive rather than a truncated one. Every
//      day is fetched as its own request.

import { and, asc, desc, eq, gte, isNotNull, lt, ne } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamTrail, homeAssistantConfig } from '$lib/db/schema';
import { inferMode, metresBetween, speedKmhBetween } from './cluster';
import { DEFAULT_SUBJECT, MAX_USABLE_ACCURACY_M, errMsg } from './types';

/** HA keeps roughly a month; asking for more is a slow way to fetch nothing. */
export const DEFAULT_BACKFILL_DAYS = 30;

/**
 * Downsampling. The recorder's ~3,700 fixes a day is far finer than anything
 * the detectors use, and storing it raw would put 110k rows in the trail for
 * one month of one person.
 *
 * Keeping a fix on EITHER a time gap or a distance moved is what makes this
 * safe: time alone would smear a journey into a straight line between
 * samples, distance alone would throw away the dwell that defines a place.
 */
export const MIN_GAP_SECONDS = 120;
export const MIN_MOVE_M = 100;

export interface BackfillResult {
  entity: string | null;
  daysRequested: number;
  daysFetched: number;
  daysFailed: number;
  fixesSeen: number;
  fixesKept: number;
  firstTs: string | null;
  lastTs: string | null;
  /** Days skipped because live observation already covers them. */
  daysSkippedLive: number;
  errors: string[];
}

export const EMPTY_BACKFILL: BackfillResult = {
  entity: null,
  daysRequested: 0,
  daysFetched: 0,
  daysFailed: 0,
  fixesSeen: 0,
  fixesKept: 0,
  firstTs: null,
  lastTs: null,
  daysSkippedLive: 0,
  errors: [],
};

interface HAStateRow {
  state?: string;
  last_changed?: string;
  last_updated?: string;
  attributes?: Record<string, unknown>;
}

export interface RawFix {
  ts: Date;
  lat: number;
  lon: number;
  accuracyM: number | null;
  state: string | null;
  batteryPct: number | null;
}

/**
 * Thin a dense stream down to what is worth storing. PURE, so the rule can be
 * tested without a database or an HA instance.
 *
 * Always keeps the first fix; thereafter keeps one when enough time has passed
 * OR enough ground has been covered.
 */
export function downsample(
  fixes: RawFix[],
  opts: { minGapSeconds?: number; minMoveM?: number } = {},
): RawFix[] {
  const minGap = (opts.minGapSeconds ?? MIN_GAP_SECONDS) * 1000;
  const minMove = opts.minMoveM ?? MIN_MOVE_M;

  const out: RawFix[] = [];
  let last: RawFix | null = null;

  for (const f of fixes) {
    if (!last) {
      out.push(f);
      last = f;
      continue;
    }
    const gap = f.ts.getTime() - last.ts.getTime();
    const moved = metresBetween(last.lat, last.lon, f.lat, f.lon);
    if (gap >= minGap || moved >= minMove) {
      out.push(f);
      last = f;
    }
  }
  return out;
}

/** Parse one HA history row into a fix, or null when it carries no position. */
export function parseHistoryRow(row: HAStateRow): RawFix | null {
  const attrs = row.attributes ?? {};
  const lat = typeof attrs.latitude === 'number' ? attrs.latitude : null;
  const lon = typeof attrs.longitude === 'number' ? attrs.longitude : null;
  if (lat == null || lon == null) return null;
  if (lat === 0 && lon === 0) return null;

  const iso = row.last_updated ?? row.last_changed ?? null;
  if (!iso) return null;
  const ts = new Date(iso);
  if (Number.isNaN(ts.getTime())) return null;

  return {
    ts,
    lat,
    lon,
    accuracyM: typeof attrs.gps_accuracy === 'number' ? attrs.gps_accuracy : null,
    state: typeof row.state === 'string' ? row.state : null,
    batteryPct: typeof attrs.battery_level === 'number' ? Math.round(attrs.battery_level) : null,
  };
}

async function haConfig(): Promise<{ url: string; token: string } | null> {
  const [cfg] = await db
    .select({ url: homeAssistantConfig.url, token: homeAssistantConfig.token })
    .from(homeAssistantConfig)
    .where(eq(homeAssistantConfig.id, 'default'))
    .limit(1);
  if (!cfg?.url || !cfg?.token) return null;
  return { url: cfg.url.replace(/\/$/, ''), token: cfg.token };
}

/**
 * Which entity actually carries the GPS.
 *
 * Read from `person.<x>`'s `source` attribute rather than pinned, because the
 * person entity is the stable name and the tracker behind it is not — it
 * changes if the owner swaps location apps, and a pinned tracker would then
 * backfill nothing while looking like it worked.
 */
export async function resolveTrackerEntity(personEntity = 'person.john'): Promise<string | null> {
  const cfg = await haConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.url}/api/states/${personEntity}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as HAStateRow;
    const source = data.attributes?.source;
    return typeof source === 'string' && source.startsWith('device_tracker.') ? source : null;
  } catch {
    return null;
  }
}

/** One day of history for one entity. */
async function fetchDay(
  cfg: { url: string; token: string },
  entity: string,
  start: Date,
  end: Date,
): Promise<RawFix[]> {
  const qs = new URLSearchParams({
    end_time: end.toISOString(),
    filter_entity_id: entity,
  });
  const res = await fetch(`${cfg.url}/api/history/period/${start.toISOString()}?${qs}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    // A dense day is a few MB of JSON over the LAN; the default timeout is not
    // generous enough and a truncated day would look like a quiet one.
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`HA history ${res.status} ${res.statusText}`);

  const body = (await res.json()) as HAStateRow[][];
  const rows = Array.isArray(body) && Array.isArray(body[0]) ? body[0] : [];
  return rows
    .map(parseHistoryRow)
    .filter((f): f is RawFix => f !== null)
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

/**
 * Pull what HA still remembers into the trail.
 *
 * Only writes to days STRICTLY BEFORE the first live observation. Live rows are
 * what the poll floor and the push endpoint recorded with their own provenance
 * and their own gap accounting; overlaying a second set of observations on top
 * of them would inflate coverage for periods we did not actually watch, and
 * coverage is the number three detectors gate on.
 *
 * Idempotent per day: existing `backfill` rows for a day are deleted before its
 * replacements are written, so a re-run corrects rather than duplicates. No
 * unique constraint is used — `daydream_trail` is already populated, and adding
 * one to a populated table breaks non-interactive `drizzle-kit push`.
 */
export async function backfillFromHomeAssistant(
  opts: {
    days?: number;
    personEntity?: string;
    entity?: string;
    subject?: string;
    minGapSeconds?: number;
    minMoveM?: number;
    now?: Date;
  } = {},
): Promise<BackfillResult> {
  const days = Math.max(1, Math.min(60, opts.days ?? DEFAULT_BACKFILL_DAYS));
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const now = opts.now ?? new Date();
  const result: BackfillResult = { ...EMPTY_BACKFILL, daysRequested: days, errors: [] };

  const cfg = await haConfig();
  if (!cfg) {
    result.errors.push('no Home Assistant config');
    return result;
  }

  const entity = opts.entity ?? (await resolveTrackerEntity(opts.personEntity));
  result.entity = entity;
  if (!entity) {
    result.errors.push('could not resolve a device_tracker from the person entity');
    return result;
  }

  // The boundary: live observation owns everything from its first row onward.
  const [firstLive] = await db
    .select({ ts: daydreamTrail.ts })
    .from(daydreamTrail)
    .where(and(eq(daydreamTrail.subject, subject), ne(daydreamTrail.source, 'backfill')))
    .orderBy(asc(daydreamTrail.ts))
    .limit(1);
  // No live rows yet means nothing to protect — backfill may write right up to
  // now. Previously this used JS's max Date as a sentinel, which Postgres
  // rejects outright (year 275760 is outside timestamptz).
  const liveFrom = firstLive?.ts ?? now;

  // Day windows are snapped to UTC midnight rather than measured back from
  // `now`. With a rolling window, re-running an hour later shifts every
  // boundary by an hour, so the delete-then-insert misses the fixes that fell
  // just outside the new edges and the trail grows by a row or two per run —
  // measured, not theorised: the first idempotency test came back 937 against
  // 936. Fixed boundaries make a re-run bit-for-bit the same window.
  //
  // UTC rather than local is deliberate here: this is only a FETCH boundary, and
  // the rows keep their true timestamps either way, so a stable partition beats
  // a meaningful one. Anything that reasons about "a day" uses local time.
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);

  for (let d = days; d >= 1; d--) {
    const start = new Date(todayUtc.getTime() - (d - 1) * 86_400_000);
    const end = new Date(start.getTime() + 86_400_000);
    if (start >= now) continue;

    if (start >= liveFrom) {
      result.daysSkippedLive++;
      continue;
    }
    // Clip a day that straddles the boundary rather than skipping it whole.
    const clippedEnd = end > liveFrom ? liveFrom : end;

    let fixes: RawFix[];
    try {
      fixes = await fetchDay(cfg, entity, start, clippedEnd);
      result.daysFetched++;
    } catch (err) {
      result.daysFailed++;
      result.errors.push(`${start.toISOString().slice(0, 10)}: ${errMsg(err)}`);
      continue;
    }

    result.fixesSeen += fixes.length;
    if (fixes.length === 0) continue;

    const kept = downsample(fixes, {
      minGapSeconds: opts.minGapSeconds,
      minMoveM: opts.minMoveM,
    });

    // Idempotency: this day's backfill rows are replaced, not appended to.
    await db
      .delete(daydreamTrail)
      .where(
        and(
          eq(daydreamTrail.subject, subject),
          eq(daydreamTrail.source, 'backfill'),
          gte(daydreamTrail.ts, start),
          lt(daydreamTrail.ts, clippedEnd),
        ),
      );

    const rows = kept.map((f, i) => {
      const prev = i > 0 ? kept[i - 1] : null;
      const speedKmh = speedKmhBetween(
        prev ? { ts: prev.ts, lat: prev.lat, lon: prev.lon } : null,
        f.lat,
        f.lon,
        f.ts,
      );
      return {
        ts: f.ts,
        subject,
        source: 'backfill' as const,
        lat: f.lat,
        lon: f.lon,
        accuracyM: f.accuracyM,
        haState: f.state,
        // Zone verdicts are authoritative where HA recorded one; anything else
        // stays null rather than being inferred from a distance we have no home
        // place for yet. Places are derived AFTER this runs.
        isHome: f.state === 'home' ? true : f.state === 'not_home' ? false : null,
        distanceHomeKm: null,
        speedKmh,
        mode: inferMode(speedKmh),
        placeId: null,
        batteryPct: f.batteryPct,
        readingAgeS: null,
        note: null,
      };
    });

    // Chunked: Postgres has a bind-parameter ceiling and a dense day can carry
    // several hundred rows even after downsampling.
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(daydreamTrail).values(rows.slice(i, i + 500));
    }
    result.fixesKept += rows.length;
  }

  const [first] = await db
    .select({ ts: daydreamTrail.ts })
    .from(daydreamTrail)
    .where(and(eq(daydreamTrail.subject, subject), isNotNull(daydreamTrail.lat)))
    .orderBy(asc(daydreamTrail.ts))
    .limit(1);
  const [last] = await db
    .select({ ts: daydreamTrail.ts })
    .from(daydreamTrail)
    .where(and(eq(daydreamTrail.subject, subject), isNotNull(daydreamTrail.lat)))
    .orderBy(desc(daydreamTrail.ts))
    .limit(1);

  result.firstTs = first?.ts.toISOString() ?? null;
  result.lastTs = last?.ts.toISOString() ?? null;
  return result;
}
