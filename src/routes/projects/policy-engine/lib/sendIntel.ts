// sendIntel.ts — Field Study №7: SEND — the £12bn system and its evidence base.
// A neutral, analytical assessment of the England SEND machinery: the EHC
// needs-assessment pipeline as a stock-and-flow, what the tribunal's "99%" and
// the "2.5% appeal rate" each actually measure, the high-needs funding mechanics
// (DSG block, Elements 1/2/3, the statutory override extended to March 2028,
// Safety Valve / DBV → the High Needs Stability Grant), Alternative Provision,
// post-16/19–25 transition, the Educational Psychologist shortage, the evidence
// vacuum on placements, and the three-camp disagreement on the cost driver.
// Register: neutral / analytical / apolitical — evaluative verdicts are kept
// only with explicit attribution. Research dossier compiled 2026-06-10; figures
// current to the SEN2 2024-calendar-year release (Jan-2025 census), 2024/25
// tribunal statistics, NAO 2024, Isos 2025, IFS 2024/2025. Self-contained.

export interface Ref { label: string; url: string }

// ---------------------------------------------------------------------------
// 1 · The headline — stated precisely (see §3 for the denominator unpacking)
// ---------------------------------------------------------------------------
export const SEND_HERO = {
  big: '99%',
  label: 'of SEND tribunal appeals that reached a contested hearing in 2024–25 were decided in the families’ favour — but this measures only the minority of decisions that are appealed and defended to a hearing. Around 25,000 appeals were registered, up from ~7,000 in 2018–19. The separate, official "appeal rate" is ~2.5% of all appealable decisions. Both figures are accurate; they answer different questions (unpacked below).',
  labelEli5: 'When families take a council to the special-needs tribunal and the case is actually heard, the judges side with the family about 99 times in 100. But only a small share of all decisions ever get appealed in the first place — so two very different numbers are both true.',
  kicker: {
    research: 'A 99% reversal rate at hearing is best read as a measurement signal rather than a litigation result. The tribunal is the SEND system’s most consistently functioning feedback loop, and what it records is that the system’s demand data, provision data and outcome data are too weak for a local authority and a family to converge on what a child needs without an external panel. This study traces the funding pressure that is widely reported to the data gaps underneath it — and states each evaluative verdict with the source that issued it.',
    eli5: 'A near-total reversal rate at hearing is less about the tribunal and more about the information feeding into it. The system ends up in front of a panel because it doesn’t hold good enough data to agree with families earlier — and that data gap is what this page examines.',
  },
  refs: [
    { label: 'MoJ — Tribunal Statistics Quarterly (SEND)', url: 'https://www.gov.uk/government/collections/tribunals-statistics' },
    { label: 'BERA — what the SEND appeal rate measures', url: 'https://www.bera.ac.uk/blog/the-english-send-tribunal-appeal-rate-moving-the-goalposts-to-sustainability' },
    { label: 'Special Needs Jungle — 2023/24 tribunal breakdown', url: 'https://www.specialneedsjungle.com/55-rise-2024-send-tribunal-appeals-cost-families-incalculable/' },
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
  { big: '638,745', label: 'EHC plans in force at January 2025 — up 10.8% in one year, +166% since 2015 (SEN2). The NAO records a ~140% rise to 576,000 between 2015 and 2024; IFS records the school-age EHCP population up ~71% over 2018–2024 (DfE/EES; NAO 2024; IFS 2024).', eli5: 'Nearly 640,000 children now have a legal support plan — the number has more than doubled in ten years.' },
  { big: '97,747', label: 'new plans issued in 2024 (+15.8% — the fastest annual rise in the series), from 154,489 assessment requests (+11.8%). Inflow grew faster than the stock: demand is accelerating rather than plateauing (DfE/EES).', eli5: 'Almost 100,000 new plans were written last year, and even more families asked.' },
  { big: '1 in 5', label: 'pupils now has identified SEN: 19.5% of all pupils (~1.7m), of whom 5.3% hold an EHCP — autism is the largest primary need (31.5% of plans); 43.8% of EHCP pupils are FSM-eligible vs 22.2% of all pupils, so disadvantage is over-represented among plan-holders (DfE/EES).', eli5: 'A fifth of all schoolchildren have special educational needs — and poorer children are about twice as likely to hold a plan.' },
  { big: '46.4%', label: 'of new EHCPs issued within the statutory 20 weeks in 2024 — down from 50.3% in 2023; more than half therefore breach the deadline. The Commons Education Committee has used the term "SEND emergency" for the wait-time variation; the 2025-calendar-year figure is not yet published (DfE/EES; NAO 2024).', eli5: 'Fewer than half of new plans arrive within the legal time limit — and the share is falling, not rising.' },
];

// ---------------------------------------------------------------------------
// 2b · The EHC needs-assessment pipeline as a stock-and-flow (NEW)
// Statutory path: request → decision to assess (6 wks) → assessment →
// decision to issue → final plan, on a 20-week deadline. Figures: 2024 calendar
// year flows; in-force stock at Jan-2025 census. DfE/EES SEN2 release.
// ---------------------------------------------------------------------------
export interface PipelineStage {
  id: string;
  label: string;
  value: number;        // headline count for this stage (people/plans)
  unit: string;         // e.g. 'requests', 'plans'
  pct?: string;         // conversion at this stage, as published
  detail: string;       // research register
  eli5: string;         // plain register
}

export const PIPELINE_INTRO = {
  research: 'The statutory pipeline (Children and Families Act 2014; SEND Code of Practice) runs request → decision to assess (6-week point) → assessment → decision to issue → final plan, with a 20-week deadline from request to final plan. Reading it as a stock-and-flow makes two things legible that the headline counts hide: where cases are refused (the upstream dispute points that drive the refusal-to-assess and refusal-to-issue appeals in §3), and how the in-year flow (97,747 new plans) sits against the standing stock (638,745 in force). Flows are 2024-calendar-year; the in-force stock is the January-2025 census.',
  eli5: 'A plan isn’t a single event — it’s a conveyor belt: a request, a yes/no on assessing, the assessment itself, a yes/no on issuing, then the plan. Watching the belt shows where families get a "no" (the points they then appeal) and how the new plans each year add to the much larger pile already in force.',
  refs: [
    { label: 'DfE/EES — EHC plans: England 2025 (SEN2, 2024 calendar year)', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/education-health-and-care-plans/2025' },
  ] as Ref[],
};

// The funnel exhibit: ordered stages, each with a published conversion.
export const PIPELINE: PipelineStage[] = [
  {
    id: 'requests', label: 'Requests received', value: 154_489, unit: 'requests', pct: '100%',
    detail: '154,489 initial requests for an EHC needs assessment in 2024, +11.8% on 2023 (138,289) — the entry point to the statutory process (DfE/EES).',
    eli5: '154,489 families asked for an assessment in 2024 — about 12% more than the year before.',
  },
  {
    id: 'assess', label: 'Decision: proceed to assess', value: 101_009, unit: 'proceed', pct: '65.4% proceed · 25.5% refused',
    detail: 'Of decided requests, 65.4% proceeded to assessment (101,009) and 25.5% were refused (39,395); ~1.6% withdrawn. Refusal-to-assess is roughly a quarter of requests — the first upstream dispute point, and the decision type with a ~15% appeal rate (§3).',
    eli5: 'Councils said yes to assessing about two-thirds of requests and "no" to a quarter. That "no" is one of the points families most often appeal.',
  },
  {
    id: 'plan', label: 'Assessment → plan issued', value: 98_519, unit: 'plans', pct: '93.6% of assessments → a plan',
    detail: 'Of 105,340 assessments concluded, 93.6% resulted in a plan being issued (98,519) and 6.1% did not (6,425). A refusal-to-issue after assessment is the second upstream dispute point — the decision type with a ~25% appeal rate (§3).',
    eli5: 'Once a child is assessed, almost all (94%) get a plan. The small share refused at this late stage is the decision families appeal most often of all.',
  },
  {
    id: 'new', label: 'New plans issued (2024)', value: 97_747, unit: 'new plans', pct: '+15.8% YoY',
    detail: '97,747 new EHCPs issued in 2024, +15.8% on 2023 (84,447) — the fastest annual rise in the series. This is the in-year flow that feeds the standing stock below (DfE/EES).',
    eli5: '97,747 brand-new plans were written in 2024 — the biggest one-year jump on record.',
  },
  {
    id: 'stock', label: 'Plans in force (Jan 2025)', value: 638_745, unit: 'in force', pct: '+10.8% YoY',
    detail: '638,745 EHC plans in force at the January-2025 census, +10.8% on January 2024 (576,474). The stock is ~6.5× the annual new-plan flow, so it accumulates faster than any single year’s timeliness figure suggests (DfE/EES).',
    eli5: 'In total, 638,745 children hold a plan — far more than are added in any one year, because plans last for years.',
  },
];

// A separate timeliness/back-of-pipeline note (the 20-week clock + annual reviews).
export const PIPELINE_NOTE = {
  research: 'Timeliness has slipped: 46.4% of new plans were issued within 20 weeks in 2024, down from 50.3% in 2023 (this basis excludes statutory exceptions; the including-exceptions basis is lower). At the back of the pipeline, annual reviews were expected for ~82% of active plans (≈524,700 in 2024); ~86.5% were recorded completed, with ~21.6% pending at year-end — a process the qualitative literature describes as functioning unevenly across areas, which matters for §3 because most "appealable" decisions are theoretical annual-review decisions rather than realised ones.',
  eli5: 'The clock is slipping — under half of new plans now beat the 20-week deadline. And the yearly check-ins on existing plans run late or get skipped in many places, which is why the "appeal rate" in the next section is easy to misread.',
  refs: [
    { label: 'DfE/EES — SEN2 timeliness, 2024 calendar year', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/education-health-and-care-plans/2025' },
    { label: 'NAO — SEND (Oct 2024): timeliness & deficit', url: 'https://www.nao.org.uk/reports/support-for-children-and-young-people-with-special-educational-needs/' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 3 · The tribunal machine — and what each statistic actually measures (NEW depth)
// ---------------------------------------------------------------------------
export const TRIBUNAL_SERIES: { year: string; appeals: number; favour: string }[] = [
  { year: '2018/19', appeals: 7_000, favour: '~9 in 10 at hearing' },
  { year: '2023/24', appeals: 21_106, favour: '~98.7% at hearing' },
  { year: '2024/25', appeals: 25_000, favour: '~99% at hearing' },
];

// The two numbers, side by side — same system, different denominators.
export interface TribunalMetric {
  big: string;
  question: string;   // the question this number answers
  what: string;       // research register: what it measures, precisely
  eli5: string;
  cited: string;      // who cites it / what it is used to argue
}

export const TRIBUNAL_METRICS: TribunalMetric[] = [
  {
    big: '~99% / 1.3%',
    question: 'Of cases the LA defends to a hearing, how often does the LA prevail?',
    what: 'In 2023/24 panels upheld the LA’s original decision in ~150 of the ~11,157 appeals decided at a full hearing (≈1.3%); the 2024/25 equivalent is reported as ~149 of ~14,009 decided cases. Crucially, ~one-third of completed appeals are conceded, settled, mediated or withdrawn by the LA BEFORE a hearing (≈5,575 of ~16,726 completed in 2023/24). The panel therefore rules on a self-selected residue — the cases the LA chose to contest — so the hearing-level reversal rate is not the share of all appeals, nor of all decisions.',
    eli5: 'When a council actually fights a case all the way to a hearing, it loses about 99 times in 100. But councils give in or settle about a third of cases before that point, so the "99%" only covers the fights councils chose to have.',
    cited: 'Used to argue that LA refusal decisions rarely survive scrutiny. [MoJ; Special Needs Jungle]',
  },
  {
    big: '~2.5%',
    question: 'Of all appealable decisions, how many are actually appealed?',
    what: 'The official "appeal rate" is ~2.5% of appealable decisions in 2023 (up from 2.3% in 2022). BERA’s methodological caveat: ~80% of "appealable opportunities" are annual-review decisions, a process that functions unevenly, so most of that denominator is theoretical. Measured against realised decision types the rate is far higher: ~15% for refusal-to-assess and ~25% for refusal-to-issue-after-assessment.',
    eli5: 'Counted against every decision that could in theory be appealed, only about 1 in 40 is — which sounds rare. But most of those "possible" appeals are paper opportunities. Against the decisions families actually face, like a refusal, the real rate is 15–25%.',
    cited: 'Used to argue that appeals are rare; BERA argues the denominator is inflated. [gov.uk Tribunal Stats; BERA 2025]',
  },
];

export const TRIBUNAL_NOTE = {
  research: 'Both figures are accurate and neither is "the" appeal statistic on its own. "99% of heard appeals go the family’s way" describes the small set of decisions the LA both declined to concede and chose to defend; "only ~2.5% of appealable decisions are appealed" describes a denominator that is mostly theoretical annual-review opportunities. In placement disputes specifically, the LA’s preferred school was upheld in ~13% of decided appeals. Registrations rose ~55% in 2023/24 before reaching ~25,000 in 2024/25. The neutral reading: the tribunal is consistent and decisive where it acts, but it adjudicates a self-selected slice of decisions, so its reversal rate should not be read as a verdict on the whole stock of LA decisions.',
  eli5: 'Two true numbers, two questions: "99% of fought cases go to the family" and "only 2.5% of all possible decisions get appealed". The first is about the cases councils choose to fight; the second is about a pool of decisions that mostly only exists on paper. Quoting either one alone is misleading.',
  refs: [
    { label: 'MoJ — Tribunal Statistics Quarterly (SEND)', url: 'https://www.gov.uk/government/statistics/tribunals-statistics-quarterly-july-to-september-2025/tribunal-statistics-quarterly-july-to-september-2025' },
    { label: 'Special Needs Jungle — concession/hearing breakdown', url: 'https://www.specialneedsjungle.com/55-rise-2024-send-tribunal-appeals-cost-families-incalculable/' },
    { label: 'BERA — the appeal-rate denominator', url: 'https://www.bera.ac.uk/blog/the-english-send-tribunal-appeal-rate-moving-the-goalposts-to-sustainability' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 4 · High-needs funding mechanics — the money and the override (NEW depth)
// ---------------------------------------------------------------------------
export const MONEY_STATS: { big: string; label: string; eli5: string }[] = [
  { big: '£11.9–12bn', label: 'high-needs budget in 2025–26 (the Autumn-2024 Budget added ~£1bn; IFS puts total SEND funding at ~£12bn). NAO records 2024–25 allocations of £10.7bn, a 58% real-terms rise since 2014–15 — but the NAO also estimates real-terms funding per plan fell ~35% as demand outran money (DfE NFF 2025–26; IFS 2025; NAO 2024).', eli5: 'Spending on the highest-need children is about £12bn and rising — up well over half in a decade, though the money per child has actually fallen because the number of children rose faster.' },
  { big: '~£3.16bn', label: 'cumulative DSG high-needs deficit at 2024–25 (Isos); the in-year deficit is ~£890m, projected ~£1.3bn by 2025–26. Estimates vary by source and accounting basis — NAO ~£2.9bn end-2024–25; some estimates ~£6.6bn by end-March-2026; CCN warns ~£18bn by 2028 absent reform. The spread is itself a data-quality finding (Isos 2025; NAO 2024; CCN 2025).', eli5: 'Councils have run up roughly £3bn of special-needs debt, growing about £1bn a year — and the official bodies put the eventual total anywhere from £6bn to £18bn.' },
  { big: '~43%', label: 'of local authorities the NAO assessed as facing deficits exceeding or near their reserves by March 2026. The statutory override (below) is the accounting mechanism that holds these deficits off the General Fund so they do not, by themselves, trigger a Section 114 ("effective bankruptcy") notice (NAO 2024).', eli5: 'Without the special accounting rule, nearly half of councils could be pushed toward effective bankruptcy by this one budget line.' },
];

// The three funding elements — the per-pupil mechanics (NEW).
export const FUNDING_ELEMENTS: { el: string; amount: string; what: string; eli5: string }[] = [
  { el: 'Element 1', amount: '~£4,000', what: 'Core / place funding — the per-pupil AWPU in mainstream. Special-school and AP places are funded at £10,000 per place.', eli5: 'The basic ~£4k every mainstream pupil attracts (a special-school place is funded at £10k).' },
  { el: 'Element 2', amount: 'first £6,000', what: 'The "notional SEN budget" — schools are expected to fund the first £6,000 of additional support per high-needs pupil from their own delegated budget (the gap between the ~£4k mainstream place and the £10k special-school place).', eli5: 'The next £6k of extra help is meant to come out of the school’s own budget.' },
  { el: 'Element 3', amount: 'above £6,000', what: 'Top-up funding — anything above £6,000 per pupil is met by the LA from the high-needs block, usually on application by the school.', eli5: 'Anything beyond ~£10k comes from the council’s special-needs pot, school by school, on request.' },
];

export const FUNDING_NOTE = {
  research: 'High-needs money flows through the High Needs Block of the Dedicated Schools Grant (DSG), allocated via the High Needs National Funding Formula (NFF). It funds LAs’ statutory duties under the Children and Families Act 2014 / Education Act 1996. The three-element structure (place funding → notional £6k → LA top-up) means the marginal cost of a high-needs pupil above £10k falls on the LA’s high-needs block — the budget line that runs the deficit. NFF 2025–26 gave every LA ≥7% per head (some up to ~10%).',
  eli5: 'The funding stacks up in three steps: a base amount, then £6k the school covers, then the council pays everything above that. It’s that top "everything above" layer that runs up the debt.',
  refs: [
    { label: 'DfE — High needs funding 2025–26 operational guide', url: 'https://www.gov.uk/government/publications/high-needs-funding-arrangements-2025-to-2026/high-needs-funding-2025-to-2026-operational-guide' },
    { label: 'IFS — Schools and colleges in the 2025 Spending Review', url: 'https://ifs.org.uk/sites/default/files/2025-05/Schools-and-colleges-in-the-2025-Spending-Review-IFS-Report.pdf' },
  ] as Ref[],
};

export const OVERRIDE_TIMELINE: { date: string; title: string; detail: string }[] = [
  { date: 'Nov 2020', title: 'The statutory override is created', detail: 'An accounting instrument that holds DSG high-needs deficits in an "unusable reserve", off the General Fund balance sheet, so they do not by themselves trigger a Section 114 notice. Originally set to end March 2023.' },
  { date: '2023 → 2025', title: 'Extended to March 2028', detail: 'Extended first to March 2026, then to the end of 2027–28 (i.e. March 2028). NAO had projected cumulative deficits of £4.3–4.9bn at the point the override was due to end. The end date has moved, not the underlying accumulated debt.' },
  { date: 'Safety Valve / DBV', title: 'The intervention programmes', detail: 'Safety Valve: bespoke DfE agreements with the ~35 LAs holding the highest-percentage deficits, paying down deficit against a plan to reach in-year DSG balance. Delivering Better Value (DBV): a lighter-touch diagnostic + grant (~£1m typical) for ~55 LAs with large-but-not-extreme deficits.' },
  { date: '2026', title: 'High Needs Stability Grant', detail: 'Safety Valve closed on 1 April 2026 and LAs are no longer held to those agreements; it and DBV are superseded by a High Needs Stability Grant absorbing ~90% of each LA’s accumulated DSG deficit as at 31 March 2026, ring-fenced to extinguish the unusable-reserve deficit (conditions apply).' },
  { date: '2028', title: 'Centrally funded from 2028 — debt route unstated', detail: 'Government has committed that all SEND expenditure will be centrally funded from 2028, but has not yet set out how accumulated debt accrued after March 2026 is cleared. The override extension defers, rather than resolves, that question.' },
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
  research: 'Council spend on independent and non-maintained special places roughly doubled in five years — £1.1bn (2020–21) to £2.1bn (2024–25). The Isos review reads the independent sector as both a symptom and an amplifier of the cost problem: it expanded because state-side supply could not meet demand, and its higher unit costs then accelerate the deficit. The 2026 white paper responds with national price bands on independent fees, statutory SEND-specific standards, and an LA say over new provision. The NAO records a measurement gap behind the supply problem: DfE does not know how many places mainstream settings hold.',
  eli5: 'Because there are not enough state places, councils buy private ones at £60k+ a year, and that spend doubled in five years. The Isos review treats this market as a sign of, and an accelerant for, the underlying shortage — and the government now plans to cap the fees. Part of the shortage is that government does not know how many places the state system has.',
  refs: [
    { label: 'NAO — SEND (Oct 2024): place costs, places unknown', url: 'https://www.nao.org.uk/wp-content/uploads/2024/10/support-for-children-and-young-people-with-special-educational-needs-summary.pdf' },
    { label: 'Isos Partnership — Towards an effective SEND system', url: 'https://www.local.gov.uk/publications/towards-effective-and-financially-sustainable-approach-send-england' },
    { label: 'Schools Week — fee caps & the provider market', url: 'https://schoolsweek.co.uk/private-special-school-fees-capped-in-profit-before-children-crackdown/' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 6 · The measurement gaps — what the system cannot currently see
// (five measurements the system does not currently hold)
// ---------------------------------------------------------------------------
export const BLIND_SPOTS: { gap: string; detail: string; eli5: string; refs?: Ref[] }[] = [
  {
    gap: 'Nine years of LA-aggregate statutory data',
    detail: 'SEN2 — the statutory return about EHC plans — was an LA-level aggregate until the 2023 collection. For the first nine years of the EHCP system the Department could not identify a single child in its own plan data, could not link plans to attainment or absence, and could not follow a child across an LA boundary. Person-level SEN2 has existed for three collections.',
    eli5: 'For nine years the government recorded special-needs plans only as totals per council — no individual children. Only since 2023 can it see actual children in the data.',
    refs: [{ label: 'EES — SEN2 methodology (person-level from 2023)', url: 'https://explore-education-statistics.service.gov.uk/methodology/education-health-and-care-plans' }],
  },
  {
    gap: '153 local authorities, 153 plan templates',
    detail: 'Each LA uses its own EHCP format. The 2023 Improvement Plan set out to standardise and digitise the EHCP by end-2024. A DfE FOI response states the work "was never completed due to the change in government… We are no longer commissioning LAs on the EHCP standardised template" — the digital-EHCP team was paused in July 2025. The 2026 white paper re-states the artefact as the digital Individual Support Plan. The pattern — built, paused, restated under a new name — has a precedent in earlier child-record programmes (ContactPoint).',
    eli5: 'Each council writes plans in its own format. A programme to fix that was paused in 2025, and the same artefact has now been re-announced under a new name.',
    refs: [
      { label: 'SNJ — the FOI: "never completed"', url: 'https://www.specialneedsjungle.com/digital-standardised-ehcps-ditched-labour-aiming-kill-statutory-send-provision/' },
      { label: 'DfE design history — the EHCP data standard', url: 'https://design.education.gov.uk/our-work/projects/education-health-care-plan' },
    ],
  },
  {
    gap: 'No national record of provision delivered',
    detail: 'No national collection records the provision a plan specifies versus what the child receives, therapy hours delivered, step-by-step assessment waits, or outcomes by placement type. The NAO found DfE does not know how many places are available in mainstream settings. ADHD has no national waiting-list collection at all — the ~316,000-children-waiting figure is an estimate because the instrument does not exist.',
    eli5: 'The state knows a plan was written. It does not record whether the help in the plan arrived, how long each step took, or whether the placement worked. For ADHD it does not count the queue at all.',
    refs: [
      { label: 'NAO — "financially unsustainable", places unknown', url: 'https://www.nao.org.uk/press-releases/special-educational-needs-system-is-financially-unsustainable/' },
      { label: 'Children’s Commissioner — neurodevelopmental waits', url: 'https://www.childrenscommissioner.gov.uk/resource/waiting-times-for-assessment-and-support-for-autism-adhd-and-other-neurodevelopmental-conditions/' },
    ],
  },
  {
    gap: 'Identification varies sharply by area and school type',
    detail: 'Loughborough analysis: ~60% of LA-to-LA differences in SEND-system performance is explained by population characteristics — ~40% is not. EPI (1.2m-pupil cohort): similar pupils were about HALF as likely to be identified with SEND in academies as in other state schools, with up to tenfold LA variation for higher-level needs. The IFS reads the same variation as "differences in identification practices". Underlying need appears roughly evenly spread; recorded identification is not.',
    eli5: 'Whether a child’s needs get recognised depends heavily on where they live and which school they attend — the differences are far larger than any plausible real difference between the children themselves.',
    refs: [
      { label: 'EPI — Identifying SEND (2021)', url: 'https://epi.org.uk/publications-and-research/identifying-send/' },
      { label: 'Loughborough — area variation in SEND', url: 'https://theconversation.com/how-wealth-and-postcode-affect-children-with-special-educational-needs-266320' },
    ],
  },
  {
    gap: 'The inspectorate is the main system-level feedback loop',
    detail: 'Of the 54 area SEND inspections in the first two years of the current Ofsted/CQC framework: 26% found widespread and/or systemic failings, 48% inconsistent, 26% positive. The only region with no systemic-failure verdicts is the North East + Yorkshire & Humber; in the East Midlands, four of five inspected areas were judged to have systemic failings. ("Widespread and/or systemic failings" is the inspectorate’s published category, not an authorial characterisation.)',
    eli5: 'When inspectors review local special-needs systems, about three-quarters come back "inconsistent" or worse on the inspectorate’s own scale. One northern region has no failing verdicts; the East Midlands almost always fails.',
    refs: [{ label: 'Ofsted/CQC — area SEND outcomes (Dec 2024)', url: 'https://www.gov.uk/government/statistics/area-send-inspections-and-outcomes-in-england-as-at-31-december-2024/main-findings-area-send-inspections-and-outcomes-in-england-as-at-31-december-2024' }],
  },
];

// ---------------------------------------------------------------------------
// 7 · The evidence vacuum — the placement-outcomes question
// ---------------------------------------------------------------------------
export const VACUUM = {
  research: 'The central unresolved question behind the reform is which placements work for which children — and the linked data to answer it was not connected until recently. ECHILD (the NPD linked to hospital records, 14.7m children) makes the question answerable; its first major study (3.8m children born 2004–13, a preprint, not yet peer-reviewed) found 30% received SEND provision by age 11, that provision tracked sex, disadvantage and school type as much as health, and no evidence that Year-1 SEND provision improved attainment or reduced hospitalisations (it did reduce unauthorised absence). The 2026 white paper’s inclusion case rests on the claim that comparable SEND children in mainstream achieve about half a grade higher than in special schools — and "comparable" is exactly what the missing data cannot yet establish. The NAO’s decade verdict: spending up 58% real, outcomes not improved, the system "financially unsustainable" (NAO’s term), with none of the 60 stakeholders it consulted expecting current plans to fix it.',
  eli5: 'The unresolved core: nobody can yet say whether special schools or mainstream schools produce better results for similar children — the data to check was never linked until recently. The first big study (not yet fully reviewed) found early support did not obviously improve results. The reform is being designed before that question is answered.',
  outcomes: [
    { big: '22% vs 72%', label: 'KS2 expected standard, SEN vs no-SEN pupils (2023/24) — the gap is wider than in 2015/16', eli5: 'At age 11, special-needs pupils reach the expected level about a third as often.' },
    { big: '30.8% vs 72.3%', label: 'grade 4+ in English & maths at KS4, SEND vs non-SEND (2023/24)', eli5: 'At GCSE, fewer than a third pass both English and maths.' },
    { big: '12.5%', label: 'overall absence rate for EHCP pupils (9.2% SEN support, 5.4% no SEN); SEN pupils ~4× more likely to be severely absent — and an EHCP at 16 is the top single factor in the government’s own NEET risk-factor ranking', eli5: 'Children with plans miss far more school — and are the single group most likely to end up out of work and education later.' },
  ],
  refs: [
    { label: 'ECHILD — the linked database', url: 'https://www.echild.ac.uk/' },
    { label: 'ECHILD primary-schools study (preprint)', url: 'https://www.medrxiv.org/content/10.1101/2025.08.31.25334778v1.full' },
    { label: 'Commons Library SN07020 — SEN outcome statistics', url: 'https://commonslibrary.parliament.uk/research-briefings/sn07020/' },
    { label: 'DWP — Young people and work (EHCP as top NEET factor)', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report/young-people-and-work-interim-report' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 7b · Transition (post-16 / 19–25), Alternative Provision, and the EP bottleneck (NEW)
// ---------------------------------------------------------------------------
export const SYSTEM_EDGES: { title: string; detail: string; eli5: string; refs?: Ref[] }[] = [
  {
    title: 'Post-16 and 19–25 transition',
    detail: 'EHC plans run to age 25, but post-16 outcomes diverge sharply. EPI finds pupils with an EHCP at end-of-KS4 finish 16–19 study ~7 grades behind peers with no SEND (best three qualifications); SEND-support pupils ~3.5 grades behind. Isos found young people with EHCPs turning 19 in 2022–23 were less likely to reach Level 2 at 16–19 than the 2015–16 cohort — outcomes flat-to-worse despite rising spend. "Preparation for adulthood" is a named weak point and a dedicated proposal in the Isos review.',
    eli5: 'Plans last to age 25, but the gap widens after 16: young people with a plan finish their post-16 studies around seven grades behind, and on some measures outcomes are no better than a decade ago.',
    refs: [
      { label: 'EPI — SEND and alternative provision', url: 'https://epi.org.uk/publications-and-research/send-and-alternative-provision-policy/' },
      { label: 'Isos Partnership — preparation for adulthood', url: 'https://www.isospartnership.com/blog/breakingpoint-send-inclusion' },
    ],
  },
  {
    title: 'Alternative Provision (AP)',
    detail: 'AP educates pupils out of mainstream — mainly Pupil Referral Units (PRUs) and AP academies, plus unregistered AP commissioned to fill specialist-place gaps. ~89% of registered AP schools are good/outstanding for teaching (close to the ~90% all-state-funded rate), but safeguarding in unregistered AP is materially weaker — DfE consulted in Spring 2024 on strengthening unregistered-AP protections and on national standards plus time limits. AP sits at the intersection of SEND, exclusions and EOTAS (Education Otherwise Than At School), often delivered via an EHCP.',
    eli5: 'AP is where pupils go when mainstream is not working. The registered part is mostly rated well; the unregistered part — used to fill gaps when specialist places run out — has weaker safeguarding, which the government consulted on tightening in 2024.',
    refs: [{ label: 'DfE — strengthening unregistered AP (consultation)', url: 'https://consult.education.gov.uk/behaviour-attendance-exclusions-and-alternative-provision/strengthening-protections-in-unregistered-ap/' }],
  },
  {
    title: 'The Educational Psychologist (EP) bottleneck',
    detail: 'EP advice is statutorily required for an EHC needs assessment, so EP capacity is a hard throttle on the §2b pipeline. Distribution is highly uneven: best-provisioned areas have ~1 EP per 480 pupils, worst ~1 per 9,400 (BPS). The training pipeline is small — ~200 government-funded training places in 2025/26 against an estimated ~350 annual leavers (~10% attrition), so net growth is hard to achieve. Service effects: >20,000 children waiting for an EHC assessment; ~1,000-case EP backlogs in single LAs; ~half of EPs report they cannot meet demand within current workloads and ~26% are considering leaving within 12 months. The Local Government & Social Care Ombudsman has formally noted the national shortage.',
    eli5: 'Every assessment needs an educational psychologist’s input — and there are nowhere near enough, very unevenly spread. Training places (~200/yr) barely replace those leaving (~350/yr), so the queue for assessments stays long.',
    refs: [
      { label: 'BPS — chronic shortage of Educational Psychologists', url: 'https://www.bps.org.uk/news/chronic-shortage-educational-psychologists-must-be-urgently-addressed-new-bps-commissioned' },
      { label: 'AEP — EP shortage and provision gaps', url: 'https://www.aep.org.uk/articles/report-reveals-chronic-shortage-educational-psychologists-and-record-provision-gaps' },
    ],
  },
];

// ---------------------------------------------------------------------------
// 8 · The health-side queue
// ---------------------------------------------------------------------------
export const QUEUE_STATS: { big: string; label: string; eli5: string }[] = [
  { big: '137,977', label: 'children waiting for an autism assessment (March 2025), ~90% beyond the 13-week NICE standard; waits exceed 32 months in some areas', eli5: 'Nearly 140,000 children are queuing for an autism assessment — most far beyond the recommended wait.' },
  { big: '~316,000', label: 'children estimated waiting for ADHD assessment — an estimate because no national ADHD waiting-list collection exists', eli5: 'Perhaps 316,000 children wait for ADHD checks. The exact number is unknown because it is not officially counted.' },
  { big: '72,661', label: 'children waiting for speech & language therapy (Feb 2024); SLT vacancy rates run 17–21%; only about a third of NHS SLTs say their service can usually provide what children need', eli5: 'Over 70,000 children wait for speech therapy, and roughly a fifth of therapist posts are empty.' },
];

export const QUEUE_NOTE = {
  research: 'These queues are the upstream inputs to every EHCP — in the Children’s Commissioner’s words, "every day a child waits for support could permanently alter their life course". They sit with health bodies, not DfE (the Jigsaw study maps why), but the 20-week clock and the health waiting lists are one wait, experienced by one family, and no national instrument joins them.',
  eli5: 'The school-side clock and the NHS-side queue are the same wait for the same child — but they are counted by different departments that do not add them together.',
};

// ---------------------------------------------------------------------------
// 9 · The reform on the table
// ---------------------------------------------------------------------------
export const REFORM = {
  research: 'The 2026 white paper ("Every Child Achieving and Thriving") keeps EHCPs for the most complex needs and introduces digital, statutory Individual Support Plans for the rest — early intervention without formal assessment, backed by £1.6bn of Inclusive Mainstream Fund, £1.8bn of in-school specialists, £3.7bn capital for ~60,000 specialist places and national price bands on independent fees. Transition is slow by design: no changes to EHCP-delivered support before September 2030, a "triple lock" on existing plans. Three analytical readings follow from this study: (1) the ISP is the paused digital-EHCP artefact under a new name — whether it ends 153 formats turns on publishing the data standard alongside the statutory duty; (2) the early-intervention bet is being placed before the placement-outcomes evidence base exists — the IFS notes the hardest empirical questions remained open at consultation close in May 2026; (3) comparable international reforms were not wired to measure their own effect: the Netherlands’ 2014 funding reform was officially evaluated as "effects on pupils cannot be properly determined"; Portugal mainstreamed ~99% of disabled students with patchy outcome monitoring; Finland’s tiered model has had no causal evaluation. The cross-national finding is not that inclusion works or fails, but that the feedback loop was not built — which makes whether England builds one a directly evaluable criterion for this reform.',
  eli5: 'The plan: most children get quicker, lighter-weight digital support plans, big money goes into mainstream schools, and private fees get capped. The open questions: the new digital plan is the artefact paused last year under another name; the evidence on what works is not yet in; and the other countries that tried this did not measure whether it worked. Whether England measures it is the test to watch.',
  refs: [
    { label: 'White paper — Every Child Achieving and Thriving', url: 'https://www.gov.uk/government/publications/every-child-achieving-and-thriving/every-child-achieving-and-thriving-html-version' },
    { label: 'DfE Education Hub — what changes for SEND', url: 'https://educationhub.blog.gov.uk/2026/02/schools-white-paper-what-parents-need-to-know-about-changes-to-the-send-system/' },
    { label: 'IFS — Spending on SEN: something has to change', url: 'https://ifs.org.uk/publications/spending-special-educational-needs-england-something-has-change' },
    { label: 'Netherlands — passend onderwijs', url: 'https://www.government.nl/topics/appropriate-education' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 9b · The Isos Partnership review — the keystone whole-system diagnosis (NEW)
// ---------------------------------------------------------------------------
export const ISOS = {
  research: 'The Isos Partnership review (for the LGA and County Councils Network, 2025) is the most influential whole-system diagnosis. Measured against the 2014 reforms’ own aims — better outcomes, fewer disputes, joined-up support — it finds the reforms have not succeeded: outcomes are no better and in places worse despite rising identification and spend. More than 9 in 10 survey respondents disagreed that the system was financially sustainable, adequately funded, or equitable. Isos attributes the trajectory to three interacting factors — rising volume and complexity of need; weaknesses in decision-making (vague definitions, misaligned accountability, a weak statutory framework); and distortion by the independent special-school market — and notes that a ~40% real-terms funding rise since 2018 did not stop ~33% continued EHCP growth, which it reads as evidence that funding level alone is not the binding constraint. (The phrase "breaking point" is the review’s own characterisation.)',
  eli5: 'The Isos review is the big system-wide stocktake. Its finding: judged against what the 2014 reforms set out to do, they did not work — outcomes are no better despite far more spending. It points to three causes at once: more and more complex need, weak decision-making rules, and an expensive private market — and notes that 40% more money did not stop the numbers rising.',
  proposals: [
    'A national ambition built on inclusion and preparation for adulthood.',
    'Consistent national expectations defining additional needs and the standard of provision.',
    'Mainstream reform — universal/targeted capacity so fewer children need a statutory plan.',
    'Statutory-framework reform — keep person-centred planning but reframe definitions/thresholds.',
    'Dedicated multi-agency transition-to-adulthood support.',
    'Statutory "Local Inclusion Partnerships" with named statutory partners and joint budgets.',
    'Redefine the independent sector’s role with equivalent standards and a profit-making prohibition.',
    'A workforce strategy (recruitment / training / retention) across all settings.',
  ],
  refs: [
    { label: 'Isos Partnership — Towards an effective SEND system (2025)', url: 'https://www.isospartnership.com/blog/breakingpoint-send-inclusion' },
    { label: 'LGA — the Isos review', url: 'https://www.local.gov.uk/publications/towards-effective-and-financially-sustainable-approach-send-england' },
    { label: 'NAO — Support for children and young people with SEN (2024)', url: 'https://www.nao.org.uk/reports/support-for-children-and-young-people-with-special-educational-needs/' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 10 · Open evidence questions — what better instrumentation would require
// (was "the asks" — reframed from imperatives to evaluable criteria)
// ---------------------------------------------------------------------------
export const SEND_ASKS: { ask: string; what: string; eli5: string }[] = [
  {
    ask: 'A single machine-readable record standard',
    what: 'The statutory digital ISP is planned for every nursery, school and college. For it to yield one format rather than 153, a machine-readable record standard — fields, vocabularies, transfer rules — would need to be published alongside the statutory duty. No such standard is currently published; the paused 2023–25 digital-EHCP work sits in DfE’s own design history. Whether the standard ships with the duty is a directly observable criterion for the reform.',
    eli5: 'The new digital plans are coming. For them to be one shared format rather than 153, a single agreed data standard would need to be published with them — and none currently is.',
  },
  {
    ask: 'A monthly pipeline view, joined to the health queues',
    what: 'SEN2 counts plans each January; demand appears first in requests, assessments-in-progress and step-level waits. A monthly per-LA pipeline, anonymously joined to the health-side autism/ADHD/SLT queues, would let one family’s one wait be expressed as one number. No such joined monthly series is currently published.',
    eli5: 'The count happens once a year; the queue moves every month — and the NHS queue and school queue are never added together. A monthly, joined view would close that gap.',
  },
  {
    ask: 'An answerable placement-outcomes question',
    what: 'ECHILD demonstrates linkage at 14.7m-child scale. A definitive placement-outcomes study (mainstream vs special, by need profile) on linked data, with provision-delivered data collected through the ISP from day one, is what would let the white paper’s "half-a-grade" claim be tested. That study has not yet been commissioned; an independent evaluation would require it before the September-2030 transition takes effect.',
    eli5: 'Whether mainstream or special schools work better for similar children is still untested at scale. The database to answer it now exists; commissioning the study before the new system bites is what an honest evaluation would require.',
  },
];

export const SEND_CLOSER = {
  research: 'Three structural readings hold across the sources used here. First, the costliest and fastest-growing subsystem in English education is also among its least instrumented: its most consistent system-level feedback loop is a tribunal whose hearing-level reversal rate (§3) reports a self-selected slice of decisions, not the whole stock. Second, the deficit, the override extension to March 2028 and the Stability Grant move the funding question forward in time without settling how the underlying need is met. Third, the disagreement over the cost driver (perverse incentives vs genuine rising need vs system design) is, on the evidence, a disagreement about weighting that the same missing data — causally clean, need-type-disaggregated outcome data linking provision changes to child outcomes — would help adjudicate. On this reading the SEND question is an information problem at least as much as a funding one.',
  eli5: 'Three things hold up across the sources: the most expensive part of the school system is one of the least measured; the funding fixes push the bill forward in time rather than settling it; and the argument over what is driving cost mostly comes down to missing outcome data. So this is as much an information problem as a money one.',
};
