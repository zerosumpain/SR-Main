// The catalogue — every public-facing DfE data service, grouped by access tier.
// Every value here was researched against primary gov.uk / .service.gov.uk sources
// and adversarially fact-checked (June 2026). Where the popular description is wrong,
// the accurate version is used and the discrepancy noted in `note`.

export type Tier = 'open' | 'secure' | 'gateway';

export interface Service {
  key: string;
  name: string;
  acronym?: string;
  tier: Tier;
  purpose: string;
  url: string; // canonical public URL
  upstream: string; // where the underlying data originates
  refresh: string; // update cadence
  owner: string; // owning body
  access: string; // who can use it
  api: string; // API / bulk descriptor
  hasOpenApi: boolean; // genuinely-public, no-key API
  licence: string;
  highlight?: string; // a notable, real figure
  note?: string; // caveat surfaced by the fact-check
  docsUrl?: string; // API docs / data-sources link
}

export const TIERS: { id: Tier; label: string; blurb: string }[] = [
  {
    id: 'open',
    label: 'Open data',
    blurb: 'Anyone can read the data — a public API and/or a bulk download, no login.'
  },
  {
    id: 'secure',
    label: 'Secure access',
    blurb: 'Pupil- or school-level data behind DfE Sign-in or researcher accreditation.'
  },
  {
    id: 'gateway',
    label: 'Gateway & identity',
    blurb: 'The plumbing — the API front door, single sign-on, and services whose APIs are vendor-only.'
  }
];

export const SERVICES: Service[] = [
  // ── Open data ──────────────────────────────────────────────────────────────
  {
    key: 'gias',
    name: 'Get Information About Schools',
    acronym: 'GIAS',
    tier: 'open',
    purpose:
      'The authoritative register of every school and educational establishment in England — plus trusts, federations and the canonical DfE identifiers (URN, UKPRN, LA/Estab).',
    url: 'https://www.get-information-schools.service.gov.uk/',
    upstream:
      'DfE establishment/group register (successor to EduBase), maintained by the DfE, local authorities and schools themselves.',
    refresh: 'Daily (bulk extracts)',
    owner: 'Department for Education',
    access: 'Open, no login',
    api: 'Daily bulk CSV/JSON — no open API (the SOAP web service is sign-in–gated)',
    hasOpenApi: false,
    licence: 'OGL v3.0',
    highlight: '≈24,500 open schools in England',
    note: "The genuinely-open path is the daily bulk file, not an API. The legacy Azure bulk-CSV endpoint is currently returning HTTP 500, so the live 'schools in England' figure on this page is sourced from Explore Education Statistics instead.",
    docsUrl: 'https://www.gov.uk/guidance/get-information-about-schools'
  },
  {
    key: 'ees',
    name: 'Explore Education Statistics',
    acronym: 'EES',
    tier: 'open',
    purpose:
      "DfE's central platform for all of its official statistics — a table builder, a downloadable data catalogue, and a genuinely public REST API.",
    url: 'https://explore-education-statistics.service.gov.uk/',
    upstream:
      'DfE statistical collections — the termly School Census, the School Workforce Census, exam/attainment results and attendance returns.',
    refresh: 'Per publication (release calendar)',
    owner: 'Department for Education',
    access: 'Open, no login',
    api: 'Public REST API + bulk CSV/ZIP',
    hasOpenApi: true,
    licence: 'OGL v3.0',
    highlight: '9.03m pupils on roll (Jan 2025 census)',
    note: 'The single richest open endpoint in the estate — the live signals above use it for publications, schools and pupils.',
    docsUrl: 'https://api.education.gov.uk/statistics/docs/'
  },
  {
    key: 'cscp',
    name: 'Compare School and College Performance',
    acronym: 'CSCP',
    tier: 'open',
    purpose:
      "Public performance tables for state-funded schools, colleges and trusts — exam results, Progress 8, destinations and absence (formerly 'Find and compare schools').",
    url: 'https://www.compare-school-performance.service.gov.uk/',
    upstream:
      'Pupil attainment from awarding bodies, linked to school-census characteristics and prior attainment; published through EES.',
    refresh: 'Annual (provisional → revised → final)',
    owner: 'Department for Education',
    access: 'Open, no login',
    api: 'Bulk CSV/XLS — no API of its own',
    hasOpenApi: false,
    licence: 'OGL v3.0',
    highlight: 'EBacc entry 40.5% in 2024/25 — highest since 2010',
    note: 'No API of its own; programmatic access to the same numbers is via the Explore Education Statistics API.',
    docsUrl: 'https://www.compare-school-performance.service.gov.uk/download-data'
  },
  {
    key: 'teaching-vacancies',
    name: 'Teaching Vacancies',
    acronym: 'TV',
    tier: 'open',
    purpose:
      'The free national jobs board where state-funded schools advertise teaching, leadership and support roles — every live vacancy exposed as a schema.org JobPosting.',
    url: 'https://teaching-vacancies.service.gov.uk/',
    upstream: 'Job adverts posted directly by schools, trusts and local authorities.',
    refresh: 'Real-time',
    owner: 'Department for Education',
    access: 'Open, no login',
    api: 'Public REST API (JSON), no key',
    hasOpenApi: true,
    licence: 'OGL v3',
    highlight: '≈6,600 vacancies open today',
    docsUrl: 'https://teaching-vacancies.service.gov.uk/api/v1/jobs.json'
  },
  {
    key: 'ttcourses',
    name: 'Find postgraduate teacher training',
    acronym: 'Find / Publish',
    tier: 'open',
    purpose:
      "Providers 'Publish' initial-teacher-training courses; candidates search them on 'Find'. A public API exposes every course, provider and subject.",
    url: 'https://find-teacher-training-courses.service.gov.uk/',
    upstream: 'Course data entered by accredited ITT providers via the Publish service.',
    refresh: 'Continuous within an annual Oct–Sep cycle',
    owner: 'Department for Education (DfE Digital)',
    access: 'Open, no login',
    api: 'Public REST API (JSON:API), no key',
    hasOpenApi: true,
    licence: 'OGL v3.0',
    highlight: '≈14,800 courses in the 2026 cycle',
    docsUrl: 'https://api.publish-teacher-training-courses.service.gov.uk/docs/'
  },
  {
    key: 'fbit',
    name: 'Financial Benchmarking and Insights Tool',
    acronym: 'FBIT',
    tier: 'open',
    purpose:
      "Compare any school's, academy's or trust's finances against similar organisations. Replaced Schools Financial Benchmarking in Autumn 2024.",
    url: 'https://financial-benchmarking-and-insights-tool.education.gov.uk/',
    upstream:
      'Schools’ own returns — Consistent Financial Reporting (CFR) for maintained schools and the Academies Accounts Return (AAR) — plus pupil, workforce and Ofsted context.',
    refresh: 'Annual (per financial year)',
    owner: 'Department for Education',
    access: 'Open; some features need DfE Sign-in',
    api: 'Bulk Excel download — no public API',
    hasOpenApi: false,
    licence: 'OGL v3.0',
    highlight: 'Academy accounts to 2024/25; data from 2014/15'
  },
  {
    key: 'ofsted',
    name: 'Ofsted reports & inspection data',
    tier: 'open',
    purpose:
      'Search individual inspection reports and download bulk inspection-outcome datasets for schools, early years, FE and children’s social care.',
    url: 'https://reports.ofsted.gov.uk/',
    upstream: "Ofsted's own inspection activity, matched to schools by URN (via GIAS).",
    refresh: 'Monthly management info; twice-yearly official statistics',
    owner: 'Ofsted — a separate non-ministerial department',
    access: 'Open, no login',
    api: 'Bulk ODS/CSV download — no API',
    hasOpenApi: false,
    licence: 'OGL v3.0',
    highlight: '83% of schools good/outstanding (Aug 2025)',
    note: 'Ofsted is independent of the DfE. From September 2024, state-school graded inspections dropped the single overall-effectiveness judgement.',
    docsUrl:
      'https://www.gov.uk/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes'
  },
  {
    key: 'datagovuk',
    name: 'DfE datasets on data.gov.uk',
    tier: 'open',
    purpose:
      "The DfE is a major publisher on the UK's national open-data catalogue, where its statistical and reference datasets are mirrored with a CKAN API.",
    url: 'https://www.data.gov.uk/search?filters%5Bpublisher%5D=Department+for+Education',
    upstream: "DfE systems and publications — e.g. 'Schools in England' from GIAS/EduBase.",
    refresh: 'Per dataset (catalogue metadata regenerated nightly)',
    owner: 'Portal run by GDS (DSIT); DfE is the publisher',
    access: 'Open, no login',
    api: 'CKAN catalogue API (JSON), no key',
    hasOpenApi: true,
    licence: 'OGL v3.0',
    highlight: '231 DfE datasets catalogued',
    docsUrl: 'https://guidance.data.gov.uk/get_data/api_documentation/'
  },

  // ── Secure access ──────────────────────────────────────────────────────────
  {
    key: 'asp',
    name: 'Analyse School Performance',
    acronym: 'ASP',
    tier: 'secure',
    purpose:
      'Detailed pupil attainment and progress analysis for schools, trusts, LAs and inspectors — the successor to RAISEonline.',
    url: 'https://www.gov.uk/guidance/analyse-school-performance-asp',
    upstream: 'National Pupil Database — census, assessments and exam-board results.',
    refresh: 'Per publication (performance-data calendar)',
    owner: 'Department for Education',
    access: 'DfE Sign-in',
    api: 'None',
    hasOpenApi: false,
    licence: 'OGL v3.0 (guidance); reports restricted',
    highlight: 'Pupil-level KS2/KS4/KS5 analysis'
  },
  {
    key: 'giap',
    name: 'Get Information About Pupils',
    acronym: 'GIAP',
    tier: 'secure',
    purpose:
      "Secure pupil-level lookup for authorised education staff — UPN searches for new starters and pupil-premium files. Replaced 'Key to Success'.",
    url: 'https://www.gov.uk/guidance/get-information-about-pupil-giap',
    upstream: 'National Pupil Database (School Census + statutory assessments).',
    refresh: 'Termly census / annual pupil-premium files',
    owner: 'Department for Education',
    access: 'DfE Sign-in',
    api: 'None',
    hasOpenApi: false,
    licence: 'Restricted (pupil-level personal data)',
    highlight: 'Individual pupil records'
  },
  {
    key: 'npd',
    name: 'National Pupil Database',
    acronym: 'NPD',
    tier: 'secure',
    purpose:
      'The pupil-level longitudinal database — attainment, characteristics, absence, exclusions and children’s-services contact. The source behind ASP, GIAP and much of DfE statistics.',
    url: 'https://www.gov.uk/guidance/apply-for-department-for-education-dfe-personal-data',
    upstream: 'DfE statutory collections — School Census, assessments, exclusions, CIN/CLA returns.',
    refresh: 'Per collection (largely termly/annual)',
    owner: 'DfE (controller); access via the ONS Secure Research Service',
    access: 'Accredited researcher only',
    api: 'None — formal application',
    hasOpenApi: false,
    licence: 'Restricted (not open data)',
    highlight: '21m+ named pupil records',
    note: 'Access needs ONS researcher accreditation under the Digital Economy Act 2017 plus DfE panel approval.'
  },
  {
    key: 'find-npd',
    name: 'Find and explore data in the NPD',
    tier: 'secure',
    purpose:
      'An open-to-browse metadata tool for exploring exactly which data items the National Pupil Database holds — before applying for access. Browsing is open; the data is not.',
    url: 'https://www.find-npd-data.education.gov.uk/',
    upstream: 'Metadata describing the NPD Data Tables (School Census etc.).',
    refresh: 'Per publication',
    owner: 'Department for Education',
    access: 'Open to browse · data restricted',
    api: 'None (browse-only)',
    hasOpenApi: false,
    licence: 'OGL v3.0 (metadata)',
    highlight: 'Catalogue of NPD data items'
  },

  // ── Gateway & identity ─────────────────────────────────────────────────────
  {
    key: 'fauapi',
    name: 'Find and Use an API',
    acronym: 'FaUAPI',
    tier: 'gateway',
    purpose:
      "The DfE's single API front door — discover, subscribe to and get credentials for its APIs. The gateway itself, not a dataset.",
    url: 'https://find-and-use-an-api.education.gov.uk/',
    upstream:
      'Catalogues DfE-owned APIs (EES, Teacher Training, Get into Teaching, the EAPIM platform) on Azure API Management.',
    refresh: 'Continuous (as teams publish APIs)',
    owner: 'Department for Education (DfE Digital)',
    access: 'Open to browse · account + key to call',
    api: 'API catalogue (subscription keys)',
    hasOpenApi: false,
    licence: 'OGL v3.0',
    highlight: '4 DfE APIs catalogued',
    docsUrl: 'https://find-and-use-an-api.education.gov.uk/documentation'
  },
  {
    key: 'dfe-signin',
    name: 'DfE Sign-in',
    acronym: 'DSI',
    tier: 'gateway',
    purpose:
      'The department’s single sign-on — the identity gate through which schools and trusts reach the secure-access services (ASP, GIAP, GIAS edit, FBIT).',
    url: 'https://services.signin.education.gov.uk/',
    upstream: 'User/organisation identity records; organisation data sourced from GIAS.',
    refresh: 'Real-time',
    owner: 'Department for Education (DfE Digital)',
    access: 'Organisation-approved accounts; integration API vendor-only',
    api: 'Vendor/integration API (JWT)',
    hasOpenApi: false,
    licence: 'Service restricted (source MIT)',
    highlight: 'Gate to 59 DfE services'
  },
  {
    key: 'apply-tt',
    name: 'Apply for teacher training',
    acronym: 'DfE Apply',
    tier: 'gateway',
    purpose:
      'The candidate application service for ITT (replaced UCAS Teacher Training). Providers manage applications in a web UI or via a vendor API.',
    url: 'https://www.gov.uk/apply-for-teacher-training',
    upstream: 'Candidate-submitted applications; feeds downstream ITT statistics on EES.',
    refresh: 'Real-time (annual cycle)',
    owner: 'Department for Education (DfE Digital)',
    access: 'Open to apply · API vendor-only',
    api: 'Vendor API (provider SRS integrations)',
    hasOpenApi: false,
    licence: 'Application data restricted',
    highlight: 'ITT application pipeline'
  },
  {
    key: 'get-into-teaching',
    name: 'Get Into Teaching',
    acronym: 'GiT',
    tier: 'gateway',
    purpose:
      'Free DfE advice service for would-be teachers — advisers, events and school experience. CRM-backed, with a vendor-only integration API.',
    url: 'https://getintoteaching.education.gov.uk/',
    upstream: 'The Get into Teaching CRM (Microsoft Dynamics 365).',
    refresh: 'Real-time',
    owner: 'Department for Education (DfE Digital)',
    access: 'Open service · API vendor-only',
    api: 'Vendor API (source MIT-licensed)',
    hasOpenApi: false,
    licence: 'Service-facing API',
    highlight: 'Feeds ≈32,600 ITT entrants (2025/26)'
  }
];

export const OPEN_API_COUNT = SERVICES.filter((s) => s.hasOpenApi).length;
