// engine.ts — the alignment engine. A deterministic, transparent, evidence-weighted
// RUBRIC (not a numeric forecast). Given a StrategyState (posture toggles + allocation
// sliders + a maturity self-assessment) it scores:
//   • capability strength per area (allocation, saturating, modulated by posture);
//   • pressure coverage (severity-weighted), overall and per origin;
//   • maturity progress toward the lead's targets (penalising unfunded ambition);
//   • strategic TENSIONS (rule-based incoherence/feasibility flags);
//   • the legislation implicated by the chosen posture;
//   • a recommended focus (highest-leverage unaddressed gaps).
// Everything is traceable back to params.ts. Pure + client-side.

import { clamp, saturate } from './format';
import { PARAMS } from './params';
import { CAPABILITY_IDS } from './capabilities';
import { POSTURE_AXES } from './postures';
import { PRESSURES } from './pressures';
import { MATURITY_DIMENSIONS } from './maturity';
import type {
  AlignmentResult,
  CoverageTraceTerm,
  FocusItem,
  Origin,
  StrategyState,
  Tension,
} from './types';

const N = CAPABILITY_IDS.length;
const ORIGINS: Origin[] = ['cross-government', 'dfe-policy', 'partners'];

/** A sensible neutral starting strategy: balanced postures, even allocation,
 *  current maturity ~2 ("emerging"), target ~4 ("optimised"). */
export function defaultState(): StrategyState {
  const allocation: Record<string, number> = {};
  for (const id of CAPABILITY_IDS) allocation[id] = Math.round(1000 / N) / 10; // even split
  const postures: Record<string, number> = {};
  for (const a of POSTURE_AXES) postures[a.id] = 0;
  const maturityCurrent: Record<string, number> = {};
  const maturityTarget: Record<string, number> = {};
  for (const d of MATURITY_DIMENSIONS) {
    maturityCurrent[d.id] = 2;
    maturityTarget[d.id] = 4;
  }
  return { postures, allocation, maturityCurrent, maturityTarget };
}

/** Allocation shares normalised to sum 1 across the capability areas. */
function allocShares(state: StrategyState): Record<string, number> {
  let total = 0;
  for (const id of CAPABILITY_IDS) total += Math.max(0, state.allocation[id] ?? 0);
  const shares: Record<string, number> = {};
  for (const id of CAPABILITY_IDS) {
    shares[id] = total > 0 ? Math.max(0, state.allocation[id] ?? 0) / total : 1 / N;
  }
  return shares;
}

/** Effective capability per area: saturating allocation × clamped posture multiplier. */
export function capabilities(state: StrategyState): {
  capability: Record<string, number>;
  base: Record<string, number>;
  mult: Record<string, number>;
} {
  const shares = allocShares(state);
  const base: Record<string, number> = {};
  const mult: Record<string, number> = {};
  const capability: Record<string, number> = {};

  for (const id of CAPABILITY_IDS) base[id] = saturate(shares[id] * N, PARAMS.CAP_K);

  // posture modulation
  const m: Record<string, number> = {};
  for (const id of CAPABILITY_IDS) m[id] = 1;
  for (const axis of POSTURE_AXES) {
    const v = clamp(state.postures[axis.id] ?? 0, -1, 1);
    for (const { area, weight } of axis.affects) {
      m[area] = (m[area] ?? 1) + v * weight;
    }
  }
  for (const id of CAPABILITY_IDS) {
    mult[id] = clamp(m[id], PARAMS.MULT_MIN, PARAMS.MULT_MAX);
    capability[id] = clamp(base[id] * mult[id], 0, 1);
  }
  return { capability, base, mult };
}

function coverageFor(
  cap: Record<string, number>,
  demands: string[],
): { value: number; trace: CoverageTraceTerm[] } {
  const areas = demands.length ? demands : CAPABILITY_IDS;
  const w = 1 / areas.length;
  let value = 0;
  const trace: CoverageTraceTerm[] = [];
  for (const a of areas) {
    const c = cap[a] ?? 0;
    value += c * w;
    trace.push({ area: a, cap: c, weight: w });
  }
  return { value: clamp(value), trace };
}

// ---- tension rules: each inspects the state + computed result and may flag a tension ----
type Ctx = {
  state: StrategyState;
  cap: Record<string, number>;
  coverage: Record<string, number>;
  coverageByOrigin: Record<Origin, number>;
  overallCoverage: number;
};

function p(state: StrategyState, id: string): number {
  return clamp(state.postures[id] ?? 0, -1, 1);
}

const TENSION_RULES: Array<(c: Ctx) => Tension | null> = [
  // Centralising against a federated reality.
  (c) =>
    p(c.state, 'operating-model') < -0.4 && c.coverageByOrigin.partners < 0.5
      ? {
          id: 'centralise-vs-federation',
          title: 'Centralising against a federated reality',
          severity: 'high',
          explanation:
            'You are leaning hard toward a single central model, yet the partner pressures (LAs, MATs, agencies) are poorly covered. Education data is held across thousands of autonomous bodies — a purely central model collides with that.',
          resolution:
            'Either invest in partner data-sharing & interoperability to make centralisation viable, or soften toward a federated/standards-led model that meets partners where they are.',
          triggers: ['operating-model = Centralise', 'partner coverage < 50%'],
        }
      : null,
  // Open-by-default without the trust foundations.
  (c) =>
    p(c.state, 'openness') < -0.35 && (c.cap.ethics ?? 0) < 0.5
      ? {
          id: 'open-without-trust',
          title: 'Open-by-default without the trust foundations',
          severity: 'high',
          explanation:
            'An open-by-default posture is set while ethics, trust & transparency are under-resourced. With children’s data this risks public trust, lawful-basis gaps and confidentiality breaches.',
          resolution:
            'Raise investment in ethics, trust & transparency (DPIAs, transparency via ATRS, safeguarding) before defaulting to open, or move the posture toward secure-by-default.',
          triggers: ['openness = Open by default', 'ethics capability < 0.5'],
          legalRefs: ['uk-gdpr', 'common-law-confidentiality', 'dpa-2018'],
        }
      : null,
  // Expanding sharing faster than governance.
  (c) =>
    (c.cap.sharing ?? 0) > 0.55 && ((c.cap.governance ?? 0) < 0.5 || (c.cap.ethics ?? 0) < 0.5)
      ? {
          id: 'sharing-ahead-of-governance',
          title: 'Expanding data-sharing faster than governance',
          severity: 'medium',
          explanation:
            'Partner data-sharing is well-resourced but governance and/or ethics lag behind. Cross-organisation sharing without a clear legal gateway, DPIAs and accountability is where data-sharing programmes fail.',
          resolution:
            'Pair the sharing investment with governance & ethics: a named legal gateway (e.g. DEA 2017), DPIAs, sharing agreements and clear accountability.',
          triggers: ['sharing capability high', 'governance/ethics capability low'],
          legalRefs: ['dea-2017', 'uk-gdpr', 'dpa-2018'],
        }
      : null,
  // AI ambition ahead of foundations.
  (c) =>
    p(c.state, 'ambition') > 0.4 && (c.cap.quality ?? 0) < 0.5
      ? {
          id: 'ai-ahead-of-foundations',
          title: 'AI / use ambition ahead of the data foundations',
          severity: 'high',
          explanation:
            'You are chasing use-cases and AI value while data quality is weak. Models and analytics built on poor data foundations mislead — and erode trust when they fail.',
          resolution:
            'Rebalance toward foundations: lift data quality and interoperability so the use-cases stand on solid ground.',
          triggers: ['ambition = AI / use first', 'quality capability < 0.5'],
        }
      : null,
  // Standardising faster than capacity.
  (c) =>
    p(c.state, 'standards-pace') < -0.4 && (c.cap.skills ?? 0) < 0.45
      ? {
          id: 'standards-without-capacity',
          title: 'Standardising faster than the capacity to deliver',
          severity: 'medium',
          explanation:
            'A standardise-now posture demands real delivery capacity (a data profession, stewards, change effort). With skills under-resourced, standards become shelfware.',
          resolution: 'Increase the skills & capacity allocation, or sequence the standards work more gradually.',
          triggers: ['standards-pace = Standardise now', 'skills capability < 0.45'],
        }
      : null,
  // Buying capability while internal skills wither.
  (c) =>
    p(c.state, 'build-buy') > 0.5 && (c.cap.skills ?? 0) < 0.45
      ? {
          id: 'buy-erodes-skills',
          title: 'Buying capability while internal skills wither',
          severity: 'low',
          explanation:
            'A strong buy/SaaS posture with little investment in internal skills risks vendor lock-in and a hollowed-out data profession that cannot hold suppliers to account.',
          resolution: 'Keep enough internal capability to specify, integrate and govern what you buy.',
          triggers: ['build-buy = Buy / SaaS', 'skills capability < 0.45'],
        }
      : null,
  // Maturity ambition not funded.
  (c) => {
    let gap = 0;
    let n = 0;
    for (const d of MATURITY_DIMENSIONS) {
      gap += (c.state.maturityTarget[d.id] ?? 4) - (c.state.maturityCurrent[d.id] ?? 2);
      n++;
    }
    const avgGap = n ? gap / n : 0;
    return avgGap > 1.6 && c.overallCoverage < 0.55
      ? {
          id: 'unfunded-ambition',
          title: 'Maturity ambition is not funded',
          severity: 'medium',
          explanation:
            'The maturity targets imply a big jump, but the overall capability strength is modest. Strategy as wish-list: targets without the investment to reach them.',
          resolution: 'Either raise the allocation behind the driving capabilities, or set more realistic interim maturity targets.',
          triggers: ['avg maturity gap > 1.6', 'overall coverage < 55%'],
        }
      : null;
  },
  // Spread too thin.
  (c) => {
    const shares = allocShares(c.state);
    const vals = CAPABILITY_IDS.map((id) => shares[id]);
    const spread = Math.max(...vals) - Math.min(...vals);
    return spread < 0.04 && c.overallCoverage < 0.6
      ? {
          id: 'spread-too-thin',
          title: 'Spread too thin to move anything',
          severity: 'low',
          explanation:
            'Effort is split almost perfectly evenly, yet coverage is mediocre. A strategy that funds everything a little often delivers nothing decisively.',
          resolution: 'Concentrate on the capabilities the highest-severity pressures actually demand.',
          triggers: ['near-even allocation', 'overall coverage < 60%'],
        }
      : null;
  },
];

export function runAlignment(state: StrategyState): AlignmentResult {
  const { capability, base, mult } = capabilities(state);

  // pressure coverage
  const coverage: Record<string, number> = {};
  const coverageTrace: Record<string, CoverageTraceTerm[]> = {};
  let sw = 0;
  let swCov = 0;
  const originSums: Record<Origin, { w: number; wc: number }> = {
    'cross-government': { w: 0, wc: 0 },
    'dfe-policy': { w: 0, wc: 0 },
    partners: { w: 0, wc: 0 },
  };
  for (const pr of PRESSURES) {
    const { value, trace } = coverageFor(capability, pr.demands);
    coverage[pr.id] = value;
    coverageTrace[pr.id] = trace;
    sw += pr.severity;
    swCov += pr.severity * value;
    originSums[pr.origin].w += pr.severity;
    originSums[pr.origin].wc += pr.severity * value;
  }
  const overallCoverage = sw > 0 ? swCov / sw : 0;
  const coverageByOrigin = {
    'cross-government':
      originSums['cross-government'].w > 0
        ? originSums['cross-government'].wc / originSums['cross-government'].w
        : 0,
    'dfe-policy':
      originSums['dfe-policy'].w > 0 ? originSums['dfe-policy'].wc / originSums['dfe-policy'].w : 0,
    partners: originSums.partners.w > 0 ? originSums.partners.wc / originSums.partners.w : 0,
  } as Record<Origin, number>;

  // maturity progress + projected level
  const maturityProgress: Record<string, number> = {};
  const maturityProjected: Record<string, number> = {};
  for (const d of MATURITY_DIMENSIONS) {
    const areas = d.areas.length ? d.areas : CAPABILITY_IDS;
    const progress = clamp(areas.reduce((s, a) => s + (capability[a] ?? 0), 0) / areas.length);
    const current = state.maturityCurrent[d.id] ?? 2;
    const target = state.maturityTarget[d.id] ?? 4;
    const gap = target - current;
    let eff = progress;
    if (gap > 0) {
      const penalty = PARAMS.MATURITY_GAP_PENALTY * Math.max(0, gap / 4 - progress);
      eff = clamp(progress - penalty);
    }
    maturityProgress[d.id] = progress;
    maturityProjected[d.id] = clamp(current + gap * eff, 1, 5);
  }

  // tensions
  const ctx: Ctx = { state, cap: capability, coverage, coverageByOrigin, overallCoverage };
  const tensions: Tension[] = TENSION_RULES.map((r) => r(ctx)).filter((t): t is Tension => !!t);

  // legal implications from the chosen posture
  const legal = new Set<string>();
  const sharingLean =
    p(state, 'delivery') > 0.2 || p(state, 'operating-model') > 0.2 || (capability.sharing ?? 0) > 0.5;
  if (sharingLean) {
    legal.add('dea-2017');
    legal.add('uk-gdpr');
    legal.add('dpa-2018');
    legal.add('common-law-confidentiality');
  }
  if (p(state, 'openness') < -0.2) {
    legal.add('foi-2000');
    legal.add('eir-2004');
  }
  legal.add('duaa-2025'); // the reform backdrop always applies
  if (legal.size <= 1) legal.add('uk-gdpr');

  // recommended focus
  const pressureFocus: FocusItem[] = PRESSURES.map((pr) => ({
    kind: 'pressure' as const,
    id: pr.id,
    title: pr.title,
    reason: `Severity ${pr.severity}/5, only ${Math.round((coverage[pr.id] ?? 0) * 100)}% covered`,
    score: pr.severity * (1 - (coverage[pr.id] ?? 0)),
  }));
  const maturityFocus: FocusItem[] = MATURITY_DIMENSIONS.map((d) => {
    const gap = (state.maturityTarget[d.id] ?? 4) - (state.maturityCurrent[d.id] ?? 2);
    const prog = maturityProgress[d.id] ?? 0;
    return {
      kind: 'maturity' as const,
      id: d.id,
      title: d.name,
      reason: `Target +${gap.toFixed(0)} levels, progress ${Math.round(prog * 100)}%`,
      score: Math.max(0, gap) * (1 - prog) * 1.1,
    };
  });
  const focus = [...pressureFocus, ...maturityFocus]
    .sort((a, b) => b.score - a.score)
    .slice(0, PARAMS.FOCUS_TOP_N + 2);

  return {
    capability,
    capabilityBase: base,
    capabilityMult: mult,
    coverage,
    coverageTrace,
    overallCoverage,
    coverageByOrigin,
    maturityProgress,
    maturityProjected,
    tensions,
    legalImplicated: [...legal],
    focus,
  };
}
