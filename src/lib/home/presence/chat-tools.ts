// src/lib/home/presence/chat-tools.ts
//
// jkai's places tools (workflow knit 2026-11-11, slices 3 and 4): the saved
// places behind /home/people/places.
//
//   places_list    the named places, and the unnamed ones John himself stopped at
//   place_visits   when John was at one place
//   place_name     name a place and say what kind it is            (light confirm)
//   place_merge    fold several places into one                    (destructive)
//
// THE RULE: John's own places and visits only, and never a coordinate or an
// address. A place row carries its centre, radius and a looked-up address;
// none is picked. Visits are segmented from EVERYONE's trail, so they are
// filtered to the owner's household subjects before anything is returned, and
// an unnamed stop that only somebody else made is not listed at all: it would
// say where they had been.
//
// A merge moves the folded-in places' trail rows and notes onto the target and
// there is no unmerge, so it is destructive: confirmed every time, and refused
// on an unattended call. Nothing is deleted (movement history never is).
//
// Owner-only, not member-safe. Registered from here (src/hooks.server.ts
// imports this module at boot).

import { register } from '$lib/tools/registry-internal';
import { refuseUnlessOwner } from '$lib/tools/tools/owner-only';
import { DEFAULT_SUBJECT } from './types';
import { listMembers } from './members';
import { ownerSubjects } from './location-hold.server';
import { loadScorecard } from './forecast-eval.server';
import {
  PLACE_KINDS,
  PLACE_LABEL_MAX,
  confirmPlace,
  getPlaceVisits,
  isPlaceKind,
  listNamingQueue,
  listPanelPlaces,
  mergePlaces,
  namePlace,
} from './places';

const PAGE = '/home/people/places';
/** How many unnamed stops are checked for one of the owner's own visits. */
const QUEUE_CHECKED = 15;
const PLACE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const NAMEABLE_KINDS = PLACE_KINDS.filter((k) => k !== 'unknown');

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : typeof d === 'string' ? d : null);
const int = (raw: unknown, min: number, max: number, fallback: number) =>
  typeof raw === 'number' && Number.isFinite(raw) ? Math.max(min, Math.min(max, Math.trunc(raw))) : fallback;
const idOf = (raw: unknown): string | null => (typeof raw === 'string' && PLACE_ID.test(raw.trim()) ? raw.trim() : null);
const failed = (name: string, err: unknown) => ({ success: false as const, error: `${name} failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) });

/** The owner's trail subjects: his household rows, else the default subject. */
async function mySubjects(): Promise<Set<string>> {
  const mine = ownerSubjects(await listMembers().catch(() => []));
  return new Set(mine.length ? mine : [DEFAULT_SUBJECT]);
}

/** One place's visits by the owner alone, newest first, with no subject on them. */
async function myVisits(placeId: string, limit: number, subjects: Set<string>) {
  const visits = await getPlaceVisits(placeId, 60);
  return visits
    .filter((v) => subjects.has(v.subject))
    .slice(0, limit)
    .map((v) => ({ date: v.dateLabel, day: v.dayName, time: v.timeLabel, minutes: v.dwellMins, startedAt: v.startedAt }));
}

register({
  name: 'places_list',
  description:
    "John's saved places (/home/people/places): each named place with its kind, how often it is visited and when it was last seen, and the unnamed stops John himself made that are waiting for a name, with the looked-up guess. Names only: never a coordinate or an address. Read one place's visits with place_visits; name one with place_name. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      unnamed: { type: 'boolean', description: 'Include the unnamed stops waiting for a name. Default true.' },
      limit: { type: 'number', minimum: 1, maximum: 60, description: 'Most named places. Default 30.' },
    },
    required: [],
  },
  category: 'Places',
  toolset: 'places',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('places_list', ctx);
    if (refused) return refused;
    try {
      const all = await listPanelPlaces();
      const named = all
        .filter((p) => p.label)
        .slice(0, int(args.limit, 1, 60, 30))
        .map((p) => ({ id: p.id, name: p.label, kind: p.kind, home: p.isHome, visits: p.visitCount, lastSeenAt: iso(p.lastSeenAt), alerts: p.alerts }));
      const waiting: Array<Record<string, unknown>> = [];
      if (args.unnamed !== false) {
        const subjects = await mySubjects();
        for (const p of (await listNamingQueue(QUEUE_CHECKED)).slice(0, QUEUE_CHECKED)) {
          const [last] = await myVisits(p.id, 1, subjects);
          if (!last) continue;
          waiting.push({ id: p.id, guess: p.suggestedLabel ?? null, guessKind: p.suggestedKind ?? null, lastVisit: `${last.day} ${last.date}, ${last.time}` });
        }
      }
      return { success: true, data: { named, unnamed: waiting, url: PAGE } };
    } catch (err) {
      return failed('places_list', err);
    }
  },
});

register({
  name: 'place_visits',
  description:
    "When John was at one of his places (by its id from places_list): each of his own visits with the date, the weekday, the time he arrived and how long he stayed. His visits only, never anybody else's. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      placeId: { type: 'string', description: 'The place id, from places_list.' },
      limit: { type: 'number', minimum: 1, maximum: 30, description: 'Most visits, newest first. Default 12.' },
    },
    required: ['placeId'],
  },
  category: 'Places',
  toolset: 'places',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('place_visits', ctx);
    if (refused) return refused;
    const placeId = idOf(args.placeId);
    if (!placeId) return { success: false, error: 'placeId is required: the place id from places_list.' };
    try {
      const visits = await myVisits(placeId, int(args.limit, 1, 30, 12), await mySubjects());
      return { success: true, data: { placeId, count: visits.length, visits, message: visits.length ? undefined : 'No visit of yours is recorded at this place.' } };
    } catch (err) {
      return failed('place_visits', err);
    }
  },
});

register({
  name: 'place_name',
  description:
    `Name one of John's places and say what kind it is (${NAMEABLE_KINDS.join(', ')}), as the places page does: the name goes on the place and into what jkai remembers about it. Use the place id from places_list. Naming again replaces the name.`,
  parameters: {
    type: 'object',
    properties: {
      placeId: { type: 'string', description: 'The place id, from places_list.' },
      name: { type: 'string', description: `The name, up to ${PLACE_LABEL_MAX} characters.` },
      kind: { type: 'string', enum: [...NAMEABLE_KINDS], description: 'What kind of place it is.' },
    },
    required: ['placeId', 'name', 'kind'],
  },
  category: 'Places',
  toolset: 'places',
  effect: 'mutate',
  confirm: 'light',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('place_name', ctx);
    if (refused) return refused;
    const placeId = idOf(args.placeId);
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    const kind = args.kind;
    if (!placeId) return { success: false, error: 'placeId is required: the place id from places_list.' };
    if (!name || name.length > PLACE_LABEL_MAX) return { success: false, error: `name must be 1 to ${PLACE_LABEL_MAX} characters.` };
    if (!isPlaceKind(kind) || kind === 'unknown') return { success: false, error: `kind must be one of: ${NAMEABLE_KINDS.join(', ')}.` };
    try {
      const saved = await namePlace(placeId, name, kind);
      if (!saved) return { success: false, error: 'No such place.' };
      // The name is on the place; jkai's memory of it follows, and a failure
      // there never loses the name (the page does the same).
      const remembered = await confirmPlace(placeId, name, kind).then(() => true).catch(() => false);
      return { success: true, data: { placeId, name, kind, remembered, url: PAGE } };
    } catch (err) {
      return failed('place_name', err);
    }
  },
});

register({
  name: 'place_merge',
  description:
    'Fold several of John\'s places into one (two stops either side of one car park, an unnamed shadow of a named place). The folded-in places stop being places and their visits count for the target. There is NO unmerge: say exactly which places will be folded into which before calling. A named home is never merged away. Name the result with place_name.',
  parameters: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'The place to keep, from places_list.' },
      sourceIds: { type: 'array', items: { type: 'string' }, description: 'The places to fold into it (1 to 8).' },
      geometry: { type: 'string', enum: ['enclose', 'keep'], description: 'enclose: grow the kept place to hold them (default). keep: leave it as drawn.' },
    },
    required: ['targetId', 'sourceIds'],
  },
  category: 'Places',
  toolset: 'places',
  effect: 'destructive',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('place_merge', ctx);
    if (refused) return refused;
    const targetId = idOf(args.targetId);
    const raw = Array.isArray(args.sourceIds) ? args.sourceIds : [];
    const sourceIds = [...new Set(raw.map(idOf).filter((id): id is string => !!id))].filter((id) => id !== targetId);
    if (!targetId) return { success: false, error: 'targetId is required: the place to keep.' };
    if (!sourceIds.length || sourceIds.length !== raw.length || sourceIds.length > 8) {
      return { success: false, error: 'sourceIds must be 1 to 8 different place ids, none of them the target.' };
    }
    const geometry = args.geometry === 'keep' ? 'keep' : 'enclose';
    try {
      const result = await mergePlaces(targetId, sourceIds, geometry);
      // The new centre and radius stay on the page: a merge answers with a count.
      return { success: true, data: { placeId: targetId, merged: result.merged, url: PAGE, message: 'Merged. This cannot be undone.' } };
    } catch (err) {
      return failed('place_merge', err);
    }
  },
});

// How well the "where next" forecast has been doing. Household totals only:
// the per-person rows and the recent overdue outcomes name who went where, so
// neither is returned.
register({
  name: 'forecast_history',
  description:
    'How accurate the household forecast ("usually leaves for X at T", journey times, arrival estimates) has been: the latest scorecard as shares and counts for the whole household, and the nightly headline numbers behind the trend. Totals only: nobody\'s journeys or places are named. Read-only.',
  parameters: {
    type: 'object',
    properties: { nights: { type: 'number', minimum: 1, maximum: 60, description: 'Most nights of history. Default 14.' } },
    required: [],
  },
  category: 'Places',
  toolset: 'places',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('forecast_history', ctx);
    if (refused) return refused;
    const stored = await loadScorecard();
    if (!stored?.latest) return { success: true, data: { scorecard: null, history: [], message: 'The forecast has not been scored yet.', url: '/home/people' } };
    const l = stored.latest;
    return {
      success: true,
      data: {
        scorecard: {
          generatedAt: l.generatedAt,
          from: l.from,
          to: l.to,
          days: l.days,
          next: { predictions: l.next.predictions, hits: l.next.hits, precision: l.next.precision, eligible: l.next.eligible, foreseen: l.next.foreseen, recall: l.next.recall },
          duration: { ...l.duration },
          odds: { ...l.odds },
          eta: { ...l.eta },
          overdue: { fired: l.overdue.fired, late: l.overdue.late, skipped: l.overdue.skipped },
        },
        history: (stored.history ?? []).slice(-int(args.nights, 1, 60, 14)),
        url: '/home/people',
      },
    };
  },
});
