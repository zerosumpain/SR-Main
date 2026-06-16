// legislation.ts — the legal registry. Three layers (mirrors data-standard-designer): the
// data-PROTECTION basis (UK GDPR / DPA / DUAA), the legal POWER/GATEWAY that permits or
// requires a share (DEA 2017, CWSA), and the GOVERNANCE instruments (FOI/EIR/confidence).
// Facts verified via the keystone-research workflow (2026-06-16) against primary sources.

import type { Legislation } from './types';

export const LEGISLATION: Legislation[] = [
  {
    id: 'uk-gdpr',
    name: 'UK GDPR',
    citation: 'Retained Reg. (EU) 2016/679',
    layer: 'protection-basis',
    summary:
      'The core data-protection regime. Article 6 provides six lawful bases (no hierarchy): consent, contract, legal obligation, vital interests, public task, legitimate interests. Special-category data needs a further Article 9 condition.',
    relevance:
      'Every flow of pupil or child data needs a named Article 6 basis — usually "public task" for DfE — plus an Article 9 condition where health, ethnicity or similar is involved.',
    sourceUrl: 'https://www.legislation.gov.uk/eur/2016/679/contents',
  },
  {
    id: 'dpa-2018',
    name: 'Data Protection Act 2018',
    citation: '2018 c. 12',
    layer: 'protection-basis',
    summary:
      'Supplements and tailors the UK GDPR and structures UK data law into separate regimes. Schedule 1 sets the additional conditions for special-category (Art 9) and criminal-offence (Art 10) data, including safeguarding of children.',
    relevance:
      'The Schedule 1 conditions (e.g. statutory functions, safeguarding of children) are what make lawful much of the cross-agency sharing a child-protection data spine requires.',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2018/12/contents',
  },
  {
    id: 'duaa-2025',
    name: 'Data (Use and Access) Act 2025',
    citation: '2025 c. 18 · Royal Assent 19 June 2025',
    layer: 'protection-basis',
    summary:
      'The government’s data reform (successor to the abandoned DPDI Bill). Amends — not replaces — UK GDPR/DPA. Adds a seventh Article 6 basis ("recognised legitimate interests", no balancing test), relaxes Article 22 automated decision-making with safeguards, enables digital verification and Smart Data, and replaces the ICO with a new Information Commission. Key provisions in force from 5 February 2026.',
    relevance:
      'Reshapes the lawful-basis and access landscape DfE’s strategy must build on; the new recognised-legitimate-interests basis and ADM rules bear directly on data-driven services.',
    sourceUrl: 'https://www.gov.uk/guidance/data-use-and-access-act-2025-data-protection-and-privacy-changes',
  },
  {
    id: 'dea-2017',
    name: 'Digital Economy Act 2017 (Part 5)',
    citation: '2017 c. 30, Part 5 (ss. 35–45)',
    layer: 'legal-gateway',
    summary:
      'Part 5 Chapter 1 creates a Public Service Delivery data-sharing power for specified public authorities; further chapters cover debt, fraud and research/statistics. The gateways are permissive (not mandatory), do not override data-protection law, and the sharing arrangements are publicly registered.',
    relevance:
      'A candidate statutory power for joining education data with other public services, and (via the research/statistics power) the gateway DfE already uses to share de-identified data through the ONS Secure Research Service.',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2017/30/part/5',
  },
  {
    id: 'cwsa-2025',
    name: 'Children’s Wellbeing and Schools Act 2025',
    citation: '2026 c. 21 · Royal Assent 29 April 2026',
    layer: 'legal-gateway',
    summary:
      'Section 4 inserts new ss. 16LA–16LD into the Children Act 2004: a consistent identifier (Single Unique Identifier) for every child that designated persons must use, a duty to share safeguarding information, and a power to set information standards. The government confirmed (Lords, 22 May 2025) it intends to use the NHS number as the identifier. Also creates Children Not in School registers.',
    relevance:
      'The statutory basis for the consistent child identifier and the data spine — the single most consequential gateway for DfE’s data agenda, and the one that most engages quality, ethics and public trust.',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2026/21/contents',
  },
  {
    id: 'foi-2000',
    name: 'Freedom of Information Act 2000',
    citation: '2000 c. 36',
    layer: 'governance',
    summary: 'Gives a general right of access (s.1) to information held by public authorities listed in Schedule 1, subject to exemptions.',
    relevance: 'An open-by-default posture interacts with FOI obligations and expectations of proactive publication; it shapes what must be disclosable.',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2000/36/contents',
  },
  {
    id: 'eir-2004',
    name: 'Environmental Information Regulations 2004',
    citation: 'SI 2004/3391',
    layer: 'governance',
    summary: 'A parallel access regime for environmental information, implementing the Aarhus Convention with a presumption in favour of disclosure.',
    relevance: 'Relevant where education-estate or environmental data is held; part of the openness picture.',
    sourceUrl: 'https://www.legislation.gov.uk/uksi/2004/3391/contents/made',
  },
  {
    id: 'common-law-confidentiality',
    name: 'Common-law duty of confidentiality',
    layer: 'governance',
    summary:
      'A duty, separate from data-protection law, not to disclose information that has the "necessary quality of confidence" and was imparted in circumstances importing an obligation of confidence, without authority.',
    relevance:
      'Especially live for health and safeguarding data. Having a lawful basis under UK GDPR does not by itself satisfy the duty of confidence — a frequent trap in multi-agency sharing.',
    sourceUrl: 'https://www.gov.uk/government/publications/data-ethics-framework',
  },
];

export const LEGISLATION_BY_ID: Record<string, Legislation> = Object.fromEntries(
  LEGISLATION.map((l) => [l.id, l]),
);

export const LEGAL_LAYER_META: Record<string, { name: string; blurb: string }> = {
  'protection-basis': {
    name: 'A · Data-protection basis',
    blurb: 'The lawful basis to process personal data at all (UK GDPR / DPA 2018 / DUAA 2025).',
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
