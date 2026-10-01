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
/**
 * Which lane an ask belongs in, decided before anything is built.
 *
 * The 2026-09-25 review found five of six /jkai/develop asks were standalone
 * explainers or toys, and one ("a random sausage generator") was groomed into
 * a /marble-run feature although Marble Run lives in its own repository. The
 * development lane is the only one that clones SR-Main, so it is the wrong
 * place for anything that does not need the platform.
 *
 *  - `site`: needs the platform — Postgres, the auth gate, the LLM gateway, the
 *    site's navigation or its data — so it belongs in SR-Main;
 *  - `studio`: a standalone explainer, toy or app that needs none of that;
 *  - `other-repo`: changes something that lives in another repository.
 */
export const BRIEF_LANES = ['site', 'studio', 'other-repo'] as const;
export type BriefLaneKind = (typeof BRIEF_LANES)[number];
export interface BriefLane {
  lane: BriefLaneKind;
  reason: string;
  /** `owner/name` when the lane is `other-repo`. */
  repo?: string;
  /** Who decided: the grooming model, a deterministic rule, or nobody (an ungroomed brief). */
  source: 'grooming' | 'rule' | 'unchecked';
}
/** One problem with a brief. `block` stops acceptance unless the owner overrides it. */
export interface BriefFinding {
  kind: 'route' | 'criterion' | 'preview' | 'lane';
  severity: 'block' | 'warn';
  /** The route or criterion text the finding is about. */
  subject: string;
  message: string;
  /** `model` findings came from the one LLM pass; the rest are rules. */
  source?: 'rule' | 'model';
}
export interface BriefLint {
  /** The brief revision this judged. A newer brief needs judging again. */
  revision: number;
  at: string;
  lane: BriefLane;
  findings: BriefFinding[];
  /** False when no route manifest was available, so routes went unchecked. */
  routesChecked: boolean;
  /** Who caused this check: the owner's page (groom or Accept) or an unattended run. */
  by?: 'owner' | 'autopilot';
  /** The criteria the model pass judged, so an unchanged set is not paid for twice. */
  judged?: { key: string; model: string };
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
  /** `by: 'autopilot'` when an unattended run groomed it, which skips the owner's grace period. */
  grooming?: { turns?: Array<{ questions: string; answer: string }>; model: string; at: string; summary: string; by?: 'owner' | 'autopilot' };
  brief: {
    scope?: string; dependencies?: string; assumptions?: string; questions?: string; validation?: string; revision: number; outcome: string; constraints: string;
    /** Existing site paths the feature changes. Each must be in the route manifest. */
    routes: string[];
    /** Paths the feature proposes to create. Listed apart so a typo in `routes` cannot pass as a new page. */
    newRoutes?: string[];
    /** The grooming model's lane proposal, as it returned it. `lint.lane` is the verdict. */
    lane?: Omit<BriefLane, 'source'>;
    /** The last brief check, written at grooming and at every acceptance attempt. */
    lint?: BriefLint;
    /** What the owner chose to accept past, recorded so the history says so. */
    override?: { lane?: boolean; lint?: boolean; acknowledged?: string[]; at: string };
    acceptedAt: string | null;
    /** Absent on briefs accepted before autopilot could accept one. */
    acceptedBy?: 'owner' | 'autopilot';
  };
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
    /**
     * Consecutive restarts after an INFRASTRUCTURE failure. These do not spend
     * rounds — the candidate did not cause them — but they are bounded, or a
     * dead broker would be retried for ever.
     */
    infraRetries?: number;
    /** The last feature failure, so the same one recurring can end the run. */
    lastFailure?: { signature: string; count: number };
  };
  /** Everything after the batch: the branch, its PR, CI, and the serving sha. */
  release?: {
    revision: string;
    branch?: string;
    prUrl?: string;
    prNumber?: number;
    requestedAt?: string;
    ci?: 'pending' | 'success' | 'failure';
    /** When CI first reported every check green on this pull request. */
    ciGreenAt?: string;
    /** The failing checks and the part of their logs worth reading. */
    ciFailure?: string;
    /** The candidate CI failed on. It may not be released again unchanged. */
    failedRevision?: string;
    /** Pull requests this feature opened and then closed to repair a red CI run. */
    supersededPrs?: number[];
    /** CI's merge policy for this change: `high` touches a protected path and waits for a person. */
    tier?: 'low' | 'high';
    /** The protected paths that made it `high`. */
    protectedPaths?: string[];
    /** Set once the owner has been told this release is waiting on them. */
    awaitingOwner?: string;
    mergedAt?: string;
    mergeSha?: string;
    deployedSha?: string;
    deployedAt?: string;
    detail?: string;
    blocker?: string;
  };
  /**
   * Failures the build-history graph is waiting to see fixed.
   *
   * A fail→fix episode needs both ends, and they arrive minutes or days apart —
   * isolated verification fails on one candidate and passes on a later one, or
   * CI goes red on one pull request and green on its replacement. The red end
   * is parked here until a green one of the SAME source turns up. jsonb on the
   * delivery rather than a table for the reason `autopilot` gives: no migration,
   * nothing for a release-time `drizzle push` to do.
   */
  codegraph?: { pending: PendingFailure[] };
}

/** One red gate result, kept until a later green one proves what fixed it. */
export interface PendingFailure {
  /**
   * Which gate failed. A CI failure is only ever paired with a CI pass. `gate`
   * is the change-request lane's in-workspace `npm run gate`, which has no
   * candidate sha — its `revision` is the failing iteration's id.
   */
  source: 'verification' | 'ci' | 'gate';
  /** The candidate that failed: one end of the per-revision file diff. */
  revision: string;
  /** The episode's key: the most specific fingerprint, as the hot lane will ask for it. */
  fingerprint: string;
  /** The failure text, trimmed. Becomes the episode's `problem`. */
  excerpt: string;
  at: string;
  prNumber?: number;
}
