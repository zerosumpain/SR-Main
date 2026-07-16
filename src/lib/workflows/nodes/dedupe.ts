import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { getStoreValue, addToSetAtomic } from './data-store';

export { dedupeDef } from './dedupe.def';

// ————————————————————————————————————————————————————————————————
// Deferred recording for recordMode: 'downstream-success'.
//
// In this mode the dedupe node filters immediately but does NOT write the new
// ids to the seen-set until the whole run finishes successfully. The engine
// flushes on overall success and discards on failure — so a run whose send
// step fails does NOT mark the items as seen, and they will be retried next
// run. Records are keyed by runId; a run may contain several dedupe nodes.
// ————————————————————————————————————————————————————————————————

interface PendingDedupeRecord {
  workflowId: string;
  storeKey: string;
  ids: string[];
  maxRemembered: number | null;
}

const pendingByRun = new Map<string, PendingDedupeRecord[]>();

export function registerPendingDedupeRecords(runId: string, record: PendingDedupeRecord): void {
  if (!runId || record.ids.length === 0) return;
  const existing = pendingByRun.get(runId);
  if (existing) existing.push(record);
  else pendingByRun.set(runId, [record]);
}

/** Commit all deferred dedupe records for a successful run, then clear them. */
export async function flushPendingDedupeRecords(runId: string): Promise<void> {
  const records = pendingByRun.get(runId);
  if (!records) return;
  pendingByRun.delete(runId);
  for (const rec of records) {
    try {
      await addToSetAtomic(rec.workflowId, rec.storeKey, rec.ids, rec.maxRemembered);
    } catch (err) {
      console.error(`[dedupe] failed to flush seen-ids for run ${runId} key ${rec.storeKey}:`, err);
    }
  }
}

/** Drop all deferred dedupe records for a run (failure / cancel path). */
export function discardPendingDedupeRecords(runId: string): void {
  pendingByRun.delete(runId);
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

    // Load the seen-set.
    const { value: storedSet } = await getStoreValue(workflowId, storeKey);
    const seen = new Set<string>(Array.isArray(storedSet) ? storedSet.map((v) => String(v)) : []);

    // Filter to unseen, collecting the new ids we should remember.
    const unseen: unknown[] = [];
    const newIds = new Set<string>();
    for (const item of originalArray) {
      const rawId = extractId(item, idPath);
      if (rawId === undefined || rawId === null) {
        // No id → treat as new (pass through) but do NOT store undefined.
        unseen.push(item);
        continue;
      }
      const idStr = String(rawId);
      if (seen.has(idStr)) continue; // already seen → drop
      unseen.push(item);
      newIds.add(idStr);
    }

    // Record the new ids (unless a dry run).
    const ids = [...newIds];
    if (!context.dryRun && ids.length > 0) {
      if (recordMode === 'immediate') {
        await addToSetAtomic(workflowId, storeKey, ids, maxRemembered);
      } else {
        registerPendingDedupeRecords(context.runId, {
          workflowId,
          storeKey,
          ids,
          maxRemembered,
        });
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
