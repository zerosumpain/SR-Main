// facts.server.ts — every figure this study prints, read from the code that runs the feature.
//
// The first version of this study copied its numbers into typed constants by hand. They were
// right on the day they were counted and wrong within weeks: a cap moved, a stage was added,
// a lane was retired, and the page went on describing the old machine with total confidence.
// So the rule now is the reverse of that. Nothing here is a literal. Each value is imported
// from the module the feature itself reads, and when the feature changes, this changes with
// it on the next deploy. The explainer copy beside it is keyed by the same types, so a stage
// added or removed in the feature fails the type check until someone writes a sentence for it.
//
// SERVER-ONLY: several of these modules reach the database through their imports. The layout
// load hands the result to the pages as plain data.

import { STAGES, STAGE_LABEL, STAGE_EXPLAIN } from '$lib/daydream/think/explain';
import { CHANNELS, OUTCOMES, SCHEDULE, SKIP, THINK_CADENCE_MS, VISITS_PER_PERIOD, questionAt } from '$lib/daydream/think/questions';
import { CHANNEL_LABEL, OUTCOME_LABEL, DAILY_RAISE_CAP } from '$lib/daydream/think/notes';
import { MAX_NOTES } from '$lib/daydream/think/audit';
import { MAX_ROUNDS } from '$lib/daydream/think/run';
import { MAX_TOOL_CALLS, LOCAL_TOOLS, PRIVATE_SITE_TOOLS, RESEARCH_SITE_TOOLS } from '$lib/daydream/think/tools';
import { ACTIVE_HOURS } from '$lib/daydream/budget';
import { COMMISSION_STATES, COMMISSION_LABELS, nextActor } from '$lib/daydream/commissioning';
import { IMPACT_WINDOW_DAYS } from '$lib/daydream/impact';
import { IDEA_SOURCES, WORK_STAGES, STAGE_META } from '$lib/selfimprove/board';
import { BUDGET_CAPS, WORK_CAPS } from '$lib/selfimprove/types';
import { RELEASE_POLICIES, RELEASE_POLICY_LABELS, AUTOPILOT_ROUNDS, BRIEF_LANES } from '$lib/constants/development';
import { DEFAULT_BUILD_BUDGET } from '$lib/jkai/budget';
import { EDGE_KINDS, VERDICTS, MAX_HOPS, MAX_LIMIT, MAX_BUDGET, DEFAULT_BUDGET } from '$lib/codegraph/query';
import { GATE_NAMES } from '$lib/codegraph/gates';
import { VERDICT_WEIGHT, EVIDENCE_MATURITY } from '$lib/codegraph/relevance';
import { listHandlers } from '$lib/heartbeat/registry';
import { DEFAULT_IDLE_WINDOW_MS } from '$lib/heartbeat/idle';
import { PAIR_CODE_TTL_MS, DEVICE_TOKEN_TTL_MS } from '$lib/server/native-auth';
import { ROUTE_MANIFEST } from 'virtual:sr-route-manifest';
import { HEARTBEAT_ACTIVITIES, type HeartbeatActivity } from './build';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** One activity on the heartbeat, as much of it as is safe to print: name and timing. */
export interface ActivityFact {
  name: HeartbeatActivity;
  cadenceMinutes: number;
  window: string | null;
}

/** Native endpoints grouped by the first path segment after /api/native. */
export interface EndpointArea {
  area: string;
  endpoints: number;
  methods: number;
}

function nativeAreas(): EndpointArea[] {
  const by = new Map<string, EndpointArea>();
  for (const r of ROUTE_MANIFEST) {
    if (r.kind !== 'api' || !r.path.startsWith('/api/native/')) continue;
    const area = r.path.split('/')[3]?.replace(/^\[.*\]$/, 'other') || 'other';
    const a = by.get(area) ?? { area, endpoints: 0, methods: 0 };
    a.endpoints += 1;
    a.methods += r.methods.length;
    by.set(area, a);
  }
  return [...by.values()].sort((a, b) => b.endpoints - a.endpoints || a.area.localeCompare(b.area));
}

function activities(): ActivityFact[] {
  const wanted = new Set<string>(HEARTBEAT_ACTIVITIES);
  return listHandlers()
    .filter((h) => wanted.has(h.name))
    .map((h) => ({
      name: h.name as HeartbeatActivity,
      cadenceMinutes: Math.round(h.defaultCadenceSeconds / 60),
      window: h.defaultActiveHours ? `${h.defaultActiveHours.start}–${h.defaultActiveHours.end}` : null,
    }));
}

/** The next few questions the think loop will ask, by the same clock it uses. */
function upcoming(now: Date, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(now.getTime() + i * THINK_CADENCE_MS);
    const q = questionAt(at);
    return { at: at.toISOString(), channel: q.channel, outcome: q.outcome };
  });
}

export function loadFacts(now = new Date()) {
  const pairs = CHANNELS.flatMap((c) => OUTCOMES.map((o) => ({ channel: c, outcome: o })));
  return {
    daydream: {
      stages: STAGES.map((id) => ({ id, label: STAGE_LABEL[id], explain: STAGE_EXPLAIN[id] })),
      channels: CHANNELS.map((id) => ({ id, label: CHANNEL_LABEL[id] })),
      outcomes: OUTCOMES.map((id) => ({ id, label: OUTCOME_LABEL[id] })),
      schedule: Object.fromEntries(CHANNELS.map((c) => [c, [...SCHEDULE[c]]])) as Record<string, string[]>,
      skipped: SKIP.map(([channel, outcome, why]) => ({ channel, outcome, why })),
      pairCount: pairs.length,
      visitsPerPeriod: VISITS_PER_PERIOD,
      cadenceMinutes: THINK_CADENCE_MS / MIN,
      activeHours: { ...ACTIVE_HOURS },
      maxRounds: MAX_ROUNDS,
      maxToolCalls: MAX_TOOL_CALLS,
      maxNotesPerCycle: MAX_NOTES,
      dailyRaiseCap: DAILY_RAISE_CAP,
      tools: {
        private: LOCAL_TOOLS.length + PRIVATE_SITE_TOOLS.length,
        web: RESEARCH_SITE_TOOLS.length,
      },
      commissions: COMMISSION_STATES.map((id) => ({ id, label: COMMISSION_LABELS[id], actor: nextActor(id) })),
      impactWindowDays: IMPACT_WINDOW_DAYS,
      upcoming: upcoming(now, 8),
    },
    build: {
      ideaSources: [...IDEA_SOURCES],
      workStages: WORK_STAGES.map((id) => ({ id, label: STAGE_META[id].label, question: STAGE_META[id].question })),
      night: {
        maxLlmCalls: BUDGET_CAPS.maxLlmCalls,
        maxCostUsd: BUDGET_CAPS.maxCostUsd,
        maxWallMinutes: BUDGET_CAPS.maxWallMs / MIN,
        // Only the caps the run actually reads. `maxToolCandidates` and `maxRepairRounds`
        // still exist in WORK_CAPS but nothing consults them since tool authoring retired.
        maxToolsRepaired: WORK_CAPS.maxToolsRepaired,
        maxDeliveries: WORK_CAPS.maxDeliveries,
        maxWatches: WORK_CAPS.maxWatches,
      },
      releasePolicies: RELEASE_POLICIES.map((id) => ({ id, label: RELEASE_POLICY_LABELS[id] })),
      autopilotRounds: { ...AUTOPILOT_ROUNDS },
      briefLanes: [...BRIEF_LANES],
      budget: {
        maxIterations: DEFAULT_BUILD_BUDGET.maxIterations,
        maxMinutes: DEFAULT_BUILD_BUDGET.maxTotalMinutes,
        maxTokensPerHour: DEFAULT_BUILD_BUDGET.maxTokensPerHour,
        maxIdleIterations: DEFAULT_BUILD_BUDGET.maxIdleIterations,
      },
      gates: [...GATE_NAMES],
      codegraph: {
        edgeKinds: [...EDGE_KINDS],
        verdicts: VERDICTS.map((v) => ({ id: v, weight: VERDICT_WEIGHT[v] ?? null })),
        maxHops: MAX_HOPS,
        maxLimit: MAX_LIMIT,
        maxBudget: MAX_BUDGET,
        defaultBudget: DEFAULT_BUDGET,
        evidenceMaturity: EVIDENCE_MATURITY,
      },
      activities: activities(),
      idleMinutes: DEFAULT_IDLE_WINDOW_MS / MIN,
    },
    app: {
      pairCodeMinutes: PAIR_CODE_TTL_MS / MIN,
      deviceTokenDays: DEVICE_TOKEN_TTL_MS / DAY,
      nativeAreas: nativeAreas(),
    },
  };
}

export type Facts = ReturnType<typeof loadFacts>;
