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
import { CAPABILITY_IDS, CAPABILITY_BY_ID } from './capabilities';
import { POSTURE_AXES } from './postures';
import { PRESSURES, PRESSURES_BY_ID } from './pressures';
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
const ptitle = (id: string) => PRESSURES_BY_ID[id]?.title ?? id;
const capShort = (id: string) => CAPABILITY_BY_ID[id]?.short ?? id;
/** Severity-≥4 pressures (from `ids`) whose coverage is below `under`. */
function exposed(c: Ctx, ids: string[], under = 0.55): string[] {
  return ids.filter((id) => PRESSURES_BY_ID[id] && PRESSURES_BY_ID[id].severity >= 4 && (c.coverage[id] ?? 0) < under);
}

const TENSION_RULES: Array<(c: Ctx) => Tension | null> = [
  // 1. The operating model points two ways at once (posture vs posture).
  (c) =>
    p(c.state, 'operating-model') < -0.35 && p(c.state, 'delivery') > 0.35
      ? {
          id: 'incoherent-operating-model',
          title: 'Your operating model contradicts itself',
          severity: 'high',
          explanation:
            'You are centralising onto a single platform AND delegating delivery to partners at the same time. Centralising concentrates control; partner-led delivery disperses it — as set, the strategy reads as two strategies stapled together.',
          resolution:
            'Decide whether DfE owns the platform (centralise + deliver in-house) or convenes a federated system (federate + partner-led), then make the other levers serve that choice.',
          triggers: ['operating-model = Centralise', 'delivery = Partner-led'],
        }
      : null,

  // 2. Centralising against the real, federated estate (posture vs named pressures).
  (c) => {
    const hit = exposed(c, ['la-data-sharing', 'mat-fragmentation', 'agency-coordination']);
    return p(c.state, 'operating-model') < -0.4 && hit.length >= 2
      ? {
          id: 'centralise-vs-federation',
          title: 'Centralising collides with a federated estate',
          severity: 'high',
          explanation: `A single central model runs straight into ${hit.map(ptitle).join(' and ')}. DfE doesn’t own most of this data — 150+ local authorities and thousands of autonomous trusts do — so "centralise" without the partner-sharing to back it leaves these stranded.`,
          resolution: 'Either fund partner data-sharing & interoperability so centralisation is reachable, or move toward a federated, standards-led model.',
          triggers: ['operating-model = Centralise', ...hit.map((id) => `${ptitle(id)} under-covered`)],
        }
      : null;
  },

  // 3. Open-by-default vs the duty of confidence on children's/health data (posture vs law).
  (c) => {
    const conf = ['consistent-child-identifier', 'data-spine', 'health-social-care-link'].filter((id) => PRESSURES_BY_ID[id]);
    return p(c.state, 'openness') < -0.3 && conf.length
      ? {
          id: 'open-vs-confidentiality',
          title: 'Open-by-default runs into the duty of confidence',
          severity: 'high',
          explanation: `An open-by-default posture collides with ${conf.slice(0, 2).map(ptitle).join(' and ')}: children’s, safeguarding and health data carry a common-law duty of confidence that a UK GDPR lawful basis does not, by itself, satisfy — and the sector’s privacy voices treat over-sharing of children’s data as a red line.`,
          resolution: 'Default to secure-by-default for personal/safeguarding data and reserve "open" for non-personal reference data; pair any sharing with DPIAs and a named gateway.',
          triggers: ['openness = Open by default', 'children’s / health data in scope'],
          legalRefs: ['common-law-confidentiality', 'uk-gdpr', 'dpa-2018'],
        }
      : null;
  },

  // 4. Letting standards emerge defers exactly what the identifier needs up front.
  (c) =>
    p(c.state, 'standards-pace') > 0.4 && PRESSURES_BY_ID['consistent-child-identifier']
      ? {
          id: 'iterate-vs-identifier',
          title: 'Deferring the standards the identifier depends on',
          severity: 'high',
          explanation: `An "iterate / let standards emerge" posture defers the common identifiers and interoperability that ${ptitle('consistent-child-identifier')} (Children’s Wellbeing and Schools Act) needs UP FRONT — you can’t join a child’s records across services on standards you haven’t agreed yet.`,
          resolution: 'Standardise the identifier, key entities and sharing interfaces now, even if everything else iterates.',
          triggers: ['standards-pace = Iterate', 'consistent child identifier is a top pressure'],
          legalRefs: ['cwsa-2025'],
        }
      : null,

  // 5. AI-first while quality is weak or public trust exposed.
  (c) =>
    p(c.state, 'ambition') > 0.4 && ((c.cap.quality ?? 0) < 0.55 || (c.coverage['public-trust'] ?? 1) < 0.5)
      ? {
          id: 'ai-ahead-of-foundations',
          title: 'AI ambition ahead of the foundations',
          severity: 'high',
          explanation: `Chasing AI/use value while data quality is weak${(c.coverage['public-trust'] ?? 1) < 0.5 ? ` and ${ptitle('public-trust')} is under-covered` : ''} risks models built on poor data — and DfE has already been reprimanded by the ICO once over pupil data. AI on shaky foundations fails in public.`,
          resolution: 'Rebalance toward data quality, governance and ethics so the use-cases stand on solid, trusted ground.',
          triggers: ['ambition = AI / use first', 'quality weak or public trust exposed'],
        }
      : null,

  // 6. Scaling sharing ahead of the governance + gateway that make it lawful.
  (c) =>
    (c.cap.sharing ?? 0) > 0.55 && ((c.cap.governance ?? 0) < 0.5 || (c.cap.ethics ?? 0) < 0.5)
      ? {
          id: 'sharing-ahead-of-governance',
          title: 'Scaling data-sharing ahead of its governance',
          severity: 'medium',
          explanation:
            'Partner data-sharing is well-resourced but governance and/or ethics lag behind. Cross-organisation sharing without a named legal gateway (DEA 2017), DPIAs and clear accountability is exactly where data-sharing programmes are found unlawful.',
          resolution: 'Pair the sharing investment with governance & ethics: a statutory gateway, DPIAs, sharing agreements and a named SRO.',
          triggers: ['sharing capability high', 'governance / ethics low'],
          legalRefs: ['dea-2017', 'uk-gdpr', 'dpa-2018'],
        }
      : null,

  // 7. Federating without standards is just fragmentation.
  (c) =>
    p(c.state, 'operating-model') > 0.4 && (c.cap.interoperability ?? 0) < 0.5
      ? {
          id: 'federate-without-standards',
          title: 'Federation without standards is fragmentation',
          severity: 'medium',
          explanation: `Pushing ownership out to domains while interoperability & standards are under-funded doesn’t federate the estate — it fragments it. ${ptitle('mat-fragmentation')} gets worse, not better, when everyone keeps data to their own conventions.`,
          resolution: 'Federation only works on shared standards — fund interoperability (identifiers, APIs, reference data) before devolving ownership.',
          triggers: ['operating-model = Federate', 'interoperability capability < 0.5'],
        }
      : null,

  // 8. Buying capability while internal skills wither.
  (c) =>
    p(c.state, 'build-buy') > 0.5 && (c.cap.skills ?? 0) < 0.45
      ? {
          id: 'buy-erodes-skills',
          title: 'Buying capability while skills wither',
          severity: 'low',
          explanation:
            'A strong buy/SaaS posture with little investment in skills risks vendor lock-in and a data profession too thin to specify, integrate and hold suppliers to account — and EdTech/MIS suppliers already hold much of the sector’s data.',
          resolution: 'Keep enough internal capability to govern what you buy.',
          triggers: ['build-buy = Buy / SaaS', 'skills capability < 0.45'],
        }
      : null,

  // 9. Standardising faster than the capacity to deliver it.
  (c) =>
    p(c.state, 'standards-pace') < -0.4 && (c.cap.skills ?? 0) < 0.45
      ? {
          id: 'standards-without-capacity',
          title: 'Standardising faster than you can deliver',
          severity: 'medium',
          explanation:
            'A standardise-now posture demands real delivery capacity — a data profession, stewards, change effort. With skills under-resourced, the standards become shelfware nobody adopts.',
          resolution: 'Raise the skills allocation, or sequence the standards work to match the capacity you have.',
          triggers: ['standards-pace = Standardise now', 'skills capability < 0.45'],
        }
      : null,

  // 10. A top-severity (5/5) pressure left barely addressed.
  (c) => {
    const worst = PRESSURES.filter((pr) => pr.severity === 5)
      .map((pr) => ({ pr, cov: c.coverage[pr.id] ?? 0 }))
      .filter((x) => x.cov < 0.4)
      .sort((a, b) => a.cov - b.cov)[0];
    return worst
      ? {
          id: `neglected-${worst.pr.id}`,
          title: `A top pressure is barely addressed: ${worst.pr.title}`,
          severity: 'medium',
          explanation: `${worst.pr.title} is severity 5/5 but only ${Math.round(worst.cov * 100)}% covered — the current allocation starves the capabilities it needs (${worst.pr.demands.map(capShort).join(', ')}).`,
          resolution: `Shift effort toward ${worst.pr.demands.slice(0, 2).map(capShort).join(' and ')} to move this.`,
          triggers: [`${worst.pr.title} = severity 5`, `coverage ${Math.round(worst.cov * 100)}%`],
        }
      : null;
  },
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
