/**
 * Release-log shared types.
 *
 * The ingest payload is produced by scripts/release-log/collect.mjs (plain git
 * facts, no interpretation) and consumed by /api/releases/ingest. The summary
 * types are what the LLM is asked to return in $lib/releases/summarise.ts.
 */

export const RELEASE_ITEM_KINDS = ['feature', 'fix', 'improvement', 'infra', 'content', 'chore'] as const;
export type ReleaseItemKind = (typeof RELEASE_ITEM_KINDS)[number];

export const RELEASE_IMPACTS = ['user-facing', 'internal'] as const;
export type ReleaseImpact = (typeof RELEASE_IMPACTS)[number];

export const RELEASE_CONFIDENCES = ['low', 'medium', 'high'] as const;
export type ReleaseConfidence = (typeof RELEASE_CONFIDENCES)[number];

export const RELEASE_VIA = ['github-actions', 'manual', 'backfill'] as const;
export type ReleaseVia = (typeof RELEASE_VIA)[number];

export type CommitFact = {
  sha: string;
  short: string;
  author: string;
  date: string; // ISO
  subject: string;
  body: string;
  /** PR number parsed from a squash-merge subject `(#123)` or a merge commit. */
  pr: number | null;
};

export type FileFact = {
  path: string;
  /** git name-status letter: A/M/D/R… ('M' when unknown). */
  status: string;
  insertions: number;
  deletions: number;
};

export type ReleaseStats = {
  commits: number;
  files: number;
  insertions: number;
  deletions: number;
  prs: number[];
};

/** The POST body accepted by /api/releases/ingest. */
export type ReleaseIngestPayload = {
  sha: string;
  shortSha: string;
  prevSha: string | null;
  branch?: string;
  via?: ReleaseVia;
  deployedAt: string; // ISO
  builtAt?: string | null;
  commits: CommitFact[];
  files: FileFact[];
  stats: ReleaseStats;
  contentHash?: string;
};

/** One entry the LLM produces for a release. */
export type ReleaseItemSummary = {
  kind: ReleaseItemKind;
  impact: ReleaseImpact;
  title: string;
  summary: string;
  includes: string[];
  excludes: string[];
  surfaces: string[];
  files: string[];
  commits: string[];
  confidence: ReleaseConfidence;
};

export type ReleaseSummary = {
  title: string;
  summary: string;
  items: ReleaseItemSummary[];
};

export const KIND_LABEL: Record<ReleaseItemKind, string> = {
  feature: 'Feature',
  fix: 'Fix',
  improvement: 'Improvement',
  infra: 'Infra',
  content: 'Content',
  chore: 'Chore',
};
