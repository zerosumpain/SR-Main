export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale';

export type ProseProposal = {
  id: string;
  kind: 'prose';
  original: string;
  suggested: string;
  reason?: string;
  anchor: { from: number; to: number };
  status: ProposalStatus;
  /** When set, this proposal supersedes the named one (regenerate flow). */
  replaces?: string;
};

export type MetaField = 'title' | 'excerpt' | 'slug' | 'tags' | 'status' | 'cover_alt';

export type MetaProposal = {
  id: string;
  kind: 'meta';
  field: MetaField;
  currentValue: unknown;
  suggestedValue: unknown;
  reason?: string;
  status: ProposalStatus;
  replaces?: string;
};

export type Proposal = ProseProposal | MetaProposal;

export function isProseProposal(p: Proposal): p is ProseProposal {
  return p.kind === 'prose';
}

export function isMetaProposal(p: Proposal): p is MetaProposal {
  return p.kind === 'meta';
}
