// maturity.ts — the data-maturity dimensions, modelled on the Data Maturity Assessment
// for Government (CDDO + ONS Data Quality Hub). The lead self-assesses CURRENT and TARGET
// level (1–5) per dimension; the engine estimates progress from the capability areas that
// drive each one. Each dimension carries a corporate crosswalk (DAMA-DMBOK / DCAM).

import type { MaturityDimension } from './types';

export const MATURITY_LEVELS = [
  { level: 1, name: 'Beginning', blurb: 'Ad hoc; data managed in silos, little shared practice.' },
  { level: 2, name: 'Emerging', blurb: 'Pockets of good practice; awareness growing but inconsistent.' },
  { level: 3, name: 'Learning', blurb: 'Defined approaches in place; applied unevenly across the organisation.' },
  { level: 4, name: 'Developing', blurb: 'Consistent, managed practice; data treated as an asset.' },
  { level: 5, name: 'Mastering', blurb: 'Optimised and embedded; data drives decisions by default.' },
];

export const MATURITY_DIMENSIONS: MaturityDimension[] = [
  {
    id: 'leadership',
    name: 'Leadership & vision',
    description:
      'Senior ownership of data as a strategic asset: a clear vision, a mandated Chief Data Officer, and data on the board’s agenda.',
    areas: ['governance', 'value'],
    govSource: 'Data Maturity Assessment for Government — leadership',
    corporateCrosswalk: 'DAMA: Data Governance · DCAM: Data Management Strategy',
  },
  {
    id: 'culture',
    name: 'Culture & engagement',
    description:
      'How far the organisation values evidence, trusts its data, and engages staff and partners in using it well.',
    areas: ['skills', 'value'],
    govSource: 'Data Maturity Assessment for Government — culture',
    corporateCrosswalk: 'DCAM: Organisational data culture',
  },
  {
    id: 'skills',
    name: 'Skills & capability',
    description:
      'The depth of the data profession, analytical capacity and leadership data-fluency — and the pipeline to sustain them.',
    areas: ['skills'],
    govSource: 'Data Maturity Assessment for Government — skills',
    corporateCrosswalk: 'DAMA: people dimension across knowledge areas',
  },
  {
    id: 'governance',
    name: 'Data governance',
    description:
      'Clear ownership, stewardship, accountability and policy — who decides, who is responsible, and how data is controlled across its life.',
    areas: ['governance', 'ethics'],
    govSource: 'Data Maturity Assessment for Government — governance',
    corporateCrosswalk: 'DAMA: Data Governance · DCAM: Governance & Controls',
  },
  {
    id: 'management',
    name: 'Data management & architecture',
    description:
      'Managing data across its lifecycle — architecture, modelling, storage, metadata, reference & master data.',
    areas: ['platform', 'interoperability'],
    govSource: 'Data Maturity Assessment for Government — managing data',
    corporateCrosswalk: 'DAMA: Architecture, Modelling, Storage, Metadata, RMD · DCAM: Data Architecture',
  },
  {
    id: 'quality',
    name: 'Data quality',
    description:
      'Whether data is accurate, complete, timely and consistent enough to trust for decisions — measured and managed, not assumed.',
    areas: ['quality'],
    govSource: 'Government Data Quality Framework',
    corporateCrosswalk: 'DAMA: Data Quality · DCAM: Data Quality Management',
  },
  {
    id: 'tools',
    name: 'Tools & technology',
    description:
      'The platforms, pipelines, catalogues and analytical tooling that make data findable, joinable and usable.',
    areas: ['platform'],
    govSource: 'Data Maturity Assessment for Government — tools',
    corporateCrosswalk: 'DCAM: Technology Architecture · CDMC',
  },
  {
    id: 'use',
    name: 'Data use & analysis',
    description:
      'How well data is turned into insight, decisions, services and (responsibly) AI — including safe sharing and reuse.',
    areas: ['value', 'sharing', 'ethics'],
    govSource: 'Data Maturity Assessment for Government — using data',
    corporateCrosswalk: 'DCAM: Analytics & business value · data products',
  },
];

export const MATURITY_BY_ID: Record<string, MaturityDimension> = Object.fromEntries(
  MATURITY_DIMENSIONS.map((d) => [d.id, d]),
);
