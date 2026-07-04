// frameworks.ts — the frameworks gallery: how data strategy is done, in UK government and in
// the corporate world. "What should already exist" in a credible data strategy. Facts verified
// via the keystone-research workflow (2026-06-16). The /frameworks page renders these; the
// /strategies influence map ranks the wider landscape (statutes, programmes) by relevance to DfE.

import type { Framework } from './types';

export const FRAMEWORKS: Framework[] = [
  // ---------------- UK government ----------------
  {
    id: 'national-data-strategy',
    name: 'National Data Strategy (2020)',
    type: 'uk-gov',
    date: '2020-09',
    dateLabel: 'Sep 2020',
    summary:
      'The DCMS strategy (launched September 2020) framing data as a strategic asset. Not formally withdrawn, but operational ambition has since moved to the digital-and-data roadmap, DSIT mission-led work and the National Data Library.',
    keyElements: [
      'Pillar: Data Foundations (FAIR data on modern systems)',
      'Pillar: Data Skills',
      'Pillar: Data Availability',
      'Pillar: Responsible Data (lawful, ethical, accountable)',
      'Five missions — incl. Mission 3: transform government’s own use of data',
    ],
    sourceUrl: 'https://www.gov.uk/government/publications/uk-national-data-strategy/national-data-strategy',
  },
  {
    id: 'cddo-roadmap',
    name: 'Transforming for a Digital Future (2022–25 roadmap)',
    type: 'uk-gov',
    date: '2022-06',
    dateLabel: 'Jun 2022',
    summary:
      'The CDDO cross-government roadmap (June 2022), underpinned by £8bn of investment, with six missions. Mission 3 — "Better data to power decision making" — drove a Data Marketplace, an API catalogue and common data standards.',
    keyElements: [
      'Six missions incl. Mission 3: better data to power decision-making',
      'A cross-government Data Marketplace + API catalogue (230+ APIs)',
      'Data Standards Authority — common models, reference & master data',
      'A single data-ownership model; DCAT metadata',
      '~90% of senior civil servants to be data-upskilled by 2025',
    ],
    sourceUrl:
      'https://www.gov.uk/government/publications/transforming-for-a-digital-future-governments-2022-to-25-roadmap-for-digital-and-data',
  },
  {
    id: 'modern-digital-government',
    name: 'Blueprint & Roadmap for Modern Digital Government',
    type: 'uk-gov',
    date: '2026-01',
    dateLabel: 'Blueprint Jan 2025 · roadmap Jan 2026',
    summary:
      'The current strategic direction. DSIT/GDS published "A Blueprint for Modern Digital Government" (Jan 2025) and "A Roadmap for Modern Digital Government" (Jan 2026, horizon 2030), reframing the data agenda around a National Data Library and a "Digital Backbone". The 2025 State of Digital Government Review found £45bn/yr of unrealised savings and that ~70% of leaders say data is poorly coordinated.',
    keyElements: [
      'The National Data Library (DSIT-owned; >£100m within £1.9bn)',
      'A cross-government "Digital Backbone" and shared infrastructure',
      'Planning-data standards for local authorities (summer 2026)',
      'Successor framing to the National Data Strategy',
    ],
    sourceUrl: 'https://www.gov.uk/government/publications/a-blueprint-for-modern-digital-government',
  },
  {
    id: 'ai-opportunities',
    name: 'AI Opportunities Action Plan (2025)',
    type: 'uk-gov',
    date: '2025-01',
    dateLabel: 'Jan 2025',
    summary:
      'Matt Clifford’s plan (Jan 2025; government response CP 1242, 48/50 recommendations agreed) to scale public- and private-sector AI. It frames high-quality data as "the lifeblood of modern AI" and routes data-unlocking through the National Data Library; DfE is named a delivery partner.',
    keyElements: [
      'Data as the precondition for AI',
      'AI Research Resource (AIRR) expanded ≥20× by 2030; AI Growth Zones',
      'Public-sector adoption via "scan → pilot → scale"',
      'DfE named as an accountable delivery partner',
    ],
    sourceUrl: 'https://www.gov.uk/government/publications/ai-opportunities-action-plan',
  },
  {
    id: 'dma-government',
    name: 'Data Maturity Assessment for Government',
    type: 'uk-gov',
    date: '2023-03',
    dateLabel: 'Mar 2023',
    summary:
      'A self-assessment framework (GDS + CDDO; developed by the ONS Data Quality Hub; published 27 March 2023; adapted from the Data Orchard model). A matrix of ten topics across six themes — Leadership, Culture, Skills, Tools, Data, Uses — scored on a five-level scale (Beginning → Mastering).',
    keyElements: [
      'Six themes: Leadership · Culture · Skills · Tools · Data · Uses',
      'Ten assessment topics, scored 1–5',
      'Evidence-based prioritisation of low-maturity, high-risk areas',
      'The basis for Keystone’s maturity radar',
    ],
    sourceUrl: 'https://www.gov.uk/government/publications/data-maturity-assessment-for-government',
  },
  {
    id: 'gov-data-quality',
    name: 'Government Data Quality Framework',
    type: 'uk-gov',
    date: '2020-12',
    dateLabel: 'Dec 2020',
    summary:
      'Principles and practices for managing data quality across government (GDS + Data Standards Authority + ONS Data Quality Hub, Dec 2020), with six DAMA-UK quality dimensions and a culture of measuring and communicating quality.',
    keyElements: [
      'Dimensions: completeness, uniqueness, consistency, timeliness, validity, accuracy',
      'Five principles: commit; know users; assess across the lifecycle; communicate; anticipate change',
      'Roles and responsibilities for quality',
    ],
    sourceUrl: 'https://www.gov.uk/government/publications/the-government-data-quality-framework',
  },
  {
    id: 'data-ethics-framework',
    name: 'Data and AI Ethics Framework',
    type: 'uk-gov',
    date: '2025-12',
    dateLabel: '2018 · renamed & expanded Dec 2025',
    summary:
      'Non-statutory guidance for the ethical use of data and AI in the public sector. First published (as the Data Ethics Framework) in 2018; updated and renamed the Data and AI Ethics Framework in December 2025, expanding to seven overarching principles and adding a self-assessment tool. Complements UK GDPR, the Equality Act and sector regulation.',
    keyElements: [
      'Transparency · Accountability · Fairness',
      'Privacy · Safety',
      'Societal impact · Environmental sustainability',
      'Ties directly to the ATRS and to impact assessments (DPIA, EqIA)',
    ],
    sourceUrl: 'https://www.gov.uk/government/publications/data-ethics-framework',
  },
  {
    id: 'atrs',
    name: 'Algorithmic Transparency Recording Standard',
    type: 'uk-gov',
    date: '2024-03',
    dateLabel: 'Nov 2021 · mandatory from Mar 2024',
    summary:
      'The cross-government standard for recording and publishing how and why public bodies use algorithmic / AI tools. Two-tier records, published to a central GOV.UK repository. Mandatory rollout to central government began in phases from March 2024.',
    keyElements: [
      'Tier 1: a short, plain-language summary for the public',
      'Tier 2: technical detail across eight sections (owner, rationale, deployment, tool & model spec, data, risks)',
      'Mandatory for central government departments and public-facing arm’s-length bodies',
      'Published in a central GOV.UK repository',
    ],
    sourceUrl:
      'https://www.gov.uk/government/collections/algorithmic-transparency-recording-standard-hub',
  },
  // ---------------- corporate / industry ----------------
  {
    id: 'dama-dmbok',
    name: 'DAMA-DMBOK',
    type: 'corporate',
    date: '2017-07',
    dateLabel: '2017 (DMBOK2) · 3.0 in development',
    summary:
      'The Data Management Body of Knowledge — the canonical industry framework, organising data management into 11 knowledge areas around a Data Governance hub (the "DAMA Wheel"). DMBOK2 is current; DMBOK 3.0 is in development.',
    keyElements: [
      'Data Governance at the centre',
      'Architecture · Modelling & Design · Storage & Operations',
      'Security · Integration & Interoperability · Document & Content',
      'Reference & Master Data · Warehousing & BI · Metadata · Data Quality',
    ],
    sourceUrl: 'https://www.dama.org/cpages/body-of-knowledge',
  },
  {
    id: 'dcam',
    name: 'EDM Council DCAM',
    type: 'corporate',
    date: '2025-06',
    dateLabel: 'Jun 2025 (v3)',
    summary:
      'The Data Management Capability Assessment Model — an industry standard for assessing and benchmarking enterprise data-management capability. DCAM v3 (June 2025): 8 components, 34 capabilities and 101 sub-capabilities, scored on Engagement, Process and Evidence.',
    keyElements: [
      '8 components from strategy to architecture to governance',
      '34 capabilities / 101 sub-capabilities',
      'Scored on Engagement · Process · Evidence',
      'Widely adopted in regulated industries (finance)',
    ],
    sourceUrl: 'https://edmcouncil.org/frameworks/dcam/',
  },
  {
    id: 'cdmc',
    name: 'Cloud Data Management Capabilities (CDMC)',
    type: 'corporate',
    date: '2021-09',
    dateLabel: 'Sep 2021',
    summary:
      'An EDM Council framework for managing data in cloud and hybrid environments: 6 components, 14 capabilities and 37 sub-capabilities, with 14 Key Controls for protecting and governing sensitive data.',
    keyElements: ['6 components / 14 capabilities / 37 sub-capabilities', 'Cataloguing & classification', '14 automated Key Controls for data protection', 'Cloud governance & accountability'],
    sourceUrl: 'https://edmcouncil.org/frameworks/cdmc/',
  },
  {
    id: 'data-mesh',
    name: 'Data Mesh',
    type: 'corporate',
    date: '2020-12',
    dateLabel: '2019 concept · principles Dec 2020',
    summary:
      'A decentralised, domain-oriented approach (coined by Zhamak Dehghani, 2019): treat data as a product owned by domains, on self-serve platform infrastructure, under federated computational governance. Increasingly paired with data fabric (the connective metadata layer).',
    keyElements: ['Domain-oriented ownership', 'Data as a product', 'Self-serve data platform', 'Federated computational governance'],
    sourceUrl: 'https://martinfowler.com/articles/data-mesh-principles.html',
  },
];

// How load-bearing each framework is for a DfE data strategy — foundational ones
// shape everything; specialist ones are reached for when their narrow need arises.
const ROLE: Record<string, { role: 'foundational' | 'core' | 'specialist'; weight: number }> = {
  'modern-digital-government': { role: 'foundational', weight: 0.95 },
  'dama-dmbok': { role: 'foundational', weight: 0.95 },
  'dma-government': { role: 'foundational', weight: 0.92 },
  'gov-data-quality': { role: 'foundational', weight: 0.88 },
  'data-ethics-framework': { role: 'foundational', weight: 0.86 },
  'ai-opportunities': { role: 'core', weight: 0.72 },
  'data-mesh': { role: 'core', weight: 0.68 },
  'national-data-strategy': { role: 'core', weight: 0.6 },
  dcam: { role: 'specialist', weight: 0.5 },
  atrs: { role: 'specialist', weight: 0.46 },
  'cddo-roadmap': { role: 'specialist', weight: 0.42 },
  cdmc: { role: 'specialist', weight: 0.4 },
};
for (const f of FRAMEWORKS) {
  const r = ROLE[f.id];
  if (r) { f.role = r.role; f.weight = r.weight; }
}

export const FRAMEWORKS_BY_TYPE = {
  'uk-gov': FRAMEWORKS.filter((f) => f.type === 'uk-gov'),
  corporate: FRAMEWORKS.filter((f) => f.type === 'corporate'),
};

/** Default presentation order: date of the current authoritative version, newest first. */
export const FRAMEWORKS_BY_DATE = [...FRAMEWORKS].sort((a, b) => (a.date < b.date ? 1 : -1));

/** Recurring themes a mature data strategy is expected to cover ("what should already exist"). */
export const STRATEGY_THEMES: { title: string; blurb: string }[] = [
  { title: 'Data as an asset', blurb: 'Treated and governed like a managed asset, with owners and accountability — not a by-product. The cross-gov Data Asset Management Policy now requires annual asset reporting.' },
  { title: 'A single source of truth', blurb: 'Authoritative reference & master data and golden records, so everyone works from the same facts.' },
  { title: 'Governance & stewardship', blurb: 'Clear decision rights, stewards and policy across the data lifecycle — the control layer at the centre of DAMA and DCAM.' },
  { title: 'Interoperability & standards', blurb: 'Common identifiers, standards and APIs so data joins up across systems and partners.' },
  { title: 'Data quality by design', blurb: 'Quality measured and managed against agreed dimensions, not assumed.' },
  { title: 'Data literacy & skills', blurb: 'A data profession plus leaders and staff who can read and use data well.' },
  { title: 'Self-service & data products', blurb: 'Curated, discoverable data products that let users serve themselves safely.' },
  { title: 'Privacy, ethics & trust by design', blurb: 'Protection, fairness and transparency built in — the social licence to operate.' },
  { title: 'Value realisation', blurb: 'A line from data investment to decisions, services and measurable outcomes.' },
];
