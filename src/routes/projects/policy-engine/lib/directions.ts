// directions.ts — the "what should change" layer. Where evidence.ts holds NEUTRAL findings,
// this holds report-attributed DIRECTIONS and RECOMMENDATIONS: what a report says must change,
// what effect it expects, and which engine levers/themes/outcomes it bears on. Milburn's interim
// report is DIAGNOSTIC (it makes no recommendations until autumn 2026), so its entries are tagged
// 'diagnosis-direction' / status 'diagnosis' and paired with the recommending companions already
// in the corpus. Self-contained.

import type { Lean } from './evidence';
import type { LeverState } from '$lib/policy-engine/types';
import { LEVERS_BY_ID } from '$lib/policy-engine/levers';

export type DirKind = 'diagnosis-direction' | 'recommendation';
export type DirStatus = 'diagnosis' | 'recommended' | 'announced';

export const DIR_STATUS_META: Record<DirStatus, { label: string; eli5: string; colour: string }> = {
  diagnosis:   { label: 'Diagnosis points here', eli5: 'What the problem suggests', colour: '#4b5a8a' },
  recommended: { label: 'Recommended', eli5: 'Someone has proposed it', colour: '#b4632e' },
  announced:   { label: 'Announced / funded', eli5: 'Already government policy', colour: '#2f7d4f' },
};

export interface Direction {
  id: string;
  report: string;
  reportFull?: string;
  kind: DirKind;
  status: DirStatus;
  lean: Lean;
  title: string;
  whatChanges: { research: string; eli5: string };
  expectedEffect: { research: string; eli5: string };
  provenance: string;
  levers: string[];
  leverTargets?: Partial<Record<string, number>>;
  themes?: string[];
  outcomes?: string[];
  companions?: string[]; // evidence.ts analysis ids that recommend the same direction
  strength: 'strong' | 'moderate' | 'contested' | 'illustrative';
  url?: string;
}

const MILBURN_PROVENANCE =
  'Milburn\'s interim report is explicitly diagnostic ("the fork in the road") and makes no formal recommendations — those follow in the "solutions" phase, autumn 2026. This is the direction the diagnosis points toward, stated as an attributed ask, not a recommendation.';

export const DIRECTIONS: Direction[] = [
  // ---- Milburn's five system failures, as diagnosis-directions ----
  {
    id: 'milburn-youth-economy',
    report: 'Milburn review', reportFull: 'Milburn review (DWP) — Young People and Work (interim)',
    kind: 'diagnosis-direction', status: 'diagnosis', lean: 'official',
    title: 'Rebuild the youth labour market: restore the entry-level rungs',
    whatChanges: {
      research: 'The youth share of employment has fallen and entry-level roles have become fewer and more automated; the diagnosis points to demand-side action — entry-level routes, work experience, the "Saturday job" ladder and employer incentives — alongside apprenticeship recovery.',
      eli5: 'There are simply fewer first jobs for young people, and getting one now means passing portals and automated tests instead of meeting a manager. The fix points at making more genuine entry-level openings and work experience.',
    },
    expectedEffect: {
      research: 'Acts on the unemployed-active NEET segment (and lightly the discouraged "other" segment); no effect on the health segment. Low evidence security (YFF rates wage subsidies / work experience low average impact), so the modelled band is wide.',
      eli5: 'Mostly helps young people who are looking for work; it does not help those who are NEET because they are unwell.',
    },
    provenance: MILBURN_PROVENANCE,
    levers: ['entry_level', 'apprenticeships'],
    leverTargets: { entry_level: 70, apprenticeships: 75 },
    themes: ['participation-by-design'], outcomes: ['neetUnemployed', 'neet'],
    companions: ['onward-course-correction', 'suttontrust-apprentice', 'ifs-growth-skills'],
    strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
  },
  {
    id: 'milburn-health-participation',
    report: 'Milburn review', reportFull: 'Milburn review (DWP) — Young People and Work (interim)',
    kind: 'diagnosis-direction', status: 'diagnosis', lean: 'official',
    title: 'Reconfigure youth health support for participation, not just treatment',
    whatChanges: {
      research: 'Health services are "configured for treatment, not participation"; with health-related inactivity now the sticky, fastest-growing driver, the diagnosis points to mental-health and CAMHS capacity built around getting young people back to work or learning.',
      eli5: 'Health care for young people is set up to treat illness, not to help them back into work or study. The fix points at mental-health support that does both.',
    },
    expectedEffect: {
      research: 'Acts on the inactive-health segment — the one segment work-first schemes do not reach. Slow-acting: the stock is sticky (~8 in 10 still NEET 2+ years on).',
      eli5: 'Targets the group that job schemes miss — but slowly, because this group is the hardest to move.',
    },
    provenance: MILBURN_PROVENANCE,
    levers: ['mental_health', 'camhs'],
    leverTargets: { mental_health: 80, camhs: 75 },
    themes: ['early-identification', 'participation-by-design'], outcomes: ['neetInactiveHealth'],
    companions: ['resolution-neet', 'resolution-neet-europe'],
    strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
  },
  {
    id: 'milburn-skills-foundation',
    report: 'Milburn review', reportFull: 'Milburn review (DWP) — Young People and Work (interim)',
    kind: 'diagnosis-direction', status: 'diagnosis', lean: 'official',
    title: 'Repair the education-and-skills foundation through the post-16 transition',
    whatChanges: {
      research: 'Education and skills are "the faltering foundation"; the diagnosis points to stronger post-16 study programmes, careers guidance and disadvantage funding that does not stop dead at 16.',
      eli5: 'School and college do not set enough young people up for work, and support stops at 16 just as the risk peaks. The fix points at better post-16 courses, careers help and money that follows poorer students past 16.',
    },
    expectedEffect: {
      research: 'Acts on NEET inflow at the post-16 boundary across segments (qualifications move employability most). Correlational evidence (Gatsby) and an untested proposal (EPI 16–19 premium), so bands are wide.',
      eli5: 'Reduces how many young people fall out after 16, but the evidence is indirect.',
    },
    provenance: MILBURN_PROVENANCE,
    levers: ['post16_skills', 'post16_premium', 'careers_gatsby'],
    leverTargets: { post16_skills: 80, post16_premium: 600, careers_gatsby: 75 },
    themes: ['early-identification', 'participation-by-design'], outcomes: ['neet'],
    companions: ['epi-neet', 'smf-skills', 'cep-vocational'],
    strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
  },
  {
    id: 'milburn-welfare-participation',
    report: 'Milburn review', reportFull: 'Milburn review (DWP) — Young People and Work (interim)',
    kind: 'diagnosis-direction', status: 'diagnosis', lean: 'official',
    title: 'Redesign the welfare offer around participation',
    whatChanges: {
      research: 'The welfare state is "not designed for participation" and spends ~£25 on benefits for every £1 on youth employment support; the diagnosis points to a keyworker-led, employer-proximate guarantee that re-engages young people rather than parking them on benefits.',
      eli5: 'The benefits system spends far more keeping young people on benefits than helping them into work. The fix points at a guarantee of training or a job, with a real person to help.',
    },
    expectedEffect: {
      research: 'Acts on the unemployed-active segment twice: cuts inflow AND re-engages the existing stock (the Youth Contract keyworker analogue ≈ +1.8pp). No effect on the health segment.',
      eli5: 'Helps young people looking for work both by reducing how many become NEET and by getting those already stuck back into work.',
    },
    provenance: MILBURN_PROVENANCE,
    levers: ['youth_guarantee'],
    leverTargets: { youth_guarantee: 80 },
    themes: ['participation-by-design'], outcomes: ['neetUnemployed', 'neet'],
    companions: [],
    strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
  },
  {
    id: 'milburn-architecture',
    report: 'Milburn review', reportFull: 'Milburn review (DWP) — Young People and Work (interim)',
    kind: 'diagnosis-direction', status: 'diagnosis', lean: 'official',
    title: 'Make the architecture a system in design, not just in name',
    whatChanges: {
      research: '"A system in name, not in design": the join across DfE, DWP, NHS and employers is nobody\'s job, so no one can see the whole young person or the £1:£25 spend split. The diagnosis points to a cross-department participation view and spend-per-stage accounting — a stewardship ask, not a spend lever.',
      eli5: 'No single body joins up education, benefits, health and employers, so nobody sees the whole picture or where the money really goes. The fix is about joining the system up, not spending more.',
    },
    expectedEffect: {
      research: 'A data/coordination ask rather than a modelled lever — it makes the rest measurable and accountable. Surfaced through the Participation-by-design theme and the Monitoring data spine.',
      eli5: 'Doesn\'t directly change the numbers in the model — it\'s what would let anyone see whether the rest worked.',
    },
    provenance: MILBURN_PROVENANCE,
    levers: [],
    themes: ['participation-by-design'], outcomes: ['neet'],
    companions: ['ifg-data', 'adalovelace-data'],
    strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
  },

  // ---- Companion responses already in the policy debate (recommendation / announced) ----
  {
    id: 'youth-guarantee-policy',
    report: 'Youth Guarantee', reportFull: 'Get Britain Working / Youth Guarantee (Commons Library CBP-10827)',
    kind: 'recommendation', status: 'announced', lean: 'official',
    title: 'The Youth Guarantee & 18–24 Jobs Guarantee (funded response)',
    whatChanges: {
      research: 'A guaranteed offer of further learning, an apprenticeship or help into work for 18–21s, plus a paid 6-month Jobs Guarantee for young UC claimants — £820m over 2026/27–28/29.',
      eli5: 'The government\'s actual answer so far: a promise of training or a job for young people, with money behind it.',
    },
    expectedEffect: {
      research: 'The evaluated analogue (2012–14 Youth Contract) produced ≈ +1.8pp re-engagement; national-scale effects unproven. Maps to the youth_guarantee lever.',
      eli5: 'Past versions helped a bit; nobody knows yet how well this one will work at scale.',
    },
    provenance: 'A real, funded government programme — shown as the announced response that answers Milburn\'s welfare-participation diagnosis.',
    levers: ['youth_guarantee'], themes: ['participation-by-design'], outcomes: ['neetUnemployed', 'neet'],
    companions: [], strength: 'moderate',
    url: 'https://commonslibrary.parliament.uk/research-briefings/cbp-10827/',
  },
  {
    id: 'epi-16-19-premium',
    report: 'EPI', reportFull: 'Education Policy Institute — Five charts that explain the rise in NEET rates',
    kind: 'recommendation', status: 'recommended', lean: 'centre',
    title: 'A 16–19 disadvantage premium (EPI proposal)',
    whatChanges: {
      research: 'Disadvantage funding largely stops at 16 even though the NEET cliff is at 16–18; EPI proposes a Pupil-Premium-style premium following the student past 16 as the most direct funding response.',
      eli5: 'Extra money for poorer pupils stops at 16, right when the risk is highest. EPI says extend it.',
    },
    expectedEffect: {
      research: 'No causal estimate exists; modelled via post-16 retention (the post16_premium lever) with a wide band.',
      eli5: 'Could help keep poorer young people in education after 16, but it is untested.',
    },
    provenance: 'A concrete recommendation from a recommending companion — what Milburn\'s skills-foundation diagnosis points toward, costed.',
    levers: ['post16_premium'], leverTargets: { post16_premium: 600 },
    themes: ['equity-not-money', 'participation-by-design'], outcomes: ['neet'],
    companions: ['epi-neet'], strength: 'moderate',
    url: 'https://epi.org.uk/publications-and-research/five-charts-that-explain-the-rise-in-neet-rates/',
  },
];

export const DIRECTIONS_BY_ID: Record<string, Direction> = Object.fromEntries(DIRECTIONS.map((d) => [d.id, d]));

export function directionsForLever(id: string): Direction[] {
  return DIRECTIONS.filter((d) => d.levers.includes(id));
}
export function directionsForTheme(id: string): Direction[] {
  return DIRECTIONS.filter((d) => d.themes?.includes(id));
}
export function directionsForOutcome(id: string): Direction[] {
  return DIRECTIONS.filter((d) => d.outcomes?.includes(id));
}

/** Compose the Milburn-aligned "response package" lever state from the diagnosis-directions'
 *  leverTargets (single source of truth shared with the scenarios.ts preset). Targets are clamped
 *  to each lever's [min, max]; levers without a target keep their value from `base`. */
export function milburnPackageLevers(base: LeverState): LeverState {
  const out: LeverState = { ...base };
  for (const d of DIRECTIONS) {
    if (d.kind !== 'diagnosis-direction' || !d.leverTargets) continue;
    for (const [id, target] of Object.entries(d.leverTargets)) {
      const L = LEVERS_BY_ID[id];
      if (!L || target == null) continue;
      out[id] = Math.min(L.max, Math.max(L.min, target));
    }
  }
  return out;
}
