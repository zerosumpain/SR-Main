import { register } from '../registry-internal';
import { ORS_PROFILES, ORS_ROUND_TRIP_MAX_M } from '$lib/trails/ors';

// The planner pulls in the database and the health analytics. Registration
// happens on every import of the tool registry — including paths that only
// want to enumerate tool schemas — so it is loaded inside the handlers
// instead, the same way route-export defers its WhatsApp import.

// Why this exists: `route_export` used to be the whole route builder, and its
// description told the model to "generate snapped OSM geometry" itself. A
// language model writing coordinates cannot know whether a lane is a dead end,
// what its surface is, or how steep it gets — which is exactly how routes end
// up padding distance by running down a lane and turning back.
//
// This tool does the real thing: openrouteservice supplies candidate geometry,
// and our scorer ranks it on retracing, out-and-back spurs, terrain fit and
// the shape of the climbing. Plan here, then hand the GPX to `route_export`.

const SPORTS = Object.keys(ORS_PROFILES);

register({
  name: 'route_plan',
  destructive: false,
  description:
    'Plan a real running, road-cycling, mountain-bike or hiking route with openrouteservice and rank the candidates on loop quality (retracing, out-and-back spurs, surface, climbing). Returns the top 3 with GPX. Use this instead of writing coordinates yourself. Omit targetDistanceKm to let recent training history choose the distance. This is for TRAINING — a circular route scored on terrain. For simply getting from one place to another, with journey time and live traffic, use route_directions.',
  parameters: {
    type: 'object',
    properties: {
      startLat: { type: 'number', description: 'Start latitude.' },
      startLng: { type: 'number', description: 'Start longitude.' },
      finishLat: { type: 'number', description: 'Finish latitude. Omit for a circular route.' },
      finishLng: { type: 'number', description: 'Finish longitude. Omit for a circular route.' },
      sport: {
        type: 'string',
        enum: SPORTS,
        description: 'run, trail_run, walk, hike, ride (road cycling) or mtb.',
      },
      targetDistanceKm: {
        type: 'number',
        description: `Target distance in km. Circular routes are capped at ${ORS_ROUND_TRIP_MAX_M / 1000} km. Omit to derive it from recent training load.`,
      },
      targetClimbPerKm: {
        type: 'number',
        description: 'Desired metres of climb per km. Omit if the user did not say.',
      },
      prefer: {
        type: 'string',
        enum: ['steady', 'spiky', 'any'],
        description: 'Shape of the climbing: a steady drag or one big wall.',
      },
      allowOutAndBack: {
        type: 'boolean',
        description:
          'Set true ONLY if the user explicitly wants an out-and-back. Otherwise retracing is penalised.',
      },
      candidates: {
        type: 'number',
        description: 'How many loops to try before ranking (2-8, default 5).',
      },
      includeGpx: {
        type: 'boolean',
        description: 'Include GPX for the top route. Defaults to true.',
      },
    },
    required: ['startLat', 'startLng', 'sport'],
  },
  category: 'Routes',
  toolset: 'health',
  handler: async (args) => {
    const startLat = Number(args.startLat);
    const startLng = Number(args.startLng);
    if (!Number.isFinite(startLat) || !Number.isFinite(startLng)) {
      return { success: false, error: 'startLat and startLng must be numbers' };
    }

    const sport = String(args.sport ?? 'run') as keyof typeof ORS_PROFILES;
    if (!ORS_PROFILES[sport]) {
      return { success: false, error: `sport must be one of: ${SPORTS.join(', ')}` };
    }

    const hasFinish = Number.isFinite(Number(args.finishLat)) && Number.isFinite(Number(args.finishLng));

    try {
      const { planRoutes, routeToGpx } = await import('$lib/trails/planner');
      const result = await planRoutes({
        start: [startLng, startLat],
        finish: hasFinish ? [Number(args.finishLng), Number(args.finishLat)] : undefined,
        sport,
        targetDistanceM: args.targetDistanceKm ? Number(args.targetDistanceKm) * 1000 : undefined,
        targetGainPerKm: args.targetClimbPerKm ? Number(args.targetClimbPerKm) : undefined,
        prefer: (args.prefer as 'steady' | 'spiky' | 'any') ?? 'any',
        allowOutAndBack: args.allowOutAndBack === true,
        candidates: args.candidates ? Number(args.candidates) : undefined,
      });

      // The full coordinate array is tens of thousands of numbers — useless in
      // a chat transcript and expensive in context. The model gets the verdict
      // and the numbers behind it; geometry travels as GPX only.
      const routes = result.routes.map((r) => ({
        rank: r.rank,
        score: r.score,
        distanceKm: Number((r.distanceM / 1000).toFixed(2)),
        durationMin: Math.round(r.durationS / 60),
        ascentM: r.ascentM == null ? null : Math.round(r.ascentM),
        climbPerKm: Math.round(r.breakdown.profile.gainPerKm),
        retracedPercent: Math.round(r.breakdown.overlap.ratio * 100),
        outAndBackSections: r.breakdown.spurs.spurs.length,
        longestSpurM: Math.round(r.breakdown.spurs.longestM),
        offRoadPercent: Math.round(r.breakdown.terrain.offRoadShare * 100),
        notes: r.breakdown.notes,
      }));

      const top = result.routes[0];
      const includeGpx = args.includeGpx !== false;
      const distanceLabel = `${(top.distanceM / 1000).toFixed(1)}km`;

      return {
        success: true,
        data: {
          routes,
          targetDistanceKm: Number((result.targetDistanceM / 1000).toFixed(2)),
          targetSource: result.targetSource,
          rationale: result.rationale,
          attempted: result.attempted,
          failures: result.failures.length ? result.failures : undefined,
          gpx: includeGpx
            ? routeToGpx(top.coordinates, `${sport} ${distanceLabel}`)
            : undefined,
          suggestedBasename: `${new Date().toISOString().slice(0, 10)}-${sport}-${distanceLabel}.gpx`,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

register({
  name: 'route_target_suggest',
  destructive: false,
  description:
    'Suggest a sensible route distance for a sport from recent training history, ACWR training load and readiness. Use when the user asks "how far should I go today".',
  parameters: {
    type: 'object',
    properties: {
      sport: { type: 'string', enum: SPORTS, description: 'run, trail_run, walk, hike, ride or mtb.' },
    },
    required: ['sport'],
  },
  category: 'Routes',
  toolset: 'health',
  handler: async (args) => {
    const sport = String(args.sport ?? 'run');
    if (!SPORTS.includes(sport)) {
      return { success: false, error: `sport must be one of: ${SPORTS.join(', ')}` };
    }
    const { suggestTarget } = await import('$lib/trails/planner');
    const suggested = await suggestTarget(sport);
    return {
      success: true,
      data: {
        distanceKm: Number((suggested.distanceM / 1000).toFixed(2)),
        source: suggested.source,
        rationale: suggested.rationale,
      },
    };
  },
});
