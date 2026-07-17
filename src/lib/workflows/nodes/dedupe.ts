import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { getStoreValue, addToSetAtomic, addToSetReturningNew } from './data-store';

export { dedupeDef } from './dedupe.def';

// ————————————————————————————————————————————————————————————————
// Deferred recording for recordMode: 'downstream-success'.
//
// In this mode the dedupe node filters immediately but does NOT write the new
// ids to the seen-set until the whole run finishes successfully. The engine
// commits on overall success and simply drops them on failure — so a run whose
// send step fails does NOT mark the items as seen, and they will be retried
// next run.
//
// The deferred record is embedded IN THE NODE'S OUTPUT (under `_pendingDedupe`)
// rather than in a process-local map. Node outputs are persisted to
// node_executions and re-seeded on resume, so a record survives an
// `awaiting_human` pause that resumes in a DIFFERENT process (worker → web) or
// after a restart during the human pause — where the old module-global map was
// lost, silently re-sending the same items on the next run.
// ————————————————————————————————————————————————————————————————

/** Output key carrying a deferred (downstream-success) dedupe record. */
export const PENDING_DEDUPE_KEY = '_pendingDedupe';

export interface EmbeddedDedupeRecord {
  workflowId: string;
  storeKey: string;
  ids: string[];
  maxRemembered: number | null;
}

/**
 * Commit every deferred dedupe record found in a run's node outputs, now the
 * whole run has succeeded. Reads the records from the OUTPUTS (durable across the
 * pause/resume process boundary) rather than a module-global map. `addToSetAtomic`
 * is a set-union upsert, so committing the same ids twice is a harmless no-op.
 */
export async function commitDeferredDedupeRecords(
  outputs: Iterable<Record<string, unknown> | undefined>,
): Promise<void> {
  for (const output of outputs) {
    const rec = output?.[PENDING_DEDUPE_KEY] as EmbeddedDedupeRecord | undefined;
    if (!rec || !Array.isArray(rec.ids) || rec.ids.length === 0) continue;
    try {
      await addToSetAtomic(rec.workflowId, rec.storeKey, rec.ids, rec.maxRemembered);
    } catch (err) {
      console.error(`[dedupe] failed to commit deferred seen-ids for key ${rec.storeKey}:`, err);
    }
  }
}

function normaliseMax(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Extract the unique id for an item. Returns undefined when none resolves. */
function extractId(item: unknown, idPath: string): unknown {
  if (idPath) return resolvePath(item, idPath);
  if (item !== null && typeof item === 'object') {
    const rec = item as Record<string, unknown>;
    if (rec.url !== undefined && rec.url !== null) return rec.url;
    if (rec.id !== undefined && rec.id !== null) return rec.id;
    return undefined;
  }
  // Primitive item is its own id.
  return item;
}

/** Auto-detect the first top-level array value; returns key + array. */
function autoDetectArray(input: Record<string, unknown>): { key: string; arr: unknown[] } | null {
  for (const [k, v] of Object.entries(input)) {
    if (Array.isArray(v)) return { key: k, arr: v };
  }
  return null;
}

export const dedupeExecutor: NodeExecutor = {
  type: 'dedupe',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const workflowId = context.workflowId;
    if (!workflowId) throw new Error('dedupe: workflowId not available in context');

    const itemsPath = String(config.itemsPath ?? '').trim();
    const idPath = String(config.idPath ?? '').trim();
    const storeKey = String(config.storeKey ?? '').trim() || 'seen_ids';
    const maxRemembered = normaliseMax(config.maxRemembered, 500);
    const recordMode = config.recordMode === 'downstream-success' ? 'downstream-success' : 'immediate';

    // Resolve the source array + remember the top-level key so we can drop it
    // from the passthrough (avoids emitting the full array twice).
    let originalArray: unknown[];
    let sourceTopKey: string | undefined;
    if (itemsPath) {
      const resolved = resolvePath(input, itemsPath);
      originalArray = Array.isArray(resolved) ? resolved : [];
      if (!itemsPath.includes('.') && itemsPath in input) sourceTopKey = itemsPath;
    } else {
      const detected = autoDetectArray(input);
      originalArray = detected ? detected.arr : [];
      sourceTopKey = detected?.key;
    }

    // Pair each item with its resolved id (string) or null (no id → always new).
    const itemsWithIds = originalArray.map((item) => {
      const rawId = extractId(item, idPath);
      return { item, id: rawId === undefined || rawId === null ? null : String(rawId) };
    });
    // Ordered distinct candidate ids (first occurrence wins).
    const candidateIds: string[] = [];
    const candidateSeen = new Set<string>();
    for (const { id } of itemsWithIds) {
      if (id !== null && !candidateSeen.has(id)) {
        candidateSeen.add(id);
        candidateIds.push(id);
      }
    }

    let unseen: unknown[];
    let pendingRecord: EmbeddedDedupeRecord | null = null;

    if (context.dryRun) {
      // DRY RUN: filter against the current stored set but NEVER write.
      const { value: storedSet } = await getStoreValue(workflowId, storeKey);
      const seen = new Set<string>(Array.isArray(storedSet) ? storedSet.map((v) => String(v)) : []);
      unseen = itemsWithIds.filter(({ id }) => id === null || !seen.has(id)).map(({ item }) => item);
    } else if (recordMode === 'immediate') {
      // ATOMIC claim: the has()-decision AND the record happen under one row lock,
      // so two overlapping runs of this workflow can't both classify an id as new
      // (dedupe TOCTOU fix). Only ids this call actually claimed pass downstream.
      const claimedNew =
        candidateIds.length > 0
          ? await addToSetReturningNew(workflowId, storeKey, candidateIds, maxRemembered)
          : [];
      const newIdSet = new Set(claimedNew);
      unseen = itemsWithIds.filter(({ id }) => id === null || newIdSet.has(id)).map(({ item }) => item);
    } else {
      // downstream-success: defer the write to run-completion so a failed send
      // does NOT mark its items seen. The has()-decision is a point-in-time read
      // (the atomic claim can't be used — the write must wait for success), so
      // this mode trades concurrency-safety for retry-safety by design.
      const { value: storedSet } = await getStoreValue(workflowId, storeKey);
      const seen = new Set<string>(Array.isArray(storedSet) ? storedSet.map((v) => String(v)) : []);
      const passed: unknown[] = [];
      const recordIds: string[] = [];
      const recordSeen = new Set<string>();
      for (const { item, id } of itemsWithIds) {
        if (id === null) {
          passed.push(item);
          continue;
        }
        if (seen.has(id)) continue; // already seen → drop
        passed.push(item);
        if (!recordSeen.has(id)) {
          recordSeen.add(id);
          recordIds.push(id);
        }
      }
      unseen = passed;
      if (recordIds.length > 0) {
        pendingRecord = { workflowId, storeKey, ids: recordIds, maxRemembered };
      }
    }

    // Passthrough of other input keys + the dedupe result.
    const passthrough: Record<string, unknown> = { ...input };
    if (sourceTopKey && sourceTopKey in passthrough) delete passthrough[sourceTopKey];

    const output: Record<string, unknown> = {
      ...passthrough,
      items: unseen,
      newCount: unseen.length,
      seenCount: originalArray.length - unseen.length,
      allItems: originalArray,
    };
    if (context.dryRun) output.dryRun = true;
    // Embed the deferred record durably in the output — the engine commits it on
    // overall run success (survives an awaiting_human pause/resume across process
    // boundaries, unlike the old module-global map).
    if (pendingRecord) output[PENDING_DEDUPE_KEY] = pendingRecord;

    return { output, rowCount: unseen.length };
  },

  getInputSchema(): JsonSchema {
    return {
      type: 'object',
      description:
        'An object containing an array of items (e.g. { results: [...] }). itemsPath selects it, or the first array is auto-detected.',
    };
  },

  getOutputSchema(): JsonSchema {
    return {
      type: 'object',
      properties: {
        items: { type: 'array', description: 'Only the items not seen in a previous run' },
        newCount: { type: 'number', description: 'Number of new items' },
        seenCount: { type: 'number', description: 'Number filtered out as already seen' },
        allItems: { type: 'array', description: 'The original, unfiltered array' },
      },
    };
  },
};
