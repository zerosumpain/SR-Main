// commitments.ts — the commitments ledger. Every data-relevant commitment in the
// 2024→2026 white-paper landscape that DfE must deliver, produce, support or comply
// with, synthesized from a nine-agent research sweep of primary sources (gov.uk,
// legislation.gov.uk, parliament.uk) on 2026-07-02 and verified before freeze.
// The dataset is filled by Task B1 of docs/superpowers/plans/2026-07-02-keystone-upgrade.md;
// integrity is enforced by lib/__tests__/commitments.test.ts.

import type { Commitment, CommitmentStatus, CommitmentTheme, DfeRole, PolicyDocument } from './types';

export const THEME_META: Record<CommitmentTheme, { label: string; color: string }> = {
  identifiers: { label: 'Identifiers', color: '#8a2d3a' },
  'data-sharing': { label: 'Data sharing', color: '#2f6f97' },
  'new-service': { label: 'New service', color: '#2f6155' },
  register: { label: 'Registers', color: '#5d4a82' },
  standards: { label: 'Standards', color: '#a06a1f' },
  ai: { label: 'AI', color: '#7d3c78' },
  analytics: { label: 'Analytics & evidence', color: '#1f7a8c' },
  infrastructure: { label: 'Infrastructure', color: '#55606b' },
  safeguarding: { label: 'Safeguarding', color: '#b04a2f' },
  accountability: { label: 'Accountability', color: '#3f5d8a' },
  workforce: { label: 'Workforce', color: '#6d7f3c' },
  funding: { label: 'Funding & oversight', color: '#8a6d3b' },
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
