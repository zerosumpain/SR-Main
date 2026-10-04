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
// Contract: landgrab-app-contract (2026-10-04), the SR-Main section.

import { getFromExtracted } from '$lib/server/extracted-app';
import { downsample } from '$lib/server/native-trails';
import { listMembers } from '$lib/home/presence/members';
import { familyId, familySubjectId } from './roster.server';

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
    const subject = (m.subject ?? '').trim();
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
  type: 'walk' | 'run' | 'ride' | 'hike' | null;
  startedAt: string;
  endedAt: string | null;
  distanceM: number | null;
  durationS: number | null;
  loop: boolean;
  trace: [number, number][];
}

export interface UpstreamChanges {
  week: { start: string; end: string; current: boolean };
  bounds: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null;
  people: Array<{ subject: string; colour: string }>;
  hexes: Array<{ id: number; polygon: [number, number][]; owner: string; previous: string | null }>;
  changes: Array<{
    id: string;
    subject: string;
    at: string;
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
  /** Health's change id, with any subject inside it rewritten to the person's id. */
  id: string;
  /**
   * Who took the ground, as a phone id. Health calls this `subject`; it cannot
   * become `id` as the contract's "every subject → id" reads, because a change
   * already has an `id` (the one the app selects by).
   */
  personId: string;
  at: string;
  won: number;
  taken: number;
  from: Array<{ id: string | null; hexes: number }>;
  hexIds: number[];
  activity: UpstreamActivity | null;
}

export interface NativeLandgrabChanges {
  week: { start: string; end: string; current: boolean };
  bounds: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null;
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
    trace: Array.isArray(a.trace) ? downsample(a.trace, TRACE_MAX).map((pt) => [coord(pt[0]), coord(pt[1])]) : [],
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
        // The change id carries a subject for trail outings and unattributed
        // ground (`trail:<subject>:…`, `unattributed:<subject>`) — rewritten
        // so the subject never reaches the phone.
        id: rewriteChangeId(c.id, c.subject, id),
        personId: id,
        at: c.at,
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
    people: (upstream.people ?? []).flatMap((p) => {
      const person = map.get(p.subject);
      return person ? [{ id: person.id, name: person.name, colour: p.colour }] : [];
    }),
    hexes,
    changes,
    ...(upstream.truncated === true ? { truncated: true as const } : {}),
  };
}

/**
 * `trail:katie:2026-10-01T09:12` → `trail:f_…:2026-10-01T09:12`, and
 * `unattributed:katie` → `unattributed:f_…`. A workout id (`workout:abc`) has
 * no subject in it and is left alone. Any other id that still contains the
 * subject as a `:`-separated part has that part replaced.
 */
export function rewriteChangeId(changeId: string, subject: string, id: string): string {
  return changeId
    .split(':')
    .map((part) => (part === subject ? id : part))
    .join(':');
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

export async function getFamilyLandgrabChanges(week: string): Promise<NativeLandgrabChanges> {
  const people = await landgrabPeople();
  const query = new URLSearchParams({ week, subjects: people.map((p) => p.subject).join(',') });
  const upstream = await getFromExtracted<UpstreamChanges>('health', `${LANDGRAB_CHANGES_PATH}?${query}`, {
    timeoutMs: TIMEOUT_MS,
  });
  return projectChanges(upstream, people);
}
