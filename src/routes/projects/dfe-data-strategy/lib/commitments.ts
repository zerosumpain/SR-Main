// commitments.ts — the commitments ledger. Every data-relevant commitment in the
// 2024→2026 white-paper landscape that DfE must deliver, produce, support or comply
// with, synthesized from a nine-agent research sweep of primary sources (gov.uk,
// legislation.gov.uk, parliament.uk) on 2026-07-02 and verified before freeze.
// The dataset is filled by Task B1 of docs/superpowers/plans/2026-07-02-keystone-upgrade.md;
// integrity is enforced by lib/__tests__/commitments.test.ts.

import type { Commitment, CommitmentStatus, CommitmentTheme, DfeRole, PolicyDocument } from './types';

// Colors validated (dataviz six-checks, light surface) 2026-07-02: lightness band,
// chroma floor, adjacent-pair CVD (with glyph/gap/label secondary encoding), contrast.
// THEME_ORDER is the validated fixed legend/assignment order — never cycle or repaint.
export const THEME_ORDER: CommitmentTheme[] = [
  'identifiers',
  'analytics',
  'standards',
  'accountability',
  'safeguarding',
  'data-sharing',
  'funding',
  'new-service',
  'ai',
  'workforce',
  'infrastructure',
  'register',
];

export const THEME_META: Record<CommitmentTheme, { label: string; color: string }> = {
  identifiers: { label: 'Identifiers', color: '#8a2d3a' },
  analytics: { label: 'Analytics & evidence', color: '#0086a3' },
  standards: { label: 'Standards', color: '#a06a1f' },
  accountability: { label: 'Accountability', color: '#4558b2' },
  safeguarding: { label: 'Safeguarding', color: '#b04a2f' },
  'data-sharing': { label: 'Data sharing', color: '#2c6fa3' },
  funding: { label: 'Funding & oversight', color: '#9a6416' },
  'new-service': { label: 'New services', color: '#2f7a4f' },
  ai: { label: 'AI', color: '#7d3c78' },
  workforce: { label: 'Workforce', color: '#6f8034' },
  infrastructure: { label: 'Infrastructure', color: '#4d6ba8' },
  register: { label: 'Registers', color: '#8a63c9' },
};

export const STATUS_META: Record<CommitmentStatus, { label: string; short: string; rank: number }> = {
  'statutory-duty': { label: 'Statutory duty — in force', short: 'Statutory', rank: 0 },
  'legislated-not-commenced': { label: 'Legislated, not yet commenced', short: 'Legislated', rank: 1 },
  'in-delivery': { label: 'In delivery', short: 'Delivering', rank: 2 },
  announced: { label: 'Announced', short: 'Announced', rank: 3 },
  proposed: { label: 'Proposed', short: 'Proposed', rank: 4 },
  consulting: { label: 'In consultation', short: 'Consulting', rank: 5 },
};

export const ROLE_META: Record<DfeRole, { label: string; note: string }> = {
  owner: { label: 'DfE owns it', note: 'DfE is accountable for delivering this commitment.' },
  deliverer: { label: 'DfE delivers', note: 'DfE builds or runs a major part of it.' },
  partner: { label: 'DfE partners', note: 'Another department leads; DfE must supply or receive data.' },
  complier: { label: 'DfE complies', note: 'A cross-government mandate DfE must meet.' },
};

export const DOCUMENTS: PolicyDocument[] = [];

export const COMMITMENTS: Commitment[] = [];

export const DOCUMENTS_BY_ID: Record<string, PolicyDocument> = Object.fromEntries(DOCUMENTS.map((d) => [d.id, d]));

export const COMMITMENTS_BY_DOC: Record<string, Commitment[]> = COMMITMENTS.reduce(
  (acc, c) => {
    (acc[c.docId] ??= []).push(c);
    return acc;
  },
  {} as Record<string, Commitment[]>,
);

/** Statutory + in-delivery commitments, hardest-binding first — the strategy's must-answer list. */
export const MUST_ANSWER: Commitment[] = COMMITMENTS.filter((c) =>
  ['statutory-duty', 'legislated-not-commenced', 'in-delivery'].includes(c.status),
).sort((a, b) => STATUS_META[a.status].rank - STATUS_META[b.status].rank);
