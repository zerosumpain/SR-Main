// pressures.ts — the pressures library: the forces a DfE data-strategy must answer to,
// across government, from DfE's own policy agenda, and from its delivery partners.
// Each is cited and confidence-rated; DfE-policy and partner pressures deep-link the
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
      'Government expects every department to treat data as a strategic asset — strong data foundations, skills, availability and responsible use. DfE must show its strategy advances all four pillars.',
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
      'The central digital & data roadmap commits government to common data standards, a data marketplace/exchange, an API catalogue, reference & master data and better data quality. DfE is expected to align.',
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
      'Public bodies are expected to record and publish the algorithmic tools they use in decisions through the Algorithmic Transparency Recording Standard — a direct constraint on how DfE deploys data-driven tools.',
    demands: ['ethics', 'governance'],
    severity: 3,
    urgency: 3,
    sourceName: 'Algorithmic Transparency Recording Standard',
    sourceUrl:
      'https://www.gov.uk/government/collections/algorithmic-transparency-recording-standard-hub',
    confidence: 'high',
  },
  {
    id: 'ons-integrated-data',
    title: 'Plug into cross-government linkage (ONS Integrated Data Service)',
    origin: 'cross-government',
    description:
      'The ONS Integrated Data Service offers a secure platform to link de-identified data across government. DfE faces pressure (and opportunity) to make education data available for safe cross-government analysis.',
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
      'The Data (Use and Access) Act reshapes the data-protection and data-access regime (smart data, digital verification, research provisions). DfE must adapt its governance and lawful bases accordingly.',
    demands: ['governance', 'ethics', 'sharing'],
    severity: 3,
    urgency: 4,
    sourceName: 'Data (Use and Access) Act 2025',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2025',
    confidence: 'medium',
  },
  {
    id: 'public-trust',
    title: 'Keep public trust in how children’s data is used',
    origin: 'cross-government',
    description:
      'Trust is a binding constraint. Past controversies over pupil-data sharing show that losing public confidence can shut down legitimate uses overnight. The strategy must earn and keep a social licence.',
    demands: ['ethics', 'governance'],
    severity: 4,
    urgency: 3,
    sourceName: 'Data Ethics Framework',
    sourceUrl: 'https://www.gov.uk/government/publications/data-ethics-framework',
    confidence: 'high',
    eli5: 'If the public stops trusting how kids’ data is used, even good uses get shut down.',
  },

  // ---------------- DfE policy (deep policy-engine integration) ----------------
  {
    id: 'consistent-child-identifier',
    title: 'Deliver the consistent child identifier',
    origin: 'dfe-policy',
    description:
      'A single consistent identifier for every child — legislated through the Children’s Wellbeing and Schools Act — so a child can be followed safely across education, social care and health. The keystone of the whole agenda, and technically and legally hard.',
    demands: ['sharing', 'interoperability', 'governance', 'ethics'],
    severity: 5,
    urgency: 5,
    sourceName: 'Children’s Wellbeing and Schools Act 2025',
    sourceUrl: 'https://bills.parliament.uk/bills/3909',
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
      'Pressure to use AI for DfE’s own services and to support the sector (marking, content, casework) — all of which depend on governed, high-quality, ethically-handled data.',
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
      'Ofqual, Ofsted, the Standards & Testing Agency, the Teaching Regulation Agency and the funding agency each own data. A DfE strategy has to make these interoperate, not collide.',
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
