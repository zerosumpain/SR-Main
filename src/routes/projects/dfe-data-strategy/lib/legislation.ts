// legislation.ts — the legal registry. Three layers (mirrors the data-standard-designer
// model): the data-PROTECTION basis (UK GDPR / DPA), the legal POWER/GATEWAY that permits
// or requires a share, and the GOVERNANCE instruments that must be in place. The engine
// surfaces the items a chosen posture implicates; the /legislation page browses them all.

import type { Legislation } from './types';

export const LEGISLATION: Legislation[] = [
  {
    id: 'uk-gdpr',
    name: 'UK GDPR',
    citation: 'Retained Regulation (EU) 2016/679',
    layer: 'protection-basis',
    summary:
      'The core data-protection regime. Any processing of personal data needs a lawful basis (Article 6) and, for special-category data, a further condition (Article 9).',
    relevance:
      'Every flow of pupil or child data needs a named Article 6 basis — usually "public task" for DfE — and an Article 9 condition where health, ethnicity or similar is involved.',
    sourceUrl: 'https://www.legislation.gov.uk/eur/2016/679/contents',
  },
  {
    id: 'dpa-2018',
    name: 'Data Protection Act 2018',
    citation: '2018 c. 12',
    layer: 'protection-basis',
    summary:
      'Supplements the UK GDPR and sets the Schedule 1 conditions for special-category and criminal-offence data, including safeguarding of children.',
    relevance:
      'Schedule 1 conditions (e.g. statutory functions, safeguarding of children) are what make lawful much of the cross-agency sharing a child-protection data spine requires.',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2018/12/contents',
  },
  {
    id: 'duaa-2025',
    name: 'Data (Use and Access) Act 2025',
    citation: '2025',
    layer: 'protection-basis',
    summary:
      'The government’s data reform: changes to the data-protection regime, smart data schemes, digital verification services and provisions for data use in research and public services.',
    relevance:
      'Reshapes the lawful-basis and access landscape DfE’s strategy must build on — and may ease or complicate specific reuse and research provisions.',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2025',
  },
  {
    id: 'dea-2017',
    name: 'Digital Economy Act 2017 (Part 5)',
    citation: '2017 c. 30, Part 5',
    layer: 'legal-gateway',
    summary:
      'Provides public-service-delivery data-sharing powers — a legal GATEWAY allowing specified public authorities to share personal data for defined objectives.',
    relevance:
      'A candidate statutory power for joining education data with other public services — the difference between "we have a lawful basis" and "we have the legal power to share at all".',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2017/30/part/5',
  },
  {
    id: 'cwsa-2025',
    name: 'Children’s Wellbeing and Schools Act 2025',
    citation: '2025',
    layer: 'legal-gateway',
    summary:
      'Legislates (among much else) for a consistent child identifier and information-sharing duties to support safeguarding and children’s services.',
    relevance:
      'The statutory basis for the consistent child identifier and the data spine — the single most consequential gateway for DfE’s data agenda.',
    sourceUrl: 'https://bills.parliament.uk/bills/3909',
  },
  {
    id: 'foi-2000',
    name: 'Freedom of Information Act 2000',
    citation: '2000 c. 36',
    layer: 'governance',
    summary:
      'Gives a right of access to information held by public authorities, subject to exemptions.',
    relevance:
      'An open-by-default posture interacts with FOI obligations and expectations of proactive publication; it shapes what must be disclosable.',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2000/36/contents',
  },
  {
    id: 'eir-2004',
    name: 'Environmental Information Regulations 2004',
    citation: 'SI 2004/3391',
    layer: 'governance',
    summary: 'A parallel access regime for environmental information held by public authorities.',
    relevance: 'Relevant where education-estate or environmental data is held; part of the openness picture.',
    sourceUrl: 'https://www.legislation.gov.uk/uksi/2004/3391/contents/made',
  },
  {
    id: 'common-law-confidentiality',
    name: 'Common-law duty of confidentiality',
    layer: 'governance',
    summary:
      'A duty, separate from data-protection law, not to disclose information given in confidence without authority.',
    relevance:
      'Especially live for health and safeguarding data. Having a lawful basis under UK GDPR does not by itself satisfy the duty of confidence.',
    sourceUrl: 'https://www.gov.uk/government/publications/data-ethics-framework',
  },
];

export const LEGISLATION_BY_ID: Record<string, Legislation> = Object.fromEntries(
  LEGISLATION.map((l) => [l.id, l]),
);

export const LEGAL_LAYER_META: Record<string, { name: string; blurb: string }> = {
  'protection-basis': {
    name: 'A · Data-protection basis',
    blurb: 'The lawful basis to process personal data at all (UK GDPR / DPA 2018).',
  },
  'legal-gateway': {
    name: 'B · Legal power / gateway',
    blurb: 'The statutory power that permits or requires the share — the vires.',
  },
  governance: {
    name: 'C · Governance instruments',
    blurb: 'The controls that must be in place: DPIAs, agreements, transparency, the duty of confidence.',
  },
};
