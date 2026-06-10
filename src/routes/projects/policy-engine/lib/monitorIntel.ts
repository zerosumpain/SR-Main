// monitorIntel.ts — the data-sharing intelligence layer for the Monitoring field
// study: who shares what today (by sector, with history), the sector-led
// counterweights, the ladder of sharing methodologies, the overlapping government
// agendas, and the subsidiarity question that runs through the whole page.
// Research dossier compiled 2026-06-10; claims carry sources. Self-contained.

// ---------------------------------------------------------------------------
// THE RECURRING THEME — central or local? One aside per act applies the question.
// ---------------------------------------------------------------------------
export interface SubsidNote { act: string; research: string; eli5: string; }

export const SUBSID_NOTES: Record<string, SubsidNote> = {
  silos: {
    act: '1',
    research: 'The spine answers “connect centrally” — but connection and custody are separable questions. Wiring systems together does not require the centre to hold the data; that design choice is being made now, mostly by default.',
    eli5: 'Joining systems up doesn’t have to mean Whitehall keeps all the data. Those are two different choices — and the second one is being made quietly.',
  },
  attendance: {
    act: '3',
    research: 'Daily mandation turned every school register into a national dataset — extraction began before the DPIA was signed off, and from Nov 2025 Ofsted receives school-level feeds half-termly. Burden fell; so did local agency. The question nobody asked: could the same early-warning value have been delivered by querying data held in school systems?',
    eli5: 'Schools now send attendance to the centre every day, automatically. Handy — but no one asked whether the centre needed to *keep* it, or just to be able to ask questions of it.',
  },
  ledger: {
    act: '6',
    research: 'Every row in this ledger is a subsidiarity decision already taken — almost all of them toward central custody. The collections exist because national comparability and funding allocation genuinely need them; the trust history shows what happens when custody outruns purpose.',
    eli5: 'Each of these data collections was a choice to centralise. Some were clearly right — money has to be shared out fairly. The history shows what goes wrong when the centre keeps more than it needs.',
  },
  counterweight: {
    act: '7',
    research: 'The strongest pattern in this act: the centre funds, the sector owns. Data to Insight and Supporting Families show DfE getting a national view WITHOUT national custody — local data, local tools, a centrally-supported framework. This is the non-paternal posture, demonstrated.',
    eli5: 'These examples show the trick: the government pays for the tools, councils keep and use their own data, and everyone still gets the national picture.',
  },
  ladder: {
    act: '8',
    research: 'The ladder is the subsidiarity question made technical: each rung moves custody away from the centre while preserving the analytical view. DfE currently operates almost entirely on rung 1; health has proven rung 4 at scale. The least-extractive method that meets the purpose should be the default — today the most-extractive is.',
    eli5: 'There are at least five ways to learn from data without taking it. Schools data uses the most grabby one almost everywhere; the NHS has proven the least grabby one works.',
  },
  edtech: {
    act: '9',
    research: 'The clearest application of this page’s test: central extraction of edtech data would be exactly wrong — the records should stay with vendors and schools. The centre’s legitimate tools are standards (the spine’s open APIs), procurement terms, and PURCHASED aggregate readouts — a national view assembled from data the centre never holds. The COVID Star study showed the pattern; the task is making it standing policy rather than crisis response.',
    eli5: 'This is the easiest call on the whole page: the government shouldn’t hoover up the apps’ data. It should set the plumbing rules, use its buying power, and pay for honest national summaries — learning from the data without ever taking it.',
  },
  agendas: {
    act: '10',
    research: 'Every agenda on this map increases the gravitational pull toward central linkage — the SUI, the spine, the NDL. None of them yet states a custody principle. Absent one, “join up” drifts into “collect everything”, and the 2012–2022 trust ledger repeats at larger scale.',
    eli5: 'All these big plans pull data toward the centre. None of them says where the limit is — and without a limit, history suggests the centre keeps taking.',
  },
};

// ---------------------------------------------------------------------------
// 6 · The sector ledger — who shares what today, by sector
// ---------------------------------------------------------------------------
export interface SectorFlow {
  sector: string;
  colour: string;
  shares: { name: string; cadence: string; since: string; note: string }[];
  notShared: string;     // what stays local / uncollected
  eli5: string;
}

export const SECTOR_LEDGER: SectorFlow[] = [
  {
    sector: 'Schools & trusts', colour: '#2f6f97',
    shares: [
      { name: 'School census (pupil-level)', cadence: 'Termly', since: '2002 (PLASC)', note: '~8m records/yr into the NPD; drives funding & Pupil Premium. Legal basis s.537A Education Act 1996 — no consent, no opt-out.' },
      { name: 'Daily attendance feed', cadence: 'Every school day', since: '2022 voluntary → Sept 2024 mandatory', note: 'Extracted from school MIS via Wonde; ~95% of schools had joined before mandation. Ofsted receives school-level feeds half-termly from Nov 2025.' },
      { name: 'School workforce census', cadence: 'Annual (Nov)', since: '2010', note: 'Individual staff records; no staff opt-out.' },
      { name: 'Assessments (EYFSP, phonics, KS1/2, MTC)', cadence: 'Annual', since: 'various', note: 'Via LAs / Standards & Testing Agency into the NPD.' },
    ],
    notShared: 'Curriculum and lesson-level data, formative assessment, behaviour detail, wellbeing surveys — all local today. The white paper’s “every school monitoring belonging and engagement by 2029” is the first central move into that space.',
    eli5: 'Schools already send the centre who their pupils are (three times a year), who their staff are, every test result — and, since 2024, every child’s attendance every single day. What stays in school: what’s actually taught, ongoing marking, and how children feel.',
  },
  {
    sector: 'Local authorities', colour: '#b4632e',
    shares: [
      { name: 'Children in Need census', cadence: 'Annual (child-level)', since: '~2009', note: 'Every child referred to children’s social care.' },
      { name: 'SSDA903 (children looked after)', cadence: 'Annual (child-level)', since: '1992', note: 'The longest-running child-level return in the system.' },
      { name: 'SEN2 (EHC plans)', cadence: 'Annual (Jan)', since: 'person-level from 2023', note: 'Moved from aggregate counts to person-level records.' },
      { name: 'NCCIS (16–17 tracking)', cadence: 'Monthly', since: 'RPA era', note: 'From LA client systems (CCIS); feeds NEET statistics and the September Guarantee; the duty stops at 18.' },
    ],
    notShared: 'Early-help and family-support records, youth-service contact, most local risk models — held locally, pooled regionally at most (see the LIIA model). The CSC Data & Digital Strategy (2023) explicitly commits to “continually reduce data collection burdens on local authorities”.',
    eli5: 'Councils send annual child-level returns about children’s social care and special needs, plus a monthly list of what every 16–17-year-old is doing. Their day-to-day case notes and early-help work stay local.',
  },
  {
    sector: 'FE & post-16', colour: '#566a8c',
    shares: [
      { name: 'ILR (individualised learner record)', cadence: 'Periodic in-year', since: 'long-standing', note: 'Colleges, providers, apprenticeships — keyed on the Unique Learner Number; funding-grade, not early-warning-grade.' },
      { name: 'Awarding & destinations', cadence: 'Annual', since: 'various', note: 'Results and sustained-destination measures, ~15 months in arrears.' },
    ],
    notShared: 'No daily/weekly participation signal exists post-16 — the school attendance feed has no FE equivalent, which is why the riskiest transition (the summer after Year 11) is observed only in retrospect.',
    eli5: 'Colleges report who’s enrolled a few times a year, for funding. Nobody gets a daily signal — so a teenager quietly dropping out of college is invisible for months.',
  },
  {
    sector: 'Out of the DfE (the share register)', colour: '#7a5aa6',
    shares: [
      { name: 'Research access (ONS SRS, Five Safes)', cadence: 'Per-project', since: '2018 regime', note: 'Accredited researchers, de-identified data, locked environments — the gold-standard route.' },
      { name: 'DSAP-approved shares', cadence: 'Per-request, published', since: 'Dec 2018', note: 'Every external share now passes the Data Sharing Approval Panel and lands on a public register — ~2,385 distributions logged 2012–2025.' },
      { name: 'Safeguarded deposits (UK Data Service)', cadence: 'Framework from Apr 2026', since: '2026', note: 'A standing, auditable pathway for research-ready deposits — LEO synthetic, LSYPE2, Children of the 2020s.' },
    ],
    notShared: 'The register exists BECAUSE of what used to leave the building unlogged — see the trust ledger below.',
    eli5: 'Researchers can study the national data in locked rooms under strict rules, and every share the department makes is now on a public list. That list exists because of past scandals.',
  },
];

// the trust ledger: how the centre earned, lost and partially rebuilt trust
export const TRUST_LEDGER: { year: string; event: string; tone: 'neutral' | 'bad' | 'good' }[] = [
  { year: '2002', event: 'PLASC: the first named, pupil-level national collection — the NPD is born.', tone: 'neutral' },
  { year: '2012', event: 'NPD opened to commercial third-party re-use.', tone: 'bad' },
  { year: '2015', event: 'Secret Home Office MoU: school records matched for immigration enforcement (7,321 matching requests, 2015–25).', tone: 'bad' },
  { year: '2016', event: 'Nationality & country-of-birth added to the census → #BoycottSchoolCensus → items dropped.', tone: 'bad' },
  { year: '2018', event: 'Reset: third-party sharing paused; DSAP created; the public external-shares register begins.', tone: 'good' },
  { year: '2020', event: 'ICO compulsory audit: “wide-ranging and serious” transparency failings.', tone: 'bad' },
  { year: '2022', event: 'ICO reprimand: the 28m-record Learning Records Service accessed by a screening firm for gambling-age checks (a £10m fine, waived under the public-sector approach).', tone: 'bad' },
  { year: '2024', event: 'Daily attendance extraction mandated — begun before the DPIA was completed; a legal challenge was refused permission.', tone: 'neutral' },
  { year: '2026', event: 'UK Data Service framework: a transparent, auditable deposit pathway for research-ready data.', tone: 'good' },
];

// ---------------------------------------------------------------------------
// 7 · The sector-led counterweight — centre funds, sector owns
// ---------------------------------------------------------------------------
export interface Counterweight {
  name: string;
  sector: string;
  what: string;
  numbers: string;
  lesson: string;
  url: string;
  colour: string;
}

export const COUNTERWEIGHTS: Counterweight[] = [
  {
    name: 'Data to Insight', sector: 'LA children’s services', colour: '#3f7d6e',
    what: 'The sector-led national data function: hosted by East Sussex CC, governed by LA data professionals, funded by DfE/MHCLG/Ofsted/ADCS where goals align — tools free to every LA, code open on GitHub.',
    numbers: 'ChAT (the children’s services analysis tool, originally built by London LAs with Ofsted) is used by ~150 of England’s local authorities; return validators, demand-modelling and placement tools alongside.',
    lesson: 'A national analytical view created WITHOUT national custody: the centre pays, the sector builds and owns. The strongest existing template for a non-paternal DfE posture.',
    url: 'https://www.datatoinsight.org/what-we-do',
  },
  {
    name: 'LIIA Child Level Insights', sector: 'Regional (London)', colour: '#2f6f97',
    what: 'London boroughs pool pseudonymised child-level social-care data (referrals, CIN/CP/CLA episodes, placements) on their own public-task legal basis, with the analysis team hosted at Waltham Forest — quarterly cross-borough benchmarking.',
    numbers: 'All 33 London authorities; outputs anonymised; six-year retention; a three-strand data strategy running from shared tools to innovative linkage.',
    lesson: 'Regional pooling proves child-level analytics doesn’t require a national database — the data stays in local government custody.',
    url: 'https://www.liia.london/quarterly-data-benchmarking/',
  },
  {
    name: 'Supporting Families', sector: 'Cross-government (MHCLG)', colour: '#b4632e',
    what: 'A national outcomes framework co-designed with LAs, evidenced from LOCALLY-held data, with a data maturity model and funded support to raise LA capability — the centre sets the frame, never takes the records.',
    numbers: 'LAs rating their data systems “basic/manual” fell from 47% to 33%; 86% have the outcomes framework integrated into local systems.',
    lesson: 'A central framework can drive measurable LOCAL capability instead of central collection — and capability, unlike extraction, compounds.',
    url: 'https://www.gov.uk/government/publications/supporting-families-programme-guidance-2022-to-2025/chapter-3-the-national-supporting-families-outcome-framework',
  },
  {
    name: 'Trust data estates & FFT Aspire', sector: 'Schools & MATs', colour: '#566a8c',
    what: 'Multi-academy trusts now run their own consolidated data estates (group MIS, Power BI), and 13,000+ schools use FFT Aspire — NPD-derived benchmarking flowing BACK to schools, the largest re-use channel of national data.',
    numbers: '13,000+ schools on FFT Aspire; trust-level MIS products are now a standard vendor category.',
    lesson: 'The school sector has built real analytical capability of its own — central design should treat schools and trusts as analytical peers, not data sources.',
    url: 'https://fft.org.uk/fft-aspire/',
  },
  {
    name: 'Scotland’s 16+ Data Hub', sector: 'National (Scotland)', colour: '#7a5aa6',
    what: 'A shared portal fed by LAs, colleges, the funding council and DWP to support post-school transitions — sharing made a legal requirement (Post-16 Education (Scotland) Act 2013), with the centre providing the plumbing and locals feeding and using it.',
    numbers: 'Cut the “destination unknown” cohort to ~6.6%; the annual participation measure runs on it.',
    lesson: 'Where a shared view is genuinely needed (transitions), legislate the PLUMBING and the duty — not central custody of everything.',
    url: 'https://www.skillsdevelopmentscotland.co.uk/what-we-do/scotlands-careers-services/16plus-data-hub/',
  },
];

// ---------------------------------------------------------------------------
// 8 · The sharing ladder — methodologies, from most to least extractive
// ---------------------------------------------------------------------------
export interface LadderRung {
  rung: number;
  name: string;
  how: string;
  custody: string;          // who holds the data
  inEducation: string;      // current education usage
  colour: string;
  opportunity?: boolean;
}

export const SHARING_LADDER: LadderRung[] = [
  {
    rung: 1, name: 'Central extraction', colour: '#b1455e',
    how: 'Named records collected into national databases (census, NPD, daily attendance).',
    custody: 'The centre, indefinitely',
    inEducation: 'The default — almost the entire DfE estate operates here.',
  },
  {
    rung: 2, name: 'Trusted research environments', colour: '#b4632e',
    how: 'De-identified data analysed by accredited researchers inside locked environments under the Five Safes (ONS SRS; ECHILD’s 14.7m-person education↔health linkage).',
    custody: 'The centre holds; access is governed per-project',
    inEducation: 'Mature for research; useless for operations (months of accreditation, years of lag).',
  },
  {
    rung: 3, name: 'Synthetic & safeguarded release', colour: '#9a7b1f',
    how: 'Non-disclosive synthetic twins of sensitive datasets, downloadable under licence — LEO Synthetic (the 39m-person earnings linkage, synthesised) via the UK Data Service, with a standing DfE deposit framework since April 2026.',
    custody: 'The centre holds the real data; everyone can hold the synthetic',
    inEducation: 'New and growing — the right default for method development and teaching.',
  },
  {
    rung: 4, name: 'Federated analytics (data never moves)', colour: '#3f7d6e', opportunity: true,
    how: 'Approved code travels to the data and only results come back — researchers never see raw records. OpenSAFELY runs 200+ NHS projects against GP records held in situ; NHS England issued pilot directions in June 2025.',
    custody: 'The data controller (school, trust, LA) — full stop',
    inEducation: 'DOES NOT EXIST. An OpenSAFELY-for-schools would let DfE answer national questions against MIS-held data without national extraction — the single biggest unbuilt idea in this field study.',
  },
  {
    rung: 5, name: 'Sector-pooled, locally owned', colour: '#2f6f97',
    how: 'Local bodies pool data among themselves on their own legal basis, with shared tools (LIIA’s child-level platform; Data to Insight’s ChAT) — the centre may fund but never holds.',
    custody: 'The sector',
    inEducation: 'Proven in children’s services; barely attempted for schools data.',
  },
];

// ---------------------------------------------------------------------------
// 9 · The agenda collision map — what overlinks with the spine
// ---------------------------------------------------------------------------
export interface Agenda {
  name: string;
  owner: string;
  what: string;
  spineLink: string;       // what it means for education monitoring
  colour: string;
}

export const AGENDAS: Agenda[] = [
  {
    name: 'The data spine + open standards', owner: 'DfE (White Paper, Feb 2026)', colour: '#2f6f97',
    what: '“A secure, privacy-respecting and streamlined way to connect and share information across different systems in education” — plus School Profiles for parents, digital Individual Support Plans for SEND, and every school monitoring belonging & engagement by 2029.',
    spineLink: 'The custody question is unresolved: “easier, more automatic collection” is framed as burden reduction, which critics read as deepening central extraction, not devolving it. No procurement or delivery artefacts published as of June 2026 — the architecture is still choosable.',
  },
  {
    name: 'Single unique identifier', owner: 'CWS Act 2026 / Wigan pilot', colour: '#7a5aa6',
    what: 'The NHS number as the consistent child identifier, piloted in Wigan with LA social-care access anticipated during 2026; a strengthened multi-agency information-sharing duty alongside.',
    spineLink: 'The join key every linkage on this site needs — and the strongest gravitational pull toward central matching. The identifier makes LOCAL sharing easier too; which way it tips depends on the spine’s custody design.',
  },
  {
    name: 'National Data Library', owner: 'DSIT', colour: '#b4632e',
    what: '£100m+ from the spending review; discovery done; five kickstarter projects announced January 2026 — energy bills, work & health, social care, SME guidance, climate.',
    spineLink: 'None of the five kickstarters is education. Either a gap to claim or a dodge to copy — but the NDL will set the cross-government norms (TREs, federation, standards) the spine inherits.',
  },
  {
    name: 'Blueprint for modern digital government', owner: 'DSIT (Jan 2025)', colour: '#566a8c',
    what: 'The six-point plan: join up public-sector services, harness AI, strengthen digital infrastructure — the frame every departmental data programme now reports into.',
    spineLink: '“Join up services” is the licence the spine cites. The blueprint is silent on the central-vs-local custody question — departments are filling that silence one default at a time.',
  },
  {
    name: 'ADR UK 2026–31', owner: 'ESRC (£168m)', colour: '#3f7d6e',
    what: 'The research-linkage funder renewed to 2031, prioritising systematic health-to-admin linkage; the SRS continues indefinitely after the Integrated Data Service stopped taking new research applications (2025).',
    spineLink: 'The research route (rung 2) is secure for a decade. The operational route is the contested one.',
  },
  {
    name: 'AI Opportunities Action Plan', owner: 'No 10 / DSIT (Jan 2025)', colour: '#9a7b1f',
    what: '50 recommendations; education’s named contribution is the DfE Content Store feeding curriculum materials to AI developers; the white paper adds AI tutoring by 2027.',
    spineLink: 'AI tools are the demand side for the spine — and every AI use case will inherit whatever custody and consent posture the spine establishes. Getting the posture right precedes the tools.',
  },
];

// ---------------------------------------------------------------------------
// 10 · The subsidiarity test — when should the centre collect?
// ---------------------------------------------------------------------------
export const SUBSID_TEST: { q: string; ifYes: string; ifNo: string }[] = [
  {
    q: 'Does the purpose require national comparability or national allocation?',
    ifYes: 'Central collection is defensible (funding formulae, statutory accountability, national statistics).',
    ifNo: 'Default to local custody — the centre has no claim.',
  },
  {
    q: 'Can the purpose be met with the data staying where it is?',
    ifYes: 'Use the ladder: federated queries, TRE access, synthetic release, sector pooling — in that order of preference.',
    ifNo: 'Collect the minimum, time-limit it, and publish the share on the register.',
  },
  {
    q: 'Is the consequence attached to the data central or local?',
    ifYes: 'If the centre acts on it (funding, intervention, inspection), the centre owes full ATRS-grade transparency about that use.',
    ifNo: 'If the action is local (a teacher, a caseworker), build LOCAL capability to use it — the Supporting Families pattern, not the extraction pattern.',
  },
  {
    q: 'Would a parent be surprised by this use?',
    ifYes: 'Stop. The 2012–2022 ledger is what “surprised parents” costs: boycotts, reprimands, a decade of rebuilt machinery.',
    ifNo: 'Proceed — and say so publicly anyway.',
  },
];

export const SUBSID_PRINCIPLES = {
  research: 'A non-paternal posture in one paragraph: collect centrally only where national comparability or allocation genuinely requires it; otherwise fund and host sector-owned capability (the Data to Insight pattern); prefer the least-extractive rung of the ladder that meets the purpose; publish every share and every algorithm; and treat schools, trusts and LAs as analytical peers — sources of questions, not just sources of data. The white paper’s spine can still be built either way. The architecture decision IS the posture decision.',
  eli5: 'The fair rule of thumb: the centre should only take data when the whole country genuinely needs the same numbers — like sharing out money. Everything else: pay for good local tools, let councils and schools keep their own data, use clever methods that answer questions without taking copies, and publish everything you do take. Whether the new “data spine” respects that rule is being decided right now.',
};

// ---------------------------------------------------------------------------
// 9 · The shadow estate — the edtech market as an intelligence asset
// (research dossier 2026-06-10: products, data captured, precedents, barriers)
// ---------------------------------------------------------------------------
export const EDTECH_THESIS = {
  research: 'England already runs a de-facto national learning-measurement system: ~1.2m pupils’ reading behaviour (Renaissance), 2m+ secondary maths learners’ question-level work (Sparx), cognitive baselines in two-thirds of secondaries (GL), national writing benchmarks (No More Marking), 400k wellbeing responses a year (Edurio) and a 50%-share MIS group. It is privately owned and consolidating into US/private-equity hands, legally fenced by the processor/controller fiction, technically unjoined for want of standards and an identifier — and published as national intelligence only when a vendor’s marketing calendar or a national crisis demands it.',
  eli5: 'The apps schools already use quietly measure more, more often, than the government ever does — every maths question answered, every book read, every detention logged. But that knowledge belongs to a handful of mostly American-owned companies, the systems don’t talk to each other, and the country only hears about it when a company fancies a press release.',
};

export interface EdtechCategory {
  category: string;
  colour: string;
  entries: { name: string; scale: string; data: string }[];
  signal: string;     // what this category could tell the system
}

export const EDTECH_ESTATE: EdtechCategory[] = [
  {
    category: 'Learning & homework telemetry', colour: '#2f6f97',
    entries: [
      { name: 'Sparx Maths', scale: '~2,600 schools · ~2.2m students', data: 'Question-level responses against a 45,000-item bank; weekly completion benchmarked school-vs-school; already runs a ~96,000-student national Year 7 baseline' },
      { name: 'Eedi', scale: '60,000+ diagnostic questions', data: 'Every wrong answer tagged to a specific misconception — and the field’s best open-data precedent (17m+ answer records released for the NeurIPS 2020 challenge)' },
      { name: 'Satchel One / TT Rock Stars', scale: '~1 in 3 secondaries · 16,000+ schools', data: 'Homework set/submission timing at national scale; per-fact times-tables fluency on most of the KS2 cohort' },
    ],
    signal: 'A live national map of what children can and can’t do, topic by topic, week by week — between the statutory tests.',
  },
  {
    category: 'Reading & assessment', colour: '#3f7d6e',
    entries: [
      { name: 'Renaissance (AR + Star) + GL', scale: '1.21m pupils’ reading · ⅔ of secondaries’ CAT4 · 2m PASS surveys', data: 'Title-level reading volume and comprehension; the de-facto national cognitive baseline; attitudinal surveys — all under one US private-equity roof since the 2023 GL acquisition' },
      { name: 'No More Marking', scale: '112,000-pupil national studies', data: 'Comparative-judgement writing ages, nationally benchmarked six times a year — in the one core subject with NO statutory measure between Year 6 moderation cycles' },
      { name: 'NFER tests / Smartgrade / MARK', scale: '“thousands of schools” termly', data: 'Standardised termly attainment against 60,000-pupil reference samples; nationally benchmarked mock SATs' },
    ],
    signal: 'Termly subject-level attainment signal that already exists — the in-year readout the statutory system lacks.',
  },
  {
    category: 'Behaviour, safeguarding & pastoral', colour: '#b1455e',
    entries: [
      { name: 'Tes (ClassCharts + MyConcern)', scale: 'school counts unpublished', data: 'Arguably England’s largest live behaviour-event dataset plus a major safeguarding log — and Tes has never published a national behaviour-trend analysis from it' },
      { name: 'CPOMS (Raptor, US)', scale: '14,000+ schools at acquisition', data: 'Safeguarding incident logs — acquired by a US school-security firm in 2021 with no public-interest data conditions' },
    ],
    signal: 'The behaviour and safeguarding weather-map nobody publishes — the dogs that didn’t bark.',
  },
  {
    category: 'Engagement, wellbeing & the household edge', colour: '#7a5aa6',
    entries: [
      { name: 'ImpactEd (TEP)', scale: '100,000+ pupils, ~200 schools', data: 'Termly engagement tracking — already shown to predict subsequent absence; documented the “age-11 dip” (enjoyment 6.0→3.2 from Y6 to Y8)' },
      { name: 'Edurio', scale: '~400,000 responses/yr, 2,000+ schools', data: 'The largest national education survey benchmarks in England — staff, pupil and parent voice' },
      { name: 'ParentPay Group (incl. SIMS)', scale: '20,000+ schools · 3.6m payments/day', data: 'Household hardship signal (meal balances, trip non-payment) at national scale — plus, since acquiring ESS, the legacy MIS estate' },
    ],
    signal: 'The leading indicators — engagement and hardship move before attendance and attainment do.',
  },
];

export const EDTECH_PRECEDENTS: { name: string; what: string; eli5: string }[] = [
  {
    name: 'The COVID learning-loss series — the canonical proof',
    what: 'When statutory tests were cancelled, DfE commissioned Renaissance + EPI to measure national learning loss from 400,000+ Star assessments — in-year, regionally broken down, properly reweighted. A commercial platform’s telemetry answered a national question the state’s own instruments could not.',
    eli5: 'During COVID, with exams cancelled, the government simply bought the answer from a homework app’s data — and it worked.',
  },
  {
    name: 'What Kids Are Reading — vendor telemetry as annual national intelligence',
    what: 'Renaissance has published it since 2008; the 2025 edition covers 1.21m pupils and 25m books, tracking the 4% year-on-year decline in reading volume. The longest-running example — driven by a marketing calendar, not a public duty.',
    eli5: 'One company already publishes a yearly national report on what a million children read — because it’s good advertising.',
  },
  {
    name: 'The early-warning prototype already ran',
    what: 'ImpactEd’s Understanding Attendance joined 300,000+ pupils’ attendance records to 80,000 surveys and showed engagement scores predict subsequent absence — a working prototype of the leading-indicator system, built by a social enterprise, not the department.',
    eli5: 'A small research company already proved you can spot children drifting away from school before the register shows it.',
  },
  {
    name: 'The dogs that didn’t bark',
    what: 'Tes has never published national behaviour trends from ClassCharts; no DfE access to Google/Microsoft usage telemetry has ever been evidenced; writing has no statutory in-year measure and the private fill-in (No More Marking) found Year 7s “22 months behind” post-COVID. The richest signals are the least visible.',
    eli5: 'The biggest datasets — behaviour logs, Google Classroom activity — have never produced a single public national insight.',
  },
];

export const EDTECH_BARRIERS: { kind: string; detail: string; eli5: string }[] = [
  {
    kind: 'Commercial enclosure',
    detail: 'The consolidation chain: Renaissance acquired GL (2023), ParentPay acquired ESS/SIMS (2023), Raptor (US) acquired CPOMS (2021), Tes took ClassCharts (2016) and MyConcern (2023), Juniper rolled up 14 assessment products. No acquisition carried public-interest data conditions — the CMA cleared ParentPay/ESS with no data-access remedy. Fragmented per-school procurement means no national licence, therefore no national data terms.',
    eli5: 'A few firms — mostly American-owned — have been buying up the companies that hold children’s learning data, and nobody attached any “the public gets something” strings to the deals.',
  },
  {
    kind: 'Legal fictions and a trust deficit',
    detail: 'Vendors contract as “processors” with schools as “controllers” of processing schools cannot in practice comprehend or control — schools carry the liability, vendors keep the asset. The ICO’s Children’s Code edtech audit programme and defenddigitalme’s April 2026 critique (naming the Content Store and the aggregator pipes) define the scrutiny any new flow inherits — on top of DfE’s own 2020 audit legacy.',
    eli5: 'On paper schools are “in charge” of the data; in reality they can’t see or control what the apps do with it — but they carry the blame. Regulators and campaigners are watching closely.',
  },
  {
    kind: 'No standards, no identifier',
    detail: 'England has no Ed-Fi/Caliper-style interoperability standard in common use; the aggregators (Wonde, Groupcall) are private toll bridges; and the UPN is legally restricted from non-educational use, so platforms key on emails and internal IDs — making cross-platform or platform-to-NPD linkage impossible by design. The data spine’s open-standards commitment is the once-a-decade chance to fix this, and its standards are unspecified as of June 2026.',
    eli5: 'The apps can’t talk to each other and don’t share a common pupil ID — so the pieces can’t be joined even where everyone wants to. The new “data spine” could fix this, if its rules are written right.',
  },
  {
    kind: 'Statistical honesty',
    detail: 'Every platform footprint is self-selected (AR skews primary, Sparx secondary); usage ≠ learning (Sparx’s headline association is correlational); reach ≠ use (Oak: 72% of schools, but only 11–13% of teachers on survey); and platform-gaming is a known practitioner phenomenon with no rigorous England study. National inference requires reweighting against the school census — only the DfE/EPI Star study did it properly.',
    eli5: 'The numbers flatter: schools choose these apps (so they’re not a fair sample), using an app isn’t the same as learning, and children game them. The data is useful — but only with honest statistics.',
  },
];

export const EDTECH_LEVERS: { name: string; what: string }[] = [
  { name: 'A standing in-year telemetry purchase', what: 'Make the COVID Star/EPI model permanent: procure reweighted termly readouts from the big panels (Star, Sparx baselines, GL, NMM) — with WRITING, the subject with no statutory measure, the highest-value gap to fill first.' },
  { name: 'An early-warning pilot, aggregates first', what: 'Homework-submission decay + behaviour-event drift, joined to the daily attendance feed AT SCHOOL LEVEL — the leading-indicator stack ImpactEd prototyped, designed deliberately below the individual-flagging threshold the failure gallery warns about.' },
  { name: 'A national misconception map', what: 'Eedi’s tagged misconceptions + Sparx’s question-level analysis against Oak’s open curriculum taxonomy: which specific errors are rising, by year group and region — a thing no statutory instrument can see, and Eedi’s NeurIPS release proves shareable.' },
  { name: 'Testbeds as evaluation infrastructure', what: 'The £23m EdTech Testbeds (1,000+ schools from Sept 2026) plus EEF’s platform trials make platforms the cheapest RCT vehicle in education. The design choice to influence NOW: standardised outcome measurement across products.' },
  { name: 'The procurement lever — a “WKAR clause”', what: 'Through the spine’s standards and framework listing, not legislation: open export APIs as a condition of listing; school-controlled portability; and an aggregate-statistics duty on vendors above a usage threshold — if you hold half a million pupils’ data, you publish audited national aggregates annually.' },
];
