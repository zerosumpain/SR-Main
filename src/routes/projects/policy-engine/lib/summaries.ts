// summaries.ts — generates a short, dynamic narrative for each outcome chart:
// what the metric does in the current scenario (to the selected horizon) and the
// research-grounded cause of its variability. Self-contained.

import type { YearResult } from './types';
import { OUTCOMES_BY_ID } from './outcomes';

// Why each outcome moves — the dominant levers / mechanism behind its variability.
const CAUSE: Record<string, string> = {
  gapKS4: 'Most of the variability comes from disadvantaged absence (the single strongest lever), then child poverty, pupil premium and early-years investment — the last of which only reaches GCSE with an ~11-year lag.',
  gapKS2: 'Driven by disadvantaged absence, the reading & oracy push and early-years carry-over.',
  attainment8: 'Moves with teacher capacity (the strongest evidenced channel) and attendance, with curriculum reform adding from 2028; £/pupil has little direct effect.',
  grade5EM: 'Tracks Attainment 8 — it rises with teacher quality and attendance, and the disadvantaged line is held down by the gap.',
  ks2RWM: 'Sensitive to the reading & oracy push, teacher capacity and attendance; the 2028 curriculum refresh adds later.',
  gld: 'Almost entirely an early-years story: quality investment, disadvantaged access and the Early Years Pupil Premium move it within ~2 years.',
  ehcpPct: 'Climbs on its own demand momentum; inclusive-mainstream investment and early SEND slow it, and EHCP reform diverts plans to ISPs from 2030 — though the government’s 4.7% path is disputed by the IFS.',
  highNeedsDeficitStock: 'Explodes when high-needs funding lags EHCP demand; the March-2028 override cliff then drains mainstream funding. Inclusion, EHCP reform and funding growth bend it down.',
  ehcpAttainment8: 'Improves with inclusion investment but falls if EHCP reform narrows plans without matching mainstream support — the double-edged reform.',
  persistentAbsence: 'Falls with attendance mentors and breakfast clubs and rises with child poverty; disadvantaged pupils are ~2.4× more likely to be persistently absent.',
  childPoverty: 'Driven by the child-poverty-action lever (two-child-limit removal, UC) and FSM expansion, against a rising baseline trend.',
  neet: 'Falls with attainment and the post-16/skills and youth-mental-health levers, but rises on an exogenous youth-ill-health trend — the Milburn "generational fault line".',
  teacherShortfall: 'Closes with recruitment, pay competitiveness and shortage-subject bursaries; negative means a surplus beyond the 6,500 pledge.',
};

const row = (s: YearResult[], yr: number) => s.find((y) => y.year === yr) ?? s[s.length - 1];

export interface ChartSummary { text: string; tone: 'good' | 'bad' | 'neutral'; }

export function chartSummary(
  primary: string,
  sim: YearResult[],
  baseSim: YearResult[],
  horizon: number,
): ChartSummary {
  const m = OUTCOMES_BY_ID[primary];
  if (!m) return { text: '', tone: 'neutral' };
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
    vs = ` — ${improved ? 'better' : 'worse'} than the status-quo path by ${fmt(Math.abs(delta))}${deltaUnit}`;
  } else if (meaningful && m.neutral) {
    vs = ` (${delta > 0 ? '+' : ''}${fmt(delta)}${deltaUnit} vs status quo)`;
  }

  const text = `In your scenario it ${moveWord} from ${u(start)} (2025) to ${u(v)} by ${horizon}${vs}. ${CAUSE[primary] ?? ''}`;
  return { text, tone };
}
