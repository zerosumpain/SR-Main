// pressures.ts — the pressures library: the forces an education-department data-strategy must answer to,
// across government, from the department's own policy agenda, and from its delivery partners.
// Each is cited and confidence-rated; department-policy and partner pressures deep-link the
// relevant policy-engine field study (the "deep integration" requirement).
// NOTE: facts grounded in known UK-gov sources; the keystone-research workflow verifies
// and sharpens citations.

import type { Pressure } from './types';

const PE = (slug: string, label: string) => ({ label, href: `/projects/policy-engine/${slug}` });

export const PRESSURES: Pressure[] = [
  // ---------------- cross-government ----------------
  {
    id: 'national-data-strategy',
    title: 'Treat data as a strategic asset (National Data Strategy)',
    origin: 'cross-government',
    description:
      'Government expects every department to treat data as a strategic asset — strong data foundations, skills, availability and responsible use. The department must show its strategy advances all four pillars.',
    demands: ['governance', 'quality', 'value', 'ethics'],
    severity: 4,
    urgency: 3,
    sourceName: 'National Data Strategy (DCMS, 2020)',
    sourceUrl: 'https://www.gov.uk/government/publications/uk-national-data-strategy',
    confidence: 'high',
    eli5: 'The government says treat data like a real asset — look after it and use it well.',
  },
  {
    id: 'cddo-data-mission',
    title: 'Cross-government data standards & infrastructure (CDDO/DSIT roadmap)',
    origin: 'cross-government',
    description:
      'The central digital & data roadmap commits government to common data standards, a data marketplace/exchange, an API catalogue, reference & master data and better data quality. The department is expected to align.',
    demands: ['interoperability', 'platform', 'quality'],
    severity: 4,
    urgency: 3,
    sourceName: 'Transforming for a digital future: roadmap for digital and data (CDDO)',
    sourceUrl:
      'https://www.gov.uk/government/publications/roadmap-for-digital-and-data-2022-to-2025',
    confidence: 'high',
  },
  {
    id: 'ai-opportunities',
    title: 'Make services AI-ready (AI Opportunities Action Plan)',
    origin: 'cross-government',
    description:
      'The drive to adopt AI across the public sector makes data foundations the precondition for everything. Poor, ungoverned data caps what AI can safely do in education.',
    demands: ['value', 'quality', 'platform', 'ethics'],
    severity: 5,
    urgency: 4,
    sourceName: 'AI Opportunities Action Plan (2025)',
    sourceUrl: 'https://www.gov.uk/government/publications/ai-opportunities-action-plan',
    confidence: 'high',
    eli5: 'To use AI well, the data underneath has to be clean, joined-up and trusted first.',
  },
  {
    id: 'data-quality-framework',
    title: 'Measure & manage data quality (Government Data Quality Framework)',
    origin: 'cross-government',
    description:
      'Departments are expected to manage data quality against agreed dimensions (completeness, uniqueness, consistency, timeliness, validity, accuracy) and be transparent about it.',
    demands: ['quality', 'governance'],
    severity: 3,
    urgency: 3,
    sourceName: 'Government Data Quality Framework (2020)',
    sourceUrl: 'https://www.gov.uk/government/publications/the-government-data-quality-framework',
    confidence: 'high',
  },
  {
    id: 'algorithmic-transparency',
    title: 'Be transparent about algorithms (ATRS)',
    origin: 'cross-government',
    description:
      'Public bodies are expected to record and publish the algorithmic tools they use in decisions through the Algorithmic Transparency Recording Standard — a direct constraint on how the department deploys data-driven tools.',
    demands: ['ethics', 'governance'],
    severity: 3,
    urgency: 3,
    sourceName: 'Algorithmic Transparency Recording Standard',
    sourceUrl:
      'https://www.gov.uk/government/collections/algorithmic-transparency-recording-standard-hub',
    confidence: 'high',
  },
  {
    id: 'national-data-library',
    title: 'Connect to the National Data Library & DSIT mission data agenda',
    origin: 'cross-government',
    description:
      'DSIT’s National Data Library (>£100m within a £1.9bn package; in discovery, five kickstarter pilots) is the centre’s flagship for unlocking and linking data for the national missions and for AI. The department faces pressure to make priority education datasets discoverable, AI-ready and linkable.',
    demands: ['interoperability', 'platform', 'sharing', 'value'],
    severity: 4,
    urgency: 3,
    sourceName: 'National Data Library progress update (Jan 2026)',
    sourceUrl: 'https://www.gov.uk/government/publications/national-data-library-progress-update-january-2026/national-data-library-progress-update-january-2026',
    confidence: 'high',
  },
  {
    id: 'ons-integrated-data',
    title: 'Safe cross-government linkage (ONS IDS / Secure Research Service)',
    origin: 'cross-government',
    description:
      'The department already shares de-identified data for accredited research via the ONS Secure Research Service. The ONS Integrated Data Service is being wound down (the Integrated Data Programme closes by March 2026 after a RED rating and funding cuts) while the SRS is retained — so the strategy must back the durable route, not the closing one.',
    demands: ['sharing', 'interoperability', 'ethics'],
    severity: 3,
    urgency: 3,
    sourceName: 'ONS Integrated Data Service',
    sourceUrl: 'https://www.gov.uk/government/publications/integrated-data-service',
    confidence: 'medium',
  },
  {
    id: 'efficiency-once-only',
    title: 'Cut duplication — reuse data once collected',
    origin: 'cross-government',
    description:
      'Fiscal pressure and the "collect once, use many times" principle push toward reusing data across services rather than re-collecting it, reducing burden and cost.',
    demands: ['interoperability', 'sharing', 'value'],
    severity: 3,
    urgency: 3,
    sourceName: 'National Data Strategy — data availability mission',
    sourceUrl: 'https://www.gov.uk/government/publications/uk-national-data-strategy',
    confidence: 'medium',
  },
  {
    id: 'data-reform-duaa',
    title: 'Adapt to data-law reform (Data (Use and Access) Act 2025)',
    origin: 'cross-government',
    description:
      'The Data (Use and Access) Act 2025 (Royal Assent 19 June 2025; key provisions in force from 5 February 2026) reshapes the regime — a new "recognised legitimate interests" lawful basis, relaxed automated decision-making rules, Smart Data and digital verification, and the ICO replaced by the Information Commission. The department must adapt its governance and lawful bases.',
    demands: ['governance', 'ethics', 'sharing'],
    severity: 3,
    urgency: 4,
    sourceName: 'Data (Use and Access) Act 2025 (2025 c. 18)',
    sourceUrl: 'https://www.gov.uk/guidance/data-use-and-access-act-2025-data-protection-and-privacy-changes',
    confidence: 'medium',
  },
  {
    id: 'public-trust',
    title: 'Keep public trust in how children’s data is used',
    origin: 'cross-government',
    description:
      'Trust is a binding constraint. In 2022 the ICO reprimanded the department after a third party (Trustopia) gave gambling age-verification firms access to data on up to 28 million pupils via the Learning Records Service — proof that losing confidence can shut down legitimate uses overnight. The strategy must earn and keep a social licence.',
    demands: ['ethics', 'governance'],
    severity: 4,
    urgency: 3,
    sourceName: 'ICO reprimand of DfE (Learning Records Service, 2022)',
    sourceUrl: 'https://ico.org.uk/action-weve-taken/enforcement/department-for-education/',
    confidence: 'high',
    eli5: 'If the public stops trusting how kids’ data is used, even good uses get shut down.',
  },

  // ---------------- the department policy (deep policy-engine integration) ----------------
  {
    id: 'consistent-child-identifier',
    title: 'Deliver the consistent child identifier',
    origin: 'dfe-policy',
    description:
      'A consistent identifier (Single Unique Identifier) for every child — legislated through the Children’s Wellbeing and Schools Act (ss. 16LA–16LD), with the NHS number the government’s chosen identifier — so a child can be followed safely across education, social care and health. The keystone of the whole agenda, and technically and legally hard.',
    demands: ['sharing', 'interoperability', 'governance', 'ethics'],
    severity: 5,
    urgency: 5,
    sourceName: 'Children’s Wellbeing and Schools Act 2025 (2026 c. 21)',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2026/21/contents',
    confidence: 'high',
    policyEngineRef: PE('monitor', 'Policy Engine · The data spine'),
    eli5: 'One safe ID per child, so the right services can join the dots about them.',
  },
  {
    id: 'data-spine',
    title: 'Build the children’s-services data spine',
    origin: 'dfe-policy',
    description:
      'A shared data backbone that joins education, children’s social care and health data for safeguarding and early help — the difference between agencies seeing the whole child or fragments.',
    demands: ['sharing', 'interoperability', 'platform', 'ethics'],
    severity: 5,
    urgency: 4,
    sourceName: 'Policy Engine — the data spine field study',
    sourceUrl: 'https://strangeramblings.com/projects/policy-engine/monitor',
    confidence: 'high',
    policyEngineRef: PE('monitor', 'Policy Engine · The data spine'),
  },
  {
    id: 'attendance-data',
    title: 'Run on daily attendance data & similar-schools intelligence',
    origin: 'dfe-policy',
    description:
      'The daily attendance data feed and "similar schools" analytics underpin the drive on absence — but only work if the data flows reliably from thousands of schools and is high quality.',
    demands: ['platform', 'quality', 'value'],
    severity: 4,
    urgency: 4,
    sourceName: 'Policy Engine — attendance field study',
    sourceUrl: 'https://strangeramblings.com/projects/policy-engine/attendance',
    confidence: 'high',
    policyEngineRef: PE('attendance', 'Policy Engine · Attendance'),
  },
  {
    id: 'send-data',
    title: 'See SEND / EHCP demand and outcomes clearly',
    origin: 'dfe-policy',
    description:
      'Managing the high-needs funding cliff requires timely, comparable data on EHCP demand, provision and outcomes across local areas — today partial and inconsistent.',
    demands: ['quality', 'value', 'sharing'],
    severity: 4,
    urgency: 4,
    sourceName: 'Policy Engine — SEND field study',
    sourceUrl: 'https://strangeramblings.com/projects/policy-engine/send',
    confidence: 'high',
    policyEngineRef: PE('send', 'Policy Engine · SEND'),
  },
  {
    id: 'neet-tracking',
    title: 'Identify and act on participation / NEET',
    origin: 'dfe-policy',
    description:
      'Finding and supporting young people not in education, employment or training depends on joining post-16 participation data across providers, LAs and the benefits/jobs system.',
    demands: ['sharing', 'value', 'quality'],
    severity: 4,
    urgency: 3,
    sourceName: 'Policy Engine — NEET field study',
    sourceUrl: 'https://strangeramblings.com/projects/policy-engine/neet',
    confidence: 'high',
    policyEngineRef: PE('neet', 'Policy Engine · NEET'),
  },
  {
    id: 'npd-modernise',
    title: 'Modernise the National Pupil Database & secure access',
    origin: 'dfe-policy',
    description:
      'The NPD is one of the richest administrative datasets in government. Modernising it and offering safe, ONS-style researcher access — without eroding trust — is a core obligation.',
    demands: ['platform', 'ethics', 'sharing', 'governance'],
    severity: 3,
    urgency: 3,
    sourceName: 'National Pupil Database',
    sourceUrl: 'https://www.gov.uk/government/collections/national-pupil-database',
    confidence: 'high',
  },
  {
    id: 'school-standards-data',
    title: 'Drive school standards fairly with data (RISE / similar schools)',
    origin: 'dfe-policy',
    description:
      'Targeting improvement support fairly depends on robust, comparable school data and defensible "similar schools" methods — contested ground where data quality and method transparency matter.',
    demands: ['quality', 'value', 'interoperability'],
    severity: 3,
    urgency: 3,
    sourceName: 'Policy Engine — monitoring field study',
    sourceUrl: 'https://strangeramblings.com/projects/policy-engine/monitor',
    confidence: 'medium',
    policyEngineRef: PE('monitor', 'Policy Engine · Monitoring'),
  },
  {
    id: 'evidence-based-policy',
    title: 'Feed evidence-based policy & evaluation',
    origin: 'dfe-policy',
    description:
      'Modelling and evaluating policy (as the Policy Engine does) needs reliable, joined-up administrative data. A weak data estate caps how well the department can know what works.',
    demands: ['value', 'quality', 'skills'],
    severity: 4,
    urgency: 3,
    sourceName: 'Policy Engine — method',
    sourceUrl: 'https://strangeramblings.com/projects/policy-engine/method',
    confidence: 'high',
    policyEngineRef: PE('method', 'Policy Engine · How it works'),
  },
  {
    id: 'ai-in-education',
    title: 'Use AI responsibly in education delivery',
    origin: 'dfe-policy',
    description:
      'Pressure to use AI for the department’s own services and to support the sector (marking, content, casework) — all of which depend on governed, high-quality, ethically-handled data.',
    demands: ['value', 'ethics', 'quality'],
    severity: 3,
    urgency: 3,
    sourceName: 'Generative AI in education (DfE position)',
    sourceUrl: 'https://www.gov.uk/government/publications/generative-artificial-intelligence-in-education',
    confidence: 'medium',
  },

  // ---------------- partners ----------------
  {
    id: 'la-data-sharing',
    title: 'Share data with 150+ local authorities',
    origin: 'partners',
    description:
      'Children’s services run through ~153 local authorities of very different data maturity and systems. Safeguarding and early-help flows depend on sharing that is lawful, consistent and trusted.',
    demands: ['sharing', 'interoperability', 'governance'],
    severity: 5,
    urgency: 4,
    sourceName: 'Policy Engine — Jigsaw (multi-agency data-sharing)',
    sourceUrl: 'https://strangeramblings.com/projects/policy-engine/jigsaw',
    confidence: 'high',
    policyEngineRef: PE('jigsaw', 'Policy Engine · Jigsaw'),
  },
  {
    id: 'mat-fragmentation',
    title: 'Reach a fragmented school & MAT landscape',
    origin: 'partners',
    description:
      'Tens of thousands of autonomous schools and multi-academy trusts each hold data in their own MIS, to their own conventions. Interoperability — not central diktat — is the only way to join it up.',
    demands: ['interoperability', 'sharing', 'quality'],
    severity: 4,
    urgency: 3,
    sourceName: 'Get Information About Schools (GIAS)',
    sourceUrl: 'https://get-information-schools.service.gov.uk/',
    confidence: 'high',
  },
  {
    id: 'agency-coordination',
    title: 'Coordinate the arm’s-length bodies',
    origin: 'partners',
    description:
      'Ofqual and Ofsted (non-ministerial departments outside the department accounting group), the Standards & Testing Agency and the Teaching Regulation Agency each own data — while the ESFA closed on 31 March 2025, folding its data into the core department. A the department strategy has to make these interoperate, not collide.',
    demands: ['interoperability', 'governance', 'sharing'],
    severity: 3,
    urgency: 3,
    sourceName: 'DfE and its agencies',
    sourceUrl: 'https://www.gov.uk/government/organisations/department-for-education',
    confidence: 'medium',
  },
  {
    id: 'health-social-care-link',
    title: 'Link safely to health & social care',
    origin: 'partners',
    description:
      'The "Jigsaw" problem: protecting children requires joining education data with health and social care — across different legal regimes, identifiers and cultures. The hardest sharing of all.',
    demands: ['sharing', 'ethics', 'interoperability'],
    severity: 4,
    urgency: 4,
    sourceName: 'Policy Engine — Jigsaw',
    sourceUrl: 'https://strangeramblings.com/projects/policy-engine/jigsaw',
    confidence: 'high',
    policyEngineRef: PE('jigsaw', 'Policy Engine · Jigsaw'),
  },
  {
    id: 'supplier-edtech',
    title: 'Set standards for EdTech & MIS suppliers',
    origin: 'partners',
    description:
      'Much school data lives in commercial MIS and EdTech products. Without open standards and interoperability requirements, the department is locked out of its own data.',
    demands: ['interoperability', 'platform', 'governance'],
    severity: 3,
    urgency: 2,
    sourceName: 'CDDO data standards mission',
    sourceUrl: 'https://www.gov.uk/government/publications/roadmap-for-digital-and-data-2022-to-2025',
    confidence: 'medium',
  },
  {
    id: 'burden-on-schools',
    title: 'Reduce the data-collection burden on schools',
    origin: 'partners',
    description:
      'Schools and teachers resent duplicate data returns. "Collect once, reuse" is both an efficiency and a goodwill imperative — and a test of interoperability.',
    demands: ['interoperability', 'value', 'quality'],
    severity: 3,
    urgency: 3,
    sourceName: 'DfE data collections',
    sourceUrl: 'https://www.gov.uk/education/data-collection-and-censuses-for-schools',
    confidence: 'medium',
  },
  {
    id: 'researcher-access',
    title: 'Offer safe access to analysts & researchers',
    origin: 'partners',
    description:
      'Academics and analysts need safe, accredited access to rich education data to build evidence — through Five-Safes-style secure environments that protect privacy and trust.',
    demands: ['ethics', 'sharing', 'platform'],
    severity: 2,
    urgency: 2,
    sourceName: 'ONS Secure Research Service / Five Safes',
    sourceUrl: 'https://www.ons.gov.uk/aboutus/whatwedo/statistics/requestingstatistics/approvedresearcherscheme',
    confidence: 'medium',
  },
  {
    id: 'legacy-systems',
    title: 'Overcome legacy systems & technical debt',
    origin: 'partners',
    description:
      'Old systems across the department and the sector constrain how data can move. Modernising them is slow, costly and competes with every other priority.',
    demands: ['platform', 'quality', 'interoperability'],
    severity: 3,
    urgency: 3,
    sourceName: 'CDDO — legacy IT',
    sourceUrl: 'https://www.gov.uk/government/publications/roadmap-for-digital-and-data-2022-to-2025',
    confidence: 'medium',
  },
];

export const PRESSURES_BY_ID: Record<string, Pressure> = Object.fromEntries(
  PRESSURES.map((p) => [p.id, p]),
);

export const PRESSURES_BY_ORIGIN = {
  'cross-government': PRESSURES.filter((p) => p.origin === 'cross-government'),
  'dfe-policy': PRESSURES.filter((p) => p.origin === 'dfe-policy'),
  partners: PRESSURES.filter((p) => p.origin === 'partners'),
};
