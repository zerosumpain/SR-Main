// src/lib/selfimprove/types.ts
//
// Shared constants + types for the nightly self-improvement engine. The engine
// dogfoods the datastore for ALL of its state (no dedicated tables) — the three
// system collections below hold the API catalogue, the learned question
// insights, and one record per nightly run.

import type { PermissionSet } from '$lib/datastore';
import { TOOL_POLICY_COLLECTION, TOOL_POLICY_PERMISSIONS } from '$lib/toolpolicy/policy';

/** Actor every self-improvement datastore write runs as. */
export const SYSTEM_ACTOR = 'system';

/** System collection slugs (pinned in the plan — do not rename). */
export const COLLECTIONS = {
  apiCatalog: 'api_catalog',
  questionInsights: 'question_insights',
  improvementRuns: 'improvement_runs',
  // Full forensic record of every tool BUILD attempt — created AND rejected —
  // including the generated handler code and the failure reason. `custom_tools`
  // only keeps surviving tools; this keeps the ones the engine tried and dropped.
  toolAttempts: 'tool_attempts',
  // Durable idea queue. Before this existed every "proposal" was a dead string on
  // a run record, so each night re-invented the same ideas (the 19–29 Jul runs
  // re-proposed "news digest" and "current time" repeatedly) and never learned
  // from a previous night's failure. Ideas now persist with attempt counts and
  // last-error, so the engine resumes work instead of restarting it.
  backlog: 'improvement_backlog',
  // Themes found in the backlog: which queued ideas are restatements of one
  // another. Written by the clusterer, ruled on by the owner. A DECLINED
  // grouping is kept, never deleted — the same rule `daydream_capabilities`
  // follows, and for the same reason: a proposal that can re-propose its own
  // refusals is a proposal with no memory.
  epics: 'improvement_epics',
  // Versioned overlay controlling how tools are DESCRIBED and which are
  // directly visible — the engine's lever on call efficiency. Owned by
  // $lib/toolpolicy/policy.ts, which is also read by the MCP server, so the
  // slug is re-exported from there rather than duplicated.
  toolPolicy: TOOL_POLICY_COLLECTION,
} as const;

/**
 * Model for every self-improvement gateway call (owner's standing choice,
 * 2026-07-29). Pinned rather than using `resolveDefaultModel()` so a change to
 * the chat default cannot silently alter code-authoring quality overnight.
 *
 * This is now the FALLBACK, not the pin: `jkai.selfimprove.model` overrides it
 * and is settable from the model picker (the `selfimprove` entry in
 * `$lib/models/workloads`). Re-exported from the shared constants rather than
 * re-typed, so the picker and the engine cannot disagree about what "unset"
 * means.
 */
export { DEFAULT_SELFIMPROVE_MODEL_ID as SELFIMPROVE_MODEL } from '$lib/constants/default-models';

/** app_settings kill-switch key. Default (unset/null) is treated as enabled. */
export const SETTINGS_ENABLED_KEY = 'selfimprove.enabled';

/**
 * Whether the engine may spend on a lane WITHOUT a tap, and DELIBERATELY
 * INVERTED: unset/null is disabled, only an explicit `true` permits it.
 *
 * Same semantics and the same reason as `workflowdoctor.autoapply` — an
 * unattended path that spends money or writes to a live schedule must never
 * enable itself by default. With this off the engine still finds capabilities,
 * queues them, registers data sources and ships runtime tools (both of which
 * already have live verification gates and cost pennies); what it will not do
 * is dispatch a repo build or create a watch until the owner has accepted the
 * lead on the Improvement room.
 *
 * With it on, `WORK_CAPS.maxChangeRequests` and `maxWatches` are the ceiling:
 * one of each a night.
 */
export const SETTINGS_AUTOBUILD_KEY = 'daydream.appetite.autobuild';

// The nightly cron used to live here (`30 3 * * *`, Europe/London). The
// schedule is now a heartbeat activity — see
// `$lib/heartbeat/activities/daydream-improve.ts` for the window and
// `./schedule.ts` for the accessor the dashboards read. The constants are gone
// rather than kept as documentation: two of them were being printed on two
// pages as the live schedule, which is exactly how a dashboard starts lying.

/** Skip a nightly run if the user chatted within this window (idle gate). */
export const IDLE_WINDOW_MS = 60 * 60 * 1000; // 60 min

/**
 * Hard budget caps for one run — the SAFETY ceiling, not the workload dial.
 *
 * Measured over the 10 nights to 2026-08-16, a run used **6-10 of 40 calls**,
 * **$0.01 of $0.50** and **4-8 minutes of 25** (worst 16.5). The budget was
 * never what limited output; WORK_CAPS below was. Raising these would have
 * changed nothing at all.
 *
 * **`maxWallMs` cannot go up.** The night is scheduled back to back —
 * selfimprove, **04:00 model-routing**, 04:15 intel (see
 * `$lib/workflowdoctor/types.ts`). The heartbeat window opens at 02:30 and
 * closes at 03:55, so 25 minutes from the latest possible start still lands
 * before 04:00: it is a slot boundary, not a guess. The engine also waits on a
 * 60-minute idle window, so a run can start late and eat into that margin
 * without anyone changing a cap.
 *
 * Wall clock is therefore the real constraint on how much work fits in a
 * night, and WORK_CAPS below are sized against it rather than against the call
 * count. Calls and cost keep a wide margin deliberately: they exist to stop a
 * runaway, and a ceiling that sits just above the expected load stops nothing.
 */
export const BUDGET_CAPS = {
  maxLlmCalls: 40,
  maxCostUsd: 0.5,
  maxWallMs: 25 * 60 * 1000, // 25 min from 03:30 ends at 03:55, before 04:00
} as const;

/**
 * Work caps for the build/repair loops — the actual workload dial.
 *
 * Raised 2026-08-16 because the backlog fills far faster than it drains: 179
 * ideas added against 31 built over 27 nights, leaving 148 open items at ~0.1
 * attempts each. More attempts per night is the half of that gap this file can
 * close; whether `discover` should also produce fewer is a separate question
 * and deliberately not answered here.
 *
 * **Sized against wall clock, not the call count.** Observed cost is ~1.6
 * minutes per LLM call (16.5 min for 10 on the heaviest night), and the run
 * has 25 minutes before it runs into the 04:00 model-routing slot — so roughly
 * 15 calls fit, not 40. These caps put a worst-case night at
 * learn 2 + discover 3 + build 4 + repair 3 + propose 2 + optimise 2 ≈ 16,
 * which is deliberately close to that ceiling rather than under it: every
 * phase checks `timeLeftMs()` and skips rather than overrunning, so the
 * failure mode is a skipped late phase, not a collision with the next job.
 *
 * Before these loops existed a run spent 2 calls of 40 and shipped nothing —
 * the caps exist to USE the budget, not to ration it.
 */
export const WORK_CAPS = {
  /** Distinct tool ideas attempted per night. */
  maxToolCandidates: 4,
  /** Repair rounds per candidate — the smoke-test error is fed back each time. */
  maxRepairRounds: 2,
  /** Existing broken tools re-authored per night. */
  maxToolsRepaired: 3,
  /** Draft PRs opened per night (never merged). */
  maxPullRequests: 2,
  /**
   * Change requests handed to the autonomous builder per night.
   *
   * ONE. A change-request build runs up to 25 iterations against a £2 ceiling
   * — roughly ten times what a whole self-improvement night costs — and it
   * opens a PR a human then has to read. Two a night is a backlog of reviews
   * by the weekend. Owner decision, 2026-09-04.
   */
  maxChangeRequests: 1,
  /** Monitors generated per night. One workflow generation, and a watch that
   *  fires is a watch that can notify. */
  maxWatches: 1,
  /** A tool must beat this error rate to be considered healthy. */
  repairErrorRateThreshold: 0.25,
  /** Minimum runs before an error rate is meaningful. */
  repairMinRuns: 5,
  /**
   * Days a tool sits out after a repair attempt is rejected.
   *
   * Without it the phase grinds: `pickRepairTargets` sorts by error COUNT, a
   * rejected repair leaves the tool unchanged, so it is still the worst tool
   * tomorrow and gets picked again. Measured 2026-08-16 — the same two tools
   * (`reverse_geocode`, `reverse_geocode_osm`) were re-authored every night for
   * eight consecutive nights, 31 lifetime attempts for 1 ship, while
   * `nearby_places` sat third on the list and was never once reached.
   *
   * A cooldown rather than an exclusion: the tool may become repairable later,
   * once the upstream settles or better smoke cases exist.
   */
  repairCooldownDays: 7,
  /** Leave this much wall-clock headroom for the report phase. */
  reserveWallMs: 60 * 1000,
} as const;

/**
 * New theme groupings proposed in one night.
 *
 * Six, not all of them. The first scan of production's queue found 113
 * groupings at once, and a room asking the owner to rule on 113 things is a
 * room he closes. Six a night drains that in under three weeks while leaving
 * the on-demand button in the room for anyone who wants the lot; the scan is
 * free either way, so this caps the ASKING, not the finding.
 */
export const MAX_THEME_PROPOSALS = 6;

export type PhaseName =
  | 'gather'
  | 'learn'
  | 'discover'
  | 'build'
  | 'repair'
  // Prime outcome: fewer tool calls per answered question. Runs before propose
  // so the cheapest, highest-leverage work is never the phase that gets
  // squeezed out by the budget.
  | 'optimise'
  | 'propose'
  | 'report';
export type PhaseStatus = 'ok' | 'failed' | 'skipped';

export type RunStatus =
  | 'running'
  | 'complete'
  | 'partial'
  | 'budget_exceeded'
  | 'aborted_user_active'
  | 'failed';

export interface PhaseRecord {
  status: PhaseStatus;
  detail?: string;
  ms?: number;
}

export type ActionKind =
  | 'insight'
  | 'api_registered'
  | 'api_verified'
  | 'tool_created'
  | 'tool_rejected'
  | 'proposal'
  /** Built, verified AND enabled — live in the registry without a restart. */
  | 'tool_shipped'
  /** An existing tool's handler was replaced by one that beat it on smoke tests. */
  | 'tool_repaired'
  /** An idea was queued for a future night. */
  | 'backlog_added'
  /** A draft PR was opened for review (never merged by the engine). */
  | 'pr_opened'
  /**
   * A change request was handed to the autonomous builder: an issue opened, a
   * branch cut from master, `npm run gate` per iteration, and a PR at the end.
   * Distinct from `pr_opened` because the engine did not write the code — it
   * wrote the ask, which is the difference between a patch nothing has run and
   * one a gate has.
   */
  | 'change_requested'
  /** A recurring monitor was generated and scheduled. */
  | 'watch_created'
  /**
   * The queue was scanned for themes and new groupings were proposed.
   *
   * Its OWN kind, not `proposal`. A proposal is an idea for new work; this is
   * an observation about work already queued, and folding it into the same
   * counter would inflate a number two dashboards print. The doctor's
   * escalation kind exists for exactly this reason and a test caught it.
   */
  | 'themes_found'
  /** Calls-per-turn was measured and snapshotted. */
  | 'efficiency_measured'
  /** A new tool-call policy version went live on trial. */
  | 'policy_published'
  /** A trialled policy beat its baseline and was kept. */
  | 'policy_kept'
  /** A trialled policy failed to beat its baseline and was rolled back. */
  | 'policy_reverted'
  /**
   * A trial could not be judged because its measurement source had stopped
   * receiving data before the trial began. Recorded rather than skipped
   * silently: "nothing happened tonight" and "the evidence was too old to use"
   * look identical in the ledger otherwise, and the second one needs fixing.
   */
  | 'measurement_stale';

/**
 * The plain-English record of one improvement, captured WHERE THE FACTS ARE
 * KNOWN rather than reconstructed later.
 *
 * `detail` is a single prose string built for the WhatsApp summary, and the
 * numbers that matter — the error rate that triggered a repair, the repeat-call
 * count behind an overlay, how often a tool had been called at the moment it
 * shipped — survive in it only as text. Re-parsing that on the read side works
 * until someone rewords a template, and then it fails silently.
 *
 * Every field here is optional and additive: runs recorded before this existed
 * still render, via the inference path in `narrative.ts`, which labels what it
 * could not establish.
 */
export interface ActionStory {
  /** The tool / API / policy target this action is about. */
  subject?: string;
  /** Why it happened, in plain English. */
  driver?: string;
  /** The measurement behind the driver ("80% of 5 calls errored"). */
  driverEvidence?: string;
  /** Verbatim user questions that motivated it. Owner-only surfaces. */
  driverQuotes?: string[];
  /** Backlog slug this addresses — the link that makes the driver `recorded`. */
  driverRef?: string;
  /** What was chosen and done. */
  solution?: string;
  /** What came of it, as known at the time. */
  outcome?: string;
  /** Distinguishes a build from a re-author of an existing tool. */
  mode?: 'create' | 'repair';
  /**
   * The tool's lifetime call count at the moment of this action. `custom_tools`
   * counters are cumulative and never reset, so this snapshot is the only way to
   * later say "called 12 times SINCE it shipped" rather than "12 times ever".
   */
  runCountAtAction?: number;
}

export interface RunAction {
  kind: ActionKind;
  detail: string;
  /** Structured narrative for the plain-English ledger. Optional by design. */
  story?: ActionStory;
}

/** Shape of an `improvement_runs` record's `data`. */
export interface ImprovementRunData {
  status: RunStatus;
  trigger: 'cron' | 'manual';
  startedAt: string;
  finishedAt?: string;
  phases: Record<PhaseName, PhaseRecord>;
  llmCalls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  actions: RunAction[];
  report: string;
}

/** One intent bucket learned from user questions. */
export interface QuestionIntent {
  intent: string;
  count: number;
  examples?: string[];
  servedWell?: boolean;
  missingCapability?: string;
}

/**
 * A way for the platform to become more useful, not merely another tool name.
 *
 * The old learner emitted only `missingCapability` strings, so every gap flowed
 * into the toolsmith even when the valuable thing was a new dataset, a durable
 * service integration, or site functionality. These fields keep the value,
 * consumer and likely delivery shape together all the way into the backlog.
 */
export interface CapabilityOpportunity {
  title: string;
  need: string;
  kind: 'tool' | 'data_source' | 'online_service' | 'site_feature';
  consumer: 'jkai' | 'daydream' | 'site' | 'shared';
  value: string;
  integrationHint?: string;
}

/** Shape of a `question_insights` record's `data`. */
export interface QuestionInsights {
  period: string;
  generatedAt: string;
  intents: QuestionIntent[];
  topUnmet: string[];
  /** Proactive portfolio gaps, including sources/services/site features. */
  opportunities?: CapabilityOpportunity[];
  summary?: string;
}

/** A rerun of a deployed tool from the Self Improvement room. */
export interface LiveToolTest {
  testedAt: string;
  args: Record<string, unknown>;
  success: boolean;
  ms: number;
  error?: string;
  /** Short owner-only preview; full results are returned to the browser only. */
  resultSummary?: string;
}

/** Shape of a `tool_attempts` record's `data` — one per BUILD attempt. */
export interface ToolAttemptData {
  runId: string;
  name: string;
  description: string;
  toolset: string;
  status: 'created' | 'rejected';
  /** Why it was rejected (only set when status === 'rejected'). */
  reason?: string;
  /** The full generated handler body — the "what it tried to build". */
  handlerCode: string;
  /** The parameter schema the model proposed. */
  parameters: Record<string, unknown>;
  /** The sample args used for the smoke test. */
  sampleArgs: Record<string, unknown>;
  attemptedAt: string;
  /** 'create' = new tool, 'repair' = re-author of an existing tool. */
  mode?: 'create' | 'repair';
  /** Which repair round produced this code (0 = first attempt). */
  round?: number;
  /** True when the tool was enabled + registered live, not just persisted. */
  shipped?: boolean;
  /** Per-case smoke results, so a failure is diagnosable from the ledger. */
  cases?: Array<{ args: Record<string, unknown>; ok: boolean; error?: string; ms?: number }>;
  /** Natural request for proving discoverability through a fresh JKAI chat. */
  jkaiTestPrompt?: string;
  /** Durable owner-run acceptance tests against the currently deployed handler. */
  liveTests?: LiveToolTest[];
  /** For repairs: the handler that was replaced, kept for rollback. */
  previousHandlerCode?: string;
}

/** Lifecycle of a queued idea. */
export type BacklogStatus = 'open' | 'shipped' | 'abandoned';

/** How much implementation work a groomed item is expected to contain. */
export type BacklogEffort = 'small' | 'medium' | 'large';

/** Delivery risk recorded by the grooming pass. */
export type BacklogRisk = 'low' | 'medium' | 'high';

/** Whether the brief can be handed to an automated builder without guessing. */
export type BacklogReadinessStatus = 'draft' | 'needs_input' | 'ready';

export type BacklogRelationKind = 'duplicate' | 'related' | 'blocks' | 'blocked_by';

/** A relationship may only point at another durable backlog slug. */
export interface BacklogRelation {
  slug: string;
  title: string;
  kind: BacklogItemData['kind'];
  relation: BacklogRelationKind;
  reason: string;
}

/** One turn of the grooming conversation, as stored. */
export interface BacklogGroomingTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The structured contract between backlog grooming and every build lane.
 *
 * The accepted brief, its remaining uncertainty and its model provenance are
 * the audit trail a build lane reads; `conversation` is kept alongside it but
 * is never fed to a builder, for the reason this comment used to give for
 * dropping it entirely — a lane must not reconstruct decisions out of chat.
 *
 * It is persisted because the alternative was worse: the editor held the
 * thread in component state, so closing the panel threw away every question
 * the model had asked and every answer given to it, and grooming one item
 * across two sittings was impossible. Bounded at
 * `MAX_GROOMING_CONVERSATION` (in `./grooming`, which is the PURE module a
 * `.svelte` may value-import — see `IDEA_SOURCES` in `./board` for why a
 * constant may not live in this file) so a long argument cannot grow a
 * datastore record without limit.
 */
export interface BacklogGroomingData {
  problem: string;
  outcome: string;
  acceptanceCriteria: string[];
  constraints: string[];
  nonGoals: string[];
  dependencies: string[];
  implementationNotes: string[];
  validation: string[];
  assumptions: string[];
  openQuestions: string[];
  decisions: string[];
  relatedItems: BacklogRelation[];
  effort: BacklogEffort;
  risk: BacklogRisk;
  readiness: {
    score: number;
    status: BacklogReadinessStatus;
    reason: string;
  };
  assistantSummary: string;
  /** The resolved model actually called, not merely the configured setting. */
  modelId: string;
  groomedAt: string;
  /** Set when a person saves the model draft into the backlog record. */
  acceptedAt?: string;
  revision: number;
  /** The thread that produced this brief. Display and continuation only. */
  conversation?: BacklogGroomingTurn[];
}

/**
 * A note the owner (or the model, at the owner's request) left on one item.
 *
 * The engine writes receipts — attempts, errors, PR links — and a person
 * could add nothing to a queue row at all. This is the one field on a backlog
 * record that is neither a measurement nor a model output: it is what somebody
 * said about the work.
 *
 * `author` is stamped by the route, never read out of the request body, for
 * the same reason `source` is: a caller must not be able to sign a note as
 * something it is not.
 */
export interface BacklogNote {
  /** Unique within the item. Used to delete one without matching on text. */
  id: string;
  at: string;
  author: 'owner' | 'model';
  text: string;
}



/**
 * Which channel an idea arrived through — the closed set lives in `./board`,
 * which is the PURE module a `.svelte` file may value-import. Type-only here,
 * so this direction is erased and no cycle exists at runtime.
 *
 * TWO lines, and they are not redundant: `export … from` re-exports without
 * binding the name locally, so `BacklogItemData.source` below could not see
 * it. Same trap as the `NEWS_SOURCES` move on 2026-09-04.
 */
import type { IdeaSource } from './board';
export type { IdeaSource } from './board';

/** Shape of an `improvement_backlog` record's `data`. */
export interface BacklogItemData {
  /** Retained requirements from consolidated stories, appended to every build brief. */
  mergedBrief?: string;
  /** Stable slug key, derived from the title. */
  slug: string;
  title: string;
  detail: string;
  /** 'tool'    = buildable as a runtime custom tool;
   *  'feature' = needs repo code — a change request to the autonomous builder;
   *  'source'  = a data source to find, register and then sample daily;
   *  'watch'   = a recurring monitor, i.e. a scheduled workflow;
   *  'engine'  = a proposal about the daydream engine itself — never picked by
   *              a lane, never a PR, visible on the ledger for the owner.
   *
   *  `source` and `watch` arrived with the appetite ledger (2026-09-04). They
   *  are separate kinds rather than `feature` with a note because the lane is
   *  what decides the cost: a source is a catalogue registration with a live
   *  probe, a watch is one workflow generation, and a feature is a repo build
   *  that can spend £2. */
  kind: 'tool' | 'feature' | 'engine' | 'source' | 'watch';
  status: BacklogStatus;
  /** 1 (highest) … 5. Drives pick order. */
  priority: number;
  attempts: number;
  /** Why the most recent attempt failed — fed back into the next author call. */
  lastError?: string;
  lastAttemptRunId?: string;
  createdAt: string;
  updatedAt: string;
  /** Set when kind='feature' and a draft PR was opened. */
  prUrl?: string;
  /** The `daydream_capabilities` row this came from, so the lane can report
   *  back what the idea became. Absent on fault- and question-mined ideas. */
  capabilitySlug?: string;
  /** Which channel it arrived through. Absent on rows written before the
   *  field existed, which read `unattributed` and are never guessed at. */
  source?: IdeaSource;

  /** Accepted, structured build brief. Additive JSON; no datastore migration. */
  grooming?: BacklogGroomingData;

  // ── Owner edits from the queue board (2026-09-04) ────────────────────────
  //
  // All three are additive fields on a datastore record, so nothing here needs
  // a migration. They exist because the queue reached 455 rows with 280 of the
  // 352 open ones tied on priority 2, and the room had no lever at all: the
  // engine could add to the pile and nothing could sort, merge or close it.

  /**
   * The slug this item was FOLDED INTO, when the owner judged it a restatement
   * of a sibling.
   *
   * Set together with `status: 'abandoned'`, never instead of it — `pickWork`
   * filters on status and must not learn a second way for an item to be out of
   * the running. Kept rather than deleted for the reason every other ledger
   * here keeps its refusals: `addIdeas` checks existence by key, so a surviving
   * row is what stops the same idea being written fresh at `attempts: 0`
   * tomorrow. Deleting the loser would resurrect it.
   */
  foldedInto?: string;
  /** How many siblings were folded INTO this one. Display only. */
  foldedCount?: number;
  /** Why it was parked, in the owner's words or the board's. Shown on the card
   *  so a parked item never reads as an unexplained disappearance. */
  parkedReason?: string;
  /**
   * Removed from the owner-facing backlog. The record remains as a tombstone
   * so the nightly proposer cannot silently recreate the same slug tomorrow.
   * A shipped row keeps its shipped status; an open row is abandoned as part
   * of removal, so no build lane can pick it while the board hides it.
   */
  removedAt?: string;
  removedBy?: 'owner';
  /**
   * Grouping key for the board's swimlanes.
   *
   * Owner-set in P2. The automatic clusterer is P3 and MUST reuse
   * `findRelatedIdea` in `narrative.ts` — that function is the one definition
   * of "related" here, and it already carries the three-shared-content-words
   * threshold that stopped "live" and "api" matching everything.
   */
  epicSlug?: string;

  // ── Grooming and burndown (2026-09-04, second pass) ──────────────────────

  /** What a person said about this item. Additive JSON; no migration. */
  notes?: BacklogNote[];

  /**
   * When this row actually settled — shipped, parked, folded or removed.
   *
   * `updatedAt` was the only date a settled row carried, and a priority edit
   * moves it, so an item parked in July and re-prioritised from the board
   * yesterday reads as "settled yesterday". `drained` on the inflow strip
   * already says out loud that this over-states the drain; a burndown drawn
   * off it does not over-state one number, it draws a wrong shape.
   *
   * Written on the transition by `setParked`, `foldItems`, `removeBacklogItem`
   * and `markAttempt`, and DELETED when an item comes back to `open` — a row
   * carrying both `status: 'open'` and a settled date is a contradiction the
   * reconstruction would have to guess its way out of.
   *
   * Absent on every row that settled before this field existed. Those fall
   * back to `updatedAt`, and the chart says how many it is drawing that way
   * rather than presenting the fallback as a record.
   */
  settledAt?: string;
}

/**
 * `proposed` — the clusterer found it, nobody has ruled.
 * `accepted` — the owner said yes; every member now carries its `epicSlug`.
 * `declined` — the owner said no. Kept, never deleted, and never re-proposed
 *              while the membership is unchanged.
 */
export type EpicStatus = 'proposed' | 'accepted' | 'declined';

/**
 * Shape of an `improvement_epics` record's `data`.
 *
 * **No sentence in here is written by anything.** `label` is the shortest
 * member title, verbatim; `keywords` are words the members actually share.
 * The rule `narrative.ts` set for this engine — a stored line always renders
 * as recorded, so filler prose would stamp full confidence on a guess.
 */
export interface EpicData {
  /** Queued consolidated brief; source records remain linked and retained. */
  mergedInto?: string;
  /** Derived from the sorted member slugs — see `clusterSlug`. */
  slug: string;
  label: string;
  keywords: string[];
  memberSlugs: string[];
  /** The open/shipped split AS RECORDED when the theme was found. The board
   *  trims its settled rows, so a card that counted only what the board is
   *  currently showing would under-report a theme's shipped members — which is
   *  the half that makes it worth ruling on. */
  openSlugs: string[];
  shippedSlugs: string[];
  /** How much it is worth ruling on, 0..1, with every input named. */
  score: number;
  components: Record<string, number>;
  /** Members an already-shipped sibling appears to cover, at proposal time. */
  servedCount: number;
  status: EpicStatus;
  /** owner | engine — who ruled, so the room can say. */
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The two builders self-improvement cannot reach for itself.
 *
 * Declared here and IMPLEMENTED in `$lib/heartbeat/build-lanes.ts`, which is
 * the only direction the module boundaries allow: `$lib/jkai` already imports
 * `$lib/selfimprove`, so importing `$lib/jkai/change-request` from this module
 * would open a `jkai <-> selfimprove` cycle, and importing `$lib/heartbeat`
 * would open a `heartbeat <-> selfimprove` one. Injection also means a test can
 * hand the run fakes and assert what it dispatched without a GitHub token.
 */
export interface LaneResult {
  /** Stable reference for the appetite ledger — `build:<id>` or
   *  `monitor:<workflowId>`. */
  ref: string;
  /** What to show the owner. */
  label: string;
}

export interface BuildLanes {
  /** Open an issue and start a gated repo build. Absent when GitHub is not
   *  configured; the propose phase then falls back to a draft PR. */
  changeRequest?: (input: { title: string; request: string }) => Promise<LaneResult>;
  /** Turn a description into a recurring, scheduled monitor. */
  createWatch?: (input: { description: string }) => Promise<LaneResult>;
}

/** Auth spec stored in an api_catalog record (env-var NAMES only, never secrets). */
export type ApiAuth =
  | { kind: 'none' }
  | { kind: 'bearer-env'; envVar: string }
  | { kind: 'header-env'; envVar: string; header: string };

/** A seed api_catalog entry (status/source stamped at seed time). */
export interface SeedApiEntry {
  name: string;
  baseUrl: string;
  docsUrl?: string;
  description: string;
  capabilities: string[];
  tags: string[];
  auth: ApiAuth;
  exampleRequests: Array<{ label?: string; method?: string; url: string; body?: unknown }>;
}

/** Default permission sets for the three system collections. */
export const SYSTEM_PERMISSIONS: Record<string, PermissionSet> = {
  // Anyone can read the catalogue; jkai + the engine grow it; owner/system prune.
  api_catalog: {
    read: ['*'],
    write: ['owner', 'jkai', 'system'],
    delete: ['owner', 'system'],
  },
  // Insights: readable by jkai (to answer better) + owner/system; written by the
  // engine (system) and owner only.
  question_insights: {
    read: ['owner', 'jkai', 'system'],
    write: ['owner', 'system'],
    delete: ['owner', 'system'],
  },
  // Run records: readable by the admin UI + jkai; written by the engine (system)
  // and owner.
  improvement_runs: {
    read: ['owner', 'jkai', 'system'],
    write: ['system', 'owner'],
    delete: ['owner', 'system'],
  },
  // Tool-build attempts (incl. rejected code): same as run records.
  tool_attempts: {
    read: ['owner', 'jkai', 'system'],
    write: ['system', 'owner'],
    delete: ['owner', 'system'],
  },
  // Idea queue: jkai can read it (so chat can answer "what are you working on"),
  // the engine and owner write it.
  improvement_backlog: {
    read: ['owner', 'jkai', 'system'],
    write: ['system', 'owner'],
    delete: ['owner', 'system'],
  },
  // Backlog themes. Same shape as the queue it groups.
  improvement_epics: {
    read: ['owner', 'jkai', 'system'],
    write: ['system', 'owner'],
    delete: ['owner', 'system'],
  },
  // Owned by $lib/toolpolicy — reused here so ensureSystemCollections seeds it
  // with exactly the permissions the MCP read path expects.
  [TOOL_POLICY_COLLECTION]: TOOL_POLICY_PERMISSIONS,
};

/**
 * Trial rule for a live policy change (owner decision, 2026-07-29).
 *
 * Only ~7 turns a day reach the assistant, so judging a change the next morning
 * would be judging noise — good changes would be reverted and bad ones kept at
 * roughly the rate of a coin flip. A trial therefore runs until it has seen
 * enough turns to mean something, with a day cap so a quiet fortnight can never
 * leave an unproven change live indefinitely.
 */
export const TRIAL = {
  /** Chat turns that must accumulate before a verdict is possible. */
  minTurns: 30,
  /** Hard age cap — decide on whatever evidence exists once this is reached. */
  maxDays: 14,
  /**
   * Relative drop in mean calls per chat turn required to KEEP a change.
   * A neutral result reverts: the overlay costs prompt tokens on every turn, so
   * "made no difference" is a reason to remove it, not to leave it.
   */
  minImprovement: 0.05,
  /** Measurement window for the metric itself. */
  windowDays: 30,
} as const;

/** Compact error message extractor. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cast a structured record shape to the datastore's generic `data` type. */
export function asData(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/** ISO week key `YYYY-WW` (Europe/London-agnostic; UTC-based, good enough). */
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

/** Fresh, all-skipped phase map. */
export function emptyPhases(): Record<PhaseName, PhaseRecord> {
  return {
    gather: { status: 'skipped' },
    learn: { status: 'skipped' },
    discover: { status: 'skipped' },
    build: { status: 'skipped' },
    repair: { status: 'skipped' },
    optimise: { status: 'skipped' },
    propose: { status: 'skipped' },
    report: { status: 'skipped' },
  };
}

/** Stable slug for a backlog idea — the dedupe key across nights. */
export function slugifyIdea(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Best-effort JSON extraction: strips ```fences and trailing prose. */
export function parseJsonLoose(text: string): unknown {
  if (!text) return null;
  const trimmed = text.trim();
  // Prefer a fenced block if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  // Slice from the first { or [ to its matching last } or ].
  const firstObj = candidate.indexOf('{');
  const firstArr = candidate.indexOf('[');
  let start = -1;
  let endChar = '}';
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    start = firstArr;
    endChar = ']';
  } else if (firstObj !== -1) {
    start = firstObj;
    endChar = '}';
  }
  const slice = start === -1 ? candidate : candidate.slice(start, candidate.lastIndexOf(endChar) + 1);
  try {
    return JSON.parse(slice);
  } catch {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}
