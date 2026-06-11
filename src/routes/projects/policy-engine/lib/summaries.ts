// summaries.ts — generates a short, dynamic narrative for each outcome chart:
// what the metric does in the current scenario (to the selected horizon) and the
// research-grounded cause of its variability. Self-contained.

import type { YearResult } from './types';
import { OUTCOMES_BY_ID } from './outcomes';

// Why each outcome moves — the dominant levers / mechanism behind its variability.
const CAUSE: Record<string, string> = {
  gapKS4: 'Most of the variability comes from disadvantaged absence (the strongest-weighted lever in the model), then child poverty, pupil premium and early-years investment — the last of which only reaches GCSE with an ~11-year lag.',
  gapKS2: 'Driven by disadvantaged absence, the reading & oracy push and early-years carry-over.',
  attainment8: 'Moves with teacher capacity (the strongest evidenced channel) and attendance, with curriculum reform adding from 2028; £/pupil has little direct effect in the model — a deliberate, contested assumption (see Method).',
  grade5EM: 'Tracks Attainment 8 — it rises with teacher quality and attendance, and the disadvantaged line is held down by the gap.',
  ks2RWM: 'Sensitive to the reading & oracy push, teacher capacity and attendance; the 2028 curriculum refresh adds later.',
  gld: 'Almost entirely an early-years story: quality investment, disadvantaged access and the Early Years Pupil Premium move it within ~2 years.',
  ehcpPct: 'Climbs on its own demand momentum; inclusive-mainstream investment and early SEND slow it, and EHCP reform diverts plans to ISPs from 2030 — though the government’s 4.7% path is disputed by the IFS.',
  highNeedsDeficitStock: 'Rises sharply when high-needs funding lags EHCP demand; the March-2028 override expiry then draws down mainstream funding. Inclusion, EHCP reform and funding growth reduce it.',
  ehcpAttainment8: 'Improves with inclusion investment but falls if EHCP reform narrows plans without matching mainstream support — the double-edged reform.',
  persistentAbsence: 'Falls with attendance mentors and breakfast clubs and rises with child poverty; disadvantaged pupils are ~2.4× more likely to be persistently absent.',
  childPoverty: 'Driven by the child-poverty-action lever (two-child-limit removal, UC) and FSM expansion, against a rising baseline trend.',
  neet: 'Falls with attainment and the post-16/skills and youth-mental-health levers, but rises on an exogenous youth-ill-health trend — the Milburn "generational fault line".',
  teacherShortfall: 'Closes with recruitment, pay competitiveness and shortage-subject bursaries; negative means a surplus beyond the 6,500 pledge.',
  cumulativeCost: 'The running total of additional programme spend vs status quo — the sum of every active lever’s annual cost. Steeper lines mean a more expensive package; compare it against the gap and attainment charts for value.',
};

// ELI5 register: what each metric IS, and why it moves, in plain jargon-free English.
const ELI5_LEAD: Record<string, string> = {
  gapKS4: 'This is how far behind poorer pupils are by the time they sit their GCSEs, in months of learning.',
  gapKS2: 'How far behind poorer pupils are by the end of primary school.',
  attainment8: 'The average GCSE result score across the country.',
  grade5EM: 'The share of pupils who get a strong pass in both English and maths GCSE.',
  ks2RWM: 'The share of primary children hitting the expected standard in reading, writing and maths.',
  gld: 'The share of five-year-olds who are “ready” for school.',
  ehcpPct: 'The share of pupils with a legal special-needs plan (an EHCP).',
  highNeedsDeficitStock: 'The pile of debt councils run up paying for special-needs support.',
  ehcpAttainment8: 'How well pupils with a special-needs plan do at GCSE.',
  persistentAbsence: 'The share of pupils missing a lot of school.',
  childPoverty: 'The share of children growing up in poverty.',
  neet: 'The share of young adults not in any education, job or training.',
  teacherShortfall: 'How many teachers short of the pledge the country is.',
  cumulativeCost: 'The total extra money this plan spends compared with doing nothing.',
};
const ELI5_CAUSE: Record<string, string> = {
  gapKS4: 'It mostly comes down to poorer kids missing more school — so getting them to attend is the biggest lever. Early-years help matters even more but takes about eleven years to show up.',
  gapKS2: 'Driven by missed school, the reading push, and early-years help carrying over.',
  attainment8: 'Results rise when there are enough good teachers and kids show up — in the model, spending mainly helps when it pays for those teachers (a debated assumption you can change).',
  grade5EM: 'It follows the overall results, so it rises with teachers and attendance.',
  ks2RWM: 'Reading and phonics work and good teaching move it; the 2028 curriculum change adds later.',
  gld: 'It is almost entirely about early-years support before children even start school.',
  ehcpPct: 'It keeps climbing on its own; early help slows it, and the 2030 reforms divert some plans — though experts doubt the official target.',
  highNeedsDeficitStock: 'It rises sharply when special-needs costs outrun the budget; in 2028 a protection rule ends and the debt starts drawing down school budgets.',
  ehcpAttainment8: 'It improves with proper support, but falls if plans are cut without putting that support into mainstream schools.',
  persistentAbsence: 'Attendance mentors and breakfast clubs bring it down; poverty pushes it up.',
  childPoverty: 'It falls with anti-poverty action (like scrapping the two-child limit) and free school meals.',
  neet: 'It falls when more young people leave school qualified and get skills and mental-health support — but it is creeping up as youth mental health worsens.',
  teacherShortfall: 'It closes with recruitment, better pay, and funding for posts; below zero means a surplus.',
  cumulativeCost: 'Bigger packages cost more — and a few “growth-rate” levers (funding, pay) get more expensive every year they run.',
};

const row = (s: YearResult[], yr: number) => s.find((y) => y.year === yr) ?? s[s.length - 1];

export interface ChartSummary { text: string; eli5: string; tone: 'good' | 'bad' | 'neutral'; }

export function chartSummary(
  primary: string,
  sim: YearResult[],
  baseSim: YearResult[],
  horizon: number,
  cmpLabel = 'status-quo path',
): ChartSummary {
  const m = OUTCOMES_BY_ID[primary];
  if (!m) return { text: '', eli5: '', tone: 'neutral' };
  const fmt = (x: number) => x.toLocaleString('en-GB', { minimumFractionDigits: m.dp, maximumFractionDigits: m.dp });

  const start = (sim[0] as any)[primary] as number;
  const v = (row(sim, horizon) as any)[primary] as number;
  const base = (row(baseSim, horizon) as any)[primary] as number;
  const delta = v - base;
  const meaningful = Math.abs(delta) >= Math.pow(10, -m.dp) / 2 + 1e-9;
  const improved = (delta > 0) === m.goodIfUp;
  const tone: ChartSummary['tone'] = m.neutral || !meaningful ? 'neutral' : improved ? 'good' : 'bad';

  const moveWord = v > start + 1e-6 ? 'rises' : v < start - 1e-6 ? 'falls' : 'holds';
  const u = (x: number) => {
    if (m.unit === '£bn') return `£${fmt(x)}bn`;
    if (m.unit === '%' || m.unit === '% of pupils') return `${fmt(x)}%`;
    if (m.unit === 'months') return `${fmt(x)} mo`;
    if (m.unit === 'k FTE') return `${fmt(x)}k`;
    return `${fmt(x)} ${m.unit}`;
  };
  const deltaUnit = m.unit === '£bn' ? 'bn' : (m.unit === '%' || m.unit === '% of pupils') ? 'pp' : m.unit === 'months' ? ' months' : ` ${m.unit}`;

  let vs = '';
  if (meaningful && !m.neutral) {
    vs = ` — ${improved ? 'better' : 'worse'} than the ${cmpLabel} by ${fmt(Math.abs(delta))}${deltaUnit}`;
  } else if (meaningful && m.neutral) {
    vs = ` (${delta > 0 ? '+' : ''}${fmt(delta)}${deltaUnit} vs ${cmpLabel})`;
  }

  const text = `In your scenario it ${moveWord} from ${u(start)} (2025) to ${u(v)} by ${horizon}${vs}. ${CAUSE[primary] ?? ''}`;

  // plain-English version, same figures
  const moveEli = v > start + 1e-6 ? 'climbs to' : v < start - 1e-6 ? 'falls to' : 'stays at around';
  let vsEli = '';
  if (meaningful && !m.neutral) vsEli = ` — ${improved ? 'better' : 'worse'} than doing nothing by ${fmt(Math.abs(delta))}${deltaUnit}`;
  else if (meaningful && m.neutral) vsEli = ` (${delta > 0 ? '+' : ''}${fmt(delta)}${deltaUnit} vs doing nothing)`;
  else if (!meaningful) vsEli = ' — about the same as doing nothing';
  const eli5 = `${ELI5_LEAD[primary] ?? ''} It ${moveEli} ${u(v)} by ${horizon} (from ${u(start)} today)${vsEli}. ${ELI5_CAUSE[primary] ?? ''}`.trim();

  return { text, eli5, tone };
}
