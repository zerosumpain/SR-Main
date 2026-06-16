// sources.ts — the canonical source list shown in the footer and on /method.
// Every input to the landscape, the legal registry, the frameworks and the pressures
// traces back to one of these. Verified/extended by the keystone-research workflow.

import type { SourceRef } from './types';

export const SOURCES: SourceRef[] = [
  { org: 'DCMS', what: 'National Data Strategy (2020)', url: 'https://www.gov.uk/government/publications/uk-national-data-strategy' },
  { org: 'CDDO', what: 'Transforming for a digital future: roadmap for digital and data', url: 'https://www.gov.uk/government/publications/roadmap-for-digital-and-data-2022-to-2025' },
  { org: 'DSIT', what: 'AI Opportunities Action Plan (2025)', url: 'https://www.gov.uk/government/publications/ai-opportunities-action-plan' },
  { org: 'CDDO / ONS', what: 'Data Maturity Assessment for Government', url: 'https://www.gov.uk/government/publications/data-maturity-assessment-for-government' },
  { org: 'Cabinet Office', what: 'Government Data Quality Framework', url: 'https://www.gov.uk/government/publications/the-government-data-quality-framework' },
  { org: 'CDDO / DSIT', what: 'Data and AI Ethics Framework (2025)', url: 'https://www.gov.uk/government/publications/data-ethics-framework' },
  { org: 'CDDO', what: 'Algorithmic Transparency Recording Standard', url: 'https://www.gov.uk/government/collections/algorithmic-transparency-recording-standard-hub' },
  { org: 'ONS', what: 'Integrated Data Service', url: 'https://www.gov.uk/government/publications/integrated-data-service' },
  { org: 'legislation.gov.uk', what: 'UK GDPR (retained Reg. 2016/679)', url: 'https://www.legislation.gov.uk/eur/2016/679/contents' },
  { org: 'legislation.gov.uk', what: 'Data Protection Act 2018', url: 'https://www.legislation.gov.uk/ukpga/2018/12/contents' },
  { org: 'legislation.gov.uk', what: 'Digital Economy Act 2017, Part 5', url: 'https://www.legislation.gov.uk/ukpga/2017/30/part/5' },
  { org: 'UK Parliament', what: 'Children’s Wellbeing and Schools Act 2025', url: 'https://bills.parliament.uk/bills/3909' },
  { org: 'DfE', what: 'National Pupil Database', url: 'https://www.gov.uk/government/collections/national-pupil-database' },
  { org: 'DAMA International', what: 'DAMA-DMBOK', url: 'https://www.dama.org/cpages/body-of-knowledge' },
  { org: 'EDM Council', what: 'DCAM & CDMC frameworks', url: 'https://edmcouncil.org/frameworks/dcam/' },
  { org: 'Martin Fowler', what: 'Data Mesh principles (Dehghani)', url: 'https://martinfowler.com/articles/data-mesh-principles.html' },
];
