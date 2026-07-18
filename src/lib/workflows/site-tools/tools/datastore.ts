// src/lib/workflows/site-tools/tools/datastore.ts
//
// `datastore` toolset — full CRUD over the permanent, sitewide datastore
// (`$lib/datastore`) from jkai chat + Hermes. All calls run as actor `jkai`;
// row/collection permissions are enforced inside the access layer, never here.
//
// When to use which store (taught in the tool descriptions so the model routes
// correctly):
//   - structured / queryable / tabular data that persists          -> datastore
//   - a distilled personal fact about John ("prefers X")           -> save_memory
//   - throwaway per-workflow scratch state                         -> data-store node
//
// Handlers are exported as pure functions (precedent: publish-page.ts) so they
// can be unit-tested with `$lib/datastore` mocked.

import { register } from '../registry-internal';
import type { ToolDefinition, ToolResult } from '../registry-internal';
import {
  DatastoreError,
  ensureCollection,
  getCollectionBySlug,
  listCollections,
  insertRecord,
  upsertRecord,
  getRecord,
  getRecordByKey,
  queryRecords,
  updateRecord,
  deleteRecord,
  type PermissionSet,
  type QueryFilter,
  type QuerySort,
} from '$lib/datastore';

const ACTOR = 'jkai';

/** Map an access-layer error to a friendly `{success:false}` tool result. */
function toToolError(err: unknown): ToolResult {
  if (err instanceof DatastoreError || (err as { name?: string })?.name === 'DatastoreError') {
    const e = err as DatastoreError;
    return { success: false, error: e.message, data: { code: e.code } };
  }
  return { success: false, error: err instanceof Error ? err.message : 'datastore error' };
}

function requireSlug(args: Record<string, unknown>): string {
  const slug = (args.collection ?? args.slug) as string | undefined;
  if (!slug || typeof slug !== 'string') {
    throw new DatastoreError('validation', 'a "collection" slug is required');
  }
  return slug.trim();
}

function coerceRef(args: Record<string, unknown>): { id?: string; key?: string } {
  const id = args.id as string | undefined;
  const key = args.key as string | undefined;
  if (id) return { id };
  if (key !== undefined && key !== null) return { key: String(key) };
  throw new DatastoreError('validation', 'an "id" or "key" is required to reference a record');
}

// ---------------------------------------------------------------------------
// Handlers (pure, testable)
// ---------------------------------------------------------------------------

export async function handleListCollections(): Promise<ToolResult> {
  try {
    const cols = await listCollections(ACTOR);
    return {
      success: true,
      data: {
        collections: cols.map((c) => ({
          slug: c.slug,
          name: c.name,
          description: c.description,
          isSystem: c.isSystem,
          hasSchema: !!c.schema,
          updatedAt: c.updatedAt,
        })),
      },
    };
  } catch (err) {
    return toToolError(err);
  }
}

export async function handleCreateCollection(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const slug = requireSlug(args);
    const col = await ensureCollection(
      slug,
      {
        name: args.name as string | undefined,
        description: args.description as string | undefined,
        schema: (args.schema as Record<string, unknown> | undefined) ?? undefined,
        defaultPermissions: args.defaultPermissions as PermissionSet | undefined,
      },
      ACTOR,
    );
    return { success: true, data: { slug: col.slug, id: col.id, isSystem: col.isSystem } };
  } catch (err) {
    return toToolError(err);
  }
}

export async function handleQuery(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const slug = requireSlug(args);
    const { records, total } = await queryRecords(
      slug,
      {
        filters: args.filters as QueryFilter[] | undefined,
        sort: args.sort as QuerySort | undefined,
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
        includeTotal: args.includeTotal as boolean | undefined,
      },
      ACTOR,
    );
    return {
      success: true,
      data: {
        records: records.map((r) => ({ id: r.id, key: r.key, data: r.data, version: r.version, updatedAt: r.updatedAt })),
        count: records.length,
        total,
      },
    };
  } catch (err) {
    return toToolError(err);
  }
}

export async function handleGet(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const slug = requireSlug(args);
    const id = args.id as string | undefined;
    const key = args.key as string | undefined;
    if (!id && (key === undefined || key === null)) {
      return { success: false, error: 'an "id" or "key" is required' };
    }
    const rec = id ? await getRecord(slug, id, ACTOR) : await getRecordByKey(slug, String(key), ACTOR);
    return {
      success: true,
      data: { id: rec.id, key: rec.key, data: rec.data, version: rec.version, updatedAt: rec.updatedAt, permissions: rec.permissions },
    };
  } catch (err) {
    return toToolError(err);
  }
}

/** Insert (no key) or upsert-by-key. Auto-creates the collection unless `autoCreate:false`. */
export async function handleSave(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const slug = requireSlug(args);
    const data = args.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { success: false, error: '"data" must be a JSON object' };
    }
    const permissions = args.permissions as PermissionSet | undefined;
    const autoCreate = args.autoCreate !== false;
    if (autoCreate && !(await getCollectionBySlug(slug))) {
      await ensureCollection(slug, {}, ACTOR);
    }

    const key = args.key as string | undefined;
    const rec =
      key !== undefined && key !== null && key !== ''
        ? await upsertRecord(slug, { key: String(key), data, permissions }, ACTOR)
        : await insertRecord(slug, { data, permissions }, ACTOR);
    return { success: true, data: { id: rec.id, key: rec.key, version: rec.version } };
  } catch (err) {
    return toToolError(err);
  }
}

export async function handleUpdate(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const slug = requireSlug(args);
    const ref = coerceRef(args);
    const rec = await updateRecord(
      slug,
      ref,
      {
        data: args.data as Record<string, unknown> | undefined,
        patch: args.patch as Record<string, unknown> | undefined,
        permissions: args.permissions as PermissionSet | undefined,
        expectedVersion: args.expectedVersion as number | undefined,
      },
      ACTOR,
    );
    return { success: true, data: { id: rec.id, key: rec.key, version: rec.version } };
  } catch (err) {
    return toToolError(err);
  }
}

export async function handleDelete(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const slug = requireSlug(args);
    const ref = coerceRef(args);
    const res = await deleteRecord(slug, ref, ACTOR);
    return { success: true, data: res };
  } catch (err) {
    return toToolError(err);
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const filterSchema = {
  type: 'array',
  description:
    'Filter array. Each item is { path, op, value }. path is a dot-path into the record data (e.g. "status" or "meta.priority"). op is one of eq, ne, gt, gte, lt, lte, contains, exists, in.',
  items: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      op: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists', 'in'] },
      value: {},
    },
    required: ['path', 'op'],
  },
} as const;

export const datastoreTools: ToolDefinition[] = [
  {
    name: 'datastore_list_collections',
    description:
      'List the datastore collections you can read (name, slug, whether it is a system collection, whether it enforces a schema). The datastore is the permanent, sitewide store for structured/queryable data. Use this to discover what collections already exist before querying or saving.',
    parameters: { type: 'object', properties: {}, required: [] },
    category: 'Datastore',
    toolset: 'datastore',
    handler: () => handleListCollections(),
  },
  {
    name: 'datastore_create_collection',
    description:
      'Create a datastore collection (a named bucket of JSON records). Only needed for a first-class dataset with a schema or custom permissions — datastore_save auto-creates a plain collection on demand.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Slug: lowercase letters, digits, hyphen or underscore (e.g. "reading-list").' },
        name: { type: 'string', description: 'Human-readable name.' },
        description: { type: 'string' },
        schema: { type: 'object', description: 'Optional JSON-Schema subset validated on every write (type/required/properties/enum/min/max/pattern/items).' },
        defaultPermissions: {
          type: 'object',
          description: 'Optional capability map { read:[], write:[], delete:[] } of actor strings (owner, jkai, system, workflow:<id>, "*"). Owner always has access.',
        },
      },
      required: ['collection'],
    },
    category: 'Datastore',
    toolset: 'datastore',
    handler: (args) => handleCreateCollection(args),
  },
  {
    name: 'datastore_query',
    description:
      'Query records in a datastore collection with filters, sort, limit and offset. Use this to READ structured/queryable data you (or a workflow) previously saved. For a single record by id/key use datastore_get. For a distilled personal fact use recall_memories instead.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection slug to query.' },
        filters: filterSchema,
        sort: {
          type: 'object',
          description: 'Sort spec. { field: createdAt|updatedAt|key, dir: asc|desc } or { path: "<dot.path>", dir }.',
          properties: {
            field: { type: 'string', enum: ['createdAt', 'updatedAt', 'key'] },
            path: { type: 'string' },
            dir: { type: 'string', enum: ['asc', 'desc'] },
          },
        },
        limit: { type: 'number', description: 'Max rows (default/cap 500).' },
        offset: { type: 'number' },
        includeTotal: { type: 'boolean', description: 'Also return the total matching count.' },
      },
      required: ['collection'],
    },
    category: 'Datastore',
    toolset: 'datastore',
    handler: (args) => handleQuery(args),
  },
  {
    name: 'datastore_get',
    description: 'Fetch a single datastore record by id, or by its natural key within a collection.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        id: { type: 'string', description: 'Record id (uuid).' },
        key: { type: 'string', description: 'Natural key (alternative to id).' },
      },
      required: ['collection'],
    },
    category: 'Datastore',
    toolset: 'datastore',
    handler: (args) => handleGet(args),
  },
  {
    name: 'datastore_save',
    description:
      'Save a record into the permanent datastore. Provide a "key" to upsert (create-or-replace by natural key); omit it to insert a new record. Use this for structured/queryable data that should persist and be shared sitewide. For a distilled personal fact about John use save_memory instead; for throwaway per-workflow state use the data-store node.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Target collection slug (auto-created if missing).' },
        key: { type: 'string', description: 'Optional natural key. When present the record is upserted (replaced) on that key.' },
        data: { type: 'object', description: 'The JSON record body.' },
        permissions: {
          type: 'object',
          description: 'Optional row-level capability map { read:[], write:[], delete:[] } overriding the collection default.',
        },
        autoCreate: { type: 'boolean', description: 'Create the collection if it does not exist (default true).' },
      },
      required: ['collection', 'data'],
    },
    category: 'Datastore',
    toolset: 'datastore',
    handler: (args) => handleSave(args),
  },
  {
    name: 'datastore_update',
    description:
      'Update an existing datastore record referenced by id or key. Use "data" to replace the whole body or "patch" to shallow-merge top-level fields. Pass "expectedVersion" for optimistic concurrency.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        id: { type: 'string' },
        key: { type: 'string' },
        data: { type: 'object', description: 'Full replacement body.' },
        patch: { type: 'object', description: 'Shallow top-level merge into the existing body.' },
        permissions: { type: 'object', description: 'Optional new row-level capability map.' },
        expectedVersion: { type: 'number', description: 'If set and it does not match the stored version, the update fails with a conflict.' },
      },
      required: ['collection'],
    },
    category: 'Datastore',
    toolset: 'datastore',
    handler: (args) => handleUpdate(args),
  },
  {
    name: 'datastore_delete',
    description: 'Delete a datastore record by id or key. This is destructive and cannot be undone.',
    destructive: true,
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        id: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['collection'],
    },
    category: 'Datastore',
    toolset: 'datastore',
    handler: (args) => handleDelete(args),
  },
];

for (const tool of datastoreTools) register(tool);
