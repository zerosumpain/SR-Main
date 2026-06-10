// measurement.ts — the "how would we monitor this?" layer: for every Briefing chart,
// what data measures it today, how stale it is, the known gap, and what better looks
// like. The move that turns a policy simulator into a data-strategy instrument.
// Keyed by the Briefing's CHART_PRIMARY outcome ids. Self-contained.

export interface Measurement {
  sources: string;   // what measures this today
  latency: string;   // how stale when usable
  gaps: string;      // the known hole
  better: string;    // one line of "what better looks like"
  eli5: string;      // the whole story in plain English
}

export const MEASUREMENT: Record<string, Measurement> = {
  gapKS4: {
    sources: 'KS4 results → NPD; EPI months-of-learning derivation',
    latency: 'Annual; published ~6 months after exams, EPI analysis later still',
    gaps: 'No in-year signal; disadvantage definition (FSM-Ever6) misses the just-above-threshold poor',
    better: 'Termly progress proxies from the attendance feed + teacher assessment, gap-split',
    eli5: 'We learn how far behind poorer pupils are once a year, months after the exams — never during the year, when something could still be done.',
  },
  attainment8: {
    sources: 'KS4 exam results → NPD',
    latency: 'Annual, ~6 months lag',
    gaps: 'Nothing between exam series; reformed quals complicate trend reading',
    better: 'In-year standardised assessment sample, NRT-style, published quarterly',
    eli5: 'GCSE results arrive once a year. Between summers, the system is flying blind on attainment.',
  },
  grade5EM: {
    sources: 'KS4 exam results → NPD',
    latency: 'Annual, ~6 months lag',
    gaps: 'Threshold measure — invisible progress just below the line',
    better: 'Distributional reporting (where the whole curve moved), not just the pass line',
    eli5: 'We count who got over the bar, not who nearly did — so help aimed just below the line never shows up.',
  },
  ks2RWM: {
    sources: 'KS2 SATs → NPD',
    latency: 'Annual; July results, autumn publication',
    gaps: '2020/21 hole in the series; writing is teacher-assessed (less comparable)',
    better: 'Lighter annual sampling between statutory points (Years 3–5 are dark)',
    eli5: 'Primary results come once a year at age 11 — the three school years before that are a measurement blank.',
  },
  gld: {
    sources: 'EYFSP teacher assessment → NPD',
    latency: 'Annual',
    gaps: 'Teacher-assessed, moderation varies; nothing measured before reception',
    better: 'A consistent age-2/3 development checkpoint feeding the same record',
    eli5: 'The first time the state measures a child’s development is age 5 — after the years where the gap actually opens.',
  },
  ehcpPct: {
    sources: 'SEN2 census / EES EHC-plan statistics',
    latency: 'Annual snapshot (January count, May publication)',
    gaps: 'Pipeline pressure (requests, assessments in progress) only partially visible in-year',
    better: 'Monthly assessment-pipeline reporting — demand is the leading indicator, prevalence the lagging one',
    eli5: 'We count special-needs plans once a year, but the queue of families waiting for assessments — the early warning — is barely published.',
  },
  highNeedsDeficitStock: {
    sources: 'DSG outturn statements; s251; CCN/IFS analysis',
    latency: 'Annual accounts, a year+ in arrears',
    gaps: 'Deficits sit off council balance sheets under the statutory override until 2028',
    better: 'Quarterly high-needs spend vs budget by LA, published',
    eli5: 'The special-needs debt is tracked through council accounts that arrive more than a year late — and an accounting rule keeps it off the books until 2028.',
  },
  ehcpAttainment8: {
    sources: 'KS4 results × SEN2 status → NPD',
    latency: 'Annual',
    gaps: 'Outcomes for EHCP pupils in special/alternative provision poorly captured by A8',
    better: 'Destination + provision-quality measures for SEND, not just exam points',
    eli5: 'Exam scores are a poor ruler for many special-needs pupils — and we have little else that measures whether their provision works.',
  },
  persistentAbsence: {
    sources: 'Daily attendance feed (mandatory since Sept 2024); termly census historically',
    latency: 'NEAR-REAL-TIME — the estate’s newest, fastest asset',
    gaps: 'Used for school-level benchmarking only; no individual early-warning use; no post-16 equivalent',
    better: 'Individual trajectory flags (sudden deterioration in Years 9–11) pushed to LAs and careers leaders in-year',
    eli5: 'This is the one number the government now sees daily — but it uses it to compare schools, not to notice a child drifting away in time to act.',
  },
  childPoverty: {
    sources: 'DWP HBAI survey; FSM eligibility as the school-side proxy',
    latency: 'HBAI ~1 year in arrears; survey-based',
    gaps: 'Survey lag and sample noise; local-level poverty poorly measured',
    better: 'Admin-data poverty nowcast (HMRC RTI + UC) at LA level',
    eli5: 'Child-poverty numbers come from a survey published a year late. The tax system knows family incomes in close to real time.',
  },
  neet: {
    sources: 'LFS (quarterly, volatile); NCCIS to 17; annual DfE brief; destination measures',
    latency: 'Quarterly with ONS volatility caveats; LA-level annual; destinations ~15 months',
    gaps: 'Tracking goes dark at 18; LA “not known” rates corrupt comparisons; no real-time post-16 signal',
    better: 'RTI/DWP-linked near-real-time EET status for all 16–24s — the linkage already exists in LEO, at research cadence',
    eli5: 'We track 16–17-year-olds patchily, stop at 18, and rely on a wobbly survey for the rest — for the outcome costing the country most.',
  },
  teacherShortfall: {
    sources: 'School Workforce Census (Nov); ITT census; NFER analysis',
    latency: 'Annual, ~7 months lag',
    gaps: 'Vacancy and subject-level shortage poorly visible in-year',
    better: 'Termly vacancy reporting via the MIS pipe that already carries attendance',
    eli5: 'We count teachers once a year, in November, published the following June — schools know their gaps daily.',
  },
  // ---- field-study exhibits (the layer extended beyond the Briefing, 2026-06-10) ----
  populationFunnel: {
    sources: 'School census cohort counts; EYFSP / KS2 / KS4 stage outcomes (NPD)',
    latency: 'Each stage measured once, years apart — age 5, 11 and 16',
    gaps: 'No published statistic follows one real cohort through all three gates; this funnel is synthetic',
    better: 'Cohort-linked stage reporting — the NPD already contains the longitudinal cut; nobody publishes it',
    eli5: 'Each checkpoint is measured separately, years apart. The data to follow one real year-group through all three gates already sits in the National Pupil Database — it just isn’t published that way.',
  },
  leoEconomics: {
    sources: 'LEO (NPD ↔ HMRC earnings ↔ DWP benefits); DfE lifetime-earnings estimates',
    latency: 'Years — earnings observed over tax-year cycles; the per-point constants come from 2002–05 GCSE cohorts',
    gaps: 'Associational, not causal; dated calibration cohorts; no regional wage adjustment',
    better: 'Earnings-by-attainment constants refreshed per cohort, with regional splits — the linkage already exists',
    eli5: 'The pay data behind these pound figures comes from people who sat their GCSEs twenty years ago. The linkage exists to refresh it every year — it just isn’t done.',
  },
  regionalBreakdown: {
    sources: 'DfE EES regional KS4/absence splits; EPI regional gap analysis',
    latency: 'Annual, published with the national release',
    gaps: 'Regional NEET relies on a small survey with wide confidence intervals; LA disadvantage definitions vary; a child who moves region vanishes from the series',
    better: 'LA-level outcome series on consistent definitions + destination measures that follow the child across a move',
    eli5: 'Regional school results are solid, but regional NEET numbers come from a small survey and wobble a lot — and a child who moves region just disappears from one column and reappears in another.',
  },
  pisaComparators: {
    sources: 'OECD PISA (3-year cycle; 2022 is the latest); Education at a Glance spend tables',
    latency: 'Three-year test cycle, published ~18 months after sitting; the England-specific report later still',
    gaps: 'Headline scores are UK-wide, masking England; England’s 2022 school response rate fell below PISA standards; no equity measure exists between cycles',
    better: 'Between-cycle national equity sampling tied to the PISA scales, so fairness isn’t a once-every-three-years number',
    eli5: 'The international scoreboard updates every three years and mixes England in with the rest of the UK. Between rounds, England has no comparable fairness measure at all.',
  },
  neetComposition: {
    sources: 'ONS Labour Force Survey NEET bulletin (quarterly) with inactivity-reason splits',
    latency: 'Quarterly, ~6 weeks after quarter end — carrying ONS volatility warnings since 2023',
    gaps: 'Survey-based: the million-NEET headline has a wide confidence interval; reason-for-inactivity is self-reported; no published admin-data corroboration',
    better: 'An admin-data nowcast (HMRC RTI + UC + ILR) corroborating the survey split — IFS has shown admin data tracks NEET better than the survey',
    eli5: 'The million-NEET headline comes from a survey the ONS itself warns is wobbly. The tax and benefits systems could confirm the number almost in real time — nobody publishes that.',
  },
  cumulativeCost: {
    sources: 'DfE budgets / HMT estimates; IFS reconstruction',
    latency: 'Spending-review cycles; outturn a year+ later',
    gaps: 'Programme-level cost-effectiveness rarely evaluated against linked outcomes',
    better: 'Every major programme born with a LEO-linked evaluation plan and a published counterfactual',
    eli5: 'We know what programmes cost, but rarely link the spending to what happened to the actual children — even though the data to do it exists.',
  },
};
