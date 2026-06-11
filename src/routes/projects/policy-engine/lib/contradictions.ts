// contradictions.ts — genuine, well-evidenced DISAGREEMENTS in the education-policy
// evidence base. The interactive's honesty layer: rather than presenting one reading as
// settled, each entry lays out two camps, states what the engine has to ASSUME to proceed,
// and what study or data WOULD resolve it — plus a confidence rating on the model's current
// stance. Neutral throughout: the camps are described, not adjudicated by the author.
// Self-contained.

import type { ConfidenceLevel } from './types';

export interface Camp {
  label: string;        // short name for the position
  who: string[];        // named proponents / bodies
  claim: string;        // the position, stated neutrally
  evidence: string;     // the strongest evidence for it
}

export interface Contradiction {
  id: string;
  question: string;       // the unresolved question (the h-line)
  short: string;          // chip label
  campA: Camp;
  campB: Camp;
  engineAssumes: string;  // the modelling choice the engine makes to proceed
  whatWouldResolve: string; // the study/data that would adjudicate
  confidence: ConfidenceLevel; // confidence in the engine's current stance
  themes?: string[];
  levers?: string[];
  outcomes?: string[];
}

export const CONTRADICTIONS: Contradiction[] = [
  {
    id: 'funding-attainment',
    question: 'Does extra school funding raise attainment?',
    short: 'Money → outcomes',
    campA: {
      label: 'Weak / unreliable link',
      who: ['Hanushek', 'parts of the IFS literature'],
      claim: 'At current spending levels the marginal £ has little reliable effect on measured attainment; how money is used matters more than how much.',
      evidence: 'Cross-study reviews find inconsistent expenditure–achievement relationships; England’s gap barely moved through a decade of Pupil Premium spending.',
    },
    campB: {
      label: 'Money matters when targeted',
      who: ['Jackson, Johnson & Persico', 'Lafortune, Rothstein & Schanzenbach'],
      claim: 'Quasi-experimental school-finance reforms that raised per-pupil spending improved attainment and adult outcomes, especially for low-income pupils.',
      evidence: 'US finance-reform natural experiments show positive, lasting effects concentrated among disadvantaged pupils.',
    },
    engineAssumes: 'The model takes the cautious reading: money acts THROUGH teacher capacity (recruitment, retention, TAs) rather than via a direct £→attainment elasticity, which is set near zero.',
    whatWouldResolve: 'An England-specific quasi-experimental estimate of marginal per-pupil funding on attainment, isolating the spend channel from teacher-supply effects.',
    confidence: 'contested',
    themes: ['equity-not-money'], levers: ['school_funding', 'teachers'], outcomes: ['attainment8', 'gapKS4'],
  },
  {
    id: 'send-cost-driver',
    question: 'What is driving SEND cost growth?',
    short: 'SEND cost driver',
    campA: {
      label: 'Incentives / system design',
      who: ['Isos Partnership', 'County Councils Network', 'NAO'],
      claim: 'Cost growth is driven by lost confidence in mainstream provision and an incentive structure that routes families toward statutory EHC plans — a design problem.',
      evidence: 'EHCP prevalence and tribunal volumes rose faster than measured need; ~58% real-terms spend growth did not move outcomes (NAO).',
    },
    campB: {
      label: 'Genuine rising need + underfunding',
      who: ['parts of the IFS analysis', 'sector bodies'],
      claim: 'Underlying need (notably autism and SEMH) has genuinely risen and high-needs funding has not kept pace, so the deficit reflects demand, not just incentives.',
      evidence: 'Identified prevalence and CAMHS waiting lists rose sharply; per-place real funding has been squeezed.',
    },
    engineAssumes: 'EHCP prevalence grows logistically (a demand process), partly mitigated by inclusion investment and diverted by reform from 2030 — blending both readings, with the split treated as an assumption.',
    whatWouldResolve: 'Child-level data on need, provision delivered and outcomes by placement (ECHILD-grade) to separate genuine need from incentive-driven demand.',
    confidence: 'contested',
    themes: ['data-gap', 'early-identification'], levers: ['ehcp_reform', 'inclusion_fund', 'high_needs'], outcomes: ['ehcpPct', 'highNeedsDeficitStock'],
  },
  {
    id: 'pupil-premium',
    question: 'Has the Pupil Premium narrowed the gap?',
    short: 'Pupil Premium',
    campA: {
      label: 'Limited measured effect',
      who: ['Gorard'],
      claim: 'The disadvantage gap barely narrowed across the Pupil Premium era, so a reliable £-per-pupil → gap effect is not evident in the national trend.',
      evidence: 'Gap trends are roughly flat-to-widening over the period despite sustained Pupil Premium spending.',
    },
    campB: {
      label: 'Depends on spending quality',
      who: ['EEF', 'DfE'],
      claim: 'Outcomes depend on how schools spend it; well-evidenced uses (tutoring, oral language) work, so the premium is a delivery question, not a failed instrument.',
      evidence: 'EEF trials show positive effects for specific funded approaches even where the aggregate gap is flat.',
    },
    engineAssumes: 'Pupil Premium is modelled as a weak, quality-moderated offset with wide uncertainty — large spend moves the gap only a little.',
    whatWouldResolve: 'School-level variation studies linking Pupil Premium spending patterns to gap outcomes with credible identification.',
    confidence: 'contested',
    themes: ['equity-not-money', 'measurement-validity'], levers: ['pupil_premium'], outcomes: ['gapKS4'],
  },
  {
    id: 'london-effect',
    question: 'What explains the “London effect”?',
    short: 'London effect',
    campA: {
      label: 'Pupil composition / aspiration',
      who: ['Burgess'],
      claim: 'London’s advantage is substantially explained by its pupil mix — a higher share of ethnic groups with strong educational aspiration.',
      evidence: 'Controlling for ethnic composition absorbs much of London’s secondary-phase advantage.',
    },
    campB: {
      label: 'Primary-era improvement / policy',
      who: ['FFT Education Datalab', 'London Challenge analyses'],
      claim: 'Much of the secondary advantage traces to earlier primary-phase improvement and prior attainment, leaving room for policy effects.',
      evidence: 'London’s primary results improved ahead of the secondary gains, qualifying composition-only accounts.',
    },
    engineAssumes: 'Place effects are modelled as a small, slow regional residual (cold-spot/composition-agnostic), not a large transferable “London” policy effect.',
    whatWouldResolve: 'Decomposition tracking the same pupils across the primary-to-secondary transition with consistent disadvantage definitions.',
    confidence: 'contested',
    themes: ['equity-not-money', 'measurement-validity'], levers: ['place_investment'], outcomes: ['gapKS4'],
  },
  {
    id: 'attendance-enforcement',
    question: 'Do enforcement and fines improve attendance?',
    short: 'Attendance enforcement',
    campA: {
      label: 'Deterrence / supply-side',
      who: ['parts of DfE policy'],
      claim: 'Penalty notices and clearer rules raise attendance by changing parental behaviour at the margin.',
      evidence: 'Fines are widely used; some local rises in attendance coincide with enforcement.',
    },
    campB: {
      label: 'Demand-side / EBSA',
      who: ['mental-health and EBSA researchers'],
      claim: 'Much severe absence is emotionally-based school avoidance and unmet mental-health need; enforcement treats a trust/health problem as a rule-breaking one.',
      evidence: 'Severe absence correlates with SEMH need and CAMHS waits; ~half a million fines a year run without a robust causal evaluation.',
    },
    engineAssumes: 'Attendance support (mentors) cuts disadvantaged persistent absence; fines are not modelled as an effective lever in their own right (unevaluated).',
    whatWouldResolve: 'A causal evaluation of the fines framework and the daily-data nudges, exploiting the natural experiments already in the data.',
    confidence: 'low',
    themes: ['early-identification', 'measurement-validity'], levers: ['attendance', 'mental_health'], outcomes: ['persistentAbsenceDis', 'severeAbsence'],
  },
  {
    id: 'pisa-reliability',
    question: 'How much should international rankings (PISA) be trusted?',
    short: 'PISA reliability',
    campA: {
      label: 'Broadly informative',
      who: ['OECD'],
      claim: 'PISA provides a consistent, comparable signal of system performance and equity across countries and cycles.',
      evidence: 'Standardised sampling and scaling; correlations with other measures.',
    },
    campB: {
      label: 'Caveated comparison',
      who: ['methodological critics'],
      claim: 'Sampling, pupil exclusions and test-taking motivation vary across countries and cycles, so small rank differences are not reliable.',
      evidence: 'Documented variation in exclusion rates and response behaviour; volatility in some countries’ trends.',
    },
    engineAssumes: 'International comparison is used directionally (money-vs-outcomes, equity gradients), not to support fine rank claims; flagged where trends are not significant.',
    whatWouldResolve: 'Cross-validation of PISA against domestic assessments and stable, exclusion-adjusted trend series.',
    confidence: 'medium',
    themes: ['measurement-validity'], levers: [], outcomes: ['attainment8', 'gapKS4'],
  },
  {
    id: 'thirty-hours-gap',
    question: 'Does the 30-hours childcare expansion narrow the early gap?',
    short: '30-hours & equity',
    campA: {
      label: 'Gap-neutral or widening',
      who: ['Sutton Trust', 'IFS'],
      claim: 'Because eligibility requires working parents within an income band, few of the poorest children qualify for the largest entitlements, so it does little for the early gap.',
      evidence: 'A minority of bottom-third earners qualify for the full offer versus most higher earners.',
    },
    campB: {
      label: 'Some broad benefit',
      who: ['parts of DfE / sector'],
      claim: 'Wider access to funded hours raises overall participation and can benefit some disadvantaged children at the margin.',
      evidence: 'Participation in funded early education has risen with the expansion.',
    },
    engineAssumes: 'Access (ey_access) funds only the smaller “quantity” effect for disadvantaged take-up; the larger quality effects require the quality lever — so the expansion is treated as broadly gap-neutral.',
    whatWouldResolve: 'Take-up and outcome data for the disadvantaged 2-year-old offer linked to age-5 GLD by deprivation decile.',
    confidence: 'medium',
    themes: ['equity-not-money', 'early-identification'], levers: ['ey_access', 'ey_quality', 'eypp'], outcomes: ['gapReception', 'gapAge3', 'gld'],
  },
  {
    id: 'gap-metric',
    question: 'Which disadvantage-gap metric should we even use?',
    short: 'Gap metric',
    campA: {
      label: 'Ever-FSM (headline series)',
      who: ['DfE', 'EPI annual reports'],
      claim: 'The conventional ever-FSM-in-6-years gap (months of progress between disadvantaged and other pupils) is the consistent, published national series and is the right basis for tracking trends.',
      evidence: 'EPI reports the secondary gap at ~19.1 months in 2024 and the KS2 gap at ~10 months on this definition, giving a long, comparable run.',
    },
    campB: {
      label: 'Persistently-disadvantaged',
      who: ['Gorard (Durham)'],
      claim: 'Ever-FSM mixes briefly- and persistently-poor pupils and shifts with FSM churn, so it can be “inadvertently unfair” and unreliable for attributing change; a persistently-disadvantaged measure tracks the real challenge better.',
      evidence: 'FSM eligibility churns year to year; ever-FSM and persistently-disadvantaged gap series diverge, and Gorard’s strongest, least-contested Pupil-Premium finding is about segregation, not the ever-FSM attainment gap.',
    },
    engineAssumes: 'Gap outcomes are reported on the familiar ever-FSM-style months-of-progress scale for comparability, while treating the level as metric-sensitive rather than a precise truth.',
    whatWouldResolve: 'Parallel published series on both definitions (ever-FSM and persistently-disadvantaged) over the same cohorts, so the divergence can be quantified rather than assumed.',
    confidence: 'medium',
    themes: ['measurement-validity', 'equity-not-money'], levers: ['pupil_premium'], outcomes: ['gapKS4', 'gapKS2', 'attainment8Dis'],
  },
  {
    id: 'funding-external-validity',
    question: 'Do the US school-finance results transfer to England?',
    short: 'US evidence → England',
    campA: {
      label: 'Transferable elasticities',
      who: ['Jackson, Johnson & Persico', 'Lafortune, Rothstein & Schanzenbach'],
      claim: 'Well-identified US finance-reform studies estimate a spending→attainment elasticity (roughly 0.1 SD ten years out for low-income districts) that is a reasonable prior for England absent local estimates.',
      evidence: 'Quasi-experimental US reforms show positive, lasting effects concentrated among disadvantaged pupils, with implied effects per $1,000 per pupil.',
    },
    campB: {
      label: 'Context-specific / not transferable',
      who: ['Hanushek', 'parts of the IFS literature'],
      claim: 'Effect estimates are large and heterogeneous and depend on institutional context and how money is spent; the English funding-and-accountability system differs enough that US elasticities may not carry over.',
      evidence: 'Dispersion in causal estimates is wide; England’s per-pupil spending returned to ~2010 levels while the gap showed little change — a correlational, confounded picture that does not validate the US elasticity locally.',
    },
    engineAssumes: 'No direct £→attainment elasticity is imported; funding acts through teacher capacity, and any spend channel is held near zero pending an English estimate — i.e. it does not assume US elasticities transfer.',
    whatWouldResolve: 'An England-specific quasi-experiment (e.g. NFF formula discontinuities, Pupil Premium thresholds, fair-funding redistributions) with long-run linked outcomes to estimate the local elasticity and its heterogeneity.',
    confidence: 'contested',
    themes: ['equity-not-money', 'measurement-validity'], levers: ['school_funding', 'teachers'], outcomes: ['attainment8', 'gapKS4'],
  },
  {
    id: 'neet-activation-health',
    question: 'Will work-first activation move the health-driven NEET segment?',
    short: 'Activation vs health-driven',
    campA: {
      label: 'Activation works',
      who: ['DWP (Youth Guarantee / Jobs Guarantee)', 'Get Britain Working'],
      claim: 'Most NEETs want to work (84% per Milburn); keyworker-led re-engagement, job-matching and a guaranteed offer move young people into work or training.',
      evidence: 'The 2012–14 Youth Contract keyworker model produced ≈ +1.8pp re-engagement; the Youth Guarantee funds £820m over 2026/27–28/29 plus an 18–24 Jobs Guarantee.',
    },
    campB: {
      label: 'Health-driven and sticky',
      who: ['Milburn review (DWP)', 'Resolution Foundation'],
      claim: 'Youth inactivity is increasingly driven by ill-health, not cyclical unemployment, so job-matching schemes do not reach the largest, growing segment — a vacancy does not fix a health condition.',
      evidence: 'Health-related NEET reasons rose ~70% in a decade; ~8 in 10 of those entering health-related inactivity are still NEET 2+ years later; mental health is the primary condition for >4 in 10 disabled NEETs.',
    },
    engineAssumes: 'The cautious reading: the Youth/Jobs Guarantee and entry-level levers act on the unemployed-active (and lightly the "other") segment but have NO effect on the health segment, which responds only to mental_health/CAMHS. So a work-first-only package leaves the fastest-growing segment largely untouched.',
    whatWouldResolve: 'A randomised or quasi-experimental evaluation of the Youth Guarantee that reports effects separately for the health-inactive segment, linked to administrative health and earnings outcomes.',
    confidence: 'contested',
    themes: ['early-identification', 'participation-by-design'],
    levers: ['youth_guarantee', 'mental_health', 'camhs', 'entry_level'],
    outcomes: ['neetInactiveHealth', 'neet'],
  },
];

export const CONTRADICTIONS_BY_ID: Record<string, Contradiction> = Object.fromEntries(CONTRADICTIONS.map((c) => [c.id, c]));

export function contradictionsForOutcome(id: string): Contradiction[] {
  return CONTRADICTIONS.filter((c) => c.outcomes?.includes(id));
}
export function contradictionsForLever(id: string): Contradiction[] {
  return CONTRADICTIONS.filter((c) => c.levers?.includes(id));
}
export function contradictionsForTheme(id: string): Contradiction[] {
  return CONTRADICTIONS.filter((c) => c.themes?.includes(id));
}
