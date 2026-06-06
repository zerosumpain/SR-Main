// outcomes.ts — display metadata for the outcomes the engine produces. Self-contained.

import type { YearResult } from './types';

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
  { id: 'gapReception', label: 'Disadvantage gap at 5', short: 'Age-5 gap', unit: 'months', goodIfUp: false, dp: 1, group: 'equity',
    blurb: 'The gap already present at school entry — ~40% of the age-16 gap is set this early.' },
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
    blurb: 'Not in education, employment or training — increasingly driven by youth mental ill-health (Milburn 2026).' },
  { id: 'fundingPerPupil', label: 'Funding per pupil', short: '£/pupil', unit: '£', goodIfUp: true, neutral: true, dp: 0, group: 'money',
    blurb: 'Real-terms mainstream funding per pupil (2025 prices).' },
  { id: 'cumulativeCost', label: 'Cumulative programme cost', short: 'Cost', unit: '£bn', goodIfUp: false, neutral: true, dp: 1, group: 'money',
    blurb: 'Cumulative additional cost of your policy package vs the status-quo baseline.' },
];

export const OUTCOMES_BY_ID: Record<string, OutcomeMeta> = Object.fromEntries(OUTCOMES.map((o) => [o.id, o]));

/** Headline KPIs shown on the scorecard. */
export const SCORECARD_IDS = [
  'gapKS4', 'attainment8', 'grade5EM', 'gld',
  'persistentAbsenceDis', 'neet', 'childPoverty', 'teacherShortfall',
  'ehcpPct', 'highNeedsDeficitStock', 'ehcpAttainment8', 'cumulativeCost',
];
