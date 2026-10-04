// Landgrab for the family on the phone — the weekly won/lost board and the map
// of what changed, proxied from SR-Health.
//
// SR-Health owns every number: the replay, the hex board, the week windows,
// the attribution of a hex to the outing that took it, and the trimming of
// every trace (the share-link rule) before it leaves Health. It answers by
// trail SUBJECT over the service lane and never decides who is family — Main
// asks for exactly the household members it knows.
//
// This module does the one job that belongs to Main: turning subjects into the
// ids the phone already knows from the steps board (`familyId(email)`, or a
// keyed hash of the subject for someone with no email), adding names, marking
// the caller, and making sure no subject string ever reaches the phone. Each
// object is rebuilt field by field, so a field Health adds later stays in
// Health until somebody decides the phone may have it.
//
// Cross-repo dependency: SR-Main calls these SR-Health paths, pinned by
// `landgrab.test.ts`. Renaming or removing either in SR-Health breaks the app's
// Landgrab section (the route degrades to 502, never a crash):
//   GET /api/health/landgrab/family/weeks?subjects=…&weeks=N
//   GET /api/health/landgrab/family/changes?week=YYYY-MM-DD&subjects=…
//
// Contract: landgrab-app-contract (2026-10-04), the SR-Main section, with what
// SR-Health actually shipped: `subjects` is required; a subject the ledger has
// never seen is left out of the answer (so a member with no ground yet has no
// row — Main does not invent one, since it has neither their colour nor
// Health's ranking); an unattributed change has `at: null`; a short or fixless
// outing has `trace: null`; a previous holder outside `subjects` is null.
// Any non-2xx but 400 (including Health's own 500) is the route's 502.

import { getFromExtracted } from '$lib/server/extracted-app';
import { downsample } from '$lib/server/native-trails';
import { listMembers } from '$lib/home/presence/members';
import { familyChangeId, familyId, familySubjectId } from './roster.server';

export const LANDGRAB_WEEKS_PATH = '/api/health/landgrab/family/weeks';
export const LANDGRAB_CHANGES_PATH = '/api/health/landgrab/family/changes';

export const WEEKS_DEFAULT = 6;
export const WEEKS_MAX = 12;

/** The contract's ceiling on a trace sent to the phone. */
export const TRACE_MAX = 300;

/** Five decimal places of a degree, about a metre. */
const coord = (v: number): number => Math.round(v * 1e5) / 1e5;

/** The replay runs per week on Health's side; give it longer than a list read. */
const TIMEOUT_MS = 15_000;

export const LANDGRAB_UNAVAILABLE = 'landgrab unavailable';
export const BAD_WEEK = 'week must be a Monday (YYYY-MM-DD) within the last 12 weeks';

// ——— who: subject → phone id ———————————————————————————————————————————————

export interface LandgrabPerson {
  subject: string;
  id: string;
  name: string;
  email: string | null;
}

/** Every household member with a subject. Health is asked for exactly these. */
export async function landgrabPeople(): Promise<LandgrabPerson[]> {
  const seen = new Set<string>();
  const people: LandgrabPerson[] = [];
  for (const m of await listMembers()) {
    // Health lower-cases what it is asked for and answers in lower case, so
    // the map back from its answer is keyed the same way.
    const subject = (m.subject ?? '').trim().toLowerCase();
    if (!subject || seen.has(subject)) continue;
    seen.add(subject);
    const email = m.email ? m.email.trim().toLowerCase() : null;
    people.push({
      subject,
      id: email ? familyId(email) : familySubjectId(subject),
      name: m.displayName,
      email,
    });
  }
  return people;
}

// ——— upstream shapes (SR-Health's answer, only the fields read here) ————————

export interface UpstreamWeekPerson {
  subject: string;
  won: number;
  taken: number;
  lost: number;
  net: number;
  held: number;
  rank: number;
  colour: string;
}

export interface UpstreamWeeks {
  updatedAt: string | null;
  weeks: Array<{ start: string; end: string; current: boolean; people: UpstreamWeekPerson[] }>;
}

export interface UpstreamActivity {
  kind: 'workout' | 'trail';
  /** `walk` | `run` | `ride` | `hike` today; any string Health sends passes through. */
  type: string | null;
  startedAt: string;
  endedAt: string | null;
  distanceM: number | null;
  durationS: number | null;
  loop: boolean;
  /** Null when there is nothing to show: under 600 m after the trim, or no fixes. */
  trace: [number, number][] | null;
}

/** Health's map focus, rebuilt like every other field; anything odd is dropped. */
function focusOf(f: UpstreamChanges['focus']): NativeLandgrabChanges['focus'] {
  if (!f) return null;
  const ok = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
  if (!ok(f.lat, -90, 90) || !ok(f.lon, -180, 180) || !ok(f.radiusM, 100, 50_000)) return null;
  return { lat: Math.round(f.lat * 1e4) / 1e4, lon: Math.round(f.lon * 1e4) / 1e4, radiusM: Math.round(f.radiusM) };
}

export interface UpstreamChanges {
  week: { start: string; end: string; current: boolean };
  bounds: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null;
  /** Where the phone's map opens: a point and a radius Health chooses (home). */
  focus?: { lat: number; lon: number; radiusM: number } | null;
  people: Array<{ subject: string; colour: string }>;
  hexes: Array<{ id: number; polygon: [number, number][]; owner: string; previous: string | null }>;
  changes: Array<{
    id: string;
    subject: string;
    /** Null for unattributed ground: no capture event to date it by. */
    at: string | null;
    won: number;
    taken: number;
    from: Array<{ subject: string | null; hexes: number }>;
    hexIds: number[];
    activity: UpstreamActivity | null;
  }>;
  truncated?: boolean;
}

// ——— the phone's contract ——————————————————————————————————————————————————

export interface NativeLandgrabWeeks {
  updatedAt: string | null;
  weeks: Array<{
    start: string;
    end: string;
    current: boolean;
    people: Array<{
      id: string;
      name: string;
      me: boolean;
      won: number;
      taken: number;
      lost: number;
      net: number;
      held: number;
      rank: number;
      colour: string;
    }>;
  }>;
}

export interface NativeLandgrabChange {
  /** `c_` + a keyed hash of Health's change id: stable, and carrying no subject. */
  id: string;
  /**
   * Who took the ground, as a phone id. Health calls this `subject`; it cannot
   * become `id` as the contract's "every subject → id" reads, because a change
   * already has an `id` (the one the app selects by).
   */
  personId: string;
  /** Null for unattributed ground. */
  at: string | null;
  won: number;
  taken: number;
  from: Array<{ id: string | null; hexes: number }>;
  hexIds: number[];
  activity: UpstreamActivity | null;
}

export interface NativeLandgrabChanges {
  week: { start: string; end: string; current: boolean };
  bounds: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null;
  focus: { lat: number; lon: number; radiusM: number } | null;
  people: Array<{ id: string; name: string; colour: string }>;
  hexes: Array<{ id: number; polygon: [number, number][]; owner: string; previous: string | null }>;
  changes: NativeLandgrabChange[];
  truncated?: true;
}

// ——— projections (pure) ————————————————————————————————————————————————————

type IdMap = Map<string, LandgrabPerson>;

const bySubject = (people: LandgrabPerson[]): IdMap => new Map(people.map((p) => [p.subject, p]));

/**
 * Health's weekly board, keyed for the phone. A person Health answers for whom
 * Main did not ask (it should never happen — Health ignores unknown subjects)
 * is dropped rather than sent under their subject.
 */
export function projectWeeks(
  upstream: UpstreamWeeks,
  people: LandgrabPerson[],
  callerEmail: string,
): NativeLandgrabWeeks {
  const map = bySubject(people);
  const me = callerEmail.trim().toLowerCase();
  return {
    updatedAt: upstream.updatedAt ?? null,
    weeks: (upstream.weeks ?? []).map((w) => ({
      start: w.start,
      end: w.end,
      current: w.current === true,
      people: (w.people ?? []).flatMap((p) => {
        const person = map.get(p.subject);
        if (!person) return [];
        return [
          {
            id: person.id,
            name: person.name,
            me: person.email !== null && person.email === me,
            won: p.won,
            taken: p.taken,
            lost: p.lost,
            net: p.net,
            held: p.held,
            rank: p.rank,
            colour: p.colour,
          },
        ];
      }),
    })),
  };
}

function projectActivity(a: UpstreamActivity | null | undefined): UpstreamActivity | null {
  if (!a) return null;
  return {
    kind: a.kind,
    type: a.type ?? null,
    startedAt: a.startedAt,
    endedAt: a.endedAt ?? null,
    distanceM: a.distanceM ?? null,
    durationS: a.durationS ?? null,
    loop: a.loop === true,
    // Health has already trimmed, thinned and rounded the trace (the share-link
    // rule). The cap and the rounding are held again here because they are the
    // cheap half of that rule and a phone payload is where it matters.
    trace: Array.isArray(a.trace) ? downsample(a.trace, TRACE_MAX).map((pt) => [coord(pt[0]), coord(pt[1])]) : null,
  };
}

/**
 * Health's map of the week, with every subject replaced by the phone's id.
 * `from[].id` is null for unclaimed ground (Health's `subject: null`). A hex
 * or change whose person Main did not ask for is dropped; a `previous` owner
 * Main cannot name reads as null (unclaimed) rather than a subject.
 */
export function projectChanges(upstream: UpstreamChanges, people: LandgrabPerson[]): NativeLandgrabChanges {
  const map = bySubject(people);
  const idOf = (subject: string | null | undefined): string | null =>
    subject == null ? null : (map.get(subject)?.id ?? null);

  const hexes = (upstream.hexes ?? []).flatMap((h) => {
    const owner = idOf(h.owner);
    if (!owner) return [];
    return [
      {
        id: h.id,
        polygon: (h.polygon ?? []).map((pt) => [pt[0], pt[1]] as [number, number]),
        owner,
        previous: idOf(h.previous),
      },
    ];
  });

  const changes = (upstream.changes ?? []).flatMap((c): NativeLandgrabChange[] => {
    const id = idOf(c.subject);
    if (!id) return [];
    return [
      {
        // Health's change id can carry a subject (`trail:<subject>:…`,
        // `unattributed:<subject>`), so every one becomes an opaque keyed hash.
        id: familyChangeId(c.id),
        personId: id,
        at: c.at ?? null,
        won: c.won,
        taken: c.taken,
        from: (c.from ?? []).map((f) => ({ id: idOf(f.subject), hexes: f.hexes })),
        hexIds: Array.isArray(c.hexIds) ? c.hexIds.slice() : [],
        activity: projectActivity(c.activity),
      },
    ];
  });

  return {
    week: { start: upstream.week.start, end: upstream.week.end, current: upstream.week.current === true },
    bounds: upstream.bounds
      ? {
          minLat: upstream.bounds.minLat,
          minLon: upstream.bounds.minLon,
          maxLat: upstream.bounds.maxLat,
          maxLon: upstream.bounds.maxLon,
        }
      : null,
    focus: focusOf(upstream.focus),
    people: (upstream.people ?? []).flatMap((p) => {
      const person = map.get(p.subject);
      return person ? [{ id: person.id, name: person.name, colour: p.colour }] : [];
    }),
    hexes,
    changes,
    ...(upstream.truncated === true ? { truncated: true as const } : {}),
  };
}

// ——— parameters and failures ——————————————————————————————————————————————

const WEEK_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** The shape only — whether it is a Monday in range is Health's to say (its 400 passes through). */
export function isWeekShape(raw: string | null): raw is string {
  if (raw === null || !WEEK_SHAPE.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}

/** `extracted-app` carries the upstream status only in its message. */
export function upstreamStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const m = /returned (\d{3})\b/.exec(error.message);
  return m ? Number(m[1]) : null;
}

// ——— the service-lane reads ————————————————————————————————————————————————

export async function getFamilyLandgrabWeeks(weeks: number, callerEmail: string): Promise<NativeLandgrabWeeks> {
  const people = await landgrabPeople();
  if (people.length === 0) return { updatedAt: null, weeks: [] };
  const query = new URLSearchParams({
    subjects: people.map((p) => p.subject).join(','),
    weeks: String(weeks),
  });
  const upstream = await getFromExtracted<UpstreamWeeks>('health', `${LANDGRAB_WEEKS_PATH}?${query}`, {
    timeoutMs: TIMEOUT_MS,
  });
  return projectWeeks(upstream, people, callerEmail);
}

/** Monday YYYY-MM-DD → its Sunday. */
function weekEnd(start: string): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

export async function getFamilyLandgrabChanges(week: string, now = new Date()): Promise<NativeLandgrabChanges> {
  const people = await landgrabPeople();
  // Health requires `subjects` (400 without), and a 400 here would read as a
  // bad week. An empty household has an empty map.
  if (people.length === 0) {
    const end = weekEnd(week);
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    return {
      week: { start: week, end, current: today >= week && today <= end },
      bounds: null,
      focus: null,
      people: [],
      hexes: [],
      changes: [],
    };
  }
  const query = new URLSearchParams({ week, subjects: people.map((p) => p.subject).join(',') });
  const upstream = await getFromExtracted<UpstreamChanges>('health', `${LANDGRAB_CHANGES_PATH}?${query}`, {
    timeoutMs: TIMEOUT_MS,
  });
  return projectChanges(upstream, people);
}
