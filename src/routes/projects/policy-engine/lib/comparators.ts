// comparators.ts — the cross-country (international) comparator dataset for the "Global" tab.
//
// England's engine argues three things about money and fairness; this page tests them against the
// real world. Every figure is sourced (see lib/sources.ts additions + the per-row note):
//   • PISA 2022 (OECD, released Dec 2023) — maths / reading / science, and the 2018→2022 maths trend.
//   • Equity metrics — each country's official OECD PISA 2022 country note: the share of maths-score
//     variance explained by socio-economic background (ESCS), and the advantaged−disadvantaged
//     (top vs bottom ESCS quartile) maths point gap.
//   • Spending — OECD Education at a Glance 2024 (ref. year 2021): % of GDP on educational
//     institutions (primary–tertiary, incl. R&D) and USD-PPP per student.
//   • GDP per capita PPP — World Bank, 2023/24.
//
// Data-comparability flags are first-class here (the page surfaces them, it doesn't hide them):
//   • Singapore & Vietnam are NOT OECD members, so they have no comparable EaG per-student or
//     "% of GDP on institutions" figure. Their spend is a narrower World-Bank public-spend proxy on
//     a different basis — `spendComparable:false` keeps them OFF the money axis.
//   • Ireland & Singapore GDP/capita are inflated by multinational / financial-hub accounting
//     (`gdpCaveat`), so per-student $ is the more honest spend comparator for Ireland.
//   • Vietnam's 2018→2022 maths trend is N.A. in the OECD tables (`mathsTrend:null`).

export type Tier = 'anchor' | 'leader' | 'peer' | 'other';

export interface Country {
  code: string;
  name: string;
  flag: string;
  tier: Tier;
  maths: number;
  reading: number;
  science: number;
  spendGdp: number;             // % of GDP (OECD basis; WB proxy for SG/VN — see spendComparable)
  spendStudent: number | null;  // USD PPP per student, all levels (null for non-OECD)
  spendComparable: boolean;     // false ⇒ keep off the money-vs-outcomes axis
  escsVariance: number;         // % of maths-score variance explained by background (lower = fairer)
  escsGap: number;              // advantaged − disadvantaged maths point gap (lower = fairer)
  resilient: number;            // % of disadvantaged pupils scoring in the top maths quartile
  gdpCap: number;               // GDP per capita, PPP USD
  gdpCaveat?: boolean;          // GDP inflated by multinational accounting (IE, SG)
  mathsTrend: number | null;    // 2018 → 2022 maths change (null = not comparable)
  lesson: string;
  eli5: string;
}

export const TIER_META: Record<Tier, { label: string; eli5: string; colour: string; blurb: string; eli5Blurb: string }> = {
  anchor: {
    label: 'England (UK)', eli5: 'Us', colour: '#9a3b2e',
    blurb: 'The subject of the engine — shown for reference against everyone else.',
    eli5Blurb: 'This is us — the country the whole model is about.',
  },
  leader: {
    label: 'Education leaders', eli5: 'The best in the world', colour: '#2f7d4f',
    blurb: 'Three of the highest-performing systems on earth — chosen to show how excellence is actually built.',
    eli5Blurb: 'Three of the best school systems anywhere — to see how they do it.',
  },
  peer: {
    label: 'Economic peers', eli5: 'Countries like us', colour: '#3a5fa8',
    blurb: 'Large, wealthy G7-type economies — the natural like-for-like comparison for England.',
    eli5Blurb: 'Big, rich countries a lot like Britain — the fairest comparison.',
  },
  other: {
    label: 'Interesting wildcards', eli5: 'Surprising ones', colour: '#b4632e',
    blurb: 'Three deliberately awkward comparators that each break a comfortable assumption.',
    eli5Blurb: 'Three surprising countries that each upend a lazy assumption.',
  },
};

// The OECD average, used as the reference line on every chart.
export const OECD_AVG = {
  maths: 472, reading: 476, science: 485,
  spendGdp: 4.9, spendStudent: 14209, escsVariance: 15, escsGap: 93, resilient: 10, mathsTrend: -15,
};

// The cast: England + 3 leaders + 3 economic peers + 3 wildcards = 10 countries.
export const COUNTRIES: Country[] = [
  {
    code: 'UK', name: 'United Kingdom', flag: '🇬🇧', tier: 'anchor',
    maths: 489, reading: 494, science: 500, spendGdp: 6.2, spendStudent: 14262, spendComparable: true,
    escsVariance: 11, escsGap: 86, resilient: 15, gdpCap: 60620, mathsTrend: -13,
    lesson: 'Above the OECD average on all three subjects — and quietly one of the fairer systems: background shapes results less here than in most rich countries, and more disadvantaged pupils beat the odds (15% “resilient”).',
    eli5: 'Scores a bit above average on everything — and is one of the fairer systems, where being poor holds you back less than in most rich countries.',
  },
  {
    code: 'SG', name: 'Singapore', flag: '🇸🇬', tier: 'leader',
    maths: 575, reading: 543, science: 561, spendGdp: 2.5, spendStudent: null, spendComparable: false,
    escsVariance: 17, escsGap: 112, resilient: 10, gdpCap: 150689, gdpCaveat: true, mathsTrend: 6,
    lesson: 'The global ceiling — first in the world in every subject, and it still rose after COVID. Built on teacher quality and a mastery curriculum, not on the highest spend per pupil.',
    eli5: 'The best in the world at all three subjects, and still getting better — built on brilliant teaching, not just big budgets.',
  },
  {
    code: 'JP', name: 'Japan', flag: '🇯🇵', tier: 'leader',
    maths: 536, reading: 516, science: 547, spendGdp: 4.0, spendStudent: 13323, spendComparable: true,
    escsVariance: 12, escsGap: 81, resilient: 12, gdpCap: 51685, mathsTrend: 9,
    lesson: 'High and equitable on below-OECD spending — and one of the very few systems that actually rose (+9 maths) through the pandemic. The cleanest counter-example to “you get what you pay for”.',
    eli5: 'Top marks and fair, on less money than England — and it improved when most countries slipped backwards.',
  },
  {
    code: 'EE', name: 'Estonia', flag: '🇪🇪', tier: 'leader',
    maths: 510, reading: 511, science: 526, spendGdp: 4.5, spendStudent: 11708, spendComparable: true,
    escsVariance: 13, escsGap: 81, resilient: 10, gdpCap: 49334, mathsTrend: -13,
    lesson: 'Europe’s top performer — on mid-level spend ($11.7k/student, less than England) and fairer than England too. The single strongest proof that high, fair and affordable can hold together at once.',
    eli5: 'Europe’s best school system, on ordinary money, and very fair — proof you don’t need to spend the most to do well.',
  },
  {
    code: 'FR', name: 'France', flag: '🇫🇷', tier: 'peer',
    maths: 474, reading: 474, science: 487, spendGdp: 5.4, spendStudent: 14803, spendComparable: true,
    escsVariance: 21, escsGap: 113, resilient: 7, gdpCap: 61322, mathsTrend: -21,
    lesson: 'Below the OECD average and the least equitable big system here: a child’s background explains 21% of their maths, and only 7% of poorer pupils reach the top quartile. A like-for-like economy doing fairness badly.',
    eli5: 'Below average, and the least fair of the big countries — where you come from matters a lot for your results.',
  },
  {
    code: 'DE', name: 'Germany', flag: '🇩🇪', tier: 'peer',
    maths: 475, reading: 480, science: 492, spendGdp: 4.6, spendStudent: 17161, spendComparable: true,
    escsVariance: 19, escsGap: 111, resilient: 10, gdpCap: 72300, mathsTrend: -25,
    lesson: 'The highest spend per student in this group ($17.2k) — yet below average, badly unequal, and the second-steepest fall (−25). Sorting children into school tracks early ties results tightly to background.',
    eli5: 'Spends the most of anyone here, but isn’t fair and fell the most — sorting kids into different schools early locks in where they started.',
  },
  {
    code: 'IT', name: 'Italy', flag: '🇮🇹', tier: 'peer',
    maths: 471, reading: 482, science: 477, spendGdp: 4.0, spendStudent: 12760, spendComparable: true,
    escsVariance: 13, escsGap: 85, resilient: 11, gdpCap: 60847, mathsTrend: -15,
    lesson: 'Middling scores but relatively fair (gap 85, near England’s), and reading actually rose (+5). Hides a vast North–South divide inside its own borders — Italy’s “regions” problem dwarfs England’s.',
    eli5: 'Middle of the pack but fairly even, and reading is improving — though the north does far better than the south.',
  },
  {
    code: 'IE', name: 'Ireland', flag: '🇮🇪', tier: 'other',
    maths: 492, reading: 516, science: 504, spendGdp: 2.9, spendStudent: 13059, spendComparable: true,
    escsVariance: 13, escsGap: 74, resilient: 12, gdpCap: 131175, gdpCaveat: true, mathsTrend: -8,
    lesson: 'The closest neighbour — and it outperforms England: the best reading in the EU, the smallest rich–poor gap of anyone here (74), and still narrowing. The most resonant “a system next door does fairness better”.',
    eli5: 'Right next door and doing better — top reading, and the smallest rich–poor gap of anyone here.',
  },
  {
    code: 'PL', name: 'Poland', flag: '🇵🇱', tier: 'other',
    maths: 489, reading: 489, science: 499, spendGdp: 4.6, spendStudent: 11729, spendComparable: true,
    escsVariance: 16, escsGap: 96, resilient: 9, gdpCap: 50378, mathsTrend: -27,
    lesson: 'The textbook structural-reform success of the 2000s (delaying tracking lifted a whole cohort) — then the sharpest post-COVID drop of the group (−27). A warning that hard-won gains are fragile.',
    eli5: 'Famously turned its schools around years ago — then fell harder than anyone after COVID. A reminder that progress can slip away.',
  },
  {
    code: 'VN', name: 'Vietnam', flag: '🇻🇳', tier: 'other',
    maths: 469, reading: 462, science: 472, spendGdp: 2.9, spendStudent: null, spendComparable: false,
    escsVariance: 14, escsGap: 78, resilient: 13, gdpCap: 16386, mathsTrend: null,
    lesson: 'Near-OECD outcomes and the most resilient disadvantaged pupils (13% reach the top) — on the lowest income and spend by far. The value-for-money outlier that embarrasses every richer country.',
    eli5: 'Does almost as well as us, and its poorer kids do best of all — on a tiny fraction of the money. The bargain of the group.',
  },
];

export const ANCHOR = COUNTRIES.find((c) => c.tier === 'anchor')!;
export const byCode = (code: string) => COUNTRIES.find((c) => c.code === code)!;

// — derived views used by the charts —
// money-vs-outcomes: only the countries with a comparable OECD per-student figure
export const SPEND_PLOT = COUNTRIES.filter((c) => c.spendComparable && c.spendStudent != null);
// the two that fall off that axis, surfaced as a footnote rather than dropped
export const SPEND_OFFAXIS = COUNTRIES.filter((c) => !c.spendComparable);
// equity: smaller gap first (fairest at the top)
export const BY_EQUITY = [...COUNTRIES].sort((a, b) => a.escsGap - b.escsGap);
// trend: biggest riser first (nulls last)
export const BY_TREND = [...COUNTRIES].sort((a, b) => (b.mathsTrend ?? -999) - (a.mathsTrend ?? -999));
// attainment: highest maths first
export const BY_MATHS = [...COUNTRIES].sort((a, b) => b.maths - a.maths);
