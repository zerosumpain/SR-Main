// regionsIntel.ts — the place-based intelligence layer for the Regions field study:
// exemplar places with evidenced impact, the London-effect decomposition, the
// Whitehall programme-churn record, and the place-data gaps. Research dossier
// compiled 2026-06-10; every claim carries a source URL and an evidence tier.
// Self-contained.

// ---------------------------------------------------------------------------
// Exemplar places — who has actually moved the needle, with honest evidence tiers
// ---------------------------------------------------------------------------
export type EvidenceTier = 'causal' | 'strong' | 'promising' | 'weak' | 'too-early';

export const TIER_META: Record<EvidenceTier, { label: string; eli5: string; colour: string }> = {
  causal:      { label: 'causal (comparator design)', eli5: 'properly proven',      colour: '#2f7d4f' },
  strong:      { label: 'strong descriptive',         eli5: 'well documented',      colour: '#3f7d6e' },
  promising:   { label: 'promising, no counterfactual', eli5: 'looks good, unproven', colour: '#b4632e' },
  weak:        { label: 'weak / anecdotal',           eli5: 'mostly a good story',  colour: '#b1455e' },
  'too-early': { label: 'too early to judge',         eli5: 'too soon to tell',     colour: '#7a5aa6' },
};

export interface Exemplar {
  place: string;
  who: string;            // the actor (LA / charity / mayor / borough)
  when: string;
  tier: EvidenceTier;
  what: string;           // what they did
  result: string;         // the measurable result (numbers)
  lesson: string;         // the transferable lesson
  caveat?: string;        // the honest catch
  url: string;
}

export const EXEMPLARS: Exemplar[] = [
  {
    place: 'Newham (& Durham)', who: 'LA pilot with DfE evaluation', when: '2009–today', tier: 'causal',
    what: 'Universal free school meals for every primary pupil — piloted with comparator areas, then continued unilaterally as “Eat for Free” since 2011.',
    result: '~2 months’ additional progress over two years at KS1/KS2, concentrated among poorer pupils; take-up >90% vs 45% pre-scheme (DfE pilot evaluation, DFE-RR227).',
    lesson: 'The single cleanest causal result in the whole place space came from a universal, boring entitlement with a proper evaluation design — not a multi-strand “challenge” programme.',
    url: 'https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/184047/DFE-RR227.pdf',
  },
  {
    place: 'Tower Hamlets', who: 'Local authority (+ London Challenge)', when: '1998–2013', tier: 'strong',
    what: 'From Ofsted’s worst LA in England (1998) to above-national GCSE results by 2013, while remaining one of the poorest boroughs: aggressive teacher recruitment and retention (housing support, local QTS routes), data-driven school support, community engagement, fifteen years of stable leadership.',
    result: 'By 2013 every maintained secondary good/outstanding; FSM gap ~7pp against a national ~23pp.',
    lesson: 'The strongest LA turnaround on record was leadership + teacher supply + data, sustained for 15 years — not a programme.',
    caveat: 'No counterfactual; rode the wider London improvement; ~60% more funding per pupil than the national average.',
    url: 'https://files.eric.ed.gov/fulltext/ED565743.pdf',
  },
  {
    place: 'Hackney', who: 'The Learning Trust (outsourced LA function)', when: '2002–2012', tier: 'strong',
    what: 'The entire education function handed to a not-for-profit with a ten-year mandate and one leader throughout, after the council was branded the country’s worst.',
    result: 'English & maths GCSE measures up 27pp over 2007–11 vs 9pp nationally; by 2012, 98% of primary and 100% of secondary pupils in good/outstanding schools.',
    lesson: 'A single accountable body with a decade-long mandate — the structural opposite of programme churn.',
    caveat: 'Gentrification changed the intake over the same period; descriptive evidence only.',
    url: 'https://education.hackney.gov.uk/sites/default/files/document/10%20Years%20in%20Hackney.pdf',
  },
  {
    place: 'North Birkenhead', who: 'Right to Succeed + Wirral Council + funders', when: '2021–today', tier: 'promising',
    what: '“Cradle to Career”: community-led collective impact across one neighbourhood — early years, every school, and the care system together, on a ten-year horizon with philanthropic patient capital.',
    result: 'University of Manchester evaluation (Feb 2026): a 15-month reading-age gap closed across 8–16-year-olds; attendance up against the national post-pandemic decline; care entries down from 7–8/week to 7–8/year. Now replicating in Halton and Knowsley.',
    lesson: 'England’s closest analogue to the Harlem Children’s Zone — hyper-local, all settings, ten years. The most-quantified UK cradle-to-career result so far.',
    caveat: 'Before/after design, charity-communicated headline figures, no published counterfactual — and the US evidence says HCZ’s gains came from its schools more than its wraparound.',
    url: 'https://righttosucceed.org.uk/impact/cradle-to-career-nb-progress-report/',
  },
  {
    place: 'Doncaster', who: 'Opportunity Area partnership (2017–22 + legacy)', when: '2017–today', tier: 'promising',
    what: 'Same national programme as everywhere else — but Doncaster kept the partnership alive after funding ended (“One Doncaster”, a skills strategy adopted by the city region).',
    result: 'The biggest Progress 8 gain of any Opportunity Area, 2016→2024 (−0.19 → +0.03) and KS2 expected-standard up 6.0pp — while Hastings and West Somerset, on the same programme, went backwards (FFT).',
    lesson: 'Identical national programmes produce opposite trajectories — local system capacity and continuity look decisive, not the programme.',
    url: 'https://ffteducationdatalab.org.uk/2025/05/what-happened-to-opportunity-areas/',
  },
  {
    place: 'Blackpool', who: 'Opportunity Area + Right to Succeed literacy programme', when: '2017–today', tier: 'weak',
    what: 'KS3 literacy across 7 secondaries + the PRU with assessment tracking of ~3,000 students, inside an Opportunity Area.',
    result: 'Real project-level gains (one school: nearly half a GCSE grade of reading progress in a year) — while Blackpool’s AREA statistics worsened: Progress 8 fell −0.35 → −0.93 (2016–24) and its 16-year-old disadvantage gap is England’s largest at 27.9 months (EPI).',
    lesson: 'Programme gains and area decline coexist: pupil mobility and intake churn mean LA statistics can bury genuine cohort wins — the case for system intervention and mobility-adjusted measurement.',
    url: 'https://ffteducationdatalab.org.uk/2025/05/what-happened-to-opportunity-areas/',
  },
  {
    place: 'Greater Manchester', who: 'Mayoral combined authority', when: '2024–2030', tier: 'too-early',
    what: 'The MBacc — a seven-gateway technical-education framework reshaping post-16 demand toward GM’s labour market; first delivery year complete, government-backed for 2026, full operation targeted 2030.',
    result: '800 extra T Level placements brokered in year one. No attainment outcomes yet — a pathways and governance play, exercised through convening and skills money (mayors hold no statutory school powers).',
    lesson: 'What a mayor can actually do: shape demand and post-16 routes, not schools. Watch the destinations data from 2027.',
    url: 'https://www.greatermanchester-ca.gov.uk/what-we-do/work-and-skills/technical-education-city-region/the-greater-manchester-baccalaureate-mbacc/',
  },
  {
    place: 'North East', who: 'NECA (mayoral) Child Poverty Reduction Unit', when: '2024–today', tier: 'too-early',
    what: 'The country’s first mayoral Child Poverty Reduction Unit: £1.4m across 220 schools (school-gate financial advice, cost-of-school-day cuts, free after-school clubs, literacy programmes), then a £28.6m Child Poverty Action Plan (July 2025).',
    result: 'Input stage — money committed and rolling out; no outcomes yet. Operates entirely upstream of the school system, on the poverty channel the engine models as the slow tide.',
    lesson: 'A second model of mayoral action: target the upstream determinant (poverty) rather than the school system you don’t control.',
    url: 'https://www.northeast-ca.gov.uk/child-poverty-reduction-unit',
  },
];

// ---------------------------------------------------------------------------
// The London effect, decomposed — the contested core, honestly stated
// ---------------------------------------------------------------------------
export const LONDON_EFFECT = {
  // FFT decomposition of the 2013 London GCSE-progress advantage
  shares: [
    { key: 'context', label: 'Pupil context (ethnicity · EAL · FSM · mobility)', share: 0.67, colour: 'rgba(28,22,17,0.45)' },
    { key: 'residual', label: 'Genuine London residual (schools & system)', share: 0.33, colour: '#2f6f97' },
  ],
  research: 'Ofsted credited the London Challenge; Burgess (2014) countered that ethnic composition explains the entire effect; FFT’s decomposition settled it at roughly two-thirds pupil context, one-third genuine residual — and the gap-narrowing for disadvantaged pupils in inner London is the part hardest to explain away. The debate is “most vs all”, not “real vs fake”.',
  eli5: 'London’s schools got famously better. Some said brilliant programmes; some said it was really about which families live in London. The careful answer: about two-thirds was the families, a third was genuinely the schools — and poorer children gaining fastest is the bit that looks most real.',
};

// ---------------------------------------------------------------------------
// The Whitehall programme record — four waves, and what owns the space now
// ---------------------------------------------------------------------------
export interface Programme {
  name: string;
  owner: string;        // department / actor
  start: number; end: number | null;  // null = ongoing/announced
  budget: string;
  status: string;       // the one-line verdict
  evaluated: 'counterfactual' | 'process-only' | 'none' | 'pending';
  colour: string;
}

export const PROGRAMMES: Programme[] = [
  { name: 'London / City Challenges', owner: 'DfE', start: 2003, end: 2011, budget: '~£80m (London)', colour: '#2f6f97',
    status: 'The template every successor invokes; positive DfE evaluation of mechanisms, no counterfactual.', evaluated: 'process-only' },
  { name: 'Opportunity Areas (12)', owner: 'DfE', start: 2017, end: 2022, budget: '~£108m', colour: '#b4632e',
    status: 'Process evaluations only; FFT’s 2025 retrospective: half improved, half declined on Progress 8.', evaluated: 'process-only' },
  { name: 'Opportunity North East', owner: 'DfE', start: 2018, end: 2021, budget: '£24m', colour: '#9a7b1f',
    status: 'No robust outcome evaluation; criticised as a gimmick at launch.', evaluated: 'none' },
  { name: 'Towns Fund / Levelling Up Fund', owner: 'MHCLG', start: 2019, end: 2025, budget: '£3.6bn + £4.8bn', colour: '#7a5aa6',
    status: 'NAO: launched with a poor understanding of what worked in previous local-growth funds; councils bid into “hundreds” of pots.', evaluated: 'none' },
  { name: 'EIAs / Priority EIAs', owner: 'DfE', start: 2022, end: 2025, budget: '£42m (PEIA local funds)', colour: '#b1455e',
    status: 'Wound down March 2025 — “no longer a priority”; guidance page withdrawn.', evaluated: 'none' },
  { name: 'Youth Guarantee trailblazers (8 areas)', owner: 'DWP + mayors', start: 2025, end: null, budget: '£45m + £45m', colour: '#566a8c',
    status: 'Live; a national evaluation is funded this time — the exception that proves the rule.', evaluated: 'pending' },
  { name: 'Best Start Family Hubs', owner: 'DfE/DHSC', start: 2025, end: null, budget: '£500m+', colour: '#3f7d6e',
    status: 'Every LA by April 2026; 70% of hubs aimed at the 30% most-deprived neighbourhoods.', evaluated: 'pending' },
  { name: 'Plan for Neighbourhoods (75 places)', owner: 'MHCLG', start: 2026, end: null, budget: '£1.5bn / 10yrs', colour: '#7a5aa6',
    status: 'Regeneration-first with education among the themes; delivery funding from April 2026.', evaluated: 'pending' },
  { name: 'Missions North East & Coastal', owner: 'DfE (RISE)', start: 2026, end: null, budget: 'unpublished', colour: '#9a3b2e',
    status: 'Launch Sept 2026, modelled on London Challenge. Hastings is now a THIRD-time target (OA → PEIA → Mission) with Progress 8 at −1.09.', evaluated: 'pending' },
];

export const CHURN_FACTS = {
  research: 'The Institute for Government counted 28 major FE/skills acts in 30 years and 48 secretaries of state; the NAO found MHCLG launched £7bn+ of new place funds with a poor understanding of what previous ones achieved. No English place-based education programme has ever had a counterfactual outcome evaluation — and the fourth wave launches in September 2026 on the same footing.',
  eli5: 'Governments keep launching new “fix this place” schemes before finding out whether the last one worked — four waves of them since 2003, and not one has been tested against what would have happened anyway.',
};

// who holds which place lever (the compact ownership readout)
export const PLACE_OWNERS: { owner: string; holds: string; gap?: string; colour: string }[] = [
  { owner: 'DfE', holds: 'Schools, school improvement (RISE), the missions, family hubs, 16–19 funding', colour: '#2f6f97' },
  { owner: 'MHCLG', holds: 'Regeneration money (Plan for Neighbourhoods), the deprivation index itself', gap: 'Education is one theme among many in regeneration-first funds', colour: '#7a5aa6' },
  { owner: 'DWP', holds: 'Youth Guarantee trailblazers, employment support devolution', colour: '#566a8c' },
  { owner: 'Mayors / MCAs', holds: 'Adult skills fund, bootcamps, careers hubs, post-16 convening', gap: 'NO statutory powers over schools — MBacc/NECA work through soft power and skills money', colour: '#b4632e' },
  { owner: 'Local authorities', holds: 'Statutory education functions, SEND, admissions (maintained), the strongest evidenced turnarounds', gap: 'Two decades of capacity erosion since Tower Hamlets/Hackney built theirs', colour: '#3f7d6e' },
];

// ---------------------------------------------------------------------------
// The place-intelligence gaps — what data would tell us what works
// ---------------------------------------------------------------------------
export const PLACE_GAPS: { gap: string; detail: string; eli5: string }[] = [
  {
    gap: 'No counterfactual, ever',
    detail: 'Opportunity Areas got process evaluations only; FFT had to reconstruct outcomes itself in 2025 and explicitly could not infer causality. The missions launch on the same evaluation footing.',
    eli5: 'No “fix this place” scheme has ever been compared against what would have happened without it.',
  },
  {
    gap: 'Pupil mobility corrupts LA accountability',
    detail: 'The cohort measured at 16 is not the cohort invested in at 5 — coastal and urban churn means LA trend statistics can bury genuine programme gains (the Blackpool pattern). No routine statistic adjusts for it.',
    eli5: 'Families move. The teenagers a town is judged on often aren’t the children it spent money on — and nobody corrects the numbers for that.',
  },
  {
    gap: 'Benchmarking stops at school level',
    detail: 'DfE’s similar-schools attendance tool compares every school to its 20 statistical twins with a published ML methodology. The LA-level equivalent is the ageing “statistical neighbours” concept in LAIT — nothing like it in sophistication. A similar-LAs tool is a concrete, buildable product.',
    eli5: 'Every school gets compared to its 20 most-similar schools automatically. Councils get nothing equivalent.',
  },
  {
    gap: 'LEO is never published by place',
    detail: 'The earnings linkage could answer “what did growing up in Blackpool do to age-30 earnings” — but published LEO outputs are institution- and subject-focused. Place-level life-outcome readouts exist only in principle, behind research access.',
    eli5: 'The government can already link school records to adult pay. It never publishes that by town — so no place knows its long-run return.',
  },
  {
    gap: 'The deprivation index is stale',
    detail: 'The IMD — the targeting basis for most place funds — was last updated in 2019. Seven-year-old deprivation data is allocating 2026 money.',
    eli5: 'The official map of deprived areas is seven years old, and it still decides where the money goes.',
  },
];

export const PLACE_TAKEAWAY = {
  research: 'Three through-lines for a data strategist: the best-evidenced place wins were LA-led, decade-long and boring (teacher supply, universal entitlements, stable leadership); programme gains and area decline can coexist, so the measurement surface itself misleads; and the intelligence fixes are specific and buildable — counterfactual-by-design missions, mobility-adjusted accountability, a similar-LAs benchmarking tool, and place-level LEO readouts.',
  eli5: 'What actually worked was patient and boring: good teachers, free school meals, the same leaders for a decade. The flashy area schemes were never properly tested. And the fixes are knowable: test the new schemes properly, correct the numbers for families moving, and give every council the comparison tools schools already get.',
};
