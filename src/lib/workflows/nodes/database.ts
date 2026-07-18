import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { interpolateTemplate } from './template';
// Type-only imports are erased at compile time — no runtime import of the
// server-only datastore layer happens here (the values are lazy-imported inside
// execute()). This keeps module init free of $lib/db while giving us real types.
import type { PermissionSet, QueryFilter, QuerySort, AggregateOptions } from '$lib/datastore';

export { databaseDef } from './database.def';

/** Canonical operations this node supports. */
export const DATABASE_OPS = [
  'insert',
  'upsert',
  'get',
  'query',
  'update',
  'patch',
  'delete',
  'count',
  'aggregate',
] as const;
export type DatabaseOp = (typeof DATABASE_OPS)[number];

/** Ops that mutate the store — gated by dry-run + permission fields. */
const WRITE_OPS = new Set<DatabaseOp>(['insert', 'upsert', 'update', 'patch', 'delete']);

/** Default result key per op (overridable via config.outputKey). */
function defaultOutputKey(op: DatabaseOp): string {
  if (op === 'query') return 'records';
  if (op === 'get' || op === 'insert' || op === 'upsert' || op === 'update' || op === 'patch') return 'record';
  return 'result';
}

/** Interpolate {{input.*}} into a raw JSON string, then parse. Empty → undefined. */
function parseJsonField(
  raw: unknown,
  input: Record<string, unknown>,
  label: string,
): unknown {
  if (raw === undefined || raw === null) return undefined;
  const interpolated = interpolateTemplate(String(raw), input);
  if (!interpolated.trim()) return undefined;
  try {
    return JSON.parse(interpolated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`database: ${label} is not valid JSON — ${msg}`);
  }
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) throw new Error(`database: ${label} is required.`);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`database: ${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function toNumberOrUndefined(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export const databaseExecutor: NodeExecutor = {
  type: 'database',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const rawOp = String(config.operation ?? 'query').toLowerCase().trim();
    const operation = rawOp as DatabaseOp;
    if (!(DATABASE_OPS as readonly string[]).includes(operation)) {
      throw new Error(
        `database: operation must be one of ${DATABASE_OPS.join(', ')} (got ${JSON.stringify(rawOp)}).`,
      );
    }

    const collection = interpolateTemplate(String(config.collection ?? ''), input).trim();
    if (!collection) {
      throw new Error('database: collection is required (supports {{input.field}} templates).');
    }
    if (!context.workflowId) {
      throw new Error('database: workflowId not available in context');
    }
    const actor = `workflow:${context.workflowId}`;
    const key = interpolateTemplate(String(config.key ?? ''), input).trim();
    const outputKey = String(config.outputKey ?? '').trim() || defaultOutputKey(operation);

    // Lazy import — the datastore access layer pulls $lib/db (server-only) and
    // must not be imported at module-init time.
    const ds = await import('$lib/datastore');
    const { DatastoreError } = ds;

    // Ops requiring a key.
    if (['upsert', 'get', 'update', 'patch', 'delete'].includes(operation) && !key) {
      throw new Error(`database: "${operation}" requires a key (supports {{input.field}} templates).`);
    }

    // Dry run: writes are simulated (never mutate); reads run normally.
    if (context.dryRun && WRITE_OPS.has(operation)) {
      return {
        output: {
          dryRun: true,
          wouldExecute: {
            operation,
            collection,
            ...(key ? { key } : {}),
          },
        },
        rowCount: 1,
        logs: [`[dry-run] would ${operation} in datastore collection "${collection}"`],
        metadata: { dryRun: true },
      };
    }

    try {
      // Auto-create the collection for writes when requested (idempotent).
      if ((operation === 'insert' || operation === 'upsert') && config.autoCreate !== false) {
        await ds.ensureCollection(
          collection,
          {
            // Auto-created collections are shared across workflows (the whole
            // point of this node vs. per-workflow data-store). Row-level perms
            // can still tighten individual records on write. owner always passes.
            defaultPermissions: {
              read: ['workflow:*', 'owner', 'jkai', 'system'],
              write: ['workflow:*', 'owner', 'jkai', 'system'],
              delete: ['workflow:*', 'owner', 'jkai', 'system'],
            },
          },
          actor,
        );
      }

      const permissions = parseJsonField(config.permissions, input, 'permissions') as
        | PermissionSet
        | undefined;

      switch (operation) {
        case 'insert': {
          const data = asObject(parseJsonField(config.data, input, 'data'), 'data');
          const record = await ds.insertRecord(
            collection,
            { key: key || undefined, data, permissions },
            actor,
          );
          return { output: { [outputKey]: record }, rowCount: 1 };
        }

        case 'upsert': {
          const data = asObject(parseJsonField(config.data, input, 'data'), 'data');
          const record = await ds.upsertRecord(collection, { key, data, permissions }, actor);
          return { output: { [outputKey]: record }, rowCount: 1 };
        }

        case 'get': {
          try {
            const record = await ds.getRecordByKey(collection, key, actor);
            return { output: { [outputKey]: record, found: true }, rowCount: 1 };
          } catch (err) {
            if (err instanceof DatastoreError && err.code === 'not_found') {
              return { output: { [outputKey]: null, found: false }, rowCount: 0 };
            }
            throw err;
          }
        }

        case 'query': {
          const filters = parseJsonField(config.filters, input, 'filters') as
            | QueryFilter[]
            | undefined;
          const sortPath = String(config.sortPath ?? '').trim();
          const sortField = String(config.sortField ?? '').trim();
          const dir = config.sortDir === 'asc' ? 'asc' : 'desc';
          const sort: QuerySort | undefined = sortPath
            ? { path: sortPath, dir }
            : sortField
              ? { field: sortField as QuerySort['field'], dir }
              : undefined;
          const { records, total } = await ds.queryRecords(
            collection,
            {
              filters,
              sort,
              limit: toNumberOrUndefined(config.limit),
              offset: toNumberOrUndefined(config.offset),
              includeTotal: true,
            },
            actor,
          );
          return {
            output: { [outputKey]: records, count: records.length, total },
            rowCount: records.length,
          };
        }

        case 'update': {
          const data = asObject(parseJsonField(config.data, input, 'data'), 'data');
          const record = await ds.updateRecord(
            collection,
            { key },
            { data, permissions, expectedVersion: toNumberOrUndefined(config.expectedVersion) },
            actor,
          );
          return { output: { [outputKey]: record }, rowCount: 1 };
        }

        case 'patch': {
          const patch = asObject(parseJsonField(config.patch, input, 'patch'), 'patch');
          const record = await ds.updateRecord(
            collection,
            { key },
            { patch, permissions, expectedVersion: toNumberOrUndefined(config.expectedVersion) },
            actor,
          );
          return { output: { [outputKey]: record }, rowCount: 1 };
        }

        case 'delete': {
          const result = await ds.deleteRecord(collection, { key }, actor);
          return { output: { [outputKey]: result }, rowCount: result.deleted ? 1 : 0 };
        }

        case 'count': {
          const filters = parseJsonField(config.filters, input, 'filters') as
            | QueryFilter[]
            | undefined;
          const n = await ds.countRecords(collection, filters, actor);
          return { output: { [outputKey]: n }, rowCount: n };
        }

        case 'aggregate': {
          const filters = parseJsonField(config.filters, input, 'filters') as
            | QueryFilter[]
            | undefined;
          const aggOp = (String(config.aggregateOp ?? 'count') as AggregateOptions['op']);
          const aggPath = String(config.aggregatePath ?? '').trim() || undefined;
          const groupBy = String(config.groupBy ?? '').trim() || undefined;
          const result = await ds.aggregateRecords(
            collection,
            { op: aggOp, path: aggPath, groupBy, filters },
            actor,
          );
          const rowCount = 'groups' in result ? result.groups.length : 1;
          return { output: { [outputKey]: result }, rowCount };
        }

        default:
          throw new Error(`database: unhandled operation "${operation}"`);
      }
    } catch (err) {
      if (err instanceof DatastoreError) {
        // Surface a clear message; the node's _onError config governs retry/skip.
        throw new Error(`database: ${operation} failed (${err.code}) — ${err.message}`);
      }
      throw err;
    }
  },

  getInputSchema(): JsonSchema {
    return {
      type: 'object',
      description: 'Used for {{input.field}} interpolation in collection / key / data / patch / filters.',
    };
  },

  getOutputSchema(config: Record<string, unknown>): JsonSchema {
    const op = (String(config.operation ?? 'query') as DatabaseOp);
    const outputKey = String(config.outputKey ?? '').trim() || defaultOutputKey(op);
    const record: JsonSchema = { type: 'object', description: 'A datastore record { id, key, data, version, ... }' };
    if (op === 'query') {
      return {
        type: 'object',
        properties: {
          [outputKey]: { type: 'array', description: 'Matching records', items: record },
          count: { type: 'number', description: 'Number of records returned' },
          total: { type: 'number', description: 'Total matching records (ignoring paging)' },
        },
      };
    }
    if (op === 'get') {
      return {
        type: 'object',
        properties: {
          [outputKey]: { type: 'object', description: 'The record, or null when not found' },
          found: { type: 'boolean' },
        },
      };
    }
    if (op === 'count' || op === 'aggregate') {
      return {
        type: 'object',
        properties: {
          [outputKey]: {
            type: op === 'count' ? 'number' : 'object',
            description: op === 'count' ? 'Matching-record count' : 'Aggregate result ({ value } or { groups })',
          },
        },
      };
    }
    if (op === 'delete') {
      return {
        type: 'object',
        properties: {
          [outputKey]: {
            type: 'object',
            description: 'Delete result { deleted, id }',
          },
        },
      };
    }
    // insert / upsert / update / patch
    return {
      type: 'object',
      properties: { [outputKey]: record },
    };
  },
};
