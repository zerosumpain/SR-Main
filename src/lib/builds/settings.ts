/**
 * The editable surface of a build, in one place.
 *
 * Every field here is a column on `jkai_builds` that
 * `Orchestrator.runIteration` re-reads at the top of each iteration, which is
 * what makes these live controls rather than creation-time options: change one
 * mid-build and the next iteration picks it up. Nothing in this module knows
 * about HTTP or Svelte — the PATCH route and the Controls panel both import it
 * so the validation the API enforces and the ranges the sliders offer cannot
 * drift apart.
 *
 * Coercion, not rejection, is the house style for scalars here. A number input
 * posts its value as a string, and this repo has a recorded history of tool
 * bridges stringifying arguments at any depth; `{"maxIterations": "30"}` is a
 * correct patch, and rejecting the whole body over it would strand the caller
 * with no way to tell why. Out-of-range numbers are clamped for the same
 * reason — a fat-fingered 3000000000 should become the ceiling, not a silent
 * no-op.
 *
 * No agent-facing tool currently reaches this endpoint (the `builds` toolset
 * has build_create / build_control / build_tweak, none of which PATCH), and the
 * route sits behind the owner-only gate in hooks.server.ts. The tolerance is
 * defensive, not a licence: nothing here can raise a cap the orchestrator
 * enforces without an owner session.
 */

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const RESEARCH_MODE_OPTIONS = [
  {
    value: 'extend',
    label: 'Extend',
    help: 'Search existing research first; start a Deep Dive only for the gaps, seeded with what was found.',
  },
  {
    value: 'reuse',
    label: 'Reuse only',
    help: 'Use only what the corpus already holds. Seconds, free — and fails fast if the topic is not already covered.',
  },
  {
    value: 'fresh',
    label: 'Fresh',
    help: 'Ignore prior research and always run a full Deep Dive. 30–90 minutes.',
  },
] as const;

export type ResearchMode = (typeof RESEARCH_MODE_OPTIONS)[number]['value'];

/**
 * Budget knobs, with the range each slider offers and a line explaining what
 * the number actually does. The maxima are deliberately generous — they exist
 * to stop a fat finger writing 3 billion, not to express a policy. Studio's own
 * defaults (STUDIO_BUDGET) must fit inside every range here, or saving a Studio
 * build's controls would silently clamp its configuration.
 */
export interface BudgetFieldSpec {
  key: string;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  /** Rendering hint: a raw count, a token count, minutes, or dollars. */
  unit: 'count' | 'tokens' | 'minutes' | 'usd';
  /** Whether "no cap" (null) is a legal value for this field. */
  nullable: boolean;
}

export const BUDGET_FIELDS: BudgetFieldSpec[] = [
  {
    key: 'maxIterations',
    label: 'Max iterations',
    help: 'Hard stop after this many iterations, successful or not.',
    min: 1,
    max: 200,
    step: 1,
    unit: 'count',
    nullable: true,
  },
  {
    key: 'maxTotalMinutes',
    label: 'Total time cap',
    help: 'Wall-clock ceiling for the whole build, from the moment it started.',
    min: 5,
    max: 2880,
    step: 5,
    unit: 'minutes',
    nullable: true,
  },
  {
    key: 'activeMinutesPerHour',
    label: 'Active minutes per hour',
    help: 'Pace limiter. The build sleeps once it has worked this many minutes inside a rolling hour.',
    min: 1,
    max: 60,
    step: 1,
    unit: 'minutes',
    nullable: true,
  },
  {
    key: 'maxTokensPerHour',
    label: 'Tokens per hour',
    help: 'Summed across every iteration in the trailing hour, failed ones included. Too low and one large chapter sleeps the build for the rest of the hour.',
    min: 10_000,
    max: 20_000_000,
    step: 100_000,
    unit: 'tokens',
    nullable: true,
  },
  {
    key: 'maxTokensPerIteration',
    label: 'Tokens per iteration',
    help: 'Enforced mid-stream by the runner, so one runaway iteration cannot spend the hourly budget before anyone gets a say.',
    min: 10_000,
    max: 5_000_000,
    step: 50_000,
    unit: 'tokens',
    nullable: true,
  },
  {
    key: 'maxCostUsd',
    // The floor is 0.5, not 0, and that is load-bearing. `checkBudget` guards
    // with `if (config.maxCostUsd)`, so a stored 0 is falsy and lifts the cap
    // entirely — the UI would show a cost cap of $0 while the build spent
    // without limit. Clear the field to mean "no cap"; there is no way to
    // express it as a number.
    label: 'Cost cap',
    help: 'The real backstop. Tokens and minutes are proxies; this is the number a human actually reasons about. Leave empty for no cap — a cap of 0 is not a thing.',
    min: 0.5,
    max: 500,
    step: 0.5,
    unit: 'usd',
    nullable: true,
  },
  {
    key: 'maxIdleIterations',
    label: 'Idle-iteration breaker',
    help: 'Stop after this many consecutive iterations that changed no files. An agent that believes it is finished but cannot prove it will re-verify forever.',
    min: 0,
    max: 20,
    step: 1,
    unit: 'count',
    nullable: false,
  },
];

const BUDGET_BY_KEY = new Map(BUDGET_FIELDS.map((f) => [f.key, f]));

/** Longest spine we will persist. Ten chapters is a big Studio build; 50 is slack. */
export const MAX_CHAPTER_PLAN = 50;
export const MAX_TITLE_LEN = 200;

export interface ChapterPlanEntry {
  n: number;
  title: string;
  leverId: string;
  outcomeId: string;
}

export interface BuildPatch {
  title?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  enforceDesignSystem?: boolean;
  requireIterationApproval?: boolean;
  enabledToolsets?: string[];
  budgetConfig?: Record<string, number | null>;
  researchMode?: ResearchMode;
  chapterPlan?: ChapterPlanEntry[];
}

/** `"30"` → 30, `30` → 30, `"abc"` / Infinity / null → null. */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toTrimmedString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Validate a patch body into the exact set of columns we are willing to write.
 *
 * Returns only the keys that survived. An empty object means "nothing to do" —
 * callers should treat that as a no-op rather than an error, because a UI that
 * re-sends an unchanged value is normal.
 */
export function sanitiseBuildPatch(body: Record<string, unknown>): BuildPatch {
  const out: BuildPatch = {};
  if (!body || typeof body !== 'object') return out;

  if ('title' in body) {
    const t = toTrimmedString(body.title);
    if (t) out.title = t.slice(0, MAX_TITLE_LEN);
  }

  if ('modelProvider' in body) {
    const p = toTrimmedString(body.modelProvider);
    if (p) out.modelProvider = p;
  }
  if ('modelId' in body) {
    const m = toTrimmedString(body.modelId);
    if (m) out.modelId = m;
  }

  if ('thinkingLevel' in body) {
    const lv = toTrimmedString(body.thinkingLevel) as ThinkingLevel;
    if ((THINKING_LEVELS as readonly string[]).includes(lv)) out.thinkingLevel = lv;
  }

  // Boolean() on the raw value, deliberately: the string "false" is truthy and
  // that is the correct reading here. A caller that means false sends false,
  // 0, or omits the key — a bridge that stringifies sends "false" only when it
  // has already lost the distinction, and guessing the other way would silently
  // disable the design-system guardrail.
  if ('enforceDesignSystem' in body) out.enforceDesignSystem = Boolean(body.enforceDesignSystem);
  if ('requireIterationApproval' in body) {
    out.requireIterationApproval = Boolean(body.requireIterationApproval);
  }

  if ('enabledToolsets' in body && Array.isArray(body.enabledToolsets)) {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const raw of body.enabledToolsets) {
      const s = toTrimmedString(raw);
      if (!s || seen.has(s)) continue;
      seen.add(s);
      list.push(s);
    }
    out.enabledToolsets = list;
  }

  if ('researchMode' in body) {
    const rm = toTrimmedString(body.researchMode) as ResearchMode;
    if (RESEARCH_MODE_OPTIONS.some((o) => o.value === rm)) out.researchMode = rm;
  }

  if ('budgetConfig' in body) {
    const raw = body.budgetConfig;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const budget: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const spec = BUDGET_BY_KEY.get(k);
        if (!spec) continue;
        if (v === null) {
          // An explicit null is "remove this cap" — a real instruction, kept
          // as-is. checkBudget reads a missing/null field as unlimited.
          if (spec.nullable) budget[k] = null;
          continue;
        }
        const n = toFiniteNumber(v);
        if (n === null) continue;
        budget[k] = Math.min(spec.max, Math.max(spec.min, n));
      }
      // Never write an empty object over a populated config: a patch that
      // survived nothing is a patch that meant nothing.
      if (Object.keys(budget).length > 0) out.budgetConfig = budget;
    }
  }

  if ('chapterPlan' in body && Array.isArray(body.chapterPlan)) {
    const plan: ChapterPlanEntry[] = [];
    for (const raw of body.chapterPlan.slice(0, MAX_CHAPTER_PLAN)) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const title = toTrimmedString(r.title);
      // A chapter with no title cannot be built and cannot be reported on.
      if (!title) continue;
      plan.push({
        // Renumbered below — the gate compares `chaptersDue` against these,
        // so a gap or a duplicate would make chapters silently uncheckable.
        n: 0,
        title,
        leverId: toTrimmedString(r.leverId),
        outcomeId: toTrimmedString(r.outcomeId),
      });
    }
    out.chapterPlan = plan.map((c, i) => ({ ...c, n: i + 1 }));
  }

  return out;
}

/**
 * Merge a validated budget patch onto the stored config.
 *
 * The UI sends whole-field edits, not the whole object, so a patch touching
 * only `maxCostUsd` must not erase the other six caps.
 */
export function mergeBudget(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, number | null>,
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const [k, v] of Object.entries(current ?? {})) {
    const n = toFiniteNumber(v);
    if (n !== null && BUDGET_BY_KEY.has(k)) merged[k] = n;
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  return merged;
}
