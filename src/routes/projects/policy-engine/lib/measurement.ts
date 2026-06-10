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
  cumulativeCost: {
    sources: 'DfE budgets / HMT estimates; IFS reconstruction',
    latency: 'Spending-review cycles; outturn a year+ later',
    gaps: 'Programme-level cost-effectiveness rarely evaluated against linked outcomes',
    better: 'Every major programme born with a LEO-linked evaluation plan and a published counterfactual',
    eli5: 'We know what programmes cost, but rarely link the spending to what happened to the actual children — even though the data to do it exists.',
  },
};
