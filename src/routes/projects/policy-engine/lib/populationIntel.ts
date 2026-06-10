// populationIntel.ts — the cohort-intelligence layer for the Population field study:
// Britain's birth-cohort tradition (what following children through time bought
// policy), the demographic tide reshaping the school estate, and the future of
// counting children. Research dossier compiled 2026-06-10. Self-contained.

// ---------------------------------------------------------------------------
// 3 · The cohort tradition — the exemplar record
// ---------------------------------------------------------------------------
export type CohortKind = 'landmark' | 'cautionary' | 'recovery';

export const KIND_META: Record<CohortKind, { label: string; eli5: string; colour: string }> = {
  landmark:   { label: 'landmark cohort',  eli5: 'changed policy',     colour: '#2f6f97' },
  cautionary: { label: 'the cautionary tale', eli5: 'what failure costs', colour: '#b1455e' },
  recovery:   { label: 'the recovery generation', eli5: 'the comeback', colour: '#3f7d6e' },
};

export interface CohortStudy {
  name: string;
  born: string;
  size: string;
  kind: CohortKind;
  what: string;
  bought: string;     // what it bought policy
  url: string;
}

export const COHORTS: CohortStudy[] = [
  {
    name: '1946 — NSHD', born: 'One week, March 1946', size: '~5,362 babies', kind: 'landmark',
    what: 'The world’s longest-running birth cohort, begun as a maternity survey.',
    bought: 'Douglas’s “The Home and the School” (1964) showed home environment and class — not just ability — decided who reached grammar school. Cited directly in the Plowden Report; fed the case for comprehensive reorganisation.',
    url: 'https://nshd.mrc.ac.uk/wp-content/uploads/2022/08/Mike_Wadswoth_Paper_on_the_history_of_NSHD_16-36.pdf',
  },
  {
    name: '1958 — NCDS', born: 'One week, March 1958', size: '~17,000 babies', kind: 'landmark',
    what: 'Born as the Perinatal Mortality Survey; a last-minute question on smoking produced early proof that smoking in pregnancy harms babies — transforming maternity care.',
    bought: '“Born to Fail?” (1973) used the age-11 sweep to define compound disadvantage — family + income + housing — and framed the 1970s child-poverty debate. The conceptual ancestor of this engine’s compound-risk strata.',
    url: 'https://ncds.info/home/about/history/',
  },
  {
    name: '1970 — BCS70', born: 'One week, April 1970', size: '~17,000 babies', kind: 'landmark',
    what: 'The cohort that, compared against 1958, produced Britain’s most-quoted social statistic.',
    bought: 'Three policy hits: adult basic-skills findings underpinned Skills for Life; reading-for-pleasure shown to drive maths progress (taken up by ministers of both parties); and Blanden’s 1958-vs-1970 comparison showed social mobility FELL — only measurable because two comparable cohorts existed.',
    url: 'https://cls.ucl.ac.uk/important-discoveries-from-the-1970-british-cohort-study-social-mobility/',
  },
  {
    name: '2000 — Millennium Cohort', born: '2000–02', size: '~19,000 children', kind: 'landmark',
    what: 'The cohort behind the modern early-years agenda.',
    bought: 'The early gap: rich/poor differences in development visible at age 3 and widening by 5, driven by the home learning environment — the empirical backbone of “school readiness” policy, and of this engine’s early-years levers.',
    url: 'https://ifs.org.uk/publications/socio-economic-gradient-early-child-outcomes-evidence-millennium-cohort-study',
  },
  {
    name: 'Life Study', born: 'Planned 2014–18', size: 'Designed for ~80,000 — recruited a few hundred', kind: 'cautionary',
    what: 'The planned successor, built around a £28.5m facility award. Recruitment began February 2015 and was stopped that October; funders withdrew in early 2016.',
    bought: 'A 20-year hole: no national birth cohort for children born 2001–2021 — austerity, smartphones and the run-up to COVID went unfollowed. The design lesson: it recruited through clinics instead of sampling from administrative registers.',
    url: 'https://www.nature.com/news/massive-uk-baby-study-cancelled-1.18650',
  },
  {
    name: 'Children of the 2020s', born: 'Sept–Nov 2021', size: '~8,500 babies', kind: 'recovery',
    what: 'DfE-commissioned (UCL/Ipsos), sampled from HMRC Child Benefit records — the fix Life Study lacked. Annual sweeps to age 5; age-3 analysis underway.',
    bought: 'Already producing: the January 2026 headline that toddlers average ~2 hours of screen time a day. Confirmed only to age 5 — extension is at DfE’s discretion, a live strategic decision.',
    url: 'https://cls.ucl.ac.uk/cls-studies/children-of-the-2020s-study/',
  },
  {
    name: 'Generation New Era', born: '2026', size: '30,000+ babies · £42.8m', kind: 'recovery',
    what: 'Announced September 2025: the first UK-wide birth cohort in 25 years. Invitations from summer 2026; first sweep this winter.',
    bought: 'Poetically, the cohort study returns in the smallest birth years on record — the recovery of the tradition and the demographic trough arrive together.',
    url: 'https://www.ukri.org/news/ukri-announces-first-uk-wide-birth-cohort-study-in-25-years/',
  },
];

export const ADMIN_COHORTS = {
  research: 'Meanwhile the admin data quietly became the bigger cohort machine: ECHILD holds 25 consecutive whole-population birth cohorts (everyone born 1995–2020, ~20m people) with linked health, education and social-care records; LEO extends them to earnings. A per-birth-year readout — perinatal risk → school-ready at 5 → on track at 11 → GCSEs at 16 → earnings at 30 — is technically constructible today with zero new collection. Nobody publishes it. The first official same-children accountability statistic arrives in summer 2028, when reception-baseline-to-KS2 progress is published for the cohort that started school in 2021.',
  eli5: 'The government’s own records already follow every child born since 1995 from hospital to school to payslip. You could read off each birth-year like a report card — ready at 5, on track at 11, GCSEs at 16, earning at 30. Nobody publishes that. The first official “same children, measured twice” statistic only arrives in 2028.',
};

// ---------------------------------------------------------------------------
// 4 · The demographic tide
// ---------------------------------------------------------------------------
export const TIDE_STATS: { big: string; label: string; eli5: string }[] = [
  { big: '730k → 595k', label: 'E&W live births: the 2012 peak vs 2024 (a record-low fertility rate of 1.41; 2024 saw the first uptick since 2021)', eli5: 'Births have fallen by almost a fifth since 2012 — 2024 saw the first tiny rise in years' },
  { big: '−395,000', label: 'projected fall in state-funded pupils, 2025→2030 (DfE projections, July 2025): primary −6.7%, secondary peaking right now', eli5: 'Schools will have 395,000 fewer pupils by 2030 — primary schools feel it first, secondaries from next year' },
  { big: '14%', label: 'of primary places now unfilled (up from 10% in 2018/19) — the NAO (Apr 2026) found DfE has no coordinated falling-rolls strategy while 16% of LAs are still growing', eli5: 'One in seven primary places is already empty — and the watchdog says there’s no national plan' },
  { big: '£1.2bn vs +£2.3bn', label: 'the IFS choice: freezing real per-pupil funding as rolls fall frees ~£1.2bn/yr — but projected high-needs growth (+£2.3bn by 2027; EHCPs +10.8%/yr) consumes the dividend either way', eli5: 'Falling rolls could free over a billion pounds a year — but rising special-needs costs are on track to swallow all of it' },
];

export const TIDE_LONDON = {
  research: 'London is the epicentre: births down 20% since 2012; eight Southwark primaries closed since 2022, Hackney closed four and is consulting on more, Lambeth planned mergers of up to sixteen — and for the first time Year 7 demand is falling FASTER than reception (−3.8% vs −2.5% to 2029/30, London Councils, Feb 2026). The decline has reached secondary.',
  eli5: 'London shows what unmanaged shrinkage looks like: whole primary schools closing across Southwark, Hackney and Lambeth — and the wave has now reached secondary schools too.',
};

export const TIDE_DATA = {
  research: 'The place-planning data already exists in pieces: the statutory School Capacity Survey carries every LA’s forecasts, and DfE publishes scorecards of how wrong each forecast was; the GLA runs the country’s only housing-aware projection model. Outside London, most LAs forecast with simple cohort-survival ratios. A national small-area roll forecaster — births by neighbourhood + GP registrations + migration + the housing pipeline, all existing admin data — is the obvious demographic early-warning product, and precisely what the NAO found missing.',
  eli5: 'Councils already guess their future pupil numbers, and the government even publishes how wrong the guesses were. Only London does it properly, using housing plans. A national early-warning forecast could be built from data that already exists.',
};

// ---------------------------------------------------------------------------
// 5 · Counting the next generation
// ---------------------------------------------------------------------------
export interface CountingModel {
  name: string;
  status: string;
  what: string;
  lesson: string;
  colour: string;
  url: string;
}

export const COUNTING: CountingModel[] = [
  {
    name: 'Census 2031 — retained', status: 'Commissioned July 2025', colour: '#2f6f97',
    what: 'The “2021 will be the last census” ambition is dead: ONS’s own assessment found admin-based population estimates not yet good enough, while the survey machinery wobbled too (the Labour Force Survey collapse, the Devereux review’s “deep-seated issues”). Government formally commissioned a full Census 2031.',
    lesson: 'Population intelligence is a live institutional risk, not a solved problem — the UK is keeping the census because BOTH alternatives faltered at once.',
    url: 'https://www.ons.gov.uk/census/aboutcensus/census2031/planningforcensus2031',
  },
  {
    name: 'The Nordic register model', status: 'Denmark since 1981 · Finland since 1990', colour: '#3f7d6e',
    what: 'No census forms at all: annual population statistics drawn from person registers keyed on a universal ID used across every service.',
    lesson: 'The prerequisite England lacks is the universal identifier — which is exactly what the CWS Act’s consistent-identifier pilot starts to build. The counting question and the spine question are the same question.',
    url: 'https://unece.org/DAM/stats/publications/Register_based_statistics_in_Nordic_countries.pdf',
  },
  {
    name: 'New Zealand’s social investment', status: 'Agency relaunched 2024 · NZ$275m in Budget 2025', colour: '#7a5aa6',
    what: 'The IDI links tax, welfare, health, education and justice person-by-person; since 2011 actuaries have valued the forward lifetime cost of the caseload annually, and the relaunched Social Investment Agency targets early intervention where avoided-cost returns are highest — truancy and youth offending included.',
    lesson: 'Price a child’s projected lifetime fiscal cost from linked admin data, then spend early where it changes the curve. The method this page’s economic layer gestures at, run as a standing state function.',
    url: 'https://budget.govt.nz/budget/2025/by/dept/sia.htm',
  },
  {
    name: 'The UK gap', status: 'Ingredients present, institution missing', colour: '#b4632e',
    what: 'LEO and ECHILD provide the linked data; the Green Book requires lifetime appraisal project-by-project; academia has proven the method on a UK cohort (York’s LifeSim microsimulates 100,000 MCS children birth-to-death including public-budget costs). No UK institution runs a standing actuarial valuation of children’s trajectories.',
    lesson: 'The synthetic cohort on this page is a sketch of what that institution would publish. The missing piece is institutional, not technical.',
    url: 'https://microsimulation.pub/articles/00228',
  },
];

export const POP_TAKEAWAY = {
  research: 'Three through-lines: the 80-year cohort record shows following the same children changes policy for decades (and Life Study shows what design failure costs — a 20-year hole); the demographic tide makes cohort thinking operational, because every falling-rolls decision is a bet on a birth-year; and the admin estate already contains 25 unpublished birth-cohort report cards. The first institution to publish them — per birth-year, school-ready at 5 to earnings at 30 — turns population counting into population intelligence.',
  eli5: 'Following the same children through life is the most powerful policy tool Britain has ever built — and it nearly lost the habit. The records to do it for every child already exist. Publishing them, year-group by year-group, is the difference between counting children and understanding them.',
};
