// comparators.ts — the cross-country (international) comparator dataset for the "Global" tab.
//
// England's engine argues three things about money and fairness; this page tests them against the
// real world. Every figure is sourced and was independently fact-checked against the primary OECD /
// World-Bank documents (see lib/sources.ts + the Method page's "International comparators" section):
//   • PISA 2022 (OECD, released Dec 2023) — maths / reading / science, and the 2018→2022 maths trend.
//   • Equity — each country's official OECD PISA 2022 country note: the share of maths-score variance
//     explained by socio-economic background (ESCS), and the advantaged−disadvantaged (top vs bottom
//     ESCS quartile) maths point gap.
//   • Spending — TWO measures, kept distinct:
//       spendCumulative = cumulative expenditure per student over ages 6–15 (USD PPP) — the measure
//         OECD itself plots against PISA (Table I.B3.2.2 / Fig II.5.2). This is the methodologically
//         correct spend axis (it excludes tertiary + R&D and matches the tested cohort).
//       spendStudent / spendGdp = annual per-student (all levels) + % of GDP — kept only as
//         context badges, NOT for the scatter.
//   • GDP per capita PPP — World Bank, 2023/24.
//
// Data-quality flags are first-class (the page surfaces them, it does not hide them):
//   • Singapore & Vietnam are non-OECD ⇒ their annual %-GDP / per-student EaG figures are a narrower
//     World-Bank public-spend proxy on a different basis (`spendComparable:false`). BUT their
//     cumulative-6→15 figure DOES exist and IS comparable, so they are plotted on the scatter.
//   • Estonia is the one country OECD left blank for cumulative-6→15 (`spendCumulativeEst:true`);
//     ≈$90k is reconstructed from its annual ISCED 1+2 per-student spend, labelled as an estimate.
//   • Ireland & Singapore GDP/cap are inflated by multinational accounting (`gdpCaveat`).
//   • Japan & Singapore maths "gains" are NOT statistically significant (`trendSig:false`) — OECD:
//     "about the same as in 2018 in mathematics". Vietnam's 2018→22 trend is not comparable (`null`).

export type Tier = 'anchor' | 'leader' | 'peer' | 'other';

export interface Country {
  code: string;
  name: string;
  flag: string;
  tier: Tier;
  maths: number;
  reading: number;
  science: number;
  spendGdp: number;                 // % of GDP (OECD basis; WB proxy for SG/VN — see spendComparable)
  spendStudent: number | null;      // USD PPP per student, annual all-levels (null for non-OECD); context only
  spendComparable: boolean;         // annual/%GDP comparable? false for SG/VN
  spendCumulative: number | null;   // cumulative USD PPP per student, ages 6–15 — the OECD spend axis
  spendCumulativeEst?: boolean;     // cumulative figure is a reconstruction, not OECD-published (Estonia)
  escsVariance: number;             // % of maths-score variance explained by background (lower = fairer)
  escsGap: number;                  // advantaged − disadvantaged maths point gap (lower = fairer)
  resilient: number;                // % of disadvantaged pupils scoring in the top maths quartile
  gdpCap: number;                   // GDP per capita, PPP USD
  gdpCaveat?: boolean;              // GDP inflated by multinational accounting (IE, SG)
  mathsTrend: number | null;        // 2018 → 2022 maths change (null = not comparable, Vietnam)
  trendSig: boolean | null;         // is that change statistically significant? (null = no trend)
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
  spendGdp: 4.9, spendStudent: 14209, spendCumulative: 102612,
  escsVariance: 15, escsGap: 93, resilient: 10, mathsTrend: -15,
};

// The OECD spending-vs-performance threshold: above ~USD 75,000 cumulative per student (6–15),
// extra spending stops predicting PISA performance and HOW money is spent matters more.
export const SPEND_THRESHOLD = 75000;

// England is reported separately from the UK in PISA 2022 (a few points higher; UK-wide is dragged
// down by Wales/Scotland/NI). England's response rates also fell below PISA standards, so its means
// may be flattered. The scatter/cards plot the comparable UK figure; this is the England footnote.
export const ENGLAND_PISA = { maths: 492, reading: 496, science: 503 };

// The cast: England + 3 leaders + 3 economic peers + 3 wildcards = 10 countries.
export const COUNTRIES: Country[] = [
  {
    code: 'UK', name: 'United Kingdom', flag: '🇬🇧', tier: 'anchor',
    maths: 489, reading: 494, science: 500, spendGdp: 6.2, spendStudent: 14262, spendComparable: true,
    spendCumulative: 124000, escsVariance: 11, escsGap: 86, resilient: 15, gdpCap: 60620, mathsTrend: -13, trendSig: true,
    lesson: 'Above the OECD average on all three subjects — and quietly one of the fairer systems: background shapes results less here than in most rich countries, and more disadvantaged pupils beat the odds (15% “resilient”). England specifically scored a few points higher than the UK figure.',
    eli5: 'Scores a bit above average on everything — and is one of the fairer systems, where being poor holds you back less than in most rich countries.',
  },
  {
    code: 'SG', name: 'Singapore', flag: '🇸🇬', tier: 'leader',
    maths: 575, reading: 543, science: 561, spendGdp: 2.5, spendStudent: null, spendComparable: false,
    spendCumulative: 166100, escsVariance: 17, escsGap: 112, resilient: 10, gdpCap: 150689, gdpCaveat: true, mathsTrend: 6, trendSig: false,
    lesson: 'The global ceiling — first in the world in every subject, and it held the line in maths (its gains were in science) while the OECD average fell a record 15 points. Built on teacher quality and a mastery curriculum — though it also spends the most per pupil of anyone here, and carries one of the widest rich–poor gaps.',
    eli5: 'The best in the world at all three subjects, and it didn’t slip in maths when most countries did — built on brilliant teaching. It does spend the most, though, and its rich–poor gap is one of the biggest.',
  },
  {
    code: 'JP', name: 'Japan', flag: '🇯🇵', tier: 'leader',
    maths: 536, reading: 516, science: 547, spendGdp: 4.0, spendStudent: 13323, spendComparable: true,
    spendCumulative: 101400, escsVariance: 12, escsGap: 81, resilient: 12, gdpCap: 51685, mathsTrend: 9, trendSig: false,
    lesson: 'High and equitable on roughly average cumulative spend — and it held its maths steady through the pandemic (rising in reading and science) while most of the West fell. The cleanest counter-example to “you get what you pay for”.',
    eli5: 'Top marks and fair, on ordinary money — and it didn’t lose ground in maths when most countries slipped backwards.',
  },
  {
    code: 'EE', name: 'Estonia', flag: '🇪🇪', tier: 'leader',
    maths: 510, reading: 511, science: 526, spendGdp: 4.5, spendStudent: 11708, spendComparable: true,
    spendCumulative: 90000, spendCumulativeEst: true, escsVariance: 13, escsGap: 81, resilient: 10, gdpCap: 49334, mathsTrend: -13, trendSig: true,
    lesson: 'Europe’s top performer — on some of the lowest spend here and fairer than England too. The single strongest proof that high, fair and affordable can hold together at once. (It fell with everyone else in 2022, but from a much higher base.)',
    eli5: 'Europe’s best school system, on some of the least money, and very fair — proof you don’t need to spend the most to do well.',
  },
  {
    code: 'FR', name: 'France', flag: '🇫🇷', tier: 'peer',
    maths: 474, reading: 474, science: 487, spendGdp: 5.4, spendStudent: 14803, spendComparable: true,
    spendCumulative: 109600, escsVariance: 21, escsGap: 113, resilient: 7, gdpCap: 61322, mathsTrend: -21, trendSig: true,
    lesson: 'Below the OECD average and the least equitable big system here: a child’s background explains 21% of their maths, and only 7% of poorer pupils reach the top quartile. A like-for-like economy doing fairness badly.',
    eli5: 'Below average, and the least fair of the big countries — where you come from matters a lot for your results.',
  },
  {
    code: 'DE', name: 'Germany', flag: '🇩🇪', tier: 'peer',
    maths: 475, reading: 480, science: 492, spendGdp: 4.6, spendStudent: 17161, spendComparable: true,
    spendCumulative: 121100, escsVariance: 19, escsGap: 111, resilient: 10, gdpCap: 72300, mathsTrend: -25, trendSig: true,
    lesson: 'Near the top of this group for cumulative spend — yet below average, badly unequal, and the second-steepest fall (−25). Sorting children into school tracks early ties results tightly to background.',
    eli5: 'Spends near the most of anyone here, but isn’t fair and fell the most — sorting kids into different schools early locks in where they started.',
  },
  {
    code: 'IT', name: 'Italy', flag: '🇮🇹', tier: 'peer',
    maths: 471, reading: 482, science: 477, spendGdp: 4.0, spendStudent: 12760, spendComparable: true,
    spendCumulative: 105800, escsVariance: 13, escsGap: 85, resilient: 11, gdpCap: 60847, mathsTrend: -16, trendSig: true,
    lesson: 'Middling scores but relatively fair (gap 85, near England’s), and reading actually rose. Hides a vast North–South divide inside its own borders — Italy’s “regions” problem dwarfs England’s.',
    eli5: 'Middle of the pack but fairly even, and reading is improving — though the north does far better than the south.',
  },
  {
    code: 'IE', name: 'Ireland', flag: '🇮🇪', tier: 'other',
    maths: 492, reading: 516, science: 504, spendGdp: 2.9, spendStudent: 13059, spendComparable: true,
    spendCumulative: 94200, escsVariance: 13, escsGap: 74, resilient: 12, gdpCap: 131175, gdpCaveat: true, mathsTrend: -8, trendSig: true,
    lesson: 'The closest neighbour — and it outperforms England: the best reading in the EU, the smallest rich–poor gap of anyone here (74), and the gentlest decline. The most resonant “a system next door does fairness better”.',
    eli5: 'Right next door and doing better — top reading, and the smallest rich–poor gap of anyone here.',
  },
  {
    code: 'PL', name: 'Poland', flag: '🇵🇱', tier: 'other',
    maths: 489, reading: 489, science: 499, spendGdp: 4.6, spendStudent: 11729, spendComparable: true,
    spendCumulative: 87700, escsVariance: 16, escsGap: 96, resilient: 9, gdpCap: 50378, mathsTrend: -27, trendSig: true,
    lesson: 'The textbook structural-reform success of the 2000s (delaying tracking lifted a whole cohort) — then the sharpest post-COVID drop of the group (−27). A warning that hard-won gains are fragile.',
    eli5: 'Famously turned its schools around years ago — then fell harder than anyone after COVID. A reminder that progress can slip away.',
  },
  {
    code: 'VN', name: 'Vietnam', flag: '🇻🇳', tier: 'other',
    maths: 469, reading: 462, science: 472, spendGdp: 2.9, spendStudent: null, spendComparable: false,
    spendCumulative: 13800, escsVariance: 14, escsGap: 78, resilient: 13, gdpCap: 16386, mathsTrend: null, trendSig: null,
    lesson: 'Near-OECD outcomes and the most resilient disadvantaged pupils (13% reach the top) — on the lowest income and spend by far (a cumulative ~$14k, a ninth of Singapore’s). The value-for-money outlier that embarrasses every richer country.',
    eli5: 'Does almost as well as us, and its poorer kids do best of all — on a tiny fraction of the money. The bargain of the group.',
  },
];

export const ANCHOR = COUNTRIES.find((c) => c.tier === 'anchor')!;
export const byCode = (code: string) => COUNTRIES.find((c) => c.code === code)!;

// — derived views used by the charts —
// money-vs-outcomes: the OECD cumulative-6→15 measure exists for all 10 (Estonia estimated)
export const SPEND_PLOT = COUNTRIES.filter((c) => c.spendCumulative != null);
// equity: smaller gap first (fairest at the top)
export const BY_EQUITY = [...COUNTRIES].sort((a, b) => a.escsGap - b.escsGap);
// trend: biggest riser first (nulls last)
export const BY_TREND = [...COUNTRIES].sort((a, b) => (b.mathsTrend ?? -999) - (a.mathsTrend ?? -999));
// attainment: highest maths first
export const BY_MATHS = [...COUNTRIES].sort((a, b) => b.maths - a.maths);
