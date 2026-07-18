// src/lib/selfimprove/types.ts
//
// Shared constants + types for the nightly self-improvement engine. The engine
// dogfoods the datastore for ALL of its state (no dedicated tables) — the three
// system collections below hold the API catalogue, the learned question
// insights, and one record per nightly run.

import type { PermissionSet } from '$lib/datastore';

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
} as const;

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

export type PhaseName = 'gather' | 'learn' | 'discover' | 'build' | 'report';
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
  | 'proposal';

export interface RunAction {
  kind: ActionKind;
  detail: string;
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
};

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
    report: { status: 'skipped' },
  };
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
