import { register } from '../registry-internal';
import { getFromExtracted, postToExtracted } from '$lib/server/extracted-app';
import { ORS_PROFILES, ORS_ROUND_TRIP_MAX_M } from '$lib/constants/planner-sports';

// The planner is SR-Health's now, and these two tools call it over the service
// lane. What they cannot do is call it to build their own SCHEMA: the `sport`
// enum and the distance-cap wording below are read when the tool registry
// loads, which must not depend on another process being up. So the sport list
// and the cap live in $lib/constants/planner-sports, a file SR-Health holds
// byte for byte and both drift manifests guard.
//
// That split is the point of this file. Take the constants from here and leave
// the planner call as a local import and the build stays green while every call
// fails — a tool the model can see, whose every invocation returns an error it
// cannot act on. The audit named this pair for exactly that reason: fixing one
// half is worse than fixing neither.

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

/**
 * The subset of SR-Health's planner result this tool actually reads.
 *
 * Not a shared contract file, deliberately: the full result is that
 * application's internal shape, large, and mostly geometry this tool discards.
 * The cost of declaring only a subset is that a rename on the far side arrives
 * as `undefined` and `Math.round(undefined)` is NaN — a route summary full of
 * NaN, reported as a success, is exactly the silent failure this whole exercise
 * is about. So every number goes through `num`, which throws instead.
 */
type PlannedRoute = {
  rank: number;
  score: number;
  distanceM: number;
  durationS: number;
  ascentM: number | null;
  coordinates?: unknown;
  breakdown: {
    profile: { gainPerKm: number };
    overlap: { ratio: number };
    spurs: { spurs: unknown[]; longestM: number };
    terrain: { offRoadShare: number };
    notes: unknown;
  };
};

type PlanResponse = {
  routes: PlannedRoute[];
  targetDistanceM: number;
  targetSource: unknown;
  rationale: unknown;
  attempted: unknown;
  failures: unknown[];
  gpx?: string;
};

function num(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`route planner returned no usable ${field} — the response shape has changed`);
  }
  return value;
}

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

    const includeGpx = args.includeGpx !== false;

    try {
      // 60s, not the client's 4s default: this fans out to openrouteservice for
      // several candidates and then scores them. It was unbounded in-process.
      const result = await postToExtracted<PlanResponse>(
        'health',
        '/api/trails/plan',
        {
          startLat,
          startLng,
          ...(hasFinish ? { finishLat: Number(args.finishLat), finishLng: Number(args.finishLng) } : {}),
          sport,
          targetDistanceM: args.targetDistanceKm ? Number(args.targetDistanceKm) * 1000 : undefined,
          targetGainPerKm: args.targetClimbPerKm ? Number(args.targetClimbPerKm) : undefined,
          prefer: (args.prefer as 'steady' | 'spiky' | 'any') ?? 'any',
          allowOutAndBack: args.allowOutAndBack === true,
          candidates: args.candidates ? Number(args.candidates) : undefined,
          // Generated on the far side, where the coordinates are. This tool
          // never puts geometry in a chat transcript.
          includeGpx,
        },
        { timeoutMs: 60_000 },
      );

      if (!result.routes?.length) {
        return { success: false, error: 'the planner returned no routes for that request' };
      }

      // The full coordinate array is tens of thousands of numbers — useless in
      // a chat transcript and expensive in context. The model gets the verdict
      // and the numbers behind it; geometry travels as GPX only.
      const routes = result.routes.map((r) => ({
        rank: r.rank,
        score: r.score,
        distanceKm: Number((num(r.distanceM, 'distanceM') / 1000).toFixed(2)),
        durationMin: Math.round(num(r.durationS, 'durationS') / 60),
        ascentM: r.ascentM == null ? null : Math.round(r.ascentM),
        climbPerKm: Math.round(num(r.breakdown?.profile?.gainPerKm, 'breakdown.profile.gainPerKm')),
        retracedPercent: Math.round(num(r.breakdown?.overlap?.ratio, 'breakdown.overlap.ratio') * 100),
        outAndBackSections: r.breakdown?.spurs?.spurs?.length ?? 0,
        longestSpurM: Math.round(num(r.breakdown?.spurs?.longestM, 'breakdown.spurs.longestM')),
        offRoadPercent: Math.round(num(r.breakdown?.terrain?.offRoadShare, 'breakdown.terrain.offRoadShare') * 100),
        notes: r.breakdown?.notes,
      }));

      const top = result.routes[0];
      const distanceLabel = `${(num(top.distanceM, 'distanceM') / 1000).toFixed(1)}km`;

      return {
        success: true,
        data: {
          routes,
          targetDistanceKm: Number((result.targetDistanceM / 1000).toFixed(2)),
          targetSource: result.targetSource,
          rationale: result.rationale,
          attempted: result.attempted,
          failures: result.failures?.length ? result.failures : undefined,
          gpx: result.gpx,
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
    const suggested = await getFromExtracted<{
      distanceM: number;
      source: unknown;
      rationale: unknown;
    }>('health', `/api/trails/plan?sport=${encodeURIComponent(sport)}`, { timeoutMs: 15_000 });
    return {
      success: true,
      data: {
        distanceKm: Number((num(suggested.distanceM, 'distanceM') / 1000).toFixed(2)),
        source: suggested.source,
        rationale: suggested.rationale,
      },
    };
  },
});
