// sendIntel.ts — Field Study №7: SEND — the £12bn blind spot. The fiscal cliff
// (deficits, the override, the Feb 2026 stability grant) and the information
// crisis underneath it (nine years of child-invisible SEN2, 153 EHCP templates,
// the cancelled digital record, the evidence vacuum on placements). Research
// dossier compiled 2026-06-10; VERIFIED/FLAGGED status preserved — flagged
// figures are labelled in the copy. Self-contained.

export interface Ref { label: string; url: string }

// ---------------------------------------------------------------------------
// 1 · The headline
// ---------------------------------------------------------------------------
export const SEND_HERO = {
  big: '99%',
  label: 'of SEND tribunal appeals decided in 2024–25 were found in the families’ favour — roughly 25,000 appeals registered, up from ~7,000 in 2018–19 — against a system that allocated an estimated £165m of public money to defending them (an advocacy-sector estimate; the 99% is from MoJ tribunal statistics).',
  labelEli5: 'When families challenge the council about their child’s special-needs support, the judges side with the family 99 times out of 100. Councils still spend a fortune fighting them.',
  kicker: {
    research: 'A 99% loss rate is not a litigation problem; it is a measurement instrument. The tribunal is the only feedback loop in the SEND system that works — and what it measures, at ruinous cost per reading, is that the system’s own demand data, provision data and outcome data are too weak for anyone to agree what a child needs without a judge. This study traces the money cliff everyone can see to the information failure underneath it.',
    eli5: 'When the referee rules against you 99 times out of 100, the problem isn’t the referee. The system fights families because it doesn’t have good enough information to agree with them earlier — and that information gap is what this page is about.',
  },
  refs: [
    { label: 'MoJ — tribunal statistics quarterly (SEND)', url: 'https://www.gov.uk/government/collections/tribunals-statistics' },
    { label: 'Browne Jacobson — 2024/25 SEND tribunal data', url: 'https://www.brownejacobson.com/insights/send-tribunal-data-released' },
    { label: 'Special Needs Jungle — the £165m defence estimate', url: 'https://www.specialneedsjungle.com/55-rise-2024-send-tribunal-appeals-cost-families-incalculable/' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 2 · The demand curve (SEN2 series; endpoints verified in the 2025 release)
// ---------------------------------------------------------------------------
export const EHCP_SERIES: { year: number; plans: number }[] = [
  { year: 2015, plans: 240_183 },
  { year: 2016, plans: 256_315 },
  { year: 2017, plans: 287_290 },
  { year: 2018, plans: 319_819 },
  { year: 2019, plans: 354_000 },
  { year: 2020, plans: 390_109 },
  { year: 2021, plans: 430_697 },
  { year: 2022, plans: 473_255 },
  { year: 2023, plans: 517_049 },
  { year: 2024, plans: 576_474 },
  { year: 2025, plans: 638_745 },
];

export const DEMAND_STATS: { big: string; label: string; eli5: string }[] = [
  { big: '638,745', label: 'EHC plans at January 2025 — up 10.8% in one year, +166% since 2015 (SEN2)', eli5: 'Nearly 640,000 children now have a legal support plan — the number has more than doubled in ten years.' },
  { big: '97,747', label: 'new plans issued in 2024 (+15.8%), from 154,489 assessment requests (+11.8%) — demand is accelerating, not plateauing', eli5: 'Almost 100,000 new plans were written last year, and even more families asked.' },
  { big: '1 in 5', label: 'pupils now has identified SEN: 19.5% of all pupils (~1.7m), of whom 5.3% hold an EHCP — autism is the largest primary need (31.5% of plans); 43.8% of EHCP pupils are FSM-eligible vs 22.2% of all pupils', eli5: 'A fifth of all schoolchildren have special educational needs — and poorer children are twice as likely to hold a plan.' },
  { big: '46.4%', label: 'of new EHCPs issued within the statutory 20 weeks in 2024 — down from 50.3% in 2023; the Education Committee calls the wait-time postcode lottery a “SEND emergency”', eli5: 'Fewer than half of new plans arrive within the legal time limit — and it’s getting worse, not better.' },
];

// ---------------------------------------------------------------------------
// 3 · The tribunal machine
// ---------------------------------------------------------------------------
export const TRIBUNAL_SERIES: { year: string; appeals: number; favour: string }[] = [
  { year: '2018/19', appeals: 7_000, favour: '~9 in 10' },
  { year: '2023/24', appeals: 21_106, favour: '95%' },
  { year: '2024/25', appeals: 25_000, favour: '99%' },
];

export const TRIBUNAL_NOTE = {
  research: 'In placement disputes specifically, the LA’s preferred school was upheld in just 13% of decided appeals. Special Needs Jungle’s estimate — and it is an advocacy estimate, labelled as such — puts LA tribunal-defence allocations at £153m in 2023–24, plus £13.5m DfE payments to the courts service: more than £165m a year spent producing the same verdict. Of 11,157 appeals decided at hearing, 150 went the LA’s way.',
  eli5: 'Councils win almost never — about 1 case in 100 — yet the system still spends over £165m a year (campaigners’ estimate) on the fight. That money buys no new support for any child.',
};

// ---------------------------------------------------------------------------
// 4 · The money — the cliff, the override, the bailout
// ---------------------------------------------------------------------------
export const MONEY_STATS: { big: string; label: string; eli5: string }[] = [
  { big: '£10.7bn', label: 'high-needs funding in 2024–25 — +58% in real terms over a decade (NAO); the IFS puts total high-needs spending at ~£12bn and rising ~£3bn more by 2029 without reform', eli5: 'Spending on the highest-need children has risen by more than half in real terms — and is still climbing fast.' },
  { big: '£3.2–4.6bn', label: 'the cumulative DSG deficit — depending who you ask: LGA £3.15bn (Apr 2025), IFS >£3bn, CCN ~£4bn, NAO £4.6bn projected by March 2026. Nobody agrees on the number — itself a data-quality finding', eli5: 'Councils have built up billions in special-needs debt — and the official bodies can’t even agree how many billions.' },
  { big: '43%', label: 'of local authorities at risk of effective insolvency per the NAO; CCN modelled 26 of 38 county/large unitary councils at s.114 risk before 2027 — Hampshire’s deficit alone ~£312m', eli5: 'Without rescue, nearly half of councils could effectively go bust over this one budget line.' },
];

export const OVERRIDE_TIMELINE: { date: string; title: string; detail: string }[] = [
  { date: 'Nov 2020', title: 'The statutory override is created', detail: 'An accounting instrument parks DSG deficits in an “unusable reserve”, off council balance sheets. Originally to March 2023.' },
  { date: '2023 → Jun 2025', title: 'Extended, twice', detail: 'To March 2026, then — June 2025 — to the end of 2027–28, after CCN warned 18 councils would be “insolvent overnight” if it lapsed.' },
  { date: 'Feb 2026', title: 'The 90% bailout, with strings', detail: 'A High Needs Stability Grant extinguishes 90% of eligible deficits as at 31 March 2026 — conditional on an approved Local SEND reform plan; LAs fund the residual 10%. The note is silent on deficits accrued after March 2026.' },
  { date: '2028–29', title: 'The residual lands on successor councils', detail: 'Post-reorganisation authorities must meet what remains from their own resources. The cliff has been moved and shrunk — not removed.' },
];

// ---------------------------------------------------------------------------
// 5 · Placement economics
// ---------------------------------------------------------------------------
export const PLACE_COSTS: { setting: string; cost: number; note: string }[] = [
  { setting: 'Mainstream school (core funding)', cost: 8_000, note: 'indicative per-pupil core funding (IFS basis)' },
  { setting: 'State special school', cost: 23_900, note: 'NAO, 2024' },
  { setting: 'Independent special school', cost: 61_500, note: 'NAO, 2024 — some schools >£100k' },
];

export const PLACE_NOTE = {
  research: 'Council spend on independent and non-maintained special places doubled in five years — £1.1bn (2020–21) to £2.1bn (2024–25). More than 30% of independent special schools are private-equity-backed: 15 funds own 170 schools (19%) teaching ~9,000 children, five of the funds based offshore; one provider booked £34.8m profit in a single year. The white paper answers with national price bands capping fees, statutory SEND-specific standards, and a council say over new provision — “cracking down on providers who put profit before children”. The deeper question stands: a market this expensive grew because the state side could not supply places — the NAO found DfE does not know how many places mainstream settings even have.',
  eli5: 'Because there aren’t enough state places, councils buy private ones at £60k+ a year — and private investors, some offshore, are making millions from the shortage. The government now plans to cap the fees. But the shortage exists partly because nobody in government even knows how many places the state system has.',
  refs: [
    { label: 'NAO — SEND (Oct 2024): place costs, places unknown', url: 'https://www.nao.org.uk/wp-content/uploads/2024/10/support-for-children-and-young-people-with-special-educational-needs-summary.pdf' },
    { label: 'Schools Week — fee caps & the PE investigation', url: 'https://schoolsweek.co.uk/private-special-school-fees-capped-in-profit-before-children-crackdown/' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 6 · The information crisis — the thesis act
// ---------------------------------------------------------------------------
export const BLIND_SPOTS: { gap: string; detail: string; eli5: string; refs?: Ref[] }[] = [
  {
    gap: 'Nine years of child-invisible statutory data',
    detail: 'SEN2 — the statutory return about EHC plans — was an LA-level AGGREGATE until the 2023 collection. For the first nine years of the EHCP system, the Department could not see a single child in its own plan data, could not link plans to attainment or absence, and could not follow a child across an LA boundary. Person-level SEN2 has existed for three collections.',
    eli5: 'For nine years the government counted special-needs plans the way you’d count sheep — totals per council, no children. Only since 2023 can it see actual children in the data.',
    refs: [{ label: 'EES — SEN2 methodology (person-level from 2023)', url: 'https://explore-education-statistics.service.gov.uk/methodology/education-health-and-care-plans' }],
  },
  {
    gap: '153 local authorities, 153 templates',
    detail: 'Every LA uses its own EHCP format. The 2023 Improvement Plan promised a standardised, digitised EHCP by end-2024. A DfE FOI response confirms: “This work was never completed due to the change in government… We are no longer commissioning LAs on the EHCP standardised template” — the digital-EHCP team was paused in July 2025. The white paper now re-promises the same artefact as the digital Individual Support Plan. Built, cancelled, re-promised — the ContactPoint pattern, in miniature.',
    eli5: 'Every council writes plans in its own format. The government started fixing that, quietly cancelled it in 2025 — and has now promised to build it again under a new name.',
    refs: [
      { label: 'SNJ — the FOI: “never completed”', url: 'https://www.specialneedsjungle.com/digital-standardised-ehcps-ditched-labour-aiming-kill-statutory-send-provision/' },
      { label: 'DfE design history — the abandoned EHCP data standard', url: 'https://design.education.gov.uk/our-work/projects/education-health-care-plan' },
    ],
  },
  {
    gap: 'Nothing measures what is actually delivered',
    detail: 'No national collection records the provision a plan specifies versus what the child receives, therapy hours delivered, step-by-step assessment waits, or outcomes by placement type. The NAO found DfE does not know how many places are available in mainstream settings. ADHD has NO national waiting-list collection at all — the ~316,000-children-waiting figure is an estimate because the instrument doesn’t exist.',
    eli5: 'The state knows a plan was written. It doesn’t know whether the help in the plan ever arrived, how long each step took, or whether the placement worked. For ADHD, it doesn’t even count the queue.',
    refs: [
      { label: 'NAO — “financially unsustainable”, places unknown', url: 'https://www.nao.org.uk/press-releases/special-educational-needs-system-is-financially-unsustainable/' },
      { label: 'Children’s Commissioner — neurodevelopmental waits', url: 'https://www.childrenscommissioner.gov.uk/resource/waiting-times-for-assessment-and-support-for-autism-adhd-and-other-neurodevelopmental-conditions/' },
    ],
  },
  {
    gap: 'Identification is a postcode lottery the data can see',
    detail: 'Loughborough analysis: ~60% of LA-to-LA differences in SEND-system performance is explained by population characteristics — 40% is not. EPI (1.2m-pupil cohort): similar pupils were HALF as likely to be identified with SEND in academies as in other state schools, with up to tenfold LA variation for higher-level needs. The IFS reads the same variation as “differences in identification practices”. Need is roughly evenly spread; recognition is not.',
    eli5: 'Whether a child’s needs get recognised depends heavily on where they live and which school they attend — the differences are far bigger than any real difference between children.',
    refs: [
      { label: 'EPI — Identifying SEND (2021)', url: 'https://epi.org.uk/publications-and-research/identifying-send/' },
      { label: 'Loughborough — wealth, postcode and SEND', url: 'https://theconversation.com/how-wealth-and-postcode-affect-children-with-special-educational-needs-266320' },
    ],
  },
  {
    gap: 'The feedback loop is the inspectorate — and it reads red',
    detail: 'Of the 54 area SEND inspections in the first two years of the current Ofsted/CQC framework: 26% found widespread and/or systemic failings, 48% inconsistent, 26% positive. The only region with zero systemic-failure verdicts is the North East + Yorkshire & Humber; in the East Midlands, four of five inspected areas failed.',
    eli5: 'When inspectors check local special-needs systems, three-quarters come back “inconsistent” or “failing”. One region in the north passes; the East Midlands almost always fails.',
    refs: [{ label: 'Ofsted/CQC — area SEND outcomes (Dec 2024)', url: 'https://www.gov.uk/government/statistics/area-send-inspections-and-outcomes-in-england-as-at-31-december-2024/main-findings-area-send-inspections-and-outcomes-in-england-as-at-31-december-2024' }],
  },
];

// ---------------------------------------------------------------------------
// 7 · The evidence vacuum
// ---------------------------------------------------------------------------
export const VACUUM = {
  research: 'The deepest hole is the one the whole reform stands in: nobody knows which placements work. ECHILD — the NPD linked to hospital records, 14.7m children — finally makes the question answerable; its first major study (3.8m children born 2004–13, a PREPRINT, not yet peer-reviewed) found 30% received SEND provision by age 11, that provision tracked sex, disadvantage and school type as much as health, and no evidence that Year-1 SEND provision improved attainment or reduced hospitalisations (it did reduce unauthorised absence). The white paper meanwhile stakes its inclusion case on the claim that comparable SEND children in mainstream achieve half a grade higher than in special schools — a claim whose “comparable” is exactly what the missing data cannot yet establish. The NAO’s verdict on the decade: spending up 58% real, outcomes not improved, system “financially unsustainable”, and none of the 60 stakeholders it consulted believed current plans would fix it.',
  eli5: 'Here’s the uncomfortable truth: nobody knows whether special schools or mainstream schools produce better results for similar children — the data to check was never connected until now. The first big study (not yet fully reviewed) found early support didn’t obviously improve results. Yet the whole reform is betting on answers to questions the data can’t yet answer.',
  outcomes: [
    { big: '22% vs 72%', label: 'KS2 expected standard, SEN vs no-SEN pupils (2023/24) — the gap is wider than in 2015/16', eli5: 'At age 11, special-needs pupils reach the expected level a third as often.' },
    { big: '30.8% vs 72.3%', label: 'grade 4+ in English & maths at KS4, SEND vs non-SEND (2023/24)', eli5: 'At GCSE, fewer than a third pass both English and maths.' },
    { big: '12.5%', label: 'overall absence rate for EHCP pupils (9.2% SEN support, 5.4% no SEN); SEN pupils ~4× more likely to be severely absent — and an EHCP at 16 tops the government’s own NEET risk-factor ranking', eli5: 'Children with plans miss far more school — and are the single most likely group to end up out of work and education later.' },
  ],
  refs: [
    { label: 'ECHILD — the linked database', url: 'https://www.echild.ac.uk/' },
    { label: 'ECHILD primary-schools study (preprint)', url: 'https://www.medrxiv.org/content/10.1101/2025.08.31.25334778v1.full' },
    { label: 'Commons Library SN07020 — SEN outcome statistics', url: 'https://commonslibrary.parliament.uk/research-briefings/sn07020/' },
    { label: 'DWP — Young people and work (EHCP as top NEET predictor)', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report/young-people-and-work-interim-report' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 8 · The health-side queue
// ---------------------------------------------------------------------------
export const QUEUE_STATS: { big: string; label: string; eli5: string }[] = [
  { big: '137,977', label: 'children waiting for an autism assessment (March 2025), ~90% beyond the 13-week NICE standard; waits exceed 32 months in some areas', eli5: 'Nearly 140,000 children are queuing for an autism assessment — most far beyond the recommended wait.' },
  { big: '~316,000', label: 'children ESTIMATED waiting for ADHD assessment — an estimate because no national ADHD waiting-list collection exists', eli5: 'Perhaps 316,000 children wait for ADHD checks. Nobody knows exactly, because nobody officially counts.' },
  { big: '72,661', label: 'children waiting for speech & language therapy (Feb 2024); SLT vacancy rates run 17–21%; only a third of NHS SLTs say their service can usually provide what children need', eli5: 'Over 70,000 children wait for speech therapy, and a fifth of therapist posts are empty.' },
];

export const QUEUE_NOTE = {
  research: 'These queues are the upstream inputs to every EHCP — the Children’s Commissioner’s phrase: “every day a child waits for support could permanently alter their life course”. They belong to health, not DfE (the Jigsaw study maps why) — but the 20-week clock and the health waiting lists are one system experienced by one family, and no instrument joins them.',
  eli5: 'The school-side clock and the NHS-side queue are the same wait for the same child — but they’re counted by different departments that don’t add them up.',
};

// ---------------------------------------------------------------------------
// 9 · The reform on the table
// ---------------------------------------------------------------------------
export const REFORM = {
  research: 'The white paper (“Every Child Achieving and Thriving”, Feb 2026) keeps EHCPs for the most complex needs and introduces digital, statutory Individual Support Plans for the rest — early intervention without formal assessment, backed by £1.6bn of Inclusive Mainstream Fund, £1.8bn of in-school specialists, £3.7bn capital for ~60,000 specialist places and national price bands on independent fees. Transition is slow by design: no changes to EHCP-delivered support before September 2030, a “triple lock” on existing plans. The strategic readings from this study: (1) the ISP is the cancelled digital EHCP reborn — ship the DATA STANDARD with the statutory duty this time, or 153 formats become 153 formats twice over; (2) the early-intervention bet is being placed without the placement-outcomes evidence base — the consultation closed in May 2026 with the hardest empirical questions (the IFS’s phrase) still open; (3) every flagship comparator made the same wager and failed to measure it: the Netherlands’ 2014 funding reform was officially evaluated as “effects on pupils cannot be properly determined”; Portugal mainstreamed ~99% of disabled students with patchy outcome monitoring; Finland’s tiered model has never had a causal evaluation. The international lesson is not “inclusion works” or “inclusion fails” — it is that nobody wired the feedback loop, and England is about to decide whether to be the first.',
  eli5: 'The plan: most children get quicker, lighter-weight digital support plans, big money goes into mainstream schools, and private fees get capped. The catch: the new digital plan is the thing they cancelled last year under another name; the evidence on what actually works is missing; and the other countries that tried this never measured whether it worked. England could be the first to actually check.',
  refs: [
    { label: 'White paper — Every Child Achieving and Thriving', url: 'https://www.gov.uk/government/publications/every-child-achieving-and-thriving/every-child-achieving-and-thriving-html-version' },
    { label: 'DfE Education Hub — what changes for SEND', url: 'https://educationhub.blog.gov.uk/2026/02/schools-white-paper-what-parents-need-to-know-about-changes-to-the-send-system/' },
    { label: 'Netherlands — passend onderwijs evaluation', url: 'https://www.government.nl/topics/appropriate-education' },
    { label: 'Portugal — Decree-Law 54/2018', url: 'https://www.dge.mec.pt/sites/default/files/EEspecial/dl_54_2018_en_version_0.pdf' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 10 · What DfE should instrument — the data asks, concretely
// ---------------------------------------------------------------------------
export const SEND_ASKS: { ask: string; what: string; eli5: string }[] = [
  {
    ask: 'Ship the record standard with the ISP duty',
    what: 'The statutory digital ISP lands on every nursery, school and college. Publish the machine-readable record standard FIRST — fields, vocabularies, transfer rules — so the new artefact is one format, not 153. The cancelled 2023–25 digital-EHCP work is sitting in DfE’s own design history; finish it under its new name.',
    eli5: 'The new digital plans are coming anyway. Agree the single format before everyone builds their own — the homework is already half-done.',
  },
  {
    ask: 'Monthly pipeline, not annual snapshot',
    what: 'SEN2 counts plans each January. Demand shows up first in requests, assessments-in-progress and step-level waits — publish the pipeline monthly per LA, joined (anonymously) to the health-side autism/ADHD/SLT queues so one family’s one wait is finally one number.',
    eli5: 'Count the queue every month, not once a year — and add the NHS queue to the school queue, because the child is waiting in both.',
  },
  {
    ask: 'Make the placement-outcomes question answerable',
    what: 'ECHILD proves the linkage works at 14.7m-child scale. Commission the definitive placement-outcomes study (mainstream vs special, by need profile) on linked data BEFORE the September 2030 transition bites, with provision-delivered data collected through the ISP from day one. The white paper’s own half-a-grade claim deserves better evidence than it currently has.',
    eli5: 'Before moving children onto the new system, actually measure which kind of school works for which child — the database to do it finally exists.',
  },
];

export const SEND_CLOSER = {
  research: 'The Memo’s register already carries the SEND rows: monthly EHCP pipeline reporting, in-year high-needs spend visibility, and the record standard. This study is the case for moving them up the queue: the costliest, fastest-growing subsystem in English education is also its least instrumented — and a £10.7bn system whose only working feedback loop is a tribunal with a 99% reversal rate is not a money problem that data happens to make worse. It is an information problem that money has been failing to solve.',
  eli5: 'The most expensive part of the school system is also the one flying blindest. Until it can see — who’s waiting, what’s delivered, what works — more money will keep disappearing into the same fog.',
};
