// frameworks.ts — the frameworks gallery: how data strategy is done, in UK government and
// in the corporate world. "What should already exist" in a credible data strategy. The
// /frameworks page renders these side by side; the maturity dimensions crosswalk to them.

import type { Framework } from './types';

export const FRAMEWORKS: Framework[] = [
  // ---------------- UK government ----------------
  {
    id: 'national-data-strategy',
    name: 'National Data Strategy',
    type: 'uk-gov',
    summary:
      'The 2020 cross-government strategy framing data as a strategic asset, built on data foundations, skills, availability and responsible use, pursued through a set of missions.',
    keyElements: [
      'Pillar: data foundations (quality, standards, interoperability)',
      'Pillar: data skills',
      'Pillar: data availability (within and beyond government)',
      'Pillar: responsible use & security',
      'Missions on unlocking value, secure infrastructure, and a pro-growth regime',
    ],
    sourceUrl: 'https://www.gov.uk/government/publications/uk-national-data-strategy',
  },
  {
    id: 'cddo-roadmap',
    name: 'CDDO/DSIT digital & data roadmap',
    type: 'uk-gov',
    summary:
      'The cross-government roadmap for digital and data, with a data mission covering data standards, a data marketplace/exchange, an API catalogue, reference & master data and data quality.',
    keyElements: [
      'A government data standards authority & catalogue',
      'A data marketplace / exchange to find and share data',
      'Reference & master data managed centrally',
      'Improved data quality across departments',
      'Modern, interoperable infrastructure (away from legacy)',
    ],
    sourceUrl: 'https://www.gov.uk/government/publications/roadmap-for-digital-and-data-2022-to-2025',
  },
  {
    id: 'dma-government',
    name: 'Data Maturity Assessment for Government',
    type: 'uk-gov',
    summary:
      'A structured self-assessment (CDDO + ONS Data Quality Hub) that scores an organisation’s data maturity across leadership, culture, skills, governance, data management, quality, tools and use.',
    keyElements: [
      'Multiple maturity dimensions, scored on a levelled scale',
      'A repeatable, benchmarkable self-assessment',
      'A bridge from diagnosis to a prioritised improvement plan',
      'The basis for Keystone’s maturity self-assessment',
    ],
    sourceUrl: 'https://www.gov.uk/government/publications/data-maturity-assessment-for-government',
  },
  {
    id: 'gov-data-quality',
    name: 'Government Data Quality Framework',
    type: 'uk-gov',
    summary:
      'Principles and practices for managing data quality across government, with agreed quality dimensions and a culture of measuring and communicating quality.',
    keyElements: [
      'Quality dimensions: completeness, uniqueness, consistency, timeliness, validity, accuracy',
      'Commit to data quality / communicate quality to users',
      'Roles and responsibilities for quality',
    ],
    sourceUrl: 'https://www.gov.uk/government/publications/the-government-data-quality-framework',
  },
  {
    id: 'data-ethics-framework',
    name: 'Data and AI Ethics Framework',
    type: 'uk-gov',
    summary:
      'Non-statutory guidance for the ethical use of data and AI in the public sector. First published (as the Data Ethics Framework) in 2018; updated and renamed the Data and AI Ethics Framework in December 2025, expanding to seven overarching principles and adding a self-assessment tool. It complements — does not replace — UK GDPR, the Equality Act and sector regulation.',
    keyElements: [
      'Transparency',
      'Accountability',
      'Fairness',
      'Privacy',
      'Safety',
      'Societal impact',
      'Environmental sustainability',
      'Ties directly to the ATRS and to impact assessments (DPIA, EqIA)',
    ],
    sourceUrl: 'https://www.gov.uk/government/publications/data-ethics-framework',
  },
  {
    id: 'atrs',
    name: 'Algorithmic Transparency Recording Standard',
    type: 'uk-gov',
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
    summary:
      'The Data Management Body of Knowledge — the canonical industry framework, organising data management into knowledge areas around a Data Governance hub (the "DAMA wheel").',
    keyElements: [
      'Data Governance at the centre',
      'Architecture · Modelling & Design · Storage & Operations',
      'Security · Integration & Interoperability · Document & Content',
      'Reference & Master Data · Data Warehousing & BI',
      'Metadata · Data Quality',
    ],
    sourceUrl: 'https://www.dama.org/cpages/body-of-knowledge',
  },
  {
    id: 'dcam',
    name: 'EDM Council DCAM',
    type: 'corporate',
    summary:
      'The Data Management Capability Assessment Model — an industry-standard framework and scoring model for assessing and benchmarking enterprise data-management capability.',
    keyElements: [
      'Capability components from strategy to architecture to governance',
      'A scored maturity assessment',
      'Strong adoption in regulated industries (finance)',
    ],
    sourceUrl: 'https://edmcouncil.org/frameworks/dcam/',
  },
  {
    id: 'cdmc',
    name: 'Cloud Data Management Capabilities (CDMC)',
    type: 'corporate',
    summary:
      'An EDM Council framework focused on managing data in cloud and hybrid environments, with strong emphasis on governance, protection and automated controls.',
    keyElements: ['Cloud governance & accountability', 'Cataloguing & classification', 'Data protection & privacy controls', 'Automated key controls'],
    sourceUrl: 'https://edmcouncil.org/frameworks/cdmc/',
  },
  {
    id: 'data-mesh',
    name: 'Data Mesh',
    type: 'corporate',
    summary:
      'A decentralised, domain-oriented approach to data: treat data as a product owned by domains, on self-serve platform infrastructure, under federated computational governance.',
    keyElements: [
      'Domain-oriented ownership',
      'Data as a product',
      'Self-serve data platform',
      'Federated computational governance',
    ],
    sourceUrl: 'https://martinfowler.com/articles/data-mesh-principles.html',
  },
];

export const FRAMEWORKS_BY_TYPE = {
  'uk-gov': FRAMEWORKS.filter((f) => f.type === 'uk-gov'),
  corporate: FRAMEWORKS.filter((f) => f.type === 'corporate'),
};

/** Recurring themes a mature data strategy is expected to cover ("what should already exist"). */
export const STRATEGY_THEMES: { title: string; blurb: string }[] = [
  { title: 'Data as an asset', blurb: 'Treated and governed like a managed asset, with owners and accountability — not a by-product.' },
  { title: 'A single source of truth', blurb: 'Authoritative reference & master data, so everyone works from the same facts.' },
  { title: 'Governance & stewardship', blurb: 'Clear decision rights, stewards and policy across the data lifecycle.' },
  { title: 'Interoperability & standards', blurb: 'Common identifiers, standards and APIs so data joins up across systems and partners.' },
  { title: 'Data quality by design', blurb: 'Quality measured and managed against agreed dimensions, not assumed.' },
  { title: 'Data literacy & skills', blurb: 'A data profession plus leaders and staff who can read and use data well.' },
  { title: 'Self-service & data products', blurb: 'Curated, discoverable data products that let users serve themselves safely.' },
  { title: 'Privacy, ethics & trust by design', blurb: 'Protection, fairness and transparency built in — the social licence to operate.' },
  { title: 'Value realisation', blurb: 'A line from data investment to decisions, services and measurable outcomes.' },
];
