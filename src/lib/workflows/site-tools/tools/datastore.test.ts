import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the access layer — these handlers are pure orchestration over it.
vi.mock('$lib/datastore', () => {
  class DatastoreError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = 'DatastoreError';
    }
  }
  return {
    DatastoreError,
    ensureCollection: vi.fn(),
    getCollectionBySlug: vi.fn(),
    listCollections: vi.fn(),
    insertRecord: vi.fn(),
    upsertRecord: vi.fn(),
    getRecord: vi.fn(),
    getRecordByKey: vi.fn(),
    queryRecords: vi.fn(),
    updateRecord: vi.fn(),
    deleteRecord: vi.fn(),
  };
});

import {
  DatastoreError,
  ensureCollection,
  getCollectionBySlug,
  insertRecord,
  upsertRecord,
  getRecord,
  queryRecords,
  deleteRecord,
} from '$lib/datastore';
import {
  datastoreTools,
  handleSave,
  handleGet,
  handleQuery,
  handleDelete,
} from './datastore';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('datastore tool definitions', () => {
  it('registers datastore_delete as destructive and others as non-destructive', () => {
    const del = datastoreTools.find((t) => t.name === 'datastore_delete');
    expect(del?.destructive).toBe(true);
    for (const t of datastoreTools.filter((t) => t.name !== 'datastore_delete')) {
      expect(t.destructive).not.toBe(true);
    }
    // All live under the pinned toolset name.
    expect(new Set(datastoreTools.map((t) => t.toolset))).toEqual(new Set(['datastore']));
  });

  it('exposes exactly the pinned tool names', () => {
    expect(datastoreTools.map((t) => t.name).sort()).toEqual(
      [
        'datastore_create_collection',
        'datastore_delete',
        'datastore_get',
        'datastore_list_collections',
        'datastore_query',
        'datastore_save',
        'datastore_update',
      ].sort(),
    );
  });
});

describe('handleSave routing', () => {
  it('upserts when a key is provided', async () => {
    vi.mocked(getCollectionBySlug).mockResolvedValue({ slug: 'notes' } as never);
    vi.mocked(upsertRecord).mockResolvedValue({ id: '1', key: 'k1', version: 2 } as never);

    const r = await handleSave({ collection: 'notes', key: 'k1', data: { a: 1 } });
    expect(r.success).toBe(true);
    expect(upsertRecord).toHaveBeenCalledWith('notes', { key: 'k1', data: { a: 1 }, permissions: undefined }, 'jkai');
    expect(insertRecord).not.toHaveBeenCalled();
  });

  it('inserts when no key is provided', async () => {
    vi.mocked(getCollectionBySlug).mockResolvedValue({ slug: 'notes' } as never);
    vi.mocked(insertRecord).mockResolvedValue({ id: '2', key: null, version: 1 } as never);

    const r = await handleSave({ collection: 'notes', data: { a: 2 } });
    expect(r.success).toBe(true);
    expect(insertRecord).toHaveBeenCalledWith('notes', { data: { a: 2 }, permissions: undefined }, 'jkai');
    expect(upsertRecord).not.toHaveBeenCalled();
  });

  it('auto-creates the collection when missing', async () => {
    vi.mocked(getCollectionBySlug).mockResolvedValue(null as never);
    vi.mocked(ensureCollection).mockResolvedValue({ slug: 'fresh' } as never);
    vi.mocked(insertRecord).mockResolvedValue({ id: '3', key: null, version: 1 } as never);

    await handleSave({ collection: 'fresh', data: { x: true } });
    expect(ensureCollection).toHaveBeenCalledWith('fresh', {}, 'jkai');
  });

  it('rejects non-object data', async () => {
    const r = await handleSave({ collection: 'notes', data: 'oops' });
    expect(r.success).toBe(false);
    expect(insertRecord).not.toHaveBeenCalled();
  });
});

describe('error mapping', () => {
  it('maps a DatastoreError to a friendly failure with its code', async () => {
    vi.mocked(getRecord).mockRejectedValue(new DatastoreError('not_found', 'record "x" not found in "notes"'));
    const r = await handleGet({ collection: 'notes', id: 'x' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/);
    expect((r.data as { code: string }).code).toBe('not_found');
  });

  it('maps a forbidden delete', async () => {
    vi.mocked(deleteRecord).mockRejectedValue(new DatastoreError('forbidden', 'not allowed'));
    const r = await handleDelete({ collection: 'notes', key: 'k' });
    expect(r.success).toBe(false);
    expect((r.data as { code: string }).code).toBe('forbidden');
  });
});

describe('handleQuery', () => {
  it('returns mapped records + total', async () => {
    vi.mocked(queryRecords).mockResolvedValue({
      records: [{ id: '1', key: 'a', data: { n: 1 }, version: 1, updatedAt: new Date(0) }],
      total: 1,
    } as never);
    const r = await handleQuery({ collection: 'notes', filters: [{ path: 'n', op: 'eq', value: 1 }], includeTotal: true });
    expect(r.success).toBe(true);
    const d = r.data as { records: unknown[]; count: number; total: number };
    expect(d.count).toBe(1);
    expect(d.total).toBe(1);
    expect(queryRecords).toHaveBeenCalledWith(
      'notes',
      expect.objectContaining({ filters: [{ path: 'n', op: 'eq', value: 1 }], includeTotal: true }),
      'jkai',
    );
  });

  it('requires a collection', async () => {
    const r = await handleQuery({});
    expect(r.success).toBe(false);
  });
});
