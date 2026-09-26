// src/lib/home/presence/household.ts
//
// Where the household is now, read off the trail. The members half of what was
// `loadFamily()` in $lib/daydream/ledger, moved 2026-09-26 so /home/people
// stops depending on the daydream engine. `loadFamily` still exists and adds
// daydream's per-person detail on top of this.

import { inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail } from '$lib/db/schema';
import { FAMILY_SUBJECTS, activeLabels, localDayStart } from './types';
import { listMembers, type HouseholdMember } from './members';
import { loadCompanionUsers, notSharingSubjects } from './companion';

/** One person's live card. Coordinate-free by design. */
export interface HouseholdPresence {
  subject: string;
  isHome: boolean | null;
  placeLabel: string | null;
  distanceHomeKm: number | null;
  batteryPct: number | null;
  ageMins: number | null;
  lastSeenAt: Date | null;
  /**
   * A companion-source person whose phone has sharing off. Their last fix is
   * still in the trail, so the card must say "not sharing" rather than show it
   * as where they are. Absent for everyone else.
   */
  notSharing?: boolean;
  /**
   * Set with `notSharing` when the pilot's users list could not be read, so
   * whether they share is unknown and they are treated as not sharing. The
   * owner's page says "unknown"; a household viewer just sees not sharing.
   */
  sharingUnknown?: boolean;
  today: {
    firstOutMins: number | null;
    minutesOut: number;
    placesVisited: number;
    fixes: number;
  };
}

/**
 * The household list and who has sharing off. Degrades to the seed list and
 * nobody-not-sharing on a failed read: the page must still load.
 */
async function householdRoster(): Promise<{ subjects: string[]; notSharing: Set<string>; unknown: boolean }> {
  let members: HouseholdMember[];
  try {
    members = await listMembers();
  } catch {
    // Who is on the app is unknown too, so nobody can be shown as sharing:
    // fail closed, as for an unreadable users list below.
    const subjects = FAMILY_SUBJECTS.map((f) => f.subject);
    return { subjects, notSharing: new Set(subjects), unknown: true };
  }
  let users = null;
  try {
    users = await loadCompanionUsers();
  } catch {
    users = null;
  }
  // No list (unset or unreadable) ⇒ every companion member reads as not
  // sharing (`notSharingSubjects` fails closed).
  return {
    subjects: members.map((m) => m.subject),
    notSharing: notSharingSubjects(members, users),
    unknown: users === null,
  };
}

/**
 * The household, for the Family tab: who is where now (coordinate-free — the
 * map fetches positions separately, on demand), how fresh each track is, and
 * the shape of each person's day so far. Today's numbers are derived from the
 * trail at read time rather than stored — the feature store owns yesterday,
 * this owns "so far".
 */
export async function loadHousehold(): Promise<{ members: HouseholdPresence[] }> {
  const now = new Date();
  const dayStart = localDayStart(now);
  const { subjects, notSharing, unknown } = await householdRoster();
  if (subjects.length === 0) return { members: [] };

  // Three queries for the whole household, not three per person. The old
  // loop ran 2–3 queries a subject and then a label lookup each — on every
  // arrival at the hub, for a tab most arrivals never opened.
  const [latestRows, todayAgg] = await Promise.all([
    db.execute(sql`
      select distinct on (${daydreamTrail.subject})
        ${daydreamTrail.subject} as subject,
        ${daydreamTrail.ts} as ts,
        ${daydreamTrail.isHome} as is_home,
        ${daydreamTrail.placeId} as place_id,
        ${daydreamTrail.distanceHomeKm} as distance_home_km,
        ${daydreamTrail.batteryPct} as battery_pct
      from ${daydreamTrail}
      where ${daydreamTrail.lat} is not null and ${daydreamTrail.subject} in ${subjects}
      order by ${daydreamTrail.subject}, ${daydreamTrail.ts} desc
    `).then((r) => r.rows as Array<{
      subject: string;
      ts: Date | string;
      is_home: boolean | null;
      place_id: string | null;
      distance_home_km: number | null;
      battery_pct: number | null;
    }>),
    db.execute(sql`
      select
        ${daydreamTrail.subject} as subject,
        count(*)::int as fixes,
        count(*) filter (where ${daydreamTrail.lat} is not null and ${daydreamTrail.isHome} = false)::int as out_rows,
        min(${daydreamTrail.ts}) filter (where ${daydreamTrail.lat} is not null and ${daydreamTrail.isHome} = false) as first_out,
        count(distinct ${daydreamTrail.placeId}) filter (where ${daydreamTrail.lat} is not null)::int as places_visited
      from ${daydreamTrail}
      where ${daydreamTrail.ts} >= ${dayStart} and ${daydreamTrail.subject} in ${subjects}
      group by ${daydreamTrail.subject}
    `).then((r) => r.rows as Array<{
      subject: string;
      fixes: number;
      out_rows: number;
      first_out: Date | string | null;
      places_visited: number;
    }>),
  ]);

  const latestBy = new Map(latestRows.map((r) => [r.subject, r]));
  const todayBy = new Map(todayAgg.map((r) => [r.subject, r]));
  const placeIds = [...new Set(latestRows.map((r) => r.place_id).filter((x): x is string => !!x))];
  const labels = placeIds.length
    ? await db
        .select({ id: daydreamPlaces.id, label: daydreamPlaces.label, status: daydreamPlaces.status })
        .from(daydreamPlaces)
        .where(inArray(daydreamPlaces.id, placeIds))
    : [];
  // A removed place names nothing: the card reads as somewhere unnamed.
  const labelBy = activeLabels(labels);
  const asDate = (v: Date | string | null | undefined) => (v == null ? null : v instanceof Date ? v : new Date(v));

  const members = subjects.map((subject): HouseholdPresence => {
    const latest = latestBy.get(subject);
    const today = todayBy.get(subject);
    const latestTs = asDate(latest?.ts);
    const firstOut = asDate(today?.first_out);
    return {
      subject,
      ...(notSharing.has(subject) ? { notSharing: true, ...(unknown ? { sharingUnknown: true } : {}) } : {}),
      isHome: latest?.is_home ?? null,
      placeLabel: latest?.place_id ? (labelBy.get(latest.place_id) ?? null) : null,
      distanceHomeKm: latest?.distance_home_km == null ? null : Number(latest.distance_home_km),
      batteryPct: latest?.battery_pct == null ? null : Number(latest.battery_pct),
      ageMins: latestTs ? Math.round((now.getTime() - latestTs.getTime()) / 60_000) : null,
      lastSeenAt: latestTs,
      today: {
        firstOutMins: firstOut ? Math.round((firstOut.getTime() - dayStart.getTime()) / 60_000) : null,
        // Each positioned fix stands for one observe interval (2 min).
        minutesOut: Math.round((today?.out_rows ?? 0) * 2),
        placesVisited: today?.places_visited ?? 0,
        fixes: today?.fixes ?? 0,
      },
    };
  });

  return { members };
}

/** A person's last known position, for the household map. */
export interface LivePosition {
  subject: string;
  lat: number;
  lon: number;
  /** When the fix was taken. */
  at: string;
  isHome: boolean | null;
}

/** Fixes older than this are not "where they are". */
const POSITION_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** ~11 m: enough to see which street, not which room. */
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Where each SHARING person last was — the one read in the household that
 * carries coordinates, so it is its own function and its own decision: the
 * owner and a Family Circle viewer get it (the map on /home/people), and
 * nobody who has chosen not to share is ever in it, whoever is looking.
 * Choosing not to be tracked has to mean it.
 */
export async function livePositions(): Promise<LivePosition[]> {
  const { subjects, notSharing } = await householdRoster();
  const sharing = subjects.filter((s) => !notSharing.has(s));
  if (sharing.length === 0) return [];
  const since = new Date(Date.now() - POSITION_MAX_AGE_MS);
  const rows = await db.execute(sql`
    select distinct on (${daydreamTrail.subject})
      ${daydreamTrail.subject} as subject,
      ${daydreamTrail.lat} as lat,
      ${daydreamTrail.lon} as lon,
      ${daydreamTrail.ts} as ts,
      ${daydreamTrail.isHome} as is_home
    from ${daydreamTrail}
    where ${daydreamTrail.lat} is not null and ${daydreamTrail.lon} is not null
      and ${daydreamTrail.subject} in ${sharing}
      and ${daydreamTrail.ts} >= ${since}
    order by ${daydreamTrail.subject}, ${daydreamTrail.ts} desc
  `);
  return (rows.rows as Array<{ subject: string; lat: number; lon: number; ts: Date | string; is_home: boolean | null }>).map(
    (r) => ({
      subject: r.subject,
      lat: round4(Number(r.lat)),
      lon: round4(Number(r.lon)),
      at: new Date(r.ts).toISOString(),
      isHome: r.is_home,
    }),
  );
}
