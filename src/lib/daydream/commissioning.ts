/** Shared product contract. Feedback and backlog intake never grant execution. */
export const COMMISSION_STATES = ['awaiting_approval', 'deferred', 'declined', 'queued', 'running', 'needs_attention', 'completed', 'cancelled'] as const;
export type CommissionState = typeof COMMISSION_STATES[number];
export type CommissionDecision = 'approve' | 'defer' | 'decline' | 'cancel' | 'retry';
export interface EvidenceRead {
  sourceRef: string;
  tool: string;
  args: Record<string, unknown>;
}
export interface ImprovementSpec {
  version: 1;
  route: 'evidence_refresh';
  title: string;
  outcome: string;
  currentBehaviour: string;
  improvedBehaviour: string;
  reuseAssessment: string[];
  acceptance: string[];
  effects: string[];
  exclusions: string[];
  reads: EvidenceRead[];
  sourceHash: string;
  ownerCorrection: string | null;
  budget: { maxReads: number; maxAttempts: number; maxWallSeconds: number };
}
export interface CommissionEvent {
  id: string;
  sequence: number;
  kind: string;
  summary: string;
  at: string;
  data: Record<string, unknown>;
}
export interface EvidenceResult {
  sourceRef: string;
  tool: string;
  retrievedAt: string;
  contentHash: string;
  text: string;
  status: 'available' | 'unavailable';
  /** This receipt proves a query, never an independently verified purchase. */
  provenance: 'query_result';
}
export interface CommissionView {
  id: string;
  thoughtId: string;
  backlogSlug: string;
  state: CommissionState;
  revision: number;
  specHash: string;
  spec: ImprovementSpec;
  approvedAt: string | null;
  updatedAt: string;
  nextActor: string;
  workflowRunId: string | null;
  result: { summary: string; evidence: EvidenceResult[] } | null;
  error: string | null;
  events: CommissionEvent[];
  url: string;
}
export const COMMISSION_LABELS: Record<CommissionState, string> = {
  awaiting_approval: 'Awaiting your approval', deferred: 'Deferred', declined: 'Declined',
  queued: 'Queued for execution', running: 'Refreshing evidence', needs_attention: 'Needs attention',
  completed: 'Evidence report ready', cancelled: 'Cancelled',
};
export function nextActor(state: CommissionState): string {
  if (['awaiting_approval', 'deferred', 'needs_attention'].includes(state)) return 'You';
  if (['queued', 'running'].includes(state)) return 'Workflow worker';
  return 'None';
}
export function commissionPath(id: string): string {
  return `/jkai/daydreams?commission=${encodeURIComponent(id)}`;
}
export function decisionAllowed(state: CommissionState, decision: CommissionDecision): boolean {
  if (decision === 'approve') return state === 'awaiting_approval' || state === 'deferred';
  if (decision === 'defer' || decision === 'decline') return state === 'awaiting_approval' || state === 'deferred';
  if (decision === 'cancel') return ['awaiting_approval', 'deferred', 'queued', 'running', 'needs_attention'].includes(state);
  return decision === 'retry' && state === 'needs_attention';
}

/** Decode the existing think-card contract, never execute text from an excerpt. */
export function sourceReads(evidence: unknown, allowed: readonly string[]): EvidenceRead[] {
  if (!Array.isArray(evidence)) return [];
  const reads = new Map<string, EvidenceRead>();
  for (const source of evidence) {
    if (!source || source.kind !== 'think-card' || typeof source.id !== 'string') continue;
    const match = /^([a-z_]+):(\[.*\])@\d{4}-\d{2}-\d{2}$/.exec(source.id);
    if (!match || !allowed.includes(match[1]) || match[2].length > 4000) continue;
    try {
      const pairs: unknown = JSON.parse(match[2]);
      if (!Array.isArray(pairs) || pairs.length > 20 || !pairs.every(p => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && !['__proto__', 'constructor', 'prototype'].includes(p[0]))) continue;
      const args: Record<string, unknown> = Object.fromEntries(pairs);
      const key = `${match[1]}:${match[2]}`;
      if (!reads.has(key)) reads.set(key, { sourceRef: source.id, tool: match[1], args });
    } catch { /* Historical/malformed references need a new scoped proposal. */ }
  }
  return [...reads.values()].slice(0, 8);
}
