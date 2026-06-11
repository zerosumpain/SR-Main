// attendanceIntel.ts — Field Study №8: attendance. England's biggest post-COVID
// schooling problem AND its biggest data-infrastructure success — the one place
// near-real-time central data already exists, and the live test of whether better
// measurement changes outcomes. Research dossier compiled 2026-06-10; flagged or
// government-claimed figures are labelled in the copy. Self-contained.

export interface Ref { label: string; url: string }

// ---------------------------------------------------------------------------
// 1 · The headline
// ---------------------------------------------------------------------------
export const ATT_HERO = {
  big: '176,000',
  label: 'children missed at least HALF of school in 2024/25 — a record, nearly triple the 60,247 of 2018/19 (severe-absence baseline: CSJ analysis of DfE data) — and severe absence is the one headline measure still rising while overall and persistent absence improve.',
  labelEli5: 'A record 176,000 children missed more than half of all their school days last year — almost three times as many as before the pandemic. And unlike the other absence numbers, this one is still going up.',
  kicker: {
    research: 'The structural feature this study examines: the same system producing that record now measures attendance at higher frequency than anything else it collects. 99% of state schools transmit pupil-level attendance to the Department every day, published fortnightly — against full-year statistics that still arrive eight months after the year ends. England has built a high-frequency attendance instrument while severe absence continues to rise. Whether the instrument has changed outcomes is an open question in the education data estate — and this page treats it as a question, with the evidence on each side set out below.',
    eli5: 'A notable contrast: school attendance is now the thing the government measures most frequently — every school, every day — yet it is also one of the numbers moving the wrong way. This page asks the evidence question: has the detailed measuring changed outcomes yet?',
  },
  refs: [
    { label: 'DfE — pupil absence 2024/25 (full year)', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/pupil-absence-in-schools-in-england/2024-25' },
    { label: 'CSJ — record severe absence (DfE data)', url: 'https://www.centreforsocialjustice.org.uk/newsroom/record-numbers-missing-over-half-of-school-new-data-reveals' },
    { label: 'DfE — pupil attendance in schools (fortnightly)', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/pupil-attendance-in-schools' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 2 · The three dials
// ---------------------------------------------------------------------------
export interface Dial {
  title: string;
  eli5: string;
  unit: '%' | 'children';
  trend: 'improving' | 'rising';
  data: { y: string; v: number; label: string }[];
  note: string;
}

export const DIALS: Dial[] = [
  {
    title: 'Overall absence', eli5: 'All missed sessions', unit: '%', trend: 'improving',
    data: [
      { y: '2018/19', v: 4.73, label: '4.73%' },
      { y: '2022/23', v: 7.4, label: '7.4%' },
      { y: '2023/24', v: 7.15, label: '7.15%' },
      { y: '2024/25', v: 6.78, label: '6.78%' },
    ],
    note: 'Recovering — but still ~2 percentage points above the pre-pandemic world, and the in-year 2025/26 feed shows recent weeks running slightly ABOVE last year.',
  },
  {
    title: 'Persistent absence (≥10% missed)', eli5: 'Missing one day in ten or more', unit: '%', trend: 'improving',
    data: [
      { y: '2018/19', v: 10.9, label: '10.9%' },
      { y: '2021/22', v: 22.5, label: '22.5%' },
      { y: '2023/24', v: 19.95, label: '19.95%' },
      { y: '2024/25', v: 18.14, label: '18.14%' },
    ],
    note: '1.34 million children — down from the 2021/22 peak (22.5%, Education Committee), still nearly double 2018/19.',
  },
  {
    title: 'Severe absence (≥50% missed)', eli5: 'Missing more than half of school', unit: 'children', trend: 'rising',
    data: [
      { y: '2018/19', v: 60_247, label: '60,247' },
      { y: '2022/23', v: 150_256, label: '150,256' },
      { y: '2023/24', v: 171_269, label: '171,269' },
      { y: '2024/25', v: 176_000, label: '~176,000' },
    ],
    note: 'The dial still moving the wrong way: up again in 2024/25 even as the other two fell — the cohort closest to the “invisible children” of the Jigsaw study.',
  },
];

// ---------------------------------------------------------------------------
// 3 · Who is absent
// ---------------------------------------------------------------------------
export const WHO_STATS: { big: string; label: string; eli5: string }[] = [
  { big: '33% vs 13.4%', label: 'persistent absence, FSM-eligible vs non-FSM pupils (2024/25) — disadvantaged children are over 2.5× as likely to be persistently absent, and 3.6× as likely to be severely absent', eli5: 'A third of children on free school meals are persistently absent — two and a half times the rate of everyone else.' },
  { big: '34.1%', label: 'persistent absence among pupils with an EHCP (30.1% SEN support, 19.4% no identified SEN); EHCP pupils are 6.2× more likely to be severely absent — absence and unmet need travel together (see Field Study №7)', eli5: 'Children with special-needs plans miss the most school of all — six times more likely to miss half of it.' },
  { big: '3.22%', label: 'of all sessions lost to illness — roughly half of all absence, the single largest reason code; children with a probable mental disorder were 7× more likely to miss >15 days (NHS survey, autumn 2022)', eli5: 'About half of all absence is recorded as illness — and children with mental-health problems miss seven times more school.' },
];

export const EBSA_NOTE = {
  research: 'A caution on the most-cited driver: “emotionally based school avoidance”. The systematic-review evidence (BERJ, 2025) puts prevalence at 1–5% — more recent estimates 1–2% — with only circumstantial evidence of a post-COVID rise, no clinical definition, and definitionally inconsistent studies underneath the big numbers in circulation. The phenomenon is real; most headline EBSA statistics are not load-bearing.',
  eli5: '“School avoidance” driven by anxiety is real — but most of the dramatic numbers quoted about it come from weak surveys. Treat them carefully.',
  refs: [
    { label: 'BERJ — EBSA systematic review (2025)', url: 'https://bera-journals.onlinelibrary.wiley.com/doi/10.1002/berj.4205' },
    { label: 'NHS — mental health & absence (wave 4)', url: 'https://digital.nhs.uk/data-and-information/publications/statistical/mental-health-of-children-and-young-people-in-england/2023-wave-4-follow-up' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 4 · The instrument
// ---------------------------------------------------------------------------
export const INSTRUMENT = {
  before: {
    title: 'Before — the termly census',
    points: [
      'Absence collected through the termly school census, published months to a year in arrears.',
      'The full-year 2024/25 statistics were published on 26 March 2026 — eight months after the year ended. That is the FAST, modern timetable.',
      'A child could drift from wobble to severe absence inside the gap between two data points.',
    ],
  },
  after: {
    title: 'After — the daily feed (statutory from 2024/25)',
    points: [
      'School MIS → DfE automatically, daily, via the Wonde pipe: 19 pupil-level items, AM and PM session codes, under the 2024 Information About Individual Pupils regulations.',
      '99% of state schools transmitting (99% primary, 98% secondary, 99% special — week 20, 2026).',
      'Schools, trusts and LAs get daily reports back through “Monitor your school attendance”; every school is benchmarked half-termly against ~20 statistically similar schools, with a published algorithmic transparency record.',
      'National statistics published fortnightly, ~2–3 weeks behind real time.',
    ],
  },
  caveat: {
    research: 'The instrument has unresolved data-governance questions. defenddigitalme’s challenge and ICO correspondence record that the collection began with a DPIA not signed off with the regulator, questioned 66-year retention, extraction initially every 2–4 hours, and DfE confirmation the data could support penalty notices and prosecutions. Parents have no access route to their own child’s feed. The Monitoring study’s lower-custody test applies here too — its fourth question, what the data subject gets back, is the open item for the estate’s highest-frequency collection.',
    eli5: 'One catch: this daily collection was switched on with privacy questions still open — the regulator queried how long data is kept, and parents can’t see their own child’s feed. The best pipe in the system still fails the “what do you get back?” test.',
  },
  refs: [
    { label: 'DfE — share your daily attendance data', url: 'https://www.gov.uk/guidance/share-your-daily-school-attendance-data' },
    { label: 'ATRS — similar-schools benchmarking record', url: 'https://www.gov.uk/algorithmic-transparency-records/dfe-attendance-reports-using-similar-schools' },
    { label: 'defenddigitalme — the daily-collection challenge', url: 'https://defenddigitalme.org/2022/09/16/news-challenging-the-department-for-education-on-excessive-pupil-data-collection/' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 5 · Has the instrument moved the needle?
// ---------------------------------------------------------------------------
export const VERDICT = {
  claim: {
    research: 'The government’s claim (August 2025 press release): the biggest year-on-year attendance improvement in a decade — five million more days in school, 140,000 fewer persistently absent pupils — credited to “world-leading, real-time attendance data tools” alongside mentors and hubs, with a £2bn future-earnings figure attached.',
    eli5: 'The government says its real-time data tools helped produce the biggest attendance improvement in ten years.',
  },
  counter: {
    research: 'The evidence that qualifies the attribution: (1) the recovery is internationally typical — US chronic absenteeism roughly doubled post-COVID and is recovering on a similar curve with no English-style infrastructure, so secular recovery is a confound; (2) the only published intervention evaluation — attendance mentors, Year 1 — was uncontrolled, with a +3 percentage-point average gain and evidence its authors call “indicative”; (3) attendance hubs ended in March 2025 without a robust evaluation, their successor funded at £1.5m against the original £10m; (4) severe absence — the highest-need measure — is still rising; and (5) the feed’s own 2025/26 in-year data shows recent weeks running 0.24pp ABOVE the equivalent week last year. No independent evaluation isolates the data infrastructure’s contribution. The instrument is built; whether it changes outcomes is the open question.',
    eli5: 'But the evidence is mixed: other countries improved at the same pace without the detailed data; the one evaluated support programme showed small gains with no comparison group; the highest-need problem (children missing half of school) is still growing; and this term’s own feed shows progress stalling. No independent study has yet tested whether the data tools deserve the credit.',
  },
  refs: [
    { label: 'Attendance mentors — Year 1 evaluation (DfE)', url: 'https://assets.publishing.service.gov.uk/media/65fb20d3703c423c5158ef03/Evaluation_of_the_attendance_mentors_pilot_-_Year_1_findings.pdf' },
    { label: 'AEI — US chronic absenteeism (the confound)', url: 'https://www.aei.org/research-products/report/lingering-absence-in-public-schools-tracking-post-pandemic-chronic-absenteeism-into-2024/' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 6 · The fines machine
// ---------------------------------------------------------------------------
export const FINES = {
  stats: [
    { big: '492,800', label: 'penalty notices issued to parents in 2024/25 (+1% on the year) — 93% for unauthorised family holidays', eli5: 'Nearly half a million fines went to parents last year — almost all for term-time holidays.' },
    { big: '£80 / £160', label: 'the August 2024 national framework: first rise since 2012, a national 10-unauthorised-sessions threshold, two-notice cap per child per three years, then escalation', eli5: 'Fines went up in 2024 and the rules became national: two fines, then court.' },
    { big: '10.3% vs 3.6%', label: 'penalty notices as a share of enrolments — Yorkshire & Humber vs London. Enforcement is a postcode variable too', eli5: 'A child in Yorkshire is nearly three times more likely to attract a fine than one in London.' },
  ],
  verdict: {
    research: 'And the evidence that fines improve attendance: none of any robustness. The EEF’s rapid evidence assessment could not draw conclusions on sanctions; the 2025 systematic review of persistent-absence interventions favours support-based approaches over punitive ones, weakly. Half a million notices a year constitute the system’s largest attendance intervention — run without an evaluation, on the one outcome the state now measures daily.',
    eli5: 'Nobody has ever properly shown that fining parents gets children into school. It’s the biggest attendance policy there is, and it has never been tested — even though the data to test it now arrives daily.',
  },
  refs: [
    { label: 'DfE — parental responsibility measures 2024/25', url: 'https://explore-education-statistics.service.gov.uk/find-statistics/parental-responsibility-measures/2024-25' },
    { label: 'EEF — attendance interventions evidence assessment', url: 'https://educationendowmentfoundation.org.uk/education-evidence/evidence-reviews/attendance-interventions-rapid-evidence-assessment' },
  ] as Ref[],
};

// ---------------------------------------------------------------------------
// 7 · Why it matters — the downstream ledger
// ---------------------------------------------------------------------------
export const DOWNSTREAM: { big: string; label: string; eli5: string; link?: { label: string; href: string } }[] = [
  {
    big: '+4 months', label: 'of the age-16 disadvantage gap is statistically associated with disadvantaged pupils’ higher absence — and EPI finds the post-2019 GROWTH in the gap is entirely explained by it (associational, not causal)',
    eli5: 'The whole worsening of the rich-poor GCSE gap since 2019 lines up with poorer children missing more school.',
  },
  {
    big: '1.3×', label: 'likelihood of reaching the expected standard at KS2 for pupils attending 95–100% vs 90–95%; one 5pp attendance band ≈ two extra weeks of school (DfE, March 2025)',
    eli5: 'Even small attendance differences track with results — one band up is worth about two extra weeks of school.',
  },
  {
    big: '3.9×', label: 'risk of being NEET at 16–18 for persistently absent pupils (6.3× for persistent NEET) — the single biggest predictor among covariates studied, controlling for sex, ethnicity, SEN, FSM and deprivation',
    eli5: 'Persistently absent children are four times more likely to end up out of work and education — the strongest warning sign there is.',
    link: { label: 'The early-warning case → NEET', href: '/projects/policy-engine/neet' },
  },
];

// ---------------------------------------------------------------------------
// 8 · What works — the thin evidence
// ---------------------------------------------------------------------------
export const EVIDENCE_NOTE = {
  research: 'The intervention evidence is startlingly thin for a problem this size. The EEF’s rapid evidence assessment (2022): 72 studies, all but three American, overall quality WEAK — with personalised parental communication (letters, texts) the one approach showing promise. The Magic Breakfast RCT found a non-significant positive attendance effect (its significant effect was attainment). The 2025 systematic review finds weakly favourable signals for mentoring, family involvement, counselling and incentives. England is running a national attendance push on an evidence base that would not clear the bar for a single drug trial — while generating, daily, exactly the data that could fix that.',
  eli5: 'Almost nothing about “what gets children back to school” has been properly tested — the best evidence is for simply texting parents. Meanwhile the daily data that could test everything piles up unused.',
  refs: [
    { label: 'EEF — attendance REA (2022)', url: 'https://d2tic4wvo1iusb.cloudfront.net/documents/pages/Attendance-REA-report.pdf' },
    { label: 'Frontiers — persistent-absence interventions review (2025)', url: 'https://www.frontiersin.org/journals/child-and-adolescent-psychiatry/articles/10.3389/frcha.2025.1603680/full' },
  ] as Ref[],
};

export const SOCIAL_CONTRACT = {
  research: 'Underneath the codes sits the drivers research: Public First’s 2023 focus-group finding (its terms) that parental support for full-time schooling has “collapsed” and the school–parent social contract is “profoundly broken”; cost-of-living and term-time holiday economics; youth mental health. On this evidence, attendance has a substantial demand-side component — a possible reason supply-side instruments (fines, dashboards), designed for a compliance problem, perform below the expectations set for them.',
  eli5: 'On this research, a share of the change is demand-side: some parents place less weight on full-time attendance than before the pandemic. That may be why fines and dashboards alone fall short — they are designed for rule-breaking, not for a shift in how families weigh school.',
  refs: [{ label: 'Public First — the broken social contract', url: 'https://www.publicfirst.co.uk/public-first-research-finds-parental-support-for-fulltime-schooling-has-collapsed.html' }] as Ref[],
};

// ---------------------------------------------------------------------------
// 9 · Comparators
// ---------------------------------------------------------------------------
export const COMPARATORS: { name: string; what: string; eli5: string; verdict: string }[] = [
  {
    name: 'United States',
    what: 'Chronic absenteeism (≥10% missed): ~15% (2018–19) → 28.5% peak (2021–22) → 23.5% (2023–24) — still ~57% above pre-pandemic, recovery slowing.',
    eli5: 'America’s absence problem doubled too, and is recovering at about the same pace as England’s.',
    verdict: 'The confound: a similar curve with no daily-feed infrastructure. England’s recovery is internationally typical — which is exactly why attribution needs a real evaluation.',
  },
  {
    name: 'Wales & Scotland',
    what: 'Persistent absence ~29% (Wales, 2023/24) and ~31% (Scotland, 2023/24, different definitions and collection cadence) — both substantially worse than England’s 18–20%, neither with an England-style daily feed.',
    eli5: 'Wales and Scotland — without England’s daily data — are doing notably worse.',
    verdict: 'Directionally useful for the instrument’s case, but the definitions differ; not like-for-like.',
  },
  {
    name: 'Netherlands — leerplicht',
    what: 'The design England has not built: schools legally report ≥16 hours of unauthorised absence in 4 weeks to the national agency (DUO), which routes the case to a named municipal compulsory-education officer who investigates and supports; RMC legislation extends tracking to 23.',
    eli5: 'In the Netherlands, serious absence automatically reaches a named officer whose job is that child — not a dashboard.',
    verdict: 'Cited as system DESIGN, not proven impact — but it is the individual-caseworker pattern England’s school-level benchmarking stops short of.',
  },
];

// ---------------------------------------------------------------------------
// 10 · Open evidence questions
// (what better instrumentation or evaluation would require — stated as evaluable
//  criteria, not as recommendations)
// ---------------------------------------------------------------------------
export const ATT_ASKS: { ask: string; what: string; eli5: string }[] = [
  {
    ask: 'Does the daily feed change attendance? No independent evaluation yet isolates it',
    what: 'No published independent causal evaluation of the daily feed, the similar-schools comparison reports, or the fines framework exists. The staggered rollout, the regional enforcement variation (10.3% vs 3.6%) and the half-termly benchmark cycles are natural experiments present in the data; isolating what the instrument changes — and what fines change — would require a single commissioned, controlled evaluation (EEF/Foundations-grade) rather than an observational before/after.',
    eli5: 'No one has yet independently tested whether the daily data and the fines change attendance — though the data to test it is already flowing.',
  },
  {
    ask: 'Can a school-level signal become a child-level one? Two designs differ on this',
    what: 'The feed benchmarks schools; it does not flag an individual child whose trajectory is deteriorating in time to act. A child-level early-warning use would require the NEET study’s governance design (published error rates, support-only routing). Severe absence rising while the other measures fall is the pattern an aggregate-only signal does not catch.',
    eli5: 'The data currently compares schools, not individual children. Using it to notice a child drifting would need explicit safeguards — and that design choice is unresolved.',
  },
  {
    ask: 'What does the family get back? The instrument’s trust account is unsettled',
    what: 'Open items on the record: the DPIA position with the ICO, the justification for retention length, what enforcement uses the feed may serve, and whether families can see their own child’s record. These map onto the subsidiarity test’s fourth question — what the data subject gets back — applied to the one collection every school feeds every day.',
    eli5: 'There are unresolved privacy questions — how long the data is kept, and whether parents can see their own child’s record. These are open, not settled.',
  },
];

export const ATT_CLOSER = {
  research: 'Attendance is where the project’s analytical thesis is testable. The Monitoring study finds cadence is a design choice — attendance is the worked example. The NEET study finds the predictors are observable years early — attendance is among the predictors. The Jigsaw study finds the cross-domain joins sit with no single owner — the severely absent child is one such join. The synthesis sets the criterion of publishing, specifying and evaluating before collecting more — attendance is the one place the collection already exists, with the evaluation and the child-level design as the outstanding questions.',
  eli5: 'The site’s argument converges here: the daily attendance data is the system’s most detailed instrument. What is still missing is evidence that it changes outcomes, and a settled, safeguarded design for using it child by child.',
};
