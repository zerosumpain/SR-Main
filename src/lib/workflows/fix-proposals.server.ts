// src/lib/workflows/fix-proposals.server.ts
//
// Self-heal is PROPOSE-ONLY.
//
// When a node fails mid-run, the engine asks a model for a config fix and
// retries with it. That fix used to be written straight back to workflow_nodes
// by three separate persisters — so a model's guess silently became the saved
// workflow, with no version bump, no audit row and no owner in the loop, while
// the engine's own comment and the canvas both said the fix applied "to this run
// only". Now the heal stays per-run, and a heal whose retry SUCCEEDED is stored
// here as a proposal the owner applies (through applyAmendOps, so it is
// versioned and audited like any other edit) or dismisses.
//
// Storage is a datastore collection, not a table — the workflow doctor's
// precedent (doctor_findings): no schema change, keyed upserts give the dedupe
// for free, and row permissions keep it off the chat's read path.
//
// Shared by the web endpoints (/api/workflows/[id]/fix-proposals) and the native
// lane; neither should grow its own copy of the accept path.

import { createHash } from 'node:crypto';
import {
  DatastoreError,
  ensureCollection,
  getCollectionBySlug,
  getRecordByKey,
  queryRecords,
  upsertRecord,
} from '$lib/datastore';
import { applyAmendOps, type AmendResult } from '$lib/canvas/amend.server';
import { credentialFields } from '$lib/canvas/mutate.server';
import { redactSensitive } from '$lib/security/sensitive';
import type { UndoEntry } from './types';

export const FIX_PROPOSALS_COLLECTION = 'workflow_fix_proposals';
const SYSTEM_ACTOR = 'system';

export type FixProposalStatus = 'pending' | 'accepted' | 'dismissed';

/** What is stored. Only the keys the fix touched — never a whole config. */
export interface FixProposalData {
  workflowId: string;
  nodeId: string;
  nodeLabel: string;
  nodeType: string | null;
  /** The model's one-line account of the fix (redacted on the way in). */
  description: string;
  /** key → proposed value. `null` means "remove this key". */
  changes: Record<string, unknown>;
  /** key → the value the saved config had when the heal ran (absent = key was not set). */
  previous: Record<string, unknown>;
  status: FixProposalStatus;
  /** The run that most recently produced this exact fix. */
  runId: string;
  /** How many runs have healed this node the same way. */
  occurrences: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface FixProposal extends FixProposalData {
  id: string;
}

export class FixProposalNotFoundError extends Error {
  constructor(id: string) {
    super(`fix proposal not found: ${id}`);
    this.name = 'FixProposalNotFoundError';
  }
}

export class FixProposalNotPendingError extends Error {
  status: FixProposalStatus;
  constructor(id: string, status: FixProposalStatus) {
    super(`fix proposal ${id} is already ${status}`);
    this.name = 'FixProposalNotPendingError';
    this.status = status;
  }
}

/** Keys sorted at every depth, so the same config always hashes the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * One proposal per workflow + node + proposed config. The same heal arriving on
 * ten runs updates one record instead of stacking ten banners.
 */
export function fixProposalKey(workflowId: string, nodeId: string, proposedConfig: Record<string, unknown>): string {
  const h = createHash('sha256').update(stableStringify(proposedConfig)).digest('hex').slice(0, 16);
  return `${workflowId}:${nodeId}:${h}`;
}

/** What the heal changed, as an update_node patch plus the values it replaced. */
export function diffConfigs(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { changes: Record<string, unknown>; previous: Record<string, unknown> } {
  const changes: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const inBefore = key in before;
    const inAfter = key in after;
    if (inBefore && inAfter && stableStringify(before[key]) === stableStringify(after[key])) continue;
    changes[key] = inAfter ? after[key] : null;
    if (inBefore) previous[key] = before[key];
  }
  return { changes, previous };
}

async function ensureFixProposalsCollection(): Promise<void> {
  await ensureCollection(
    FIX_PROPOSALS_COLLECTION,
    {
      name: 'Workflow Fix Proposals',
      description:
        'Config fixes self-healing found during a run. Never applied automatically — the owner applies or dismisses each one from the canvas.',
      isSystem: true,
      // Not readable by the chat: a proposal quotes node config.
      defaultPermissions: {
        read: ['owner', 'system'],
        write: ['owner', 'system'],
        delete: ['owner', 'system'],
      },
    },
    SYSTEM_ACTOR,
  );
}

async function readProposal(key: string): Promise<FixProposalData | null> {
  if (!(await getCollectionBySlug(FIX_PROPOSALS_COLLECTION))) return null;
  try {
    const rec = await getRecordByKey(FIX_PROPOSALS_COLLECTION, key, SYSTEM_ACTOR);
    return rec.data as unknown as FixProposalData;
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return null;
    throw err;
  }
}

async function writeProposal(key: string, data: FixProposalData): Promise<void> {
  await upsertRecord(
    FIX_PROPOSALS_COLLECTION,
    { key, data: data as unknown as Record<string, unknown> },
    SYSTEM_ACTOR,
  );
}

/**
 * Turn a run's healing history into proposals. Only entries whose retry
 * succeeded qualify — the engine marks exactly one per healed node. Returns the
 * number of proposals created or refreshed. Never throws: a run's persistence
 * must not fail because a proposal could not be written.
 */
export async function recordFixProposalsFromHealing(
  workflowId: string,
  runId: string,
  healingHistory: UndoEntry[],
): Promise<number> {
  const fixes = healingHistory.filter((e) => e.retrySucceeded === true);
  if (fixes.length === 0) return 0;

  let written = 0;
  try {
    await ensureFixProposalsCollection();
  } catch (err) {
    console.error('[fix-proposals] could not ensure collection:', err instanceof Error ? err.message : err);
    return 0;
  }

  // A chain of attempts stacks: attempt 3's `originalConfig` is attempt 2's
  // healed config, not the saved one. The node's FIRST entry in this run holds
  // the config as saved, so that is what the proposal is a diff against.
  const savedConfig = new Map<string, Record<string, unknown>>();
  for (const e of healingHistory) {
    if (!savedConfig.has(e.nodeId)) savedConfig.set(e.nodeId, e.originalConfig ?? {});
  }

  for (const entry of fixes) {
    try {
      const before = savedConfig.get(entry.nodeId) ?? entry.originalConfig ?? {};
      const after = entry.newConfig ?? {};
      const { changes, previous } = diffConfigs(before, after);
      if (Object.keys(changes).length === 0) continue;

      // A node holding a credential can never be patched (mutateNodeConfig
      // refuses), so a proposal for it could only ever fail — and would copy
      // config into one more store. Skip it.
      if (credentialFields(before).length > 0 || credentialFields(after).length > 0) {
        console.warn(`[fix-proposals] skipping heal on ${entry.nodeId}: node config holds a credential`);
        continue;
      }

      const key = fixProposalKey(workflowId, entry.nodeId, after);
      const existing = await readProposal(key);
      const now = new Date().toISOString();

      // A verdict is sticky: re-proposing a fix the owner dismissed is exactly
      // the noise this store exists to stop, and an accepted one is already in
      // the saved config.
      if (existing && existing.status !== 'pending') continue;

      await writeProposal(key, {
        workflowId,
        nodeId: entry.nodeId,
        nodeLabel: entry.nodeLabel ?? existing?.nodeLabel ?? entry.nodeId,
        nodeType: entry.nodeType ?? existing?.nodeType ?? null,
        description: redactSensitive(String(entry.fixDescription ?? '')).slice(0, 500),
        changes,
        previous,
        status: 'pending',
        runId,
        occurrences: (existing?.occurrences ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      written++;
    } catch (err) {
      console.error(
        `[fix-proposals] failed to record heal for node ${entry.nodeId} (run ${runId}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return written;
}

/** A workflow's proposals, newest first. Pending only unless asked otherwise. */
export async function listFixProposals(
  workflowId: string,
  opts: { status?: FixProposalStatus | 'all' } = {},
): Promise<FixProposal[]> {
  if (!(await getCollectionBySlug(FIX_PROPOSALS_COLLECTION))) return [];
  const status = opts.status ?? 'pending';
  const filters: Array<{ path: string; op: 'eq'; value: unknown }> = [
    { path: 'workflowId', op: 'eq', value: workflowId },
  ];
  if (status !== 'all') filters.push({ path: 'status', op: 'eq', value: status });
  const { records } = await queryRecords(
    FIX_PROPOSALS_COLLECTION,
    { filters, sort: { field: 'updatedAt', dir: 'desc' }, limit: 100 },
    SYSTEM_ACTOR,
  );
  return records.map((r) => ({ id: r.key ?? r.id, ...(r.data as unknown as FixProposalData) }));
}

async function loadPending(workflowId: string, proposalId: string): Promise<FixProposalData> {
  const data = await readProposal(proposalId);
  // A key from another workflow is "not found" here, never "forbidden" — the
  // caller is scoped to one workflow and must not learn what else exists.
  if (!data || data.workflowId !== workflowId) throw new FixProposalNotFoundError(proposalId);
  if (data.status !== 'pending') throw new FixProposalNotPendingError(proposalId, data.status);
  return data;
}

/**
 * Apply a proposal permanently. Goes through applyAmendOps `update_node`, so the
 * node's version bumps and an audit row is written with actor `owner` — the
 * same record any hand edit leaves. Throws the amend errors unchanged
 * (AmendOpError wrapping NodeNotFoundError / SensitiveRefusalError) for the
 * caller to map to a status.
 */
export async function acceptFixProposal(
  workflowId: string,
  proposalId: string,
): Promise<{ proposal: FixProposal; amend: AmendResult }> {
  const data = await loadPending(workflowId, proposalId);
  const amend = await applyAmendOps({
    workflowId,
    ops: [{ op: 'update_node', nodeId: data.nodeId, config: { ...data.changes } }],
    actor: 'owner',
    reason: `apply self-heal fix: ${data.description}`.slice(0, 300),
  });
  const now = new Date().toISOString();
  const next: FixProposalData = { ...data, status: 'accepted', resolvedAt: now, updatedAt: now };
  await writeProposal(proposalId, next);
  return { proposal: { id: proposalId, ...next }, amend };
}

/** Dismiss a proposal. The same fix will not be proposed again. */
export async function dismissFixProposal(workflowId: string, proposalId: string): Promise<FixProposal> {
  const data = await loadPending(workflowId, proposalId);
  const now = new Date().toISOString();
  const next: FixProposalData = { ...data, status: 'dismissed', resolvedAt: now, updatedAt: now };
  await writeProposal(proposalId, next);
  return { id: proposalId, ...next };
}

/**
 * The wire shape — what the canvas banner and the native lane both render.
 * Values are left out on purpose: a banner names what changes, the node's own
 * inspector shows the config.
 */
export interface FixProposalDTO {
  id: string;
  nodeId: string;
  nodeLabel: string;
  description: string;
  createdAt: string;
  runId: string;
  changedKeys: string[];
  occurrences: number;
}

export function toFixProposalDTO(p: FixProposal): FixProposalDTO {
  return {
    id: p.id,
    nodeId: p.nodeId,
    nodeLabel: p.nodeLabel,
    description: p.description,
    createdAt: p.createdAt,
    runId: p.runId,
    changedKeys: Object.keys(p.changes ?? {}),
    occurrences: p.occurrences ?? 1,
  };
}
