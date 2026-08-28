// maturity.ts — the data-maturity dimensions, aligned to the Data Maturity Assessment (DMA)
// for Government (GDS + CDDO; developed by the ONS Data Quality Hub; published 27 March 2023;
// adapted from the Data Orchard framework). The DMA is a matrix of TEN topics intersecting
// SIX cross-cutting THEMES, scored on a five-level scale. We model the six themes as the
// radar axes; the lead self-assesses CURRENT and TARGET (1–5) per theme and the engine
// estimates progress from the capability areas that drive each.

import type { MaturityDimension } from './types';

// The DMA's five maturity levels (verified).
export const MATURITY_LEVELS = [
  { level: 1, name: 'Beginning', blurb: 'Compliance-only, siloed; data not seen as valuable; little defined responsibility.' },
  { level: 2, name: 'Emerging', blurb: 'Pockets of good practice; awareness growing but inconsistent.' },
  { level: 3, name: 'Learning', blurb: 'Defined approaches in place; applied unevenly across the organisation.' },
  { level: 4, name: 'Developing', blurb: 'Consistent, managed practice; data treated as an asset.' },
  { level: 5, name: 'Mastering', blurb: 'Optimised and embedded; data drives decisions by default.' },
];

// The ten DMA topics (shown on the Method page) sit across these six themes.
export const DMA_TOPICS = [
  'Engaging with others',
  'Having the right data skills and knowledge',
  'Having the right systems',
  'Knowing the data you have',
  'Making decisions with data',
  'Managing and using data safely, ethically and legally',
  'Defining data ownership and accountability',
  'Improving data quality',
  'Funding and resourcing data work',
  'Leadership and a data vision',
];

// The six DMA themes, as the maturity radar axes.
export const MATURITY_DIMENSIONS: MaturityDimension[] = [
  {
    id: 'leadership',
    name: 'Leadership',
    description: 'Senior ownership and a clear data vision: data on the board’s agenda, a mandated CDO, resourcing and direction.',
    areas: ['governance', 'value'],
    govSource: 'DMA for Government — Leadership theme',
    corporateCrosswalk: 'DAMA: Data Governance · DCAM: Data Management Strategy',
  },
  {
    id: 'culture',
    name: 'Culture',
    description: 'How far the organisation values evidence, trusts its data and engages staff and partners in using it well and responsibly.',
    areas: ['value', 'ethics'],
    govSource: 'DMA for Government — Culture theme',
    corporateCrosswalk: 'DCAM: organisational data culture; data literacy',
  },
  {
    id: 'skills',
    name: 'Skills',
    description: 'The depth of the data profession, analytical capacity and leadership data-fluency — and the pipeline to sustain them.',
    areas: ['skills'],
    govSource: 'DMA for Government — Skills theme',
    corporateCrosswalk: 'DAMA: the people dimension across knowledge areas',
  },
  {
    id: 'tools',
    name: 'Tools',
    description: 'The platforms, pipelines, catalogues and analytical tooling that make data findable, joinable and usable.',
    areas: ['platform'],
    govSource: 'DMA for Government — Tools theme',
    corporateCrosswalk: 'DCAM: Technology Architecture · CDMC',
  },
  {
    id: 'data',
    name: 'Data',
    description: 'Knowing the data you have and trusting it: architecture, metadata, reference & master data, and data quality.',
    areas: ['quality', 'interoperability'],
    govSource: 'DMA for Government — Data theme; Government Data Quality Framework',
    corporateCrosswalk: 'DAMA: Architecture, Metadata, RMD, Data Quality',
  },
  {
    id: 'uses',
    name: 'Uses',
    description: 'How well data is turned into decisions, services and (responsibly) AI — including safe sharing, reuse and analysis.',
    areas: ['value', 'sharing', 'ethics'],
    govSource: 'DMA for Government — Uses theme',
    corporateCrosswalk: 'DCAM: Analytics & business value; data products',
  },
];

export const MATURITY_BY_ID: Record<string, MaturityDimension> = Object.fromEntries(
  MATURITY_DIMENSIONS.map((d) => [d.id, d]),
);
