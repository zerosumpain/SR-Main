import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowDataStore } from '$lib/db/schema';
import { and, eq, sql, type SQL } from 'drizzle-orm';

export { dataStoreDef } from './data-store.def';

/** Canonical operations this node supports. */
export const DATA_STORE_OPS = [
  'get',
  'set',
  'append',
  'add_to_set',
  'has',
  'increment',
  'delete',
] as const;
export type DataStoreOp = (typeof DATA_STORE_OPS)[number];

export async function getStoreValue(
  workflowId: string,
  key: string,
): Promise<{ value: unknown; found: boolean }> {
  const [row] = await db
    .select()
    .from(workflowDataStore)
    .where(and(eq(workflowDataStore.workflowId, workflowId), eq(workflowDataStore.key, key)));

  return {
    value: row?.value ?? null,
    found: row !== undefined,
  };
}

/**
 * Load every key/value for a workflow in ONE select, keyed by store key.
 * Used by the engine at run start (and after each data-store/dedupe write) to
 * build the `{{state.KEY}}` resolution snapshot without a per-token DB round-trip.
 */
export async function loadStoreSnapshot(workflowId: string): Promise<Map<string, unknown>> {
  const rows = await db
    .select()
    .from(workflowDataStore)
    .where(eq(workflowDataStore.workflowId, workflowId));
  const snapshot = new Map<string, unknown>();
  for (const row of rows) {
    snapshot.set(row.key, row.value);
  }
  return snapshot;
}

export async function setStoreValue(
  workflowId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(workflowDataStore)
    .values({ workflowId, key, value: value as Parameters<typeof db.insert>[0], updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [workflowDataStore.workflowId, workflowDataStore.key],
      set: { value: value as Parameters<typeof db.insert>[0], updatedAt: new Date() },
    });
}

// ————————————————————————————————————————————————————————————————
// Atomic array/counter helpers.
//
// These are single-statement `INSERT ... ON CONFLICT DO UPDATE` upserts whose
// UPDATE expression references the CURRENT row (`workflow_data_store.value`),
// NOT a value pre-read into JS. Because the conflict path mutates the row it
// holds a lock on, concurrent writers are serialised by Postgres and no update
// is lost — there is deliberately no read-modify-write dance in application
// code. Same-level workflow nodes run concurrently, so this atomicity matters.
// ————————————————————————————————————————————————————————————————

/** Order-preserving distinct: keep the FIRST occurrence of each element. */
function dedupeExpr(base: SQL): SQL {
  return sql`(SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
    FROM (
      SELECT DISTINCT ON (elem) elem, ord
      FROM jsonb_array_elements(${base}) WITH ORDINALITY AS t(elem, ord)
      ORDER BY elem, ord
    ) d)`;
}

/** Keep only the LAST `maxItems` elements (most-recent window), in order. */
function trimExpr(base: SQL, maxItems: number): SQL {
  return sql`(SELECT CASE
      WHEN jsonb_array_length(${base}) <= ${maxItems} THEN ${base}
      ELSE (
        SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
        FROM (
          SELECT elem, ord
          FROM jsonb_array_elements(${base}) WITH ORDINALITY AS t(elem, ord)
          ORDER BY ord DESC
          LIMIT ${maxItems}
        ) s
      )
    END)`;
}

function wrapArray(base: SQL, opts: { dedupe: boolean; maxItems?: number | null }): SQL {
  let expr = base;
  if (opts.dedupe) expr = dedupeExpr(expr);
  if (opts.maxItems != null && Number.isFinite(opts.maxItems) && opts.maxItems > 0) {
    expr = trimExpr(expr, opts.maxItems);
  }
  return expr;
}

async function arrayUpsert(
  workflowId: string,
  key: string,
  values: unknown[],
  opts: { dedupe: boolean; maxItems?: number | null },
): Promise<unknown[]> {
  const newJson = JSON.stringify(values ?? []);
  const insertBase = sql`${newJson}::jsonb`;
  const updateBase = sql`(CASE WHEN jsonb_typeof(workflow_data_store.value) = 'array'
      THEN workflow_data_store.value ELSE '[]'::jsonb END) || ${newJson}::jsonb`;
  const insertExpr = wrapArray(insertBase, opts);
  const updateExpr = wrapArray(updateBase, opts);

  const res = await db.execute(sql`
    INSERT INTO workflow_data_store (workflow_id, key, value, updated_at)
    VALUES (${workflowId}, ${key}, ${insertExpr}, now())
    ON CONFLICT (workflow_id, key)
    DO UPDATE SET value = ${updateExpr}, updated_at = now()
    RETURNING value
  `);
  const row = (res as { rows?: Array<Record<string, unknown>> }).rows?.[0];
  return (row?.value as unknown[]) ?? [];
}

/** Atomically push `values` onto the stored jsonb array (creating it if absent). */
export function appendAtomic(
  workflowId: string,
  key: string,
  values: unknown[],
  maxItems?: number | null,
): Promise<unknown[]> {
  return arrayUpsert(workflowId, key, values, { dedupe: false, maxItems });
}

/**
 * Atomically union `values` into the stored jsonb array (set semantics — no
 * duplicates). Shared by the `dedupe` node to record seen ids. Order-preserving
 * dedupe keeps the first occurrence; `maxItems` keeps the most-recent window.
 */
export function addToSetAtomic(
  workflowId: string,
  key: string,
  values: unknown[],
  maxItems?: number | null,
): Promise<unknown[]> {
  return arrayUpsert(workflowId, key, values, { dedupe: true, maxItems });
}

/**
 * Atomically claim the genuinely-new ids from `candidateIds` and record them.
 *
 * Unlike `addToSetAtomic` (which only serialises the append), this serialises the
 * whole read-decide-write: inside a single transaction it locks the
 * (workflowId,key) row with `SELECT ... FOR UPDATE`, reads the current seen-set,
 * computes which candidates are NOT already present, unions them in (order-
 * preserving, most-recent-window trim), and RETURNS only the ids that were newly
 * added. Because the has()-decision and the write happen under the same row lock,
 * two overlapping runs of the SAME workflow can't both classify the same id as
 * new — closing the dedupe TOCTOU (webhook double-delivery, loop fan-out, a cron
 * firing while the prior run is still executing). The row is per (workflowId,key)
 * so contention is limited to genuinely-racing runs of the same dedupe key.
 */
export async function addToSetReturningNew(
  workflowId: string,
  key: string,
  candidateIds: string[],
  maxItems?: number | null,
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  // De-dupe the incoming batch, preserving first-occurrence order.
  const batch: string[] = [];
  const batchSeen = new Set<string>();
  for (const id of candidateIds) {
    if (!batchSeen.has(id)) {
      batchSeen.add(id);
      batch.push(id);
    }
  }

  return db.transaction(async (tx) => {
    // Ensure the row exists so FOR UPDATE has something to lock on the first run.
    await tx.execute(sql`
      INSERT INTO workflow_data_store (workflow_id, key, value, updated_at)
      VALUES (${workflowId}, ${key}, '[]'::jsonb, now())
      ON CONFLICT (workflow_id, key) DO NOTHING
    `);
    // Lock the row + read the current set. Concurrent claimers of the same key
    // block here until the holder commits, then observe its committed writes.
    const res = await tx.execute(sql`
      SELECT value FROM workflow_data_store
      WHERE workflow_id = ${workflowId} AND key = ${key}
      FOR UPDATE
    `);
    const row = (res as { rows?: Array<Record<string, unknown>> }).rows?.[0];
    const rawExisting = row?.value;
    const existing = Array.isArray(rawExisting) ? rawExisting.map((v) => String(v)) : [];
    const existingSet = new Set(existing);
    const newIds = batch.filter((id) => !existingSet.has(id));
    if (newIds.length === 0) return [];

    // existing is already distinct; newIds are distinct and disjoint from it.
    let merged = [...existing, ...newIds];
    if (maxItems != null && Number.isFinite(maxItems) && maxItems > 0 && merged.length > maxItems) {
      merged = merged.slice(merged.length - maxItems); // keep the most-recent window
    }
    await tx.execute(sql`
      UPDATE workflow_data_store
      SET value = ${JSON.stringify(merged)}::jsonb, updated_at = now()
      WHERE workflow_id = ${workflowId} AND key = ${key}
    `);
    return newIds;
  });
}

/** Atomically add `by` to the stored numeric value (0 if absent / non-numeric). */
export async function incrementAtomic(
  workflowId: string,
  key: string,
  by: number,
): Promise<number> {
  const res = await db.execute(sql`
    INSERT INTO workflow_data_store (workflow_id, key, value, updated_at)
    VALUES (${workflowId}, ${key}, to_jsonb(${by}::numeric), now())
    ON CONFLICT (workflow_id, key)
    DO UPDATE SET value = to_jsonb(
      (CASE WHEN jsonb_typeof(workflow_data_store.value) = 'number'
            THEN (workflow_data_store.value)::text::numeric ELSE 0 END) + ${by}::numeric
    ), updated_at = now()
    RETURNING value
  `);
  const row = (res as { rows?: Array<Record<string, unknown>> }).rows?.[0];
  return Number(row?.value ?? by);
}

/** Delete a key. Returns whether a row was removed. */
export async function deleteStoreKey(workflowId: string, key: string): Promise<boolean> {
  const res = await db.execute(sql`
    DELETE FROM workflow_data_store
    WHERE workflow_id = ${workflowId} AND key = ${key}
    RETURNING id
  `);
  const rows = (res as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Extract the value to store/check from input, honouring `valuePath`. */
function extractValue(input: Record<string, unknown>, config: Record<string, unknown>): unknown {
  const valuePath = config.valuePath as string | undefined;
  if (valuePath) return resolvePath(input, valuePath);
  return input.value !== undefined ? input.value : input;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export const dataStoreExecutor: NodeExecutor = {
  type: 'data-store',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const rawOp = ((config.operation as string) || 'get').toLowerCase().trim();
    // Absorb the two LLM hallucinations that bite most often instead of
    // hard-failing the run: read→get, write→set. Saving still validates
    // against the canonical enum so the node config in storage stays clean,
    // but a stray "read"/"write" at execute time runs as you'd expect.
    const operation = (rawOp === 'read' ? 'get' : rawOp === 'write' ? 'set' : rawOp) as DataStoreOp;
    const key = interpolateTemplate((config.key as string) || '', input);
    const workflowId = context.workflowId;

    if (!workflowId) {
      throw new Error('data-store: workflowId not available in context');
    }
    if (!key) {
      throw new Error('data-store: key is required (supports {{input.field}} templates)');
    }
    if (!(DATA_STORE_OPS as readonly string[]).includes(operation)) {
      throw new Error(
        `data-store: operation must be one of ${DATA_STORE_OPS.join(', ')} (got ${JSON.stringify(rawOp)}).`,
      );
    }

    const maxItems = normaliseMaxItems(config.maxItems);

    // ---- Reads -----------------------------------------------------------
    if (operation === 'get') {
      const { value: stored, found } = await getStoreValue(workflowId, key);
      const value = found ? stored : config.default !== undefined ? config.default : null;
      if (config.passthrough) {
        const outputKey = (config.outputKey as string) || 'value';
        return { output: { ...input, [outputKey]: value, found }, rowCount: 1 };
      }
      return { output: { value, found }, rowCount: 1 };
    }

    if (operation === 'has') {
      const check = extractValue(input, config);
      const { value: stored } = await getStoreValue(workflowId, key);
      const present = Array.isArray(stored)
        ? stored.some((v) => jsonEqual(v, check))
        : jsonEqual(stored, check);
      return { output: { value: present, key }, rowCount: 1 };
    }

    // ---- Writes ----------------------------------------------------------
    if (context.dryRun) {
      return {
        output: { simulated: true, key, operation },
        rowCount: 1,
        logs: [`[dry-run] would ${operation} data-store key "${key}"`],
      };
    }

    if (operation === 'set') {
      const value = extractValue(input, config);
      await setStoreValue(workflowId, key, value);
      return { output: { key, value, stored: true }, rowCount: 1 };
    }

    if (operation === 'append') {
      const value = extractValue(input, config);
      const result = await appendAtomic(workflowId, key, [value], maxItems);
      return { output: { key, value: result, count: result.length, stored: true }, rowCount: result.length };
    }

    if (operation === 'add_to_set') {
      const value = extractValue(input, config);
      const values = Array.isArray(value) ? value : [value];
      const result = await addToSetAtomic(workflowId, key, values, maxItems);
      return { output: { key, value: result, count: result.length, stored: true }, rowCount: result.length };
    }

    if (operation === 'increment') {
      let by = 1;
      if (config.amount !== undefined && config.amount !== null && config.amount !== '') {
        by = Number(config.amount);
      } else {
        const v = extractValue(input, config);
        if (v !== undefined && v !== null && typeof v !== 'object') by = Number(v);
      }
      if (!Number.isFinite(by)) by = 1;
      const result = await incrementAtomic(workflowId, key, by);
      return { output: { key, value: result, stored: true }, rowCount: 1 };
    }

    if (operation === 'delete') {
      const deleted = await deleteStoreKey(workflowId, key);
      return { output: { key, deleted }, rowCount: deleted ? 1 : 0 };
    }

    return { output: { error: `Unknown operation: ${operation}` }, rowCount: 1 };
  },

  getInputSchema(_config: Record<string, unknown>) {
    return {
      type: 'object',
      description:
        'For set/append/increment: input.value is used (or use valuePath config to extract a nested field). Key supports {{input.field}} templates.',
    };
  },

  getOutputSchema(config: Record<string, unknown>) {
    const op = (config.operation as string) || 'get';
    if (op === 'get') {
      return {
        type: 'object',
        properties: {
          value: { type: 'any', description: 'Stored value, or the configured default / null if not found' } as const,
          found: { type: 'boolean' } as const,
        } as Record<string, import('../types').JsonSchema>,
      };
    }
    if (op === 'has') {
      return {
        type: 'object',
        properties: {
          value: { type: 'boolean', description: 'Whether the value is a member of the stored set' } as const,
          key: { type: 'string' } as const,
        } as Record<string, import('../types').JsonSchema>,
      };
    }
    if (op === 'delete') {
      return {
        type: 'object',
        properties: {
          key: { type: 'string' } as const,
          deleted: { type: 'boolean' } as const,
        } as Record<string, import('../types').JsonSchema>,
      };
    }
    return {
      type: 'object',
      properties: {
        key: { type: 'string' } as const,
        value: { type: 'any', description: 'The stored value after the write' } as const,
        stored: { type: 'boolean' } as const,
      } as Record<string, import('../types').JsonSchema>,
    };
  },
};

function normaliseMaxItems(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
