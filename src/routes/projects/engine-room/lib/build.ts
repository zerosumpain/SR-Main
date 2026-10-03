// build.ts — the words for the Build pages. Words only: stage names, caps and counts come
// from the feature through `facts.server.ts`, and the live counts through `live.server.ts`.
//
// Every map is keyed by the feature's own type with `satisfies`, so a stage, phase, policy
// or lane added to the builder fails svelte-check here until it has a sentence.

import type { DeliveryStage, ReleasePolicy, BriefLaneKind } from '$lib/constants/development';
import type { RepoVerificationPhase } from '$lib/verification/repo';
import type { DevelopmentLane } from '$lib/builds/development-progress';
import type { PhaseName } from '$lib/selfimprove/types';
import type { IdeaSource } from '$lib/selfimprove/board';
import type { EDGE_KINDS } from '$lib/codegraph/query';
import type { GateName } from '$lib/codegraph/gates';
import type { Twin } from './daydream';

type EdgeKind = (typeof EDGE_KINDS)[number];

/** A delivery's journey, stage by stage, as the builder stores it. */
export const DELIVERY_COPY = {
  brief: { label: 'Brief', plain: 'The idea is written up as a brief with the routes it touches and the tests it has to pass.', eng: 'Groomed into scope, routes, new routes and criteria, then linted. A blocking finding stops acceptance unless I override it.' },
  queued: { label: 'Queued', plain: 'Accepted, and waiting for the builder to be free.', eng: 'Accepted brief, waiting for the sidecar to claim it.' },
  building: { label: 'Building', plain: 'An agent is writing the code in its own copy of the site.', eng: 'A worker iterates in an isolated worktree under the build budget, running the gate between rounds.' },
  needs_input: { label: 'Needs input', plain: 'It hit a question it shouldn’t guess at, and it’s asking.', eng: 'A blocking decision is open. Autopilot may answer from the accepted brief, and records that it did.' },
  review: { label: 'Review', plain: 'There’s a working preview, and each test is marked pass or fail with evidence.', eng: 'A candidate revision has a preview. Every criterion carries a verdict for that revision, with an independent reviewer’s assessment beside it.' },
  integrating: { label: 'Integrating', plain: 'The accepted change is being brought up to date with everything else.', eng: 'The accepted candidate is rebased and re-verified against the current base branch.' },
  accepted: { label: 'Accepted', plain: 'Signed off and ready to release.', eng: 'Accepted at a specific revision. Release follows the delivery’s release policy.' },
  pr_open: { label: 'Pull request', plain: 'It’s on GitHub as a pull request. Normal CI decides what happens next.', eng: 'A PR is open. A draft unless the policy is production, so a person has to mark it ready.' },
  deployed: { label: 'Deployed', plain: 'Merged, and the live site is serving it.', eng: 'Merged, and production reports the merge commit.' },
} satisfies Record<DeliveryStage, Twin & { label: string }>;

/** The live board groups deliveries into these lanes. */
export const LANE_COPY = {
  brief: 'Being written up',
  building: 'Being built',
  input: 'Waiting on me',
  review: 'Ready to review',
  accepted: 'Accepted',
  shipped: 'Shipped',
} satisfies Record<DevelopmentLane, string>;

export const POLICY_COPY = {
  preview_only: { plain: 'Build it and show me. Nothing leaves the preview.', eng: 'No branch is pushed. The default.' },
  pull_request: { plain: 'Build it and open a draft pull request I have to mark ready.', eng: 'Pushes a branch and opens a draft PR. CI ignores drafts for merging.' },
  production: { plain: 'Build it, open a ready pull request, and let normal CI decide whether it merges.', eng: 'Non-draft PR. CI auto-merges only a low-risk PR from an agent branch, and never anything touching a protected path.' },
} satisfies Record<ReleasePolicy, Twin>;

export const BRIEF_LANE_COPY = {
  site: 'needs the site itself, so it’s built here',
  studio: 'a standalone toy or explainer, built on its own',
  'other-repo': 'changes another repository, so it goes there',
} satisfies Record<BriefLaneKind, string>;

/** The proof chain a repo build walks after the code is written. */
export const VERIFY_COPY = {
  feedback_gate: { label: 'Gate', plain: 'Type check, tests and build, the same commands I’d run.', eng: 'The repository’s own gate command, run in the worktree. A failure goes back to the agent as feedback.' },
  release_candidate: { label: 'Candidate', plain: 'The passing version is frozen so what’s reviewed is what ships.', eng: 'The passing revision is pinned as the release candidate. Later verdicts refer to it.' },
  publish: { label: 'Publish', plain: 'It’s pushed to GitHub.', eng: 'Branch pushed and the PR opened per the release policy.' },
  ci: { label: 'CI', plain: 'GitHub runs every check again on its own machines.', eng: 'The same CI any human PR gets, including the risk tier that refuses protected paths.' },
  deploy: { label: 'Deploy', plain: 'If it merges, the site confirms it’s serving the new code.', eng: 'Production reports the merge commit before the delivery is marked deployed.' },
} satisfies Record<RepoVerificationPhase, Twin & { label: string }>;

export const GATE_COPY = {
  vitest: 'unit tests',
  typecheck: 'TypeScript types',
  'svelte-check': 'component types',
  build: 'production build',
  lint: 'lint and format',
  gate: 'the whole chain',
  cmd: 'any other command',
} satisfies Record<GateName, string>;

/** The nightly run, phase by phase, in the order it runs them. */
export const PHASE_COPY = {
  gather: { plain: 'Collects yesterday’s questions and tool results, and tidies the backlog.', eng: 'Gathers recent messages and the tool audit, then reconciles backlog epics with their deliverables.' },
  learn: { plain: 'Works out what it couldn’t do and what would have helped.', eng: 'Turns the signals into insights and a list of opportunities.' },
  discover: { plain: 'Looks for outside services that would fill those gaps.', eng: 'Searches for APIs matching the data-source opportunities and grows the API catalogue.' },
  build: { plain: 'Retired. It used to write new tools by itself. Tool ideas now go through the backlog like everything else.', eng: 'Kept in the run record, always skipped, so every night’s record has the same shape.', retired: true },
  repair: { plain: 'Fixes tools that have started failing.', eng: 'Re-authors broken runtime tools, smoke-tested in an empty sandbox before they’re reinstated.' },
  propose: { plain: 'Starts one bigger change I’ve already agreed to.', eng: 'Turns an accepted backlog item into a development delivery, within the night’s cap. Usually no model call at all.' },
  optimise: { plain: 'Checks whether it’s answering with fewer steps than before.', eng: 'Measures tool calls per answered question and judges any live trial. Last, so it’s the phase that gets squeezed.' },
  report: { plain: 'Writes up the night and tells me.', eng: 'Persists one run record and sends the summary.' },
} satisfies Record<PhaseName, Twin & { retired?: boolean }>;

/** Where backlog ideas come from. Retired channels are kept because old rows carry them. */
export const SOURCE_COPY = {
  owner: 'I added it',
  question: 'from a question I asked',
  think: 'a daydream note',
  fault: 'an old fault record (retired)',
  doctor: 'the workflow doctor',
  starved: 'a tool that kept coming up short',
  health: 'tool health checks',
  appetite: 'the old appetite ledger (retired)',
  engine: 'the improvement engine',
  toolsmith: 'the old toolsmith (retired)',
  trace: 'a chat trace',
  unattributed: 'from before sources were recorded',
} satisfies Record<IdeaSource, string>;

export const EDGE_COPY = {
  co_change: 'files that change together',
  needs_context: 'a file you need to read first',
  gated_by: 'the check that guards a file',
  imports: 'a code import',
  fixed_by: 'the change that fixed a failure',
  tests: 'a test that covers a file',
  references: 'a lesson that names a file',
} satisfies Record<EdgeKind, string>;

/** The heartbeat activities that run daydream and the builder. Names are checked against the registry. */
export const HEARTBEAT_ACTIVITIES = [
  'daydream-think',
  'daydream-features',
  'daydream-notebook',
  'daydream-memory',
  'daydream-bank',
  'daydream-improve',
  'backlog-grooming',
  'build-progress-check',
  'forge-schedules',
] as const;
export type HeartbeatActivity = (typeof HEARTBEAT_ACTIVITIES)[number];

/**
 * Daydream-named activities deliberately left off the public pages, each with its reason.
 * The drift test makes every new daydream or build activity land in one list or the other.
 */
export const HIDDEN_ACTIVITIES: Record<string, string> = {
  'daydream-observe': 'polls where the household is; family location is never described publicly',
  'daydream-places': 'clusters the household trail into places; same reason',
};

export const ACTIVITY_COPY = {
  'daydream-think': 'asks one question and writes notes',
  'daydream-features': 'rebuilds the daily table it correlates over',
  'daydream-notebook': 'reads my notebook and plans short research',
  'daydream-memory': 'distils the day into lessons',
  'daydream-bank': 'pulls bank spend for the money questions',
  'daydream-improve': 'the nightly self-improvement run',
  'backlog-grooming': 'merges twins and tidies the backlog',
  'build-progress-check': 'tells me when a build has gone quiet',
  'forge-schedules': 'fires scheduled builds',
} satisfies Record<HeartbeatActivity, string>;

export const BUILD_COPY = {
  hub: {
    strap: 'It builds the ideas I say yes to',
    headline: ['It builds', 'its own', 'upgrades'],
    lede: 'Ideas from daydream, from my questions and from its own mistakes all land in one queue. The ones I accept are built in a private copy of the site, shown to me working, checked the way my own changes are, and only then released, through the same door every change on this site takes.',
  },
  develop: {
    line: { plain: 'An accepted idea becomes a delivery. It’s built in its own copy of the site, shown to me running, and only then released.', eng: 'A delivery is a brief, a worker session, a candidate revision with a preview and per-criterion verdicts, and a release policy.' },
    autopilot: { plain: 'Autopilot can carry a delivery through on its own, but it stops and asks after a set number of rounds, and it can never press merge.', eng: 'Unattended runs are capped in rounds and judged by an adversary model. Release still goes through a pull request and CI.' },
  },
  backlog: {
    line: { plain: 'Every idea, from wherever it came, lands in one queue. At night it works through that queue on a tight budget.', eng: 'One intake, one board of work stages, and a nightly heartbeat run bounded by budget caps and work caps.' },
  },
  verify: {
    line: { plain: 'A build has to prove itself the same way my own changes do, then again on GitHub.', eng: 'Repo builds walk a fixed verification chain, and every criterion is judged against the exact revision on screen.' },
    rails: { plain: 'Some files are off limits to it entirely. Changes there always wait for me, however small.', eng: 'Protected paths force the high risk tier, which is never auto-merged. Tool code it writes runs in an empty sandbox namespace, not the server.' },
  },
  codegraph: {
    line: { plain: 'Every build leaves notes about what broke and what fixed it, and the next build reads them first.', eng: 'A typed graph of files, gates, episodes and lessons, queried by fingerprint and file set, ranked by outcome evidence.' },
    ranking: { plain: 'A lesson that keeps helping rises. One that keeps not helping sinks. Whether it helped is judged by what the build did next, not by a model’s opinion.', eng: 'Serves are resolved mechanically from whether the triggering fingerprint recurred. Rank blends outcome evidence, a verdict weight and staleness of cited paths.' },
  },
} as const;
