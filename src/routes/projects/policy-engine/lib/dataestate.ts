// dataestate.ts — the NEET-relevant slice of the education data estate, triaged:
// what exists and is proven, what exists but is underused, and what is missing.
// Each node carries its latency, access route and the strategic gap. Self-contained.

export type EstateTier = 'proven' | 'underused' | 'missing';
export type EstateStage = 'pre16' | 'transition' | 'post18';

export interface EstateNode {
  id: string;
  name: string;
  tier: EstateTier;
  stage: EstateStage;
  latency: string;       // how stale the data is when usable
  access: string;        // who can touch it, via what route
  blurb: string;         // what it is + why it matters (research register)
  blurbEli5: string;
  gap?: string;          // the strategic gap line (shown emphasised)
  links: string[];       // ids of nodes it links to TODAY
}

export const ESTATE: EstateNode[] = [
  // ---------------- pre-16 ----------------
  {
    id: 'census', name: 'School census / NPD', tier: 'proven', stage: 'pre16',
    latency: 'Termly collection; analytical extracts months later',
    access: 'DfE internal; researchers via ONS SRS accreditation',
    blurb: 'The backbone: child-level demographics, FSM, SEND, absence and exclusions for every state pupil, feeding the National Pupil Database back to 2002.',
    blurbEli5: 'The big register: every state-school pupil’s basic details, free-school-meal status, special needs and absence, collected each term.',
    links: ['attainment', 'leo', 'echild', 'datafirst', 'attendance'],
  },
  {
    id: 'attendance', name: 'Daily attendance feed', tier: 'proven', stage: 'pre16',
    latency: 'Near-real-time — session-level codes extracted from school MIS daily',
    access: 'DfE + school-facing dashboards; mandatory since Sept 2024',
    blurb: 'The genuinely new asset: daily session-level attendance from ~all state schools via the Wonde pipe. DfE already runs ML on it (similar-schools benchmarking) — at SCHOOL level only.',
    blurbEli5: 'Since 2024 the government sees every school’s attendance every day — but uses it to compare schools, not to spot individual children drifting.',
    gap: 'Never used for individual in-year early warning — the single highest-value unused signal for NEET risk.',
    links: ['census'],
  },
  {
    id: 'attainment', name: 'Attainment (KS2/KS4)', tier: 'proven', stage: 'pre16',
    latency: 'Annual, published ~6 months after exams',
    access: 'Public aggregates; pupil-level in NPD via SRS',
    blurb: 'KS2 and KS4 results — with absence and EHCP status, the strongest NEET predictors in DfE’s own May-2026 risk-factor analysis, visible YEARS before 16.',
    blurbEli5: 'Test and GCSE results. Together with absence, these predict most future NEET cases years in advance.',
    links: ['census', 'leo', 'destinations'],
  },
  // ---------------- 16–18 transition ----------------
  {
    id: 'nccis', name: 'NCCIS / CCIS (LA tracking)', tier: 'proven', stage: 'transition',
    latency: 'Monthly LA returns; annual statistics',
    access: 'LAs (statutory duty); DfE aggregates',
    blurb: 'The statutory tracking system: every LA must track 16–17-year-olds’ activity (to 25 with an EHCP) and run the September Guarantee. Since Jan 2025 it also generates the national RONI at-risk lists.',
    blurbEli5: 'Councils must keep track of what every 16–17-year-old is doing — the system that’s meant to catch school-leavers before they drift.',
    gap: 'The duty to track 18-year-olds was dropped in 2016 — the system goes dark exactly where NEET peaks. And “activity not known” rates vary so wildly between LAs that local comparisons are unsafe.',
    links: ['destinations'],
  },
  {
    id: 'ilr', name: 'ILR (FE & apprenticeships)', tier: 'proven', stage: 'transition',
    latency: 'Periodic in-year returns; no daily signal',
    access: 'DfE/ESFA; researchers via SRS',
    blurb: 'Individualised learner records for colleges and apprenticeships, keyed on the Unique Learner Number. Solid for funding; too slow for early warning.',
    blurbEli5: 'The college version of the school register — who’s enrolled where, updated a few times a year.',
    links: ['census', 'leo', 'destinations'],
  },
  {
    id: 'destinations', name: 'Destination measures', tier: 'underused', stage: 'transition',
    latency: '~15 months in arrears',
    access: 'Published at school/college level',
    blurb: 'NPD↔ILR↔HESA matched “sustained destination” measures after KS4/KS5 — an accountability instrument, not an operational one.',
    blurbEli5: 'Where each school’s leavers ended up — published more than a year later, long after anyone could act on it.',
    gap: 'Too late to act on by design; the operational version of this measure simply does not exist.',
    links: ['nccis', 'ilr', 'attainment'],
  },
  {
    id: 'post16rt', name: 'Post-16 real-time signal', tier: 'missing', stage: 'transition',
    latency: '—',
    access: '—',
    blurb: 'No FE/training equivalent of the daily attendance feed exists. The riskiest transition — the summer after Year 11 into the autumn term — is observed only retrospectively.',
    blurbEli5: 'Schools report attendance daily; colleges don’t. So the most dangerous moment — the summer after GCSEs — is invisible until months later.',
    gap: 'The missing pipe: daily/weekly participation signal for 16–18s in FE and training.',
    links: [],
  },
  // ---------------- 18–24 ----------------
  {
    id: 'leo', name: 'LEO (earnings linkage)', tier: 'underused', stage: 'post18',
    latency: 'Years (tax-year cycles)',
    access: 'Accredited researchers via ONS SRS / ADR UK',
    blurb: 'NPD + FE + HE linked to HMRC earnings and DWP benefits for ~38m people — proof that cross-department linkage works at population scale. Used heavily for HE league tables; barely for NEET pathways.',
    blurbEli5: 'The government already links school records to adult tax records for 38 million people — mostly used to rank universities, not to help NEETs.',
    gap: 'LEO could validate any NEET risk index against real 5-year outcomes. Nobody has published that.',
    links: ['census', 'ilr', 'attainment'],
  },
  {
    id: 'echild', name: 'ECHILD (NHS linkage)', tier: 'underused', stage: 'post18',
    latency: '~2 years; research-only',
    access: 'UCL-led research environment in ONS SRS',
    blurb: 'NPD linked to Hospital Episode Statistics and children’s social care for ~14.7m 0–24s. Already shows what health linkage buys: 32% persistent absence among children with mental-health presentations.',
    blurbEli5: 'A research project that joins school and hospital records — proving health problems and school absence travel together — but no council can use it day-to-day.',
    gap: 'Proves the value of health↔education linkage; no operational flow into LA risk lists exists. The CWS Act single-unique-identifier pilot may finally unlock one.',
    links: ['census'],
  },
  {
    id: 'datafirst', name: 'Data First (MoJ linkage)', tier: 'underused', stage: 'post18',
    latency: 'Research-only',
    access: 'Accredited researchers via SRS / ADR UK',
    blurb: 'Courts, prison and probation records linked to NPD and children’s social care — youth-justice↔education linkage exists, in a research enclave.',
    blurbEli5: 'Criminal-justice records are already joined to school records — but only researchers can look.',
    links: ['census'],
  },
  {
    id: 'track18', name: 'Tracking at 18+', tier: 'missing', stage: 'post18',
    latency: '—',
    access: '—',
    blurb: 'No statutory duty to track young people past 18 (dropped 2016). NEET concentrates at 18–24 (16.0% vs 4.0% at 16–17) precisely where no institution is responsible for knowing.',
    blurbEli5: 'Once someone turns 18, no one is officially responsible for knowing whether they’re in work or education — and that’s exactly when most become NEET.',
    gap: 'The age-18 dark zone: responsibility is relinquished without anyone picking it up.',
    links: [],
  },
  {
    id: 'health2roni', name: 'Health → risk-list flow', tier: 'missing', stage: 'post18',
    latency: '—',
    access: '—',
    blurb: 'Mental health drives the fastest-growing NEET segment, yet nothing flows from NHS/CAMHS into LA early-warning lists — DfE’s own data-sharing guidance omits integrated care boards entirely.',
    blurbEli5: 'The fastest-growing reason young people drop out is poor mental health — and the health system shares none of that signal with the people running early-warning lists.',
    gap: 'The biggest blind spot, given 28%+ of NEETs are health-inactive.',
    links: [],
  },
];

export const STAGE_META: Record<EstateStage, { label: string; eli5: string }> = {
  pre16: { label: 'Pre-16 (school)', eli5: 'At school' },
  transition: { label: '16–18 (the transition)', eli5: 'Leaving school' },
  post18: { label: '18–24 (the dark zone)', eli5: 'After 18' },
};

export const TIER_META: Record<EstateTier, { label: string; eli5: string; colour: string }> = {
  proven: { label: 'exists & proven', eli5: 'works today', colour: '#2f7d4f' },
  underused: { label: 'exists, underused', eli5: 'exists but wasted', colour: '#b4632e' },
  missing: { label: 'missing', eli5: 'doesn’t exist', colour: '#b1455e' },
};

export const ESTATE_BY_ID: Record<string, EstateNode> = Object.fromEntries(ESTATE.map((n) => [n.id, n]));
