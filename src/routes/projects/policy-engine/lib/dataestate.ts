// dataestate.ts — the NEET-relevant slice of the education data estate, triaged:
// what exists and is proven, what exists but is underused, and what is missing.
// Each node carries its latency, access route and the strategic gap. Self-contained.

export type EstateTier = 'proven' | 'underused' | 'missing';
export type EstateStage = 'pre16' | 'transition' | 'post18';
export type AccessTier = 'open' | 'secure' | 'mixed';

export interface EstateNode {
  id: string;
  name: string;
  tier: EstateTier;
  stage: EstateStage;
  latency: string;       // how stale the data is when usable
  access: string;        // who can touch it, via what route
  accessTier?: AccessTier; // open vs secure (vs mixed) — the headline access fact
  who?: string;          // who runs / publishes it
  blurb: string;         // what it is + why it matters (research register)
  blurbEli5: string;
  limitation?: string;   // the key limitation (neutral, analytical)
  gap?: string;          // the strategic gap line (shown emphasised)
  links: string[];       // ids of nodes it links to TODAY
  // lever-awareness: which engine levers / outcomes this instrument would EVIDENCE.
  // (read-only references to ids in levers.ts / the engine; this module never edits them.)
  evidences?: { levers?: string[]; outcomes?: string[]; note: string };
  refs?: { label: string; url: string }[]; // org — title — year, in label
}

export const ESTATE: EstateNode[] = [
  // ---------------- pre-16 ----------------
  {
    id: 'census', name: 'School census / NPD', tier: 'proven', stage: 'pre16',
    latency: 'Termly collection; analytical extracts months later',
    access: 'DfE internal; researchers via ONS SRS accreditation', accessTier: 'secure',
    who: 'DfE — record-level National Pupil Database (state-funded schools in England)',
    blurb: 'The backbone: child-level demographics, FSM, IDACI, SEND, absence and exclusions for every state pupil, feeding the National Pupil Database back to 2002. Personal-level access is approved by DfE’s Data Sharing Approval Panel (DSAP) and now defaults to the ONS Secure Research Service rather than data extracts.',
    blurbEli5: 'The big register: every state-school pupil’s basic details, free-school-meal status, area deprivation, special needs and absence, collected each term. Researchers can only use it inside a locked, approved environment.',
    limitation: 'Record-level data is not open: a high access bar and long lead times. England state sector only (independent schools largely excluded). The separate "Find and explore data in the NPD" catalogue shows which items EXIST — not the data itself.',
    evidences: { outcomes: ['gapKS4'], levers: ['pupil_premium', 'fsm'], note: 'The pupil-level join on which FSM/IDACI disadvantage splits and the gapKS4 outcome are built.' },
    refs: [{ label: 'OSR — Response on National Pupil Database Access (2024)', url: 'https://osr.statisticsauthority.gov.uk/correspondence/response-on-national-pupil-database-access-2/' }],
    links: ['attainment', 'leo', 'echild', 'datafirst', 'attendance', 'idaci', 'apcensus'],
  },
  {
    id: 'attendance', name: 'Daily attendance feed', tier: 'proven', stage: 'pre16',
    latency: 'Near-real-time — session-level codes extracted from school MIS daily',
    access: 'DfE + school-facing dashboards; mandatory since Sept 2024',
    accessTier: 'mixed',
    who: 'DfE — daily session-level feed from school MIS (statutory since Sept 2024)',
    blurb: 'The newest near-real-time asset: daily session-level attendance from ~all state schools via the Wonde pipe. DfE runs a published similar-schools benchmarking model on it — at SCHOOL level only.',
    blurbEli5: 'Since 2024 the government sees every school’s attendance every day — but uses it to compare schools, not to spot individual children drifting.',
    limitation: 'Used for school-level benchmarking only; no individual in-year early-warning use, and no post-16 equivalent exists.',
    evidences: { levers: ['attendance'], outcomes: ['gapKS4'], note: 'The live evidence base for the attendance lever; EPI associates the post-2019 growth in gapKS4 with rising disadvantaged absence.' },
    gap: 'Not used for individual in-year early warning — a high-value unused signal for NEET risk.',
    links: ['census'],
  },
  {
    id: 'attainment', name: 'Attainment (KS2/KS4)', tier: 'proven', stage: 'pre16',
    latency: 'Annual, published ~6 months after exams',
    access: 'Public aggregates; pupil-level in NPD via SRS', accessTier: 'mixed',
    who: 'DfE / Standards & Testing Agency — published via Explore Education Statistics',
    blurb: 'KS2 and KS4 results — with absence and EHCP status, among the strongest NEET predictors in DfE’s May-2026 risk-factor analysis, observable years before 16.',
    blurbEli5: 'Test and GCSE results. Together with absence, these are among the best early predictors of who becomes NEET.',
    limitation: 'Annual snapshot, no in-year signal; the disadvantage definition (FSM-Ever6) misses the just-above-threshold poor.',
    evidences: { outcomes: ['gapKS4', 'gapAge3'], levers: ['reading', 'curriculum'], note: 'The measured base for the KS4 disadvantage gap (gapKS4) the engine projects.' },
    links: ['census', 'leo', 'destinations'],
  },
  {
    id: 'imd', name: 'IMD (Indices of Deprivation)', tier: 'proven', stage: 'pre16',
    latency: 'Static between editions — current edition is IoD2019 (2019-vintage)',
    access: 'Open — scores, ranks and deciles published free at LSOA level', accessTier: 'open',
    who: 'MHCLG (Ministry of Housing, Communities & Local Government) — English Indices of Deprivation',
    blurb: 'The relative small-area deprivation measure that contextualises the whole estate. IoD2019 ranks all 32,844 Lower-layer Super Output Areas (≈1,500 residents each) on seven weighted domains: Income (22.5%) and Employment (22.5%) — 45% of the weight — then Education (13.5%), Health (13.5%), and Crime / Barriers to Housing & Services / Living Environment (9.3% each). Areas are split into deciles: decile 1 = the 10% most deprived.',
    blurbEli5: 'A government ranking of how deprived each small neighbourhood is, built from seven things (mostly income and jobs). Areas are sorted into ten bands — band 1 is the most deprived 10%.',
    limitation: 'Relative, not absolute (a rank, not a deprivation level), and area-based, not person-based — an affluent family in a deprived area is scored as deprived and vice-versa. IoD2019 is ~7 years old, predating the COVID and cost-of-living periods; a refresh is anticipated but not yet operative.',
    evidences: { outcomes: ['childPoverty', 'gapKS4'], levers: ['poverty_action', 'place_investment'], note: 'The small-area deprivation backbone behind the place-based and poverty levers.' },
    refs: [{ label: 'MHCLG — English Indices of Deprivation 2019: Statistical Release', url: 'https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/835115/IoD2019_Statistical_Release.pdf' }],
    links: ['idaci'],
  },
  {
    id: 'idaci', name: 'IDACI (child income deprivation)', tier: 'proven', stage: 'pre16',
    latency: 'Static between editions (IoD2019); attached to pupils via the NPD',
    access: 'Open at area level; pupil-level IDACI sits inside the secure NPD', accessTier: 'mixed',
    who: 'MHCLG — the Income Deprivation Affecting Children Index, a supplementary index within IoD2019',
    blurb: 'The disadvantage backbone for schools data: a child-specific subset of the Income Deprivation domain measuring the share of children aged 0–15 in income-deprived families in each of the 32,844 LSOAs. DfE attaches an IDACI score to each pupil’s home postcode in the NPD, and it feeds the National Funding Formula deprivation factor, DfE/EES statistical breakdowns (absence, attainment, EYFSP by IDACI decile) and contextual performance analysis.',
    blurbEli5: 'Like the deprivation index, but counting only children in low-income families. The government tags every pupil with their area’s score, and it helps decide school funding and how results are broken down by deprivation.',
    limitation: 'A postcode-area proxy, not a measure of the individual child’s family income — and not the same as Free School Meals eligibility; the two diverge and capture different cohorts, which FFT Education Datalab and others caution against conflating.',
    evidences: { outcomes: ['gapKS4', 'childPoverty'], levers: ['pupil_premium', 'fsm', 'eypp'], note: 'One of the two deprivation lenses (with FSM) used to band funding and split outcomes by disadvantage.' },
    refs: [
      { label: 'MHCLG — IoD2019 FAQs (domains, weights, deciles, IDACI)', url: 'https://assets.publishing.service.gov.uk/media/5dfb3d7ce5274a3432700cf3/IoD2019_FAQ_v4.pdf' },
      { label: 'FFT Datalab — The 2019 Income Deprivation Affecting Children Index', url: 'https://ffteducationdatalab.org.uk/2019/09/the-2019-income-deprivation-children-index/' },
    ],
    links: ['imd', 'census'],
  },
  {
    id: 'gias', name: 'GIAS (Get Information About Schools)', tier: 'proven', stage: 'pre16',
    latency: 'Live register; updated continuously',
    access: 'Open — free bulk CSV downloads and search', accessTier: 'open',
    who: 'DfE — the official register of educational establishments in England',
    blurb: 'The reference spine for almost every other school dataset: every school/college/MAT with its URN, name, type, phase, open/closed status, location, capacity, governance, trust links and Ofsted keys. The URN is the canonical join key across the estate.',
    blurbEli5: 'The official list of every school — its ID number, type, address and who runs it. It’s the key that lets other datasets be joined to the right school.',
    limitation: 'Reference/administrative data, not outcomes — it records which schools exist, not how they perform; large all-establishment bulk CSV exports have historically been unreliable (time-outs / 500s).',
    evidences: { levers: ['teachers'], note: 'The reference layer every school-level outcome and workforce figure is keyed to.' },
    refs: [{ label: 'DfE — Get Information About Schools', url: 'https://get-information-schools.service.gov.uk/' }],
    links: ['census', 'eesapi'],
  },
  {
    id: 'apcensus', name: 'Alternative Provision census', tier: 'underused', stage: 'pre16',
    latency: 'Statutory collection; aggregate tables via EES, pupil-level in NPD',
    access: 'Open aggregates via EES; pupil-level is secure (part of NPD)', accessTier: 'mixed',
    who: 'DfE — statutory data collection on pupils in alternative provision',
    blurb: 'Pupil-level records of LA-commissioned alternative provision — education arranged for children who, through permanent exclusion, illness or other reasons, would not otherwise receive suitable education and are not on a maintained school’s roll.',
    blurbEli5: 'A record of children placed in alternative provision by councils — for example after exclusion or long illness — instead of a mainstream school.',
    limitation: 'A known undercount: it captures LA-commissioned AP and misses much school-commissioned or unregistered AP, so it understates the true AP population — a long-standing data gap.',
    evidences: { outcomes: ['neet'], levers: ['behaviour_support', 'inclusion_fund'], note: 'The (partial) measure of the highest-NEET-risk excluded cohort.' },
    refs: [{ label: 'DfE — Alternative provision census: technical specification (2025)', url: 'https://www.gov.uk/government/publications/alternative-provision-census-technical-specification' }],
    links: ['census'],
  },
  {
    id: 'fft', name: 'FFT Education Datalab', tier: 'underused', stage: 'pre16',
    latency: 'Publishes on its own cadence (blog/reports), incl. results-day analysis',
    access: 'Open — free public blog and reports; secure-data work under DfE/ONS approvals', accessTier: 'open',
    who: 'Independent research unit within the non-profit FFT (Fischer Family Trust)',
    blurb: 'Independent analysts who re-analyse public DfE/GIAS data and (under approval) secure NPD data, publishing accessible trend pieces on schools, MATs, attainment, absence and deprivation — including results-day analysis with the Nuffield Foundation and method critiques.',
    blurbEli5: 'An independent team that digs into the government’s school data and explains the trends in plain language — not an official statistics producer, but a widely-cited interpreter.',
    limitation: 'Independent commentary, not official statistics — valuable for interpretation and method-checking rather than as a primary source for headline figures.',
    evidences: { outcomes: ['gapKS4', 'persistentAbsence'], levers: ['attendance', 'pupil_premium'], note: 'A third-party interpretive lens on the attendance and disadvantage-gap evidence.' },
    refs: [{ label: 'FFT Education Datalab — home', url: 'https://ffteducationdatalab.org.uk/' }],
    links: ['census', 'gias'],
  },
  // ---------------- 16–18 transition ----------------
  {
    id: 'nccis', name: 'NCCIS / CCIS (LA tracking)', tier: 'proven', stage: 'transition',
    latency: 'Monthly LA returns; annual statistics',
    access: 'LAs (statutory duty); DfE aggregates', accessTier: 'mixed',
    who: 'Local authorities (statutory duty) → DfE aggregates',
    blurb: 'The statutory tracking system: every LA must track 16–17-year-olds’ activity (to 25 with an EHCP) and run the September Guarantee. Since Jan 2025 it also generates the national RONI at-risk lists.',
    blurbEli5: 'Councils must keep track of what every 16–17-year-old is doing — the system meant to identify school-leavers before they disengage.',
    limitation: 'The duty to track stops at 18 (dropped 2016), where measured NEET prevalence is highest. "Activity not known" rates vary widely between LAs, so local comparisons are not like-for-like.',
    evidences: { outcomes: ['neet'], levers: ['youth_guarantee', 'careers_gatsby'], note: 'The administrative source for 16–17 NEET status and the September Guarantee.' },
    gap: 'The duty to track 18-year-olds was dropped in 2016 — measured NEET prevalence is highest at 18–24, where no body holds a tracking duty.',
    links: ['destinations'],
  },
  {
    id: 'eesapi', name: 'Explore Education Statistics (EES) + API', tier: 'underused', stage: 'transition',
    latency: 'As fast as the underlying publication (e.g. attendance fortnightly)',
    access: 'Open — published aggregate datasets, no auth; public REST API', accessTier: 'open',
    who: 'DfE — the official statistics dissemination platform and its public REST API (open-source on GitHub)',
    blurb: 'The delivery layer for DfE’s published statistics — absence, exclusions, attainment, EYFS, KS2/KS4, participation/NEET, AP, SEN, workforce. The public API (api.education.gov.uk/statistics) serves published aggregate datasets programmatically (REST, JSON, standard HTTP verbs).',
    blurbEli5: 'The government’s public website and machine-readable feed for education statistics — anyone can download the numbers, or pull them automatically through the API.',
    limitation: 'Exposes published aggregates only, not record-level data (that is the secure NPD). The API is dataset-versioned and still maturing; practical pitfalls include small page-size limits and careful handling of "Total"-row semantics.',
    evidences: { outcomes: ['neet', 'gapKS4', 'persistentAbsence'], note: 'The open route through which almost every published outcome on this site is accessible.' },
    refs: [{ label: 'DfE — Explore Education Statistics API (overview)', url: 'https://api.education.gov.uk/statistics/docs/overview/' }],
    links: ['gias', 'attainment'],
  },
  {
    id: 'dwp', name: 'DWP Stat-Xplore / ONS NOMIS', tier: 'underused', stage: 'transition',
    latency: 'Benefits data near-current; Census/labour-market periodic',
    access: 'Open — interactive tabulation plus standards-based REST/JSON APIs', accessTier: 'open',
    who: 'DWP (Stat-Xplore — benefits) and ONS (NOMIS — labour-market & Census)',
    blurb: 'The benefits- and labour-market context for education deprivation. Stat-Xplore exposes Universal Credit and other benefits data via an Open Data JSON API; NOMIS hosts ONS labour-market, economic-activity and small-area Census data (and some DWP series) with its own API. Both contextualise child-poverty and local economic conditions.',
    blurbEli5: 'Two open government data services — one for benefits (DWP), one for jobs and the Census (ONS) — that fill in the money and work picture around schools.',
    limitation: 'Geographies and definitions differ from DfE’s; benefit-caseload data is not poverty/deprivation directly, and aligning DWP/ONS geographies to school catchments requires care.',
    evidences: { outcomes: ['childPoverty', 'neet'], levers: ['poverty_action', 'housing_instability'], note: 'The open admin signal behind a near-real-time poverty nowcast the engine’s poverty levers reference.' },
    refs: [
      { label: 'DWP — Stat-Xplore Open Data API', url: 'https://stat-xplore.dwp.gov.uk/webapi/online-help/Open-Data-API.html' },
      { label: 'ONS — NOMIS labour-market statistics', url: 'https://www.nomisweb.co.uk/' },
    ],
    links: ['nccis'],
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
    access: 'Published at school/college level', accessTier: 'open',
    who: 'DfE — NPD↔ILR↔HESA matched, published at school/college level',
    blurb: 'NPD↔ILR↔HESA matched “sustained destination” measures after KS4/KS5 — an accountability instrument rather than an operational one.',
    blurbEli5: 'Where each school’s leavers ended up — published more than a year later, after the point at which it could inform action.',
    limitation: 'A ~15-month lag by design; no operational (in-year) version of the measure exists.',
    evidences: { outcomes: ['neet'], levers: ['post16_skills', 'apprenticeships'], note: 'The sustained-destination outcome the post-16 levers aim to move.' },
    gap: 'Too late to act on by design; no operational version of this measure currently exists.',
    links: ['nccis', 'ilr', 'attainment', 'graduateoutcomes'],
  },
  {
    id: 'post16rt', name: 'Post-16 real-time signal', tier: 'missing', stage: 'transition',
    latency: '—',
    access: '—',
    blurb: 'No FE/training equivalent of the daily attendance feed exists. The transition with the highest measured NEET risk — the summer after Year 11 into the autumn term — is observed only retrospectively.',
    blurbEli5: 'Schools report attendance daily; colleges don’t. So the transition with the highest measured drop-out risk — the summer after GCSEs — is observed only months later.',
    limitation: 'Does not exist: no instrument provides an in-year participation signal for 16–18s in FE and training.',
    evidences: { outcomes: ['neet'], levers: ['post16_skills'], note: 'The instrument that would evidence 16–18 disengagement in time to act.' },
    gap: 'The absent pipe: a daily/weekly participation signal for 16–18s in FE and training.',
    links: [],
  },
  // ---------------- 18–24 ----------------
  {
    id: 'leo', name: 'LEO (earnings linkage)', tier: 'underused', stage: 'post18',
    latency: 'Years (tax-year cycles)',
    access: 'Accredited researchers via ONS SRS / ADR UK', accessTier: 'secure',
    who: 'DfE / HMRC / DWP — Longitudinal Education Outcomes linkage (~38m people)',
    blurb: 'NPD + FE + HE linked to HMRC earnings and DWP benefits for ~38m people — a demonstration that cross-department linkage works at population scale. Used extensively for HE outcome reporting; little used for NEET pathways.',
    blurbEli5: 'The government already links school records to adult tax records for 38 million people — used mostly for university outcome reporting, less for NEET pathways.',
    limitation: 'Associational, not causal; observed over multi-year tax cycles; the headline earnings-by-attainment constants derive from 2002–05 GCSE cohorts.',
    evidences: { outcomes: ['neet', 'gapKS4'], levers: ['post16_skills', 'apprenticeships'], note: 'The linkage that could validate a NEET risk index against observed 5-year earnings/benefit outcomes.' },
    gap: 'LEO could validate a NEET risk index against observed 5-year outcomes; no such validation has been published.',
    links: ['census', 'ilr', 'attainment', 'graduateoutcomes'],
  },
  {
    id: 'graduateoutcomes', name: 'HESA / Graduate Outcomes', tier: 'underused', stage: 'post18',
    latency: 'Surveyed ~15 months after graduation; annual summary',
    access: 'Open aggregate dashboards; record-level data is subscription/secure', accessTier: 'mixed',
    who: 'HESA (now part of Jisc) — the Graduate Outcomes survey of UK HE leavers',
    blurb: 'Contacts UK higher-education leavers ~15 months after graduation on employment status, "highly skilled" employment, further study, self-employment and subjective wellbeing. Latest summary: Graduate Outcomes 2022/23 (published July 2025). Record-level data feeds OfS regulation and the LEO earnings linkage.',
    blurbEli5: 'A survey that asks university leavers, about 15 months on, whether they have a good job or are studying further — used to judge how courses pay off.',
    limitation: 'A single snapshot at 15 months (early-career, not a full trajectory); response-bias and subjective "graduate voice" caveats; UK-wide rather than England-only without filtering.',
    evidences: { outcomes: ['neet', 'leoEconomics'], levers: ['post16_skills'], note: 'The HE leg of the post-18 destination picture that feeds the earnings linkage.' },
    refs: [{ label: 'HESA — Graduate Outcomes 2022/23 summary statistics (2025)', url: 'https://www.hesa.ac.uk/news/17-07-2025/sb272-higher-education-graduate-outcomes-statistics' }],
    links: ['leo', 'destinations'],
  },
  {
    id: 'echild', name: 'ECHILD (NHS linkage)', tier: 'underused', stage: 'post18',
    latency: '~2 years; research-only',
    access: 'UCL-led research environment in ONS SRS', accessTier: 'secure',
    who: 'UCL/GOSH-led, supported by ADR UK — Hospital Episode Statistics ↔ NPD ↔ social care',
    blurb: 'NPD linked to Hospital Episode Statistics and children’s social care for a whole-population cohort (children born 1 Sept 1995 – 31 Aug 2020, ages 0–24). Demonstrates what health linkage adds: e.g. ~32% persistent absence among children with mental-health presentations.',
    blurbEli5: 'A research database joining school and hospital records — showing health problems and school absence travel together — but no council can use it day-to-day.',
    limitation: 'Administrative records capture contacts with services, not the underlying need; coverage is England state-sector schooling plus NHS; access is approval-gated and complex.',
    evidences: { outcomes: ['gapAge3', 'gld'], levers: ['mental_health', 'camhs'], note: 'The strongest existing evidence that health and education outcomes co-move; underpins the health-linked levers.' },
    gap: 'Establishes the value of health↔education linkage; no operational flow into LA risk lists exists. The CWS Act consistent-identifier pilot may enable one.',
    refs: [{ label: 'IJE — Data Resource Profile: The ECHILD Database (2022)', url: 'https://academic.oup.com/ije/article/51/1/17/6425590' }],
    links: ['census', 'c2020s'],
  },
  {
    id: 'c2020s', name: 'Children of the 2020s', tier: 'underused', stage: 'pre16',
    latency: 'Survey waves; linked admin records lag',
    access: 'Reports open; linked microdata via UK Data Service (managed)', accessTier: 'mixed',
    who: 'DfE-commissioned, run by UCL Centre for Longitudinal Studies',
    blurb: 'A new DfE-commissioned birth-cohort study following thousands of babies born in England through their first five years. Survey data on child development, family and neighbourhood context, health, the home learning environment and childcare — linked, with parental consent, to routine health, education and social-care records, plus app-based developmental logging.',
    blurbEli5: 'A new study following thousands of babies born in England, asking parents about development and home life, then (with consent) joining that to health and school records.',
    limitation: 'A consented survey cohort (smaller-N, attrition) rather than whole-population administrative coverage; very young, so limited educational-outcome data so far.',
    evidences: { outcomes: ['gapAge3', 'eyTakeUp', 'gld'], levers: ['ey_quality', 'ey_access'], note: 'The richest forthcoming evidence on the age-3 development gap and early-years take-up that the EY levers target.' },
    refs: [{ label: 'UCL CLS — Children of the 2020s study (2022)', url: 'https://cls.ucl.ac.uk/cls-studies/children-of-the-2020s-study/' }],
    links: ['census', 'echild'],
  },
  {
    id: 'datafirst', name: 'Data First (MoJ linkage)', tier: 'underused', stage: 'post18',
    latency: 'Research-only',
    access: 'Accredited researchers via SRS / ADR UK', accessTier: 'secure',
    who: 'Ministry of Justice / ADR UK — courts, prison and probation ↔ NPD ↔ social care',
    blurb: 'Courts, prison and probation records linked to NPD and children’s social care — a youth-justice↔education linkage held in a research environment.',
    blurbEli5: 'Criminal-justice records are already joined to school records — but only accredited researchers can use them.',
    limitation: 'Research-only; no operational route from the linkage to front-line services.',
    evidences: { outcomes: ['neet'], levers: ['behaviour_support'], note: 'Evidence on the education–justice pathway that behaviour-support spending aims to interrupt.' },
    links: ['census'],
  },
  {
    id: 'track18', name: 'Tracking at 18+', tier: 'missing', stage: 'post18',
    latency: '—',
    access: '—',
    blurb: 'No statutory duty to track young people past 18 (dropped 2016). Measured NEET prevalence concentrates at 18–24 (≈16.0% vs ≈4.0% at 16–17) — the age band where no body holds a tracking duty.',
    blurbEli5: 'After 18 no body has a duty to record whether a young person is in work or education — and measured NEET prevalence is highest at 18–24.',
    limitation: 'Does not exist: no instrument holds a tracking responsibility for 18–24-year-olds.',
    evidences: { outcomes: ['neet'], levers: ['youth_guarantee'], note: 'The instrument the Youth Guarantee would need to know whom it is reaching at 18–24.' },
    gap: 'The age-18 measurement gap: the tracking duty ends before measured NEET prevalence peaks.',
    links: [],
  },
  {
    id: 'health2roni', name: 'Health → risk-list flow', tier: 'missing', stage: 'post18',
    latency: '—',
    access: '—',
    blurb: 'Mental-health conditions are a growing share of the NEET cohort, yet no routine flow exists from NHS/CAMHS into LA early-warning lists — DfE’s data-sharing guidance does not include integrated care boards.',
    blurbEli5: 'A growing share of NEET young people report mental-health conditions, but the health system shares none of that signal with the teams running early-warning lists.',
    limitation: 'Does not exist: no governed route carries health signals into LA risk lists, despite ≈44% of NEET young people reporting a work-limiting health condition (2025).',
    evidences: { outcomes: ['neet'], levers: ['mental_health', 'camhs'], note: 'The absent linkage between the fastest-growing NEET driver and the teams able to act on it.' },
    gap: 'A measurement gap with a measured driver: ≈44% of NEET young people report a work-limiting health condition (2025).',
    links: [],
  },
];

export const STAGE_META: Record<EstateStage, { label: string; eli5: string }> = {
  pre16: { label: 'Pre-16 (school)', eli5: 'At school' },
  transition: { label: '16–18 (the transition)', eli5: 'Leaving school' },
  post18: { label: '18–24 (no tracking duty)', eli5: 'After 18' },
};

export const TIER_META: Record<EstateTier, { label: string; eli5: string; colour: string }> = {
  proven: { label: 'exists & proven', eli5: 'works today', colour: '#2f7d4f' },
  underused: { label: 'exists, underused', eli5: 'exists, little-used', colour: '#b4632e' },
  missing: { label: 'missing', eli5: 'doesn’t exist', colour: '#b1455e' },
};

// access tier — the open/secure headline fact, surfaced on the map
export const ACCESS_META: Record<AccessTier, { label: string; eli5: string; colour: string }> = {
  open: { label: 'open', eli5: 'anyone can use', colour: '#2f6f97' },
  secure: { label: 'secure', eli5: 'accredited researchers only', colour: '#7a5aa6' },
  mixed: { label: 'mixed (open aggregate / secure record-level)', eli5: 'summaries open, raw locked', colour: '#9a7b1f' },
};

export const ESTATE_BY_ID: Record<string, EstateNode> = Object.fromEntries(ESTATE.map((n) => [n.id, n]));
