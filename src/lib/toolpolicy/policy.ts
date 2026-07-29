// src/lib/toolpolicy/policy.ts
//
// The tool-call policy overlay — how the self-improvement engine changes the
// way tools are CALLED without changing any code.
//
// The engine could always build new tools. It could never change how the ones
// that exist get used, which is where the waste actually is: on a 30-day sample
// (2026-07-29) 74% of every tool call made was a REPEAT of a tool already called
// in the same turn — one turn called `fetch_url` 119 times. No new tool fixes
// that; a sharper description ("accepts an array — never loop") does.
//
// Three properties make this safe enough to ship unattended:
//
//   1. It is DATA, not code. An overlay lives in the datastore, never in the
//      repo, so applying one needs no deploy and reverting one needs no revert.
//   2. It is ADDITIVE and NARROW. An overlay may only rewrite a tool's
//      description text, append guidance, or make an already-registered tool
//      directly visible. It can never change a tool's name, its input schema,
//      its handler, or remove a capability — so the worst case is a worse hint,
//      never a broken or missing call.
//   3. It is VERSIONED. Every change is a new immutable `v:<n>` record with a
//      `parentVersion`; `active` is a pointer. Rollback is a pointer move to a
//      record that is still on disk, which is why the trial machinery in
//      $lib/selfimprove/efficiency.ts can revert itself with no human present.

import {
  DatastoreError,
  ensureCollection,
  getCollectionBySlug,
  getRecordByKey,
  queryRecords,
  upsertRecord,
} from '$lib/datastore';
import type { PermissionSet } from '$lib/datastore';

/** Collection slug. Pinned — the engine and the ledger both read it by name. */
export const TOOL_POLICY_COLLECTION = 'tool_call_policy';

/** Actor for engine-side writes (matches $lib/selfimprove). */
const SYSTEM_ACTOR = 'system';

/** Key of the single pointer record naming the live version. */
const ACTIVE_KEY = 'active';

export const TOOL_POLICY_PERMISSIONS: PermissionSet = {
  // jkai may read it (so chat can answer "why do you call it that way"); only
  // the engine and the owner may write, and only the owner may delete.
  read: ['owner', 'jkai', 'system'],
  write: ['system', 'owner'],
  delete: ['owner'],
};

/** How long a resolved policy is reused before re-reading the datastore.
 *  `tools/list` runs on every Hermes turn, so this must not be a DB hit each
 *  time; 60s is short enough that a revert takes effect within a turn or two,
 *  and `invalidateToolPolicyCache()` makes it immediate in-process. */
const CACHE_TTL_MS = 60_000;

/** Overlay for one tool. Description text only — never schema, never handler. */
export interface ToolOverride {
  /** Replaces the registry description verbatim when present. */
  description?: string;
  /** Appended to the description after the base text. Use for a single
   *  behavioural hint ("pass all URLs at once") without restating the tool. */
  guidance?: string;
}

export type TrialStatus = 'running' | 'kept' | 'reverted';

/** The efficiency numbers a trial is judged on. Snapshotted at publish time. */
export interface EfficiencySnapshot {
  /** Mean tool calls per CHAT turn — the prime outcome. */
  meanCalls: number;
  /** Chat turns the mean was computed over (the sample size). */
  turns: number;
  /** Repeat calls in the chat segment (the thing being attacked). */
  repeatCalls: number;
  takenAt: string;
}

export interface TrialState {
  status: TrialStatus;
  startedAt: string;
  /** Metric as it stood immediately BEFORE this version went live. */
  baseline: EfficiencySnapshot;
  /** Turns observed since `startedAt`, refreshed by each assessment. */
  turnsObserved: number;
  /** Metric at the moment the trial was decided. */
  result?: EfficiencySnapshot;
  /** Why it was kept or reverted — shown on the ledger, fed back to the model. */
  verdict?: string;
  decidedAt?: string;
}

export interface ToolPolicyVersion {
  version: number;
  createdAt: string;
  createdBy: 'engine' | 'owner';
  /** One line explaining the change, for the ledger and the WhatsApp summary. */
  rationale: string;
  /** The repeat pattern this targets, e.g. `jkai:fetch_url`. */
  targetTool?: string;
  /** Per-tool description overlays. */
  overrides: Record<string, ToolOverride>;
  /** Lines appended to the `jkai_extended` meta-tool description — the only
   *  place a cross-cutting rule ("never call the same tool in a loop") can be
   *  stated once rather than per tool. */
  globalGuidance: string[];
  /** Tools promoted into the directly-visible essentials set. Additive only:
   *  an overlay can never DEMOTE a tool, because every name hardcoded in
   *  $lib/mcp/essentials.ts is there for a documented reason and hiding one
   *  would be a capability regression, not a hint change. */
  promoteToEssential: string[];
  /** The version this replaced — the rollback target. null for the base. */
  parentVersion: number | null;
  /** null on a version published as an immediate revert (nothing to prove). */
  trial: TrialState | null;
}

/** The empty overlay — what applies when nothing has ever been published. */
export function emptyPolicy(): ToolPolicyVersion {
  return {
    version: 0,
    createdAt: new Date(0).toISOString(),
    createdBy: 'engine',
    rationale: 'base policy (no overlay)',
    overrides: {},
    globalGuidance: [],
    promoteToEssential: [],
    parentVersion: null,
    trial: null,
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export async function ensureToolPolicyCollection(): Promise<void> {
  await ensureCollection(
    TOOL_POLICY_COLLECTION,
    {
      name: 'Tool Call Policy',
      description:
        'Versioned, non-destructive overlay over tool descriptions and visibility. The self-improvement engine publishes a version, trials it against calls-per-turn, and reverts by moving the `active` pointer.',
      isSystem: true,
      defaultPermissions: TOOL_POLICY_PERMISSIONS,
    },
    SYSTEM_ACTOR,
  );
}

let cache: { policy: ToolPolicyVersion; at: number } | null = null;

/** Drop the in-process cache. Called on publish/revert so a change is live
 *  immediately in the process that made it. */
export function invalidateToolPolicyCache(): void {
  cache = null;
}

function versionKey(n: number): string {
  return `v:${n}`;
}

/** Read one stored version, or null if it isn't there. */
export async function getPolicyVersion(n: number): Promise<ToolPolicyVersion | null> {
  try {
    const rec = await getRecordByKey(TOOL_POLICY_COLLECTION, versionKey(n), SYSTEM_ACTOR);
    return coercePolicy(rec.data);
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return null;
    throw err;
  }
}

/**
 * The live overlay. Never throws: a datastore that is down, a collection that
 * hasn't been seeded, or a malformed record all degrade to the empty policy,
 * because a failure here must not take tool listing with it.
 */
export async function getActivePolicy(): Promise<ToolPolicyVersion> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.policy;
  let policy = emptyPolicy();
  try {
    if (await getCollectionBySlug(TOOL_POLICY_COLLECTION)) {
      const pointer = await getRecordByKey(TOOL_POLICY_COLLECTION, ACTIVE_KEY, SYSTEM_ACTOR);
      const version = Number((pointer.data as { version?: unknown }).version ?? 0);
      if (version > 0) policy = (await getPolicyVersion(version)) ?? emptyPolicy();
    }
  } catch (err) {
    if (!(err instanceof DatastoreError && err.code === 'not_found')) {
      console.error('[toolpolicy] getActivePolicy failed; using base policy:', err);
    }
  }
  cache = { policy, at: Date.now() };
  return policy;
}

/** Every stored version, newest first. Powers the ledger's history + revert UI. */
export async function listPolicyVersions(limit = 50): Promise<ToolPolicyVersion[]> {
  try {
    if (!(await getCollectionBySlug(TOOL_POLICY_COLLECTION))) return [];
    const { records } = await queryRecords(
      TOOL_POLICY_COLLECTION,
      { sort: { field: 'createdAt', dir: 'desc' }, limit },
      SYSTEM_ACTOR,
    );
    return records
      .filter((r) => (r.key ?? '').startsWith('v:'))
      .map((r) => coercePolicy(r.data))
      .filter((p): p is ToolPolicyVersion => p !== null)
      .sort((a, b) => b.version - a.version);
  } catch (err) {
    console.error('[toolpolicy] listPolicyVersions failed:', err);
    return [];
  }
}

/** Next free version number. */
async function nextVersion(): Promise<number> {
  const all = await listPolicyVersions(200);
  return all.reduce((max, p) => Math.max(max, p.version), 0) + 1;
}

export interface PublishInput {
  rationale: string;
  targetTool?: string;
  overrides?: Record<string, ToolOverride>;
  globalGuidance?: string[];
  promoteToEssential?: string[];
  createdBy?: 'engine' | 'owner';
  /** Baseline to judge the trial against. Omit for an immediate, untried change
   *  (a revert) — that publishes with `trial: null`. */
  baseline?: EfficiencySnapshot;
}

/**
 * Write a new immutable version and point `active` at it.
 *
 * The pointer is moved LAST: if the version write succeeds and the pointer
 * write fails, the live policy is unchanged and an orphan version sits in the
 * collection — visible, harmless, and re-publishable. The reverse order could
 * point `active` at a version that does not exist.
 */
export async function publishPolicy(input: PublishInput): Promise<ToolPolicyVersion> {
  await ensureToolPolicyCollection();
  const current = await getActivePolicy();
  const version = await nextVersion();

  const policy: ToolPolicyVersion = {
    version,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy ?? 'engine',
    rationale: input.rationale.slice(0, 400),
    targetTool: input.targetTool,
    overrides: sanitiseOverrides(input.overrides ?? {}),
    globalGuidance: (input.globalGuidance ?? []).slice(0, 6).map((g) => String(g).slice(0, 300)),
    promoteToEssential: (input.promoteToEssential ?? []).slice(0, 8).map(String),
    parentVersion: current.version || null,
    trial: input.baseline
      ? {
          status: 'running',
          startedAt: new Date().toISOString(),
          baseline: input.baseline,
          turnsObserved: 0,
        }
      : null,
  };

  await upsertRecord(
    TOOL_POLICY_COLLECTION,
    { key: versionKey(version), data: policy as unknown as Record<string, unknown> },
    SYSTEM_ACTOR,
  );
  await upsertRecord(
    TOOL_POLICY_COLLECTION,
    { key: ACTIVE_KEY, data: { version, movedAt: new Date().toISOString() } },
    SYSTEM_ACTOR,
  );
  invalidateToolPolicyCache();
  return policy;
}

/** Update a stored version in place (trial bookkeeping only). */
export async function updatePolicyTrial(version: number, trial: TrialState): Promise<void> {
  const stored = await getPolicyVersion(version);
  if (!stored) return;
  stored.trial = trial;
  await upsertRecord(
    TOOL_POLICY_COLLECTION,
    { key: versionKey(version), data: stored as unknown as Record<string, unknown> },
    SYSTEM_ACTOR,
  );
  invalidateToolPolicyCache();
}

/**
 * Roll back to `targetVersion` by republishing its content as a NEW version.
 *
 * Deliberately not "move the pointer backwards": history stays append-only, so
 * the ledger shows that a revert happened and why, and the reverted-from version
 * is still readable. `trial` is null on the result — a revert restores a state
 * that was already the baseline, so there is nothing to prove.
 */
export async function revertPolicyTo(
  targetVersion: number,
  reason: string,
  by: 'engine' | 'owner' = 'engine',
): Promise<ToolPolicyVersion | null> {
  const target = targetVersion === 0 ? emptyPolicy() : await getPolicyVersion(targetVersion);
  if (!target) return null;
  return publishPolicy({
    rationale: `Revert to v${targetVersion}: ${reason}`.slice(0, 400),
    overrides: target.overrides,
    globalGuidance: target.globalGuidance,
    promoteToEssential: target.promoteToEssential,
    createdBy: by,
  });
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/** Strip anything that isn't a description-shaped hint. This is what makes the
 *  overlay structurally incapable of changing behaviour — an LLM-authored
 *  object with a `handler` or `parameters` key loses them here, not later. */
export function sanitiseOverrides(raw: Record<string, unknown>): Record<string, ToolOverride> {
  const out: Record<string, ToolOverride> = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (!name || typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    const description = typeof v.description === 'string' ? v.description.slice(0, 1200) : undefined;
    const guidance = typeof v.guidance === 'string' ? v.guidance.slice(0, 600) : undefined;
    if (!description && !guidance) continue;
    out[name] = { ...(description ? { description } : {}), ...(guidance ? { guidance } : {}) };
    if (Object.keys(out).length >= 24) break;
  }
  return out;
}

/** Resolve the description a tool should be advertised with under `policy`. */
export function describeWithPolicy(
  policy: ToolPolicyVersion,
  name: string,
  baseDescription: string,
): string {
  const o = policy.overrides[name];
  if (!o) return baseDescription;
  const base = o.description ?? baseDescription;
  return o.guidance ? `${base} ${o.guidance}`.trim() : base;
}

/** True when `name` should be directly visible even though the hardcoded
 *  essentials set doesn't list it. */
export function isPromoted(policy: ToolPolicyVersion, name: string): boolean {
  return policy.promoteToEssential.includes(name);
}

/** Global guidance rendered for appending to the meta-tool description. */
export function renderGlobalGuidance(policy: ToolPolicyVersion): string {
  if (policy.globalGuidance.length === 0) return '';
  return ` Call-efficiency rules: ${policy.globalGuidance.join(' ')}`;
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

function coercePolicy(data: unknown): ToolPolicyVersion {
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const base = emptyPolicy();
  const trialRaw = o.trial as Record<string, unknown> | null | undefined;
  return {
    version: Number(o.version ?? 0) || 0,
    createdAt: String(o.createdAt ?? base.createdAt),
    createdBy: o.createdBy === 'owner' ? 'owner' : 'engine',
    rationale: String(o.rationale ?? ''),
    targetTool: o.targetTool ? String(o.targetTool) : undefined,
    overrides: sanitiseOverrides((o.overrides ?? {}) as Record<string, unknown>),
    globalGuidance: Array.isArray(o.globalGuidance) ? o.globalGuidance.slice(0, 6).map(String) : [],
    promoteToEssential: Array.isArray(o.promoteToEssential)
      ? o.promoteToEssential.slice(0, 8).map(String)
      : [],
    parentVersion:
      o.parentVersion === null || o.parentVersion === undefined ? null : Number(o.parentVersion),
    trial: trialRaw
      ? {
          status:
            trialRaw.status === 'kept' || trialRaw.status === 'reverted'
              ? (trialRaw.status as TrialStatus)
              : 'running',
          startedAt: String(trialRaw.startedAt ?? base.createdAt),
          baseline: coerceSnapshot(trialRaw.baseline),
          turnsObserved: Number(trialRaw.turnsObserved ?? 0) || 0,
          result: trialRaw.result ? coerceSnapshot(trialRaw.result) : undefined,
          verdict: trialRaw.verdict ? String(trialRaw.verdict) : undefined,
          decidedAt: trialRaw.decidedAt ? String(trialRaw.decidedAt) : undefined,
        }
      : null,
  };
}

function coerceSnapshot(raw: unknown): EfficiencySnapshot {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    meanCalls: Number(o.meanCalls ?? 0) || 0,
    turns: Number(o.turns ?? 0) || 0,
    repeatCalls: Number(o.repeatCalls ?? 0) || 0,
    takenAt: String(o.takenAt ?? new Date(0).toISOString()),
  };
}
