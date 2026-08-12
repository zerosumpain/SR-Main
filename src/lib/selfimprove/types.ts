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

/** Owner WhatsApp number for the nightly summary (CLAUDE.md). */
export const OWNER_PHONE = '+447359228511';

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

/** Nightly cron: 03:30 Europe/London. */
export const CRON_EXPR = '30 3 * * *';
export const CRON_TZ = 'Europe/London';

/** Skip a nightly run if the user chatted within this window (idle gate). */
export const IDLE_WINDOW_MS = 60 * 60 * 1000; // 60 min

/** Hard budget caps for one run. */
export const BUDGET_CAPS = {
  maxLlmCalls: 40,
  maxCostUsd: 0.5,
  maxWallMs: 25 * 60 * 1000, // 25 minutes wall clock
} as const;

/**
 * Work caps for the build/repair loops. Sized so a worst-case night stays inside
 * BUDGET_CAPS: learn 1(+1) + discover 3 + build 3×3 + repair 2×2 + propose 2 ≈ 20
 * of the 40 available calls. Before these loops existed a run spent 2 calls of
 * 40 and shipped nothing — the caps exist to USE the budget, not to ration it.
 */
export const WORK_CAPS = {
  /** Distinct tool ideas attempted per night. */
  maxToolCandidates: 3,
  /** Repair rounds per candidate — the smoke-test error is fed back each time. */
  maxRepairRounds: 2,
  /** Existing broken tools re-authored per night. */
  maxToolsRepaired: 2,
  /** Draft PRs opened per night (never merged). */
  maxPullRequests: 1,
  /** A tool must beat this error rate to be considered healthy. */
  repairErrorRateThreshold: 0.25,
  /** Minimum runs before an error rate is meaningful. */
  repairMinRuns: 5,
  /** Leave this much wall-clock headroom for the report phase. */
  reserveWallMs: 60 * 1000,
} as const;

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
  /** Calls-per-turn was measured and snapshotted. */
  | 'efficiency_measured'
  /** A new tool-call policy version went live on trial. */
  | 'policy_published'
  /** A trialled policy beat its baseline and was kept. */
  | 'policy_kept'
  /** A trialled policy failed to beat its baseline and was rolled back. */
  | 'policy_reverted';

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

/** Shape of a `question_insights` record's `data`. */
export interface QuestionInsights {
  period: string;
  generatedAt: string;
  intents: QuestionIntent[];
  topUnmet: string[];
  summary?: string;
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
  /** For repairs: the handler that was replaced, kept for rollback. */
  previousHandlerCode?: string;
}

/** Lifecycle of a queued idea. */
export type BacklogStatus = 'open' | 'shipped' | 'abandoned';

/** Shape of an `improvement_backlog` record's `data`. */
export interface BacklogItemData {
  /** Stable slug key, derived from the title. */
  slug: string;
  title: string;
  detail: string;
  /** 'tool' = buildable as a runtime custom tool; 'feature' = needs repo code. */
  kind: 'tool' | 'feature';
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
