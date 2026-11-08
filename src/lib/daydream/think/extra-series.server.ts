// src/lib/daydream/think/extra-series.server.ts
//
// Day series the feature store does not hold, for `correlate` and
// `compare_days` (owner, 2026-10-29: "consider all aspects … mood, family
// members they're with … reason deeply about important correlations").
//
// Before this, the correlate vocabulary was the 22 feature-store columns:
// no mood, no daylight, and nothing about WHO he spent the day with, so 57 of
// 64 correlate notes in October tested movement or diary against sleep and
// mostly came back null. These join the store's days by local date:
//
//   mood            Apple State of Mind valence, −1..1, mean of the day
//   daylightMinutes Apple time in daylight
//   wristTemp       Apple sleeping wrist temperature, °C
//   mindfulMinutes  Apple mindful minutes
//   familyShare     the share (%) of the time the trail saw him that at
//                   least one other household member was at the same place
//                   (home, or the same named place), in 10-minute slots. A
//                   share, not minutes: on production the trail sees him for
//                   2 to 11 hours a day, so raw minutes mostly measured how
//                   much the phone reported. Null on a day it saw him for
//                   under two hours — "not seen" is not "alone".
//   awayOvernight   1 when every fix between 01:00 and 05:00 had him away
//                   from home, 0 when any had him home, null when none.
//
// Owner only. Nobody who has turned sharing off is counted as company: a
// member's choice not to be tracked has to hold here too. No coordinates
// leave this file — only minutes and flags.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { DEFAULT_SUBJECT } from '../types';

export const EXTRA_METRICS = ['mood', 'daylightMinutes', 'wristTemp', 'mindfulMinutes', 'familyShare', 'awayOvernight'] as const;
export type ExtraMetric = (typeof EXTRA_METRICS)[number];

export function isExtraMetric(key: string): key is ExtraMetric {
  return (EXTRA_METRICS as readonly string[]).includes(key);
}

/** Labels and units, for the card headings. */
export const EXTRA_HEADINGS: Record<ExtraMetric, string> = {
  mood: 'Mood (State of Mind valence, −1 to 1)',
  daylightMinutes: 'Time in daylight (min)',
  wristTemp: 'Sleeping wrist temperature (°C)',
  mindfulMinutes: 'Mindful minutes (min)',
  familyShare: 'Time with family (% of the day he was seen)',
  awayOvernight: 'Away overnight (1 away, 0 home)',
};

/** The health series key each Apple-backed extra reads (`owner-data/health.server`). */
const APPLE_KEY: Partial<Record<ExtraMetric, string>> = {
  mood: 'mood',
  daylightMinutes: 'daylight',
  wristTemp: 'wrist_temp',
  mindfulMinutes: 'mindful',
};

/** Minutes the trail must have seen him on a day before familyShare counts. */
export const FAMILY_MIN_SEEN_MINUTES = 120;
const SLOT_SECONDS = 600;

/** Members whose sharing is off, or unknown — never counted as company. */
async function companySubjects(): Promise<string[]> {
  try {
    const { listMembers } = await import('$lib/home/presence/members');
    const { loadCompanionUsers, notSharingSubjects } = await import('$lib/home/presence/companion');
    const members = await listMembers();
    let users = null;
    try {
      users = await loadCompanionUsers();
    } catch {
      users = null;
    }
    const off = notSharingSubjects(members, users);
    return members.map((m) => m.subject).filter((s) => s !== DEFAULT_SUBJECT && !off.has(s));
  } catch {
    return [];
  }
}

async function familyShare(from: Date): Promise<Map<string, number>> {
  const others = await companySubjects();
  const out = new Map<string, number>();
  const res = await db.execute(sql`
    with f as (
      select subject,
             floor(extract(epoch from ts) / ${SLOT_SECONDS})::bigint as b,
             (ts at time zone 'Europe/London')::date as d,
             case when is_home then 'home' else place_id end as k
      from daydream_trail
      where ts >= ${from} and lat is not null
        and subject in (${sql.join([DEFAULT_SUBJECT, ...others].map((s) => sql`${s}`), sql`, `)})
    ),
    j as (select distinct b, d, k from f where subject = ${DEFAULT_SUBJECT} and k is not null),
    o as (select distinct b, k from f where subject <> ${DEFAULT_SUBJECT} and k is not null)
    select j.d::text as day,
           count(distinct j.b)::int as seen,
           count(distinct j.b) filter (where o.b is not null)::int as together
    from j left join o on o.b = j.b and o.k = j.k
    group by j.d
  `);
  for (const r of res.rows as Array<{ day: string; seen: number; together: number }>) {
    const seenMin = Number(r.seen) * (SLOT_SECONDS / 60);
    if (seenMin < FAMILY_MIN_SEEN_MINUTES) continue;
    out.set(String(r.day).slice(0, 10), Math.round((Number(r.together) / Number(r.seen)) * 100));
  }
  return out;
}

async function awayOvernight(from: Date): Promise<Map<string, number>> {
  const res = await db.execute(sql`
    select (ts at time zone 'Europe/London')::date::text as day, bool_or(is_home) as any_home
    from daydream_trail
    where subject = ${DEFAULT_SUBJECT} and ts >= ${from} and is_home is not null
      and extract(hour from ts at time zone 'Europe/London') between 1 and 4
    group by 1
  `);
  const out = new Map<string, number>();
  for (const r of res.rows as Array<{ day: string; any_home: boolean }>) out.set(String(r.day).slice(0, 10), r.any_home ? 0 : 1);
  return out;
}

/** One extra series as day → value, owner only. Empty on a failed read. */
export async function loadExtraSeries(key: ExtraMetric, windowDays: number, now = new Date()): Promise<Map<string, number>> {
  const from = new Date(now.getTime() - windowDays * 86_400_000);
  try {
    if (key === 'familyShare') return await familyShare(from);
    if (key === 'awayOvernight') return await awayOvernight(from);
    const { seriesDays } = await import('$lib/owner-data/health.server');
    const days = (await seriesDays(APPLE_KEY[key]!, windowDays, now)) ?? [];
    return new Map(days.map((d) => [d.day, d.value]));
  } catch (err) {
    console.error(`[daydream] extra series ${key} not read:`, err instanceof Error ? err.message : err);
    return new Map();
  }
}

type Row = Record<string, unknown>;

/**
 * Feature-store rows with the asked-for extras joined on by local day. A day
 * an extra has but the store lacks becomes a row of its own, so a mood logged
 * on a day the feature builder skipped still counts. PURE, oldest first.
 */
export function joinExtras(rows: Row[], extras: ReadonlyMap<string, ReadonlyMap<string, number>>): Row[] {
  if (!extras.size) return rows;
  const byDay = new Map<string, Row>();
  const dayOf = (r: Row) => String(r.day ?? '').slice(0, 10);
  for (const r of rows) byDay.set(dayOf(r), { ...r });
  for (const [key, series] of extras) {
    for (const [day, v] of series) {
      const row = byDay.get(day) ?? { day };
      row[key] = v;
      byDay.set(day, row);
    }
  }
  return [...byDay.values()].sort((a, b) => dayOf(a).localeCompare(dayOf(b)));
}
