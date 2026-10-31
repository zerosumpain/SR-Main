// build.ts — the words for the Build pages. Words only: stage names, caps and counts come
// from the feature through `facts.server.ts`, and the live counts through `live.server.ts`.
//
// Every map is keyed by the feature's own type with `satisfies`, so a stage, phase, policy
// or lane added to the builder fails svelte-check here until it has a sentence.

import type { DeliveryStage, ReleasePolicy, BriefLaneKind, CommissionSource } from '$lib/constants/development';
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
  chat: 'a build I commissioned in chat',
  phone: 'a build I commissioned on my phone',
  'capability-gap': 'something I asked jkai for that is not built yet',
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
  'daydream-stale-sweep',
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
  'daydream-stale-sweep': 'files notes left past their date after a grace period',
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

/** The redesigned pages' extra words. Same rules: no figures, a twin for every line. */
export const BACKLOG_COPY = {
  rivers: { plain: 'one of the ways an idea can reach the queue. However it arrives, it waits in the same line as everything else.', eng: 'an intake channel. Every channel files into the one board, deduplicated by key, so provenance is kept but there is no side door.' },
  board: { plain: 'Every idea sits in one of these columns, and each column asks one question. Nothing can be dragged into live by hand, because a board that let me claim something shipped would be a board that lies.', eng: 'Work stages are derived, not asserted. Drags into building, verifying or live are refused, and nothing leaves live or verifying, so a shipped row can never be re-queued.' },
  night: { plain: 'While the house is asleep it works through the night in a fixed order, on a strict allowance.', eng: 'One heartbeat run walks the phases in order under hard budget and work caps.' },
  heartbeat: { plain: 'The little jobs behind daydream and the builder, each on its own clock. The bright part of a ring is when it may run.', eng: 'Heartbeat registry entries for the daydream and builder activities, with default cadence and active-hours window.' },
} as const;

export const DEVELOP_COPY = {
  line: { plain: 'Press play and watch one idea travel the whole line. The stations in blue are where it waits for me.', eng: 'Every delivery stage the builder stores, in order. The petrol stations are the ones that block on the owner.' },
  track: { plain: 'Every delivery is told how far it may go before it starts. Even the furthest setting never presses merge itself.', eng: 'The release policy bounds the furthest state a delivery can reach. Merge is always CI’s decision, gated by the risk tier.' },
  lanes: { plain: 'Before anything is built, a brief is sorted into one of these, because only one of them touches this site’s own code.', eng: 'Brief lane classification runs at grooming time and decides which repository and sandbox a delivery gets.' },
  rounds: { plain: 'Each square is one round of work it may do alone. The bright ones are what it gets by default; it can be allowed more, but never past the last square.', eng: 'Autopilot rounds, default against the hard maximum. An adversary model judges each unattended round.' },
} as const;

export const VERIFY_EXTRA = {
  chain: { plain: 'Pick a link and snap it. Everything after a broken link never happens, so nothing reaches the live site on a failed check.', eng: 'Phases run strictly in order and a failure is terminal for the candidate, so later phases never run on a red one.' },
  snapped: { plain: 'Snapped. Nothing after this point runs, and the live site stays exactly as it was.', eng: 'Failure recorded against the candidate. Downstream phases are skipped and production is untouched.' },
  whole: { plain: 'The chain is whole, so the change reaches the live site, and the site confirms it is really serving it.', eng: 'All phases green, and the deploy phase confirms production reports the merge commit.' },
  gates: { plain: 'When a check fails, the failure is filed under the check’s name, so the next build can look up what went wrong last time.', eng: 'Gate names are the fingerprint namespace for codegraph episodes, which is how a failure is matched to earlier fixes.' },
  reviewer: { plain: 'Every promise in a brief is judged against the exact version I was shown. A second model gives its own verdict beside mine, and it’s recorded whether that reviewer was a different model from the one that wrote the code.', eng: 'Criteria carry a verdict per revision. An adversary assessment records whether its model differs from the author’s, so a build marking its own homework is visible rather than assumed.' },
} as const;

export const CODEGRAPH_EXTRA = {
  graph: { plain: 'A sketch of the build’s memory. Drag anything about. Pick a kind of link to see what it joins.', eng: 'A schematic of the typed graph. Node kinds are illustrative; the edge kinds are the live list from the codegraph module.' },
  nodes: {
    file: 'a file in the site’s code',
    test: 'a test that checks something',
    gate: 'a check a change must pass',
    episode: 'one past build, and what happened',
    lesson: 'what was learned from it',
  },
  budget: { plain: 'A build can ask its memory questions, but every answer is cut to size so one question can’t crowd out the work.', eng: 'Results are character-budgeted per query, with a hard ceiling, and hop and result limits bound traversal.' },
} as const;

export const BUILD_HUB_COPY = {
  live: { plain: 'Everything I have asked it to build, and where each has got to. Totals only.', eng: 'Commissioned deliveries grouped by the development lane the develop page uses. Counts only.' },
} as const;

/**
 * Where a commissioned build can be asked for. Keyed by the commission's own source type, so
 * a new way in fails svelte-check here until it has a sentence.
 */
export const COMMISSION_SOURCE_COPY = {
  chat: { label: 'Chat', plain: 'I ask for it while talking to jkai in a browser, and confirm a card before anything starts.', eng: 'The develop_commission tool. Confirmed every time, open only to the attended owner in a browser session, and stops at a preview or a draft pull request.' },
  phone: { label: 'The phone', plain: 'Kept for the app, but switched off until the site can prove it’s really me holding the phone.', eng: 'Reserved. Refused until the server has proof of presence from the device, so a paired phone alone is never enough.' },
  web: { label: 'The form', plain: 'The new feature form on the develop page. It’s the only way in that may send a build all the way to the live site.', eng: 'The owner’s New feature form at /jkai/develop, and the only source allowed the production release policy.' },
  daydream: { label: 'Daydream', plain: 'A background thought can suggest a build, but it can never start one by itself.', eng: 'Refused as unattended. A service principal is never the attended owner, whatever it asks for.' },
  selfimprove: { label: 'The night shift', plain: 'The nightly run starts one change I’ve already agreed to. It has its own nightly limit instead of the chat ones.', eng: 'The propose phase. It skips the chat quota and live-build guards and is bounded by the night’s work cap instead.' },
} satisfies Record<CommissionSource, Twin & { label: string }>;

/** Asking for a build in conversation. Same rules: no figures, a twin for every line. */
export const CHAT_BUILD_COPY = {
  line: { plain: 'I can ask for a change in conversation. It becomes an ordinary delivery on the same line, with the same checks, and it tells me how it’s getting on in that conversation.', eng: 'Chat commissions create an ordinary development delivery with the commission stamped on its state, and a watcher posts its stage back to the thread.' },
  card: { plain: 'Before it starts, it shows me a card: where the build will stop, the most it may spend, how full my ChatGPT allowance is right now, and how many of my builds are already running. Nothing starts until I confirm.', eng: 'develop_quote builds the card from live facts and a digest of the whole brief, not its first line. develop_commission is confirm-always and is refused when the quote would be.' },
  refuse: { plain: 'It refuses when it can’t be sure I’m there: not from WhatsApp, a background job or the phone. From chat a build stops at a preview or a draft pull request. Only the form may send one to the live site, and for now it only builds this site.', eng: 'Refused unless the sealed principal is the owner, attended, in a browser session. Production policy is web-form only, and the only target is SR-Main.' },
  guards: { plain: 'It won’t start a build when my allowance is nearly used up, or when too many of my builds are already running.', eng: 'Quota ceilings on the ChatGPT five-hour and weekly windows, and a live-commission cap counted under an advisory lock so two tabs or two processes can’t both squeeze in.' },
  same: { plain: 'Asking twice for the same thing in the same conversation gets me the build already working on it, not a second one.', eng: 'Idempotent on an operation key derived from the thread and the outcome. An ask that matches a backlog item already in development returns that delivery.' },
  back: { plain: 'It reports back in the conversation as the build moves on. It only buzzes my phone a few times a day, unless the build needs me or has shipped.', eng: 'A delivery watcher posts a line on each stage change and retires at a terminal stage. Phone pushes are coalesced per build and capped per day, except needs-you and shipped.' },
  gaps: { plain: 'When I ask jkai for something it can’t do yet, it doesn’t pretend. It files the ask on the backlog in my words, so it can be built later.', eng: 'A capability gap is queued from the chat call and drained into the backlog out of band, so grooming never runs inside the turn. Kept as quoted data, never as a brief.' },
  tap: { plain: 'Some ideas always wait for me to say yes, even when it’s allowed to build on its own: anything it couldn’t do when I asked, and any ask from chat or the phone I didn’t actually commission.', eng: 'Autobuild never dispatches these sources, or any item that cites a capability gap, however the appetite setting is configured.' },
} as const;

/**
 * The backlog channels autobuild never dispatches, as the waiting list reads them. The source
 * list is a plain string array in propose.ts, so the drift test checks these keys against it.
 */
export const NEVER_AUTOBUILD_COPY: Record<string, string> = {
  'capability-gap': 'something I asked for that it couldn’t do yet',
  chat: 'an idea from chat that I didn’t actually commission',
  phone: 'an idea from the phone that I didn’t actually commission',
};
