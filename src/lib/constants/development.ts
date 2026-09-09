export const PRODUCT_AREAS = ['Public site', 'News', 'Health', 'Intelligence', 'Maps', 'Decks', 'Platform', 'JKAI'] as const;
export type DeliveryStage = 'brief' | 'queued' | 'building' | 'needs_input' | 'review' | 'integrating' | 'accepted' | 'pr_open' | 'deployed';

/**
 * How far a feature is allowed to travel without the owner pressing anything.
 *
 * Three separate permissions, deliberately: spending on implementation, asking
 * GitHub for a review, and letting a merge reach production are different
 * decisions, and the 2026-09-07 architecture review asks for exactly that split.
 * `preview_only` is the default and the behaviour every existing delivery had.
 */
export const RELEASE_POLICIES = ['preview_only', 'pull_request', 'production'] as const;
export type ReleasePolicy = (typeof RELEASE_POLICIES)[number];
export const RELEASE_POLICY_LABELS: Record<ReleasePolicy, string> = {
  preview_only: 'Preview only',
  pull_request: 'Open a pull request',
  production: 'Ship to production',
};
/** Rounds an unattended run may take before it stops and asks for a human. */
export const AUTOPILOT_ROUNDS = { default: 6, max: 12 } as const;
export interface Criterion {
  id: string;
  text: string;
  verdict: 'unverified' | 'passed' | 'failed' | 'blocked';
  evidence: string;
  /** The revision this verdict judges — the one the owner had on screen. */
  revision: string | null;
  /** Set when the owner added this after the brief was accepted. */
  addedBy?: 'owner';
  /**
   * A reviewer's judgement, always subordinate to an owner verdict.
   *
   * `independent` records whether the reviewer was a different model from the
   * one that wrote the code. False is not an error — an unpinned adversary
   * follows the site default — but it is the difference between a second
   * opinion and a build marking its own homework, so it is stored rather than
   * assumed.
   */
  assessment?: { basis: 'observed' | 'inferred'; verdict: 'passed' | 'failed' | 'blocked'; evidence: string; model: string; independent?: boolean; revision: string; at: string };
}
export interface DeliveryState {
  version: 1;
  /**
   * Was this delivery asked for on /jkai/develop?
   *
   * A delivery row is normally what makes a build a development feature, but it
   * is not only created there: `pi-runner` calls `ensureDelivery` opportunistically
   * the first time ANY build — forge, studio, sandbox app, change request — asks
   * the owner a question, purely so the question has somewhere to live. Without
   * this flag such a build silently left the archive, taking its Promote, Edit
   * card, Copy link, Unpublish and Delete actions with it, since those exist
   * nowhere else.
   *
   * Absent means commissioned, so every delivery written before this flag keeps
   * its place in the portfolio.
   */
  commissioned?: boolean;
  area: string;
  stage: DeliveryStage;
  originalAsk?: string;
  cycle?: { startedAt: string; modelId?: string; startingCandidate?: string | null; preflightAt?: string; firstPreviewAt?: string; candidateAt?: string; failureKind?: 'infrastructure' | 'feature' | 'deadline'; failure?: string; repairAttempts: number; modelMs: number; previewMs: number; verificationMs: number; phaseMs?: Record<string, number>; };
  grooming?: { turns?: Array<{ questions: string; answer: string }>; model: string; at: string; summary: string };
  brief: { scope?: string; dependencies?: string; assumptions?: string; questions?: string; validation?: string; revision: number; outcome: string; constraints: string; routes: string[]; acceptedAt: string | null };
  criteria: Criterion[];
  /**
   * Blocking questions the worker asked. `answeredBy` matters: autopilot may
   * answer from the accepted brief, and an owner reading the history later
   * must be able to tell which answers were theirs.
   */
  decisions: Array<{ id: string; question: string; answer: string | null; requestId?: string; answeredBy?: 'owner' | 'autopilot'; answeredAt?: string }>;
  session: { engine: 'pi'; id: string | null; file: string | null; recovery: string | null };
  candidate: string | null;
  changes?: { files: string[]; patch: string };
  gate: { passed: boolean; evidence: string; revision: string } | null;
  preview: { revision?: string; kind?: 'working' | 'inspection' | 'release'; number?: number; evidence?: string[]; lastError?: string; url: string | null; status: 'unavailable' | 'starting' | 'ready' | 'failed'; detail: string };
  batch: string | null;
  acceptedAt: string | null;
  releasePolicy: ReleasePolicy;
  /**
   * The unattended loop's own state. Lives in the delivery jsonb rather than in
   * columns so enabling it needs no migration — and so a `drizzle push` at
   * release time has nothing to do, which is where this repo has lost deploys
   * before.
   */
  autopilot?: {
    enabled: boolean;
    /** Completed rounds. One round = assess, then either coach or release. */
    rounds: number;
    maxRounds: number;
    startedAt: string;
    lastRoundAt?: string;
    /** Set when the loop ends. Empty while it is still running. */
    stopReason?: string;
    /** The adversary's standing objection, when it vetoed an all-pass round. */
    veto?: { reason: string; evidence: string; model: string; revision: string; at: string };
  };
  /** Everything after the batch: the branch, its PR, CI, and the serving sha. */
  release?: {
    revision: string;
    branch?: string;
    prUrl?: string;
    prNumber?: number;
    requestedAt?: string;
    ci?: 'pending' | 'success' | 'failure';
    mergedAt?: string;
    mergeSha?: string;
    deployedSha?: string;
    deployedAt?: string;
    detail?: string;
    blocker?: string;
  };
}
