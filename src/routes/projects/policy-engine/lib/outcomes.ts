// outcomes.ts — display metadata for the outcomes the engine produces. Self-contained.

import type { YearResult } from '$lib/policy-engine/types';

export interface OutcomeMeta {
  id: keyof YearResult & string;
  label: string;
  short: string;
  unit: string;
  goodIfUp: boolean;
  neutral?: boolean;     // colour-neutral (e.g. prevalence, cost)
  dp: number;
  group: 'equity' | 'attainment' | 'send' | 'system' | 'money';
  blurb: string;
}

export const OUTCOMES: OutcomeMeta[] = [
  { id: 'gapKS4', label: 'Disadvantage gap at 16', short: 'KS4 gap', unit: 'months', goodIfUp: false, dp: 1, group: 'equity',
    blurb: 'EPI "months of learning" between disadvantaged pupils and their peers at GCSE — the headline equity metric.' },
  { id: 'gapKS2', label: 'Disadvantage gap at 11', short: 'KS2 gap', unit: 'months', goodIfUp: false, dp: 1, group: 'equity',
    blurb: 'The gap at the end of primary school.' },
  { id: 'gapAge3', label: 'Development gap at 3', short: 'Age-3 gap', unit: 'months', goodIfUp: false, dp: 1, group: 'equity',
    blurb: 'The earliest modelled gap. The disadvantage gap is observable from age 3, before any school measure — an estimate (no official months-at-3 series exists).' },
  { id: 'gapReception', label: 'Disadvantage gap at 5', short: 'Age-5 gap', unit: 'months', goodIfUp: false, dp: 1, group: 'equity',
    blurb: 'The gap already present at school entry — ~40% of the age-16 gap is set this early.' },
  { id: 'eyTakeUp', label: 'Early education — disadvantaged take-up', short: 'EY take-up', unit: '%', goodIfUp: true, dp: 0, group: 'attainment',
    blurb: 'Share of disadvantaged under-5s in funded early education — the equity entitlement, where take-up has historically lagged the universal offer.' },
  { id: 'attainment8', label: 'Attainment 8 (all pupils)', short: 'A8 all', unit: 'score', goodIfUp: true, dp: 1, group: 'attainment',
    blurb: 'National average Attainment 8. The White Paper targets 50 ("a grade 5 across GCSEs on average").' },
  { id: 'attainment8Dis', label: 'Attainment 8 (disadvantaged)', short: 'A8 disadv.', unit: 'score', goodIfUp: true, dp: 1, group: 'attainment',
    blurb: 'Attainment 8 for disadvantaged pupils.' },
  { id: 'grade5EM', label: 'Grade 5+ English & Maths', short: 'Grade 5+ E&M', unit: '%', goodIfUp: true, dp: 1, group: 'attainment',
    blurb: 'Share achieving a strong pass in both GCSE English and maths.' },
  { id: 'ks2RWM', label: 'KS2 reading+writing+maths', short: 'KS2 RWM', unit: '%', goodIfUp: true, dp: 1, group: 'attainment',
    blurb: 'Share reaching the expected standard at the end of primary in all three.' },
  { id: 'gld', label: 'Good Level of Development (age 5)', short: 'GLD', unit: '%', goodIfUp: true, dp: 1, group: 'attainment',
    blurb: 'School-readiness at age 5. Best Start targets 75% by 2028.' },
  { id: 'ehcpPct', label: 'EHCP prevalence', short: 'EHCP %', unit: '% of pupils', goodIfUp: false, neutral: true, dp: 2, group: 'send',
    blurb: 'Share of pupils with an Education, Health and Care Plan. Rising prevalence is contested — more support, but unsustainable cost.' },
  { id: 'highNeedsDeficitStock', label: 'High-needs (DSG) deficit', short: 'SEND deficit', unit: '£bn', goodIfUp: false, dp: 1, group: 'send',
    blurb: 'Cumulative high-needs funding deficit. The statutory override ends March 2028 — councils face insolvency if it is still on the books.' },
  { id: 'ehcpAttainment8', label: 'SEND (EHCP) Attainment 8', short: 'EHCP A8', unit: 'score', goodIfUp: true, dp: 1, group: 'send',
    blurb: 'Attainment of pupils with an EHCP — falls if plans are narrowed without matching mainstream investment.' },
  { id: 'tribunalAppeals', label: 'SEND tribunal appeals', short: 'Tribunals', unit: 'k/yr', goodIfUp: false, dp: 1, group: 'send',
    blurb: 'SEND tribunal appeals per year (~99% find for parents) — a stress signal of the system.' },
  { id: 'persistentAbsence', label: 'Persistent absence (all)', short: 'PA all', unit: '%', goodIfUp: false, dp: 1, group: 'system',
    blurb: 'Share missing ≥10% of sessions.' },
  { id: 'persistentAbsenceDis', label: 'Persistent absence (disadvantaged)', short: 'PA disadv.', unit: '%', goodIfUp: false, dp: 1, group: 'system',
    blurb: 'Persistent absence among disadvantaged pupils — EPI blames the entire post-2019 gap-widening on this.' },
  { id: 'severeAbsence', label: 'Severe absence', short: 'Severe abs.', unit: '%', goodIfUp: false, dp: 2, group: 'system',
    blurb: 'Share missing ≥50% of sessions — a rising, sticky tail.' },
  { id: 'teacherShortfall', label: 'Teacher shortfall', short: 'Teachers', unit: 'k FTE', goodIfUp: false, dp: 1, group: 'system',
    blurb: 'Shortfall against the 6,500-teacher pledge. Negative = surplus.' },
  { id: 'childPoverty', label: 'Child poverty', short: 'Poverty', unit: '%', goodIfUp: false, dp: 1, group: 'system',
    blurb: 'Children in relative poverty (after housing costs).' },
  { id: 'neet', label: 'NEET (16–24)', short: 'NEET', unit: '%', goodIfUp: false, dp: 1, group: 'system',
    blurb: 'Not in education, employment or training — the sum of three modelled segments with very different dynamics.' },
  { id: 'neetUnemployed', label: 'NEET — unemployed', short: 'NEET (U)', unit: '%', goodIfUp: false, dp: 1, group: 'system',
    blurb: 'Unemployed-active segment (~39% of the stock): cyclical; moved by the Youth Guarantee, apprenticeships and careers provision.' },
  { id: 'neetInactiveHealth', label: 'NEET — inactive (health)', short: 'NEET (IH)', unit: '%', goodIfUp: false, dp: 1, group: 'system',
    blurb: 'Health-driven inactive segment (~28% and rising): sticky — 8 in 10 still NEET 2+ years later; responds to mental-health and CAMHS capacity, not job schemes.' },
  { id: 'neetInactiveOther', label: 'NEET — inactive (other)', short: 'NEET (IO)', unit: '%', goodIfUp: false, dp: 1, group: 'system',
    blurb: 'Inactive for other reasons (~33%): caring, discouragement; slow-moving; responds to retention funding and care-experienced support.' },
  { id: 'neetLongTerm', label: 'NEET 12+ months (long-term)', short: 'NEET (LT)', unit: '%', goodIfUp: false, dp: 1, group: 'system',
    blurb: 'The persistence stock: of last year’s NEETs, those still NEET — ~60% of the stock at baseline. Re-engagement levers (Youth Guarantee keyworkers, MH support) act on this directly, not just on inflow.' },
  { id: 'fundingPerPupil', label: 'Funding per pupil', short: '£/pupil', unit: '£', goodIfUp: true, neutral: true, dp: 0, group: 'money',
    blurb: 'Real-terms mainstream funding per pupil (2025 prices).' },
  { id: 'cumulativeCost', label: 'Cumulative programme cost', short: 'Cost', unit: '£bn', goodIfUp: false, neutral: true, dp: 1, group: 'money',
    blurb: 'Cumulative additional cost of your policy package vs the status-quo baseline.' },
];

export const OUTCOMES_BY_ID: Record<string, OutcomeMeta> = Object.fromEntries(OUTCOMES.map((o) => [o.id, o]));

/** Plain-English ("ELI5") short LABELS for the scorecard / readout cards. */
export const OUTCOME_ELI5_LABEL: Record<string, string> = {
  gapKS4: 'Rich–poor gap at 16', gapKS2: 'Rich–poor gap at 11', gapReception: 'Rich–poor gap at 5', gapAge3: 'Rich–poor gap at 3',
  eyTakeUp: 'Poorer toddlers in nursery',
  attainment8: 'Average GCSE score', attainment8Dis: 'Poorer pupils’ GCSE score', grade5EM: 'Good pass, English & maths',
  ks2RWM: 'On track at primary', gld: 'Ready for school at 5', ehcpPct: 'On a special-needs plan',
  highNeedsDeficitStock: 'Special-needs debt', ehcpAttainment8: 'Special-needs GCSE score', tribunalAppeals: 'Special-needs appeals',
  persistentAbsence: 'Missing school', persistentAbsenceDis: 'Poorer kids missing school', severeAbsence: 'Missing half of school',
  teacherShortfall: 'Teachers short', childPoverty: 'Children in poverty', neet: 'Not working or studying',
  neetUnemployed: 'Looking for work, can’t find it', neetInactiveHealth: 'Too unwell to work or study', neetInactiveOther: 'Out for other reasons (caring etc.)',
  neetLongTerm: 'Stuck for over a year',
  fundingPerPupil: 'Spend per pupil', cumulativeCost: 'Extra spending',
};

/** Plain-English ("ELI5") one-liners for the hover tooltips on the scorecard / readout. */
export const OUTCOME_ELI5: Record<string, string> = {
  gapKS4: 'How far behind poorer 16-year-olds are, in months of learning. Lower is better.',
  gapKS2: 'How far behind poorer pupils are at the end of primary, in months. Lower is better.',
  gapAge3: 'How far behind poorer three-year-olds already are, in months — before school even starts. An estimate. Lower is better.',
  gapReception: 'The gap that is already there at age 5, in months. Lower is better.',
  eyTakeUp: 'The share of poorer under-5s actually in funded nursery/early education. Higher is better.',
  attainment8: 'The average GCSE results score. Higher is better.',
  attainment8Dis: 'The average GCSE score for poorer pupils. Higher is better.',
  grade5EM: 'The share who get a strong pass in both English and maths GCSE. Higher is better.',
  ks2RWM: 'The share hitting the expected standard at the end of primary. Higher is better.',
  gld: 'The share of five-year-olds who are “ready” for school. Higher is better.',
  ehcpPct: 'The share of pupils with a legal special-needs plan (EHCP). More isn’t simply good or bad — more support, but more cost.',
  highNeedsDeficitStock: 'The debt councils run up paying for special-needs support. Lower is better.',
  ehcpAttainment8: 'GCSE results for pupils with a special-needs plan. Higher is better.',
  tribunalAppeals: 'How many families have to appeal special-needs decisions each year. Lower is better.',
  persistentAbsence: 'The share of all pupils missing a lot of school. Lower is better.',
  persistentAbsenceDis: 'The share of poorer pupils missing a lot of school — the gap’s main engine. Lower is better.',
  severeAbsence: 'The share missing half or more of school. Lower is better.',
  teacherShortfall: 'How many teachers short of the pledge the country is. Lower (or a surplus) is better.',
  childPoverty: 'The share of children growing up in poverty. Lower is better.',
  neet: 'The share of young adults with no job, education or training. Lower is better.',
  neetUnemployed: 'Young adults with no job who ARE looking. Job schemes and apprenticeships help here. Lower is better.',
  neetInactiveHealth: 'Young adults out of work and study because they’re unwell — the fastest-growing group. Health support helps; job fairs don’t. Lower is better.',
  neetInactiveOther: 'Young adults out for other reasons, like caring for someone. Lower is better.',
  neetLongTerm: 'Young adults who’ve been out of work and study for more than a year — the hardest group to bring back. Lower is better.',
  fundingPerPupil: 'The real-terms money spent per pupil. Higher is generally better.',
  cumulativeCost: 'The total extra money this plan spends compared with doing nothing.',
};

/** Headline KPIs shown on the scorecard. */
export const SCORECARD_IDS = [
  'gapKS4', 'attainment8', 'grade5EM', 'gld',
  'persistentAbsenceDis', 'neet', 'childPoverty', 'teacherShortfall',
  'ehcpPct', 'highNeedsDeficitStock', 'ehcpAttainment8', 'cumulativeCost',
];
