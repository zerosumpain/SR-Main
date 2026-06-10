// monitoring.ts — verified data for the "Monitoring" Field Study page (/monitor) and
// shared with the NEET page (/neet). Every figure here is drawn from the adversarially
// fact-checked research dossier; URLs are the single best primary source per claim.
// Self-contained: never imported from outside this route folder.
//
// Honesty rules baked into the copy that consumes this (do not contradict them):
//  • The DfE "data spine" is an ANNOUNCED COMMITMENT, not a built system (no architecture
//    or delivery date published as of June 2026). The attendance feed is TWICE-DAILY batch,
//    not real-time. The data spine and the consistent identifier are DISTINCT instruments.

export type Status = 'full' | 'partial' | 'research' | 'planned';

/** The English policy timeline that put the spine + join key on the table. */
export interface TimelineEvent {
  date: string;        // display date
  t: number;           // 0..1 position on the axis (chronological)
  title: string;
  what: string;
  eli5: string;
  tag: 'spine' | 'identifier' | 'attendance' | 'ai';
  url: string;
}

export const TIMELINE: TimelineEvent[] = [
  {
    date: '2024/25', t: 0.0, tag: 'attendance',
    title: 'Daily attendance sharing made mandatory',
    what: 'Every state school must share daily attendance to DfE; a fortnightly national dashboard follows. The one live, near-real-time signal the rest of the plan builds on.',
    eli5: 'Schools start sending their attendance registers to the government every day.',
    url: 'https://www.gov.uk/government/publications/monitor-your-school-attendance-user-guide/monitor-your-school-attendance-user-guide',
  },
  {
    date: '27 Nov 2025', t: 0.28, tag: 'ai',
    title: '“Similar schools” attendance algorithm logged on the ATRS',
    what: 'A deployed DfE model assigns each school its 20 most-similar peers (gradient-boosted trees for variable selection, then weighted Euclidean distance) and returns half-termly comparison reports.',
    eli5: 'A tool quietly compares your school to the 20 most-similar schools and flags things to look at.',
    url: 'https://www.gov.uk/algorithmic-transparency-records/dfe-attendance-reports-using-similar-schools',
  },
  {
    date: '21 Jan 2026', t: 0.5, tag: 'spine',
    title: 'Data spine announced at Bett',
    what: 'Education Secretary Bridget Phillipson names “a new data spine and open data standards” as the fourth of five AI/digital goals — “unlocking insights previously trapped in closed systems”.',
    eli5: 'The minister announces a plan to wire the school system’s databases together.',
    url: 'https://www.gov.uk/government/speeches/education-secretary-speech-at-bett-uk-conference',
  },
  {
    date: '23 Feb 2026', t: 0.66, tag: 'spine',
    title: 'Schools White Paper commits to it',
    what: '“Every Child Achieving and Thriving” (CP 1508-I): “We will develop a new data spine … to connect and share information across different systems in education” — pupil records, attendance, progress, assessments. Verbs are all future tense.',
    eli5: 'The promise is written into a formal government plan — but it’s still a promise, not a built thing.',
    url: 'https://assets.publishing.service.gov.uk/media/69972c02bfdab2546272c007/Every_child_achieving_and_thriving_print_ready_version.pdf',
  },
  {
    date: '29 Apr 2026', t: 0.84, tag: 'identifier',
    title: 'Consistent identifier becomes law',
    what: 'The Children’s Wellbeing and Schools Act 2026 (c.21) inserts ss.16LA–16LD into the Children Act 2004: an information-sharing duty, standards, a single “consistent identifier” for each child, and a code of practice. The Act does NOT name the NHS number.',
    eli5: 'A new law creates one reference number per child so services can tell they mean the same kid.',
    url: 'https://www.legislation.gov.uk/ukpga/2026/21/enacted',
  },
  {
    date: 'mid-2026', t: 1.0, tag: 'spine',
    title: 'Pre-delivery: the design is still open',
    what: 'DfE digital leadership now owns delivery of the spine and the single-identifier policy together — but as of June 2026 no architecture, procurement or delivery plan has been published. The custody question (connect vs collect) remains undecided.',
    eli5: 'The government has put people in charge of building the spine — but nothing has been designed or bought yet, so the big choices are still open.',
    url: 'https://dfedigital.blog.gov.uk/',
  },
];

/** The two instruments people conflate. Kept strictly distinct per the dossier cautions. */
export const SPINE = {
  name: 'The DfE “data spine”',
  kind: 'Connectivity + standards layer — WITHIN education',
  legal: 'Policy commitment (Bett speech; White Paper)',
  scope: 'Pupil records, attendance, progress, assessments — connecting datasets DfE already runs (NPD, censuses, the attendance feed, Explore Education Statistics).',
  status: 'Announced, not built — no architecture or delivery date published (June 2026).',
  eli5: 'Better wiring so the school system’s own databases finally talk to each other.',
  url: 'https://assets.publishing.service.gov.uk/media/69972c02bfdab2546272c007/Every_child_achieving_and_thriving_print_ready_version.pdf',
};
export const IDENTIFIER = {
  name: 'The “consistent identifier”',
  kind: 'Cross-service join key — ACROSS education, health, social care, police',
  legal: 'Statutory (Children Act 2004 ss.16LA–16LD, inserted 2026)',
  scope: 'One reference number per child so datasets can be matched to the same child for safeguarding and welfare.',
  status: 'In law; the number itself set later by regulations. NHS number is policy intent, piloted in Wigan — NOT named in the Act.',
  eli5: 'A name-tag number that makes the wiring useful across different services.',
  url: 'https://www.legislation.gov.uk/ukpga/2026/21/enacted',
};

/** The four arcs of a working feedback loop (AI-in-the-loop diagram). */
export interface LoopArc { key: string; label: string; eli5: string; detail: string; colour: string; }
export const LOOP: LoopArc[] = [
  { key: 'collect', label: 'Collect', eli5: 'Gather what’s happening', colour: '#2f6f97',
    detail: 'The spine + the twice-daily attendance feed turn scattered records into one connected surface.' },
  { key: 'analyse', label: 'Ground & analyse', eli5: 'Make sense of it', colour: '#3f7d6e',
    detail: 'The “similar-schools” algorithm flags outliers; a curriculum content store grounds AI (92% accuracy vs 67% ungrounded); “Consult” themes consultation text ~120× faster.' },
  { key: 'evaluate', label: 'Evaluate', eli5: 'Did it actually work?', colour: '#9a7b1f',
    detail: 'The Evaluation Registry (1,400+ studies, mandatory since 2024) + EEF trials linked to the National Pupil Database give causal “what works” evidence.' },
  { key: 'decide', label: 'Decide & adjust', eli5: 'Change course', colour: '#b4632e',
    detail: 'Faster, honest feedback lets policy correct within a child’s school career — not a decade later. The missing official piece: a research-backed policy simulator like this one.' },
];

/** International data-infrastructure comparators (the "data spine" equivalents). */
export interface InfraRow {
  country: string; flag: string; system: string;
  mechanism: string; result: string; lesson: string;
  sourceUrl: string;
  cells: Record<'id' | 'cross' | 'live' | 'gate', { label: string; level: Status }>;
}

export const INFRA: InfraRow[] = [
  {
    country: 'Estonia', flag: '🇪🇪', system: 'X-Road + EHIS + AI Leap',
    mechanism: 'Decentralised registers exchange data over X-Road on the once-only principle; the EHIS education register links 20+ state systems. Schools are only funded if EHIS data are complete and non-duplicated.',
    result: 'Funding-by-data discipline keeps records clean; X-Road credited with ~1,407 working-years saved a year. AI Leap (Sept 2025) adds AI tutoring across ~154 schools.',
    lesson: 'Tie data quality to money. England’s spine has no equivalent enforcement hook — “connected” data can still be stale.',
    sourceUrl: 'https://ncee.org/building-an-integrated-data-system-lessons-from-estonia/',
    cells: { id: { label: 'isikukood', level: 'full' }, cross: { label: 'X-Road, 20+ registers', level: 'full' }, live: { label: 'EHIS, K→uni', level: 'full' }, gate: { label: 'State, once-only', level: 'full' } },
  },
  {
    country: 'New Zealand', flag: '🇳🇿', system: 'Integrated Data Infrastructure (IDI)',
    mechanism: 'A de-identified whole-population spine (~10m ever-resident people) links education, health, benefits, justice, income and housing, gated by a public-good test and the Five Safes framework.',
    result: 'The international gold standard for cross-sector longitudinal policy analysis, including NEET and life-course research.',
    lesson: 'Linkage can be powerful AND privacy-respecting if access is gated rather than open — a model for governing the spine’s analytical use.',
    sourceUrl: 'https://www.stats.govt.nz/integrated-data/integrated-data-infrastructure/',
    cells: { id: { label: 'linked spine', level: 'full' }, cross: { label: 'whole-of-government', level: 'full' }, live: { label: 'research only', level: 'research' }, gate: { label: 'Five Safes', level: 'full' } },
  },
  {
    country: 'Netherlands', flag: '🇳🇱', system: 'DUO / ROD + onderwijsnummer (= BSN)',
    mechanism: 'One lifelong learner number, equal to the national BSN, tracks a pupil across primary, secondary, vocational and higher education. Built originally to combat early school-leaving.',
    result: 'A single durable identifier underpins all funded education — the participation backbone England lacks.',
    lesson: 'A lifelong learner ID is the join key that makes longitudinal “did it work?” answerable. England’s nearest analogue is safeguarding-scoped and still in pilot.',
    sourceUrl: 'https://www.rijksoverheid.nl/contact/contactgids/duo-register-onderwijsdeelnemers-rod',
    cells: { id: { label: 'onderwijsnummer', level: 'full' }, cross: { label: 'via BSN', level: 'partial' }, live: { label: 'ROD, all funded ed', level: 'full' }, gate: { label: 'DUO', level: 'full' } },
  },
  {
    country: 'Denmark / Norway', flag: '🇩🇰', system: 'CPR / personnummer + statistics registers',
    mechanism: 'A universal civic ID (since 1968) lets the national statistics office run whole-population education registers — Denmark’s from 1974/1981 — linkable to income, health and welfare; de-identified researcher access under GDPR.',
    result: 'Decades-deep, whole-population longitudinal education data linkable across domains via one civic number.',
    lesson: 'Time-depth compounds: an identifier introduced now yields its richest insight a generation later. The value of starting is that it starts the clock.',
    sourceUrl: 'https://www.dst.dk/en/TilSalg/data-til-forskning/generelt-om-data/data-fra-andre-kilder',
    cells: { id: { label: 'CPR (1968)', level: 'full' }, cross: { label: 'income/health/welfare', level: 'full' }, live: { label: 'registers from 1974', level: 'full' }, gate: { label: 'GDPR de-identified', level: 'full' } },
  },
  {
    country: 'Singapore', flag: '🇸🇬', system: 'Student Learning Space + Singpass',
    mechanism: 'A national learning-plus-analytics platform (2018) gives every student curriculum-aligned resources and teachers visibility into thinking; AI features include adaptive learning. Sign-in via the national ID stack.',
    result: '~500,000 users (up to 300,000 concurrent during COVID); adaptive learning live in Maths and Geography.',
    lesson: 'A single national platform doubles as a monitoring surface — but couples tightly to a national ID, so the surveillance/consent questions are front-loaded.',
    sourceUrl: 'https://www.tech.gov.sg/technews/ai-in-education-transforming-singapore-education-system-with-student-learning-space/',
    cells: { id: { label: 'Singpass', level: 'full' }, cross: { label: 'platform-bound', level: 'partial' }, live: { label: 'SLS, ~500k users', level: 'full' }, gate: { label: 'national-ID coupled', level: 'partial' } },
  },
  {
    country: 'Australia', flag: '🇦🇺', system: 'PLIDA + Unique Student Identifier',
    mechanism: 'PLIDA combines health, education, payments, income and Census via a Person Linkage Spine that keeps keys separate (access via the ABS DataLab); the USI is a mandatory lifelong education ID across VET and higher ed.',
    result: 'A national research-linkage asset plus an authenticated training transcript and one number across all training and university.',
    lesson: 'Separation-of-keys — linkage without a single master file — is a privacy-by-design template for a spine: link for analysis without one all-seeing database.',
    sourceUrl: 'https://www.abs.gov.au/about/data-services/data-integration/integrated-data/person-level-integrated-data-asset-plida',
    cells: { id: { label: 'USI', level: 'full' }, cross: { label: 'PLIDA, keys separate', level: 'full' }, live: { label: 'USI live / PLIDA research', level: 'partial' }, gate: { label: 'ABS DataLab', level: 'full' } },
  },
  {
    country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', system: 'Data spine + consistent identifier',
    mechanism: 'A connectivity/standards layer over datasets DfE already runs, plus a separate statutory cross-service identifier for safeguarding. Both overseen by the same new DG.',
    result: 'Announced (Bett, Jan 2026) and committed (White Paper, Feb 2026); the identifier is in law (Apr 2026). No architecture or delivery date published.',
    lesson: 'England is a relative latecomer — assembling, belatedly, the participation backbone its comparators have run for years.',
    sourceUrl: 'https://assets.publishing.service.gov.uk/media/69972c02bfdab2546272c007/Every_child_achieving_and_thriving_print_ready_version.pdf',
    cells: { id: { label: 'in pilot', level: 'planned' }, cross: { label: 'identifier in law', level: 'planned' }, live: { label: 'attendance feed only', level: 'partial' }, gate: { label: 'TBD', level: 'planned' } },
  },
];

export const INFRA_COLS: { key: 'id' | 'cross' | 'live' | 'gate'; label: string }[] = [
  { key: 'id', label: 'One ID for life' },
  { key: 'cross', label: 'Links across services' },
  { key: 'live', label: 'Live in education' },
  { key: 'gate', label: 'Access / governance' },
];

export const STATUS_META: Record<Status, { colour: string; ring: string; note: string }> = {
  full: { colour: '#2f7d4f', ring: 'rgba(47,125,79,0.16)', note: 'operational' },
  partial: { colour: '#9a7b1f', ring: 'rgba(154,123,31,0.16)', note: 'partial' },
  research: { colour: '#4a7c7c', ring: 'rgba(74,124,124,0.16)', note: 'research-gated' },
  planned: { colour: '#b1455e', ring: 'rgba(177,69,94,0.16)', note: 'announced / in build' },
};

// ---- The ethics half (shared by both pages) ----

/** Wisconsin DEWS false-alarm rate by group — the flagship cautionary case. */
export const DEWS_BARS = [
  { group: 'White students', rel: 0, note: 'baseline false-alarm rate' },
  { group: 'Hispanic students', rel: 18, note: '+18pp higher false-alarm rate' },
  { group: 'Black students', rel: 42, note: '+42pp higher false-alarm rate' },
];

export const GUARDRAILS: { do: string; why: string }[] = [
  { do: 'Human in the loop', why: 'A flag is a prompt to check in, never a solely-automated verdict (UK GDPR Arts. 22A–22D, post-DUAA 2025).' },
  { do: 'DPIA + best interests', why: 'Profiling children requires a Data Protection Impact Assessment; the best-interests-of-the-child principle must prevail (ICO).' },
  { do: 'No race or proxies in the model', why: 'DEWS used race and free-lunch status as inputs and entrenched the bias it meant to fix.' },
  { do: 'Bias audit before deployment', why: 'Wisconsin knew the predictions were unfair from 2021 and ran them anyway.' },
  { do: 'Transparency on the ATRS', why: 'The Algorithmic Transparency Recording Standard is mandatory across central government (100+ records by early 2026).' },
  { do: 'Opt-outs, proportionality, minimisation', why: 'Collect the least needed; let families opt out; avoid function creep (cf. the ICO’s facial-recognition reprimand in schools).' },
  { do: 'Screen IN, not OUT', why: 'NCES, Cedefop and UNICEF agree: target support, never punish or withhold. The flag says “a school is failing this child”, not “this child will fail”.' },
];

/** Headline numbers for stat callouts. */
export const KEY_STATS = [
  { big: '92% vs 67%', label: 'DfE-tested AI accuracy grounded in the curriculum content store vs ungrounded', url: 'https://www.gov.uk/government/news/teachers-to-get-more-trustworthy-ai-tech-as-generative-tools-learn-from-new-bank-of-lesson-plans-and-curriculums-helping-them-mark-homework-and-save' },
  { big: 'Twice daily', label: 'How often the DfE attendance feed refreshes from school systems — near-daily batch, not real-time', url: 'https://www.gov.uk/government/publications/monitor-your-school-attendance-user-guide/monitor-your-school-attendance-user-guide' },
  { big: '20 schools', label: 'Most-similar peers each school is benchmarked against by the deployed DfE attendance algorithm', url: 'https://www.gov.uk/algorithmic-transparency-records/dfe-attendance-reports-using-similar-schools' },
  { big: '~74% wrong', label: 'Wisconsin DEWS false-alarm rate when predicting a student will NOT graduate', url: 'https://themarkup.org/machine-learning/2023/04/27/false-alarm-how-wisconsin-uses-race-and-income-to-label-students-high-risk' },
  { big: '1,407 yrs', label: 'Working-years saved per year by Estonia’s X-Road data-exchange layer (2018)', url: 'https://cyber.ee/resources/news/saving-1407-years-of-working-time-in-estonia/' },
  { big: '1,400+', label: 'Evaluations in the Evaluation Registry, mandatory for departments since April 2024', url: 'https://civilservice.blog.gov.uk/2025/03/31/public-launch-of-the-evaluation-registry/' },
];
