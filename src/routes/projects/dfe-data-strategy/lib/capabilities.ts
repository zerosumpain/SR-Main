// capabilities.ts — the capability/investment areas. These are the allocation
// buckets the lead splits finite effort across, AND the join between pressures
// (which demand certain areas) and the maturity dimensions (which they advance).
// Eight areas, deliberately mapped to the language of the UK-gov + corporate
// frameworks (DMA-for-Government, DAMA-DMBOK, DCAM).

import type { CapabilityArea } from '$lib/dfe-data-strategy/types';

export const CAPABILITY_AREAS: CapabilityArea[] = [
  {
    id: 'governance',
    name: 'Governance & operating model',
    short: 'Governance',
    description:
      'Ownership, stewardship, accountability and decision rights — the data operating model, the role of the Chief Data Officer, policy and oversight. DAMA: Data Governance. DMA: Leadership & Management.',
  },
  {
    id: 'platform',
    name: 'Platform & infrastructure',
    short: 'Platform',
    description:
      'The shared technical backbone: cloud, storage, pipelines, cataloguing and the tooling that lets data move and be found. DAMA: Data Storage & Operations / Architecture. DMA: Tools.',
  },
  {
    id: 'skills',
    name: 'Skills, capacity & literacy',
    short: 'Skills',
    description:
      'The data profession, analytical capacity, leadership data-fluency and a culture that values evidence. DMA: Skills & Culture.',
  },
  {
    id: 'interoperability',
    name: 'Interoperability & standards',
    short: 'Interop',
    description:
      'Common identifiers, data standards, APIs, reference & master data and metadata — so systems and partners can join data up. DAMA: Metadata / Reference & Master Data. The CDDO data-standards mission.',
  },
  {
    id: 'quality',
    name: 'Data quality & management',
    short: 'Quality',
    description:
      'Accuracy, completeness, timeliness and the data lifecycle — the path to a trustworthy single source of truth. Government Data Quality Framework. DAMA: Data Quality.',
  },
  {
    id: 'ethics',
    name: 'Ethics, trust & transparency',
    short: 'Ethics',
    description:
      'Lawful, fair and transparent use; public trust; bias and safeguarding; the Data Ethics Framework and the Algorithmic Transparency Recording Standard.',
  },
  {
    id: 'sharing',
    name: 'Partner data-sharing & linkage',
    short: 'Sharing',
    description:
      'Cross-organisation sharing and record linkage — the consistent identifier, the data spine, multi-agency flows with LAs, MATs, agencies and ONS. DEA 2017 gateways.',
  },
  {
    id: 'value',
    name: 'Use, decisions & value',
    short: 'Value',
    description:
      'Turning data into decisions, services and (responsibly) AI — value realisation, data products and self-service analytics. DCAM: Data Architecture in support of business value.',
  },
];

export const CAPABILITY_IDS = CAPABILITY_AREAS.map((c) => c.id);
export const CAPABILITY_BY_ID: Record<string, CapabilityArea> = Object.fromEntries(
  CAPABILITY_AREAS.map((c) => [c.id, c]),
);
