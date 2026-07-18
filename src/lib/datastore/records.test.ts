import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

// The access layer talks to Postgres exclusively through `db.execute(sql\`...\`)`
// (precedent: src/lib/workflows/nodes/data-store.ts). We mock that single method
// and route the response by inspecting the compiled SQL text, so the tests drive
// the REAL records.ts guard logic (limit / validation / forbidden / conflict /
// not_found) without a database.
const dialect = new PgDialect();
let router: (sqlText: string, params: unknown[]) => unknown[];

vi.mock('$lib/db', () => ({
  db: {
    execute: (frag: SQL) => {
      const q = dialect.sqlToQuery(frag);
      return Promise.resolve({ rows: router(q.sql, q.params) });
    },
  },
}));

import {
  insertRecord,
  getRecord,
  updateRecord,
  deleteRecord,
  upsertRecord,
} from './records';
import { DatastoreError } from './types';

const OWNER_ROW = {
  id: 'c1',
  slug: 'notes',
  name: 'Notes',
  description: null,
  schema: null,
  default_permissions: null,
  settings: null,
  is_system: false,
  created_by: 'owner',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

function collectionRow(over: Record<string, unknown> = {}) {
  return { ...OWNER_ROW, ...over };
}
function recordRow(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    collection_id: 'c1',
    key: null,
    data: { foo: 'bar' },
    permissions: null,
    version: 1,
    created_by: 'owner',
    updated_by: 'owner',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    expires_at: null,
    ...over,
  };
}

/** Build a router from a small spec keyed by SQL operation. */
function routeWith(spec: {
  collection?: unknown[];
  count?: number;
  select?: unknown[];
  insert?: unknown[];
  update?: unknown[];
  del?: unknown[];
}) {
  router = (sqlText: string) => {
    if (sqlText.includes('datastore_audit_log')) return [];
    if (sqlText.includes('datastore_collections')) return spec.collection ?? [];
    if (sqlText.includes('count(')) return [{ count: spec.count ?? 0 }];
    if (sqlText.includes('INSERT INTO datastore_records')) return spec.insert ?? [];
    if (sqlText.includes('UPDATE datastore_records')) return spec.update ?? [];
    if (sqlText.includes('DELETE FROM datastore_records')) return spec.del ?? [];
    if (sqlText.includes('FROM datastore_records')) return spec.select ?? [];
    return [];
  };
}

beforeEach(() => {
  router = () => [];
});

describe('insertRecord — guards', () => {
  it('throws not_found when the collection does not exist', async () => {
    routeWith({ collection: [] });
    await expect(insertRecord('missing', { data: { a: 1 } }, 'owner')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('throws forbidden when the actor lacks write permission', async () => {
    routeWith({
      collection: [collectionRow({ default_permissions: { read: ['owner'], write: ['owner'], delete: ['owner'] } })],
    });
    await expect(insertRecord('notes', { data: { a: 1 } }, 'workflow:x')).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('throws validation when data violates the collection schema', async () => {
    routeWith({
      collection: [collectionRow({ schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } })],
    });
    const err = await insertRecord('notes', { data: { body: 'x' } }, 'owner').catch((e) => e);
    expect(err).toBeInstanceOf(DatastoreError);
    expect(err.code).toBe('validation');
    expect(err.message).toContain('title');
  });

  it('throws limit when the payload exceeds maxPayloadBytes', async () => {
    routeWith({ collection: [collectionRow({ settings: { maxPayloadBytes: 32 } })] });
    await expect(
      insertRecord('notes', { data: { big: 'x'.repeat(1000) } }, 'owner'),
    ).rejects.toMatchObject({ code: 'limit' });
  });

  it('throws limit when the collection is at maxRecords', async () => {
    routeWith({ collection: [collectionRow({ settings: { maxRecords: 2 } })], count: 2 });
    await expect(insertRecord('notes', { data: { a: 1 } }, 'owner')).rejects.toMatchObject({
      code: 'limit',
    });
  });

  it('inserts and returns the mapped record on success', async () => {
    routeWith({
      collection: [collectionRow()],
      count: 0,
      insert: [recordRow({ id: 'new1', data: { a: 1 } })],
    });
    const rec = await insertRecord('notes', { data: { a: 1 } }, 'owner');
    expect(rec.id).toBe('new1');
    expect(rec.collectionId).toBe('c1');
    expect(rec.data).toEqual({ a: 1 });
    expect(rec.version).toBe(1);
  });
});

describe('getRecord', () => {
  it('throws not_found when the record is absent', async () => {
    routeWith({ collection: [collectionRow()], select: [] });
    await expect(getRecord('notes', 'nope', 'owner')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('throws forbidden when the actor cannot read the row', async () => {
    routeWith({
      collection: [collectionRow()],
      select: [recordRow({ permissions: { read: ['owner'], write: ['owner'], delete: ['owner'] } })],
    });
    await expect(getRecord('notes', 'r1', 'workflow:x')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('returns the record when the actor may read', async () => {
    routeWith({ collection: [collectionRow()], select: [recordRow()] });
    const rec = await getRecord('notes', 'r1', 'owner');
    expect(rec.id).toBe('r1');
    expect(rec.data).toEqual({ foo: 'bar' });
  });
});

describe('updateRecord — optimistic concurrency', () => {
  it('throws conflict when expectedVersion does not match the stored version', async () => {
    routeWith({ collection: [collectionRow()], select: [recordRow({ version: 3 })] });
    await expect(
      updateRecord('notes', { id: 'r1' }, { data: { a: 2 }, expectedVersion: 1 }, 'owner'),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('throws conflict when the versioned UPDATE affects no rows (lost race)', async () => {
    routeWith({ collection: [collectionRow()], select: [recordRow({ version: 1 })], update: [] });
    await expect(
      updateRecord('notes', { id: 'r1' }, { data: { a: 2 } }, 'owner'),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('applies a patch merge and returns the updated record', async () => {
    routeWith({
      collection: [collectionRow()],
      select: [recordRow({ version: 1, data: { a: 1, b: 2 } })],
      update: [recordRow({ version: 2, data: { a: 1, b: 2, c: 3 } })],
    });
    const rec = await updateRecord('notes', { id: 'r1' }, { patch: { c: 3 } }, 'owner');
    expect(rec.version).toBe(2);
    expect(rec.data).toEqual({ a: 1, b: 2, c: 3 });
  });
});

describe('deleteRecord', () => {
  it('throws not_found when the record is absent', async () => {
    routeWith({ collection: [collectionRow()], select: [] });
    await expect(deleteRecord('notes', { id: 'gone' }, 'owner')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('deletes when the actor may delete', async () => {
    routeWith({ collection: [collectionRow()], select: [recordRow()], del: [recordRow()] });
    const res = await deleteRecord('notes', { id: 'r1' }, 'owner');
    expect(res.deleted).toBe(true);
  });
});

describe('upsertRecord', () => {
  it('upserts by key and returns the mapped record', async () => {
    routeWith({
      collection: [collectionRow()],
      select: [],
      insert: [recordRow({ id: 'up1', key: 'k1', data: { a: 9 } })],
    });
    const rec = await upsertRecord('notes', { key: 'k1', data: { a: 9 } }, 'owner');
    expect(rec.id).toBe('up1');
    expect(rec.key).toBe('k1');
    expect(rec.data).toEqual({ a: 9 });
  });
});
