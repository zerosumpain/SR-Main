/**
 * Research depth — the one thing a user picks.
 *
 * The old launcher asked people to compose a depth out of six orthogonal dials
 * (`timeLimit`, `maxSources`, `diversityThreshold`, `analysisDepth`,
 * `redTeamAggression`, `maxFactsBeforePhase3`) and offered a shortest bound of
 * fifteen MINUTES. Measured reality was a cliff: quick answers finished at a p50
 * of 50s, deep dives at a p50 of 25 minutes, and nothing existed in between.
 *
 * A depth is now a single enum value that expands, server-side, into the config
 * the existing phases already understand, plus three things they did not have:
 * a wall-clock budget, a phase list, and a pinned model.
 *
 * On the pinned model: the fast tiers must NOT inherit the site default. It may
 * be a reasoning model (reasoning tokens eat `max_tokens` and add tens of
 * seconds before the first content token) or a `codex/` id (~10s on the first
 * call, and it cannot stream reasoning at all). Either would spend most of a
 * 110-second budget before saying anything. `investigation` has no clock to
 * protect, so it keeps the site default and whatever quality that buys.
 */
import type { SessionConfig } from './types';
import { env } from '$env/dynamic/private';

export const RESEARCH_DEPTHS = ['instant', 'scan', 'brief', 'investigation'] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

/** Phases the worker can run, in the order the worker runs them. */
export type PhaseName = 'phase1' | 'phase2' | 'phase3' | 'post';

/**
 * Which engine drives the tier.
 *
 * `phases` is the original multi-phase chain, whose loops carry their own
 * saturation stop conditions and no clock. The budgeted tiers each get a
 * purpose-built runner instead, because the phase chain cannot be made to fit
 * inside two minutes by configuration alone: `phase1` spends one LLM call
 * CATEGORISING every single source it stores, which at 15 sources is 15 serial
 * round-trips before any analysis starts.
 */
export type RunnerName = 'instant' | 'scan' | 'brief' | 'phases';

/**
 * The `brief` tier's wall-clock allowance. Deliberately under two minutes with
 * headroom to spare: the promise is that the ANSWER reaches the browser inside
 * 120s, not that the server stops working at 120s.
 */
export const BRIEF_BUDGET_MS = 110_000;

/**
 * Output ceiling for any tier's synthesis.
 *
 * Above `REASONING_TOKEN_FLOOR` (3,000) with headroom, because reasoning tokens
 * are billed against `max_tokens`: a 2,000-token cap measured 3,251 characters
 * of reasoning against a 421-character answer that began mid-sentence — the
 * model had spent the budget thinking.
 *
 * Not higher, though. OpenRouter reserves credit for the FULL `max_tokens` up
 * front and rejects the call with `402 requires more credits, or fewer
 * max_tokens` when the balance cannot cover it. An 8,000 ceiling started
 * 402-ing on a nearly-spent account while 4,000 still cleared, so this is a
 * deliberate balance between not starving the answer and not pricing the call
 * out of a thin balance.
 */
export const SYNTHESIS_MAX_TOKENS = 4_000;

export interface DepthPreset {
  depth: ResearchDepth;
  /** Short user-facing name shown on the picker. */
  label: string;
  /** One line explaining what this tier actually does. */
  blurb: string;
  /** Whether the tier touches a search API at all. */
  searches: boolean;
  /** Whether the tier distils sources into stored facts and entities. */
  extractsFacts: boolean;
  /** Which engine drives this tier. */
  runner: RunnerName;
  /** Phases to run. Only meaningful when `runner` is 'phases'. */
  phases: PhaseName[];
  /** Wall-clock allowance; null means unbudgeted. */
  budgetMs: number | null;
  /** Milliseconds carved off the tail so synthesis always gets to speak. */
  reserves: { synthesis?: number };
  /** Model id to force, or null to use the admin-configured site default. */
  pinnedModel: string | null;
  /** Upper bound on sources; 0 for tiers that do not search. */
  maxSources: number;
  /** The knobs the existing phase code already reads. */
  config: SessionConfig;
}

export function isDepth(value: unknown): value is ResearchDepth {
  return typeof value === 'string' && (RESEARCH_DEPTHS as readonly string[]).includes(value);
}

/**
 * Legacy vocabularies that must keep working.
 *
 * `quick`/`deep` came from the old segmented control; `shallow`/`standard`/
 * `deep` from `SessionConfig.analysisDepth`. The `deep-research` workflow node
 * has been passing one of these into `research_start` since it was written —
 * against a tool that never declared a `depth` parameter, so the value was
 * silently discarded on every run. Mapping them is what makes that call
 * finally mean something.
 */
const LEGACY_DEPTHS: Record<string, ResearchDepth> = {
  quick: 'scan',
  fast: 'scan',
  shallow: 'scan',
  standard: 'brief',
  medium: 'brief',
  deep: 'investigation',
  full: 'investigation',
};

/** Normalise anything into a depth, defaulting to the middle tier. */
export function coerceDepth(value: unknown): ResearchDepth {
  if (typeof value !== 'string') return 'brief';
  const key = value.trim().toLowerCase();
  if (isDepth(key)) return key;
  return LEGACY_DEPTHS[key] ?? 'brief';
}

/**
 * The fast-tier model.
 *
 * Hardcoded rather than derived from `getFallbackModel()`, which was the first
 * attempt and was wrong: that setting is the RATE-LIMIT fallback, and this
 * install had it configured to `z-ai/glm-5-turbo` — a reasoning model. A brief
 * run on it spent its entire 110s budget and produced an empty answer, because
 * reasoning tokens consume `max_tokens` before any content is emitted. Pinning
 * to a field someone else tunes for a different purpose is not pinning.
 *
 * The requirement is narrow and worth stating: fast, non-reasoning, and not a
 * `codex/` id (those cost ~10s on the first call and cannot stream reasoning).
 * `RESEARCH_FAST_MODEL` overrides it without a deploy.
 */
export const DEFAULT_FAST_MODEL = 'google/gemini-3.5-flash';

function fastModel(): string {
  return env.RESEARCH_FAST_MODEL || DEFAULT_FAST_MODEL;
}

export function depthPreset(depth: ResearchDepth): DepthPreset {
  const d = coerceDepth(depth);

  switch (d) {
    case 'instant':
      return {
        depth: d,
        label: 'Instant',
        blurb: 'The model answers from what it already knows. No sources, no search.',
        searches: false,
        extractsFacts: false,
        runner: 'instant',
        phases: [],
        budgetMs: 30_000,
        reserves: { synthesis: 25_000 },
        pinnedModel: fastModel(),
        maxSources: 0,
        config: {
          maxSources: 0,
          diversityThreshold: 'low',
          analysisDepth: 'shallow',
          redTeamAggression: 'gentle',
          maxFactsBeforePhase3: 0,
        },
      };

    case 'scan':
      return {
        depth: d,
        label: 'Scan',
        blurb: 'One round of web search, cited, synthesised in a single pass.',
        searches: true,
        extractsFacts: false,
        runner: 'scan',
        phases: [],
        budgetMs: 90_000,
        reserves: { synthesis: 25_000 },
        pinnedModel: fastModel(),
        maxSources: 12,
        config: {
          maxSources: 12,
          diversityThreshold: 'low',
          analysisDepth: 'shallow',
          redTeamAggression: 'gentle',
          maxFactsBeforePhase3: 0,
        },
      };

    case 'brief':
      return {
        depth: d,
        label: 'Brief',
        blurb:
          'A bounded round of research: sources, extracted facts and entities, one synthesis. Under two minutes.',
        searches: true,
        extractsFacts: true,
        runner: 'brief',
        phases: [],
        budgetMs: BRIEF_BUDGET_MS,
        reserves: { synthesis: 25_000 },
        pinnedModel: fastModel(),
        maxSources: 15,
        config: {
          maxSources: 15,
          diversityThreshold: 'medium',
          analysisDepth: 'shallow',
          redTeamAggression: 'gentle',
          maxFactsBeforePhase3: 60,
        },
      };

    case 'investigation':
    default:
      return {
        depth: 'investigation',
        label: 'Investigation',
        blurb:
          'The full desk: breadth search, fact and entity extraction, adversarial red-team, clustering and gaps.',
        searches: true,
        extractsFacts: true,
        runner: 'phases',
        phases: ['phase1', 'phase2', 'phase3', 'post'],
        budgetMs: null,
        reserves: {},
        pinnedModel: null,
        maxSources: 40,
        config: {
          maxSources: 40,
          diversityThreshold: 'medium',
          // MUST be 'deep'. Relationship extraction in phase 2 is gated on this
          // exact value, so 'standard' produced investigations with entities and
          // ZERO edges — an entity network of isolated dots, and an empty graph
          // in the Word export. It is the full-engine tier; this is what makes
          // it full.
          analysisDepth: 'deep',
          redTeamAggression: 'standard',
          maxFactsBeforePhase3: 200,
        },
      };
  }
}
