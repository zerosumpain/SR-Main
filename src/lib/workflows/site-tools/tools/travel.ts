// src/lib/workflows/site-tools/tools/travel.ts
//
// Getting from one place to another — the capability jkai did not have.
//
// `route_plan` next door looks like it covers this and does not. It plans a
// SPORT: a circular training route from a start point, scored on retracing,
// surface and the shape of its climbing, and it requires a lat/lng and a sport
// before it will say anything at all. Ask it "how long does it take to drive to
// Norwich" and there is no answer to give. These three tools are the ordinary
// travel questions: how do I get there, how long from each of these to each of
// those, and how far can I get in twenty minutes.
//
// WHY MAPBOX AND NOT OPENROUTESERVICE, given ORS is already wired in. Both
// could route A to B, and the split is by what each one alone can do:
//
//   * Mapbox has LIVE TRAFFIC. `driving-traffic` returns a duration for now,
//     and `duration_typical` for a normal day, which is the difference between
//     "47 minutes" and "47 minutes, 12 worse than usual". ORS has no traffic at
//     all, and a car ETA without it is the wrong answer to every question
//     anyone asks with one. It also carries a matrix and an isochrone endpoint
//     on the same free tier, which is where the other two tools come from.
//   * ORS has ELEVATION and SURFACE breakdowns and a `round_trip` generator.
//     Mapbox Directions returns none of the three. So the trails planner stays
//     on ORS — its scorer is built entirely from numbers Mapbox does not
//     return — and this file never touches it.
//
// Neither replaces the other. Mapbox is primary for going somewhere; ORS is
// primary for going round.
//
// Every place argument is a NAME, resolved through `geocodePlace` (Mapbox
// first, Nominatim second). A coordinate pair is accepted too, for the cases
// where one came out of another tool — but a model writing coordinates from
// memory is the failure `geocodePlace` exists to prevent, so the schemas ask
// for names and say so.

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';
import type { Artifact, ArtifactToolData, MapLayer } from '../artifact-types';
import { geocodePlace } from '../geocode';
import {
  MAX_CONTOURS,
  MAX_CONTOUR_MINUTES,
  TRAVEL_MODES,
  maxWaypointsFor,
  type TravelMode,
} from '$lib/maps/mapbox-api';

function fail(error: string): ToolResult {
  return { success: false, error };
}

const MODE_HELP =
  'drive (live traffic), drive_free_flow (no traffic, for a 3am journey or a fair ' +
  'comparison of two routes), walk, or cycle.';

/** A resolved waypoint: where it is, and what the caller called it. */
interface Waypoint {
  lng: number;
  lat: number;
  /** What the user asked for, kept for labels so the map says "Home", not a number. */
  given: string;
  /** The provider's label, so a wrong hit is visible in the reply. */
  resolved: string;
}

/** "52.63,-1.29" — a coordinate pair typed into a place field. */
const COORD_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * Turn one place argument into a point.
 *
 * A bare "lat,lng" is taken at face value — it almost always came from another
 * tool, and second-guessing it would break the handoff. Anything else is a name
 * and goes through the geocoder, which is the whole reason these tools take
 * names in the first place.
 */
async function resolvePoint(input: string, near?: [number, number]): Promise<Waypoint | string> {
  const text = String(input ?? '').trim();
  if (!text) return 'an empty place';

  const coords = COORD_RE.exec(text);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return `${JSON.stringify(text)} is not a valid lat,lng — latitude is ±90, longitude ±180`;
    }
    return { lat, lng, given: text, resolved: text };
  }

  const hit = await geocodePlace(text, near ? { near } : {});
  if (!hit) return text;
  return { lat: hit.lat, lng: hit.lng, given: text, resolved: hit.label || text };
}

/** Resolve a list of places, reporting every one that failed rather than the first. */
async function resolveAll(
  inputs: string[],
  near?: [number, number],
): Promise<{ points: Waypoint[]; unresolved: string[] }> {
  const points: Waypoint[] = [];
  const unresolved: string[] = [];
  for (const input of inputs) {
    const out = await resolvePoint(input, near);
    if (typeof out === 'string') unresolved.push(out);
    else points.push(out);
  }
  return { points, unresolved };
}

/**
 * A place that would not resolve fails the whole call.
 *
 * Routing between the ones that did resolve would answer a different question
 * than the one asked, confidently and without saying so — the same rule
 * `render_map` follows, and for the same reason.
 */
function unresolvedError(unresolved: string[], hasNear: boolean): string {
  return (
    `could not find ${unresolved.map((u) => JSON.stringify(u)).join(', ')} — ` +
    'add the town or county to the name, or pass coordinates as "lat,lng"' +
    (hasNear ? '' : ', or set `near` to bias the lookup')
  );
}

function asMode(raw: unknown): TravelMode | null {
  const mode = String(raw ?? 'drive');
  return (TRAVEL_MODES as string[]).includes(mode) ? (mode as TravelMode) : null;
}

function nearOf(args: Record<string, unknown>): [number, number] | undefined {
  const near = args.near;
  if (!Array.isArray(near) || near.length < 2) return undefined;
  const lat = Number(near[0]);
  const lng = Number(near[1]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : undefined;
}

/** Seconds as the duration a person would say out loud. */
function humanDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function km(metres: number): number {
  return Number((metres / 1000).toFixed(2));
}

/**
 * Thin a route's geometry down to something a map can draw and a transcript can
 * afford.
 *
 * Mapbox returns full-resolution geometry — tens of thousands of numbers on a
 * long drive — and the whole `data` envelope is serialised into the model's
 * context. Every point past a couple of hundred buys no visible fidelity at map
 * zoom and costs real tokens, so it is sampled evenly and rounded to five
 * decimal places (~1 m). The first and last points are always kept, because a
 * route that visibly stops short of its destination looks like a bug.
 */
function thinRoute(coordinates: [number, number][], limit = 100): Array<{ lat: number; lng: number }> {
  if (!coordinates.length) return [];
  const step = Math.max(1, Math.ceil(coordinates.length / limit));
  const kept = coordinates.filter((_, i) => i % step === 0 || i === coordinates.length - 1);
  return kept.map(([lng, lat]) => ({
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5)),
  }));
}

// -------- route_directions --------

register({
  name: 'route_directions',
  destructive: false,
  description:
    'Get a real route between places — distance, journey time and optional turn-by-turn steps — and draw it on a map in the chat. Driving times use LIVE TRAFFIC and report how they compare with a normal day. Takes place NAMES ("Norwich Cathedral", "Leicester station"), not coordinates. Use this for any "how do I get to", "how far is", "how long does it take to" question. For a circular training run or ride scored on terrain, use route_plan instead.',
  parameters: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Where the journey starts. A place name; or "lat,lng" if a tool gave you one.',
      },
      to: {
        type: 'string',
        description: 'Where it ends. A place name; or "lat,lng".',
      },
      via: {
        type: 'array',
        description: 'Optional stops along the way, in the order they should be visited.',
        items: { type: 'string' },
      },
      mode: { type: 'string', enum: [...TRAVEL_MODES], description: MODE_HELP },
      steps: {
        type: 'boolean',
        description:
          'Include turn-by-turn directions. Off by default — it is long, and most questions only want the time and distance. Set true when the user actually wants the instructions.',
      },
      avoid: {
        type: 'array',
        description: 'Road types to keep out of the route: motorway, toll, ferry, unpaved, cash_only_tolls.',
        items: { type: 'string', enum: ['motorway', 'toll', 'ferry', 'unpaved', 'cash_only_tolls'] },
      },
      departAt: {
        type: 'string',
        description:
          'ISO 8601 local departure time, e.g. "2026-09-08T08:30". Gives the traffic for THAT time rather than now — use it for "if I leave at 8am".',
      },
      alternatives: {
        type: 'boolean',
        description: 'Also return up to two meaningfully different routes for comparison.',
      },
      near: {
        type: 'array',
        description:
          'Optional [lat, lng] hint for resolving the place names. Worth passing whenever a name is ambiguous.',
        items: { type: 'number' },
      },
      showMap: { type: 'boolean', description: 'Draw the route on a map in the chat. Defaults to true.' },
    },
    required: ['from', 'to'],
  },
  category: 'Travel',
  toolset: 'travel',
  handler: async (args): Promise<ToolResult> => {
    const mode = asMode(args.mode);
    if (!mode) return fail(`mode must be one of: ${TRAVEL_MODES.join(', ')}`);

    const near = nearOf(args);
    const via = Array.isArray(args.via) ? args.via.map((v) => String(v)) : [];
    const wanted = [String(args.from ?? ''), ...via, String(args.to ?? '')];

    const cap = maxWaypointsFor(mode);
    if (wanted.length > cap) {
      return fail(`${mode} allows ${cap} stops including start and finish; got ${wanted.length}.`);
    }

    const { points, unresolved } = await resolveAll(wanted, near);
    if (unresolved.length) return fail(unresolvedError(unresolved, Boolean(near)));

    let routes;
    try {
      const { directions } = await import('$lib/maps/mapbox-api');
      routes = await directions({
        mode,
        coordinates: points.map((p) => [p.lng, p.lat] as [number, number]),
        steps: args.steps === true,
        alternatives: args.alternatives === true,
        exclude: Array.isArray(args.avoid) ? args.avoid.map((a) => String(a)) : undefined,
        departAt: typeof args.departAt === 'string' ? args.departAt : undefined,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }

    if (!routes.length) return fail('Mapbox found no route between those places');

    const best = routes[0];
    const summarise = (r: (typeof routes)[number], rank: number) => ({
      rank,
      distanceKm: km(r.distanceM),
      duration: humanDuration(r.durationS),
      durationMinutes: Math.round(r.durationS / 60),
      // Only the traffic profile reports a typical duration; when it does, the
      // delta is the single most useful number in the whole reply.
      typicalDurationMinutes: r.durationTypicalS == null ? undefined : Math.round(r.durationTypicalS / 60),
      versusTypical:
        r.durationTypicalS == null
          ? undefined
          : `${r.durationS >= r.durationTypicalS ? '+' : ''}${Math.round((r.durationS - r.durationTypicalS) / 60)} min vs a normal day`,
      legs: r.legs.map((leg, i) => ({
        from: points[i]?.given,
        to: points[i + 1]?.given,
        distanceKm: km(leg.distanceM),
        duration: humanDuration(leg.durationS),
        via: leg.summary ?? undefined,
      })),
      steps:
        args.steps === true
          ? r.legs.flatMap((leg) =>
              leg.steps
                .filter((s) => s.instruction)
                .map((s) => `${s.instruction}${s.distanceM >= 50 ? ` (${km(s.distanceM)} km)` : ''}`),
            )
          : undefined,
    });

    const data: Record<string, unknown> = {
      mode,
      waypoints: points.map((p) => ({ asked: p.given, matched: p.resolved, lat: p.lat, lng: p.lng })),
      route: summarise(best, 1),
      alternatives: routes.length > 1 ? routes.slice(1).map((r, i) => summarise(r, i + 2)) : undefined,
    };

    if (args.showMap !== false) {
      const layers: MapLayer[] = [
        { kind: 'track', points: thinRoute(best.coordinates) },
        { kind: 'points', points: points.map((p) => ({ lat: p.lat, lng: p.lng, label: p.given })) },
      ];
      const artifact: Artifact = {
        type: 'map',
        layers,
        caption: `${points[0].given} → ${points[points.length - 1].given} · ${km(best.distanceM)} km · ${humanDuration(best.durationS)}`,
      };
      const envelope: ArtifactToolData = {
        artifact,
        summary: `${mode} route, ${km(best.distanceM)} km in ${humanDuration(best.durationS)}`,
      };
      data.artifact = envelope.artifact;
      data.summary = envelope.summary;
    }

    return { success: true, data };
  },
});

// -------- travel_time_matrix --------

register({
  name: 'travel_time_matrix',
  destructive: false,
  description:
    'Travel time from every origin to every destination in ONE call — the right tool for "which of these is closest", "where should we meet", "which branch is quickest from each of our houses". Takes place NAMES. Vastly cheaper than one route_directions call per pair.',
  parameters: {
    type: 'object',
    properties: {
      origins: {
        type: 'array',
        description: 'Where people or things are starting from. Place names.',
        items: { type: 'string' },
      },
      destinations: {
        type: 'array',
        description: 'Where they might go. Place names. Omit to measure every origin against every other.',
        items: { type: 'string' },
      },
      mode: { type: 'string', enum: [...TRAVEL_MODES], description: MODE_HELP },
      includeDistance: { type: 'boolean', description: 'Also return road distance, not just time.' },
      near: {
        type: 'array',
        description: 'Optional [lat, lng] hint for resolving the names.',
        items: { type: 'number' },
      },
    },
    required: ['origins'],
  },
  category: 'Travel',
  toolset: 'travel',
  handler: async (args): Promise<ToolResult> => {
    const mode = asMode(args.mode);
    if (!mode) return fail(`mode must be one of: ${TRAVEL_MODES.join(', ')}`);

    const origins = Array.isArray(args.origins) ? args.origins.map((o) => String(o)) : [];
    const destinations = Array.isArray(args.destinations) ? args.destinations.map((d) => String(d)) : [];
    if (origins.length < 1) return fail('origins must hold at least one place');

    const near = nearOf(args);
    const { points, unresolved } = await resolveAll([...origins, ...destinations], near);
    if (unresolved.length) return fail(unresolvedError(unresolved, Boolean(near)));

    const cap = maxWaypointsFor(mode);
    if (points.length > cap) {
      return fail(
        `Mapbox allows ${cap} points for ${mode} and this asks for ${points.length}. ` +
          (mode === 'drive' ? 'drive_free_flow allows 25 — use it if live traffic is not essential.' : 'Split the request.'),
      );
    }
    if (points.length < 2) return fail('a matrix needs at least two places');

    // With no destinations given, every point is both a source and a target —
    // Mapbox's own default, and the shape "how far apart are these" wants.
    const sourceIdx = destinations.length ? origins.map((_, i) => i) : undefined;
    const destIdx = destinations.length ? destinations.map((_, i) => origins.length + i) : undefined;

    let result;
    try {
      const { matrix } = await import('$lib/maps/mapbox-api');
      result = await matrix({
        mode,
        coordinates: points.map((p) => [p.lng, p.lat] as [number, number]),
        sources: sourceIdx,
        destinations: destIdx,
        includeDistance: args.includeDistance === true,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }

    const sourceNames = (sourceIdx ?? points.map((_, i) => i)).map((i) => points[i].given);
    const destNames = (destIdx ?? points.map((_, i) => i)).map((i) => points[i].given);

    // A grid of raw seconds is unreadable and invites the model to do arithmetic
    // on it. Rows named on both axes, with the winner already picked, is the
    // answer to the question that was actually asked.
    const rows = sourceNames.map((from, i) => {
      const cells = destNames.map((to, j) => {
        const seconds = result.durations[i]?.[j] ?? null;
        return {
          to,
          duration: seconds == null ? null : humanDuration(seconds),
          minutes: seconds == null ? null : Math.round(seconds / 60),
          distanceKm:
            result.distances?.[i]?.[j] == null ? undefined : km(result.distances[i][j] as number),
        };
      });
      const reachable = cells.filter((c) => c.minutes != null);
      const closest = reachable.length
        ? reachable.reduce((a, b) => ((a.minutes as number) <= (b.minutes as number) ? a : b))
        : null;
      return { from, closest: closest?.to ?? null, to: cells };
    });

    return {
      success: true,
      data: {
        mode,
        matched: points.map((p) => ({ asked: p.given, matched: p.resolved })),
        rows,
        unreachable: rows.some((r) => r.to.some((c) => c.minutes == null)) || undefined,
      },
    };
  },
});

// -------- reachable_area --------

register({
  name: 'reachable_area',
  destructive: false,
  description:
    'How far can you get from a place in N minutes? Returns the reachable AREA as a shape on a map — the tool for "where could we live within a 30-minute commute", "is that inside a 20-minute walk", "what is within an hour\'s drive". Takes a place NAME. Ask for up to four time bands in one call.',
  parameters: {
    type: 'object',
    properties: {
      place: { type: 'string', description: 'The centre. A place name; or "lat,lng".' },
      minutes: {
        type: 'array',
        description: `Time bands to draw, e.g. [15, 30, 45]. Up to ${MAX_CONTOURS} values, each 1–${MAX_CONTOUR_MINUTES}.`,
        items: { type: 'number' },
      },
      mode: { type: 'string', enum: [...TRAVEL_MODES], description: MODE_HELP },
      avoid: {
        type: 'array',
        description: 'Road types to exclude: motorway, toll, ferry, unpaved.',
        items: { type: 'string', enum: ['motorway', 'toll', 'ferry', 'unpaved'] },
      },
      departAt: {
        type: 'string',
        description: 'ISO 8601 local time, for the traffic at that hour rather than now.',
      },
      near: {
        type: 'array',
        description: 'Optional [lat, lng] hint for resolving the place name.',
        items: { type: 'number' },
      },
      showMap: { type: 'boolean', description: 'Draw the area on a map in the chat. Defaults to true.' },
    },
    required: ['place', 'minutes'],
  },
  category: 'Travel',
  toolset: 'travel',
  handler: async (args): Promise<ToolResult> => {
    const mode = asMode(args.mode);
    if (!mode) return fail(`mode must be one of: ${TRAVEL_MODES.join(', ')}`);

    const minutes = Array.isArray(args.minutes) ? args.minutes.map((m) => Number(m)) : [];
    // Every value is checked, not just one of them. The client filters and then
    // keeps the four SMALLEST, so a request for 15/30/45/60/90 would come back
    // as four bands with 90 quietly missing and nothing in the reply saying so —
    // an answer to a different question, which is the failure mode this file
    // refuses everywhere else.
    const outOfRange = minutes.filter((m) => !Number.isFinite(m) || m < 1 || m > MAX_CONTOUR_MINUTES);
    if (outOfRange.length) {
      return fail(
        `each value in minutes must be between 1 and ${MAX_CONTOUR_MINUTES}; got ${outOfRange.join(', ')}`,
      );
    }
    if (minutes.length < 1 || minutes.length > MAX_CONTOURS) {
      return fail(
        `minutes must hold 1–${MAX_CONTOURS} values; got ${minutes.length}. ` +
          'Mapbox draws at most four bands in one call — split the rest into a second call.',
      );
    }

    const near = nearOf(args);
    const centre = await resolvePoint(String(args.place ?? ''), near);
    if (typeof centre === 'string') return fail(unresolvedError([centre], Boolean(near)));

    let contours;
    try {
      const { isochrone } = await import('$lib/maps/mapbox-api');
      contours = await isochrone({
        mode,
        centre: [centre.lng, centre.lat],
        contours: minutes,
        unit: 'minutes',
        exclude: Array.isArray(args.avoid) ? args.avoid.map((a) => String(a)) : undefined,
        departAt: typeof args.departAt === 'string' ? args.departAt : undefined,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }

    if (!contours.length) return fail('Mapbox returned no reachable area for that point');

    const data: Record<string, unknown> = {
      mode,
      centre: { asked: centre.given, matched: centre.resolved, lat: centre.lat, lng: centre.lng },
      // The polygons themselves are thousands of numbers and are drawn, not
      // read. The model gets the size of each band, which is the part it can
      // actually reason about.
      bands: contours.map((c) => ({ minutes: c.value, areaKm2: Math.round(c.areaKm2) })),
    };

    if (args.showMap !== false) {
      // Drawn largest-first so the smaller bands stay visible on top, and thinned
      // for the same reason a route is — an isochrone ring is very dense.
      const layers: MapLayer[] = [
        ...[...contours]
          .sort((a, b) => b.value - a.value)
          .map((c): MapLayer => ({ kind: 'track', points: thinRoute(c.polygon, 120) })),
        { kind: 'points', points: [{ lat: centre.lat, lng: centre.lng, label: centre.given }] },
      ];
      data.artifact = {
        type: 'map',
        layers,
        caption: `Reachable from ${centre.given} by ${mode}: ${contours.map((c) => `${c.value} min`).join(', ')}`,
      } satisfies Artifact;
      data.summary = `${contours.length} reachability band${contours.length === 1 ? '' : 's'} around ${centre.given}`;
    }

    return { success: true, data };
  },
});
