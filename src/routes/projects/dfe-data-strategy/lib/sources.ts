// sources.ts — the canonical source list shown in the footer and on /method.
// Verified via the keystone-research workflow (2026-06-16) against primary sources.

import type { SourceRef } from './types';

export const SOURCES: SourceRef[] = [
  { org: 'DCMS', what: 'National Data Strategy (2020)', url: 'https://www.gov.uk/government/publications/uk-national-data-strategy/national-data-strategy' },
  { org: 'CDDO', what: 'Transforming for a Digital Future: 2022–25 roadmap', url: 'https://www.gov.uk/government/publications/transforming-for-a-digital-future-governments-2022-to-25-roadmap-for-digital-and-data' },
  { org: 'DSIT / GDS', what: 'A Blueprint for Modern Digital Government (2025)', url: 'https://www.gov.uk/government/publications/a-blueprint-for-modern-digital-government' },
  { org: 'DSIT', what: 'National Data Library progress update (Jan 2026)', url: 'https://www.gov.uk/government/publications/national-data-library-progress-update-january-2026/national-data-library-progress-update-january-2026' },
  { org: 'DSIT', what: 'AI Opportunities Action Plan (2025)', url: 'https://www.gov.uk/government/publications/ai-opportunities-action-plan' },
  { org: 'GDS / CDDO / ONS', what: 'Data Maturity Assessment for Government (2023)', url: 'https://www.gov.uk/government/publications/data-maturity-assessment-for-government' },
  { org: 'GDS / ONS', what: 'Government Data Quality Framework', url: 'https://www.gov.uk/government/publications/the-government-data-quality-framework' },
  { org: 'CDDO / DSIT', what: 'Data and AI Ethics Framework (2025)', url: 'https://www.gov.uk/government/publications/data-ethics-framework' },
  { org: 'GDS / DSIT', what: 'Algorithmic Transparency Recording Standard', url: 'https://www.gov.uk/government/collections/algorithmic-transparency-recording-standard-hub' },
  { org: 'ONS', what: 'Integrated Data Service / Secure Research Service', url: 'https://www.gov.uk/government/publications/integrated-data-service' },
  { org: 'GOV.UK', what: 'Data (Use and Access) Act 2025 — changes', url: 'https://www.gov.uk/guidance/data-use-and-access-act-2025-data-protection-and-privacy-changes' },
  { org: 'legislation.gov.uk', what: 'UK GDPR (retained Reg. 2016/679)', url: 'https://www.legislation.gov.uk/eur/2016/679/contents' },
  { org: 'legislation.gov.uk', what: 'Data Protection Act 2018 (c.12)', url: 'https://www.legislation.gov.uk/ukpga/2018/12/contents' },
  { org: 'legislation.gov.uk', what: 'Digital Economy Act 2017, Part 5', url: 'https://www.legislation.gov.uk/ukpga/2017/30/part/5' },
  { org: 'legislation.gov.uk', what: 'Children’s Wellbeing and Schools Act (2026 c.21)', url: 'https://www.legislation.gov.uk/ukpga/2026/21/contents' },
  { org: 'DfE', what: 'National Pupil Database', url: 'https://www.gov.uk/government/collections/national-pupil-database' },
  { org: 'DfE', what: 'Children’s Social Care Data and Digital Strategy (2023)', url: 'https://www.gov.uk/government/publications/childrens-social-care-data-strategy' },
  { org: 'ICO', what: 'Reprimand of DfE — Learning Records Service (2022)', url: 'https://ico.org.uk/action-weve-taken/enforcement/department-for-education/' },
  { org: 'DAMA International', what: 'DAMA-DMBOK (11 knowledge areas)', url: 'https://www.dama.org/cpages/body-of-knowledge' },
  { org: 'EDM Council', what: 'DCAM v3 & CDMC frameworks', url: 'https://edmcouncil.org/frameworks/dcam/' },
  { org: 'Martin Fowler', what: 'Data Mesh principles (Dehghani)', url: 'https://martinfowler.com/articles/data-mesh-principles.html' },
];
